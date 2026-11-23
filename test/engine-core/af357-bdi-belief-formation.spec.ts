// AF-357 · 短期信念生成 (core spec):
//   覆盖开工单 successCriteria 的"信念生成"部分:
//     ① 缺省关闭 → 引用不变，temporaryBeliefs 不新增;
//     ② 只从来访第一人称自我觉察陈述生成，source=observed;
//     ③ 问句 / 第三人称转述 / 否定句 / 危机词 / 长度越界 → 不生成;
//     ④ 单轮条数上限生效，同文本重复只取第一条;
//     ⑤ 重复出现同一条陈述 → 置信度按 reinforcement 递增、evidenceCount 累加、introduced 升级 observed;
//     ⑥ 生成轮不再衰减（先衰减旧条目，再生成新条目）.
//   边界: 纯函数；不读任何真实咨询原文，不连 DB/Redis，不读 env.
//
//   验证: pnpm exec vitest run test/engine-core/af357-bdi-belief-formation.spec.ts

import { describe, expect, it } from 'vitest';

import { planIntention } from '../../src/engine-core/cognition/intention-planner.js';
import {
  applyBeliefEvolution,
  applyBeliefFormation,
  DEFAULT_BELIEF_FORMATION_BASE_CONFIDENCE,
  DEFAULT_BELIEF_FORMATION_MAX_PER_TURN,
  DEFAULT_BELIEF_OPERATOR_CONFIG,
  extractReflectiveStatements,
  normalizeBeliefStatement,
  type BeliefOperatorConfig,
} from '../../src/engine-core/cognition/state-transition.js';
import { createEmptyBdiSnapshot, type BdiSnapshot } from '../../src/engine-core/domain/bdi-snapshot.js';
import type { TemporaryBelief } from '../../src/engine-core/domain/beliefs.js';

/** 造快照（默认中性基线，逐维覆盖）. */
function snap(overrides: Partial<BdiSnapshot> = {}): BdiSnapshot {
  return { ...createEmptyBdiSnapshot(), ...overrides };
}

/** 开启生成的测试配置（其余用内核种子）. */
const ON: BeliefOperatorConfig = {
  ...DEFAULT_BELIEF_OPERATOR_CONFIG,
  formationEnabled: true,
  formationBaseConfidence: 0.55,
  formationReinforcement: 0.1,
  formationMaxPerTurn: 2,
  formationMinChars: 6,
  formationMaxChars: 80,
};

/** 造一条已有短期信念. */
function belief(overrides: Partial<TemporaryBelief> = {}): TemporaryBelief {
  return {
    id: 'belief-observed-existing',
    statement: '我意识到我一直在讨好别人',
    confidence: 0.7,
    source: 'observed',
    ...overrides,
  };
}

describe('AF-357 · ① 缺省关闭', () => {
  it('未开启 → 返回入参引用，不新增任何信念', () => {
    const before = snap();
    const after = applyBeliefFormation(before, '我意识到我一直在讨好别人', undefined, 3);
    expect(after).toBe(before);
    expect(after.temporaryBeliefs).toHaveLength(0);
  });

  it('开启但 maxPerTurn=0 → 结构上不生成', () => {
    const before = snap();
    const after = applyBeliefFormation(before, '我意识到我一直在讨好别人', { ...ON, formationMaxPerTurn: 0 }, 3);
    expect(after).toBe(before);
  });

  it('空来访文本 → 引用不变', () => {
    const before = snap();
    const after = applyBeliefFormation(before, ' '.repeat(3), ON, 3);
    expect(after).toBe(before);
  });
});

describe('AF-357 · ② 合法自我觉察生成', () => {
  it('生成 source=observed 条目，带证据轮次与稳定 id', () => {
    const after = applyBeliefFormation(snap(), '我意识到我一直在讨好别人，怕被抛弃。', ON, 3);
    expect(after.temporaryBeliefs).toHaveLength(1);
    const item = after.temporaryBeliefs[0];
    expect(item.statement).toBe('我意识到我一直在讨好别人，怕被抛弃');
    expect(item.source).toBe('observed');
    expect(item.confidence).toBeCloseTo(DEFAULT_BELIEF_FORMATION_BASE_CONFIDENCE, 6);
    expect(item.evidenceCount).toBe(1);
    expect(item.firstFormedAtTurn).toBe(3);
    expect(item.lastObservedAtTurn).toBe(3);
    expect(item.id).toMatch(/^belief-observed-[a-z0-9]+$/);
  });

  it('同一条陈述两次生成 → id 稳定一致（幂等语义可追踪）', () => {
    const first = applyBeliefFormation(snap(), '我发现我很难直接拒绝别人。', ON, 2);
    const second = applyBeliefFormation(snap(), '我发现我很难直接拒绝别人。', ON, 5);
    expect(first.temporaryBeliefs[0].id).toBe(second.temporaryBeliefs[0].id);
  });

  it('多个不同陈述 → 按单轮上限截断', () => {
    const text = '我意识到我一直在讨好别人。我发现我很难直接拒绝别人。我注意到我总在回避冲突。';
    const after = applyBeliefFormation(snap(), text, ON, 4);
    expect(after.temporaryBeliefs).toHaveLength(DEFAULT_BELIEF_FORMATION_MAX_PER_TURN);
  });

  it('生成开启时临时信念最多保留 40 条（按置信度留高价值条目）', () => {
    const text = Array.from({ length: 50 }, (_, index) => `我意识到我一直在讨好别人第${index}次`).join('；');
    const after = applyBeliefFormation(snap(), text, { ...ON, formationMaxPerTurn: 50 }, 4);
    expect(after.temporaryBeliefs).toHaveLength(40);
    for (const item of after.temporaryBeliefs) expect(item.confidence).toBeGreaterThan(0);
  });
});

describe('AF-357 · ③ 过滤规则', () => {
  const cases: { readonly name: string; readonly text: string }[] = [
    { name: '问句', text: '我意识到我一直在讨好别人吗' },
    { name: '第三人称转述', text: '我意识到他说我一直在讨好别人' },
    { name: '否定式（标记后置否定）', text: '我似乎没有意识到我很容易焦虑' },
    { name: '否定式（标记后置否定）', text: '我好像没发现自己很生气' },
    { name: '句中疑问结构', text: '我发现我是不是太敏感了' },
    { name: '第三方转述', text: '我发现我朋友说我一直在讨好别人' },
    { name: '危机词', text: '我意识到我想死' },
    { name: '过短', text: '我发现我累' },
    { name: '过长', text: `我发现${'我'.repeat(100)}` },
    { name: '无第一人称', text: '发现一直在讨好别人' },
    { name: '无觉察标记', text: '我一直在讨好别人' },
  ];

  for (const item of cases) {
    it(`${item.name} → 不进入候选`, () => {
      expect(extractReflectiveStatements(item.text, ON)).toHaveLength(0);
    });
  }

  it('同一文本内重复候选只保留第一条', () => {
    const text = '我意识到我一直在讨好别人。我意识到我一直在讨好别人。';
    expect(extractReflectiveStatements(text, ON)).toHaveLength(1);
  });

  it('正常陈述可被提取，且保留原句未改写', () => {
    const text = '我意识到我一直在讨好别人';
    expect(extractReflectiveStatements(text, ON)).toEqual([text]);
  });

  it('否定宾语不是否定标记 → 仍可提取', () => {
    expect(extractReflectiveStatements('我发现我并不开心', ON)).toEqual(['我发现我并不开心']);
  });

  it('来访对第三方的观察不是转述 → 保留', () => {
    expect(extractReflectiveStatements('我发现她总是这样', ON)).toEqual(['我发现她总是这样']);
  });
});

describe('AF-357 · ④ 复读不强化、展开才强化（AF-358 语义）', () => {
  it('逐字复读 → 置信度与证据计数不动，只刷新最近观察轮次', () => {
    const before = snap({
      temporaryBeliefs: [belief({ confidence: 0.5, evidenceCount: 1, firstFormedAtTurn: 2, lastObservedAtTurn: 2 })],
    });
    const after = applyBeliefFormation(before, '我意识到我一直在讨好别人。', ON, 6);
    const item = after.temporaryBeliefs[0];
    expect(item.confidence).toBeCloseTo(0.5, 6);
    expect(item.evidenceCount).toBe(1);
    expect(item.firstFormedAtTurn).toBe(2);
    expect(item.lastObservedAtTurn).toBe(6);
  });

  it('同一条被展开（新句包含旧句且更长）→ 置信度递增、证据计数+1、陈述更新为更具体那句', () => {
    const before = snap({
      temporaryBeliefs: [belief({ confidence: 0.55, evidenceCount: 1, statement: '我意识到我一直在讨好别人' })],
    });
    const after = applyBeliefFormation(before, '我意识到我一直在讨好别人，怕被抛弃。', ON, 6);
    const item = after.temporaryBeliefs[0];
    expect(item.confidence).toBeCloseTo(0.65, 6);
    expect(item.evidenceCount).toBe(2);
    expect(item.statement).toBe('我意识到我一直在讨好别人，怕被抛弃');
  });

  it('已有高置信度 → 展开时取 max(existing, base)+递减增量', () => {
    const before = snap({ temporaryBeliefs: [belief({ confidence: 0.85 })] });
    const after = applyBeliefFormation(before, '我意识到我一直在讨好别人，怕被抛弃。', ON, 4);
    expect(after.temporaryBeliefs[0].confidence).toBeCloseTo(0.95, 6);
  });

  it('introduced 被逐字复读 → 不升级 observed（复读不构成独立观察）', () => {
    const before = snap({ temporaryBeliefs: [belief({ source: 'introduced', confidence: 0.3 })] });
    const after = applyBeliefFormation(before, '我意识到我一直在讨好别人。', ON, 4);
    expect(after.temporaryBeliefs[0].source).toBe('introduced');
  });

  it('规范化后相同（标点/空白差异）视为逐字复读，不增加证据计数', () => {
    const before = snap({ temporaryBeliefs: [belief({ statement: '我意识到  我一直在讨好别人！' })] });
    const after = applyBeliefFormation(before, '我意识到我一直在讨好别人。', ON, 4);
    expect(after.temporaryBeliefs).toHaveLength(1);
    expect(after.temporaryBeliefs[0].evidenceCount).toBe(1);
    expect(normalizeBeliefStatement('我意识到  我一直在讨好别人！')).toBe(normalizeBeliefStatement('我意识到我一直在讨好别人'));
  });
});

describe('AF-357 · ⑤ 演化顺序', () => {
  it('先生成新信念不衰减；旧信念本轮仍衰减', () => {
    const before = snap({
      temporaryBeliefs: [belief({ id: 'belief-old', statement: '我意识到我总在回避冲突', confidence: 1 })],
    });
    const after = applyBeliefEvolution(before, '今天天气不错', ON, {
      visitorText: '我意识到我一直在讨好别人。',
      turnNumber: 5,
    });
    const oldItem = after.temporaryBeliefs.find((item) => item.id === 'belief-old');
    const newItem = after.temporaryBeliefs.find((item) => item.statement === '我意识到我一直在讨好别人');
    expect(oldItem?.confidence).toBeLessThan(1);
    expect(newItem?.confidence).toBeCloseTo(DEFAULT_BELIEF_FORMATION_BASE_CONFIDENCE, 6);
  });

  it('不传 visitorText → 只衰减，不生成', () => {
    const before = snap({ temporaryBeliefs: [belief({ confidence: 1 })] });
    const after = applyBeliefEvolution(before, '今天天气不错', ON);
    expect(after.temporaryBeliefs).toHaveLength(1);
    expect(after.temporaryBeliefs[0].confidence).toBeLessThan(1);
  });

  it('显式只开开关、不填数值 → 用内核种子置信度生成', () => {
    const after = applyBeliefFormation(
      snap(),
      '我意识到我一直在讨好别人。',
      { ...DEFAULT_BELIEF_OPERATOR_CONFIG, formationEnabled: true },
      3,
    );
    expect(after.temporaryBeliefs[0].confidence).toBeCloseTo(DEFAULT_BELIEF_FORMATION_BASE_CONFIDENCE, 6);
    expect(after.temporaryBeliefs[0].evidenceCount).toBe(1);
  });

  it('同一条自我觉察被展开一次 → 置信度过 reflectiveBeliefGate，第 8 轮 insight 分支可达', () => {
    let snapshot = snap({ trust: 0.8, safety: 0.8, bond: 0.7, resistance: { verbal: 0.1, depth: 0.1, style: 0.1 } });
    snapshot = applyBeliefFormation(snapshot, '我意识到我一直在讨好别人。', ON, 4);
    snapshot = applyBeliefFormation(snapshot, '我意识到我一直在讨好别人，怕被抛弃。', ON, 5);

    const item = snapshot.temporaryBeliefs[0];
    expect(item.confidence).toBeCloseTo(0.65, 6);

    const intention = planIntention(snapshot, undefined, undefined, { turnNumber: 8 });
    expect(intention.strategy).toBe('insight');
  });
});
