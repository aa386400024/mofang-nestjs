// V2026-10-28 治本 (WP0 · 引擎内核 · 边界骨架冒烟与契约单测):
//   目的: 证明内核**可以脱离 NestJS 容器**直接 new 出来跑通
//         open → turn → close, 且端口契约 (乐观锁 / 防御性拷贝 / 幂等关闭 /
//         跨会话接续 / 记忆 TTL) 真的成立 —— 不是只有形状的空壳.
//
//   为什么这些断言值得写:
//     WP0 的产出是"边界", 而边界的价值全在**行为契约**上. 只断言"能 new 出来"
//     等于没测: 内核真正容易在后期塌方的地方是"谁在什么时候改了状态" ——
//     乐观锁被绕开 (并发写静默覆盖)、存取不拷贝 (消费方改快照污染存储)、
//     close 抛错 (清理失败升级成主流程失败). 这三类一旦退化, 都要等线上多实例
//     跑起来才显形, 那时再查极难.
//
//   为什么放在 test/ 而不是 src/engine-core/ 下:
//     内核包 (src/engine-core/) 必须保持"整包零框架依赖"的可搬走性, 一个字节的
//     测试脚手架都不该混进去. 断言放 test/, 扫的是 src/engine-core/ 整棵树 ——
//     这样"内核零依赖"是**被扫描出来的事实**, 不是靠约定维持的自觉.
//
//   反依赖污染:
//     本文件**不 import 任何 @nestjs/* / typeorm** —— 它自己就是边界不变量的一部分.
//     全部依赖都是内核自己的纯 TS 实现 + node 内置模块.
//
//   验证: npx jest test/engine-core/engine-core.spec.ts
//   时间戳: 2026-10-28 GMT+8

import {
  EngineCoreError,
  EngineErrorCode,
  MemorySource,
  MemoryTier,
  createEmptyBdiSnapshot,
  type EngineSessionPort,
  type EngineTurnOutput,
} from '../../src/engine-core';
import { InMemoryBdiStateRepository } from '../../src/engine-core/in-memory/in-memory-bdi-state.repository';
import { InMemoryEngineSession } from '../../src/engine-core/in-memory/in-memory-engine-session';
import { InMemoryMemoryStore } from '../../src/engine-core/in-memory/in-memory-memory.store';

/** 测试台: 三个内存实现 + 确定性 id / 确定性时钟. */
interface Harness {
  readonly bdiStates: InMemoryBdiStateRepository;
  readonly memories: InMemoryMemoryStore;
  readonly session: InMemoryEngineSession;
  /** 推进测试时钟 (ms). */
  advance: (ms: number) => void;
}

/**
 * 造一个测试台: 三个内存实现 + 确定性 id / 确定性时钟.
 *
 * ⚠️ 时钟必须**同时**注入 session 与 memory store:
 *   两个组件各有各的 `now` 注入点 (解耦是好的 —— 它们本就是独立组件),
 *   但测试台若只给 session 注入假时钟, memory store 就会退回真实 Date.now(),
 *   于是 "advance(1001) 让 TTL 到期" 这类断言会**假通过或假失败** ——
 *   实测就踩了这个坑: 断言期望 0 条, 实际 1 条, 因为 store 看到的"现在"根本没动过.
 *   生产环境两者都默认 Date.now(), 不存在这个问题; 只有测试台需要显式对齐.
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
      return `test-id-${idSeq}`;
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
  };
}

/**
 * 捕获同步抛出的错误.
 *
 * 为什么不用 try/catch + expect 写在 catch 里: jest/no-conditional-expect 会判违规
 * (catch 块里的 expect 不可控). 把捕获与断言拆开 —— 捕获在 helper, 断言在用例体.
 */
function catchError(fn: () => unknown): unknown {
  try {
    fn();
  } catch (err) {
    return err;
  }
  return undefined;
}

const OPEN_INPUT = {
  sessionId: 'session-1',
  tenantId: 'default',
  visitorId: 'visitor-1',
} as const;

const TENANT = 'default';

describe('engine-core · WP0 边界骨架', () => {
  describe('冒烟: 脱离 NestJS 容器跑通 open → turn → close', () => {
    it('端口契约可被内存实现直接满足 (编译期即校验)', () => {
      const { session } = createHarness();
      const port: EngineSessionPort = session;
      const handle = port.openSession(OPEN_INPUT);
      expect(handle.sessionId).toBe('session-1');
      expect(handle.handleId).toBeTruthy();
    });

    it('turn 返回占位出参, close 释放句柄', async () => {
      const { session } = createHarness();
      const handle = session.openSession(OPEN_INPUT);

      const output: EngineTurnOutput = await session.turn(handle.handleId, { userText: '最近压力很大' });

      expect(output.reply).toBe('');
      expect(output.turnIndex).toBe(1);
      expect(output.snapshot.coreBeliefs).toEqual([]);
      // WP1: resistance 总有中性默认基线, 不再可空.
      expect(output.snapshot.resistance).toEqual({ verbal: 0.4, depth: 0.4, style: 0.35 });

      session.closeSession(handle.handleId);
      expect(session.activeSessionCount()).toBe(0);
    });

    it('多轮推进 turnIndex, 每轮状态独立落库', async () => {
      const { session, bdiStates } = createHarness();
      const handle = session.openSession(OPEN_INPUT);

      await session.turn(handle.handleId, { userText: '第一轮' });
      const second = await session.turn(handle.handleId, { userText: '第二轮' });

      expect(second.turnIndex).toBe(2);
      const stored = await bdiStates.load(TENANT, 'session-1');
      expect(stored?.revision).toBe(2);
    });
  });

  describe('端口契约: 错误路径', () => {
    it('turn 未开启的句柄 → SESSION_NOT_FOUND', async () => {
      const { session } = createHarness();
      await expect(session.turn('not-opened', { userText: '你好' })).rejects.toMatchObject({
        code: EngineErrorCode.SESSION_NOT_FOUND,
      });
    });

    it('重复 open 同一 sessionId → SESSION_ALREADY_OPEN', () => {
      const { session } = createHarness();
      session.openSession(OPEN_INPUT);
      const err = catchError(() => session.openSession(OPEN_INPUT));
      expect(err).toBeInstanceOf(EngineCoreError);
      expect((err as EngineCoreError).code).toBe(EngineErrorCode.SESSION_ALREADY_OPEN);
    });

    it('open 入参非法 (空 sessionId / tenantId / visitorId) → INVALID_INPUT', () => {
      const { session } = createHarness();
      expect(() => session.openSession({ ...OPEN_INPUT, sessionId: '  ' })).toThrow(EngineCoreError);
      expect(() => session.openSession({ ...OPEN_INPUT, tenantId: '' })).toThrow(EngineCoreError);
      expect(() => session.openSession({ ...OPEN_INPUT, visitorId: '' })).toThrow(EngineCoreError);
    });

    it('turn 的 userText 为空白 → INVALID_INPUT, 且不产生状态变更', async () => {
      const { session, bdiStates } = createHarness();
      const handle = session.openSession(OPEN_INPUT);
      await expect(session.turn(handle.handleId, { userText: '   ' })).rejects.toMatchObject({
        code: EngineErrorCode.INVALID_INPUT,
      });
      expect(await bdiStates.load(TENANT, 'session-1')).toBeNull();
    });

    it('signal 已 aborted → ABORTED, 且不产生状态变更', async () => {
      const { session, bdiStates } = createHarness();
      const handle = session.openSession(OPEN_INPUT);
      const controller = new AbortController();
      controller.abort();
      await expect(session.turn(handle.handleId, { userText: '你好', signal: controller.signal })).rejects.toMatchObject({
        code: EngineErrorCode.ABORTED,
      });
      expect(await bdiStates.load(TENANT, 'session-1')).toBeNull();
    });

    it('closeSession 幂等 (未知 / 重复关闭都不抛错)', () => {
      const { session } = createHarness();
      const handle = session.openSession(OPEN_INPUT);
      session.closeSession(handle.handleId);
      expect(() => session.closeSession(handle.handleId)).not.toThrow();
      expect(() => session.closeSession('never-existed')).not.toThrow();
    });

    it('EngineCoreError 是 Error 子类, 且带机器可读 code', () => {
      const err = new EngineCoreError(EngineErrorCode.INVALID_INPUT, 'boom', { sessionId: 's-1' });
      expect(err).toBeInstanceOf(Error);
      expect(err).toBeInstanceOf(EngineCoreError);
      expect(err.code).toBe(EngineErrorCode.INVALID_INPUT);
      expect(err.details['sessionId']).toBe('s-1');
    });
  });

  describe('状态仓储契约: 乐观锁 + 防御性拷贝 + 租户隔离', () => {
    it('revision 不单调递增 → STATE_CONFLICT (不静默覆盖)', async () => {
      const { bdiStates } = createHarness();
      await bdiStates.save({ tenantId: TENANT, sessionId: 's-1', revision: 2, updatedAt: 1, snapshot: createEmptyBdiSnapshot() });
      await expect(
        bdiStates.save({ tenantId: TENANT, sessionId: 's-1', revision: 2, updatedAt: 2, snapshot: createEmptyBdiSnapshot() }),
      ).rejects.toMatchObject({ code: EngineErrorCode.STATE_CONFLICT });
    });

    it('首次落库 revision 必须 >= 1', async () => {
      const { bdiStates } = createHarness();
      await expect(
        bdiStates.save({ tenantId: TENANT, sessionId: 's-1', revision: 0, updatedAt: 1, snapshot: createEmptyBdiSnapshot() }),
      ).rejects.toMatchObject({ code: EngineErrorCode.INVALID_INPUT });
    });

    it('load 返回的快照与仓储内部互不影响 (防御性拷贝)', async () => {
      const { bdiStates } = createHarness();
      await bdiStates.save({ tenantId: TENANT, sessionId: 's-1', revision: 1, updatedAt: 1, snapshot: createEmptyBdiSnapshot() });

      const loaded = await bdiStates.load(TENANT, 's-1');
      // 绕过 readonly 直接改数组 (模拟 JS 消费方), 仓储内部不应被污染.
      (loaded!.snapshot.coreBeliefs as unknown[]).push('tampered');

      const reloaded = await bdiStates.load(TENANT, 's-1');
      expect(reloaded?.snapshot.coreBeliefs).toEqual([]);
    });

    it('load 未命中返回 null (不抛错)', async () => {
      const { bdiStates } = createHarness();
      expect(await bdiStates.load(TENANT, 'never-saved')).toBeNull();
    });

    it('同 sessionId 在不同租户下互不可见 (租户隔离)', async () => {
      const { bdiStates } = createHarness();
      await bdiStates.save({ tenantId: 'tenant-a', sessionId: 'shared-id', revision: 1, updatedAt: 1, snapshot: createEmptyBdiSnapshot() });
      expect(await bdiStates.load('tenant-b', 'shared-id')).toBeNull();
      expect(await bdiStates.load('tenant-a', 'shared-id')).not.toBeNull();
    });
  });

  describe('记忆仓储契约: 写入 / 过滤 / 上限 / TTL / 租户隔离', () => {
    it('本轮对话写入工作记忆, 可被召回', async () => {
      const { session, memories } = createHarness();
      const handle = session.openSession(OPEN_INPUT);
      await session.turn(handle.handleId, { userText: '我最近老是失眠' });

      const hits = await memories.recall({ tenantId: TENANT, sessionId: 'session-1', query: '失眠' });
      expect(hits).toHaveLength(1);
      expect(hits[0]?.entry.content).toBe('我最近老是失眠');
      expect(hits[0]?.entry.tier).toBe(MemoryTier.WORKING);
    });

    it('跨租户召回拿不到本租户的记忆', async () => {
      const { memories } = createHarness();
      await memories.remember({
        id: 'm-x',
        tenantId: 'tenant-a',
        sessionId: 'session-1',
        tier: MemoryTier.WORKING,
        source: MemorySource.TURN,
        content: '租户 A 的记忆',
        importance: 0.5,
        occurredAt: 1,
      });
      expect(await memories.recall({ tenantId: 'tenant-b', sessionId: 'session-1', query: 'x' })).toHaveLength(0);
      expect(await memories.recall({ tenantId: 'tenant-a', sessionId: 'session-1', query: 'x' })).toHaveLength(1);
    });

    it('tier 过滤生效', async () => {
      const { memories } = createHarness();
      await memories.remember({
        id: 'm-1',
        tenantId: TENANT,
        sessionId: 'session-1',
        tier: MemoryTier.LONG_TERM,
        source: MemorySource.SUMMARY,
        content: '长期事实',
        importance: 0.9,
        occurredAt: 1,
      });
      const hits = await memories.recall({ tenantId: TENANT, sessionId: 'session-1', query: 'x', tiers: [MemoryTier.WORKING] });
      expect(hits).toHaveLength(0);
    });

    it('limit 超上限被 clamp, 默认 5 条', async () => {
      const { memories } = createHarness();
      for (let i = 0; i < 60; i += 1) {
        await memories.remember({
          id: `m-${i}`,
          tenantId: TENANT,
          sessionId: 'session-1',
          tier: MemoryTier.WORKING,
          source: MemorySource.TURN,
          content: `第 ${i} 条`,
          importance: 0.5,
          occurredAt: i,
        });
      }
      expect(await memories.recall({ tenantId: TENANT, sessionId: 'session-1', query: 'x' })).toHaveLength(5);
      expect(await memories.recall({ tenantId: TENANT, sessionId: 'session-1', query: 'x', limit: 1000 })).toHaveLength(50);
    });

    it('importance 越界 → INVALID_INPUT', async () => {
      const { memories } = createHarness();
      await expect(
        memories.remember({
          id: 'm-1',
          tenantId: TENANT,
          sessionId: 'session-1',
          tier: MemoryTier.WORKING,
          source: MemorySource.TURN,
          content: 'x',
          importance: 1.5,
          occurredAt: 1,
        }),
      ).rejects.toMatchObject({ code: EngineErrorCode.INVALID_INPUT });
    });

    it('TTL 到期后不再被召回', async () => {
      const harness = createHarness();
      await harness.memories.remember({
        id: 'm-ttl',
        tenantId: TENANT,
        sessionId: 'session-1',
        tier: MemoryTier.WORKING,
        source: MemorySource.TURN,
        content: '会过期的记忆',
        importance: 0.5,
        occurredAt: 1,
        ttlMs: 1000,
      });
      expect(await harness.memories.recall({ tenantId: TENANT, sessionId: 'session-1', query: 'x' })).toHaveLength(1);
      harness.advance(1001);
      expect(await harness.memories.recall({ tenantId: TENANT, sessionId: 'session-1', query: 'x' })).toHaveLength(0);
    });
  });

  describe('跨会话接续 (WP2 契约前置)', () => {
    it('resumeFromSessionId 带上来源会话的快照, 版本链从 0 起算', async () => {
      const { session, bdiStates } = createHarness();
      await bdiStates.save({
        tenantId: TENANT,
        sessionId: 'session-prev',
        revision: 3,
        updatedAt: 1,
        snapshot: createEmptyBdiSnapshot(),
      });

      const handle = session.openSession({ ...OPEN_INPUT, sessionId: 'session-2', resumeFromSessionId: 'session-prev' });
      const output = await session.turn(handle.handleId, { userText: '我们上次聊到哪了' });

      expect(output.snapshot.coreBeliefs).toEqual([]);
      const stored = await bdiStates.load(TENANT, 'session-2');
      expect(stored?.revision).toBe(1);
    });

    it('来源会话不存在时降级为全新会话 (不抛错)', async () => {
      const { session } = createHarness();
      const handle = session.openSession({ ...OPEN_INPUT, sessionId: 'session-2', resumeFromSessionId: 'not-exist' });
      const output = await session.turn(handle.handleId, { userText: '你好' });
      expect(output.turnIndex).toBe(1);
    });
  });
});
