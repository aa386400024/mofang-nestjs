// V2026-10-29 治本 (WP18 · 督导主报告 · LLM 参数档):
//   覆盖任务单 §4 终局形态 "reasoningEffort 按 taskKind 路由（render / analysis /
//   supervision 各自配置）" 在**主报告这一档**的可测行为:
//     ① 默认档 = 与 counselor 侧 4 流派督导同档 (high / 8192 / 120s) —— 同一类任务同口径;
//     ② env 可覆盖三件套 (思考深度 / 长度上限 / 超时);
//     ③ 非法 env 值 → **回落默认**, 不抛错 —— 运维旋钮配错不该让服务起不来.
//
//   验证: npx jest test/agent/wp18-supervisor-llm-profile.spec.ts
//   时间戳: 2026-10-29 GMT+8

import type { ConfigService } from '@nestjs/config';

import {
  DEFAULT_SUPERVISOR_LLM_PROFILE,
  SUPERVISOR_MAX_TOKENS_ENV_KEY,
  SUPERVISOR_REASONING_EFFORT_ENV_KEY,
  SUPERVISOR_TIMEOUT_MS_ENV_KEY,
  readSupervisorLlmProfile,
} from '../../src/agent/supervisor/supervisor-llm.config';

/** 只实现 get() 的配置替身 (够 readSupervisorLlmProfile 用). */
function stubConfig(values: Record<string, string>): ConfigService {
  return {
    get: <T>(key: string): T | undefined => values[key] as T | undefined,
  } as unknown as ConfigService;
}

describe('WP18 · 督导主报告 LLM 参数档', () => {
  describe('① 默认档', () => {
    it('没配 env 时用默认档', () => {
      const profile = readSupervisorLlmProfile(stubConfig({}));

      expect(profile).toEqual(DEFAULT_SUPERVISOR_LLM_PROFILE);
    });

    it('默认档 = high / 8192 / 120s (与 counselor 侧 4 流派督导同档)', () => {
      expect(DEFAULT_SUPERVISOR_LLM_PROFILE.reasoningEffort).toBe('high');
      expect(DEFAULT_SUPERVISOR_LLM_PROFILE.maxCompletionTokens).toBe(8192);
      expect(DEFAULT_SUPERVISOR_LLM_PROFILE.timeoutMs).toBe(120_000);
    });

    it('默认档的思考档位不是 low (supervision 属重推理任务, 不随 render 的 low 走)', () => {
      expect(DEFAULT_SUPERVISOR_LLM_PROFILE.reasoningEffort).not.toBe('low');
    });
  });

  describe('② env 覆盖', () => {
    it('三件套都能覆盖', () => {
      const profile = readSupervisorLlmProfile(
        stubConfig({
          [SUPERVISOR_REASONING_EFFORT_ENV_KEY]: 'medium',
          [SUPERVISOR_MAX_TOKENS_ENV_KEY]: '4096',
          [SUPERVISOR_TIMEOUT_MS_ENV_KEY]: '90000',
        }),
      );

      expect(profile.reasoningEffort).toBe('medium');
      expect(profile.maxCompletionTokens).toBe(4096);
      expect(profile.timeoutMs).toBe(90_000);
    });

    it('思考档位大小写与空格不敏感', () => {
      const profile = readSupervisorLlmProfile(stubConfig({ [SUPERVISOR_REASONING_EFFORT_ENV_KEY]: '  HIGH  ' }));

      expect(profile.reasoningEffort).toBe('high');
    });

    it('小数上限取整 (向下), 不传小数给上游', () => {
      const profile = readSupervisorLlmProfile(stubConfig({ [SUPERVISOR_MAX_TOKENS_ENV_KEY]: '4096.9' }));

      expect(profile.maxCompletionTokens).toBe(4096);
    });
  });

  describe('③ 非法值回落默认 (不抛错)', () => {
    it('非法思考档位 → 回落默认', () => {
      const profile = readSupervisorLlmProfile(stubConfig({ [SUPERVISOR_REASONING_EFFORT_ENV_KEY]: 'ultra' }));

      expect(profile.reasoningEffort).toBe(DEFAULT_SUPERVISOR_LLM_PROFILE.reasoningEffort);
    });

    it('非数字上限 → 回落默认', () => {
      const profile = readSupervisorLlmProfile(stubConfig({ [SUPERVISOR_MAX_TOKENS_ENV_KEY]: '很多' }));

      expect(profile.maxCompletionTokens).toBe(DEFAULT_SUPERVISOR_LLM_PROFILE.maxCompletionTokens);
    });

    it('零 / 负数上限 → 回落默认 (0 预算必然打满即空)', () => {
      const zero = readSupervisorLlmProfile(stubConfig({ [SUPERVISOR_MAX_TOKENS_ENV_KEY]: '0' }));
      const negative = readSupervisorLlmProfile(stubConfig({ [SUPERVISOR_MAX_TOKENS_ENV_KEY]: '-1' }));

      expect(zero.maxCompletionTokens).toBe(DEFAULT_SUPERVISOR_LLM_PROFILE.maxCompletionTokens);
      expect(negative.maxCompletionTokens).toBe(DEFAULT_SUPERVISOR_LLM_PROFILE.maxCompletionTokens);
    });

    it('非数字超时 → 回落默认', () => {
      const profile = readSupervisorLlmProfile(stubConfig({ [SUPERVISOR_TIMEOUT_MS_ENV_KEY]: 'soon' }));

      expect(profile.timeoutMs).toBe(DEFAULT_SUPERVISOR_LLM_PROFILE.timeoutMs);
    });
  });
});
