// V2026-11-18 建立 (AF-102 · 可见输出判定 · 纯函数单测):
//   覆盖 stripReasoningBlocks / judgeVisibleOutput 两条口径:
//     ① 闭合推理块整块删掉;
//     ② **未闭合**推理块 (被长度上限截断的典型形态) 从 `<think>` 删到结尾;
//     ③ 可见文本为空 → empty=true;
//     ④ finishReason=length → truncated=true;
//     ⑤ 纯文本不受影响.
//
//   纯函数 / 零 IO / 不起 Nest / 不连 DB.
//
//   验证: pnpm exec vitest run test/auto-practice/visible-output.spec.ts

import { describe, expect, it } from 'vitest';

import { judgeVisibleOutput, stripReasoningBlocks } from '../../src/auto-practice/counselor/policy/visible-output.js';

describe('AF-102 · 可见输出判定 (纯函数)', () => {
  it('① 闭合推理块整块删掉', () => {
    expect(stripReasoningBlocks('<think>内部思考</think>外面的台词')).toBe('外面的台词');
  });

  it('② 未闭合的推理块 (截断形态) 从 <think> 删到结尾', () => {
    expect(stripReasoningBlocks('可见的前半句<think>内部思考没写完')).toBe('可见的前半句');
  });

  it('② 多段推理块全删', () => {
    expect(stripReasoningBlocks('<think>一</think>中间<think>二</think>后面')).toBe('中间后面');
  });

  it('③ 只有推理块 → 可见文本为空', () => {
    const judgement = judgeVisibleOutput('<think>只有推理，没有台词。</think>', 'stop');
    expect(judgement.visible).toBe('');
    expect(judgement.empty).toBe(true);
    expect(judgement.truncated).toBe(false);
  });

  it('④ finishReason=length → truncated=true (非空也不当正常回复)', () => {
    const judgement = judgeVisibleOutput('半句话', 'length');
    expect(judgement.empty).toBe(false);
    expect(judgement.truncated).toBe(true);
  });

  it('⑤ 纯文本不受影响', () => {
    const judgement = judgeVisibleOutput('  普通台词  ', 'stop');
    expect(judgement.visible).toBe('普通台词');
    expect(judgement.empty).toBe(false);
    expect(judgement.truncated).toBe(false);
  });

  it('finishReason 缺省 → 不算截断', () => {
    expect(judgeVisibleOutput('普通台词').truncated).toBe(false);
  });
});
