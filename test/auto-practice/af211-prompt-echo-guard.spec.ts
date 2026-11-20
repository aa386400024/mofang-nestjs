// V2026-11-21 建立 (AF-211 · R4 常开回显拦截):
//   证明 prompt 模板标记在输出完整性闸门里常开生效，不依赖 RENDER_REALISM_MODE。

import { describe, expect, it } from 'vitest';

import { PROMPT_ECHO_MARKERS } from '../../src/shared/realism/index.js';
import { inspectGeneratedOutput } from '../../src/shared/text/output-integrity.js';

describe('AF-211 · prompt 回显常开拦截', () => {
  it.each(PROMPT_ECHO_MARKERS)('模板标记「%s」命中 prompt_marker', (marker) => {
    const result = inspectGeneratedOutput(`前一句。${marker}这轮你要少说。`, 'visitor');
    expect(result.invalid).toBe(true);
    expect(result.reasons).toContain('prompt_marker');
  });

  it('真实故障形态：整段角色设定被当成台词回显', () => {
    const leaked =
      '关键事件：最近工作压力大\n你心里坚信：把问题分析清楚就能解决\n你绝不会做的事：承认自己撑不住\n这一轮怎么说：回答要短、要躲闪。';
    const result = inspectGeneratedOutput(leaked, 'visitor');
    expect(result.invalid).toBe(true);
    expect(result.reasons).toContain('prompt_marker');
  });

  it('正常来访者口语不误报', () => {
    const result = inspectGeneratedOutput('我最近总睡不好，脑子里事太多。', 'visitor');
    expect(result.invalid).toBe(false);
    expect(result.reasons).toEqual([]);
  });

  it('常开闸门与 R3 审计使用同一份模板词表', () => {
    const result = inspectGeneratedOutput('【本轮重说要求】只输出能直接朗读的台词。', 'visitor');
    expect(result.reasons).toContain('prompt_marker');
  });
});
