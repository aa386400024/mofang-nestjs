// V2026-11-08 治本 (R9 · B 层 · LLM 审议生效钩子):
//   职责: 实现内核的 `DeliberationHookPort` —— 在本轮落库**前**, 把上一轮异步跑完的
//         审议建议作为**稀疏补丁**交给内核, 由内核合并进规则 delta.
//   边界: B 层 (src/engine-adapters/), 触网络 / 触 Redis —— **不在** src/engine-core/ 内.
//         内核只认那个纯类型端口 (零网络 / 零 prompt / 零 @nestjs).
//
//   V2026-11-08 治本 (两拍分离 · 为什么审议**不 await** 在主流程上):
//     审议要调 LLM (秒级网络往返). 若在 `turn()` 里 await 它, 语音对练每轮多等一个
//     LLM 往返 —— 实时对话节奏直接崩 (这是"会说话"的产品, 不是批处理).
//     所以拆成两拍:
//       第 N 轮:   适配层**异步**跑审议 (fire-and-forget), 结果写进进程内缓存;
//       第 N+1 轮: 内核问钩子要建议 → 钩子**同步**读缓存 → 返回给内核.
//     代价: 建议**滞后一轮** (第 N 轮的建议在第 N+1 轮生效). 这个偏移是刻意的 ——
//     用"滞后一轮"换"每轮不阻塞", 在实时语音场景下这笔交易明显划算.
//     ⚠️ 滞后意味着"第 N 轮的建议是基于第 N 轮的状态算的" —— 若中途状态被改过
//       (会话恢复 / 别的进程改了状态), 建议就过时了. 过期判定就是为这件事准备的.
//
//   过期判定 (R9 修订 · 用**版本号**, 不是猜):
//     产出拍记下"这份建议是基于第几版状态算的" (`baseRevision`), 消费拍拿内核
//     报上来的 `context.currentRevision` 比对 —— **不相等 = 状态在两拍之间动过** →
//     建议作废, 回退规则 delta.
//     ⚠️ 口径对齐 (`llm-deliberation.service.ts` 的 `checkStale` 同锚):
//       `currentRevision` = 本轮**开始时**载入的快照版本 = 上一轮**落库后**的版本 (R1).
//       产出拍用的也是 R1 (本轮落库后的版本) —— 两边天然相等, 只有状态被外力改过
//       才会不等. 这也是为什么内核报的是 `snapshot.revision` 而**不是**本地算的 +1.
//     ⚠️ 判不出就当没过期 (保守方向: 宁可多留一次, 不可多丢一次).
//
//   四层兜底 (任一命中 → 回退规则 delta, 主流程**绝不**炸):
//     ① LLM 超时 / 网络错 / 上游 5xx → 跑审议那一拍失败 → 缓存里没建议;
//     ② 格式非法 (维度白名单 / 幅度越界 / 标签非法) → 校验层丢掉 → 无有效建议;
//     ③ 过期 (建议算完后状态版本变了) → 丢弃;
//     ④ 临床合理性标记命中 → **该维度**被丢弃 (保守方向: 可疑的改动不落状态).
//
//   反双胞胎:
//     - **不自己拼 prompt** —— 复用 `buildDeliberationSystemPrompt` /
//       `buildDeliberationUserPrompt` (deliberation-prompt.ts), 措辞只有一份;
//     - **不自己解析 JSON** —— 结构化输出只有一条链: `CounselorLlmJsonClient`;
//     - **不自己写 LLM 请求** —— 由 `LlmDeliberationService.runEffectiveDeliberation`
//       跑 (它已有超时 / 重试 / 熔断 / trace / 统计);
//     - **不自己算 cap** —— 复用 `applyDeliberationDeltaCap` (与规则算子同一份边界);
//     - **不自己跑临床规则** —— 复用 `applyClinicalSanityCheck`.
//     - **不把审议原文 (reason / summary) 打进日志** —— 心理内容禁止进普通日志
//       (隐私红线 AGENTS.md §5.4). 日志只出 id / 轮次 / 维度名 / 状态.
//
//   如何验证:
//     1. npx tsc -p tsconfig.build.json --noEmit 0 错
//     2. test/engine-adapters/r9-deliberation-hook.spec.ts 覆盖两拍分离 / 四层兜底 /
//        稀疏补丁语义 / 过期判定 / 模式三态 / 灰度名单
//     3. `git diff --stat HEAD -- src/engine-core` 只含端口文件 + turn() 钩子 + barrel

import { Logger } from '@nestjs/common';

import type { DeliberationModeConfig } from './deliberation-mode.config.js';
import { isLlmDeliberationActiveForSession } from './deliberation-mode.config.js';
import { DELIBERATION_DIMS } from './deliberation-types.js';
import type { BehaviorStrategy, DeliberationDeltaPatch, DeliberationHookContext, DeliberationHookPort } from '../../engine-core/index.js';

/**
 * 产出拍需要的**适配层专属**上下文 (内核拿不到的那几样).
 *
 * ⚠️ **为什么不塞进内核端口的 context**:
 *     内核的 `DeliberationHookContext` 是**内核视角** (快照 / 规则 delta / 咨询师文本 /
 *     归属 / 轮次 / 版本号) —— 内核能拿到的就这些. 而审议 prompt 还需要"来访者本轮
 *     回应" / "角色背景" / "学员账号 id" / "本轮行为策略" —— 这四样**只有门面有**
 *     (门面是唯一同时握有渲染产物与归属登记的位置, 见 turn-render-orchestrator.ts).
 *     把它们塞进内核端口 = 让内核的契约长出它自己填不了的字段.
 *     所以内核端口保持纯, 适配层自己定义产出拍的入参.
 */
export interface DeliberationProduceExtras {
  /** 本轮来访者的渲染回应 (审议 prompt 的主要输入之一). */
  readonly visitorText: string;
  /** 角色种子简述 (依恋风格 + 大五人格). */
  readonly characterBrief: string;
  /** 学员账号 id (LLM 调用要求非空). */
  readonly userId: string;
  /** 本轮规则算子选中的行为策略 (意图锁定判定需要). */
  readonly ruleStrategy: BehaviorStrategy;
}

/**
 * 产出拍入参 (适配层口径).
 *
 * `context` 用的是**同一个**内核端口 context 类型 —— 但两拍的"视角"不同:
 *   · 消费拍 (内核问建议): context = 本轮**开始时**的快照与规则 delta;
 *   · 产出拍 (适配层跑审议): context = 本轮**结束时**的快照与规则 delta —— 也就是
 *     下一轮开始时内核会看到的那个状态.
 * 所以 `currentRevision` 在产出拍里 = 本轮落库后的版本 (R1), 在消费拍里 = 下一轮
 * 载入的版本 (= 同一个 R1) —— 两拍天然对齐, 状态被外力改过才会不等.
 */
export interface DeliberationProduceInput {
  readonly context: DeliberationHookContext;
  readonly extras: DeliberationProduceExtras;
}

/**
 * 跑一拍审议 (异步) → 返回**稀疏补丁**; `null` = 本轮没有可用建议.
 *
 * ⚠️ 端口**不承诺成功** —— 失败一律折成 `null`, 调用方 (钩子) 兜住并回退规则 delta.
 *
 * ⚠️ 为什么是**接口 + 方法**而不是函数类型:
 *   实现方是一个有名字的类 (`LlmDeliberationEffectiveRunner`) —— 用方法签名,
 *   实现类可以直接 `implements` 这个端口, 装配层传实例即可 (传函数的话,
 *   装配层就得自己写 `(input) => runner.run(input)` 这样的转接, 多一层壳).
 */
export interface DeliberationRunner {
  run(input: DeliberationProduceInput): Promise<DeliberationDeltaPatch | null>;
}

/**
 * 生效钩子的**窄面** (门面只依赖这一个方法).
 *
 * 为什么单独定一个窄面而不是直接依赖 `LlmDeliberationHook`:
 *   门面不该知道钩子的实现类 (它只需要"每轮结束后产出一拍建议"这件事).
 *   窄面 = 依赖倒置, 门面可以被别的实现替换 (例如测试里的假钩子).
 */
export interface DeliberationEffectPort {
  /**
   * 跑一拍审议 (异步, fire-and-forget) —— 结果写进缓存, 供**下一轮**取用.
   *
   * 失败只记 warn, 绝不上抛 (审议挂了不该炸会话).
   *
   * @param input 本轮产出拍上下文
   */
  produce(input: DeliberationProduceInput): Promise<void>;
}

/**
 * 缓存里一条审议建议.
 *
 * ⚠️ **只存"要落状态的那部分"** —— 维度 + 数值 + 算它时的快照版本号.
 *   不存 reason / summary / entries (那些是**观察面**的东西, 由影子模式的 trace 表管).
 *   理由: 生效路径的缓存是**决策输入**, 不是证据档案 —— 心理内容尽量不进这条通路.
 */
interface CachedDeliberationSuggestion {
  /** 稀疏补丁 (维度 → 增量值). */
  readonly patch: DeliberationDeltaPatch;
  /** 算出这份建议时的快照版本号 (过期判定用). */
  readonly baseRevision: number;
}

/**
 * 缓存的存活时间 (ms).
 *
 * ⚠️ **为什么是 2 分钟**:
 *     建议要在**下一轮**被取用, 所以必须活得比"一轮"长 (一轮对练 10-60 秒量级).
 *     但也不该活太久 —— 过了几轮才被取用的建议, 它的快照早过时了 (过期判定会丢),
 *     留着只是占内存. 2 分钟 = 足够覆盖正常对话节奏, 又不会攒一堆死数据.
 */
const SUGGESTION_TTL_MS = 120_000;

/**
 * LLM 审议生效钩子.
 *
 * 生命周期: **单例** (装配层注入内核会话端口) —— 内核会话端口本身是单例,
 * 钩子必须跟着是单例, 否则每轮拿到的会是不同实例 (缓存就散了).
 */
export class LlmDeliberationHook implements DeliberationHookPort, DeliberationEffectPort {
  private readonly logger = new Logger(LlmDeliberationHook.name);
  /** 会话 id → 最近一条可用建议. */
  private readonly suggestions = new Map<string, { readonly suggestion: CachedDeliberationSuggestion; readonly at: number }>();

  constructor(
    private readonly modeConfig: DeliberationModeConfig,
    /** 跑一次审议并返回稀疏补丁 (异步, fire-and-forget 的那一拍). */
    private readonly runner: DeliberationRunner,
    /**
     * 可注入时钟 (缺省 = `Date.now`) —— 单测要能验证 TTL 过期, 不能真等 2 分钟.
     *
     * 为什么是**构造注入**而不是模块级单槽: 与内核的 cap / 人格 / 同盟同款范式 ——
     * 时钟是**部署形态**的决定 (测试要固定它), 不该藏在模块级变量里.
     */
    private readonly now: () => number = Date.now,
  ) {}

  /**
   * 取本轮可用的审议建议 (内核**同步**调这里).
   *
   * 返回 `null` 的四种情形 (= 回退规则 delta):
   *   ① 本会话不在 LLM 生效模式 (影子 / 纯规则 / 名单外);
   *   ② 缓存里没有建议 (第 1 轮 / 上一拍失败 / 已过期);
   *   ③ 建议的快照版本已经过时 (过期判定);
   *   ④ 取建议的过程本身抛错 (防御).
   *
   * @param context 本轮上下文
   * @returns 稀疏补丁; `null` = 无建议
   */
  applyDeliberation(context: DeliberationHookContext): DeliberationDeltaPatch | null {
    try {
      if (!isLlmDeliberationActiveForSession(this.modeConfig, context.sessionId)) return null;
      const cached = this.takeSuggestion(context.sessionId);
      if (!cached) return null;
      // 过期判定: 建议算完时状态是 baseRevision 那个版本, 此刻内核报上来的是
      //   currentRevision —— 不相等 = 两拍之间状态被动过 (会话恢复 / 别的进程改了状态)
      //   → 建议已过时, 丢弃, 回退规则 delta.
      if (cached.suggestion.baseRevision !== context.currentRevision) {
        this.logger.warn(`[r9] 审议建议已过期, 回退规则 delta (session=${context.sessionId} turn=${context.turnIndex})`);
        return null;
      }
      // 建议取出即用掉 (下一轮不该再用同一份建议).
      this.suggestions.delete(context.sessionId);
      return cached.suggestion.patch;
    } catch (error) {
      // 防御: 取建议的任何意外都不能炸主流程.
      this.logger.warn(`[r9] 取审议建议异常, 回退规则 delta (session=${context.sessionId}): ${messageOf(error)}`);
      return null;
    }
  }

  /**
   * 跑一拍审议 (异步, fire-and-forget) —— 结果写进缓存, 供**下一轮**取用.
   *
   * 由门面在每轮渲染完成后调用. 失败只记 warn, 绝不上抛 (审议挂了不该炸会话).
   *
   * @param input 本轮产出拍上下文
   */
  async produce(input: DeliberationProduceInput): Promise<void> {
    const { context } = input;
    try {
      if (!isLlmDeliberationActiveForSession(this.modeConfig, context.sessionId)) return;
      const patch = await this.runner.run(input);
      // 空补丁 = 没有实质建议 → 不占缓存位 (下一轮直接当"没有建议").
      if (!patch || Object.keys(patch).length === 0) return;
      this.suggestions.set(context.sessionId, {
        suggestion: { patch, baseRevision: context.currentRevision },
        at: this.now(),
      });
      this.pruneExpired();
    } catch (error) {
      this.logger.warn(`[r9] 审议失败, 本轮不产生建议 (session=${context.sessionId}): ${messageOf(error)}`);
    }
  }

  /**
   * 取缓存里的建议 (顺带做 TTL 判定).
   *
   * @param sessionId 会话 id
   * @returns 建议; `null` = 没有
   */
  private takeSuggestion(sessionId: string): { readonly suggestion: CachedDeliberationSuggestion; readonly at: number } | null {
    const entry = this.suggestions.get(sessionId);
    if (!entry) return null;
    if (this.now() - entry.at > SUGGESTION_TTL_MS) {
      this.suggestions.delete(sessionId);
      return null;
    }
    return entry;
  }

  /** 清理过期条目 (TTL 判定在取用时也会做, 这里只是不让它无限攒). */
  private pruneExpired(): void {
    const now = this.now();
    for (const [sessionId, entry] of this.suggestions) {
      if (now - entry.at > SUGGESTION_TTL_MS) this.suggestions.delete(sessionId);
    }
  }
}

/**
 * 把审议模型给的**稀疏** delta 列表压成内核口径的稀疏补丁.
 *
 * ⚠️ **只保留合法维度** —— 内核的 `DeltaVector` 只有 11 个键, 塞别的键进去是类型错误.
 *   审议层的校验层 (WP66) 本该已经滤掉非法维度, 这里**再兜一道**:
 *   "适配层给内核的东西"必须在内核契约内 —— 边界要在**交接面**上守住, 不能指望上游.
 *
 * ⚠️ **同维度多条 → 取最后一条** (与 trace 口径 `buildSuccessRecord` 一致).
 *
 * @param entries 审议给出的 delta 建议列表 (已过格式校验与 cap)
 * @returns 稀疏补丁 (维度 → 增量值)
 */
export function toDeliberationDeltaPatch(
  entries: readonly { readonly dimension: string; readonly delta: number }[],
): DeliberationDeltaPatch {
  const patch: Record<string, number> = {};
  for (const entry of entries) {
    if (!isDeliberationDimension(entry.dimension)) continue;
    if (!Number.isFinite(entry.delta)) continue;
    patch[entry.dimension] = entry.delta;
  }
  return patch;
}

/**
 * 维度名是否合法 (审议维度白名单).
 *
 * ⚠️ 白名单从 `deliberation-types.ts` 的常量取 —— **不手写一份** (仓库纪律: 判定只有一份).
 *   内核那份 `DELTA_DIMENSIONS` 与审议那份 `DELIBERATION_DIMS` 逐字相等, 但适配层
 *   只认审议维度的**窄面** —— 消费方拿到的一定是合法审议维度, 不用再判一遍.
 */
function isDeliberationDimension(dimension: string): boolean {
  return (DELIBERATION_DIMS as readonly string[]).includes(dimension);
}

/** 取错误信息 (跨 unknown 边界的安全取法). */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
