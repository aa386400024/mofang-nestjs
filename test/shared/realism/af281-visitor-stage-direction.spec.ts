// V2026-11-22 建立 (AF-281 · 舞台说明投影):
//   覆盖“写了也不会出声”的硬契约：括号/星号动作被剥离，纯台词与合法语义标签保持不变。

import { describe, expect, it } from 'vitest';

import { stripVisitorStageDirections } from '../../../src/shared/realism/index.js';

describe('stripVisitorStageDirections', () => {
  it('剥离句首括号动作并保留台词', () => {
    expect(stripVisitorStageDirections('（停顿）不然呢？')).toBe('不然呢？');
  });

  it('剥离句中括号动作，不把动作转成旁白', () => {
    expect(stripVisitorStageDirections('我（胸口发闷）没事。')).toBe('我 没事。');
  });

  it('剥离星号动作与方括号舞台说明', () => {
    expect(stripVisitorStageDirections('*叹气*【低头】算了。')).toBe('算了。');
  });

  it('保留合法语义标签，只删动作片段', () => {
    expect(stripVisitorStageDirections('[emotion:calm]（沉默片刻）[pause:0.5]没事。')).toBe('[emotion:calm] [pause:0.5]没事。');
  });

  it('整句只有舞台说明时退回沉默占位', () => {
    expect(stripVisitorStageDirections('（低头沉默）')).toBe('……');
  });

  it('纯台词逐字不变', () => {
    expect(stripVisitorStageDirections('不知道，就那样吧。')).toBe('不知道，就那样吧。');
  });
});
