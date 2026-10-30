// V2026-10-28 治本 (WP6 · B 层 · RenderPort LLM 适配器):
//   职责: 实现内核 RenderPort —— 把"渲染规格"变成"一段可出声的文本":
//         按 taskKind 取配置化参数 → 主备候选逐个尝试 → 出文本过输出侧伦理校验
//         → block 重生成一次 → 仍不过就降级兜底 → 归一成 RenderResult.
//   边界: B 层 (src/engine-adapters/), 触网络 (经窄面 ChatCaller 调 src/llm);
//         不改内核, 不改 src/llm 内部, 不拼系统 prompt, 不组装 RenderSpec,
//         不接 turn, 不填 reply.
//
//   V2026-10-29 治本 (WP8-B · 流式原生单一实现):
//     ① `render()` 与 `streamRender()` **共享同一份候选主备核心**
//        (`RenderFailoverRuntime` + `runCandidateLoop`), 不写第二套流式旁路.
//     ② 流式状态机: 首 delta 前定候选 (鉴权失败不切备 / 可重试切备) → 首个非空
//        delta 到达即**锁定**候选 (此后不切备, 已出声无法撤回) → 边吐边累计 →
//        收尾跑后置全文 guard (只记信号, 不 regen 不撤回) → 归约 usage.
//     ③ guard 拆两层: **前置静态预检** (首 delta 前, 只看 RenderSpec, 不调模型)
//        + **后置全文 guard** (流结束后, 复用注入 guard / 内核规则层).
//
//   为什么"选谁"仍然调内核 selectFailoverTarget (M1):
//     WP5 把"下一个该选谁"抽成了内核纯函数, 本期补的是**执行** (冷却/退避/
//     恢复切回). 若这里自己再写一遍遍历, 就有两份"谁是下一个"的真相, 改优先级
//     口径要改两处 —— 而两处漂移的方向恰好是"适配层选了个内核不认的候选".
//     所以: 内核给选择, 本文件给冷却过滤与失败记账.
//
//   为什么最终降级返回兜底话术而不是 reject (M4):
//     渲染是"最后一公里", 它挂了不该让整场对练挂掉 —— WP7 拿到的必须是**非空
//     文本**. 异常信息走日志, 不走控制流. 兜底话术本身也要守伦理 (中性、不越界).
//
//   为什么高危文本宁可丢也不改写 (M5):
//     block 意味着**来访者说出的话**命中了自杀计划/准备/主动意图等红线.
//     改写等于"帮它把危险的话说得委婉点", 那是在美化危险; 直接丢弃 + 降级到
//     中性话术才是真处置. 处置信号走 onSafetySignal 回调, 不塞进 RenderResult ——
//     结果字段要跨厂商通用, 塞私字段等于每接一个厂商改一次内核契约.
//
//   为什么流式路径**不做**中途 block → regen/切备 (WP8-B):
//     流式已经出声, 撤回不了. 中途切备等于"来访者先说了一半A, 突然改口说B" ——
//     对练里那不是模型切换, 那是人格分裂. 所以流式的纪律是:
//     **首 token 之后不再换人**, 中途出错就承认这一轮不完整 (降级 + 不落记忆),
//     而不是硬凑一个"看起来成功"的回复.
//
//   V2026-10-29 治本 (WP9-C · token 预算 / 思考强度 / 截断 / 风险路由):
//     ① 生成长度上限改用**新字段** `maxCompletionTokens` (thinking token 计入上限),
//        不再下发旧字段 `maxTokens` —— 旧字段下 160 的预算被思考吃光, 来访开不了口;
//     ② 渲染路径默认 `reasoningEffort=low` (内核已把决策做完, LLM 只做"翻译",
//        不需要深思考); 风险轮次由内核判定结果**强制抬档**到 medium/high;
//     ③ 截断保护: 上游 `finish_reason=length` 时丢弃未闭合尾句, **半句不出声**;
//     ④ 降级兜底改为**话术池** (轮换, 不复读), 日志带 `degraded=true` 标记.
//
//   反双胞胎:
//     - 不直接 import LlmRouterService 具体类: 只依赖窄面 ChatCaller, 于是单测
//       可 mock、未来换调用出口 (直连网关 / 换 SDK) 不用动本文件.
//     - 不把 vendor 私有字段塞进 RenderResult: usage 只映射内核约定的两个字段.
//     - 不静默吞掉 guard 异常: 输出校验是最后一道闸, 闸门自身故障时回落到
//       **内核规则层** (同 WP4 "探测挂了回落规则"的思路), 而不是直接放行.
//     - 不自己算 token 预算: 上限取 spec.tokenBudget.maxCompletionTokens,
//       归一走内核 resolveCompletionTokens, 口径与内核唯一.
//     - 不为流式再写一套主备/冷却: 两条路径共用 `runCandidateLoop` 与
//       `RenderFailoverRuntime` —— 两份主备逻辑必然漂移, 且漂移方向恰好是
//       "流式路径切了个聚合路径不认的候选".
//     - 不为前置预检另写一套规则词典: 预检复用**内核同一套** `evaluateSafety`
//       (side='visitor_output'), 与输出侧 guard 同一份词汇表.
//     - 不自己判断"这轮有没有危机": 判定在内核 (WP4) 与 RiskProbePort, 本文件只做
//       **路由** (判定结果 → 思考强度 / prompt 护栏), 不复刻词典.
//
//   如何验证:
//     1. npx tsc -p tsconfig.build.json --noEmit 0 错
//     2. test/engine-adapters/wp6-llm-render.spec.ts 覆盖选主/切备/冷却/恢复/降级/guard 处置
//     3. test/engine-adapters/wp8b-stream-render.spec.ts 覆盖流式状态机/锁定/降级/两层 guard
//     4. test/engine-adapters/wp9c-*.spec.ts 覆盖 token 字段/截断/风险路由

import { Logger } from '@nestjs/common';
import { clearTimeout, setTimeout } from 'node:timers';

import type { RenderAdapterConfig, RenderCandidate } from './render-adapter.config';
import { RenderFailoverRuntime, type RenderCandidateHealth } from './render-failover.runtime';
import type { AdaptiveRenderSpec, RenderRiskLevel } from './render-risk';
import { dropUnclosedTail, splitClosedPrefix } from './render-truncation';
import {
  splitTextIntoDeltas,
  type RenderGuardVerdict,
  type RenderPrecheckVerdict,
  type StreamRenderHandlers,
  type StreamRenderOutcome,
  type StreamingRenderPort,
} from './streaming-render.port';
import {
  evaluateSafety,
  guardVisitorOutput,
  resolveCompletionTokens,
  type RenderResult,
  type RenderSpec,
  type RiskProbePort,
} from '../../engine-core';
import type {
  ChatCompletionChunk,
  ChatCompletionRequest,
  ChatCompletionResponse,
  ChatMessage,
  ChatReasoningEffort,
} from '../../llm/common/interfaces/chat-provider.interface';

/**
 * 流式调用选项 (窄面).
 *
 * 与聚合调用的差别只在"多了什么": providerId 从位置参数升级成具名字段 (流式还要
 * 透传 uid 与 signal), 其余请求字段完全一致 —— 两条路走的是同一份厂商协议.
 */
export interface ChatStreamOptions {
  /** 目标候选 id (缺省走调用出口自己的默认). */
  readonly providerId?: string;
  /** 用户 id (计费 / 审计). */
  readonly uid?: string;
  /** 中断信号 (barge-in). */
  readonly signal?: AbortSignal;
}

/**
 * 窄调用面 —— 适配器只依赖这一面.
 *
 * 生产实现由 WP8 用 `LlmRouterService.chat` 适配; 单测用 stub.
 * 解耦的理由: 直接依赖 router 具体类, 就等于把"多 provider 注册 + apiKey 解析"
 * 这套**运行时能力**焊死在渲染适配器上, 单测必须造整个 Nest 容器才能跑.
 */
export interface ChatCaller {
  /**
   * 单轮 chat 调用.
   *
   * @param req 请求 (模型 / 消息 / 温度 / token 上限)
   * @param providerId 目标候选 id (缺省走调用出口自己的默认)
   */
  chat(req: ChatCompletionRequest, providerId?: string): Promise<ChatCompletionResponse>;

  /**
   * 流式 chat 调用 (**可选**).
   *
   * 为什么是可选而不是必实现: 单测 stub 与尚未接流式的调用出口都只实现了聚合;
   * 把它做成必实现会让"能不能流式"从**运行时能力**退化成**编译期约束** ——
   * 于是所有 stub 都要为了编译通过而写一个假的流. 做成可选后, 缺流式能力
   * 走"聚合收集成流"的兜底形态 (见 `streamViaAggregate`), 行为显式且可测.
   *
   * @param req 请求 (与聚合调用同一形状)
   * @param opts 流式选项 (providerId / uid / signal)
   */
  stream?(req: ChatCompletionRequest, opts?: ChatStreamOptions): AsyncIterable<ChatCompletionChunk>;
}

/**
 * 适配器构造依赖.
 */
export interface LlmRenderAdapterDeps {
  /** 调用出口 (生产接 LlmRouterService, 单测接 stub). */
  readonly caller: ChatCaller;
  /** 全部可配置面 (候选序列 / 参数 / 超时 / 退避 / 兜底话术). */
  readonly config: RenderAdapterConfig;
  /** 可选输出 guard (生产用 createVisitorOutputGuard 包装内核 guardVisitorOutput). */
  readonly guard?: (text: string) => Promise<RenderGuardVerdict>;
  /**
   * 可选前置静态预检 (WP8-B; 生产用 createVisitorPrecheck).
   *
   * 只在**流式**路径生效 (首 delta 前). 聚合路径的等价能力是"全文 guard 命中
   * block → 同候选降温重生成", 语义更强, 不需要前置预检.
   */
  readonly precheck?: (spec: AdaptiveRenderSpec) => RenderPrecheckVerdict;
  /**
   * 可选消息构造缝 (WP7 注入系统 prompt 与完整上下文).
   *
   * 缺省时按 spec.recentTurns 直映射 (咨询师 → user, 来访 → assistant).
   * 为什么要留这道缝: **prompt 属适配层**(WP7), 而适配器本期的红线是"不拼 prompt";
   * 若不留缝, WP7 就得改本文件, 那是把"本期的克制"变成"下期的返工".
   */
  readonly buildMessages?: (spec: AdaptiveRenderSpec) => readonly ChatMessage[];
  /** 可选安全信号回调 (日志/观测用, 不进 RenderResult). */
  readonly onSafetySignal?: (text: string, level: string, categories: readonly string[]) => void;
  /** 可注入时钟 (主备冷却/退避用; 缺省 Date.now). */
  readonly now?: () => number;
  /** 可选计费 / 审计用户 id (流式调用透传给调用出口). */
  readonly uid?: string;
}

/**
 * 已解析的渲染参数 (候选 overrides 覆盖分层默认后的结果).
 */
interface ResolvedRenderParams {
  readonly temperature: number;
  readonly model: string;
  readonly maxCompletionTokens: number;
  readonly reasoningEffort?: ChatReasoningEffort;
}

/**
 * 单次调用结果.
 */
type CallResult =
  | { readonly ok: true; readonly response: ChatCompletionResponse }
  | { readonly ok: false; readonly retryable: boolean; readonly reason: string };

/**
 * 聚合路径的一次尝试产物.
 */
interface AggregateRender {
  readonly text: string;
  readonly usage: ChatCompletionResponse['usage'];
  readonly providerHint: string;
  /**
   * 本次实际用的模型名 (WP24 · 成本日志要按模型归集).
   *
   * 为什么放这里而不放内核 `RenderResult`: 内核契约里的 `model` 只在内核
   * `RenderPort.render()` 的返回上; 这里带一份是**适配层内部**的传递形态,
   * 最终由 `render()` 汇总进内核结果.
   */
  readonly model: string;
}

/**
 * 一次候选尝试的终局 (聚合与流式**共用**同一套判词).
 *
 * `success` 携带候选 id: "谁成功了"必须由**尝试它的那个实现**说了算, 否则
 * 两条路径会出现两份"providerHint 怎么填"的真相.
 */
type AttemptOutcome<T> =
  | { readonly kind: 'success'; readonly candidateId: string; readonly value: T }
  | { readonly kind: 'retry'; readonly reason: string }
  | { readonly kind: 'degrade'; readonly reason: string };

/**
 * 单次 render 调用的可变上下文 (每次调用独立, 不跨调用共享).
 */
interface RenderCallContext {
  readonly spec: RenderSpec;
  readonly messages: readonly ChatMessage[];
  regenBudget: number;
  usedRegen: boolean;
}

/**
 * 渲染适配器 (实现内核 RenderPort + 适配层流式扩展).
 *
 * 纯类: 可脱离 NestJS 容器 `new` 出来跑 (WP8 再做 DI 注册).
 */
export class LlmRenderAdapter implements StreamingRenderPort {
  private readonly logger = new Logger(LlmRenderAdapter.name);
  private readonly config: RenderAdapterConfig;
  private readonly runtime: RenderFailoverRuntime;
  /** 兜底话术轮换游标 (实例内, 确定性). */
  private fallbackCursor = 0;

  constructor(private readonly deps: LlmRenderAdapterDeps) {
    if (deps.config.candidates.length === 0) {
      // 构造即失败: 候选序列为空意味着"永远渲染不出来", 那是接线错误.
      // 拖到第一次 render 才发现, 表现为"用户问了一句, 咨询师只会说兜底话术",
      // 排查成本极高; 在装配期炸掉, 错误信息直接指向配置.
      throw new Error('渲染适配器配置非法: 候选序列为空 (至少需要一个主候选)');
    }
    this.config = deps.config;
    this.runtime = new RenderFailoverRuntime(deps.config.candidates, deps.now ?? Date.now);
  }

  /**
   * 按规格渲染一段文本.
   *
   * 永不 reject: 主备全挂 / 输出仍高危 → 返回兜底话术 (M4).
   *
   * @param spec 渲染规格 (WP7 组装)
   * @returns 渲染结果
   */
  async render(spec: AdaptiveRenderSpec): Promise<RenderResult> {
    const messages = this.buildMessages(spec);
    if (messages.length === 0) {
      this.logger.warn('[render] 渲染上下文为空 (无可用对话轮次), 直接降级兜底');
      return this.degrade(spec);
    }

    const ctx: RenderCallContext = {
      spec,
      messages,
      regenBudget: Math.max(0, this.config.maxBlockRegen),
      usedRegen: false,
    };

    const { outcome, attempted } = await this.runCandidateLoop((candidate) => this.attempt(ctx, candidate));

    if (outcome.kind === 'success') {
      // 成功即清零该候选的失败计数与冷却 (WP7 补): 计数只增不减的话,
      // 一个"失败过一次、后来已经恢复"的候选会带着旧计数进冷却,
      // 于是它比实际更早被踢出轮换 —— 退避就变成了惩罚而非保护.
      this.runtime.markSuccess(outcome.candidateId);
      return {
        text: outcome.value.text,
        taskKind: spec.taskKind,
        usage: {
          completionTokens: outcome.value.usage.completionTokens ?? 0,
          totalTokens: outcome.value.usage.totalTokens ?? 0,
          // WP24: 上游聚合响应**有** promptTokens, 此前被丢弃 —— 丢掉它, 成本
          // 就只能算输出侧, 输入侧开销与输出侧混在一个数里估不出来.
          // 缺省即"上游没报" (不编造): 上游给了就如实带上去.
          // (用 typeof 而非 `=== undefined`: 上游类型里它是必填 number, 但运行时
          //  可能压根没填 —— typeof 判的是"真有这个数", 两种情况都判得对.)
          ...(typeof outcome.value.usage.promptTokens === 'number' ? { promptTokens: outcome.value.usage.promptTokens } : {}),
        },
        // fallbackUsed = 切过备 / 走过 block 重生成 (降级路径恒为 true).
        fallbackUsed: ctx.usedRegen || attempted.length > 1,
        providerHint: outcome.value.providerHint,
        model: outcome.value.model,
      };
    }

    this.logger.error(`[render] 渲染失败, 降级兜底: ${outcome.reason}`);
    return this.degrade(spec, outcome.reason);
  }

  /**
   * 流式渲染 — 增量吐字, 与聚合路径**共享**同一份候选主备核心.
   *
   * 状态机 (四阶段, 语义写死):
   *   1. 候选选择窗口 (首 delta 前): 鉴权失败 → **不切备**直接降级; 可重试错 /
   *      超时 / 空流 → markFailure 后切下一个候选.
   *   2. 锁定: 首个非空 delta 到达 → markSuccess + **锁定候选** (此后不切备).
   *   3. 边吐边累计: 后续 delta 依次转发并累计; 此阶段出错 → 不切备, 收尾降级.
   *   4. 收尾: 后置全文 guard (只记信号) → 归约 usage → 返回.
   *
   * 永不 reject: 全挂 → 兜底句 + degraded=true, 让上层能正常发 done.
   *
   * @param spec 渲染规格
   * @param handlers 增量回调面
   * @returns 流式收尾结果
   */
  async streamRender(spec: AdaptiveRenderSpec, handlers: StreamRenderHandlers): Promise<StreamRenderOutcome> {
    const messages = this.buildMessages(spec);
    if (messages.length === 0) {
      this.logger.warn('[streamRender] 渲染上下文为空 (无可用对话轮次), 直接降级兜底');
      return this.degradeOutcome(spec, '渲染上下文为空');
    }

    // 前置静态预检: 首 delta 之前, 只看 RenderSpec, 不调模型.
    // 命中 block → 这一轮不开口 (降级), 因为流式没有"说完再撤回"的选项.
    const pre = this.runPrecheck(spec);
    if (pre.level === 'block') {
      this.logger.error(`[streamRender] 前置静态预检命中 block (${(pre.categories ?? []).join(',') || '-'}), 不建流直接降级`);
      return this.degradeOutcome(spec, '前置静态预检命中 block');
    }

    if (!this.deps.caller.stream) {
      // 调用出口没有流式能力 → 聚合取文后切段成增量 (兜底形态, 不作为主路径).
      this.logger.warn('[streamRender] 调用出口无流式能力, 回退聚合收集成流');
      return this.streamViaAggregate(spec, handlers);
    }

    const { outcome, attempted } = await this.runCandidateLoop((candidate) => this.streamAttempt(spec, candidate, messages, handlers));

    if (outcome.kind === 'success') {
      // 切过备 → fallbackUsed=true (与聚合路径同一口径: 走过备用路径).
      return attempted.length > 1 ? { ...outcome.value, fallbackUsed: true } : outcome.value;
    }
    return this.degradeOutcome(spec, outcome.reason);
  }

  /**
   * 候选健康快照 (观测用; 不参与选择判定).
   *
   * 为什么适配器要暴露这个: 失败计数 / 冷却是否被正确清零, 是**只能通过真实
   * 链路**验证的行为 —— 直接调 runtime 的单测绕开了适配器, 曾经因此漏掉
   * "成功路径未清零"这个缺陷. 暴露只读快照, 让回归测试能盯住真实路径.
   */
  health(): Readonly<Record<string, RenderCandidateHealth>> {
    return this.runtime.health();
  }

  // ── 共享核心: 候选主备循环 ────────────────────────────────────────

  /**
   * 候选主备循环 —— 聚合与流式**共用**的唯一一份.
   *
   * 这里只做三件事: ① 按内核纯函数挑下一个候选 (冷却过滤在 runtime 里);
   * ② 把候选交给尝试实现; ③ 按尝试的终局决定"换下一个"还是"收摊".
   * 冷却/退避/记账全在 `RenderFailoverRuntime`, 两条路径拿到的是**同一份健康状态**.
   *
   * 上界 = 候选数 + 1: 每轮要么返回, 要么把一个**新**候选记入 attempted;
   * attempted 至多 candidates.length 个, 故最后一次 next 必返回 null → 降级.
   *
   * @param attempt 单个候选的尝试实现 (聚合 / 流式各一份, 判词同构)
   * @returns 终局 + 本轮已尝试的候选 id 序列
   */
  private async runCandidateLoop<T>(
    attempt: (candidate: RenderCandidate) => Promise<AttemptOutcome<T>>,
  ): Promise<{ outcome: AttemptOutcome<T>; attempted: readonly string[] }> {
    const attempted: string[] = [];
    for (let round = 0; round <= this.config.candidates.length; round += 1) {
      const candidate = this.runtime.next(attempted);
      if (!candidate) {
        return { outcome: { kind: 'degrade', reason: '候选耗尽或全部处于冷却' }, attempted };
      }
      attempted.push(candidate.id);
      const outcome = await attempt(candidate);
      if (outcome.kind !== 'retry') {
        return { outcome, attempted };
      }
    }
    return { outcome: { kind: 'degrade', reason: '候选耗尽' }, attempted };
  }

  /**
   * 调用失败的统一归类 (聚合与流式共用).
   *
   * 鉴权失败不切备 (M7): 坏 key 对所有候选都坏, 逐个尝试只放大延迟,
   * 而且每一次失败都在给用户叠加等待.
   */
  private classifyFailure(candidate: RenderCandidate, error: unknown): { readonly retryable: boolean; readonly reason: string } {
    this.runtime.markFailure(candidate.id, this.config);
    if (isAuthFailure(error)) {
      this.logger.error(`[render] 候选 ${candidate.id} 鉴权失败, 不再在坏 key 上循环: ${errorMessage(error)}`);
      return { retryable: false, reason: `鉴权失败: ${errorMessage(error)}` };
    }
    this.logger.warn(`[render] 候选 ${candidate.id} 调用失败, 切下一个候选: ${errorMessage(error)}`);
    return { retryable: true, reason: errorMessage(error) };
  }

  // ── 聚合路径 ──────────────────────────────────────────────────────

  /**
   * 用一个候选试一次: 调模型 → 取文本 → 过输出侧校验 → (block 时) 重生成.
   */
  private async attempt(ctx: RenderCallContext, candidate: RenderCandidate): Promise<AttemptOutcome<AggregateRender>> {
    const params = this.resolveParams(ctx.spec, candidate);
    if (!params.model) {
      this.logger.error(`[render] 候选 ${candidate.id} 未配置模型名 (taskKind=${ctx.spec.taskKind}), 无法发起调用`);
      return { kind: 'degrade', reason: `候选 ${candidate.id} 未配置模型名` };
    }

    const call = await this.callOnce(candidate, params, ctx.messages);
    if (!call.ok) {
      return call.retryable ? { kind: 'retry', reason: call.reason } : { kind: 'degrade', reason: call.reason };
    }

    const rawText = (call.response.content ?? '').trim();
    if (!rawText) {
      // 空内容 = 没有可用输出, 与失败同等处理 (切备), 不把空串当"成功"返回.
      this.runtime.markFailure(candidate.id, this.config);
      this.logger.warn(`[render] 候选 ${candidate.id} 返回空内容, 视为失败并切备`);
      return { kind: 'retry', reason: `候选 ${candidate.id} 返回空内容` };
    }

    // V2026-10-29 治本 (WP9-C · 截断保护): 上游按长度上限截断时, 半截句子不能出声.
    const guarded = this.applyTruncationGuard(rawText, call.response.finishReason);
    const text = guarded.text;
    if (!text) {
      // 截断后一句完整话都不剩 → 本候选没产出可用内容, 与空内容同口径切备.
      this.runtime.markFailure(candidate.id, this.config);
      this.logger.warn(`[render] 候选 ${candidate.id} 内容被上游截断且无完整句, 视为失败并切备`);
      return { kind: 'retry', reason: `候选 ${candidate.id} 截断后无完整句` };
    }

    return await this.handleText(ctx, candidate, params, text, call.response.usage);
  }

  /**
   * 截断保护: 上游 `finish_reason=length` 时丢弃未闭合的尾句.
   *
   * 为什么要丢弃而不是补一句收束: 半句进 TTS 队列会合成出半截音频 (字幕也半句),
   * 而"补一句自然收束"等于替模型编造它没说完的话 —— 在心理训练场景里, 编造的话
   * 可能正是最不该出现的那句. 宁可不完整, 不出声.
   *
   * @param text 上游返回的文本
   * @param finishReason 上游终止原因
   * @returns 裁剪后的文本 + 是否发生过裁剪
   */
  private applyTruncationGuard(text: string, finishReason: string | undefined): { readonly text: string; readonly truncated: boolean } {
    if (finishReason !== 'length') return { text, truncated: false };
    const kept = dropUnclosedTail(text);
    if (kept === text) return { text, truncated: false };
    this.logger.warn(`[render] 上游按长度截断 (finish_reason=length), 丢弃未闭合尾句: ${text.slice(kept.length, kept.length + 60)}`);
    return { text: kept, truncated: true };
  }

  /**
   * 处理一段已取到的文本: 过校验 → 放行 / 重生成 / 降级.
   */
  private async handleText(
    ctx: RenderCallContext,
    candidate: RenderCandidate,
    params: ResolvedRenderParams,
    text: string,
    usage: ChatCompletionResponse['usage'],
  ): Promise<AttemptOutcome<AggregateRender>> {
    const verdict = await this.evaluate(text);
    this.reportSignal(text, verdict);

    if (verdict.level !== 'block') {
      // pass / warn 都放行: warn 是"值得注意", 不是"不该说" —— 拦下 warn 等于
      // 让适配层替专业督导做判断, 越权. 只记信号, 不改写文本.
      return { kind: 'success', candidateId: candidate.id, value: { text, usage, providerHint: candidate.id, model: params.model } };
    }

    if (ctx.regenBudget <= 0) {
      return { kind: 'degrade', reason: '输出命中 block 且重生成预算已耗尽' };
    }
    ctx.regenBudget -= 1;
    ctx.usedRegen = true;
    return await this.regenerate(ctx, candidate, params);
  }

  /**
   * block 后的唯一一次重生成: **同一候选 + 降温度**.
   *
   * 为什么是降温度而不是换候选:
   *   候选刚刚成功返回了内容, 说明它是**健康的** —— 换掉它等于拿一个没验证过的
   *   候选去赌第二次. 而 block 的最可能成因是采样飘了 (高温抽到了不该说的内容),
   *   降温是最直接、对症、且不引入新变量的干预. 若重生成本身失败 (错误/空内容),
   *   则回到主备循环切下一个候选 —— 那时"换候选"才成立.
   */
  private async regenerate(
    ctx: RenderCallContext,
    candidate: RenderCandidate,
    params: ResolvedRenderParams,
  ): Promise<AttemptOutcome<AggregateRender>> {
    const regenParams: ResolvedRenderParams = {
      ...params,
      temperature: this.regenerationTemperature(params.temperature),
    };

    const call = await this.callOnce(candidate, regenParams, ctx.messages);
    if (!call.ok) {
      return call.retryable ? { kind: 'retry', reason: call.reason } : { kind: 'degrade', reason: call.reason };
    }

    const rawText = (call.response.content ?? '').trim();
    if (!rawText) {
      this.runtime.markFailure(candidate.id, this.config);
      return { kind: 'retry', reason: `候选 ${candidate.id} 重生成返回空内容` };
    }
    // 截断保护与首轮同口径 (重生成也可能被长度上限截断).
    const text = this.applyTruncationGuard(rawText, call.response.finishReason).text;
    if (!text) {
      this.runtime.markFailure(candidate.id, this.config);
      return { kind: 'retry', reason: `候选 ${candidate.id} 重生成内容被截断且无完整句` };
    }

    const verdict = await this.evaluate(text);
    this.reportSignal(text, verdict);
    if (verdict.level === 'block') {
      return { kind: 'degrade', reason: '重生成后输出仍命中 block' };
    }
    return {
      kind: 'success',
      candidateId: candidate.id,
      value: { text, usage: call.response.usage, providerHint: candidate.id, model: params.model },
    };
  }

  /**
   * 单次调用 (带超时); 失败时统一记账并归类是否可切备.
   */
  private async callOnce(candidate: RenderCandidate, params: ResolvedRenderParams, messages: readonly ChatMessage[]): Promise<CallResult> {
    const request: ChatCompletionRequest = {
      model: params.model,
      messages: [...messages],
      temperature: params.temperature,
      // V2026-10-29 治本 (WP9-C): 只下发新字段 `maxCompletionTokens` —— 旧字段
      // `maxTokens` 与它**不同时下发** (语义歧义, 上游可能按旧字段截断).
      maxCompletionTokens: params.maxCompletionTokens,
      ...(params.reasoningEffort === undefined ? {} : { reasoningEffort: params.reasoningEffort }),
    };

    try {
      const response = await withTimeout(this.deps.caller.chat(request, candidate.id), this.config.timeoutMs);
      if (!response || typeof response.content !== 'string') {
        this.runtime.markFailure(candidate.id, this.config);
        this.logger.warn(`[render] 候选 ${candidate.id} 返回非法响应形状, 视为失败并切备`);
        return { ok: false, retryable: true, reason: '响应形状非法' };
      }
      return { ok: true, response };
    } catch (error) {
      const failure = this.classifyFailure(candidate, error);
      return { ok: false, retryable: failure.retryable, reason: failure.reason };
    }
  }

  // ── 流式路径 ──────────────────────────────────────────────────────

  /**
   * 用一个候选跑一轮流式: 建流 → 取首 delta → 锁定 → 边吐边累计 → 收尾.
   *
   * 返回值语义与聚合路径同构 (success / retry / degrade), 所以两条路径共用同一个
   * 主备循环 —— 这就是"单一实现"的落点.
   */
  private async streamAttempt(
    spec: AdaptiveRenderSpec,
    candidate: RenderCandidate,
    messages: readonly ChatMessage[],
    handlers: StreamRenderHandlers,
  ): Promise<AttemptOutcome<StreamRenderOutcome>> {
    const params = this.resolveParams(spec, candidate);
    if (!params.model) {
      this.logger.error(`[streamRender] 候选 ${candidate.id} 未配置模型名 (taskKind=${spec.taskKind}), 无法建流`);
      return { kind: 'degrade', reason: `候选 ${candidate.id} 未配置模型名` };
    }

    const request: ChatCompletionRequest = {
      model: params.model,
      messages: [...messages],
      temperature: params.temperature,
      // V2026-10-29 治本 (WP9-C): 只下发新字段 `maxCompletionTokens`, 不与旧字段并存.
      maxCompletionTokens: params.maxCompletionTokens,
      ...(params.reasoningEffort === undefined ? {} : { reasoningEffort: params.reasoningEffort }),
    };

    const opened = await this.openStream(candidate, request, handlers);
    if (!opened.ok) {
      return opened.retryable ? { kind: 'retry', reason: opened.reason } : { kind: 'degrade', reason: opened.reason };
    }

    // 阶段 2: 锁定 —— 首个非空 delta 到达即证明该候选健康.
    // 此后无论中途发生什么, 都不再切备 (已出声无法撤回).
    this.runtime.markSuccess(candidate.id);

    // V2026-10-29 治本 (WP9-C · 句边界缓冲): 只有**已闭合**的句子才往下游发.
    //   为什么: 流被上游截断 (`finish_reason=length`) 时, 半截句子一旦发出去, 就已经
    //   进了 TTS 队列 (音频 + 字幕都成了半句), 事后无法撤回. 所以这里把"还没说完的
    //   那句"扣在缓冲区里, 等它闭合再发; 若流被截断, 这段尾巴**直接丢弃, 不出声**.
    //   代价: 未闭合句的字幕会晚到 (闭合才发) —— 但 TTS 本来也是按句合成,
    //   字幕与语音对齐反而更准.
    let pending = '';
    let text = '';

    const emit = async (chunk: string): Promise<void> => {
      if (chunk.length === 0) return;
      text += chunk;
      await handlers.onDelta(chunk);
    };

    pending += opened.firstDelta;
    {
      const split = splitClosedPrefix(pending);
      pending = split.pending;
      await emit(split.closed);
    }

    // 阶段 3: 边吐边累计.
    let tokenCount = opened.tokenCount;
    let finishReason: string | undefined;
    let reasoningTokens: number | undefined;
    try {
      for (;;) {
        const next = await opened.iterator.next();
        if (next.done) break;
        const chunk = next.value;
        if (typeof chunk.tokenCount === 'number' && Number.isFinite(chunk.tokenCount)) {
          tokenCount = chunk.tokenCount;
        }
        if (typeof chunk.reasoningTokens === 'number' && Number.isFinite(chunk.reasoningTokens)) {
          reasoningTokens = chunk.reasoningTokens;
        }
        if (typeof chunk.finishReason === 'string' && chunk.finishReason.length > 0) {
          finishReason = chunk.finishReason;
        }
        const delta = chunk.delta ?? '';
        if (delta.length === 0) continue;
        pending += delta;
        const split = splitClosedPrefix(pending);
        pending = split.pending;
        await emit(split.closed);
      }
    } catch (error) {
      // 已锁定 → 不切备, 收尾降级 (残句当"这一轮不完整"处理).
      this.logger.warn(`[streamRender] 候选 ${candidate.id} 锁定后中断, 收尾降级: ${errorMessage(error)}`);
      return { kind: 'degrade', reason: `候选 ${candidate.id} 锁定后中断: ${errorMessage(error)}` };
    }

    // 收尾: 未闭合尾巴的去向.
    //   · 被上游截断 (length) → **丢弃** (半句不出声, 任务单 §2.2);
    //   · 正常结束 → 照常发出 (一句"嗯"不该被误判成没说完, 任务单 §4.2).
    if (pending.length > 0) {
      if (finishReason === 'length') {
        this.logger.warn(
          `[streamRender] 候选 ${candidate.id} 被上游按长度截断 (finish_reason=length), 丢弃未闭合尾句: ${pending.slice(0, 60)}`,
        );
      } else {
        await emit(pending);
      }
    }

    // 阶段 4: 收尾 —— 后置全文 guard 只记信号 (不 regen / 不撤回).
    const verdict = await this.evaluate(text);
    this.reportSignal(text, verdict);

    return {
      kind: 'success',
      candidateId: candidate.id,
      value: {
        text,
        taskKind: spec.taskKind,
        // 流式只有累计 tokenCount, 无 prompt/completion 拆分 —— 同源取末条, 不编造.
        // WP24: 因此**流式路径的输入侧用量不可得** (promptTokens 缺省) ——
        //   成本口径会如实落成 output_only, 而不是拿 0 冒充"输入侧没花钱".
        usage: {
          completionTokens: tokenCount,
          totalTokens: tokenCount,
          ...(reasoningTokens === undefined ? {} : { reasoningTokens }),
        },
        fallbackUsed: false,
        providerHint: candidate.id,
        model: params.model,
        degraded: false,
        guardVerdict: verdict,
      },
    };
  }

  /**
   * 建流 + 取首个非空 delta (阶段 1: 候选选择窗口).
   *
   * 失败语义:
   *   - 建流/取数抛错 → 鉴权失败不切备 (degrade), 其余可切备 (retry);
   *   - 流自然结束但没有内容 (空流) → 视为失败并切备 (与聚合路径"空内容"同口径).
   */
  private async openStream(
    candidate: RenderCandidate,
    request: ChatCompletionRequest,
    handlers: StreamRenderHandlers,
  ): Promise<
    | { readonly ok: true; readonly iterator: AsyncIterator<ChatCompletionChunk>; readonly firstDelta: string; readonly tokenCount: number }
    | { readonly ok: false; readonly retryable: boolean; readonly reason: string }
  > {
    const stream = this.deps.caller.stream?.(request, {
      providerId: candidate.id,
      ...(this.deps.uid ? { uid: this.deps.uid } : {}),
      ...(handlers.signal ? { signal: handlers.signal } : {}),
    });
    if (!stream) {
      return { ok: false, retryable: true, reason: '调用出口无流式能力' };
    }

    const iterator = stream[Symbol.asyncIterator]();
    let tokenCount = 0;
    try {
      for (;;) {
        const next = await iterator.next();
        if (next.done) break;
        const chunk = next.value;
        if (typeof chunk.tokenCount === 'number' && Number.isFinite(chunk.tokenCount)) {
          tokenCount = chunk.tokenCount;
        }
        const delta = chunk.delta ?? '';
        if (delta.length > 0) {
          return { ok: true, iterator, firstDelta: delta, tokenCount };
        }
      }
    } catch (error) {
      const failure = this.classifyFailure(candidate, error);
      return { ok: false, retryable: failure.retryable, reason: failure.reason };
    }

    // 空流: 首个 delta 前没有任何内容 → 与聚合路径"空内容"同口径, 切备.
    this.runtime.markFailure(candidate.id, this.config);
    this.logger.warn(`[streamRender] 候选 ${candidate.id} 空流 (首 delta 前无内容), 视为失败并切备`);
    return { ok: false, retryable: true, reason: `候选 ${candidate.id} 空流` };
  }

  /**
   * 兜底形态: 调用出口没有流式能力 → 聚合取文后切段成增量.
   *
   * 为什么不另写一套"假流式": 那正是本单要消灭的第二套实现. 这里复用**同一个**
   * `render()` (因此主备/冷却/guard/降级全都一致), 只是把成品文本切成段转发.
   */
  private async streamViaAggregate(spec: RenderSpec, handlers: StreamRenderHandlers): Promise<StreamRenderOutcome> {
    const result = await this.render(spec);
    for (const chunk of splitTextIntoDeltas(result.text)) {
      await handlers.onDelta(chunk);
    }
    const degraded = result.providerHint === 'degraded';
    return {
      text: result.text,
      taskKind: result.taskKind,
      usage: {
        completionTokens: result.usage.completionTokens,
        totalTokens: result.usage.totalTokens,
        // WP24: 聚合路径有 promptTokens 就带上去 (与流式路径的口径差异如实透出).
        ...(result.usage.promptTokens === undefined ? {} : { promptTokens: result.usage.promptTokens }),
      },
      fallbackUsed: result.fallbackUsed,
      ...(result.providerHint ? { providerHint: result.providerHint } : {}),
      ...(result.model ? { model: result.model } : {}),
      degraded,
    };
  }

  // ── 共用工具 ──────────────────────────────────────────────────────

  /**
   * 解析候选的最终参数: 分层默认 ← 候选 overrides 覆盖.
   *
   * 思考强度还要再过一道**风险抬档** (任务单 §2.3): 风险轮次不走 low,
   * 至少 medium, 行动层危机走 high. 抬档只升不降 —— 配置写 high 的候选不会
   * 因为"这轮没风险"被降回 low (那会让配置形同虚设).
   */
  private resolveParams(spec: AdaptiveRenderSpec, candidate: RenderCandidate): ResolvedRenderParams {
    const defaults = this.config.taskDefaults[spec.taskKind];
    const override = candidate.overrides?.[spec.taskKind];
    const maxCompletionTokens =
      override?.maxCompletionTokens ?? defaults.maxCompletionTokens ?? resolveCompletionTokens(spec.tokenBudget.maxCompletionTokens);
    const configuredEffort = override?.reasoningEffort ?? defaults.reasoningEffort;
    return {
      temperature: override?.temperature ?? defaults.temperature,
      model: override?.model ?? defaults.model ?? '',
      // maxCompletionTokens 必须是正整数: 非整数会被厂商截断/报错, 0 等于"不要输出".
      maxCompletionTokens: Math.max(1, Math.trunc(maxCompletionTokens)),
      reasoningEffort: escalateReasoningEffort(configuredEffort, spec.riskSignal?.level),
    };
  }

  /**
   * 重生成温度: 取当前温度与 stable 低温的较小者 (只降不升).
   */
  private regenerationTemperature(current: number): number {
    return Math.min(current, this.config.taskDefaults.stable.temperature);
  }

  /**
   * 构造消息序列: 优先用注入的构造缝, 否则把 spec.recentTurns 直映射.
   *
   * 角色映射: 咨询师 → user, 来访 → assistant. 依据是**模型扮演来访者**,
   * 所以咨询师的话是"对方说的"(user), 来访自己说过的话是"我说过的"(assistant).
   */
  private buildMessages(spec: RenderSpec): readonly ChatMessage[] {
    if (this.deps.buildMessages) return this.deps.buildMessages(spec);
    return spec.recentTurns.map((turn) => ({
      role: turn.role === 'counselor' ? 'user' : 'assistant',
      content: turn.text,
    }));
  }

  /**
   * 输出侧校验: 注入的 guard 优先; guard 异常 → 回落到内核规则层;
   * 规则层也异常 → 按 block 处理 (闸门故障时, 未校验的文本不能直接出声).
   */
  private async evaluate(text: string): Promise<RenderGuardVerdict> {
    if (!this.deps.guard) return { level: 'pass' };
    try {
      const verdict = await this.deps.guard(text);
      return verdict ?? { level: 'pass' };
    } catch (error) {
      this.logger.warn(`[render] 输出校验异常, 回落到内核规则层: ${errorMessage(error)}`);
      try {
        const fallback = await guardVisitorOutput(text);
        return { level: fallback.level, categories: fallback.categories };
      } catch (fallbackError) {
        this.logger.error(`[render] 规则层校验也异常, 按 block 处理: ${errorMessage(fallbackError)}`);
        return { level: 'block' };
      }
    }
  }

  /**
   * 前置静态预检 (流式专用): 注入的预检优先; 预检自身异常 → **放行**.
   *
   * 为什么异常放行而输出 guard 异常按 block:
   *   输出 guard 是**最后一道闸** —— 它故障时未校验的文本正在出声, 挡住更安全;
   *   前置预检是**减少风险**的优化 —— 它故障时若按 block 处理, 等于预检代码一个
   *   小 bug 就把整条语音链路掐掉 (从"来访者可能说一句危险的话"退化成"来访者
   *   一句话都不说"). 真正的安全边界在咨询师输入侧的内核评估与后置全文 guard 上,
   *   前置预检不是安全边界, 所以它故障时放行 + 告警.
   */
  private runPrecheck(spec: RenderSpec): RenderPrecheckVerdict {
    const checker = this.deps.precheck;
    if (!checker) return { level: 'pass' };
    try {
      return checker(spec) ?? { level: 'pass' };
    } catch (error) {
      this.logger.warn(`[streamRender] 前置静态预检异常, 按放行处理: ${errorMessage(error)}`);
      return { level: 'pass' };
    }
  }

  /**
   * 上报安全信号 (warn / block): 回调拿全文, 日志只留截断片段 (同 WP4 口径).
   */
  private reportSignal(text: string, verdict: RenderGuardVerdict): void {
    if (verdict.level === 'pass') return;
    const categories = verdict.categories ?? [];
    this.deps.onSafetySignal?.(text, verdict.level, categories);
    this.logger.warn(`[render] 输出侧安全信号 level=${verdict.level} categories=${categories.join(',') || '-'} 片段=${text.slice(0, 120)}`);
  }

  /**
   * 最终降级: 返回兜底话术, 永不 reject (M4).
   */
  private degrade(spec: AdaptiveRenderSpec, reason = '渲染失败'): RenderResult {
    const utterance = this.pickFallbackUtterance();
    // degraded=true 是**日志标记**: 兜底句不是来访者真说的话, 不许冒充成真实回复.
    this.logger.error(`[render] 渲染降级兜底: degraded=true reason=${reason} utterance=${utterance}`);
    return {
      text: utterance,
      taskKind: spec.taskKind,
      usage: { completionTokens: 0, totalTokens: 0 },
      fallbackUsed: true,
      providerHint: 'degraded',
    };
  }

  /**
   * 流式降级结果.
   *
   * `degraded=true` 的含义: 这段文本**不是**来访者完整说出来的真话 (兜底句或
   * 残句), 上层据此不把它写进历史与工作记忆.
   */
  private degradeOutcome(spec: AdaptiveRenderSpec, reason: string): StreamRenderOutcome {
    const utterance = this.pickFallbackUtterance();
    this.logger.warn(`[streamRender] 降级兜底: degraded=true reason=${reason} utterance=${utterance}`);
    return {
      text: utterance,
      taskKind: spec.taskKind,
      usage: { completionTokens: 0, totalTokens: 0 },
      fallbackUsed: true,
      providerHint: 'degraded',
      degraded: true,
    };
  }

  /**
   * 取一句兜底话术 (轮换).
   *
   * 为什么轮换而不是永远同一句: 连续两轮降级若都是同一句, 用户会听出"这是复读机"
   * —— 那等于把兜底暴露成故障. 轮换后听感上更像"来访者停顿了一下".
   *
   * 游标是**实例内**的: 适配器是单例, 一个游标就够, 且天然是确定性的 (可测).
   */
  private pickFallbackUtterance(): string {
    const pool = this.config.fallbackUtterances;
    if (pool.length === 0) return '';
    const index = this.fallbackCursor % pool.length;
    this.fallbackCursor += 1;
    return pool[index];
  }
}

/**
 * 生产用输出 guard: 包装内核 guardVisitorOutput (规则 + 可选探测).
 *
 * 两侧口径永远一致 —— 咨询师输入侧与来访输出侧共用 WP4 的同一套规则.
 *
 * @param opts 可选探测端口与超时
 * @returns 适配器可用的 guard 函数
 */
export function createVisitorOutputGuard(opts?: {
  readonly probe?: RiskProbePort;
  readonly timeoutMs?: number;
}): (text: string) => Promise<RenderGuardVerdict> {
  return async (text: string): Promise<RenderGuardVerdict> => {
    const verdict = await guardVisitorOutput(text, opts);
    return { level: verdict.level, categories: verdict.categories };
  };
}

/**
 * 生产用前置静态预检 (WP8-B): 复用**内核同一套**来访侧规则.
 *
 * 判的是"角色内容里有没有硬红线" —— 即会直接驱动模型说出口的那些内容
 * (核心信念 / 本轮轨迹提示). 命中 block → 本轮不开口 (流式不可撤回).
 *
 * 为什么不用 `forbiddenBehaviors`: 它是**负向约束** ("绝不能出现"), 里面出现
 * 敏感词恰恰说明"这次不要碰", 拿它当风险信号会把最该谨慎的场景判成最该拦的场景.
 *
 * @returns 适配器可用的预检函数
 */
export function createVisitorPrecheck(): (spec: RenderSpec) => RenderPrecheckVerdict {
  return (spec: RenderSpec): RenderPrecheckVerdict => {
    const text = collectVisitorRoleText(spec);
    if (text.length === 0) return { level: 'pass' };
    const verdict = evaluateSafety(text, 'visitor_output');
    return { level: verdict.level, categories: verdict.categories };
  };
}

/**
 * 收集"会驱动模型说出口"的角色内容 (核心信念 + 本轮轨迹提示).
 */
function collectVisitorRoleText(spec: RenderSpec): string {
  const parts: string[] = [];
  for (const belief of spec.coreBeliefs) {
    const statement = belief.statement.trim();
    if (statement.length > 0) parts.push(statement);
  }
  const note = spec.trajectoryNote?.trim();
  if (note) parts.push(note);
  return parts.join('\n');
}

/**
 * 思考强度档位序 (用于"只升不降"的抬档比较).
 */
const REASONING_EFFORT_RANK: Readonly<Record<ChatReasoningEffort, number>> = {
  low: 1,
  medium: 2,
  high: 3,
  xhigh: 4,
  max: 5,
};

/**
 * 风险轮次的思考强度抬档 (任务单 §2.3).
 *
 * 规则:
 *   - 风险等级 medium → 至少 medium; high → 至少 high;
 *   - **只升不降**: 配置写 high 的候选不会因为"这轮没风险"被降回 low;
 *   - 配置没写 (undefined = 上游默认档) → 不动 (上游默认往往是最高档, 更保守).
 *
 * @param configured 配置档位
 * @param risk 本轮风险等级
 * @returns 实际下发的思考强度
 */
export function escalateReasoningEffort(
  configured: ChatReasoningEffort | undefined,
  risk: RenderRiskLevel | undefined,
): ChatReasoningEffort | undefined {
  if (!configured) return undefined;
  const floor = riskReasoningFloor(risk);
  if (!floor) return configured;
  return REASONING_EFFORT_RANK[configured] >= REASONING_EFFORT_RANK[floor] ? configured : floor;
}

/**
 * 风险等级 → 思考强度下限 (查表, 不写嵌套三元).
 *
 * @param risk 本轮风险等级
 * @returns 思考强度下限; 无风险下限时 undefined
 */
function riskReasoningFloor(risk: RenderRiskLevel | undefined): ChatReasoningEffort | undefined {
  switch (risk) {
    case 'high':
      return 'high';
    case 'medium':
      return 'medium';
    default:
      return undefined;
  }
}

/**
 * 调用超时兜底: 到点 reject, 让调用方走切备 / 降级.
 *
 * 计时器必须 unref: 否则"模型永不返回"的场景里, 这个计时器会把 Node 事件循环
 * 吊住 (线上表现为服务停不下来). unref 只影响"是否吊住事件循环", 不影响计时器
 * 正常触发. 正常路径另有 clearTimeout, 不会留下悬挂句柄.
 *
 * 说明: 超时后**不取消**底层请求 —— 窄面 ChatCaller 不承诺支持取消 (与 WP4 的
 * "不强行 abort 探测实现"同思路); 迟到的响应被丢弃即可.
 */
function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('渲染调用超时')), Math.max(1, timeoutMs));
    timer.unref();
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

/**
 * 鉴权失败特征 (401/403 / 缺 key / 明确鉴权文案).
 *
 * 说明: 这是**启发式**判定 —— 厂商异常形状不统一 (有的给 status, 有的只给
 * 文案), 所以结构化 status 优先, 文案兜底. 误判的代价是"多降级一次"
 * (少一次切备机会), 而不是"把高危文本放出去", 失败方向可接受.
 */
const AUTH_ERROR_PATTERNS: readonly RegExp[] = [
  /api key not found/i,
  /invalid api key/i,
  /unauthorized/i,
  /forbidden/i,
  /\b401\b/,
  /\b403\b/,
];

/**
 * 是否鉴权类失败 (不可切备, 直接降级).
 */
function isAuthFailure(error: unknown): boolean {
  const status = extractErrorStatus(error);
  if (status === 401 || status === 403) return true;
  const message = errorMessage(error);
  return AUTH_ERROR_PATTERNS.some((pattern) => pattern.test(message));
}

/**
 * 从任意错误形状里取 HTTP 状态码 (有则用).
 */
function extractErrorStatus(error: unknown): number | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const candidate = error as { status?: unknown; statusCode?: unknown; response?: { status?: unknown } };
  const raw = candidate.status ?? candidate.statusCode ?? candidate.response?.status;
  return typeof raw === 'number' ? raw : undefined;
}

/**
 * 错误转可读文案.
 */
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// 兼容导出: `RenderGuardVerdict` 的单一真相已搬到 streaming-render.port.ts,
// 这里 re-export 回老路径, 让既有 import 不破.
export type { RenderGuardVerdict, RenderPrecheckVerdict, StreamRenderHandlers, StreamRenderOutcome, StreamingRenderPort };
