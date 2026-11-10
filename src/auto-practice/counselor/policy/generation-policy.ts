import type { CounselorGenerationPolicy } from '../dto/counselor-types.js';

/**
 * 默认生成参数策略 (临床严谨模式).
 *
 * V2026-11-10 P1f: 温度从 0.7 降到 0.5 —— 临床咨询需要稳定性和一致性,
 * 0.7 偏创造性, 重复确认事实时容易漂移 (自相矛盾的根因之一).
 */
export const DEFAULT_GENERATION_POLICY: CounselorGenerationPolicy = {
  temperature: 0.5,
  maxCompletionTokens: 500,
  reasoningEffort: 'low',
};

/**
 * 训练探索模式 (以后做 A/B 测试时用, 现在不用).
 * 更高温度, 更探索性的对话.
 */
export const EXPLORATION_GENERATION_POLICY: CounselorGenerationPolicy = {
  temperature: 0.7,
  maxCompletionTokens: 500,
  reasoningEffort: 'low',
};
