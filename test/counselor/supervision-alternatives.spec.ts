// V2026-10-27 治本 (督导反馈 alternatives — 容错单测, spec 任务 C2/C3):
//   原因: `alternatives` (关键句的替代回应) 是"加分项", 它畸形**不该**把整份督导反馈
//     一起丢掉 —— 学员宁可少看一条示范, 也不能看不到这次会谈的逐句点评与总分.
//     而"模型漏给 / 给非法结构"是常态 (LLM 输出不稳定), 所以容错口径必须锁死.
//   修法: 本文件锁死:
//     ① 正常 alternatives → 原样解析 (trim + 限长)
//     ② 缺失 / 非数组 → 空数组, **不**返回 null
//     ③ 单条不合格 → 丢弃**这一条**, 其余保留
//     ④ 条数上限 2
//     ⑤ 畸形 alternatives → 整份反馈其余字段照常返回 (不整体 parse 失败)
//   验证: npx jest test/counselor/supervision-alternatives.spec.ts 全绿
//   时间戳: 2026-10-27
import {
  parseAlternatives,
  validateSupervisionPayload,
} from '../../src/counselor/providers/supervision.service';

/** 一份合法的最小 payload (不含 alternatives). */
function basePayload(): Record<string, unknown> {
  return {
    overallScore: 72,
    perSentence: [{ sentence: '你应该早点休息', score: 55, comment: '这里给建议了' }],
    errorCategories: ['给建议'],
    growthSuggestion: '下次先问一句对方今天怎么样',
  };
}

describe('alternatives · 解析容错', () => {
  it('正常 alternatives → 原样解析 (trim 后入库)', () => {
    const parsed = parseAlternatives([
      { original: '你应该早点休息', suggested: '  今天感觉怎么样? ', why: ' 先问感受再给建议 ' },
    ]);
    expect(parsed).toEqual([
      { original: '你应该早点休息', suggested: '今天感觉怎么样?', why: '先问感受再给建议' },
    ]);
  });

  it('缺失 / 非数组 → 空数组 (不是 null)', () => {
    expect(parseAlternatives(undefined)).toEqual([]);
    expect(parseAlternatives(null)).toEqual([]);
    expect(parseAlternatives('not-an-array')).toEqual([]);
    expect(parseAlternatives({})).toEqual([]);
  });

  it('空数组 → 空数组', () => {
    expect(parseAlternatives([])).toEqual([]);
  });

  it('单条不合格 → 丢弃**这一条**, 其余保留', () => {
    const parsed = parseAlternatives([
      { original: 'a', suggested: '好的替代回应', why: '理由' },
      { original: 'b', suggested: 123, why: '理由' },
      { original: 'c', suggested: '另一句', why: '另一个理由' },
    ]);
    expect(parsed).toHaveLength(2);
    expect(parsed.map((p) => p.suggested)).toEqual(['好的替代回应', '另一句']);
  });

  it('suggested / why 为空或纯空白 → 丢弃该条', () => {
    const parsed = parseAlternatives([
      { original: 'a', suggested: '   ', why: '理由' },
      { original: 'b', suggested: '回应', why: '  ' },
    ]);
    expect(parsed).toEqual([]);
  });

  it('超长 → 丢弃该条 (suggested ≤ 80 字, why ≤ 40 字)', () => {
    const parsed = parseAlternatives([
      { original: 'a', suggested: '回'.repeat(81), why: '理由' },
      { original: 'b', suggested: '回'.repeat(80), why: '理'.repeat(41) },
      { original: 'c', suggested: '回'.repeat(80), why: '理'.repeat(40) },
    ]);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]?.suggested.length).toBe(80);
  });

  it('条数上限 2 (多给的丢弃)', () => {
    const parsed = parseAlternatives([
      { original: 'a', suggested: '回应一', why: '理由一' },
      { original: 'b', suggested: '回应二', why: '理由二' },
      { original: 'c', suggested: '回应三', why: '理由三' },
    ]);
    expect(parsed).toHaveLength(2);
  });

  it('original 缺失 → 空串 (它只是回指, 不影响示范本身)', () => {
    const parsed = parseAlternatives([{ suggested: '回应', why: '理由' }]);
    expect(parsed[0]?.original).toBe('');
  });
});

describe('alternatives · 不因它丢掉整份反馈', () => {
  it('模型漏给 alternatives → 其余字段照常返回, alternatives=[]', () => {
    const payload = validateSupervisionPayload(basePayload());
    expect(payload).not.toBeNull();
    expect(payload?.overallScore).toBe(72);
    expect(payload?.perSentence[0]?.comment).toBe('这里给建议了');
    expect(payload?.perSentence[0]?.alternatives).toEqual([]);
  });

  it('模型给非法 alternatives → 反馈其余字段照常返回 (**不**整体 parse 失败)', () => {
    const raw = basePayload();
    raw['perSentence'] = [
      { sentence: '你应该早点休息', score: 55, comment: '这里给建议了', alternatives: 'garbage' },
    ];
    const payload = validateSupervisionPayload(raw);
    expect(payload).not.toBeNull();
    expect(payload?.overallScore).toBe(72);
    expect(payload?.perSentence[0]?.alternatives).toEqual([]);
  });

  it('模型给了合法 alternatives → 随反馈一起落库', () => {
    const raw = basePayload();
    raw['perSentence'] = [
      {
        sentence: '你应该早点休息',
        score: 55,
        comment: '这里给建议了',
        alternatives: [{ original: '你应该早点休息', suggested: '今天感觉怎么样?', why: '先问感受再给建议' }],
      },
    ];
    const payload = validateSupervisionPayload(raw);
    expect(payload?.perSentence[0]?.alternatives).toHaveLength(1);
    expect(payload?.perSentence[0]?.alternatives?.[0]?.suggested).toBe('今天感觉怎么样?');
  });

  it('真正非法的 payload (总分不是数字) → 仍然整体失败 (容错不放宽到失去意义)', () => {
    const raw = basePayload();
    raw['overallScore'] = '七十二';
    expect(validateSupervisionPayload(raw)).toBeNull();
  });
});
