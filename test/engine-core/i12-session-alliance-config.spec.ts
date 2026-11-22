// V2026-11-11 治本 (Phase2.5 I-12 · 会话级同盟门槛覆盖 · 内核纯函数 + 装配测试):
//   覆盖:
//     ① 会话级覆盖的三条回落规则 (覆盖优先 / 缺项回落单例 / 非法值回落种子);
//     ② 零行为变化 —— 无覆盖时逐字回落实例级配置 (同一引用);
//     ③ 装配链 —— 会话级覆盖真的送到了消费点 (planIntention 拿到的就是合并后的配置).
//
//   形态: 单元纯函数 + 内存实现; 不起 Nest、不连 DB.
//
//   验证: pnpm exec vitest run test/engine-core/i12-session-alliance-config.spec.ts

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { resolveSessionAllianceConfig } from '../../src/engine-core/cognition/alliance-config.js';
import { planIntention } from '../../src/engine-core/cognition/intention-planner.js';
import { createEmptyBdiSnapshot } from '../../src/engine-core/domain/bdi-snapshot.js';
import { InMemoryBdiStateRepository } from '../../src/engine-core/in-memory/in-memory-bdi-state.repository.js';
import { InMemoryEngineSession } from '../../src/engine-core/in-memory/in-memory-engine-session.js';
import { InMemoryMemoryStore } from '../../src/engine-core/in-memory/in-memory-memory.store.js';
import { resetTestDoubles } from '../helpers/index.js';

// .spy: 让 planIntention 可观测 —— 断言"消费点拿到的到底是哪份配置".
vi.mock('../../src/engine-core/cognition/intention-planner.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/engine-core/cognition/intention-planner.js')>();
  return { ...actual, planIntention: vi.fn(actual.planIntention) };
});

const TENANT = 'tenant-i12';
const VISITOR = 'visitor-i12';

/** 实例级配置 (= 适配层 env 单例的等价物): 门槛 open=0.6 / resistanceTrust=0.4 / resistanceSafety=0.3. */
const BASE_CONFIG = {
  deltas: {},
  thresholds: { open: 0.6, resistanceTrust: 0.4, resistanceSafety: 0.3 },
};

// V2026-11-13 (TD-9 · T-1): 统一复位钩子 —— 原先 mockClear 写在两个用例体内,
//   用例中途失败会把 planner 替身的调用计数漏给下一个用例; 现在统一在钩子里复位.
beforeEach(() => {
  resetTestDoubles({ planIntention: vi.mocked(planIntention) });
});

describe('I-12 · 会话级同盟门槛覆盖 · 内核纯函数', () => {
  it('无覆盖 → 原样返回实例级配置 (同一引用, 逐字零回归)', () => {
    const resolved = resolveSessionAllianceConfig(BASE_CONFIG);
    expect(resolved).toBe(BASE_CONFIG);
  });

  it('无覆盖 + 无实例级配置 → 原样返回 undefined (内核种子值口径不变)', () => {
    expect(resolveSessionAllianceConfig()).toBeUndefined();
  });

  it('覆盖优先: 覆盖里给了的项用覆盖值', () => {
    const resolved = resolveSessionAllianceConfig(BASE_CONFIG, { open: 0.85 });
    expect(resolved?.thresholds.open).toBe(0.85);
  });

  it('缺项回落单例: 覆盖里没给的项沿用实例级配置的值', () => {
    const resolved = resolveSessionAllianceConfig(BASE_CONFIG, { open: 0.85 });
    expect(resolved?.thresholds.resistanceTrust).toBe(0.4);
    expect(resolved?.thresholds.resistanceSafety).toBe(0.3);
  });

  it('非法值回落种子: 越界覆盖 (非有限 / <0 / >1) 逐项回落到内核种子值', () => {
    const resolved = resolveSessionAllianceConfig(BASE_CONFIG, { open: 5, resistanceTrust: -1, resistanceSafety: Number.NaN });
    expect(resolved?.thresholds.open).toBe(0.6);
    expect(resolved?.thresholds.resistanceTrust).toBe(0.4);
    expect(resolved?.thresholds.resistanceSafety).toBe(0.3);
  });

  it('显式传 undefined 等价于缺项 (不能把单例值覆盖成 undefined)', () => {
    const resolved = resolveSessionAllianceConfig(BASE_CONFIG, { open: undefined });
    expect(resolved?.thresholds.open).toBe(0.6);
  });

  it('deltas 沿用实例级配置 (本单只管门槛, 不动系数覆写表)', () => {
    const base = { deltas: { empathy: { safety: 0.05 } }, thresholds: BASE_CONFIG.thresholds };
    const resolved = resolveSessionAllianceConfig(base, { open: 0.7 });
    expect(resolved?.deltas).toBe(base.deltas);
  });

  it('数值冻结: 本单未改任何门槛数值 —— 内核种子值仍是 0.6 / 0.4 / 0.3', () => {
    const resolved = resolveSessionAllianceConfig(undefined, { open: 0.5 });
    // 无实例级配置时, 缺项回落的是**内核种子值**.
    expect(resolved?.thresholds.resistanceTrust).toBe(0.4);
    expect(resolved?.thresholds.resistanceSafety).toBe(0.3);
  });
});

describe('I-12 · 会话级同盟门槛覆盖 · 装配链 (覆盖真的送到了消费点)', () => {
  /** 造一个内存会话 (确定性 id / 固定时钟). */
  function createSession(): InMemoryEngineSession {
    let idSeq = 0;
    const clock = 1_700_000_000_000;
    return new InMemoryEngineSession({
      bdiStates: new InMemoryBdiStateRepository(),
      memories: new InMemoryMemoryStore({ now: () => clock }),
      idFactory: () => {
        idSeq += 1;
        return `i12-id-${idSeq}`;
      },
      now: () => clock,
      allianceConfig: BASE_CONFIG,
    });
  }

  it('无覆盖 → 消费点拿到的就是实例级配置 (逐字不变)', async () => {
    const session = createSession();
    const handle = session.openSession({ sessionId: 's-1', tenantId: TENANT, visitorId: VISITOR, seed: 7 });
    await session.turn(handle.handleId, { userText: '我最近睡不好。' });

    const called = vi.mocked(planIntention).mock.calls[0];
    expect(called?.[2]).toBe(BASE_CONFIG);
  });

  it('有覆盖 → 消费点拿到的是**合并后**的会话级配置', async () => {
    const session = createSession();
    const handle = session.openSession({
      sessionId: 's-2',
      tenantId: TENANT,
      visitorId: VISITOR,
      seed: 7,
      allianceThresholds: { open: 0.85 },
    });
    await session.turn(handle.handleId, { userText: '我最近睡不好。' });

    const called = vi.mocked(planIntention).mock.calls[0];
    const alliance = called?.[2];
    expect(alliance?.thresholds.open).toBe(0.85);
    // 缺项回落单例
    expect(alliance?.thresholds.resistanceTrust).toBe(0.4);
  });

  it('覆盖改变了意图判定 —— 证明门槛真的生效 (不是只换了个对象)', () => {
    const snapshot = createEmptyBdiSnapshot();
    // 门槛生效的前提: 信任与安全感都越过门槛, 且深度阻抗低.
    const raised = { ...snapshot, trust: 0.7, safety: 0.7, resistance: { ...snapshot.resistance, verbal: 0.1, depth: 0.1, style: 0.1 } };
    const base = { deltas: {}, thresholds: { open: 0.6, resistanceTrust: 0.4, resistanceSafety: 0.3 } };

    // 实例级门槛 0.6 → 0.7 >= 0.6 → 进入探索.
    expect(planIntention(raised, undefined, base).strategy).toBe('cognitive_exploration');
    // 会话级把门槛抬到 0.9 → 0.7 < 0.9 → 不进入探索.
    const overridden = resolveSessionAllianceConfig(base, { open: 0.9 });
    expect(planIntention(raised, undefined, overridden).strategy).toBe('recounting');
  });
});
