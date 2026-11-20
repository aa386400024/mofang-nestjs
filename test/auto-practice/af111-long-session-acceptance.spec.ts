// V2026-11-19 Phase2.5 AF-111 (long-session 候选口径 + 盲标纯函数 · 单测):
//   覆盖:
//     ① 三段边界 (1–12 / 13–40 / 41+) 与 phase 归属;
//     ② 阶段汇总只统计有 BDI 的点, 平均值 round6;
//     ③ 候选评估 gateEligible 恒 false, 9 条锚点 / 3 段结构;
//     ④ 盲标 packet 去除身份字段 (characterSlug / title / mode / id);
//     ⑤ 线性加权 kappa / exact / ±1 一致率 / 仲裁清单.
//   全纯函数, 不起 Nest, 不连 DB, 不读真实批次.

import { describe, expect, it } from 'vitest';

import { parseModes, selectBalancedSessions } from '../../bin/long-session-acceptance.js';
import {
  LONG_SESSION_ACCEPTANCE_STATUS,
  LONG_SESSION_ACCEPTANCE_VERSION,
  LONG_SESSION_DIMENSIONS,
  LONG_SESSION_PHASES,
  LONG_SESSION_REVIEW_ANCHORS,
  buildBlindPacket,
  computeLinearWeightedKappa,
  evaluateLongSessionCandidate,
  findAdjudicationCases,
  resolveLongSessionPhase,
  summarizeAgreement,
  summarizeLongSession,
  type LongSessionBdiSnapshot,
  type LongSessionTracePoint,
  type RatingPair,
} from '../../src/auto-practice/metrics/long-session-acceptance.js';

function bdi(overrides: Partial<LongSessionBdiSnapshot> = {}): LongSessionBdiSnapshot {
  return {
    trust: 0.3,
    safety: 0.4,
    bond: 0.5,
    resistanceVerbal: 0.6,
    resistanceDepth: 0.7,
    resistanceStyle: 0.8,
    arousal: 0.2,
    ...overrides,
  };
}

describe('Phase2.5 · long-session 候选验收口径', () => {
  it('① 三段边界：1–12 建立，13–40 工作，41+ 收尾', () => {
    expect(LONG_SESSION_PHASES.map((phase) => phase.id)).toEqual(['engagement', 'working', 'closing']);
    expect(resolveLongSessionPhase(1)).toBe('engagement');
    expect(resolveLongSessionPhase(12)).toBe('engagement');
    expect(resolveLongSessionPhase(13)).toBe('working');
    expect(resolveLongSessionPhase(40)).toBe('working');
    expect(resolveLongSessionPhase(41)).toBe('closing');
    expect(resolveLongSessionPhase(50)).toBe('closing');
    expect(() => resolveLongSessionPhase(Number.NaN)).toThrow();
  });

  it('② 阶段汇总只统计有 BDI 的点，空段 turns=0、均值为 null', () => {
    const points: LongSessionTracePoint[] = [
      { turnIndex: 1, bdiSnapshot: bdi({ trust: 0.2 }) },
      { turnIndex: 12, bdiSnapshot: bdi({ trust: 0.4 }) },
      { turnIndex: 13, bdiSnapshot: bdi({ trust: 0.6 }) },
      { turnIndex: 14, bdiSnapshot: null },
      { turnIndex: 41, bdiSnapshot: bdi({ trust: 0.8 }) },
    ];
    const summaries = summarizeLongSession(points);
    expect(summaries).toHaveLength(3);
    expect(summaries[0]).toMatchObject({ phase: 'engagement', turns: 2 });
    expect(summaries[0].dimensions.trust).toBe(0.3);
    expect(summaries[1]).toMatchObject({ phase: 'working', turns: 1 });
    expect(summaries[1].dimensions.trust).toBe(0.6);
    expect(summaries[2]).toMatchObject({ phase: 'closing', turns: 1 });
    expect(summaries[2].dimensions.trust).toBe(0.8);
  });

  it('③ 候选评估不产生 PASS/FAIL：gateEligible=false，锚点 9 条', () => {
    const evaluation = evaluateLongSessionCandidate([
      { turnIndex: 1, bdiSnapshot: bdi() },
      { turnIndex: 50, bdiSnapshot: bdi() },
    ]);
    expect(evaluation.version).toBe(LONG_SESSION_ACCEPTANCE_VERSION);
    expect(evaluation.status).toBe(LONG_SESSION_ACCEPTANCE_STATUS);
    expect(evaluation.gateEligible).toBe(false);
    expect(evaluation.anchors).toHaveLength(9);
    expect(evaluation.anchors.map((anchor) => anchor.phase)).toEqual(expect.arrayContaining(['engagement', 'working', 'closing']));
    expect(evaluation.disclaimer).toContain('不产生 PASS/FAIL');
  });
});

describe('Phase2.5 · 双人盲标数据形状', () => {
  it('④ packet 只保留轮次/角色/文本，不携带身份字段', () => {
    const transcript = {
      id: 'debug_secret-id',
      title: 'secret-title',
      characterSlug: 'secret-character',
      characterLabel: 'secret-label',
      counselorModeId: 'secret-mode',
      messages: [
        { role: 'counselor', text: '你好。<think>内部推理不要外泄</think>', turnIndex: 1 },
        { role: 'visitor', text: '我最近有点累。', turnIndex: 1 },
        { role: 'system', text: '不应进入 packet', turnIndex: 2 },
        { role: 'visitor', text: ' '.repeat(3), turnIndex: 2 },
      ],
    };
    const packet = buildBlindPacket(transcript, 'packet-01');
    const serialized = JSON.stringify(packet);
    expect(serialized).not.toContain('secret-id');
    expect(serialized).not.toContain('secret-title');
    expect(serialized).not.toContain('secret-character');
    expect(serialized).not.toContain('secret-label');
    expect(serialized).not.toContain('secret-mode');
    expect(serialized).not.toContain('内部推理');
    expect(packet.turns).toHaveLength(2);
    expect(packet.turns[0]).toMatchObject({ turnIndex: 1, role: 'counselor', text: '你好。' });
  });

  it('⑤ 线性加权 kappa：完全一致=1，系统反向<0，单对=null', () => {
    expect(computeLinearWeightedKappa([1, 2, 3, 4, 5], [1, 2, 3, 4, 5])).toBe(1);
    expect(computeLinearWeightedKappa([1, 2, 3, 4, 5], [5, 4, 3, 2, 1])).toBeLessThan(0);
    expect(computeLinearWeightedKappa([3], [3])).toBeNull();
    expect(() => computeLinearWeightedKappa([1, 2], [1])).toThrow();
    expect(() => computeLinearWeightedKappa([0, 2], [1, 2])).toThrow();
  });

  it('⑤ exact / ±1 一致率按评分对计算', () => {
    const pairs: RatingPair[] = [
      { packetId: 'p1', dimension: 'trust', rater1: 4, rater2: 4 },
      { packetId: 'p1', dimension: 'safety', rater1: 3, rater2: 4 },
      { packetId: 'p2', dimension: 'trust', rater1: 2, rater2: 5 },
    ];
    const summary = summarizeAgreement(pairs);
    expect(summary.n).toBe(3);
    expect(summary.exactAgreement).toBeCloseTo(1 / 3, 6);
    expect(summary.withinOneAgreement).toBeCloseTo(2 / 3, 6);
    expect(summary.linearWeightedKappa).not.toBeNull();
    expect(summarizeAgreement([])).toEqual({ n: 0, exactAgreement: 0, withinOneAgreement: 0, linearWeightedKappa: null });
  });

  it('⑤ 仲裁清单：任一维差>1 或评分人显式标记即入列', () => {
    const pairs: RatingPair[] = [
      { packetId: 'p1', dimension: 'trust', rater1: 4, rater2: 4 },
      { packetId: 'p2', dimension: 'depth', rater1: 2, rater2: 5 },
      { packetId: 'p3', dimension: 'style', rater1: 3, rater2: 3 },
    ];
    const cases = findAdjudicationCases(pairs, { flaggedPacketIds: ['p3'] });
    expect(cases.map((item) => item.packetId)).toEqual(['p2', 'p3']);
    expect(cases[0]).toMatchObject({ packetId: 'p2', maxGap: 3 });
    expect(cases[0].dimensions).toContain('depth');
    expect(cases[1].reason).toContain('标记');
  });

  it('⑥ 维度集合与锚点维度自洽', () => {
    for (const anchor of LONG_SESSION_REVIEW_ANCHORS) {
      if (anchor.dimension === 'process' || anchor.dimension === 'arousal') continue;
      expect(LONG_SESSION_DIMENSIONS).toContain(anchor.dimension);
    }
  });
});

describe('AF-177 · pack 取样分层（纯函数）', () => {
  it('parseModes：缺省 expert,cold；支持三档；拒绝未知档与空串', () => {
    expect(parseModes(null)).toEqual(['expert', 'cold']);
    expect(parseModes('cold,expert,intermediate')).toEqual(['cold', 'expert', 'intermediate']);
    expect(() => parseModes('cold,unknown')).toThrow('未支持');
    expect(() => parseModes('')).toThrow('不能为空');
  });

  it('48 packet：8 角色 × cold/expert/intermediate × 2 场，24 个 cell 各 2 场', () => {
    const roles = Array.from({ length: 8 }, (_, index) => `role-${index + 1}`);
    const modes = ['cold', 'expert', 'intermediate'];
    const sessions = roles.flatMap((characterSlug) =>
      modes.flatMap((counselorModeId) =>
        [1, 2].map((repeat) => ({
          debugSessionId: `${characterSlug}-${counselorModeId}-${repeat}`,
          characterSlug,
          counselorModeId,
          status: 'completed',
          turnCount: 50,
        })),
      ),
    );
    const picked = selectBalancedSessions({ batchId: 'synthetic', sessions }, 48, 20_261_120, modes);
    expect(picked).toHaveLength(48);
    const counts = new Map<string, number>();
    for (const session of picked) {
      const cell = `${session.characterSlug}::${session.counselorModeId}`;
      counts.set(cell, (counts.get(cell) ?? 0) + 1);
    }
    expect(counts.size).toBe(24);
    for (const count of counts.values()) expect(count).toBe(2);
  });
});
