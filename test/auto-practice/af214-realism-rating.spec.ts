// V2026-11-21 建立 (AF-214 · R5 评分协议):
//   只验证协议契约：五维锚点、证据可定位、分数合法、仲裁合并、一致性口径、去身份。

import { describe, expect, it } from 'vitest';

import {
  AI_REALISM_DISCLAIMER,
  AI_REALISM_STATUS,
  REALISM_DIMENSIONS,
  buildRealismArbiterPrompt,
  buildRealismRaterPrompt,
  deriveRealismPacketId,
  findRealismDisputes,
  mergeRealismRating,
  parseRealismArbitration,
  parseRealismArbitrationJsonOnly,
  parseRealismRating,
  parseRealismRatingJsonOnly,
  parseRealismRatingLines,
  summarizeRealismAgreement,
  type RealismBlindPacket,
  type RealismRating,
} from '../../src/auto-practice/metrics/visitor-realism-rating.js';

const packet: RealismBlindPacket = {
  packetId: 'pkt-001',
  scene: 'in_person',
  turns: [
    { turnIndex: 1, role: 'counselor', text: '你最近睡得怎么样？' },
    { turnIndex: 2, role: 'visitor', text: '嗯……不太好，躺下就开始想工作。' },
    { turnIndex: 3, role: 'counselor', text: '想工作的时候，身体有什么感觉？' },
    { turnIndex: 4, role: 'visitor', text: '胸口闷，有时候会突然坐起来。' },
  ],
};

function ratingJson(overrides: Record<string, unknown> = {}): string {
  const base = {
    dimensions: {
      naturalness: { score: 4, evidence: { turnIndex: 2, quote: '嗯……不太好' } },
      emotional_continuity: { score: 3, evidence: { turnIndex: 4, quote: '胸口闷' } },
      turn_shape: { score: 4, evidence: { turnIndex: 2, quote: '躺下就开始想工作' } },
      scene_congruence: { score: 4, evidence: { turnIndex: 4, quote: '有时候会突然坐起来' } },
      relational_presence: { score: 3, evidence: { turnIndex: 2, quote: '不太好' } },
    },
    overall: 4,
    notes: ['整体能接住咨询师的话。'],
  };
  return JSON.stringify({ ...base, ...overrides });
}

describe('AF-214 · 评分提示词', () => {
  it('包含五维锚点、免责声明与证据纪律', () => {
    const prompt = buildRealismRaterPrompt(packet, 'R1');
    for (const dimension of REALISM_DIMENSIONS) expect(prompt.system).toContain(dimension);
    expect(prompt.system).toContain('AI 代理真人度评测，不是真人督导');
    expect(prompt.system).toContain('evidence');
    expect(prompt.user).toContain('packetId：pkt-001');
    expect(prompt.user).toContain('来访者');
  });

  it('R1 证据优先、R2 整体叙事，提示词不同', () => {
    const r1 = buildRealismRaterPrompt(packet, 'R1').system;
    const r2 = buildRealismRaterPrompt(packet, 'R2').system;
    expect(r1).toContain('证据优先');
    expect(r2).toContain('整体叙事');
    expect(r1).not.toBe(r2);
  });

  it('仲裁提示词只列分歧维度', () => {
    const r1 = parseRealismRating(ratingJson(), packet);
    const r2 = parseRealismRating(
      ratingJson({
        dimensions: { ...JSON.parse(ratingJson()).dimensions, naturalness: { score: 2, evidence: { turnIndex: 2, quote: '嗯……不太好' } } },
      }),
      packet,
    );
    if (!r1.ok || !r2.ok) throw new Error('fixture 应可解析');
    const prompt = buildRealismArbiterPrompt(packet, r1.rating, r2.rating, ['naturalness']);
    expect(prompt.user).toContain('naturalness');
    expect(prompt.user).not.toContain('## turn_shape');
  });
});

describe('AF-214 · 评分解析', () => {
  it('解析合法 JSON', () => {
    const parsed = parseRealismRating(ratingJson(), packet);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.rating.packetId).toBe('pkt-001');
    expect(parsed.rating.overall).toBe(4);
    expect(parsed.rating.dimensions.naturalness.score).toBe(4);
  });

  it('允许 ```json 围栏与前后废话', () => {
    const parsed = parseRealismRating(`说明文字\n\`\`\`json\n${ratingJson()}\n\`\`\`\n结束`, packet);
    expect(parsed.ok).toBe(true);
  });

  it('解析行协议评分（模型实际输出形态）', () => {
    const raw = [
      'naturalness=4|2|嗯……不太好',
      'emotional_continuity=3|4|胸口闷',
      'turn_shape=4|2|躺下就开始想工作',
      'scene_congruence=4|4|有时候会突然坐起来',
      'relational_presence=3|2|不太好',
      'overall=4',
      'notes=整体能接住咨询师的话。',
    ].join('\n');
    const parsed = parseRealismRatingLines(raw, packet);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.rating.dimensions.naturalness.evidence).toMatchObject({ turnIndex: 2, quote: '嗯……不太好' });
    expect(parsed.rating.notes).toHaveLength(1);
    expect(parseRealismRating(raw, packet).ok).toBe(true);
  });

  it('行协议里证据不在原文同样判失败', () => {
    const raw = [
      'naturalness=4|2|编造的句子',
      'emotional_continuity=3|4|胸口闷',
      'turn_shape=4|2|躺下就开始想工作',
      'scene_congruence=4|4|有时候会突然坐起来',
      'relational_presence=3|2|不太好',
      'overall=4',
    ].join('\n');
    expect(parseRealismRatingLines(raw, packet)).toMatchObject({ ok: false, error: 'evidence_not_in_turn:naturalness' });
  });

  it('行协议仲裁只接受分歧维度', () => {
    const ok = parseRealismArbitration('naturalness=3|证据更支持中等', ['naturalness']);
    expect(ok.ok).toBe(true);
    expect(parseRealismArbitration('turn_shape=3|不该裁这个', ['naturalness'])).toMatchObject({
      ok: false,
      error: 'decision_missing:naturalness',
    });
  });

  it('证据定位不到就判失败', () => {
    const parsed = parseRealismRatingJsonOnly(
      ratingJson({
        dimensions: {
          ...JSON.parse(ratingJson()).dimensions,
          naturalness: { score: 4, evidence: { turnIndex: 2, quote: '这句话不在原文里' } },
        },
      }),
      packet,
    );
    expect(parsed).toMatchObject({ ok: false, error: 'evidence_not_in_turn:naturalness' });
  });

  it('证据引到咨询师轮次就判失败', () => {
    const parsed = parseRealismRatingJsonOnly(
      ratingJson({
        dimensions: {
          ...JSON.parse(ratingJson()).dimensions,
          turn_shape: { score: 4, evidence: { turnIndex: 1, quote: '你最近睡得怎么样' } },
        },
      }),
      packet,
    );
    expect(parsed).toMatchObject({ ok: false, error: 'evidence_turn_not_visitor:turn_shape' });
  });

  it('拒绝非整数分与缺维', () => {
    expect(parseRealismRatingJsonOnly(ratingJson({ overall: 3.5 }), packet)).toMatchObject({ ok: false, error: 'overall_invalid' });
    expect(
      parseRealismRatingJsonOnly(
        ratingJson({ dimensions: { naturalness: { score: 4, evidence: { turnIndex: 2, quote: '嗯' } } } }),
        packet,
      ),
    ).toMatchObject({ ok: false, error: 'dimension_missing:emotional_continuity' });
  });

  it('解析仲裁并拒绝缺失理由', () => {
    const ok = parseRealismArbitration(JSON.stringify({ decisions: { naturalness: { score: 3, reason: '更像被咨询师推动' } } }), [
      'naturalness',
    ]);
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.decisions[0]).toMatchObject({ dimension: 'naturalness', score: 3 });
    const bad = parseRealismArbitrationJsonOnly(JSON.stringify({ decisions: { naturalness: { score: 3 } } }), ['naturalness']);
    expect(bad).toMatchObject({ ok: false, error: 'decision_reason_missing:naturalness' });
  });
});

describe('AF-214 · 分歧与合并', () => {
  const mk = (scores: Record<string, number>): RealismRating => {
    const dimensions = {} as Record<string, { score: 1 | 2 | 3 | 4 | 5; evidence: { turnIndex: number; quote: string } }>;
    for (const dimension of REALISM_DIMENSIONS) {
      dimensions[dimension] = { score: scores[dimension] as 1 | 2 | 3 | 4 | 5, evidence: { turnIndex: 2, quote: '嗯' } };
    }
    return { packetId: 'pkt-001', dimensions: dimensions as RealismRating['dimensions'], overall: 4, notes: [] };
  };

  it('分差 ≥2 才进仲裁', () => {
    expect(
      findRealismDisputes(
        mk({ naturalness: 4, emotional_continuity: 3, turn_shape: 4, scene_congruence: 4, relational_presence: 3 }),
        mk({ naturalness: 3, emotional_continuity: 3, turn_shape: 2, scene_congruence: 4, relational_presence: 3 }),
      ),
    ).toEqual(['turn_shape']);
  });

  it('仲裁分覆盖分歧，未裁分歧保留均值并标记', () => {
    const merged = mergeRealismRating(
      mk({ naturalness: 4, emotional_continuity: 4, turn_shape: 4, scene_congruence: 4, relational_presence: 4 }),
      mk({ naturalness: 2, emotional_continuity: 2, turn_shape: 4, scene_congruence: 4, relational_presence: 4 }),
      [{ dimension: 'naturalness', score: 3, reason: '证据更支持中等' }],
    );
    expect(merged.dimensions.naturalness).toBe(3);
    expect(merged.dimensions.emotional_continuity).toBe(3);
    expect(merged.unresolved).toEqual(['emotional_continuity']);
  });

  it('一致性给 exact / within±1 / κ，样本不足不伪造', () => {
    const summary = summarizeRealismAgreement([4, 3, 5], [4, 2, 4]);
    expect(summary).toMatchObject({ n: 3, exactAgreement: 0.333333, withinOneAgreement: 1 });
    expect(summary.linearWeightedKappa).not.toBeNull();
    expect(summarizeRealismAgreement([4], [4])).toMatchObject({ n: 1, linearWeightedKappa: null });
    expect(summarizeRealismAgreement([], [])).toMatchObject({ n: 0, linearWeightedKappa: null });
  });
});

describe('AF-214 · 去身份与声明', () => {
  it('packetId 稳定且不可逆，不含 session id', () => {
    const first = deriveRealismPacketId('session-secret-123', 20_261_121);
    const second = deriveRealismPacketId('session-secret-123', 20_261_121);
    expect(first).toBe(second);
    expect(first).toHaveLength(16);
    expect(first).not.toContain('session');
  });

  it('状态与免责声明不可被写成临床达标', () => {
    expect(AI_REALISM_STATUS).toBe('ai_proxy_candidate');
    expect(AI_REALISM_DISCLAIMER).toContain('humanSupervision=false');
    expect(AI_REALISM_DISCLAIMER).toContain('clinicalAcceptanceEligible=false');
  });
});
