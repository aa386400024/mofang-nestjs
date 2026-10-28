// V2026-10-28 治本 (WP2 · 引擎内核 · 冲突消解):
//   职责: 同一"主题"下的多条记忆只留存活者 —— 时间更新者优先, 同刻取重要度更高者,
//         其余标记 supersededBy (标记不删除), 冲突点记进 ConflictRecord 供审计.
//   边界: 纯函数, 无状态, 无 IO, 无随机. 不做语义聚类 (M5: topicKey 由写入方显式给).
//
//   为什么"显式 topicKey"而不是自动聚类:
//     语义聚类要向量 + 模型, 会把"记忆层"耦合成"模型层", 且聚类结果不可复现
//     (换模型就换分组). 显式 topicKey 由写入方给 —— 写入方最清楚两条记忆是不是
//     在讲同一件事, 且结果 100% 可复现、可测试.
//
//   为什么"标记不删除" (M4):
//     被取代的记忆是**审计线索** —— "曾经认为 A, 后来改成了 B" 本身就是信息.
//     删掉就只剩结论、丢了过程, 督导复盘与伦理审计都拿不到这层材料.
//
//   反双胞胎:
//     - 不用"最后写入者胜" —— 那取决于写入顺序而非事实新旧, 重放一次就翻转结论.
//     - 不在消解里直接改条目 —— 纯函数只给"谁活 / 谁被取代", 落库由调用方做.
//       纯函数里改对象 = 同一个 group 被两个调用方处理时互相踩.
//     - 不做"合并" —— 合并要模型判断, 本期只选存活者, 旧的原样留着.
//
//   如何验证:
//     1. pnpm build 0 错
//     2. test/engine-core/wp2-memory.spec.ts 覆盖: 时间优先 / 同刻取重要度 / supersededIds 输出

import { EngineCoreError, EngineErrorCode } from '../domain/engine-errors';
import type { MemoryEntry } from '../domain/ports/memory.store';

/**
 * 一条冲突记录 (供审计, 不删除旧条目).
 */
export interface ConflictRecord {
  /** 存活条目 id. */
  readonly survivorId: string;
  /** 被取代的条目 id 列表. */
  readonly supersededIds: readonly string[];
  /** 冲突分组键 (topicKey). */
  readonly topicKey: string;
}

/**
 * 冲突消解结果.
 */
export interface ConflictResolution {
  /** 存活条目 (调用方应确保它被落库). */
  readonly survivor: MemoryEntry;
  /** 被取代的条目 (已带 supersededBy 标记, 调用方应落库以让召回排除它们). */
  readonly superseded: readonly MemoryEntry[];
  /** 冲突点记录 (供审计 / 日志). */
  readonly conflicts: readonly ConflictRecord[];
}

/**
 * 同组 (同 tenant+visitor+topicKey) 内选存活者.
 *
 * 规则:
 *   1. occurredAt 更新者优先;
 *   2. occurredAt 相同 → importance 更高者存活;
 *   3. 仍相同 → id 字典序小者存活 (保证**确定性** —— 否则同输入不同输出,
 *      而"可复现"是引擎的硬需求).
 *
 * 纯函数, 不做任何 IO, 不做语义聚类.
 *
 * @param group 同一冲突组内的条目 (调用方保证同 tenant+visitor+topicKey)
 * @returns 存活条目 + 冲突点记录
 * @throws EngineCoreError code=INVALID_INPUT group 为空
 */
export function resolveConflict(group: readonly MemoryEntry[]): {
  readonly survivor: MemoryEntry;
  readonly conflicts: readonly ConflictRecord[];
} {
  if (group.length === 0) {
    throw new EngineCoreError(EngineErrorCode.INVALID_INPUT, 'resolveConflict: group 不能为空');
  }
  if (group.length === 1) {
    return { survivor: group[0], conflicts: [] };
  }

  const sorted = group.toSorted(compareForSurvival);
  const survivor = sorted[0];
  const supersededIds = sorted.slice(1).map((entry) => entry.id);
  const topicKey = survivor.topicKey ?? '';
  return {
    survivor,
    conflicts: [
      {
        survivorId: survivor.id,
        supersededIds,
        topicKey,
      },
    ],
  };
}

/**
 * 给一条记忆打上"已被取代"标记 (纯函数, 不改入参).
 *
 * @param entry 原条目
 * @param survivorId 取代它的存活条目 id
 * @returns 带 supersededBy 的新条目
 */
export function markSuperseded(entry: MemoryEntry, survivorId: string): MemoryEntry {
  return { ...entry, supersededBy: survivorId };
}

/**
 * 冲突消解 + 打标记 (组合纯函数).
 *
 * 写入方的标准用法:
 * ```
 * const { survivor, superseded, conflicts } = applyConflictResolution(group);
 * await store.remember(survivor);
 * for (const loser of superseded) await store.remember(loser);  // 带 supersededBy
 * log(conflicts);   // 冲突点进审计
 * ```
 *
 * @param group 同一冲突组内的条目
 * @returns 存活条目 + 已标记的被取代条目 + 冲突点记录
 * @throws EngineCoreError code=INVALID_INPUT group 为空
 */
export function applyConflictResolution(group: readonly MemoryEntry[]): ConflictResolution {
  const { survivor, conflicts } = resolveConflict(group);
  const superseded = group.filter((entry) => entry.id !== survivor.id).map((entry) => markSuperseded(entry, survivor.id));
  return { survivor, superseded, conflicts };
}

/**
 * 存活者比较器: 时间新 → 重要度高 → id 字典序小.
 *
 * 抽成独立函数是因为 resolveConflict 的"确定性"完全依赖它, 单测要能直接验它.
 */
function compareForSurvival(a: MemoryEntry, b: MemoryEntry): number {
  if (a.occurredAt !== b.occurredAt) return b.occurredAt - a.occurredAt;
  if (a.importance !== b.importance) return b.importance - a.importance;
  return a.id.localeCompare(b.id);
}
