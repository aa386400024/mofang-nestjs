// AF-462: register-v1 盲评协议 — 全量锚点必须出现 (防评审方向颠倒), 解析要抗残缺输出.
import { buildRegisterRatingPrompt, parseRegisterRating } from '../../src/auto-practice/metrics/visitor-register-rating.js';

const PACKET = { roleKey: 'vpt_x', turns: ['第一句。', '第二句。'], expectedRegisterSummary: '说话短、具体' };

describe('AF-462 · register-v1 rating protocol', () => {
  it('提示词包含四个维度的 1–5 全量锚点', () => {
    const prompt = buildRegisterRatingPrompt(PACKET);
    for (const dimension of ['register_fit', 'stereotype_risk', 'cross_turn_stability', 'concreteness']) {
      expect(prompt).toContain(dimension);
    }
    expect(prompt).toContain('5=完全不用群体标签');
    expect(prompt).toContain('1=放到任何角色身上都能说');
    expect(prompt).toContain('5 = 最贴合本协议、最安全');
  });

  it('items 缺失或维度不全时判失败, 不抛异常', () => {
    expect(parseRegisterRating({ roleKey: 'x' })).toBeNull();
    expect(parseRegisterRating({ roleKey: 'x', items: [] })).toBeNull();
  });

  it('四个维度齐全且证据可回指时解析成功', () => {
    const items = [
      { dimension: 'register_fit', score: 4, evidence: '第一句 原词' },
      { dimension: 'stereotype_risk', score: 5, evidence: '第一句 原词' },
      { dimension: 'cross_turn_stability', score: 4, evidence: '第二句 原词' },
      { dimension: 'concreteness', score: 3, evidence: '第二句 原词' },
    ];
    const result = parseRegisterRating({ roleKey: 'x', items });
    expect(result?.mean).toBe(4);
    expect(result?.status).toBe('ai_proxy_candidate');
  });
});
