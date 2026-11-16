// V2026-11-03 WP37 (引擎内核 · 工作窗口溢出钩子):
//   目的: 钉死"工作记忆窗口被挤时, 内核把被挤出的轮次交出去"这条契约 ——
//     ① 窗口 8 轮 → 第 9 轮: 回调触发一次, 参数是被挤出的那 1 轮 (队首);
//     ② 窗口 8 轮 → 第 10 轮: 回调触发两次 (逐轮各挤 1 轮), 累计被挤出第 1、2 轮;
//     ③ 窗口不足 8 轮: 回调不触发;
//     ④ 回调载荷带归属三件套 (适配层要写记忆条目, 缺一不可);
//     ⑤ 没装回调 → 行为与 WP2 逐字一致 (零回归);
//     ⑥ 溢出纯函数: 一次挤出 2 轮的形状也被覆盖 (窗口被超额塞入时的情形).
//
//   为什么"队首"是硬断言 (而不是"挤出了 N 条"就算过):
//     窗口保尾弃头 —— 被挤出的必然是**最早**的那几条. 取错段 (取尾) 的话,
//     摘要压的是"刚聊的"而不是"早先聊的", 那就正好压反了.
//
//   反依赖污染:
//     不 import 任何 @nestjs/* / typeorm; 只用内核纯 TS + 内存实现.
//
//   验证: npx vitest run test/engine-core/wp37-rolling-summary-hook.spec.ts

import { InMemoryBdiStateRepository } from '../../src/engine-core/in-memory/in-memory-bdi-state.repository.js';
import { InMemoryEngineSession } from '../../src/engine-core/in-memory/in-memory-engine-session.js';
import { InMemoryMemoryStore } from '../../src/engine-core/in-memory/in-memory-memory.store.js';
import { WORKING_MEMORY_WINDOW_TURNS, overflowedWorkingWindowLines, type WorkingWindowOverflowEvent } from '../../src/engine-core/index.js';

const TENANT = 'tenant-1';
const VISITOR = 'visitor-1';

/** 测试台: 内存仓储 + 确定性时钟 / id + 溢出回调 (总是装上, 便于收集事件). */
function createHarness(onOverflow?: (event: WorkingWindowOverflowEvent) => void): {
  readonly session: InMemoryEngineSession;
  readonly events: WorkingWindowOverflowEvent[];
} {
  const bdiStates = new InMemoryBdiStateRepository();
  const memories = new InMemoryMemoryStore();
  const events: WorkingWindowOverflowEvent[] = [];
  let idSeq = 0;
  const clock = 1_700_000_000_000;
  const session = new InMemoryEngineSession({
    bdiStates,
    memories,
    idFactory: () => {
      idSeq += 1;
      return `wp37-id-${idSeq}`;
    },
    now: (): number => clock,
    onWorkingWindowOverflow: (event: WorkingWindowOverflowEvent) => {
      events.push(event);
      onOverflow?.(event);
    },
  });
  return { session, events };
}

/** 跑一轮 (便捷封装). */
async function turn(session: InMemoryEngineSession, handleId: string, userText: string): Promise<void> {
  await session.turn(handleId, { userText });
}

describe('WP37 · 工作窗口溢出钩子 (内核)', () => {
  it('① 窗口 8 轮 → 第 9 轮: 回调触发一次, 参数是被挤出的那 1 轮', async () => {
    const { session, events } = createHarness();

    const handle = session.openSession({ sessionId: 's1', tenantId: TENANT, visitorId: VISITOR });
    for (let i = 1; i <= 8; i += 1) {
      await turn(session, handle.handleId, `第${i}轮`);
    }
    expect(events).toHaveLength(0);

    await turn(session, handle.handleId, '第9轮');

    expect(events).toHaveLength(1);
    expect(events[0]?.pushedOut).toEqual(['第1轮']);
  });

  it('② 窗口 8 轮 → 第 10 轮: 逐轮各挤 1 轮, 累计被挤出第 1、2 轮', async () => {
    const { session, events } = createHarness();

    const handle = session.openSession({ sessionId: 's1', tenantId: TENANT, visitorId: VISITOR });
    for (let i = 1; i <= 10; i += 1) {
      await turn(session, handle.handleId, `第${i}轮`);
    }

    // 逐轮追加时每轮只挤 1 条 —— 回调每轮触发一次 (不是一个 turn 挤两条).
    expect(events).toHaveLength(2);
    expect(events[0]?.pushedOut).toEqual(['第1轮']);
    expect(events[1]?.pushedOut).toEqual(['第2轮']);
    // 累计: 被挤出去的就是最早的两轮.
    expect(events.flatMap((event) => event.pushedOut)).toEqual(['第1轮', '第2轮']);
  });

  it('③ 窗口不足 8 轮: 回调不触发', async () => {
    const { session, events } = createHarness();

    const handle = session.openSession({ sessionId: 's1', tenantId: TENANT, visitorId: VISITOR });
    for (let i = 1; i <= 7; i += 1) {
      await turn(session, handle.handleId, `第${i}轮`);
    }

    expect(events).toHaveLength(0);
  });

  it('④ 回调载荷带归属三件套 (适配层写记忆条目必需)', async () => {
    const { session, events } = createHarness();

    const handle = session.openSession({ sessionId: 's1', tenantId: TENANT, visitorId: VISITOR });
    for (let i = 1; i <= 9; i += 1) {
      await turn(session, handle.handleId, `第${i}轮`);
    }

    const event = events[0];
    expect(event?.tenantId).toBe(TENANT);
    expect(event?.sessionId).toBe('s1');
    expect(event?.visitorId).toBe(VISITOR);
  });

  it('⑤ 没装回调 → 行为逐字不变 (零回归), 且不抛错', async () => {
    // 刻意**不装**回调: 装配缺席 = 内核只裁窗口, 不通知任何人.
    const bdiStates = new InMemoryBdiStateRepository();
    const session = new InMemoryEngineSession({
      bdiStates,
      memories: new InMemoryMemoryStore(),
      now: (): number => 1_700_000_000_000,
    });

    const handle = session.openSession({ sessionId: 's1', tenantId: TENANT, visitorId: VISITOR });
    for (let i = 1; i <= 12; i += 1) {
      const out = await session.turn(handle.handleId, { userText: `第${i}轮` });
      expect(out.turnIndex).toBe(i);
    }
  });

  it('⑤ 回调抛错 → 整轮对练不受影响 (摘要是增强, 不是会话成败)', async () => {
    const { session } = createHarness(() => {
      throw new Error('摘要服务炸了');
    });

    const handle = session.openSession({ sessionId: 's1', tenantId: TENANT, visitorId: VISITOR });
    for (let i = 1; i <= 9; i += 1) {
      const out = await session.turn(handle.handleId, { userText: `第${i}轮` });
      expect(out.turnIndex).toBe(i);
    }
  });

  it('⑥ 溢出纯函数: 一次挤出 2 轮时取的是队首两条', () => {
    const window = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];

    expect(overflowedWorkingWindowLines(window, '新', 8)).toEqual(['1', '2']);
    // 不足窗口时没有溢出.
    expect(overflowedWorkingWindowLines(['1', '2'], '新', 8)).toEqual([]);
    // 恰好等于窗口长度时, 新增一条挤掉队首一条.
    expect(overflowedWorkingWindowLines(['1', '2', '3', '4', '5', '6', '7', '8'], '新', 8)).toEqual(['1']);
  });

  it('⑥ 溢出纯函数与内核常量口径一致 (窗口 8 轮)', () => {
    expect(WORKING_MEMORY_WINDOW_TURNS).toBe(8);
  });
});
