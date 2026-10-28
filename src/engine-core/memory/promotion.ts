// V2026-10-28 治本 (WP2 · 引擎内核 · 短时→长时晋升):
//   职责: 把一条短时记忆**派生**为长时记忆 (纯函数, 不落库).
//         派生 = tier 改写 + TTL 转永久 + 继承 visitorId + 换新 id.
//   边界: 纯函数, 无状态, 无 IO.
//
//   为什么不把晋升塞进 closeSession (M8):
//     `closeSession(handleId): void` 是**同步、幂等、不做持久化**的端口契约 ——
//     把它改成异步 = 破坏已发布契约; 把仓储写塞进去 = 让同步关闭路径去等 I/O,
//     关闭时延不可控, 且失败时"会话关不掉".
//     所以: 关闭只释放运行时句柄; 落库由**会话结束编排层 (B 层)** 负责 ——
//     它先取本场 SHORT_TERM, 逐条调本函数派生, 再异步 remember 落长时.
//
//   反双胞胎:
//     - 不在函数里写仓储 —— 纯函数不碰 IO, 落库时机由编排层决定 (可重试/可批量).
//     - 不改原条目 —— 短时条目仍留在仓储里供本场复盘; 晋升是"派生", 不是"搬走".
//     - 不把工作记忆也升上来 —— 工作记忆是咨询师原话, 升成长时等于把会话内瞬时
//       数据变成跨会话可检索事实 (隐私面), 且与三级记忆语义冲突. 越级晋升直接拒.
//     - 不复用原 id —— 长时与短时同 id 会让"后写为准"的幂等规则把短时条目覆盖掉.
//
//   如何验证:
//     1. pnpm build 0 错
//     2. test/engine-core/wp2-memory.spec.ts 覆盖: tier/ttl/字段保留/新 id/不改原条目/越级拒

import { EngineCoreError, EngineErrorCode } from '../domain/engine-errors';
import { MemoryTier, type MemoryEntry } from '../domain/ports/memory.store';

/**
 * 把一条短时条目派生为长时条目 (纯函数, 不写仓储).
 *
 * 派生规则:
 *   - tier        → LONG_TERM
 *   - ttlMs       → null (永久; 长时记忆不靠 TTL 过期, 靠衰减降权)
 *   - id          → makeId() 生成新 id (与短时条目并存, 不覆盖)
 *   - visitorId   → 继承 (长时记忆的跨会话归属键)
 *   - occurredAt / importance / content / topicKey / tenantId / sessionId / source 保留
 *
 * @param entry 待晋升的短时条目
 * @param visitorId 长时记忆的稳定来访者标识
 * @param makeId 新 id 工厂 (由调用方注入, 便于确定性测试)
 * @returns 派生出的长时条目 (原条目不被修改)
 * @throws EngineCoreError code=INVALID_INPUT entry 不是 SHORT_TERM / visitorId 为空 / makeId 返回空
 */
export function promoteShortTermToLongTerm(entry: MemoryEntry, visitorId: string, makeId: () => string): MemoryEntry {
  if (entry.tier !== MemoryTier.SHORT_TERM) {
    throw new EngineCoreError(EngineErrorCode.INVALID_INPUT, `promoteShortTermToLongTerm: 只能晋升短时条目, 收到 tier=${entry.tier}`, {
      id: entry.id,
      tier: entry.tier,
    });
  }
  if (!visitorId) {
    throw new EngineCoreError(EngineErrorCode.INVALID_INPUT, 'promoteShortTermToLongTerm: visitorId 不能为空', { id: entry.id });
  }
  const id = makeId();
  if (!id) {
    throw new EngineCoreError(EngineErrorCode.INVALID_INPUT, 'promoteShortTermToLongTerm: makeId 必须返回非空 id', { id: entry.id });
  }
  return {
    ...entry,
    id,
    tier: MemoryTier.LONG_TERM,
    ttlMs: null,
    visitorId,
  };
}
