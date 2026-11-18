import type { SessionProfileName } from '../../session-profile.js';
import type { CounselorGenerationPolicy } from '../dto/counselor-types.js';

/**
 * 默认生成参数策略 (临床严谨模式).
 *
 * V2026-11-10 P1f: 温度从 0.7 降到 0.5 —— 临床咨询需要稳定性和一致性,
 * 0.7 偏创造性, 重复确认事实时容易漂移 (自相矛盾的根因之一).
 *
 * ⚠️ AF-102: 这份是 **legacy 档**的策略, **逐字不变** (500 / low / 0.5).
 *   别的档位用各自独立的策略, 见 {@link resolveGenerationPolicy}.
 */
export const DEFAULT_GENERATION_POLICY: CounselorGenerationPolicy = {
  temperature: 0.5,
  maxCompletionTokens: 500,
  reasoningEffort: 'low',
};

/**
 * standard 档的生成策略 (30 轮会话).
 *
 * AF-102: 预算从 500 抬到 1024 —— 推理 token **计入**生成长度上限,
 * 预算太小会出现"思考吃光额度、可见台词为空". 30 轮会话的思考量比 15 轮多,
 * 500 不够用, 但也不需要 long 档那么多.
 */
export const STANDARD_GENERATION_POLICY: CounselorGenerationPolicy = {
  temperature: 0.5,
  maxCompletionTokens: 1024,
  reasoningEffort: 'low',
};

/**
 * long 档的生成策略 (50 轮会话).
 *
 * AF-102: 预算至少 2048 —— 真实故障里 500 的额度被 thinking 吃掉了 93%~96%,
 * 可见台词直接归零. `reasoningEffort` 保持 `low`: 治本是**抬高可见输出预算**,
 * 不是让模型想更多 (想更多 = 更贵 + 更慢 + 更可能把额度吃光).
 */
export const LONG_GENERATION_POLICY: CounselorGenerationPolicy = {
  temperature: 0.5,
  maxCompletionTokens: 2048,
  reasoningEffort: 'low',
};

/**
 * 重试预算 (可见输出为空 / 被截断时用更高预算重试一次).
 *
 * AF-102: 至少 4096 —— 一次失败的思考可能已经花掉 500~2048,
 * 重试必须给足"再想一遍 + 说出口"的空间, 否则只是把同一个空回复再要一次.
 */
export const RETRY_GENERATION_POLICY: CounselorGenerationPolicy = {
  temperature: 0.5,
  maxCompletionTokens: 4096,
  reasoningEffort: 'low',
};

/**
 * 按会话档案取生成策略 (纯函数).
 *
 * ⚠️ 缺省 = legacy (500) —— 老调用方什么都不传时行为不变.
 *
 * @param profileName 会话档案名
 * @returns 该档的生成策略
 */
export function resolveGenerationPolicy(profileName: SessionProfileName): CounselorGenerationPolicy {
  if (profileName === 'long') return LONG_GENERATION_POLICY;
  if (profileName === 'standard') return STANDARD_GENERATION_POLICY;
  return DEFAULT_GENERATION_POLICY;
}

/**
 * 训练探索模式 (以后做 A/B 测试时用, 现在不用).
 * 更高温度, 更探索性的对话.
 */
export const EXPLORATION_GENERATION_POLICY: CounselorGenerationPolicy = {
  temperature: 0.7,
  maxCompletionTokens: 500,
  reasoningEffort: 'low',
};
