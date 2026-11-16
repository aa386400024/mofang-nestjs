// V2026-10-28 治本 (WP2 · 引擎内核 · 分层记忆 V1 单测):
//   覆盖任务单 §8 内核清单 1-8:
//     1. trimWorkingWindow (超窗丢最旧 / 不足原样 / 不改入参)
//     2. decayImportance / effectiveImportance (单调不增 / 半衰期减半 / clamp / 阈值)
//     3. resolveConflict (时间更新优先 / 同刻取重要度 / supersededIds)
//     4. scope=session 行为与 WP0 一致
//     5. scope=visitor 隔离 (不串会话 / 不串 visitor / 不串租户 / 只召回长时)
//     6. TTL 过期不召回 / limit clamp / minImportance 过滤
//     7. promoteShortTermToLongTerm 纯函数语义
//     8. resume 首论 openingContext 携带长时记忆, 且不改动 BDI 快照、不含口语
//   外加: 冲突消解闭环 (标记 → 写回 → 不再召回) 与端口校验分支.
//
//   反依赖污染:
//     本文件**不 import 任何 @nestjs/* / typeorm / qdrant** —— 它是内核边界的
//     一部分, 全部依赖是内核自己的纯 TS 实现.
//
//   验证: npx jest test/engine-core/wp2-memory.spec.ts
//   时间戳: 2026-10-28 GMT+8

import { InMemoryBdiStateRepository } from '../../src/engine-core/in-memory/in-memory-bdi-state.repository.js';
import { InMemoryEngineSession } from '../../src/engine-core/in-memory/in-memory-engine-session.js';
import { InMemoryMemoryStore } from '../../src/engine-core/in-memory/in-memory-memory.store.js';
import {
  DEFAULT_DECAY_HALF_LIFE_MS,
  EngineErrorCode,
  MemorySource,
  MemoryTier,
  RECALL_MIN_EFFECTIVE_IMPORTANCE,
  applyConflictResolution,
  createEmptyBdiSnapshot,
  decayImportance,
  effectiveImportance,
  evaluateRecallCandidate,
  markSuperseded,
  promoteShortTermToLongTerm,
  resolveConflict,
  trimWorkingWindow,
  WORKING_MEMORY_WINDOW_TURNS,
  type MemoryEntry,
} from '../../src/engine-core/index.js';

const TENANT = 'default';
const VISITOR = 'visitor-1';

/** 测试台: 内存实现 + 确定性 id / **共享**时钟. */
interface Harness {
  readonly bdiStates: InMemoryBdiStateRepository;
  readonly memories: InMemoryMemoryStore;
  readonly session: InMemoryEngineSession;
  /** 推进测试时钟 (ms). */
  advance: (ms: number) => void;
  /** 当前时刻. */
  currentTime: () => number;
}

/**
 * 时钟必须同时注入 session 与 memory store.
 *
 * WP0 实测踩过的坑: 只给 session 注入假时钟, store 退回真实 Date.now(),
 * 于是 "advance 让 TTL 到期" 这类断言会假失败 —— store 看到的"现在"根本没动过.
 */
function createHarness(): Harness {
  const bdiStates = new InMemoryBdiStateRepository();
  let idSeq = 0;
  let clock = 1_700_000_000_000;
  const now = (): number => clock;
  const memories = new InMemoryMemoryStore({ now });
  const session = new InMemoryEngineSession({
    bdiStates,
    memories,
    idFactory: () => {
      idSeq += 1;
      return `wp2-id-${idSeq}`;
    },
    now,
  });
  return {
    bdiStates,
    memories,
    session,
    advance: (ms: number) => {
      clock += ms;
    },
    currentTime: now,
  };
}

/** 造一条长时记忆 (长时必带 visitorId). */
function longTermEntry(overrides: Partial<MemoryEntry> = {}): MemoryEntry {
  return {
    tenantId: TENANT,
    id: 'lt-1',
    sessionId: 'session-a',
    visitorId: VISITOR,
    tier: MemoryTier.LONG_TERM,
    source: MemorySource.SUMMARY,
    content: '来访者长期提到失眠与工作压力',
    importance: 0.9,
    occurredAt: 1_700_000_000_000,
    ttlMs: null,
    ...overrides,
  };
}

describe('WP2 · 分层记忆 V1', () => {
  describe('① trimWorkingWindow — 工作记忆窗口', () => {
    it('超过 8 轮丢弃最旧的', () => {
      const lines = Array.from({ length: 12 }, (_, i) => `第 ${i} 轮`);
      const trimmed = trimWorkingWindow(lines);
      expect(trimmed).toHaveLength(WORKING_MEMORY_WINDOW_TURNS);
      expect(trimmed[0]).toBe('第 4 轮');
      expect(trimmed.at(-1)).toBe('第 11 轮');
    });

    it('不足 8 轮原样返回', () => {
      const lines = ['a', 'b', 'c'];
      expect(trimWorkingWindow(lines)).toEqual(['a', 'b', 'c']);
    });

    it('不改入参 (返回新数组)', () => {
      const lines = Array.from({ length: 12 }, (_, i) => `第 ${i} 轮`);
      const snapshot = [...lines];
      const trimmed = trimWorkingWindow(lines);
      expect(lines).toEqual(snapshot);
      expect(trimmed).not.toBe(lines);
    });

    it('n 可覆盖, n=0 清空窗口', () => {
      expect(trimWorkingWindow(['a', 'b', 'c'], 2)).toEqual(['b', 'c']);
      expect(trimWorkingWindow(['a', 'b'], 0)).toEqual([]);
    });

    it('会话运行时窗口只保留最近 8 轮', async () => {
      const harness = createHarness();
      const handle = harness.session.openSession({ sessionId: 's-1', tenantId: TENANT, visitorId: VISITOR });
      for (let i = 0; i < 10; i += 1) {
        await harness.session.turn(handle.handleId, { userText: `第 ${i} 轮` });
      }
      const window = harness.session.workingContext(handle.handleId);
      expect(window).toHaveLength(WORKING_MEMORY_WINDOW_TURNS);
      expect(window[0]).toBe('第 2 轮');
    });
  });

  describe('② 重要度衰减', () => {
    it('单调不增 (年龄越大值越小)', () => {
      const values = [0, 1000, 10_000, 100_000, 1_000_000].map((age) => decayImportance(1, age));
      for (let i = 1; i < values.length; i += 1) {
        expect(values[i]).toBeLessThanOrEqual(values[i - 1]);
      }
    });

    it('半衰期处恰好减半', () => {
      expect(decayImportance(1, DEFAULT_DECAY_HALF_LIFE_MS)).toBeCloseTo(0.5, 10);
      expect(decayImportance(0.8, DEFAULT_DECAY_HALF_LIFE_MS)).toBeCloseTo(0.4, 10);
    });

    it('age=0 不衰减, 结果 clamp [0,1]', () => {
      expect(decayImportance(0.6, 0)).toBeCloseTo(0.6, 10);
      expect(decayImportance(5, 0)).toBe(1);
      expect(decayImportance(-1, 0)).toBe(0);
    });

    it('负年龄按 0 处理 (时钟偏移不放大重要度)', () => {
      expect(decayImportance(0.6, -10_000)).toBeCloseTo(0.6, 10);
    });

    it('effectiveImportance 用条目时间算年龄', () => {
      const entry = longTermEntry({ importance: 0.8, occurredAt: 1000 });
      const now = 1000 + DEFAULT_DECAY_HALF_LIFE_MS;
      expect(effectiveImportance(entry, now)).toBeCloseTo(0.4, 10);
    });

    it('衰减到阈值以下的条目判为不召回', () => {
      const entry = longTermEntry({ importance: 0.5, occurredAt: 1000 });
      const now = 1000 + 10 * DEFAULT_DECAY_HALF_LIFE_MS;
      const evaluation = evaluateRecallCandidate(
        entry,
        null,
        {
          tenantId: TENANT,
          sessionId: 'session-a',
          query: 'x',
          scope: 'visitor',
          visitorId: VISITOR,
        },
        now,
      );
      expect(evaluation.accepted).toBe(false);
      expect(evaluation.effectiveImportance).toBeLessThan(RECALL_MIN_EFFECTIVE_IMPORTANCE);
    });
  });

  describe('③ 冲突消解', () => {
    const group = (): MemoryEntry[] => [
      longTermEntry({ id: 'old', topicKey: 'insomnia', occurredAt: 1000, importance: 0.9 }),
      longTermEntry({ id: 'new', topicKey: 'insomnia', occurredAt: 2000, importance: 0.5 }),
    ];

    it('时间更新者存活', () => {
      const { survivor, conflicts } = resolveConflict(group());
      expect(survivor.id).toBe('new');
      expect(conflicts).toHaveLength(1);
      expect(conflicts[0]?.survivorId).toBe('new');
      expect(conflicts[0]?.supersededIds).toEqual(['old']);
      expect(conflicts[0]?.topicKey).toBe('insomnia');
    });

    it('同一时刻取重要度更高者存活', () => {
      const { survivor } = resolveConflict([
        longTermEntry({ id: 'a', topicKey: 'k', occurredAt: 5000, importance: 0.3 }),
        longTermEntry({ id: 'b', topicKey: 'k', occurredAt: 5000, importance: 0.8 }),
      ]);
      expect(survivor.id).toBe('b');
    });

    it('完全同刻同重要度时按 id 判定 (确定性)', () => {
      const first = resolveConflict([
        longTermEntry({ id: 'aaa', topicKey: 'k', occurredAt: 5000, importance: 0.5 }),
        longTermEntry({ id: 'bbb', topicKey: 'k', occurredAt: 5000, importance: 0.5 }),
      ]).survivor.id;
      const second = resolveConflict([
        longTermEntry({ id: 'bbb', topicKey: 'k', occurredAt: 5000, importance: 0.5 }),
        longTermEntry({ id: 'aaa', topicKey: 'k', occurredAt: 5000, importance: 0.5 }),
      ]).survivor.id;
      expect(first).toBe(second);
      expect(first).toBe('aaa');
    });

    it('单条分组无冲突记录', () => {
      const { survivor, conflicts } = resolveConflict([longTermEntry({ id: 'solo' })]);
      expect(survivor.id).toBe('solo');
      expect(conflicts).toEqual([]);
    });

    it('空分组抛 INVALID_INPUT', () => {
      expect(() => resolveConflict([])).toThrow();
    });

    it('markSuperseded 标记后不再被召回 (标记不删除, 数据仍在)', async () => {
      const harness = createHarness();
      // 时间戳贴着测试时钟 (now = 1_700_000_000_000): 访客范围会叠加重要度衰减,
      // 若用 1000 这种"远古"时间戳, 有效重要度会被衰减到阈值以下而被滤掉,
      // 断言就变成"因为衰减没了"而不是"因为被标记了" —— 测的就不是本条用例想测的东西.
      const older = longTermEntry({ id: 'old', topicKey: 'insomnia', occurredAt: harness.currentTime() - 60_000, importance: 0.9 });
      const newer = longTermEntry({ id: 'new', topicKey: 'insomnia', occurredAt: harness.currentTime(), importance: 0.5 });
      await harness.memories.remember(older);
      await harness.memories.remember(newer);

      const { survivor, superseded, conflicts } = applyConflictResolution([older, newer]);
      expect(survivor.id).toBe('new');
      expect(superseded).toHaveLength(1);
      expect(superseded[0]?.supersededBy).toBe('new');
      expect(conflicts).toHaveLength(1);

      // 写回标记 (编排层动作).
      await harness.memories.remember(superseded[0]);

      const hits = await harness.memories.recall({
        tenantId: TENANT,
        sessionId: 'session-a',
        query: 'x',
        scope: 'visitor',
        visitorId: VISITOR,
      });
      expect(hits.map((hit) => hit.entry.id)).toEqual(['new']);
    });

    it('markSuperseded 不改原条目', () => {
      const entry = longTermEntry({ id: 'x' });
      const marked = markSuperseded(entry, 'y');
      expect(marked.supersededBy).toBe('y');
      expect(entry.supersededBy).toBeUndefined();
    });
  });

  describe('④ scope=session 行为与 WP0 一致', () => {
    it('不带新字段 (无 visitorId / scope) 仍按租户+会话召回', async () => {
      const harness = createHarness();
      await harness.memories.remember(longTermEntry({ id: 'm-1', sessionId: 'session-a' }));
      await harness.memories.remember(longTermEntry({ id: 'm-2', sessionId: 'session-b' }));
      const hits = await harness.memories.recall({ tenantId: TENANT, sessionId: 'session-a', query: 'x' });
      expect(hits).toHaveLength(1);
      expect(hits[0]?.entry.id).toBe('m-1');
    });

    it('session 范围不叠加衰减 (有效重要度 = 原始 important)', async () => {
      const harness = createHarness();
      // 极老 + 低重要度: visitor 范围会被衰减阈值淘汰, session 范围不衰减.
      await harness.memories.remember(longTermEntry({ id: 'ancient', sessionId: 'session-a', importance: 0.2, occurredAt: 1 }));
      const hits = await harness.memories.recall({ tenantId: TENANT, sessionId: 'session-a', query: 'x' });
      expect(hits).toHaveLength(1);
    });
  });

  describe('⑤ scope=visitor 跨会话召回与隔离', () => {
    it('只召回本租户+本来访者的长时记忆', async () => {
      const harness = createHarness();
      await harness.memories.remember(longTermEntry({ id: 'mine', visitorId: 'v-1' }));
      await harness.memories.remember(longTermEntry({ id: 'other-visitor', visitorId: 'v-2' }));
      await harness.memories.remember(longTermEntry({ id: 'other-tenant', tenantId: 'tenant-2', visitorId: 'v-1' }));

      const hits = await harness.memories.recall({
        tenantId: TENANT,
        sessionId: 'session-任意',
        query: 'x',
        scope: 'visitor',
        visitorId: 'v-1',
      });
      expect(hits).toHaveLength(1);
      expect(hits[0]?.entry.id).toBe('mine');
    });

    it('忽略 sessionId (跨会话能召回)', async () => {
      const harness = createHarness();
      await harness.memories.remember(longTermEntry({ id: 'lt', sessionId: 'session-旧' }));
      const hits = await harness.memories.recall({
        tenantId: TENANT,
        sessionId: 'session-新',
        query: 'x',
        scope: 'visitor',
        visitorId: VISITOR,
      });
      expect(hits).toHaveLength(1);
    });

    it('只召回长时 (工作/短时不进跨会话召回)', async () => {
      const harness = createHarness();
      await harness.memories.remember(longTermEntry({ id: 'w', tier: MemoryTier.WORKING, source: MemorySource.TURN, visitorId: VISITOR }));
      await harness.memories.remember(
        longTermEntry({ id: 's', tier: MemoryTier.SHORT_TERM, source: MemorySource.SUMMARY, visitorId: VISITOR }),
      );
      const hits = await harness.memories.recall({
        tenantId: TENANT,
        sessionId: 'session-a',
        query: 'x',
        scope: 'visitor',
        visitorId: VISITOR,
      });
      expect(hits).toHaveLength(0);
    });

    it('scope=visitor 缺 visitorId → INVALID_INPUT', async () => {
      const harness = createHarness();
      await expect(
        harness.memories.recall({ tenantId: TENANT, sessionId: 'session-a', query: 'x', scope: 'visitor' }),
      ).rejects.toMatchObject({ code: EngineErrorCode.INVALID_INPUT });
    });
  });

  describe('⑥ TTL / limit clamp / minImportance', () => {
    it('TTL 过期不召回', async () => {
      const harness = createHarness();
      await harness.memories.remember(longTermEntry({ id: 'ttl', ttlMs: 1000 }));
      expect(await harness.memories.recall({ tenantId: TENANT, sessionId: 'session-a', query: 'x' })).toHaveLength(1);
      harness.advance(1001);
      expect(await harness.memories.recall({ tenantId: TENANT, sessionId: 'session-a', query: 'x' })).toHaveLength(0);
    });

    it('limit clamp: 默认 5, 上限 50', async () => {
      const harness = createHarness();
      for (let i = 0; i < 60; i += 1) {
        await harness.memories.remember(longTermEntry({ id: `m-${i}`, sessionId: 'session-a' }));
      }
      expect(await harness.memories.recall({ tenantId: TENANT, sessionId: 'session-a', query: 'x' })).toHaveLength(5);
      expect(await harness.memories.recall({ tenantId: TENANT, sessionId: 'session-a', query: 'x', limit: 1000 })).toHaveLength(50);
    });

    it('minImportance 过滤 (visitor 范围按衰减后有效重要度)', async () => {
      const harness = createHarness();
      await harness.memories.remember(longTermEntry({ id: 'high', importance: 0.9 }));
      await harness.memories.remember(longTermEntry({ id: 'low', importance: 0.2 }));
      const hits = await harness.memories.recall({
        tenantId: TENANT,
        sessionId: 'session-a',
        query: 'x',
        scope: 'visitor',
        visitorId: VISITOR,
        minImportance: 0.5,
      });
      expect(hits.map((hit) => hit.entry.id)).toEqual(['high']);
    });

    it('长时记忆缺 visitorId → 仍可写入 (会话级长时), 但访客范围召不回', async () => {
      const harness = createHarness();
      const entry = longTermEntry();
      await expect(harness.memories.remember({ ...entry, visitorId: undefined })).resolves.toBeUndefined();
      // 会话范围照常召回 (WP0 语义不变).
      const sessionHits = await harness.memories.recall({ tenantId: TENANT, sessionId: 'session-a', query: 'x' });
      expect(sessionHits.map((hit) => hit.entry.id)).toEqual([entry.id]);
      // 访客范围不可见 —— 漏写 visitorId 的后果是"跨会话召不回", 不是"被别人召回".
      const visitorHits = await harness.memories.recall({
        tenantId: TENANT,
        sessionId: 'session-a',
        query: 'x',
        scope: 'visitor',
        visitorId: VISITOR,
      });
      expect(visitorHits).toHaveLength(0);
    });
  });

  describe('⑦ promoteShortTermToLongTerm 纯函数', () => {
    // 短时记忆的发生时刻贴着测试时钟 (now = 1_700_000_000_000):
    // 晋升后条目进入长时仓储, 访客范围召回会叠加重要度衰减 ——
    // 若时间戳是远古值, 衰减会把有效重要度打到阈值以下, 断言就测不到"晋升产物可召回".
    const SHORT_TERM_OCCURRED_AT = 1_700_000_000_000;
    const shortTerm: MemoryEntry = {
      tenantId: TENANT,
      id: 'st-1',
      sessionId: 'session-a',
      tier: MemoryTier.SHORT_TERM,
      source: MemorySource.SUMMARY,
      content: '本场关键事实',
      importance: 0.7,
      occurredAt: SHORT_TERM_OCCURRED_AT,
      topicKey: 'insomnia',
    };

    it('派生长时条目 (tier / ttl / visitorId / 新 id)', () => {
      const promoted = promoteShortTermToLongTerm(shortTerm, VISITOR, () => 'lt-new');
      expect(promoted.tier).toBe(MemoryTier.LONG_TERM);
      expect(promoted.ttlMs).toBeNull();
      expect(promoted.visitorId).toBe(VISITOR);
      expect(promoted.id).toBe('lt-new');
    });

    it('保留 content / importance / occurredAt / topicKey', () => {
      const promoted = promoteShortTermToLongTerm(shortTerm, VISITOR, () => 'lt-new');
      expect(promoted.content).toBe('本场关键事实');
      expect(promoted.importance).toBe(0.7);
      expect(promoted.occurredAt).toBe(SHORT_TERM_OCCURRED_AT);
      expect(promoted.topicKey).toBe('insomnia');
    });

    it('不改原条目', () => {
      promoteShortTermToLongTerm(shortTerm, VISITOR, () => 'lt-new');
      expect(shortTerm.tier).toBe(MemoryTier.SHORT_TERM);
      expect(shortTerm.id).toBe('st-1');
      expect(shortTerm.visitorId).toBeUndefined();
    });

    it('越级晋升 (工作记忆) 被拒', () => {
      const working: MemoryEntry = { ...shortTerm, tier: MemoryTier.WORKING };
      expect(() => promoteShortTermToLongTerm(working, VISITOR, () => 'x')).toThrow();
    });

    it('缺 visitorId 被拒', () => {
      expect(() => promoteShortTermToLongTerm(shortTerm, '', () => 'x')).toThrow();
    });

    it('晋升产物可直接落长时仓储', async () => {
      const harness = createHarness();
      const promoted = promoteShortTermToLongTerm(shortTerm, VISITOR, () => 'lt-promoted');
      await harness.memories.remember(promoted);
      const hits = await harness.memories.recall({
        tenantId: TENANT,
        sessionId: 'session-b',
        query: 'x',
        scope: 'visitor',
        visitorId: VISITOR,
      });
      expect(hits.map((hit) => hit.entry.id)).toEqual(['lt-promoted']);
    });
  });

  describe('⑧ 跨会话开场上下文 (resume 首论)', () => {
    it('首论携带上次高权重长时记忆, 且不含口语', async () => {
      const harness = createHarness();
      await harness.memories.remember(
        longTermEntry({ id: 'lt-prev', content: '上次提到持续失眠', importance: 0.9, occurredAt: harness.currentTime() }),
      );

      const handle = harness.session.openSession({
        sessionId: 'session-new',
        tenantId: TENANT,
        visitorId: VISITOR,
        resumeFromSessionId: 'session-old',
      });
      const output = await harness.session.turn(handle.handleId, { userText: '我们上次聊到哪了' });

      expect(output.openingContext).toBeDefined();
      expect(output.openingContext?.map((hit) => hit.entry.id)).toEqual(['lt-prev']);
      // 不含口语.
      expect(output.reply).toBe('');
    });

    it('非 resume 会话不带开场上下文', async () => {
      const harness = createHarness();
      await harness.memories.remember(longTermEntry({ id: 'lt', occurredAt: harness.currentTime() }));
      const handle = harness.session.openSession({ sessionId: 'session-fresh', tenantId: TENANT, visitorId: VISITOR });
      const output = await harness.session.turn(handle.handleId, { userText: '你好' });
      expect(output.openingContext).toBeUndefined();
    });

    it('只有首论携带 (后续轮次不重复召回)', async () => {
      const harness = createHarness();
      await harness.memories.remember(longTermEntry({ id: 'lt', occurredAt: harness.currentTime() }));
      const handle = harness.session.openSession({
        sessionId: 'session-new',
        tenantId: TENANT,
        visitorId: VISITOR,
        resumeFromSessionId: 'session-old',
      });
      await harness.session.turn(handle.handleId, { userText: '第一轮' });
      const second = await harness.session.turn(handle.handleId, { userText: '第二轮' });
      expect(second.openingContext).toBeUndefined();
    });

    it('开场上下文不改动 BDI 快照数值 (与无记忆场景快照完全一致)', async () => {
      const withMemory = createHarness();
      await withMemory.memories.remember(longTermEntry({ id: 'lt', importance: 0.9, occurredAt: withMemory.currentTime() }));
      const resumeHandle = withMemory.session.openSession({
        sessionId: 'session-resume',
        tenantId: TENANT,
        visitorId: VISITOR,
        seed: 42,
        resumeFromSessionId: 'session-old',
      });
      const resumeOutput = await withMemory.session.turn(resumeHandle.handleId, { userText: '我最近压力很大' });

      const withoutMemory = createHarness();
      const freshHandle = withoutMemory.session.openSession({
        sessionId: 'session-fresh',
        tenantId: TENANT,
        visitorId: VISITOR,
        seed: 42,
      });
      const freshOutput = await withoutMemory.session.turn(freshHandle.handleId, { userText: '我最近压力很大' });

      expect(resumeOutput.openingContext).toBeDefined();
      expect(resumeOutput.snapshot).toEqual(freshOutput.snapshot);
    });
  });

  // WP59 (2026-11-04) · 召回策略配置端口统一:
  //   半衰期与阈值两个工程种子值改成**可选端口注入** —— 不传 = 内核默认值 = 行为逐字不变,
  //   传了 = 配置值直接生效. 覆盖: 零回归 / 半衰期生效 / 阈值生效 / 只覆盖一个 /
  //   内存版 recallPolicy 端口生效.
  describe('⑨ WP59 · 召回策略配置端口统一', () => {
    const DAY_MS = 24 * 60 * 60 * 1000;
    const NOW = 1_700_000_000_000;
    /** 访客范围召回条件 (跨会话, 只召回长时). */
    const visitorQuery = {
      tenantId: TENANT,
      sessionId: 'session-a',
      query: 'x',
      scope: 'visitor',
      visitorId: VISITOR,
    } as const;

    /**
     * 造一条"十天前"的长时记忆 (importance=0.8).
     *
     * 期望值是**算出来的**, 不是拍脑袋的:
     *   - 默认半衰期 30 天 → 0.8 * 2^(-10/30) ≈ 0.6349604;
     *   - 半衰期 10 天     → 0.8 * 2^(-10/10) = 0.4.
     * 用例里把这三个数分得很开, 是为了让"参数没生效"和"阈值差一点"都变成**硬失败**,
     * 而不是靠容差糊过去.
     */
    const agedEntry = (): MemoryEntry => longTermEntry({ id: 'aged', importance: 0.8, occurredAt: NOW - 10 * DAY_MS });

    it('① 不传 options = 用内核默认值 (零回归: 与 4 参调用逐字一致)', () => {
      const entry = agedEntry();
      const withoutOptions = evaluateRecallCandidate(entry, null, visitorQuery, NOW);
      const withEmptyOptions = evaluateRecallCandidate(entry, null, visitorQuery, NOW, {});

      expect(withEmptyOptions).toEqual(withoutOptions);
      expect(withoutOptions.accepted).toBe(true);
      // 默认口径 = 内核默认半衰期算出来的有效重要度.
      expect(withoutOptions.effectiveImportance).toBeCloseTo(0.8 * Math.pow(2, -10 / 30), 10);
      expect(withoutOptions.effectiveImportance).toBeCloseTo(effectiveImportance(entry, NOW), 10);
    });

    it('② 传 halfLifeMs = 用配置值算有效重要度 (不是内核默认的 30 天)', () => {
      const entry = agedEntry();
      const evaluation = evaluateRecallCandidate(entry, null, visitorQuery, NOW, { halfLifeMs: 10 * DAY_MS });

      expect(evaluation.accepted).toBe(true);
      expect(evaluation.effectiveImportance).toBeCloseTo(0.4, 10);
      // 与默认口径明显不同 —— 否则这条用例是空转 (参数没生效也照样绿).
      expect(evaluation.effectiveImportance).not.toBeCloseTo(effectiveImportance(entry, NOW), 6);
    });

    it('③ 传 minEffectiveImportance = 用配置值卡阈值', () => {
      const entry = agedEntry();
      // 默认阈值 0.1 → 放行.
      expect(evaluateRecallCandidate(entry, null, visitorQuery, NOW).accepted).toBe(true);
      // 配置阈值 0.7 → 有效重要度 0.635 < 0.7 → 拒绝.
      expect(evaluateRecallCandidate(entry, null, visitorQuery, NOW, { minEffectiveImportance: 0.7 }).accepted).toBe(false);
      // 配置阈值 0.5 → 放行.
      expect(evaluateRecallCandidate(entry, null, visitorQuery, NOW, { minEffectiveImportance: 0.5 }).accepted).toBe(true);
    });

    it('④ 两个字段可以只覆盖一个 (另一个回落内核默认值)', () => {
      const entry = agedEntry();
      // 只给半衰期 → 阈值仍是内核默认 0.1 → 0.4 ≥ 0.1 → 放行.
      const onlyHalfLife = evaluateRecallCandidate(entry, null, visitorQuery, NOW, { halfLifeMs: 10 * DAY_MS });
      expect(onlyHalfLife.accepted).toBe(true);
      expect(onlyHalfLife.effectiveImportance).toBeCloseTo(0.4, 10);
      // 半衰期与阈值都给 → 0.4 < 0.5 → 拒绝.
      const both = evaluateRecallCandidate(entry, null, visitorQuery, NOW, {
        halfLifeMs: 10 * DAY_MS,
        minEffectiveImportance: 0.5,
      });
      expect(both.accepted).toBe(false);
    });

    it('⑤ 内存版 recallPolicy 端口生效 (与内核判定同口径)', async () => {
      const entry = agedEntry();
      // 缺省 → 内核默认阈值 0.1 → 召回.
      const defaultStore = new InMemoryMemoryStore({ now: () => NOW });
      await defaultStore.remember(entry);
      expect(await defaultStore.recall(visitorQuery)).toHaveLength(1);

      // 配更严的阈值 → 与内核判定同口径 → 不召回.
      const strictStore = new InMemoryMemoryStore({ now: () => NOW, recallPolicy: { minEffectiveImportance: 0.7 } });
      await strictStore.remember(entry);
      expect(await strictStore.recall(visitorQuery)).toHaveLength(0);

      // 配更短的半衰期 → 有效重要度掉到 0.4 → 阈值 0.5 拦下.
      const shortHalfLifeStore = new InMemoryMemoryStore({
        now: () => NOW,
        recallPolicy: { halfLifeMs: 10 * DAY_MS, minEffectiveImportance: 0.5 },
      });
      await shortHalfLifeStore.remember(entry);
      expect(await shortHalfLifeStore.recall(visitorQuery)).toHaveLength(0);

      // 只配半衰期 → 阈值仍是内核默认 0.1 → 0.4 ≥ 0.1 → 召回.
      const halfLifeOnlyStore = new InMemoryMemoryStore({ now: () => NOW, recallPolicy: { halfLifeMs: 10 * DAY_MS } });
      await halfLifeOnlyStore.remember(entry);
      expect(await halfLifeOnlyStore.recall(visitorQuery)).toHaveLength(1);
    });
  });

  describe('边界: 存储行与领域模型的分工保持不变', () => {
    it('createEmptyBdiSnapshot 的记忆信念基线为空 (召回属 WP2, 快照本身不带记忆)', () => {
      expect(createEmptyBdiSnapshot().memoryBeliefs).toEqual([]);
    });
  });
});
