// V2026-11-10 建立 (WP-J P1e Phase2 — 流式语义预处理器 · 单测):
//   覆盖交付记录 §验收:
//     ① **标签闭合缓冲**: 标签被拆到多个 chunk 时, 中间**一个字都不吐**
//        (半个标签进 TTS 会被当文字念出来 —— 这正是本类存在的理由);
//     ② **不自己切句**: 普通文本原样透传, 不做任何句子切分;
//     ③ **标签翻译**: [sigh] → (sighs) / [pause:0.5] → <#0.5#> /
//        [emotion:sad] → 不进文本 (走 detectedEmotion) / [[STATE:END]] → 不念;
//     ④ **未闭合的 '['**: flush() 按纯文本吐出 (不丢字);
//     ⑤ **reset()**: 缓冲 / 情绪 / 计数全清空.
//
//   验证: npx vitest run test/auto-practice/wp-j-p1e-streaming-semantic-preprocessor.spec.ts
//   时间戳: 2026-11-10

import { describe, expect, it } from 'vitest';

import { StreamingSemanticPreprocessor } from '../../src/auto-practice/utils/streaming-semantic-preprocessor.js';

describe('WP-J P1e Phase2 · 流式语义预处理器', () => {
  it('① 普通文本立即透传 (不切句)', () => {
    const pre = new StreamingSemanticPreprocessor();
    expect(pre.pushToken('你好，今天过得怎么样？')).toBe('你好，今天过得怎么样？');
  });

  it('② 标签跨 chunk: 中间一个字都不吐', () => {
    const pre = new StreamingSemanticPreprocessor();
    expect(pre.pushToken('[pa')).toBe('');
    expect(pre.pushToken('use:0.5')).toBe('');
    expect(pre.pushToken(']')).toBe('<#0.5#>');
  });

  it('③ [sigh] → (sighs)', () => {
    const pre = new StreamingSemanticPreprocessor();
    expect(pre.pushToken('[sigh]你好')).toBe('(sighs)你好');
  });

  it('④ [pause:0.5] → <#0.5#>', () => {
    const pre = new StreamingSemanticPreprocessor();
    expect(pre.pushToken('[pause:0.5]我最近有点累。')).toBe('<#0.5#>我最近有点累。');
  });

  it('⑤ [emotion:sad] → 不进文本, 走 detectedEmotion', () => {
    const pre = new StreamingSemanticPreprocessor();
    expect(pre.pushToken('你好[emotion:sad]')).toBe('你好');
    expect(pre.detectedEmotion).toBe('sad');
  });

  it('⑥ [[STATE:END]] → 不念 (控制标记是引擎的信号)', () => {
    const pre = new StreamingSemanticPreprocessor();
    expect(pre.pushToken('谢谢你。[[STATE:END]]')).toBe('谢谢你。');
    expect(pre.stats.controlTags).toBe(1);
  });

  it('⑦ 双括号跨 chunk: 等到两个 ] 才闭合', () => {
    const pre = new StreamingSemanticPreprocessor();
    expect(pre.pushToken('[[STATE:EN')).toBe('');
    expect(pre.pushToken('D')).toBe('');
    expect(pre.pushToken(']]')).toBe('');
    expect(pre.stats.controlTags).toBe(1);
  });

  it('⑧ 形态像标记但不认识 → 丢弃 (不能让 TTS 念出来)', () => {
    const pre = new StreamingSemanticPreprocessor();
    expect(pre.pushToken('[xyzzy]你好')).toBe('你好');
    expect(pre.stats.unknownTags).toBe(1);
  });

  it('⑨ 根本不是标记的方括号 → 原样透传', () => {
    const pre = new StreamingSemanticPreprocessor();
    expect(pre.pushToken('他说[1]和[你好]')).toBe('他说[1]和[你好]');
    expect(pre.stats.plainBrackets).toBe(2);
  });

  it('⑩ 未闭合的 [ → flush() 按纯文本吐出 (不丢字)', () => {
    const pre = new StreamingSemanticPreprocessor();
    expect(pre.pushToken('你好[未闭合')).toBe('你好');
    expect(pre.flush()).toBe('[未闭合');
    expect(pre.stats.flushedChars).toBe(4);
  });

  it('⑪ flush() 没有残余 → 空串', () => {
    const pre = new StreamingSemanticPreprocessor();
    expect(pre.pushToken('你好')).toBe('你好');
    expect(pre.flush()).toBe('');
  });

  it('⑫ reset() 清空缓冲 / 情绪 / 计数', () => {
    const pre = new StreamingSemanticPreprocessor();
    pre.pushToken('[sigh]你好[emotion:sad]');
    pre.pushToken('[未闭合');
    expect(pre.detectedEmotion).toBe('sad');

    pre.reset();

    expect(pre.detectedEmotion).toBeNull();
    expect(pre.stats.tags).toBe(0);
    expect(pre.stats.controlTags).toBe(0);
    expect(pre.stats.flushedChars).toBe(0);
    // 缓冲也清了 → 下一句从头开始, 不会被上一句的半个标签污染.
    expect(pre.pushToken('新的一句')).toBe('新的一句');
  });

  it('⑬ 任何时刻吐出去的文本都不含半个标签', () => {
    const pre = new StreamingSemanticPreprocessor();
    const emitted = [pre.pushToken('开头'), pre.pushToken('[si'), pre.pushToken('gh]结尾')].join('');
    expect(emitted).not.toContain('[si');
    expect(emitted).toBe('开头(sighs)结尾');
  });

  it('⑭ 混合输出: 文本 + 标签 + 文本', () => {
    const pre = new StreamingSemanticPreprocessor();
    expect(pre.pushToken('你好[sigh]世界')).toBe('你好(sighs)世界');
  });

  it('⑮ 厂商语气标记原样透传 (它们本来就是 TTS-ready 的)', () => {
    const pre = new StreamingSemanticPreprocessor();
    expect(pre.pushToken('(sighs)你好')).toBe('(sighs)你好');
  });

  it('⑯ 计数统计正确', () => {
    const pre = new StreamingSemanticPreprocessor();
    pre.pushToken('[sigh]a[pause:0.5]b[xyzzy]c[1]d[[STATE:END]]');
    const stats = pre.stats;
    // tags = 识别出的标记数 ([sigh] + [pause:0.5] + [[STATE:END]], 控制标记也算"认出来了").
    expect(stats.tags).toBe(3);
    expect(stats.unknownTags).toBe(1);
    expect(stats.plainBrackets).toBe(1);
    expect(stats.controlTags).toBe(1);
  });

  it('⑰ 多个 chunk 拼起来 = 一次性喂进去 (分块与不分块结果一致)', () => {
    const whole = new StreamingSemanticPreprocessor();
    const expected = whole.pushToken('[sigh]我最近有点累[pause:0.5]。');

    const chunked = new StreamingSemanticPreprocessor();
    let actual = '';
    for (const piece of ['[s', 'igh]我', '最近有点', '累[pa', 'use:0.5', ']。']) {
      actual += chunked.pushToken(piece);
    }
    actual += chunked.flush();

    expect(actual).toBe(expected);
  });
});
