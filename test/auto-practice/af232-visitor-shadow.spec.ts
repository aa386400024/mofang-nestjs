// V2026-11-22 建立 (AF-232 · 影子对照纯函数测试):
//   覆盖: 文本清洗、语义标记、年龄冲突、客观指标、盲评聚合、预登记门槛、prompt 变体.

import { describe, expect, it } from 'vitest';

import {
  analyzeArmObjective,
  analyzeArmScores,
  auditInsightLabels,
  evaluateGates,
  hasAgeConflict,
  invalidSemanticTags,
  projectVisitorSpeech,
  sanitizeVisitorText,
  visibleLength,
  type SimScoredSession,
  type SimSessionRecord,
  type SimTurnRecord,
} from '../../bin/visitor-sim-analysis.js';
import {
  buildSeedV2VisitorPrompt,
  buildSeedV3Constraints,
  buildSeedV3VisitorPrompt,
  buildSeedV4VisitorPrompt,
  buildSeedVisitorPrompt,
  buildSharedVisitorPrompt,
  buildVisitorPrompt,
  COUNSELOR_SCRIPT,
  SEED_V2_VISITOR_CONSTRAINTS,
  SEED_V4_VISITOR_CONSTRAINTS,
  SEED_VISITOR_CONSTRAINTS,
} from '../../bin/visitor-sim-prompts.js';
import { VISITOR_POOL_TEMPLATE_SEEDS } from '../../src/counselor/config/visitor-pool-seed.js';

const seed = VISITOR_POOL_TEMPLATE_SEEDS.find((item) => item.id === 'vpt_grief_avoidance_l1');
if (seed === undefined) throw new Error('测试缺少 grief persona');

function makeTurn(visitor: string, overrides: Partial<SimTurnRecord> = {}): SimTurnRecord {
  return {
    turnIndex: 1,
    counselor: '咨询师话术',
    visitor,
    firstTokenMs: 300,
    totalMs: 900,
    promptTokens: 100,
    completionTokens: 10,
    reasoningTokens: 0,
    finishReason: 'stop',
    ...overrides,
  };
}

function makeSession(arm: string, turns: readonly SimTurnRecord[], overrides: Partial<SimSessionRecord> = {}): SimSessionRecord {
  return {
    sessionId: `session_${arm}`,
    arm,
    provider: arm === 'A' || arm === 'D' ? 'minimax' : 'doubao',
    model: arm === 'A' || arm === 'D' ? 'MiniMax-M3' : 'doubao-seed-character-260628',
    promptVariant: arm === 'C' || arm === 'D' ? 'seed-v1' : arm === 'E' ? 'seed-v2' : 'shared',
    personaId: 'vpt_grief_avoidance_l1',
    personaLabel: '念安',
    difficulty: 'L3',
    scene: 'online_text',
    turns,
    ...overrides,
  };
}

function normalTurns(count: number): SimTurnRecord[] {
  return Array.from({ length: count }, (_, index) =>
    makeTurn(index % 3 === 0 ? '嗯，还行。' : index % 3 === 1 ? '不知道怎么说。' : '没什么，就那样。', {
      turnIndex: index + 1,
      firstTokenMs: 100 + index * 20,
    }),
  );
}

function variedNormalTurns(): SimTurnRecord[] {
  return [
    makeTurn('嗯。', { turnIndex: 1, firstTokenMs: 300 }),
    makeTurn('其实也不是多大的事，就是有时候会突然想起来。', { turnIndex: 2, firstTokenMs: 320 }),
    makeTurn('不知道。', { turnIndex: 3, firstTokenMs: 340 }),
    makeTurn('说了也没用。', { turnIndex: 4, firstTokenMs: 360 }),
  ];
}

function scoresFor(overall: readonly [number, number, number]): SimScoredSession['scores'] {
  return [
    {
      raterId: 'R1',
      provider: 'minimax',
      model: 'MiniMax-M3.1-Flash',
      dimensions: {
        naturalness: overall[0],
        emotional_continuity: overall[1],
        turn_shape: overall[2],
        scene_congruence: overall[0],
        relational_presence: overall[1],
      },
      overall: overall[0],
      parseRetries: 0,
      promptTokens: 100,
      completionTokens: 20,
      reasoningTokens: 0,
    },
    {
      raterId: 'R2',
      provider: 'doubao',
      model: 'doubao-seed-2-1-lite-260915',
      dimensions: {
        naturalness: overall[1],
        emotional_continuity: overall[2],
        turn_shape: overall[0],
        scene_congruence: overall[1],
        relational_presence: overall[2],
      },
      overall: overall[1],
      parseRetries: 0,
      promptTokens: 100,
      completionTokens: 20,
      reasoningTokens: 0,
    },
  ];
}

describe('AF-232 文本与语义标记', () => {
  it('清洗 think 块、角色前缀和外层引号', () => {
    expect(sanitizeVisitorText('<think>hidden</think> 来访者：“我不知道。”')).toBe('我不知道。');
  });

  it('可见字数不计语义标记与空白', () => {
    expect(visibleLength('[sigh] 我 不 知道 [pause:1.2]')).toBe(4);
  });

  it('只接受白名单语义标记', () => {
    expect(invalidSemanticTags('[sigh] 好 [pause:1.2] [emotion:sad]')).toEqual([]);
    expect(invalidSemanticTags('[cry] 好 [pause:abc] [emotion:angry]')).toEqual(['[cry]', '[pause:abc]']);
  });

  it('年龄自报超出模板区间 ±2 岁才算人设冲突', () => {
    expect(hasAgeConflict('我今年52岁。', '46-58')).toBe(false);
    expect(hasAgeConflict('我今年30岁。', '46-58')).toBe(true);
    expect(hasAgeConflict('我今年70岁。', '46-58')).toBe(true);
  });
});

describe('AF-232 客观指标', () => {
  it('短答/回避来访者不产生 AI 暴露、建议、总结、剧情推进', () => {
    const objective = analyzeArmObjective([makeSession('A', normalTurns(12))]);
    expect(objective.overall.aiRevealCount).toBe(0);
    expect(objective.overall.adviceCount).toBe(0);
    expect(objective.overall.summaryCount).toBe(0);
    expect(objective.overall.plotCount).toBe(0);
    expect(objective.overall.shortTurnRate).toBe(1);
    expect(objective.overall.firstTokenP95Ms).toBe(100 + 11 * 20);
  });

  it('整体首 token P95 按全部轮次样本计算，不被单场慢轮取 max 抬升', () => {
    const sampleTurns = (sessionId: string, withSlowTurn: boolean): SimSessionRecord =>
      makeSession(
        'C',
        Array.from({ length: 20 }, (_, index) =>
          makeTurn('嗯。', {
            turnIndex: index + 1,
            firstTokenMs: withSlowTurn && index === 19 ? 3000 : 100 + index,
            totalMs: withSlowTurn && index === 19 ? 6000 : 200 + index,
          }),
        ),
        { sessionId, difficulty: 'L3' },
      );
    const objective = analyzeArmObjective([sampleTurns('s1', true), sampleTurns('s2', true), sampleTurns('s3', false)]);
    expect(objective.overall.firstTokenP95Ms).toBeLessThan(1000);
    expect(objective.overall.totalP95Ms).toBeLessThan(1000);
  });

  it('过度配合会同时抬高建议、提问、超长与配合指数', () => {
    const text =
      '我觉得你应该先记录一下情绪，这样你会更清楚，而且你也可以试着每天写一点，最好现在就试试看，不然你会一直拖着，最后越来越难受，你说是不是？';
    const objective = analyzeArmObjective([
      makeSession(
        'C',
        Array.from({ length: 12 }, (_, index) => makeTurn(text, { turnIndex: index + 1 })),
      ),
    ]);
    expect(objective.overall.adviceCount).toBe(12);
    expect(objective.overall.questionTurnCount).toBe(12);
    expect(objective.overall.longTurnCount).toBe(12);
    expect(objective.overall.longTurnRate).toBe(1);
    expect(objective.overall.cooperationIndex).toBeGreaterThan(2);
  });

  it('AI 暴露、年龄冲突、非法标记、截断分别计数', () => {
    const objective = analyzeArmObjective([
      makeSession('C', [
        makeTurn('我只是一个 AI 助手，不能扮演真人。', { turnIndex: 1 }),
        makeTurn('我今年30岁，[cry] 不想说。', { turnIndex: 2, finishReason: 'length' }),
      ]),
    ]);
    expect(objective.overall.aiRevealCount).toBe(1);
    expect(objective.overall.personaConflictCount).toBe(1);
    expect(objective.overall.tagErrorCount).toBe(1);
    expect(objective.overall.truncationCount).toBe(1);
    expect(objective.overall.tagErrorRate).toBe(0.5);
  });

  it('语音投影剥掉括号动作，空台词补成可朗读停顿', () => {
    expect(projectVisitorSpeech('（低头）不想说。')).toBe('不想说。');
    expect(projectVisitorSpeech('（保持沉默，没有主动开口的意思）')).toBe('[pause:0.5]');
    expect(projectVisitorSpeech('*叹气* 算了。')).toBe('算了。');
    expect(projectVisitorSpeech('（沉默片刻）……')).toBe('……');
  });

  it('括号动作与星号动作单独计数，不能被当成正常台词', () => {
    const raw1 = '（低头）不想说。';
    const raw2 = '*叹气* 算了。';
    const objective = analyzeArmObjective([
      makeSession('C', [
        makeTurn(projectVisitorSpeech(raw1), { turnIndex: 1, visitorRaw: raw1 }),
        makeTurn(projectVisitorSpeech(raw2), { turnIndex: 2, visitorRaw: raw2 }),
      ]),
    ]);
    expect(objective.overall.stageDirectionCount).toBe(0);
    expect(objective.overall.rawStageDirectionCount).toBe(2);
    expect(objective.overall.rawStageDirectionRate).toBe(1);
  });

  it('分难度指标独立聚合，L3 短答率可按 baseline 比较', () => {
    const l3 = makeSession('C', normalTurns(12), { sessionId: 's_l3', difficulty: 'L3' });
    const l1 = makeSession('C', normalTurns(12), { sessionId: 's_l1', difficulty: 'L1' });
    const objective = analyzeArmObjective([l1, l3]);
    expect(objective.byDifficulty.find((item) => item.difficulty === 'L3')?.shortTurnRate).toBe(1);
    expect(objective.byDifficulty.find((item) => item.difficulty === 'L1')?.turns).toBe(12);
  });
});

describe('AF-232 盲评聚合与门槛', () => {
  it('盲评均分、分布、绝对差与跨评分员一致性可复算', () => {
    const scores = analyzeArmScores([
      { sessionId: 's1', arm: 'A', difficulty: 'L3', scores: scoresFor([4, 3, 2]) },
      { sessionId: 's2', arm: 'A', difficulty: 'L3', scores: scoresFor([3, 3, 2]) },
      { sessionId: 's3', arm: 'A', difficulty: 'L3', scores: scoresFor([2, 2, 2]) },
    ]);
    expect(scores.sessions).toBe(3);
    expect(scores.meanOverall).toBe(2.833333);
    expect(scores.distribution['4']).toBe(1);
    expect(scores.fourRate).toBe(0.166667);
    expect(scores.meanAbsOverallDelta).toBe(0.333333);
    expect(scores.agreement.exactAgreement).toBeCloseTo(0.666667, 5);
    expect(scores.dimensionAgreement.naturalness.linearWeightedKappa).not.toBeNull();
  });

  it('正常 Seed 臂过门槛，出现 AI 暴露的臂硬失败', () => {
    const base = makeSession('A', variedNormalTurns(), { sessionId: 'base', difficulty: 'L3' });
    const good = makeSession('C', variedNormalTurns(), { sessionId: 'good', difficulty: 'L3' });
    const bad = makeSession('C', [makeTurn('我只是一个 AI 助手。', { turnIndex: 1 })], { sessionId: 'bad', difficulty: 'L3' });
    const objectives = [analyzeArmObjective([base]), analyzeArmObjective([good, bad])];
    const ratings: SimScoredSession[] = [
      { sessionId: 'base', arm: 'A', difficulty: 'L3', scores: scoresFor([4, 3, 2]) },
      { sessionId: 'good', arm: 'C', difficulty: 'L3', scores: scoresFor([4, 3, 2]) },
      { sessionId: 'bad', arm: 'C', difficulty: 'L3', scores: scoresFor([4, 3, 2]) },
    ];
    const scores = [analyzeArmScores([ratings[0]]), analyzeArmScores(ratings.slice(1))];
    const verdicts = evaluateGates({ objectives, scores, baselineArm: 'A', seedArms: ['C'], thinkingDisabled: true });
    expect(verdicts.gates.find((gate) => gate.arm === 'C' && gate.id === 'ai-reveal-zero')?.passed).toBe(false);
    expect(verdicts.verdicts.find((verdict) => verdict.arm === 'C')?.hardFailures).toContain('ai-reveal-zero');
  });

  it('盲评包缺失时仍输出客观硬门槛，并把缺失盲评记为硬失败', () => {
    const base = makeSession('A', variedNormalTurns(), { sessionId: 'base', difficulty: 'L3' });
    const seed = makeSession('C', variedNormalTurns(), { sessionId: 'seed', difficulty: 'L3' });
    const objectives = [analyzeArmObjective([base]), analyzeArmObjective([seed])];
    const scores = [analyzeArmScores([{ sessionId: 'base', arm: 'A', difficulty: 'L3', scores: scoresFor([4, 3, 2]) }])];
    const { gates, verdicts } = evaluateGates({ objectives, scores, baselineArm: 'A', seedArms: ['C'], thinkingDisabled: true });
    expect(gates.find((gate) => gate.arm === 'C' && gate.id === 'stage-direction-zero')?.passed).toBe(true);
    expect(gates.find((gate) => gate.arm === 'C' && gate.id === 'blind-score-missing')?.passed).toBe(false);
    expect(verdicts.find((verdict) => verdict.arm === 'C')?.hardFailures).toContain('blind-score-missing');
  });

  it('正常臂的软门槛按 baseline 均值、κ、绝对差、长度 std、4 分率与配合指数计算', () => {
    const base = makeSession('A', variedNormalTurns(), { sessionId: 'base', difficulty: 'L3' });
    const seed = makeSession('C', variedNormalTurns(), { sessionId: 'seed', difficulty: 'L3' });
    const objectives = [analyzeArmObjective([base]), analyzeArmObjective([seed])];
    const scores = [
      analyzeArmScores([{ sessionId: 'base', arm: 'A', difficulty: 'L3', scores: scoresFor([4, 3, 2]) }]),
      analyzeArmScores([{ sessionId: 'seed', arm: 'C', difficulty: 'L3', scores: scoresFor([4, 3, 2]) }]),
    ];
    const { gates, verdicts } = evaluateGates({ objectives, scores, baselineArm: 'A', seedArms: ['C'], thinkingDisabled: true });
    expect(gates.find((gate) => gate.arm === 'C' && gate.id === 'mean-vs-baseline')?.passed).toBe(true);
    expect(gates.find((gate) => gate.arm === 'C' && gate.id === 'four-rate')?.passed).toBe(true);
    expect(gates.find((gate) => gate.arm === 'C' && gate.id === 'cooperation-vs-baseline')?.passed).toBe(true);
    expect(verdicts[0]?.hardPassed).toBe(true);
  });
});

describe('AF-232 prompt 变体', () => {
  it('固定脚本 12 轮，覆盖过早建议、沉默与面质', () => {
    expect(COUNSELOR_SCRIPT).toHaveLength(12);
    expect(COUNSELOR_SCRIPT.some((line) => line.includes('试着'))).toBe(true);
    expect(COUNSELOR_SCRIPT).toContain('……');
    expect(COUNSELOR_SCRIPT.some((line) => line.includes('避免让别人失望'))).toBe(true);
  });

  it('seed-v1 在生产同构 prompt 之后追加不推进剧情约束', () => {
    const shared = buildSharedVisitorPrompt(seed, 'L3');
    const seeded = buildSeedVisitorPrompt(seed, 'L3');
    expect(seeded.startsWith(shared)).toBe(true);
    expect(seeded).toContain(SEED_VISITOR_CONSTRAINTS);
    expect(seeded).toContain('不主动激活对话');
    expect(seeded).toContain('输出格式（硬约束');
    expect(buildVisitorPrompt(seed, 'L3', 'shared')).toBe(shared);
  });

  it('seed-v2 在 seed-v1 之后追加合作压制约束，并覆盖 V1 反问额度', () => {
    const seeded = buildSeedVisitorPrompt(seed, 'L3');
    const v2 = buildSeedV2VisitorPrompt(seed, 'L3');
    expect(v2.startsWith(seeded)).toBe(true);
    expect(v2).toContain(SEED_V2_VISITOR_CONSTRAINTS);
    expect(v2).toContain('不向咨询师提问');
    expect(v2).toContain('上面的“每 4 轮最多一个反问”在 V2 中作废');
    expect(v2).toContain('每 3 轮最多 1 轮直接回答核心问题');
    expect(buildVisitorPrompt(seed, 'L3', 'seed-v2')).toBe(v2);
    expect(buildVisitorPrompt(seed, 'L3', 'seed-v1')).toBe(seeded);
  });

  it('seed-v3 在 seed-v2 之后按难度追加预算，且 L1/L3 预算可区分', () => {
    const v2 = buildSeedV2VisitorPrompt(seed, 'L1');
    const l1 = buildSeedV3VisitorPrompt(seed, 'L1');
    const l3 = buildSeedV3VisitorPrompt(seed, 'L3');
    expect(l1.startsWith(v2)).toBe(true);
    expect(l1).toContain(buildSeedV3Constraints('L1'));
    expect(l1).toContain('每 2 轮最多 1 轮直接回答核心问题');
    expect(l1).toContain('不超过 1 轮');
    expect(l3).toContain('每 4 轮最多 1 轮直接回答核心问题');
    expect(l3).toContain('不超过 2 轮');
    expect(l1).not.toBe(l3);
    expect(buildVisitorPrompt(seed, 'L1', 'seed-v3')).toBe(l1);
    expect(buildVisitorPrompt(seed, 'L3', 'seed-v3')).toBe(l3);
  });

  it('seed-v4 在 seed-v2 之后只加洞察收敛约束', () => {
    const v2 = buildSeedV2VisitorPrompt(seed, 'L1');
    const v4 = buildSeedV4VisitorPrompt(seed, 'L1');
    expect(v4.startsWith(v2)).toBe(true);
    expect(v4).toContain(SEED_V4_VISITOR_CONSTRAINTS);
    expect(v4).toContain('抽象心理词全场最多出现一次');
    expect(v4).toContain('必须立刻收回、自嘲或转移');
    expect(v4).toContain('不设计治疗性弧线');
    expect(buildVisitorPrompt(seed, 'L1', 'seed-v4')).toBe(v4);
    expect(buildVisitorPrompt(seed, 'L1', 'seed-v2')).toBe(v2);
  });

  it('抽象心理词审计按 arm 统计场次与次数，同场多次只计一次场次', () => {
    const sessions = [
      makeSession('E', [makeTurn('可能是……不配得感？'), makeTurn('不配得感，不配得感。')]),
      makeSession('E', [makeTurn('就是有点空。')]),
      makeSession('G', [makeTurn('我意识到，其实我是因为怕被否定。')]),
    ];
    const rows = auditInsightLabels(sessions);
    const e = rows.find((row) => row.arm === 'E');
    const g = rows.find((row) => row.arm === 'G');
    expect(e).toMatchObject({ sessions: 2, sessionsWithLabel: 1, occurrences: 3 });
    expect(e?.byLabel['不配得感']).toBe(3);
    expect(g).toMatchObject({ sessions: 1, sessionsWithLabel: 1, occurrences: 2 });
    expect(g?.byLabel['意识到']).toBe(1);
    expect(g?.byLabel['其实我']).toBe(1);
  });
});
