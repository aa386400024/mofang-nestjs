// V2026-10-29 治本 (WP18 · 督导主报告 · LLM 场景参数档):
//   职责: 声明"主报告生成"这一**任务档位**的思考强度 / 生成长度上限 / 超时窗口,
//         并给出 env 覆盖入口.
//   边界: 纯类型 + 纯常量 + 一个 env 解析函数 (只依赖 ConfigService 的读接口),
//         不含任何 LLM 调用 / 写库 / prompt 拼装.
//
//   为什么要有这一档 (治本, 不是调参):
//     实测 (2026-10-29, MiniMax-M3.1-Flash, 真实督导 prompt 2342 字符):
//
//       变体                                    耗时   finish_reason  content   JSON
//       max_tokens=2500            (改前现状)   18~21s   length          0~656 字  ❌
//       max_completion_tokens=2500             18.5s    length            0 字   ❌
//       max_completion_tokens=8192             25.6s    stop            1829 字  ✅
//       max_completion_tokens=8192 + medium     8.8s    stop            1555 字  ✅
//       max_completion_tokens=8192 + high      15.5s    stop            1640 字  ✅
//
//     根因: M3.1-Flash 是推理模型, **思考 token 计入生成长度上限**. 改前的 2500 预算
//     被思考吃满 (实测 reasoning=2499/2500) → `finish_reason=length` → **正文一个字
//     都没吐出来** → 主报告 JSON 解析必然失败 → 复盘报告恒为 `parse_error`
//     (六维评分 / annotations / 成长建议 全是空壳).
//
//     注意 `max_tokens` 与 `max_completion_tokens` 在 MiniMax 上**语义一致** (都含思考),
//     所以这不是"字段名用错"的问题 —— 是**预算与思考深度不匹配**的问题.
//
//   为什么默认取 high + 8192 (而不是 low + 2500):
//     - 仓库里"读 transcript 出结构化临床评估"这条任务的**既有档位**是 counselor 侧的
//       4 流派督导 (`counselor-llm.config.ts` 的 `supervision` profile:
//       reasoningEffort='high' / maxCompletionTokens=8192 / timeoutMs=120s).
//       主报告与 4 流派是**同一类任务**, 同档 = 消双胞胎.
//     - 任务单口径: supervision 属"重推理任务", 不随 render 的 low 档走 (WP9-C §2.1).
//     - 实测 high+8192 出完整 JSON 且只花 15.5s, 120s 超时窗口充裕.
//
//   为什么 env 可配 (而不是写死):
//     思考深度是**模型相关**的 —— 换模型 / 换模型版本 / 上游调整思考策略, 同一档位
//     可能又不够. 写死就得改代码重新发版; env 可配则运维改一行 + 重启即可.
//     (与 render 侧 `ENGINE_RENDER_MAX_TOKENS` / `ENGINE_RENDER_REASONING_EFFORT` 同思路.)
//
//   反双胞胎:
//     - 不与 render 档位共用常量: render 是"把决策翻译成口语" (低思考, 1500 够),
//       supervision 是"读完整逐字稿出临床评估" (高思考, 8192 够). 两个任务档位必须
//       各管各的 —— 共用一个常量就等于把一处的改动传导到另一处.
//     - 不在这里做 JSON 容错: 那是所有结构化输出链路的公共前置工序, 住在
//       `src/shared/llm/llm-json-payload.ts`.
//     - 不读 prompt 里的业务字段: 本文件只管"调 LLM 时的旋钮".
//
//   如何验证:
//     1. npx tsc -p tsconfig.build.json --noEmit 0 错
//     2. test/agent/wp18-supervisor-llm-profile.spec.ts 覆盖默认值 / env 覆盖 / 非法值回落

import type { ConfigService } from '@nestjs/config';

import type { LlmReasoningEffort } from '../llm/llm.types';

/**
 * 主报告参数档的 DI token.
 *
 * 为什么用 Symbol 而不是字符串: 字符串 token 与仓内其它 provider 撞名时 Nest **不报错**,
 * 而是静默注入错的东西, 排查时表现为"某个模块拿到了另一个模块的依赖".
 *
 * 注册方: `supervisor.module.ts` (useFactory, 从 env 读).
 */
export const SUPERVISOR_LLM_PROFILE = Symbol('SUPERVISOR_LLM_PROFILE');

/**
 * 单个 LLM 场景的参数组 (与 counselor 侧 `CounselorLlmProfile` 同构, 但各管各的档).
 */
export interface SupervisorLlmProfile {
  /**
   * 思考深度 (仅 MiniMax-M3.1-Flash 生效).
   *
   * 为什么不是 low: 主报告要在**完整逐字稿**上做临床评估 (六维打分 / 逐条标注 /
   * 错误模式 / 成长建议), 思考深度直接决定报告质量; 而 8192 的预算已足够容纳
   * high 档思考 (实测 high 的 reasoning=1216).
   */
  readonly reasoningEffort: LlmReasoningEffort;
  /**
   * 生成长度上限 (thinking token **也计入**).
   *
   * 必须留足余量: 上限被思考吃满 → `finish_reason=length` → 正文为空 →
   * JSON 解析失败 → 报告恒 `parse_error` (实测 2500 就是这么坏的).
   */
  readonly maxCompletionTokens: number;
  /** 单次请求超时窗口 (ms). 长 transcript + high 档思考需要比默认 60s 更宽. */
  readonly timeoutMs: number;
}

/**
 * 主报告档位的默认值 (与 counselor 侧 4 流派督导同档 —— 同一类任务, 同一口径).
 */
export const DEFAULT_SUPERVISOR_LLM_PROFILE: SupervisorLlmProfile = {
  reasoningEffort: 'high',
  maxCompletionTokens: 8192,
  timeoutMs: 120_000,
};

/** env 覆盖键: 思考深度. */
export const SUPERVISOR_REASONING_EFFORT_ENV_KEY = 'ENGINE_SUPERVISION_REASONING_EFFORT';
/** env 覆盖键: 生成长度上限. */
export const SUPERVISOR_MAX_TOKENS_ENV_KEY = 'ENGINE_SUPERVISION_MAX_TOKENS';
/** env 覆盖键: 超时窗口 (ms). */
export const SUPERVISOR_TIMEOUT_MS_ENV_KEY = 'ENGINE_SUPERVISION_TIMEOUT_MS';

/** 合法思考档位 (与 `ChatReasoningEffort` 同步). */
const REASONING_EFFORT_VALUES: readonly LlmReasoningEffort[] = ['low', 'medium', 'high', 'xhigh', 'max'];

/**
 * 解析主报告的 LLM 参数档 (env 覆盖 + 非法值回落).
 *
 * 非法值**回落默认值**而不是抛错: 这是运维旋钮, 配错了不该让整个服务起不来
 * (报告生成是收尾环节, 不该成为启动的硬依赖). 配错的事实由日志暴露, 行为回落默认.
 *
 * @param config 全局配置 (ConfigModule 全局注入)
 * @returns 主报告参数档
 */
export function readSupervisorLlmProfile(config: ConfigService): SupervisorLlmProfile {
  return {
    reasoningEffort: readReasoningEffort(config.get<string>(SUPERVISOR_REASONING_EFFORT_ENV_KEY)),
    maxCompletionTokens:
      readPositiveNumber(config.get<string>(SUPERVISOR_MAX_TOKENS_ENV_KEY)) ?? DEFAULT_SUPERVISOR_LLM_PROFILE.maxCompletionTokens,
    timeoutMs: readPositiveNumber(config.get<string>(SUPERVISOR_TIMEOUT_MS_ENV_KEY)) ?? DEFAULT_SUPERVISOR_LLM_PROFILE.timeoutMs,
  };
}

/**
 * 解析思考深度 env 值 (非法 → 回落默认).
 *
 * @param raw env 原始值
 * @returns 合法档位
 */
function readReasoningEffort(raw: string | undefined): LlmReasoningEffort {
  const trimmed = (raw ?? '').trim().toLowerCase();
  if (trimmed.length === 0) {
    return DEFAULT_SUPERVISOR_LLM_PROFILE.reasoningEffort;
  }
  const matched = REASONING_EFFORT_VALUES.find((value) => value === trimmed);
  return matched ?? DEFAULT_SUPERVISOR_LLM_PROFILE.reasoningEffort;
}

/**
 * 解析正整数 env 值 (非法/非正 → null).
 *
 * @param raw env 原始值
 * @returns 正整数; 非法时 null
 */
function readPositiveNumber(raw: string | undefined): number | null {
  const trimmed = (raw ?? '').trim();
  if (trimmed.length === 0) {
    return null;
  }
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }
  return Math.floor(parsed);
}
