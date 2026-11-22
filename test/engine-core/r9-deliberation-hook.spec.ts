// V2026-11-08 治本 (R9 · 引擎内核 · 审议钩子):
//   目的: 钉死"审议可以修正规则 delta"这条内核契约 ——
//     ① 不注入钩子 → 决策链与落库结果**逐字不变** (零回归硬要求);
//     ② 注入钩子 → 建议真的进落库快照;
//     ③ 稀疏补丁语义: 建议没提到的维度**保留规则算子的值** (不被清零);
//     ④ 端口抛错 → 回退规则 delta, 主流程**不炸**;
//     ⑤ 端口返回 null → 回退规则 delta;
//     ⑥ 建议**不得绕过 delta cap** (合并后再过一次同一把尺子);
//     ⑦ 钩子拿到的上下文齐全 (快照 / 规则 delta / 咨询师文本 / 归属 / 轮次 / 版本号);
//     ⑧ 建议**滞后一轮**: 第 N 轮算的, 第 N+1 轮才生效.
//
//   为什么"逐字不变"要**比快照**而不是"看代码没改":
//     内核的决策链有 11 个维度 + 事件 + 轨迹 + 信念演化, 任何一处被顺手动过都会
//     悄悄改掉落库结果. 快照深比较 = 把"行为"钉死, 而不是把"实现"钉死.
//
//   为什么"稀疏"要**比全快照** (而不是只看被覆盖的那一维):
//     整体替换是最容易写错、也最不容易看出来的实现 (未提及的维度被清零 ——
//     数值仍然"合法", 只是悄悄变成了 0). 只有整份快照深比较才抓得住.
//
//   反依赖污染:
//     不 import 任何 @nestjs/* / typeorm; 只用内核纯 TS + 内存实现.
//
//   验证: npx vitest run test/engine-core/r9-deliberation-hook.spec.ts

import { InMemoryBdiStateRepository } from '../../src/engine-core/in-memory/in-memory-bdi-state.repository.js';
import { InMemoryEngineSession } from '../../src/engine-core/in-memory/in-memory-engine-session.js';
import { InMemoryMemoryStore } from '../../src/engine-core/in-memory/in-memory-memory.store.js';
import {
  DEFAULT_DELTA_CAP_CONFIG,
  capTurnDelta,
  type DeliberationHookContext,
  type DeliberationHookPort,
  type DeltaVector,
} from '../../src/engine-core/index.js';

const TENANT = 'tenant-r9';
const VISITOR = 'visitor-r9';

/**
 * 中性发言 —— 不命中任何事件词典, 所以规则算子的 delta **恒为 0**.
 *
 * 为什么非要挑一句"什么都不触发"的话:
 *   有了它, "建议覆盖某维" 的期望值就是**确定的** (基线 + 补丁值),
 *   断言不必去反推规则算子那轮到底动了哪几维 —— 那会让测试变成"跟着实现写".
 */
const NEUTRAL = '嗯，我明白了。';

/** 11 维零向量 (内核 delta 的合法形状). */
function zeroDelta(): DeltaVector {
  return {
    trust: 0,
    safety: 0,
    bond: 0,
    valence: 0,
    arousal: 0,
    verbal: 0,
    depth: 0,
    style: 0,
    positive: 0,
    negative: 0,
    dependency: 0,
  };
}

/** 装一个会话 (可选钩子). */
function createSession(hook?: DeliberationHookPort): InMemoryEngineSession {
  return new InMemoryEngineSession({
    bdiStates: new InMemoryBdiStateRepository(),
    memories: new InMemoryMemoryStore(),
    now: (): number => 1_700_000_000_000,
    ...(hook ? { deliberationHook: hook } : {}),
  });
}

/** 开一场会话并跑一轮. */
async function runOneTurn(hook?: DeliberationHookPort): Promise<{ readonly trust: number; readonly snapshot: unknown }> {
  const session = createSession(hook);
  const handle = session.openSession({ sessionId: 's1', tenantId: TENANT, visitorId: VISITOR });
  const out = await session.turn(handle.handleId, { userText: NEUTRAL });
  return { trust: out.snapshot.trust, snapshot: out.snapshot };
}

describe('R9 · 审议钩子 (内核)', () => {
  it('① 不注入钩子 → 决策链逐字不变 (中性发言: 信任 / 安全感 / 纽带 / 效价全部不动)', async () => {
    const session = createSession();
    const handle = session.openSession({ sessionId: 's1', tenantId: TENANT, visitorId: VISITOR });
    const out = await session.turn(handle.handleId, { userText: NEUTRAL });

    // 内核开场基线 (bootstrap.ts): trust 0.3 / safety 0.5 / bond 0 / valence 0.
    expect(out.snapshot.trust).toBe(0.3);
    expect(out.snapshot.safety).toBe(0.5);
    expect(out.snapshot.bond).toBe(0);
    expect(out.snapshot.emotion.valence).toBe(0);
  });

  it('① 不注入钩子 vs 装一个"永远给 null"的钩子 → 落库快照**完全相同**', async () => {
    const plain = await runOneTurn();
    const nullHook = await runOneTurn({ applyDeliberation: () => null });

    expect(nullHook.snapshot).toEqual(plain.snapshot);
  });

  it('② 注入钩子 → 建议真的进落库快照 (信任 0.3 → 0.4)', async () => {
    const out = await runOneTurn({ applyDeliberation: () => ({ trust: 0.1 }) });

    expect(out.trust).toBeCloseTo(0.4, 6);
  });

  it('③ 稀疏补丁语义: 建议没提到的维度**保留规则算子的值** (整份快照只差被覆盖的那一维)', async () => {
    const plain = await runOneTurn();
    const patched = await runOneTurn({ applyDeliberation: () => ({ trust: 0.1 }) });

    // 把被覆盖的那一维换回基线值 → 两份快照应当**逐字相等**.
    //   (若实现是"整体替换 delta", 未提及的维度会被清零 —— 这条断言立刻变红.)
    const plainSnapshot = plain.snapshot as { trust: number };
    const patchedSnapshot = patched.snapshot as { trust: number };
    expect({ ...patchedSnapshot, trust: plainSnapshot.trust }).toEqual(plain.snapshot);
    expect(patchedSnapshot.trust).not.toBe(plainSnapshot.trust);
  });

  it('④ 端口抛错 → 回退规则 delta, 主流程不炸', async () => {
    const out = await runOneTurn({
      applyDeliberation: () => {
        throw new Error('审议炸了');
      },
    });

    // 回退 = 与"没有建议"逐字相同.
    expect(out.trust).toBe(0.3);
  });

  it('⑤ 端口返回 null → 回退规则 delta', async () => {
    const out = await runOneTurn({ applyDeliberation: () => null });

    expect(out.trust).toBe(0.3);
  });

  it('⑥ 建议不得绕过 delta cap (合并后再过一次同一把尺子)', async () => {
    // 建议给一个荒谬的幅度 (999) —— 内核必须拿 cap 砍回边界.
    const out = await runOneTurn({ applyDeliberation: () => ({ trust: 999 }) });

    const capped = capTurnDelta({ ...zeroDelta(), trust: 999 }, DEFAULT_DELTA_CAP_CONFIG);
    expect(capped.trust).toBeLessThan(999);
    expect(out.trust).toBeCloseTo(0.3 + capped.trust, 6);
  });

  it('⑦ 钩子拿到的上下文齐全 (快照 / 规则 delta / 咨询师文本 / 归属 / 轮次 / 版本号)', async () => {
    let captured: DeliberationHookContext | null = null;
    const session = createSession({
      applyDeliberation: (context: DeliberationHookContext) => {
        captured = context;
        return null;
      },
    });
    const handle = session.openSession({ sessionId: 's1', tenantId: TENANT, visitorId: VISITOR });
    await session.turn(handle.handleId, { userText: NEUTRAL });

    expect(captured).not.toBeNull();
    const context = captured as unknown as DeliberationHookContext;
    expect(context.tenantId).toBe(TENANT);
    expect(context.sessionId).toBe('s1');
    expect(context.turnIndex).toBe(1);
    expect(context.counselorText).toBe(NEUTRAL);
    expect(context.ruleDelta).toEqual(zeroDelta());
    expect(context.snapshot.trust).toBe(0.3);
    // 第 1 轮开始时本场还没落过库 → 版本号 0 (第 2 轮起是上一轮落库后的版本).
    expect(context.currentRevision).toBe(0);
  });

  it('⑦ 版本号随状态推进 (第 2 轮开始时 = 第 1 轮落库后的版本 1)', async () => {
    const seen: number[] = [];
    const session = createSession({
      applyDeliberation: (context: DeliberationHookContext) => {
        seen.push(context.currentRevision);
        return null;
      },
    });
    const handle = session.openSession({ sessionId: 's1', tenantId: TENANT, visitorId: VISITOR });
    await session.turn(handle.handleId, { userText: NEUTRAL });
    await session.turn(handle.handleId, { userText: NEUTRAL });

    expect(seen).toEqual([0, 1]);
  });

  it('⑧ 建议滞后一轮: 第 1 轮的建议到第 2 轮才生效', async () => {
    let callCount = 0;
    const session = createSession({
      applyDeliberation: () => {
        callCount += 1;
        // 第 1 次调用 (第 1 轮) 无建议; 第 2 次 (第 2 轮) 才给建议.
        return callCount === 1 ? null : { trust: 0.1 };
      },
    });
    const handle = session.openSession({ sessionId: 's1', tenantId: TENANT, visitorId: VISITOR });

    const first = await session.turn(handle.handleId, { userText: NEUTRAL });
    expect(first.snapshot.trust).toBe(0.3);

    const second = await session.turn(handle.handleId, { userText: NEUTRAL });
    expect(second.snapshot.trust).toBeCloseTo(0.4, 6);
  });
});
