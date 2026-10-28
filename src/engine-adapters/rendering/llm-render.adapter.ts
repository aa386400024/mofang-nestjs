// V2026-10-28 治本 (WP6 · B 层 · RenderPort LLM 适配器):
//   职责: 实现内核 RenderPort —— 把"渲染规格"变成"一段可出声的文本":
//         按 taskKind 取配置化参数 → 主备候选逐个尝试 → 出文本过输出侧伦理校验
//         → block 重生成一次 → 仍不过就降级兜底 → 归一成 RenderResult.
//   边界: B 层 (src/engine-adapters/), 触网络 (经窄面 ChatCaller 调 src/llm);
//         不改内核, 不改 src/llm 内部, 不拼系统 prompt, 不组装 RenderSpec,
//         不接 turn, 不填 reply, 不做流式.
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
//   反双胞胎:
//     - 不直接 import LlmRouterService 具体类: 只依赖窄面 ChatCaller, 于是单测
//       可 mock、未来换调用出口 (直连网关 / 换 SDK) 不用动本文件.
//     - 不把 vendor 私有字段塞进 RenderResult: usage 只映射内核约定的两个字段.
//     - 不静默吞掉 guard 异常: 输出校验是最后一道闸, 闸门自身故障时回落到
//       **内核规则层** (同 WP4 "探测挂了回落规则"的思路), 而不是直接放行.
//     - 不自己算 token 预算: 上限取 spec.tokenBudget.maxCompletionTokens,
//       归一走内核 resolveCompletionTokens, 口径与内核唯一.
//
//   如何验证:
//     1. npx tsc -p tsconfig.build.json --noEmit 0 错
//     2. test/engine-adapters/wp6-llm-render.spec.ts 覆盖选主/切备/冷却/恢复/降级/guard 处置

import { Logger } from '@nestjs/common';
import { clearTimeout, setTimeout } from 'node:timers';

import type { RenderAdapterConfig, RenderCandidate } from './render-adapter.config';
import { RenderFailoverRuntime, type RenderCandidateHealth } from './render-failover.runtime';
import {
  guardVisitorOutput,
  resolveCompletionTokens,
  type RenderPort,
  type RenderResult,
  type RenderSpec,
  type RiskProbePort,
} from '../../engine-core';
import type { ChatCompletionRequest, ChatCompletionResponse, ChatMessage } from '../../llm/common/interfaces/chat-provider.interface';

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
}

/**
 * 输出侧校验结论 (只取内核约定的字段, 不引入厂商私有结构).
 */
export interface RenderGuardVerdict {
  /** 判定等级. */
  readonly level: 'pass' | 'warn' | 'block';
  /** 命中的类别 (可选; 供观测定位, 不参与 RenderResult). */
  readonly categories?: readonly string[];
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
   * 可选消息构造缝 (WP7 注入系统 prompt 与完整上下文).
   *
   * 缺省时按 spec.recentTurns 直映射 (咨询师 → user, 来访 → assistant).
   * 为什么要留这道缝: **prompt 属适配层**(WP7), 而适配器本期的红线是"不拼 prompt";
   * 若不留缝, WP7 就得改本文件, 那是把"本期的克制"变成"下期的返工".
   */
  readonly buildMessages?: (spec: RenderSpec) => readonly ChatMessage[];
  /** 可选安全信号回调 (日志/观测用, 不进 RenderResult). */
  readonly onSafetySignal?: (text: string, level: string, categories: readonly string[]) => void;
  /** 可注入时钟 (主备冷却/退避用; 缺省 Date.now). */
  readonly now?: () => number;
}

/**
 * 已解析的渲染参数 (候选 overrides 覆盖分层默认后的结果).
 */
interface ResolvedRenderParams {
  readonly temperature: number;
  readonly model: string;
  readonly maxTokens: number;
}

/**
 * 单次调用结果.
 */
type CallResult =
  | { readonly ok: true; readonly response: ChatCompletionResponse }
  | { readonly ok: false; readonly retryable: boolean; readonly reason: string };

/**
 * 单个候选的一次尝试结果.
 */
type AttemptOutcome =
  | { readonly kind: 'success'; readonly text: string; readonly usage: ChatCompletionResponse['usage']; readonly providerHint: string }
  | { readonly kind: 'retry' }
  | { readonly kind: 'degrade'; readonly reason: string };

/**
 * 单次 render 调用的可变上下文 (每次调用独立, 不跨调用共享).
 */
interface RenderCallContext {
  readonly spec: RenderSpec;
  readonly messages: readonly ChatMessage[];
  readonly attempted: string[];
  regenBudget: number;
  usedRegen: boolean;
}

/**
 * 渲染适配器 (实现内核 RenderPort).
 *
 * 纯类: 可脱离 NestJS 容器 `new` 出来跑 (WP8 再做 DI 注册).
 */
export class LlmRenderAdapter implements RenderPort {
  private readonly logger = new Logger(LlmRenderAdapter.name);
  private readonly config: RenderAdapterConfig;
  private readonly runtime: RenderFailoverRuntime;

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
  async render(spec: RenderSpec): Promise<RenderResult> {
    const messages = this.buildMessages(spec);
    if (messages.length === 0) {
      this.logger.warn('[render] 渲染上下文为空 (无可用对话轮次), 直接降级兜底');
      return this.degrade(spec);
    }

    const ctx: RenderCallContext = {
      spec,
      messages,
      attempted: [],
      regenBudget: Math.max(0, this.config.maxBlockRegen),
      usedRegen: false,
    };

    // 上界 = 候选数 + 1: 每轮要么返回, 要么把一个**新**候选记入 attempted;
    // attempted 至多 candidates.length 个, 故最后一次 next 必返回 null → 降级.
    for (let round = 0; round <= this.config.candidates.length; round += 1) {
      const candidate = this.runtime.next(ctx.attempted);
      if (!candidate) {
        this.logger.warn('[render] 候选耗尽或全部处于冷却, 降级兜底');
        return this.degrade(spec);
      }
      ctx.attempted.push(candidate.id);

      const outcome = await this.attempt(ctx, candidate);
      if (outcome.kind === 'success') {
        // 成功即清零该候选的失败计数与冷却 (WP7 补): 计数只增不减的话,
        // 一个"失败过一次、后来已经恢复"的候选会带着旧计数进冷却,
        // 于是它比实际更早被踢出轮换 —— 退避就变成了惩罚而非保护.
        this.runtime.markSuccess(outcome.providerHint);
        return {
          text: outcome.text,
          taskKind: spec.taskKind,
          usage: {
            completionTokens: outcome.usage.completionTokens ?? 0,
            totalTokens: outcome.usage.totalTokens ?? 0,
          },
          // fallbackUsed = 切过备 / 走过 block 重生成 (降级路径恒为 true).
          fallbackUsed: ctx.usedRegen || ctx.attempted.length > 1,
          providerHint: outcome.providerHint,
        };
      }
      if (outcome.kind === 'degrade') {
        this.logger.error(`[render] 渲染失败, 降级兜底: ${outcome.reason}`);
        return this.degrade(spec);
      }
      // retry → 换下一个候选继续.
    }

    // 理论不可达 (next 返回 null 即退出循环); 保留兜底以满足类型收敛.
    return this.degrade(spec);
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

  /**
   * 用一个候选试一次: 调模型 → 取文本 → 过输出侧校验 → (block 时) 重生成.
   */
  private async attempt(ctx: RenderCallContext, candidate: RenderCandidate): Promise<AttemptOutcome> {
    const params = this.resolveParams(ctx.spec, candidate);
    if (!params.model) {
      this.logger.error(`[render] 候选 ${candidate.id} 未配置模型名 (taskKind=${ctx.spec.taskKind}), 无法发起调用`);
      return { kind: 'degrade', reason: `候选 ${candidate.id} 未配置模型名` };
    }

    const call = await this.callOnce(candidate, params, ctx.messages);
    if (!call.ok) {
      return call.retryable ? { kind: 'retry' } : { kind: 'degrade', reason: call.reason };
    }

    const text = (call.response.content ?? '').trim();
    if (!text) {
      // 空内容 = 没有可用输出, 与失败同等处理 (切备), 不把空串当"成功"返回.
      this.runtime.markFailure(candidate.id, this.config);
      this.logger.warn(`[render] 候选 ${candidate.id} 返回空内容, 视为失败并切备`);
      return { kind: 'retry' };
    }

    return await this.handleText(ctx, candidate, params, text, call.response.usage);
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
  ): Promise<AttemptOutcome> {
    const verdict = await this.evaluate(text);
    this.reportSignal(text, verdict);

    if (verdict.level !== 'block') {
      // pass / warn 都放行: warn 是"值得注意", 不是"不该说" —— 拦下 warn 等于
      // 让适配层替专业督导做判断, 越权. 只记信号, 不改写文本.
      return { kind: 'success', text, usage, providerHint: candidate.id };
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
  private async regenerate(ctx: RenderCallContext, candidate: RenderCandidate, params: ResolvedRenderParams): Promise<AttemptOutcome> {
    const regenParams: ResolvedRenderParams = {
      ...params,
      temperature: this.regenerationTemperature(params.temperature),
    };

    const call = await this.callOnce(candidate, regenParams, ctx.messages);
    if (!call.ok) {
      return call.retryable ? { kind: 'retry' } : { kind: 'degrade', reason: call.reason };
    }

    const text = (call.response.content ?? '').trim();
    if (!text) {
      this.runtime.markFailure(candidate.id, this.config);
      return { kind: 'retry' };
    }

    const verdict = await this.evaluate(text);
    this.reportSignal(text, verdict);
    if (verdict.level === 'block') {
      return { kind: 'degrade', reason: '重生成后输出仍命中 block' };
    }
    return { kind: 'success', text, usage: call.response.usage, providerHint: candidate.id };
  }

  /**
   * 单次调用 (带超时); 失败时统一记账并归类是否可切备.
   */
  private async callOnce(candidate: RenderCandidate, params: ResolvedRenderParams, messages: readonly ChatMessage[]): Promise<CallResult> {
    const request: ChatCompletionRequest = {
      model: params.model,
      messages: [...messages],
      temperature: params.temperature,
      maxTokens: params.maxTokens,
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
      this.runtime.markFailure(candidate.id, this.config);
      if (isAuthFailure(error)) {
        // 鉴权失败不切备 (M7): 坏 key 对所有候选都坏, 逐个尝试只放大延迟,
        // 而且每一次失败都在给用户叠加等待.
        this.logger.error(`[render] 候选 ${candidate.id} 鉴权失败, 不再在坏 key 上循环: ${errorMessage(error)}`);
        return { ok: false, retryable: false, reason: `鉴权失败: ${errorMessage(error)}` };
      }
      this.logger.warn(`[render] 候选 ${candidate.id} 调用失败, 切下一个候选: ${errorMessage(error)}`);
      return { ok: false, retryable: true, reason: errorMessage(error) };
    }
  }

  /**
   * 解析候选的最终参数: 分层默认 ← 候选 overrides 覆盖.
   */
  private resolveParams(spec: RenderSpec, candidate: RenderCandidate): ResolvedRenderParams {
    const defaults = this.config.taskDefaults[spec.taskKind];
    const override = candidate.overrides?.[spec.taskKind];
    const maxTokens = override?.maxTokens ?? defaults.maxTokens ?? resolveCompletionTokens(spec.tokenBudget.maxCompletionTokens);
    return {
      temperature: override?.temperature ?? defaults.temperature,
      model: override?.model ?? defaults.model ?? '',
      // maxTokens 必须是正整数: 非整数会被厂商截断/报错, 0 等于"不要输出".
      maxTokens: Math.max(1, Math.trunc(maxTokens)),
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
  private degrade(spec: RenderSpec): RenderResult {
    return {
      text: this.config.fallbackUtterance,
      taskKind: spec.taskKind,
      usage: { completionTokens: 0, totalTokens: 0 },
      fallbackUsed: true,
      providerHint: 'degraded',
    };
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
