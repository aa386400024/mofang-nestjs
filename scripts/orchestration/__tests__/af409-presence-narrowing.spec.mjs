import { describe, expect, it } from 'vitest';

import {
  classifyNarrow,
  classifyStructureOnly,
  hasContentWord,
  hasStructureMarker,
  isConfrontation,
  isMediumAck,
  isMinimalAck,
  summarizeNarrow,
} from '../../ops/quality/af409-presence-narrowing.mjs';
import { projectDimensions } from '../../ops/quality/af408-presence-calibration.mjs';

describe('AF-409 收窄版在场判定', () => {
  it('识别结构化过渡与内容承载词', () => {
    expect(hasStructureMarker('我们分三步来：先说事实，再说感受，最后定一个行动。')).toBe(true);
    expect(hasContentWord('最近睡眠怎么样？')).toBe(true);
    expect(hasStructureMarker('你好。')).toBe(false);
  });

  it('识别对峙特征并优先阻断', () => {
    expect(isConfrontation('你为什么每次都这样？')).toBe(true);
    expect(classifyNarrow('你为什么每次都这样？')).toBe('neutral');
  });

  it('最小应答判 cold，中短承接判 holding', () => {
    expect(isMinimalAck('好的。')).toBe(true);
    expect(classifyNarrow('好的。')).toBe('cold_absent');
    expect(isMediumAck('好，我们说说工作')).toBe(true);
    expect(classifyNarrow('好，我们说说工作')).toBe('holding_present');
  });

  it('疑问且带内容才升级为 holding', () => {
    expect(classifyNarrow('最近这种情况大概持续多久了？')).toBe('holding_present');
    expect(classifyNarrow('你好。')).toBe('neutral');
    expect(classifyNarrow('我们分三步来：先说事实，再说感受，最后定一个行动。')).toBe('neutral');
  });

  it('仅结构化变体只认“疑问 ∧ 结构标记”', () => {
    expect(classifyStructureOnly('我们分三步来，先说事实，你觉得呢？')).toBe('holding_present');
    expect(classifyStructureOnly('我们分三步来：先说事实，再说感受。')).toBe('neutral');
    expect(classifyStructureOnly('你为什么每次都这样？')).toBe('neutral');
  });

  it('收窄版汇总计数可复算', () => {
    const summary = summarizeNarrow(['你为什么每次都这样？', '好的。', '好，我们说说工作', '最近睡眠怎么样？']);
    expect(summary).toMatchObject({ turns: 4, holding: 2, cold: 1, neutral: 1 });
  });

  it('cold14 投影 trust 不变，safety/bond 小幅上升', () => {
    const projected = projectDimensions([...Array(11).fill('holding_present'), ...Array(3).fill('neutral')], {
      trust: 0.25,
      safety: 0.25,
      bond: 0.2,
      valence: -0.55,
      arousal: 0.35,
    });
    expect(projected.trust).toBeCloseTo(0.25, 6);
    expect(projected.safety).toBeCloseTo(0.294, 6);
    expect(projected.bond).toBeCloseTo(0.222, 6);
  });
});
