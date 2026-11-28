// AF-611 · Rubric / Prompt 版本化: 指纹稳定 / 变更可追溯 / 跨版本不可比 / Prompt 渲染.

import { describe, expect, it } from 'vitest';

import {
  JUDGE_PROMPT_VERSION,
  JUDGE_RUBRIC,
  JUDGE_RUBRIC_V1,
  JUDGE_RUBRIC_VERSION,
  computeJudgeRubricFingerprint,
  isJudgeVersionComparable,
  renderJudgePrompt,
} from '../../../src/engine-adapters/judge/judge.rubric.js';
import { JUDGE_MACHINE_PROXY_LABEL } from '../../../src/engine-adapters/judge/judge.types.js';

describe('AF-611 · Rubric 版本化', () => {
  it('当前版本号与配置一致', () => {
    expect(JUDGE_RUBRIC.version).toBe(JUDGE_RUBRIC_VERSION);
    expect(JUDGE_RUBRIC.promptVersion).toBe(JUDGE_PROMPT_VERSION);
    expect(JUDGE_RUBRIC.dimensions).toHaveLength(3);
  });

  it('同配置指纹稳定, 键序变化不影响', () => {
    const first = computeJudgeRubricFingerprint(JUDGE_RUBRIC_V1);
    const reordered = {
      ...JUDGE_RUBRIC_V1,
      dimensions: JUDGE_RUBRIC_V1.dimensions.map((dimension) => ({
        anchors: { 2: dimension.anchors[2], 0: dimension.anchors[0], 1: dimension.anchors[1] },
        dimension: dimension.dimension,
        label: dimension.label,
      })),
    };
    expect(computeJudgeRubricFingerprint(reordered)).toBe(first);
    expect(first).toHaveLength(64);
  });

  it('锚点变更 → 指纹变化 (Rubric 变更必须进血缘)', () => {
    const changed = {
      ...JUDGE_RUBRIC_V1,
      dimensions: JUDGE_RUBRIC_V1.dimensions.map((dimension, index) =>
        index === 0 ? { ...dimension, anchors: { ...dimension.anchors, 1: '新的 1 档描述' } } : dimension,
      ),
    };
    expect(computeJudgeRubricFingerprint(changed)).not.toBe(computeJudgeRubricFingerprint(JUDGE_RUBRIC_V1));
  });

  it('跨 Rubric / Prompt 版本不得直接纵向比较', () => {
    expect(
      isJudgeVersionComparable(
        { rubricVersion: JUDGE_RUBRIC_VERSION, promptVersion: JUDGE_PROMPT_VERSION },
        { rubricVersion: 'judge-rubric-v0', promptVersion: JUDGE_PROMPT_VERSION },
      ),
    ).toBe(false);
    expect(
      isJudgeVersionComparable(
        { rubricVersion: JUDGE_RUBRIC_VERSION, promptVersion: JUDGE_PROMPT_VERSION },
        { rubricVersion: JUDGE_RUBRIC_VERSION, promptVersion: 'judge-prompt-v0' },
      ),
    ).toBe(false);
    expect(
      isJudgeVersionComparable(
        { rubricVersion: JUDGE_RUBRIC_VERSION, promptVersion: JUDGE_PROMPT_VERSION },
        { rubricVersion: JUDGE_RUBRIC_VERSION, promptVersion: JUDGE_PROMPT_VERSION },
      ),
    ).toBe(true);
  });

  it('Prompt 渲染带上三档锚点 / 脱敏输入 / 机器代理标注', () => {
    const prompt = renderJudgePrompt({
      l0: { trust: 0.4 },
      l1: [{ turnIndex: 1, eventTags: ['empathy'] }],
      redactedExcerpts: [{ excerptId: 't1', turnIndex: 1, text: '第1轮 · 风险=low', redactionTags: ['structured_digest'] }],
      excludedTurns: [],
    });

    expect(prompt).toContain('empathic_attunement');
    expect(prompt).toContain('0=');
    expect(prompt).toContain(JUDGE_MACHINE_PROXY_LABEL);
    expect(prompt).toContain('第1轮 · 风险=low');
    expect(prompt).not.toContain('{{rubric}}');
    expect(prompt).not.toContain('{{input}}');
  });
});
