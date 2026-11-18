// V2026-11-19 Phase2.5 AF-116 (AI 代理双盲纯函数单测):
//   覆盖评分解析 fail-closed、争议选择、仲裁合并、提示词独立性.
//   不触网、不读写仓库文件.

import { describe, expect, it } from 'vitest';

import {
  AI_DOUBLE_BLIND_DISCLAIMER,
  buildArbiterPrompt,
  buildRaterPrompt,
  findAiDisputes,
  mergeFinalRating,
  parseAiArbitrationOutput,
  parseAiRaterOutput,
  summarizeAiAgreement,
  type AiDispute,
  type AiRaterOutput,
} from '../../src/auto-practice/metrics/ai-double-blind.js';
import { type BlindPacket } from '../../src/auto-practice/metrics/long-session-acceptance.js';

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
  values: Partial<Record<'trust' | 'safety' | 'bond' | 'depth' | 'verbal' | 'style' | 'overall', number>>,
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

  it('R3 只纳入争议维度', () => {
    const r1 = rater('R1', { trust: 4 });
    const r2 = rater('R2', { trust: 2 });
    const disputes = findAiDisputes(r1, r2);
    const prompt = buildArbiterPrompt({ packet: packet(), rater1: r1, rater2: r2, disputes });
    expect(prompt.user).toContain('争议维度：trust');
    expect(prompt.user).not.toContain('争议维度：trust, safety');
  });
});
