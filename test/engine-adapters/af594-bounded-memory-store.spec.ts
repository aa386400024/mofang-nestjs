// AF-594: 有界工作记忆仓回归.
//
// 覆盖审计暴露的三类问题:
//   1. 单会话条目无上限 → 按 occurredAt 淘汰最旧;
//   2. 进程级会话无上限 → 按 lastAccessAt LRU 淘汰;
//   3. 会话关闭不释放 → forgetSession 清整桶 + 空闲 TTL 兜底.

import { BoundedInMemoryMemoryStore } from '../../src/engine-adapters/persistence/bounded-in-memory-memory.store.js';
import { MemorySource, MemoryTier, type MemoryEntry } from '../../src/engine-core/index.js';

const TENANT = 'tenant-a';
const SESSION = 'session-a';

function entry(overrides: Partial<MemoryEntry> = {}): MemoryEntry {
  return {
    tenantId: TENANT,
    id: 'm-1',
    sessionId: SESSION,
    tier: MemoryTier.WORKING,
    source: MemorySource.TURN,
    content: '来访者说最近睡不好',
    importance: 0.5,
    occurredAt: 1_700_000_000_000,
    ttlMs: null,
    ...overrides,
  };
}

function createStore(overrides: Partial<ConstructorParameters<typeof BoundedInMemoryMemoryStore>[0]> = {}): {
  store: BoundedInMemoryMemoryStore;
  advance: (ms: number) => void;
} {
  let clock = 1_700_000_000_000;
  const store = new BoundedInMemoryMemoryStore({ now: () => clock, ...overrides });
  return {
    store,
    advance: (ms: number) => {
      clock += ms;
    },
  };
}

describe('AF-594 · 有界工作记忆仓', () => {
  it('单会话超过上限时按 occurredAt 淘汰最旧', async () => {
    const { store } = createStore({ maxEntriesPerSession: 3 });
    for (let i = 0; i < 4; i += 1) {
      await store.remember(entry({ id: `m-${i}`, occurredAt: 1_700_000_000_000 + i * 1000 }));
    }

    const hits = await store.recall({ tenantId: TENANT, sessionId: SESSION, query: '睡', limit: 10 });
    expect(hits.map((hit) => hit.entry.id)).toEqual(['m-3', 'm-2', 'm-1']);
    expect(store.stats()).toEqual({ sessions: 1, entries: 3 });
  });

  it('会话数超过上限时按 lastAccessAt 淘汰最久未用', async () => {
    const { store, advance } = createStore({ maxSessions: 2, maxEntriesPerSession: 10 });
    await store.remember(entry({ sessionId: 's-1', id: 'a' }));
    advance(1000);
    await store.remember(entry({ sessionId: 's-2', id: 'b' }));
    advance(1000);
    await store.remember(entry({ sessionId: 's-3', id: 'c' }));

    expect(store.stats().sessions).toBe(2);
    const s1 = await store.recall({ tenantId: TENANT, sessionId: 's-1', query: '睡', limit: 10 });
    expect(s1).toEqual([]);
  });

  it('会话空闲超过 TTL 后整桶淘汰', async () => {
    const { store, advance } = createStore({ sessionIdleTtlMs: 60_000 });
    await store.remember(entry({ id: 'old' }));
    advance(61_000);

    const hits = await store.recall({ tenantId: TENANT, sessionId: SESSION, query: '睡', limit: 10 });
    expect(hits).toEqual([]);
    expect(store.stats().sessions).toBe(0);
  });

  it('forgetSession 只清目标会话, 不跨租户误删', async () => {
    const { store } = createStore();
    await store.remember(entry({ id: 'a' }));
    await store.remember(entry({ tenantId: 'tenant-b', id: 'b' }));

    store.forgetSession(TENANT, SESSION);

    expect(await store.recall({ tenantId: TENANT, sessionId: SESSION, query: '睡', limit: 10 })).toEqual([]);
    expect(store.stats()).toEqual({ sessions: 1, entries: 1 });
  });

  it('session 召回只看本会话, 不串其他会话', async () => {
    const { store } = createStore();
    await store.remember(entry({ sessionId: 's-1', id: 'in' }));
    await store.remember(entry({ sessionId: 's-2', id: 'out' }));

    const hits = await store.recall({ tenantId: TENANT, sessionId: 's-1', query: '睡', limit: 10 });
    expect(hits.map((hit) => hit.entry.id)).toEqual(['in']);
  });

  it('条目默认 TTL 到期后不再召回', async () => {
    const { store, advance } = createStore({ defaultEntryTtlMs: 60_000 });
    await store.remember(entry({ id: 'ttl', ttlMs: undefined }));
    advance(61_000);

    expect(await store.recall({ tenantId: TENANT, sessionId: SESSION, query: '睡', limit: 10 })).toEqual([]);
  });
});
