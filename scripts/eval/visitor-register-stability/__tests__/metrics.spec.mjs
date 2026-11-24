// AF-465 · 纯函数单测：不依赖 3010/3011、不调用 LLM、不读真实台词.

import { expect, it } from 'vitest';

import {
  buildBlindPrompt,
  buildRoleSummary,
  countHits,
  evaluateGates,
  extractJsonObject,
  mapPreference,
  measureTurnExtras,
  parseBlindRating,
  percentile,
  round,
  summarizeSession,
} from '../metrics.mjs';

const dimensions = ['register_fit', 'stereotype_risk', 'cross_turn_stability', 'concreteness'];
const labels = {
  register_fit: '语域贴合',
  stereotype_risk: '刻板风险',
  cross_turn_stability: '跨轮稳定',
  concreteness: '具体度',
};
const anchors = {
  register_fit: { 1: 'a1', 2: 'a2', 3: 'a3', 4: 'a4', 5: 'a5' },
  stereotype_risk: { 1: 'b1', 2: 'b2', 3: 'b3', 4: 'b4', 5: 'b5' },
  cross_turn_stability: { 1: 'c1', 2: 'c2', 3: 'c3', 4: 'c4', 5: 'c5' },
  concreteness: { 1: 'd1', 2: 'd2', 3: 'd3', 4: 'd4', 5: 'd5' },
};

const register = {
  roleKey: 'vpt_fixture',
  identity: { ageBand: '45-54', occupation: '仓储主管', educationBand: 'basic', livingStatus: '独居', regionMacro: 'northeast' },
  vocabulary: { abstractTermBudget: 0.22, jargonBudget: 0.08, concreteAnchorDensity: 0.82 },
  syntax: { averageSentenceLength: 10, fragmentTolerance: 0.65, connectiveUse: 0.18 },
  stance: { directness: 'direct', politeness: 'plain', disclosure: 'guarded' },
  anchors: ['夜班', '仓库'],
  signatureLexicon: ['咋说呢', '整'],
  avoidLexicon: ['防御机制', '自我觉察'],
};

const validRating = {
  left: {
    register_fit: 4,
    stereotype_risk: 5,
    cross_turn_stability: 4,
    concreteness: 5,
    evidence: { register_fit: '夜班', stereotype_risk: '仓库', cross_turn_stability: '咋说呢', concreteness: '监控' },
  },
  right: {
    register_fit: 2,
    stereotype_risk: 3,
    cross_turn_stability: 2,
    concreteness: 2,
    evidence: { register_fit: '感受', stereotype_risk: '总结', cross_turn_stability: '情绪', concreteness: '分析' },
  },
  preference: 'left',
  confidence: 4,
};

it('计数命中与单轮附加指标', () => {
  const extras = measureTurnExtras('我理解你的感受，建议你可以试试。夜班仓库，咋说呢。', register);
  expect(countHits('夜班仓库夜班', register.anchors)).toBe(3);
  expect(extras.signatureHits).toBe(1);
  expect(extras.anchorTypes).toBe(2);
  expect(extras.assistantToneHits).toBe(1);
  expect(extras.adviceHits).toBe(2);
});

it('角色摘要不暴露 roleKey', () => {
  const summary = buildRoleSummary(register);
  expect(summary).toContain('仓储主管');
  expect(summary).not.toContain('vpt_fixture');
  expect(summary).not.toContain('base');
});

it('盲评提示词不出现模式标签', () => {
  const prompt = buildBlindPrompt({
    roleSummary: buildRoleSummary(register),
    leftTurns: ['甲一'],
    rightTurns: ['乙一'],
    dimensions,
    labels,
    anchors,
    turnNumbers: [1],
  });
  expect(prompt).toContain('【甲】');
  expect(prompt).toContain('【乙】');
  expect(prompt).not.toMatch(/base|active|mode/iu);
});

it('从代码块或前后说明中抽 JSON', () => {
  expect(extractJsonObject('说明\n```json\n{"a":1}\n```')).toEqual({ a: 1 });
  expect(extractJsonObject('前缀 {"a":1} 后缀')).toEqual({ a: 1 });
  expect(extractJsonObject('没有 JSON')).toBeNull();
});

it('校验合法盲评并映射偏好', () => {
  const parsed = parseBlindRating(JSON.stringify(validRating), dimensions);
  expect(parsed).not.toBeNull();
  expect(parsed.sides.left.scores.register_fit).toBe(4);
  expect(mapPreference('left', 'active')).toBe('active');
  expect(mapPreference('left', 'base')).toBe('base');
  expect(mapPreference('tie', 'base')).toBe('tie');
});

it('拒绝缺维/证据为空的盲评', () => {
  const missing = { ...validRating, left: { ...validRating.left, concreteness: undefined } };
  expect(parseBlindRating(JSON.stringify(missing), dimensions)).toBeNull();
  const emptyEvidence = {
    ...validRating,
    right: { ...validRating.right, evidence: { ...validRating.right.evidence, register_fit: '' } },
  };
  expect(parseBlindRating(JSON.stringify(emptyEvidence), dimensions)).toBeNull();
  const badPreference = { ...validRating, preference: 'A' };
  expect(parseBlindRating(JSON.stringify(badPreference), dimensions)).toBeNull();
});

it('分位数与四舍五入', () => {
  expect(percentile([1, 2, 3, 4], 0.5)).toBe(2.5);
  expect(round(1.2345, 2)).toBe(1.23);
});

it('汇总一场会话不保留原文', () => {
  const rows = [1, 2].map((turnIndex) => ({
    turnIndex,
    reply: turnIndex === 1 ? '夜班，咋说呢。' : '仓库就我一个人。',
    promptFull: '你说话的样子（只影响用词，不改内容和情绪）：\n句短',
    llmUsage: { promptTokens: 10, completionTokens: 5 },
    wallMs: 100,
    crisis: { detected: false },
    degraded: false,
  }));
  const summary = summarizeSession(
    rows,
    register,
    (text) => ({
      roleKey: register.roleKey,
      charCount: text.length,
      sentenceCount: 1,
      averageSentenceLength: text.length,
      fragmentRate: 1,
      abstractTermRate: 0,
      jargonRate: 0,
      signatureHitRate: text.includes('咋说呢') ? 0.5 : 0,
      anchorDensity: text.includes('仓库') ? 1 : 0,
    }),
    (items) => items[0],
  );
  expect(summary.turns).toBe(2);
  expect(summary.prompt.registerTurnCount).toBe(2);
  expect(summary.extras.charCount).toBeGreaterThan(0);
  expect(JSON.stringify(summary)).not.toContain('夜班，咋说呢');
});

it('门槛：方向 8/10、无回归时通过', () => {
  const roles = Array.from({ length: 10 }, (_, index) => makeRole(`r${index}`, index < 8 ? 'active' : 'base'));
  const result = evaluateGates(roles);
  expect(result.gates.direction.pass).toBe(true);
  expect(result.gates.stereotype.pass).toBe(true);
  expect(result.gates.stability.pass).toBe(true);
  expect(result.gates.bdiGuardrail.pass).toBe(true);
  expect(result.gates.cost.pass).toBe(true);
  expect(result.gates.noHarm.pass).toBe(true);
});

it('门槛：8 个可用角色时按同等比例取 7/8', () => {
  const roles = Array.from({ length: 8 }, (_, index) => makeRole(`r${index}`, index < 7 ? 'active' : 'base'));
  const result = evaluateGates(roles);
  expect(result.gates.coverage.pass).toBe(true);
  expect(result.gates.direction.pass).toBe(true);
  expect(result.gates.direction.threshold).toBe(7);
  expect(result.gates.stereotype.threshold).toBe(8);
  expect(result.gates.stability.threshold).toBe(7);
});

it('门槛：方向不足 8/10 时失败', () => {
  const roles = Array.from({ length: 10 }, (_, index) => makeRole(`r${index}`, index < 7 ? 'active' : 'base'));
  const result = evaluateGates(roles);
  expect(result.gates.direction.pass).toBe(false);
});

function makeRole(roleKey, direction) {
  const fit = direction === 'active' ? 4 : 3;
  return {
    roleKey,
    direction,
    blind: {
      base: { register_fit: { mean: 3 }, stereotype_risk: { mean: 4 }, cross_turn_stability: { mean: 4 }, concreteness: { mean: 3 } },
      active: { register_fit: { mean: fit }, stereotype_risk: { mean: 4 }, cross_turn_stability: { mean: 4 }, concreteness: { mean: 4 } },
    },
    metrics: {
      base: {
        turns: 30,
        prompt: { averageChars: 1800, registerTurnCount: 0 },
        last10: { signatureHitRate: 0.2 },
        metrics: { signatureHitRate: 0.2 },
        latency: { p95Ms: 100 },
      },
      active: {
        turns: 30,
        prompt: { averageChars: 2100, registerTurnCount: 30 },
        last10: { signatureHitRate: 0.2 },
        metrics: { signatureHitRate: 0.2 },
        latency: { p95Ms: 100 },
      },
    },
    harm: {
      base: { assistantTonePer100: 0, advicePer100: 0, labelPer100: 0, abstractTermRate: 0, jargonRate: 0 },
      active: { assistantTonePer100: 0, advicePer100: 0, labelPer100: 0, abstractTermRate: 0, jargonRate: 0 },
    },
    guardrail: { bdiMismatchTurns: 0 },
  };
}
