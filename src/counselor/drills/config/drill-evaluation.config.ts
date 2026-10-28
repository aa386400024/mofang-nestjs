// V2026-10-27 治本 (情景演练 · 运行参数配置):
//   原因: 任务单 §9 要求"新增类型集中在 domain/drills, env 键进 ProcessEnv（若引入）避免 TS4111".
//     本模块需要 2 个运行参数:
//       ① LLM 润色开关 (关掉后恒走关键词确定性路径, source 恒为 keyword)
//       ② 提交文本长度上限 (与 practice 同量级, 但**独立取值** —— 两个功能的入参契约不同)
//     这两个值如果散落在 DTO 与 service 里, 会出现"DTO 限 2000 字, service 按 500 字截断"
//     这类漂移, 且没有单一真值源.
//
//   修法: 本文件是情景演练的**运行参数单一真值源** (与 practice-evaluation.config.ts 同范式).
//
//   ── 反双胞胎 ──
//   - **不复用 practice 的开关解析函数**: practice 的 parseOnOffSwitch 是文件私有函数;
//     本文件改从 counselor 域共享层 `config/env-switch.ts` import (该函数已被提升为共享实现),
//     两边解析语义完全一致, 不会出现"一个把 'no' 当关, 另一个当开"的漂移.
//   - **不复用 practice 的文本长度上限常量**: PRACTICE_SUBMITTED_TEXT_MAX_LENGTH 是练习引擎的
//     入参契约; 演练有独立的入参契约, 共用一个常量等于把两个功能绑在一起 (改一个动两个).
//
//   验证:
//     1. tsc 0 错
//     2. env DRILL_LLM_EVALUATION=off → 演练不发起任何 LLM 调用, source 恒为 keyword
//   时间戳: 2026-10-27 21:10 GMT+8
import { parseOnOffSwitch } from '../../config/env-switch';

/** 情景演练 LLM 润色开关的 env 键 (覆盖演练润色链路). */
export const DRILL_LLM_EVALUATION_ENV_KEY = '***';

/** 情景演练 LLM 润色开关的缺省值 (缺省走 LLM 主路径, 失败自动降级为关键词路径). */
export const DRILL_LLM_EVALUATION_DEFAULT = 'on';

/** 学员单次提交回应文本的最大长度 (字). 超长会挤爆 prompt 上下文, 且单轮演练不需要长文. */
export const DRILL_SUBMITTED_TEXT_MAX_LENGTH = 2000;

/**
 * 解析情景演练 LLM 润色开关.
 *
 * @param raw env 原始值 (可能为 undefined / 空串)
 * @returns true = 允许发起 LLM 润色调用; false = 直接走确定性关键词路径
 */
export function isDrillLlmEvaluationEnabled(raw: string | undefined): boolean {
  return parseOnOffSwitch(raw, DRILL_LLM_EVALUATION_DEFAULT);
}
