// V2026-10-21 治本 (V1.2 VS-A — counselor LLM 场景配置):
//   原因: v1.2 落地需要真接 LLM (督导反馈 / 知情同意判定 / 实时轻提示 / 人设生成),
//     每类任务的"思考量 + 长度上限 + 超时窗口"需求不同, 硬编码散落在 service 里
//     会漂移 (典型: 改一个任务的 token 上限把另一个任务的 JSON 截断).
//     集中到 config, 一处改, 全局生效, 跟 counselor 现有 config/ 目录风格一致
//     (supervision-school-presets / training-exercise-seeds 同 pattern).
//
//   修法:
//     - COUNSELOR_LLM_DEFAULT_MODEL: 默认 MiniMax-M3.1-Flash (大炮 2026-10-21 拍板).
//       **不写死进代码**: 可用 env MINIMAX_COUNSELOR_LLM_MODEL 覆盖, 因为
//       .env 的 MINIMAX_BASE_URL 指向 api.minimax.chat, 若该域名未开 M3.1-Flash,
//       覆盖成 MiniMax-M3 即可 (M3 同样支持 chat/completions).
//     - COUNSELOR_LLM_PROFILES: 每个场景一组参数 (reasoningEffort / maxCompletionTokens / timeoutMs).
//     - supportsReasoningEffort(): reasoning_effort **仅 M3.1-Flash 生效**, 其他模型传了
//       上游可能拒 (官方文档: reasoning_effort 仅 MiniMax-M3.1-Flash 生效) → 调用前判断.
//     - stripThinkingTags(): M3 系列的 <think> 标签是**内联在 content 里**的
//       (M3.1-Flash 才走独立 reasoning_content 字段), 结构化 JSON 提取前必须剥掉,
//       否则 JSON.parse 必挂.
//
//   反双胞胎:
//     - 不改 .env 的 MINIMAX_LLM_MODEL / MINIMAX_BASE_URL: 两者是 ASR / TTS / voice
//       链路的共用全局值, 改动会打断已跑通的语音功能 (大炮红线: 不动 SDK 配置)
//     - 不用 temperature 控"确定性": 官方文档明确 M3.1-Flash 忽略 temperature / top_p
//       (固定 1 / 0.95), 靠 prompt 约束 + reasoning_effort 分档控成本, 不靠采样参数
//     - 不引新依赖: 纯字符串 + 正则, 不装 json-schema 校验库
//
//   验证:
//     1. tsc 0 错
//     2. 大炮跑 curl 生成督导反馈, 日志看 model=MiniMax-M3.1-Flash + usage.completion_tokens
//     3. 若上游返 404/400, 设 MINIMAX_COUNSELOR_LLM_MODEL=MiniMax-M3 重试
//
//   时间戳: 2026-10-21

import type { LlmReasoningEffort } from '../../agent/llm/llm.types';

/** counselor 端默认文本模型 (大炮 2026-10-21 拍板: 文本一律 MiniMax-M3.1-Flash). */
export const COUNSELOR_LLM_DEFAULT_MODEL = 'MiniMax-M3.1-Flash';

/** env 覆盖键 (可选). 缺省用 COUNSELOR_LLM_DEFAULT_MODEL. */
export const COUNSELOR_LLM_MODEL_ENV_KEY = 'MINIMAX_COUNSELOR_LLM_MODEL';

/**
 * 单个 LLM 场景的参数组.
 *
 * - reasoningEffort: 思考深度 (仅 M3.1-Flash 生效). 越高越准也越慢越贵.
 * - maxCompletionTokens: 生成长度上限, **thinking token 也计入** → 必须留足余量,
 *   否则 finish_reason=length 且 content 为空 (结构化 JSON 解析失败).
 * - timeoutMs: 单次请求超时窗口.
 */
export interface CounselorLlmProfile {
  readonly reasoningEffort: LlmReasoningEffort;
  readonly maxCompletionTokens: number;
  readonly timeoutMs: number;
}

/**
 * 场景参数表.
 *
 * supervision (督导反馈): 逐句点评 + 错误分类 + 成长建议, 要读完整 transcript 并做临床推理,
 *   用 high 档 + 8192 输出上限 (thinking + JSON 都要装得下) + 120s 超时.
 */
export const COUNSELOR_LLM_PROFILES: Readonly<
  Record<'supervision' | 'personaGeneration' | 'liveTurnAnalysis' | 'consentJudgement', CounselorLlmProfile>
> = {
  supervision: {
    reasoningEffort: 'high',
    maxCompletionTokens: 8192,
    timeoutMs: 120_000,
  },
  /**
   * personaGeneration (生成 AI 底层全量人设):
   *   v1.2 §4.1 的 7 大块里, developmentalTimeline (5 段) + socialMap (4 类关系) 都是数组,
   *   每项还带 3-4 个子字段 → 结构化 JSON 本体就 2000-4000 token.
   *   再叠 M3.1-Flash 的 thinking token (计入生成长度上限) → 给 16384 才不会 finish_reason=length.
   *   超时给到 180s: 一次生成要写出一整套人生剧本, 比单次督导慢.
   */
  personaGeneration: {
    reasoningEffort: 'high',
    maxCompletionTokens: 16_384,
    timeoutMs: 180_000,
  },
  /**
   * liveTurnAnalysis (每轮会谈分析 — 实时轻提示 + 移情/阻抗标记):
   *   这是**每轮**都要跑一次的调用, 所以延迟比质量更重要 (spec §6.1「不打断对话」).
   *   - reasoningEffort 用 low: 输出只是一个"方向提示 + 一个标记", 不需要长推理;
   *     M3.1-Flash 的思考档位是唯一可控的"思考量"旋钮 (temperature/top_p 已被忽略)
   *   - maxCompletionTokens 1024: 输出体量极小 (一段提示 + 一句备注), 留多了纯浪费额度
   *   - timeoutMs 30s: 超过这个窗口提示就失去"实时"意义, 不如不推
   */
  liveTurnAnalysis: {
    reasoningEffort: 'low',
    maxCompletionTokens: 1024,
    timeoutMs: 30_000,
  },
  /**
   * consentJudgement (知情同意 4 要素判定):
   *   要读完整同意阶段的对话, 逐要素判"是否讲全" + 来访当时的反应, 属于需要一定推理的任务,
   *   但输出体量小 (4 个元素), 所以 medium 档 + 4096 足够.
   */
  consentJudgement: {
    reasoningEffort: 'medium',
    maxCompletionTokens: 4096,
    timeoutMs: 90_000,
  },
};

/**
 * 该模型是否支持 reasoning_effort 字段.
 *
 * 官方文档: `reasoning_effort` 仅 MiniMax-M3.1-Flash 生效. M3 / M2.x 传了有被拒风险,
 * 所以这里按模型名判断, 只在支持时才下发该字段.
 */
export function supportsReasoningEffort(model: string): boolean {
  return /M3\.1/i.test(model);
}

/**
 * 剥掉响应里内联的 <think>...</think> 思考块.
 *
 * 背景: M3.1-Flash 的思考内容走独立 reasoning_content 字段 (content 干净), 但 M3 系列的
 * `<think>` 标签是**内联在 content 里的** (官方文档明确要求完整保留, 因为多轮 function call
 * 要靠它保持思维链). 本函数只用于"一次性结构化 JSON 提取"场景, 剥掉后不影响单轮结论.
 */
export function stripThinkingTags(raw: string): string {
  return raw.replaceAll(/<think>[\s\S]*?<\/think>/gi, '').replace(/<think>[\s\S]*$/i, '');
}
