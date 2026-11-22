// V2026-10-28 治本 (WP2 · 引擎内核 · 共享召回策略):
//   职责: 定义"一条候选记忆能不能被召回"的**唯一判定口径**, 以及用于排序的
//         有效重要度. 内存版 (src/engine-core/in-memory/) 与 Qdrant 版
//         (src/engine-adapters/persistence/) **必须**共用它.
//   边界: 纯函数, 无状态, 无 IO, 无随机.
//
//   为什么必须共享 (本文件存在的全部理由):
//     同一个内核代码, 换一套存储实现后**行为不能变** —— 这是 engine-core 的第一性原则.
//     若内存版按"原始 importance 过滤"、Qdrant 版按"衰减后 importance 过滤",
//     那么开发期测出来的召回结果在生产环境会**不一样**, 而且这种漂移极难查:
//     单测全绿, 线上召回为空, 最后才被发现是两个实现各写了一套判定.
//     把判定抽成纯函数, 两版实现共用, 漂移在结构上就不可能发生.
//
//   ⚠️ 与任务单 §3.1 的目录差异:
//     任务单列了 memory/ 下 4 个文件; 本文件是**第 5 个**. 理由: 召回判定必须
//     只有一份, 而它跨内核实现与 B 层实现, 塞进任何一个既有文件都会让那个文件
//     同时承担"策略"与"判定"两种职责. 独立成文件是最小代价的治本做法.
//
//   判定规则 (按顺序短路):
//     1. 租户不匹配 → 拒绝;
//     2. 范围不匹配 (session: 会话不匹配 / visitor: 来访者不匹配) → 拒绝;
//     3. 已过期 → 拒绝;
//     4. 已被取代 (supersededBy 非空) → 拒绝;
//     5. 分层过滤不通过 → 拒绝;
//     6. scope=visitor 但不是长时 → 拒绝 (跨会话只召回长时);
//     7. 有效重要度低于阈值 (仅 visitor 范围; 阈值可注入, 省略 = 内核默认 0.1) → 拒绝;
//     8. 低于调用方 minImportance → 拒绝.
//
//   V2026-11-04 治本 (WP59 · 召回策略配置端口统一):
//     半衰期与阈值两个**工程种子值**原先硬编在本文件里, 后果有三:
//       ① 调参要改代码发版 (这两个数是工程种子, 不是临床结论);
//       ② Qdrant 版只能在 B 层"双层判定" (内核卡一道 + B 层再卡一道 = 取交集),
//          两份判定迟早漂移 —— 内核改了规则 B 层不知道;
//       ③ 内存版连配置口都没有 → 开发期 (内存版) 与生产 (Qdrant 版) 召回结果可能不同.
//     本期把两个值改成**可选端口注入**: `evaluateRecallCandidate` 加第 5 个可选参
//     `RecallPolicyOptions`, 省略 = 用内核默认值 = 行为与加参数前**逐字一致** (零回归).
//     **配置值是"覆盖默认值", 不是"绕过地板"** —— 内核常量仍是缺省回退,
//     与 `DeltaCapConfig` 同款端口注入模式 (内核不读 env, 由装配层读好后传入).
//
//   如何验证:
//     1. pnpm build 0 错
//     2. test/engine-core/wp2-memory.spec.ts 覆盖各条拒绝路径与有效重要度口径

import { DEFAULT_DECAY_HALF_LIFE_MS, effectiveImportance, RECALL_MIN_EFFECTIVE_IMPORTANCE } from './importance-decay.js';
import { MemoryTier, type MemoryEntry, type MemoryRecallQuery } from '../domain/ports/memory.store.js';

/**
 * 召回候选的判定结果.
 */
export interface RecallEvaluation {
  /** 是否可召回. */
  readonly accepted: boolean;
  /**
   * 用于排序的有效重要度.
   *
   * 口径随范围而变 (与 MemoryRecallQuery.minImportance 的口径一致):
   *   - scope='session' → 条目原始 importance (WP0 行为, 不引入衰减);
   *   - scope='visitor' → 衰减后的有效重要度 (长时召回问的是"现在还重要吗").
   */
  readonly effectiveImportance: number;
}

/** 拒绝结果 (常量复用, 避免每次判定都造对象). */
const REJECTED: RecallEvaluation = { accepted: false, effectiveImportance: 0 };

/**
 * 召回策略配置 (WP59 · 可选端口注入).
 *
 * 两个字段**都可选**: 调用方可以只覆盖其中一个, 另一个回落到内核默认值.
 * 省略整个参数 = 全部用内核默认值 = 行为与本函数加参数前**逐字一致** (零回归).
 *
 * ⚠️ 口径: 这是"**覆盖默认值**", 不是"绕过地板" —— 内核常量
 * (`DEFAULT_DECAY_HALF_LIFE_MS` / `RECALL_MIN_EFFECTIVE_IMPORTANCE`) 仍是缺省回退.
 * 与 `DeltaCapConfig` 同款端口注入模式: 内核自己不读 env, 由装配层读好后传进来.
 */
export interface RecallPolicyOptions {
  /**
   * 重要度衰减半衰期 (ms).
   * 省略 = 用内核默认值 (30 天).
   */
  readonly halfLifeMs?: number;
  /**
   * 访客范围召回的最小有效重要度 [0,1].
   * 省略 = 用内核默认值 (0.1).
   */
  readonly minEffectiveImportance?: number;
}

/** 召回策略配置解析结果 (内核内部用). */
interface ResolvedRecallPolicy {
  /** 重要度衰减半衰期 (ms). */
  readonly halfLifeMs: number;
  /** 访客范围召回的最小有效重要度 [0,1]. */
  readonly minEffectiveImportance: number;
}

/**
 * 解析召回策略配置: 省略的字段回落到内核默认值 (WP59).
 *
 * 抽成 helper 而不是内联两个 `??`: `evaluateRecallCandidate` 的圈复杂度已经贴着
 * eslint 上限 (20), 内联再加两个分支就越线 —— 抽 helper 让判定函数本体保持可读.
 */
function resolveRecallPolicy(options: RecallPolicyOptions): ResolvedRecallPolicy {
  return {
    halfLifeMs: options.halfLifeMs ?? DEFAULT_DECAY_HALF_LIFE_MS,
    minEffectiveImportance: options.minEffectiveImportance ?? RECALL_MIN_EFFECTIVE_IMPORTANCE,
  };
}

/**
 * 判定一条候选记忆能否被召回, 并给出排序用的有效重要度 (纯函数).
 *
 * @param entry 候选条目
 * @param expiresAt 绝对过期时刻 (ms); null = 永不过期
 * @param query 召回条件
 * @param now 当前时刻 (ms)
 * @param options 召回策略配置 (WP59); 省略 = 用内核默认值 = 行为与加参数前逐字一致
 * @returns 判定结果
 */
export function evaluateRecallCandidate(
  entry: MemoryEntry,
  expiresAt: number | null,
  query: MemoryRecallQuery,
  now: number,
  options: RecallPolicyOptions = {},
): RecallEvaluation {
  // 1. 租户隔离 —— 任何范围下都先卡死, 跨租户是零容忍项.
  if (entry.tenantId !== query.tenantId) return REJECTED;

  // 2. 范围归属.
  if (query.scope === 'visitor') {
    if (!query.visitorId || entry.visitorId !== query.visitorId) return REJECTED;
  } else if (entry.sessionId !== query.sessionId) {
    return REJECTED;
  }

  // 3. 过期.
  if (expiresAt !== null && expiresAt <= now) return REJECTED;

  // 4. 被取代的记忆不参与召回 (标记不删除, 但不再被提取).
  if (entry.supersededBy !== undefined && entry.supersededBy !== null) return REJECTED;

  // 5. 分层过滤.
  if (query.tiers && !query.tiers.includes(entry.tier)) return REJECTED;

  // 6. 跨会话只召回长时.
  if (query.scope === 'visitor' && entry.tier !== MemoryTier.LONG_TERM) return REJECTED;

  // 7/8. 有效重要度 (阈值与半衰期走注入; 省略 = 内核默认值).
  const policy = resolveRecallPolicy(options);
  const effective = query.scope === 'visitor' ? effectiveImportance(entry, now, policy.halfLifeMs) : entry.importance;
  if (query.scope === 'visitor' && effective < policy.minEffectiveImportance) return REJECTED;
  if (query.minImportance !== undefined && effective < query.minImportance) return REJECTED;

  return { accepted: true, effectiveImportance: effective };
}
