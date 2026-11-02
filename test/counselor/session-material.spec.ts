// V2026-10-27 治本 (空会话素材判定 — 纯函数单测, spec 任务 A):
//   原因: "素材够不够"是整个空局链路的地基 —— 结束前置拦截 (要不要派督导 job)、
//     列表派生 (no_content 还是 pending)、详情派生 (要不要可重试) 三处都吃这个判定.
//     判定写错**不会抛异常**, 只会让空局继续被派 job (烧永久失败) 或把正常会谈误判成空局
//     (学员白等一场永远不会生成的报告).
//   修法: 本文件锁死任务单 D2 的规则:
//     · 有效轮 = text.trim() 非空
//     · 有效字数 = Σ 非空轮 text.trim().length
//     · 空局 = 有效轮 < minTurns **或** 有效字数 < minChars
//   验证:
//     1. npx jest test/counselor/session-material.spec.ts 全绿
//     2. 故意把"或"改成"且" → "2 轮共 20 字"用例变红
//   时间戳: 2026-10-27 14:20 GMT+8
import { isInsufficientMaterial, measureEffectiveMaterial } from '../../src/counselor/domain/session-view/session-material';

/** 默认阈值 (与 config `supervision.minEffectiveTurns` / `minEffectiveChars` 同值). */
const THRESHOLDS = { minTurns: 2, minChars: 30 };

describe('量有效素材', () => {
  it('空数组 → 0 轮 0 字', () => {
    expect(measureEffectiveMaterial([])).toEqual({ effectiveTurns: 0, effectiveChars: 0 });
  });

  it('null / undefined (老数据的 transcript 列可能是 NULL) → 0 轮 0 字', () => {
    expect(measureEffectiveMaterial(null)).toEqual({ effectiveTurns: 0, effectiveChars: 0 });
    expect(measureEffectiveMaterial()).toEqual({ effectiveTurns: 0, effectiveChars: 0 });
  });

  it('空白串轮不计入 (只有空格的"发言"不是发言)', () => {
    const material = measureEffectiveMaterial([{ text: ' '.repeat(3) }, { text: '\n\t ' }]);
    expect(material).toEqual({ effectiveTurns: 0, effectiveChars: 0 });
  });

  it('字数按 trim 后的长度算 (前后空格不算内容)', () => {
    const material = measureEffectiveMaterial([{ text: '  你好  ' }]);
    expect(material).toEqual({ effectiveTurns: 1, effectiveChars: 2 });
  });

  it('多轮求和', () => {
    const material = measureEffectiveMaterial([{ text: '最近怎么样' }, { text: ' '.repeat(3) }, { text: '有点失眠' }]);
    expect(material).toEqual({ effectiveTurns: 2, effectiveChars: 9 });
  });

  it('脏数据 (text 缺失 / 非字符串) 不把整段判定打挂', () => {
    const material = measureEffectiveMaterial([{ text: undefined }, { text: null }, { text: '有内容' }]);
    expect(material).toEqual({ effectiveTurns: 1, effectiveChars: 3 });
  });
});

describe('是否空局 (低于最小可分析量)', () => {
  it('空数组 → 空局', () => {
    expect(isInsufficientMaterial(measureEffectiveMaterial([]), THRESHOLDS)).toBe(true);
  });

  it('1 轮 → 空局', () => {
    expect(isInsufficientMaterial(measureEffectiveMaterial([{ text: '你好' }]), THRESHOLDS)).toBe(true);
  });

  it('2 轮共 20 字 → 空局 (轮数够但字数不够)', () => {
    const material = measureEffectiveMaterial([{ text: '你睡得好吗' }, { text: '有点焦虑' }]);
    expect(material.effectiveTurns).toBe(2);
    expect(isInsufficientMaterial(material, THRESHOLDS)).toBe(true);
  });

  it('2 轮共 ≥30 字 → 合格', () => {
    const material = measureEffectiveMaterial([
      { text: '最近睡眠怎么样, 有没有出现早醒的情况' },
      { text: '主要是工作压力, 每天大概四五个小时' },
    ]);
    expect(material.effectiveTurns).toBe(2);
    expect(isInsufficientMaterial(material, THRESHOLDS)).toBe(false);
  });

  it('空白串轮不计入 → 仍判空局', () => {
    const material = measureEffectiveMaterial([{ text: '  ' }, { text: '你好' }]);
    expect(material.effectiveTurns).toBe(1);
    expect(isInsufficientMaterial(material, THRESHOLDS)).toBe(true);
  });

  it('阈值可配 (运营调小 → 更容易判合格)', () => {
    const material = measureEffectiveMaterial([{ text: '你好' }]);
    expect(isInsufficientMaterial(material, { minTurns: 1, minChars: 1 })).toBe(false);
    expect(isInsufficientMaterial(material, THRESHOLDS)).toBe(true);
  });
});
