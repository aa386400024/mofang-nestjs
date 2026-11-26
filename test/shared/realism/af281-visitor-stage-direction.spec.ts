// V2026-11-22 建立 (AF-281 · 舞台说明投影):
//   覆盖“写了也不会出声”的硬契约：括号/星号动作被剥离，纯台词与合法语义标签保持不变。
// V2026-11-27 补充 (AF-559): 中文全角括号舞台说明是本次线上问题的直接形态，
//   并补“普通括号不被误删”的反例。

import { describe, expect, it } from 'vitest';

import { stripVisitorStageDirections } from '../../../src/shared/realism/index.js';

describe('stripVisitorStageDirections', () => {
  it('剥离句首括号动作并保留台词', () => {
    expect(stripVisitorStageDirections('（停顿）不然呢？')).toBe('不然呢？');
  });

  it('剥离句中括号动作，不把动作转成旁白', () => {
    expect(stripVisitorStageDirections('我（胸口发闷）没事。')).toBe('我没事。');
  });

  it('剥离星号动作与方括号舞台说明', () => {
    expect(stripVisitorStageDirections('*叹气*【低头】算了。')).toBe('算了。');
  });

  it('保留合法语义标签，只删动作片段', () => {
    expect(stripVisitorStageDirections('[emotion:calm]（沉默片刻）[pause:0.5]没事。')).toBe('[emotion:calm][pause:0.5]没事。');
  });

  it('整句只有舞台说明时退回沉默占位', () => {
    expect(stripVisitorStageDirections('（低头沉默）')).toBe('……');
  });

  it('纯台词逐字不变', () => {
    expect(stripVisitorStageDirections('不知道，就那样吧。')).toBe('不知道，就那样吧。');
  });

  it('普通半角括号补充不被误删（全角括号按契约一律剥）', () => {
    expect(stripVisitorStageDirections('我(真的)没想瞒你。')).toBe('我(真的)没想瞒你。');
    expect(stripVisitorStageDirections('我（真的）没想瞒你。')).toBe('我没想瞒你。');
  });

  it('剥离 2026-11-26 真实样本里的典型舞台说明', () => {
    expect(stripVisitorStageDirections('（声音很轻）我就是睡不着。')).toBe('我就是睡不着。');
    expect(stripVisitorStageDirections('没有胸痛，也不麻。（语速突然变快像倒豆子）')).toBe('没有胸痛，也不麻。');
    expect(stripVisitorStageDirections('（攥着衣角）我……我不知道该怎么说。')).toBe('我……我不知道该怎么说。');
    expect(stripVisitorStageDirections('（沉默很久）')).toBe('……');
  });
});
