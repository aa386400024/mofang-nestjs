// V2026-11-19 Phase2.5 AF-116 (AI 代理双盲纯函数单测):
//   覆盖评分解析 fail-closed、争议选择、仲裁合并、提示词独立性.
//   不触网、不读写仓库文件.

import { describe, expect, it } from 'vitest';

import {
  AI_DOUBLE_BLIND_DISCLAIMER,
  applySafetyCap,
  buildArbiterPrompt,
  buildRaterPrompt,
  computeClusterBootstrapKappa,
  computeGwetAc1,
  computeKrippendorffAlphaOrdinal,
  evaluateSafetyCap,
  findAiDisputes,
  mergeFinalRating,
  parseAiArbitrationOutput,
  parseAiRaterOutput,
  summarizeAiAgreement,
  type AiDispute,
  type AiRaterOutput,
} from '../../src/auto-practice/metrics/ai-double-blind.js';
import { type BlindPacket, type RatingPair } from '../../src/auto-practice/metrics/long-session-acceptance.js';

function packet(): BlindPacket {
  return {
    packetId: 'packet-01',
    turns: [
      { turnIndex: 1, role: 'visitor', text: '我不太确定要不要说。' },
      { turnIndex: 1, role: 'counselor', text: '你可以慢一点，也可以先不说。' },
      { turnIndex: 2, role: 'visitor', text: '最近上班总怕出错。' },
      { turnIndex: 2, role: 'counselor', text: '怕出错的时候，身体有什么感觉？' },
    ],
    disclaimer: 'candidate',
  };
}

function scores(
  values: Partial<Record<'trust' | 'safety' | 'bond' | 'depth' | 'verbal' | 'style' | 'overall', number>> = {},
): AiRaterOutput['scores'] {
  const defaults = { trust: 3, safety: 3, bond: 3, depth: 3, verbal: 3, style: 3, overall: 3 };
  return { ...defaults, ...values };
}

function rater(
  id: 'R1' | 'R2',
  values: Partial<Record<'trust' | 'safety' | 'bond' | 'depth' | 'verbal' | 'style' | 'overall', number>> = {},
  confidence = 4,
): AiRaterOutput {
  return {
    packetId: 'packet-01',
    raterId: id,
    scores: scores(values),
    evidence: [{ dimension: 'trust', turnIndex: 1, quote: '你可以慢一点' }],
    confidence,
    concerns: [],
  };
}

describe('parseAiRaterOutput', () => {
  it('解析合法 JSON 并保留证据', () => {
    const raw = JSON.stringify({
      packet_id: 'packet-01',
      scores: { trust: 4, safety: 3, bond: 4, depth: 2, verbal: 3, style: 4, overall: 3 },
      evidence: [{ dimension: 'trust', turn: 1, quote: '你可以慢一点' }],
      confidence: 4,
      concerns: ['来访者防御明显'],
    });
    const parsed = parseAiRaterOutput(raw, 'packet-01', 'R1');
    expect(parsed).not.toBeNull();
    expect(parsed!.scores.trust).toBe(4);
    expect(parsed!.evidence[0].turnIndex).toBe(1);
    expect(parsed!.confidence).toBe(4);
  });

  it('容忍 ```json 围栏与 think 块', () => {
    const raw = `\`\`\`json\n{"packet_id":"packet-01","scores":{"trust":3,"safety":3,"bond":3,"depth":3,"verbal":3,"style":3,"overall":3},"confidence":3}\n\`\`\``;
    expect(parseAiRaterOutput(`<think>先想一下</think>${raw}`, 'packet-01', 'R2')).not.toBeNull();
  });

  it('缺维度 / 分数越界 / packet 不匹配一律 fail closed', () => {
    const missing = JSON.stringify({ packet_id: 'packet-01', scores: { trust: 3 }, confidence: 3 });
    expect(parseAiRaterOutput(missing, 'packet-01', 'R1')).toBeNull();
    const outOfRange = JSON.stringify({
      packet_id: 'packet-01',
      scores: { trust: 6, safety: 3, bond: 3, depth: 3, verbal: 3, style: 3, overall: 3 },
      confidence: 3,
    });
    expect(parseAiRaterOutput(outOfRange, 'packet-01', 'R1')).toBeNull();
    const wrongPacket = JSON.stringify({
      packet_id: 'packet-02',
      scores: { trust: 3, safety: 3, bond: 3, depth: 3, verbal: 3, style: 3, overall: 3 },
      confidence: 3,
    });
    expect(parseAiRaterOutput(wrongPacket, 'packet-01', 'R1')).toBeNull();
  });
});

describe('findAiDisputes', () => {
  it('分差 >1 触发争议', () => {
    const disputes = findAiDisputes(rater('R1', { trust: 4 }), rater('R2', { trust: 2 }));
    expect(disputes).toHaveLength(1);
    expect(disputes[0].dimension).toBe('trust');
    expect(disputes[0].gap).toBe(2);
  });

  it('低置信度且分差 1 也触发争议', () => {
    const disputes = findAiDisputes(rater('R1', { trust: 4 }, 2), rater('R2', { trust: 3 }, 4));
    expect(disputes).toHaveLength(1);
    expect(disputes[0].reason).toContain('低置信度');
  });

  it('无分差不触发', () => {
    expect(findAiDisputes(rater('R1'), rater('R2'))).toHaveLength(0);
  });
});

describe('mergeFinalRating', () => {
  it('有仲裁用仲裁分，无仲裁用均分', () => {
    const r1 = rater('R1', { trust: 4, depth: 2 });
    const r2 = rater('R2', { trust: 2, depth: 4 });
    const disputes = findAiDisputes(r1, r2);
    const decisions = disputes.map((dispute): AiDispute & { final: number; reason: string } => ({
      ...dispute,
      final: 3,
      reason: '双方证据都有道理，取可接受档',
    }));
    const final = mergeFinalRating(r1, r2, decisions);
    expect(final.scores.trust).toBe(3);
    expect(final.scores.depth).toBe(3);
    expect(final.disputedDimensions).toEqual(['trust', 'depth']);
    expect(final.scores.overall).toBe(3);
  });

  it('无仲裁时取四舍五入均分', () => {
    const final = mergeFinalRating(rater('R1', { trust: 5 }), rater('R2', { trust: 4 }));
    expect(final.scores.trust).toBe(5);
    expect(final.disputedDimensions).toEqual([]);
  });

  it('packetId 不一致直接抛错', () => {
    const other = { ...rater('R2'), packetId: 'packet-02' };
    expect(() => mergeFinalRating(rater('R1'), other)).toThrow('packetId');
  });
});

describe('parseAiArbitrationOutput', () => {
  const disputes: AiDispute[] = [
    { packetId: 'packet-01', dimension: 'trust', rater1: 4, rater2: 2, gap: 2, reason: 'trust 分差 2' },
    { packetId: 'packet-01', dimension: 'depth', rater1: 2, rater2: 4, gap: 2, reason: 'depth 分差 2' },
  ];

  it('覆盖全部争议维度才通过', () => {
    const raw = JSON.stringify({
      packet_id: 'packet-01',
      decisions: [
        { dimension: 'trust', final: 3, reason: '结盟信号有限' },
        { dimension: 'depth', final: 3, reason: '有一次向内推进' },
      ],
      confidence: 4,
    });
    const parsed = parseAiArbitrationOutput(raw, 'packet-01', disputes);
    expect(parsed).not.toBeNull();
    expect(parsed!.decisions).toHaveLength(2);
  });

  it('缺一个争议维度即 fail closed', () => {
    const raw = JSON.stringify({
      packet_id: 'packet-01',
      decisions: [{ dimension: 'trust', final: 3, reason: '结盟信号有限' }],
      confidence: 4,
    });
    expect(parseAiArbitrationOutput(raw, 'packet-01', disputes)).toBeNull();
  });
});

describe('summarizeAiAgreement', () => {
  it('输出六维与 overall 的原始一致性', () => {
    const packetResults = [
      {
        rater1: rater('R1'),
        rater2: rater('R2'),
        final: mergeFinalRating(rater('R1'), rater('R2')),
      },
    ];
    const summary = summarizeAiAgreement(packetResults);
    expect(summary.rawOverall.n).toBe(1);
    expect(summary.rawByDimension.trust.n).toBe(1);
  });
});

describe('prompts', () => {
  it('R1/R2 提示词不同且都含 packet、锚点与免责声明', () => {
    const r1 = buildRaterPrompt({ raterId: 'R1', packet: packet() });
    const r2 = buildRaterPrompt({ raterId: 'R2', packet: packet() });
    expect(r1.system).not.toBe(r2.system);
    expect(r1.user).toContain('packet-01');
    expect(r1.user).toContain('engagement-alliance');
    expect(r1.system).toContain(AI_DOUBLE_BLIND_DISCLAIMER);
    expect(r2.user).toContain('working-rupture');
  });

  it('v4 口径：safety 上限已移到后处理，style 上限仍留在提示词内', () => {
    const r1 = buildRaterPrompt({ raterId: 'R1', packet: packet() });
    expect(r1.system).toContain('ai-proxy-v4');
    expect(r1.system).not.toContain('safety 不得高于 3');
    expect(r1.system).not.toContain('safety 不得高于 2');
    expect(r1.system).toContain('style 不得高于 3');
    expect(r1.system).toContain('由后处理按规则强制封顶');
    expect(r1.system).toContain('逐维档位判据');
    expect(r1.system).toContain('trust：5=来访者主动表达信任');
    expect(r1.system).toContain('算术平均四舍五入');
  });

  it('kappa 赛道两人同方法同锚点顺序，method-probe 保留 R2 倒序', () => {
    const k1 = buildRaterPrompt({ raterId: 'R1', packet: packet(), track: 'kappa' });
    const k2 = buildRaterPrompt({ raterId: 'R2', packet: packet(), track: 'kappa' });
    expect(k1.system).toContain('评分方法：证据优先');
    expect(k2.system).toContain('评分方法：证据优先');
    expect(k1.system).toContain('κ 赛道');
    expect(k2.system).toContain('κ 赛道');
    expect(k1.user.indexOf('engagement-alliance')).toBeLessThan(k1.user.indexOf('working-rupture'));
    expect(k2.user.indexOf('engagement-alliance')).toBeLessThan(k2.user.indexOf('working-rupture'));

    const m2 = buildRaterPrompt({ raterId: 'R2', packet: packet(), track: 'method-probe' });
    expect(m2.system).toContain('整体叙事');
    expect(m2.user.indexOf('working-rupture')).toBeLessThan(m2.user.indexOf('engagement-alliance'));
  });

  it('R3 只纳入争议维度', () => {
    const r1 = rater('R1', { trust: 4 });
    const r2 = rater('R2', { trust: 2 });
    const disputes = findAiDisputes(r1, r2);
    const prompt = buildArbiterPrompt({ packet: packet(), rater1: r1, rater2: r2, disputes });
    expect(prompt.user).toContain('争议维度：trust');
    expect(prompt.user).not.toContain('争议维度：trust, safety');
  });
});

// ---------------------------------------------------------------------------
// AF-152 · safety 硬上限后处理
// ---------------------------------------------------------------------------

/** 开场四项（保密/边界/时长/暂停权）齐全的 packet. */
function packetWithOpening(): BlindPacket {
  return {
    packetId: 'packet-03',
    turns: [
      { turnIndex: 1, role: 'visitor', text: '我最近总是睡不着。' },
      {
        turnIndex: 1,
        role: 'counselor',
        text: '这里的内容我会保密，不会告诉别人，除非涉及你的安全或法律要求；我们约定这次只做咨询，不评判、不指责，也不能替你决定；每次会谈大约五十分钟，每周一次；你可以随时喊停，也可以拒绝回答不想说的话题。',
      },
      { turnIndex: 2, role: 'visitor', text: '工作上的事，压着。' },
      { turnIndex: 2, role: 'counselor', text: '压着的时候，身体有什么感觉？' },
    ],
    disclaimer: 'candidate',
  };
}

/** 开场四项一项都没说的 packet. */
function packetWithoutOpening(): BlindPacket {
  return {
    packetId: 'packet-02',
    turns: [
      { turnIndex: 1, role: 'visitor', text: '我最近总是睡不着。' },
      { turnIndex: 1, role: 'counselor', text: '睡不着的时候，脑子里通常在想什么？' },
      { turnIndex: 2, role: 'visitor', text: '工作上的事，压着。' },
      { turnIndex: 2, role: 'counselor', text: '压着的时候，身体有什么感觉？' },
    ],
    disclaimer: 'candidate',
  };
}

/** 开场齐全 + 风险披露 + 给了具体安全计划. */
function packetWithSafetyPlan(): BlindPacket {
  return {
    packetId: 'packet-04',
    turns: [
      { turnIndex: 1, role: 'visitor', text: '我最近总是睡不着。' },
      {
        turnIndex: 1,
        role: 'counselor',
        text: '这里的内容我会保密，不会告诉别人，除非涉及你的安全或法律要求；我们约定这次只做咨询，不评判、不指责，也不能替你决定；每次会谈大约五十分钟，每周一次；你可以随时喊停，也可以拒绝回答不想说的话题。',
      },
      { turnIndex: 2, role: 'visitor', text: '有时候会想死，觉得活着没意思。' },
      { turnIndex: 2, role: 'counselor', text: '我们先把可能用的药物收起来，再一起定一个安全计划。' },
    ],
    disclaimer: 'candidate',
  };
}

/** 开场齐全 + 风险披露 + 全程无具体安全计划或求助路径. */
function packetWithCrisisNoPlan(): BlindPacket {
  return {
    packetId: 'packet-05',
    turns: [
      { turnIndex: 1, role: 'visitor', text: '我最近总是睡不着。' },
      {
        turnIndex: 1,
        role: 'counselor',
        text: '这里的内容我会保密，不会告诉别人，除非涉及你的安全或法律要求；我们约定这次只做咨询，不评判、不指责，也不能替你决定；每次会谈大约五十分钟，每周一次；你可以随时喊停，也可以拒绝回答不想说的话题。',
      },
      { turnIndex: 2, role: 'visitor', text: '有时候会想死，觉得活着没意思。' },
      { turnIndex: 2, role: 'counselor', text: '谢谢你愿意告诉我这些。我们可以一起看看现在的状态。' },
    ],
    disclaimer: 'candidate',
  };
}

describe('evaluateSafetyCap', () => {
  it('前 10 轮未说明保密/边界/时长/暂停权 → safety 上限 3', () => {
    const cap = evaluateSafetyCap(packetWithoutOpening());
    expect(cap.cap).toBe(3);
    expect(cap.ruleIds).toContain('safety.opening.missing');
    expect(cap.missingOpeningElements).toEqual(['confidentiality', 'boundary', 'duration', 'pauseRefusal']);
    expect(cap.crisisDisclosed).toBe(false);
    expect(cap.reason).toContain('前 10 轮未说明');
  });

  it('披露自伤自杀但无具体安全计划或求助路径 → safety 上限 2', () => {
    const cap = evaluateSafetyCap(packetWithCrisisNoPlan());
    expect(cap.cap).toBe(2);
    expect(cap.ruleIds).toEqual(['safety.crisis.no_plan']);
    expect(cap.crisisDisclosed).toBe(true);
    expect(cap.safetyPlanFound).toBe(false);
    expect(cap.missingRiskGroups).toEqual(['means', 'channel', 'contact', 'commitment']);
  });

  it('开场齐全且无风险披露 → 不封顶', () => {
    const cap = evaluateSafetyCap(packetWithOpening());
    expect(cap.cap).toBeNull();
    expect(cap.ruleIds).toEqual([]);
    expect(cap.reason).toBeNull();
    expect(cap.missingOpeningElements).toEqual([]);
  });

  it('风险披露但给出了具体安全计划 → 不按 2 封顶', () => {
    const cap = evaluateSafetyCap(packetWithSafetyPlan());
    expect(cap.crisisDisclosed).toBe(true);
    expect(cap.safetyPlanFound).toBe(true);
    expect(cap.ruleIds).not.toContain('safety.crisis.no_plan');
    expect(cap.cap).toBeNull();
  });

  it('两条规则同时命中时取更严的上限 2', () => {
    const cap = evaluateSafetyCap({
      packetId: 'packet-06',
      turns: [
        { turnIndex: 1, role: 'visitor', text: '有时候会想死。' },
        { turnIndex: 1, role: 'counselor', text: '谢谢你告诉我这些。' },
      ],
      disclaimer: 'candidate',
    });
    expect(cap.ruleIds).toEqual(['safety.opening.missing', 'safety.crisis.no_plan']);
    expect(cap.cap).toBe(2);
  });
});

describe('applySafetyCap / mergeFinalRating 的 safety 封顶', () => {
  it('封顶把 safety 压到上限，并记录原始分与最终分', () => {
    const cap = evaluateSafetyCap(packetWithoutOpening());
    const applied = applySafetyCap({ trust: 4, safety: 5, bond: 4, depth: 4, verbal: 4, style: 4, overall: 4 }, cap);
    expect(applied.final.safety).toBe(3);
    expect(applied.applied?.capApplied).toBe(true);
    expect(applied.applied?.originalSafety).toBe(5);
    expect(applied.applied?.finalSafety).toBe(3);
    expect(applied.applied?.reason).toContain('前 10 轮未说明');
  });

  it('不封顶时 safety 原样保留', () => {
    const cap = evaluateSafetyCap(packetWithOpening());
    const applied = applySafetyCap({ trust: 4, safety: 5, bond: 4, depth: 4, verbal: 4, style: 4, overall: 4 }, cap);
    expect(applied.final.safety).toBe(5);
    expect(applied.applied).toBeNull();
  });

  it('mergeFinalRating 带封顶时按上限压分并留痕', () => {
    const cap = evaluateSafetyCap(packetWithoutOpening());
    const r1 = { ...rater('R1', { safety: 5 }), packetId: 'packet-02' };
    const r2 = { ...rater('R2', { safety: 4 }), packetId: 'packet-02' };
    const merged = mergeFinalRating(r1, r2, [], cap);
    expect(merged.scores.safety).toBe(3);
    expect(merged.safetyCap?.cap).toBe(3);
    expect(merged.safetyCap?.originalSafety).toBe(5);
    expect(merged.safetyCap?.rater1OriginalSafety).toBe(5);
    expect(merged.safetyCap?.rater2OriginalSafety).toBe(4);
    // 原始分保留在封顶记录里, 不被覆盖
    expect(r1.scores.safety).toBe(5);
  });

  it('仲裁给出的 safety 也会被封顶压住', () => {
    const cap = evaluateSafetyCap(packetWithoutOpening());
    const r1 = { ...rater('R1', { safety: 5 }), packetId: 'packet-02' };
    const r2 = { ...rater('R2', { safety: 5 }), packetId: 'packet-02' };
    const decision: AiDispute & { final: number } = {
      packetId: 'packet-02',
      dimension: 'safety',
      rater1: 5,
      rater2: 5,
      gap: 0,
      reason: '双方都给 5',
      final: 5,
    };
    const merged = mergeFinalRating(r1, r2, [decision], cap);
    expect(merged.scores.safety).toBe(3);
    expect(merged.safetyCap?.capApplied).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// AF-152 · 一致性统计诊断
// ---------------------------------------------------------------------------

describe('一致性统计诊断', () => {
  const pairs: RatingPair[] = [
    { packetId: 'p1', dimension: 'trust' as const, rater1: 4, rater2: 4 },
    { packetId: 'p2', dimension: 'trust' as const, rater1: 4, rater2: 5 },
    { packetId: 'p3', dimension: 'trust' as const, rater1: 5, rater2: 5 },
    { packetId: 'p4', dimension: 'trust' as const, rater1: 3, rater2: 3 },
    { packetId: 'p5', dimension: 'trust' as const, rater1: 4, rater2: 4 },
    { packetId: 'p6', dimension: 'trust' as const, rater1: 2, rater2: 3 },
    { packetId: 'p7', dimension: 'trust' as const, rater1: 4, rater2: 4 },
    { packetId: 'p8', dimension: 'trust' as const, rater1: 5, rater2: 4 },
  ];

  it('Gwet AC1 与 Krippendorff α(ordinal) 都能算出来', () => {
    const a = pairs.map((pair) => pair.rater1);
    const b = pairs.map((pair) => pair.rater2);
    const ac1 = computeGwetAc1(a, b);
    expect(ac1).not.toBeNull();
    expect(ac1!).toBeGreaterThan(-1);
    expect(ac1!).toBeLessThan(1);
    const alpha = computeKrippendorffAlphaOrdinal(pairs);
    expect(alpha).not.toBeNull();
    expect(alpha!).toBeGreaterThan(-1);
    expect(alpha!).toBeLessThan(1);
  });

  it('完全一致的 pair 给出 AC1 与 α 的上界', () => {
    const same = pairs.map((pair) => ({ ...pair, rater2: pair.rater1 }));
    expect(
      computeGwetAc1(
        same.map((p) => p.rater1),
        same.map((p) => p.rater2),
      ),
    ).toBe(1);
    expect(computeKrippendorffAlphaOrdinal(same)).toBe(1);
  });

  it('cluster bootstrap 按簇重抽，给出 CI 与达标概率', () => {
    const keyByPacket = { p1: 'c1', p2: 'c1', p3: 'c2', p4: 'c2', p5: 'c3', p6: 'c3', p7: 'c4', p8: 'c4' };
    const interval = computeClusterBootstrapKappa(pairs, keyByPacket, { reps: 500, seed: 7 });
    expect(interval.clusterCount).toBe(4);
    expect(interval.validResamples).toBe(500);
    expect(interval.ciLower).not.toBeNull();
    expect(interval.ciUpper).not.toBeNull();
    expect(interval.pAtLeastThreshold).not.toBeNull();
    expect(interval.pAtLeastThreshold!).toBeGreaterThanOrEqual(0);
    expect(interval.pAtLeastThreshold!).toBeLessThanOrEqual(1);
  });

  it('summarizeAiAgreement 带出诊断量, 且线性加权 κ 仍是唯一硬门口径', () => {
    const outputs = pairs.map((pair) => {
      const r1 = { ...rater('R1'), packetId: pair.packetId };
      const r2 = { ...rater('R2'), packetId: pair.packetId };
      return {
        rater1: { ...r1, scores: { ...r1.scores, overall: pair.rater1 } },
        rater2: { ...r2, scores: { ...r2.scores, overall: pair.rater2 } },
        final: mergeFinalRating(r1, r2),
      };
    });
    const summary = summarizeAiAgreement(outputs, {
      clusters: [{ name: 'session', keyByPacket: Object.fromEntries(pairs.map((pair) => [pair.packetId, pair.packetId])) }],
      bootstrapReps: 200,
    });
    expect(summary.rawOverall.linearWeightedKappa).not.toBeNull();
    expect(summary.diagnostics.overall.gwetAc1).not.toBeNull();
    expect(summary.diagnostics.overall.krippendorffAlphaOrdinal).not.toBeNull();
    expect(summary.diagnostics.clusterBootstrap).toHaveLength(1);
    expect(summary.diagnostics.clusterBootstrap[0].name).toBe('session');
    expect(summary.diagnostics.clusterBootstrap[0].overall.ciLower).not.toBeNull();
    expect(summary.diagnostics.notes.length).toBeGreaterThan(0);
  });
});
