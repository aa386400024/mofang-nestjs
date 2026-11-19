import { describe, expect, it } from 'vitest';

import { CounselorPromptBuilder } from '../../src/auto-practice/counselor/builder/counselor-prompt-builder.js';
import { sessionCloseDisciplineSection, CLOSE_TAG } from '../../src/auto-practice/counselor/builder/prompt-sections/close-discipline.js';
import { sessionOpeningFrameworkSection } from '../../src/auto-practice/counselor/builder/prompt-sections/opening-framework.js';
import type { CounselorMode } from '../../src/auto-practice/entities/counselor-mode.entity.js';
import { PROMPT_TEMPLATE_FILES, computePromptVersion } from '../../src/auto-practice/prompt-fingerprint.js';
import { LEGACY_SESSION_PROFILE, LONG_SESSION_PROFILE, STANDARD_SESSION_PROFILE } from '../../src/auto-practice/session-profile.js';

const MODE = {
  id: 'expert',
  name: '专家咨询师',
  systemPrompt: '你是一位专家咨询师。',
  description: '',
  enabled: 1,
  sortOrder: 0,
} as CounselorMode;

const builder = new CounselorPromptBuilder();

describe('AF-129 · 长会谈开场知情框架与结束收束纪律', () => {
  it('legacy 档不加开场框架，也不加长会话收尾纪律（逐字不变）', () => {
    const implicit = builder.build(MODE, false);
    const explicit = builder.build(MODE, false, LEGACY_SESSION_PROFILE, 3);
    expect(implicit).toBe(explicit);
    expect(implicit).not.toContain('## 开场知情框架');
    expect(implicit).not.toContain('## 长会话收尾纪律');
    expect(implicit).toContain('## 收尾纪律');
  });

  it('long 档启用开场知情框架，并覆盖五要素', () => {
    const prompt = builder.build(MODE, false, LONG_SESSION_PROFILE, 10);
    expect(prompt).toContain('## 开场知情框架');
    expect(prompt).toContain('保密');
    expect(prompt).toContain('例外');
    expect(prompt).toContain('约定');
    expect(prompt).toContain('边界');
    expect(prompt).toContain('分钟');
    expect(prompt).toContain('每周一次');
    expect(prompt).toContain('喊停');
    expect(prompt).toContain('可以拒绝');
    expect(prompt).toContain('录音');
    expect(prompt).toContain('同意');
  });

  it('standard 档同样启用开场知情框架', () => {
    const prompt = builder.build(MODE, false, STANDARD_SESSION_PROFILE, 5);
    expect(prompt).toContain('## 开场知情框架');
    expect(prompt).toContain('## 长会话收尾纪律');
  });

  it('长会话收尾纪律包含总结、带走、下一步三要素，且不早于 minTurnsBeforeClose', () => {
    const section = sessionCloseDisciplineSection(LONG_SESSION_PROFILE, 40);
    expect(section.enabled).toBe(true);
    expect(section.content).toContain('总结本次理解');
    expect(section.content).toContain('带走');
    expect(section.content).toContain('下一步安排');
    expect(section.content).toContain('第 35 轮之前不得输出');
    expect(section.content).toContain(CLOSE_TAG);
  });

  it('开场块只在长会话档案启用，legacy 档关闭', () => {
    expect(sessionOpeningFrameworkSection(LEGACY_SESSION_PROFILE).enabled).toBe(false);
    expect(sessionOpeningFrameworkSection(LONG_SESSION_PROFILE).enabled).toBe(true);
    expect(sessionOpeningFrameworkSection(STANDARD_SESSION_PROFILE).enabled).toBe(true);
  });

  it('开场块纳入 prompt_version 指纹，且真实仓库可算出非 unknown', () => {
    expect(PROMPT_TEMPLATE_FILES).toContain('counselor/builder/prompt-sections/opening-framework');
    expect(computePromptVersion()).not.toBe('unknown');
  });
});
