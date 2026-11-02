// V2026-10-28 治本 (WP2 · 引擎内核 · 重要度衰减):
//   职责: 记忆遗忘机制的**降权**部分 —— 随时间推移, 重要度按指数半衰期衰减,
//         衰减到阈值以下的条目不再被召回.
//   边界: 纯函数, 无状态, 无 IO, 无随机. 不删数据, 只降权 (M4: 遗忘只降权不物理删).
//
//   为什么"只降权不删除":
//     真实人的记忆不是被擦除, 而是**提取不出来**. 物理删除会同时丢掉
//     "曾经发生过这件事"这个事实 —— 而这恰恰是督导复盘、伦理审计要用的.
//     降权 + 阈值召回, 在"记不清"与"查得到"之间取到了正确平衡.
//
//   反双胞胎:
//     - 不用"线性衰减" —— 线性衰减在长尾区间趋于 0 但前期下降过快,
//       半衰期衰减在"半衰期处恰好减半"这个可解释锚点上更直观, 便于按业务校准.
//     - 不在衰减里做"提升" —— 再次被提到的事实应该由写入方**重新写入**并给高重要度,
//       而不是靠衰减函数记住"它以前被提过" (那是另一套机制, 本期不做).
//     - 不把半衰期硬编在调用点 —— 集中为常量, 校准时只改一处.
//
//   ⚠️ 参数标定说明 (工程种子值, 非标定):
//     DEFAULT_DECAY_HALF_LIFE_MS = 30 天, RECALL_MIN_EFFECTIVE_IMPORTANCE = 0.1.
//     这两个数字是**工程种子**, 后期靠真实训练数据校准, 不是临床结论.
//     它们的形状是对的 (半衰期可解释 / 阈值可解释), 值待数据说话.
//
//   如何验证:
//     1. pnpm build 0 错
//     2. test/engine-core/wp2-memory.spec.ts 覆盖: 单调不增 / 半衰期减半 / clamp [0,1]

import { EngineCoreError, EngineErrorCode } from '../domain/engine-errors';
import type { MemoryEntry } from '../domain/ports/memory.store';

/**
 * 默认半衰期 (工程种子值, 30 天, 待真实数据校准; 集中为常量便于调).
 */
export const DEFAULT_DECAY_HALF_LIFE_MS = 30 * 24 * 3600 * 1000;

/**
 * 召回用有效重要度阈值: 衰减后低于该值的条目不召回.
 *
 * 含义: 一条 importance=1.0 的记忆, 衰减到 0.1 大约需要 3.3 个半衰期 (约 100 天);
 * importance=0.5 的记忆约 2.3 个半衰期 (约 69 天) 后不再进入召回.
 */
export const RECALL_MIN_EFFECTIVE_IMPORTANCE = 0.1;

/** 夹到 [0,1]. */
function clamp01(value: number): number {
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

/**
 * 重要度时间衰减: importance * 2^(-ageMs/halfLifeMs).
 *
 * 性质:
 *   - age 越大结果越小 (单调不增);
 *   - age = halfLife 时恰好减半;
 *   - age = 0 时结果 = importance;
 *   - 结果恒在 [0,1].
 *
 * @param importance 原始重要度 [0,1] (超出范围先夹紧)
 * @param ageMs 距事件发生的时间 (ms); 负数按 0 处理 (时钟偏移 / 未来时间戳)
 * @param halfLifeMs 半衰期 (ms); 省略取默认 30 天
 * @returns 衰减后的有效重要度 [0,1]
 * @throws EngineCoreError code=INVALID_INPUT halfLifeMs 非正数
 */
export function decayImportance(importance: number, ageMs: number, halfLifeMs: number = DEFAULT_DECAY_HALF_LIFE_MS): number {
  if (!Number.isFinite(halfLifeMs) || halfLifeMs <= 0) {
    throw new EngineCoreError(EngineErrorCode.INVALID_INPUT, `decayImportance: halfLifeMs 必须是正有限数, 收到 ${halfLifeMs}`);
  }
  const base = clamp01(importance);
  const age = Math.max(0, ageMs);
  const factor = Math.pow(2, -age / halfLifeMs);
  return clamp01(base * factor);
}

/**
 * 召回用有效重要度 = 衰减后的 importance.
 *
 * @param entry 记忆条目
 * @param now 当前时刻 (ms)
 * @param halfLifeMs 半衰期 (ms); 省略取默认
 * @returns 有效重要度 [0,1]
 */
export function effectiveImportance(entry: MemoryEntry, now: number, halfLifeMs: number = DEFAULT_DECAY_HALF_LIFE_MS): number {
  return decayImportance(entry.importance, now - entry.occurredAt, halfLifeMs);
}
