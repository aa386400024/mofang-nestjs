// V2026-10-27 治本 (情景演练 · 判定编排服务 — 确定性判定 + 可选措辞润色):
//   原因: 任务单 §2.2 把权限切得很死: "LLM 只在关键词不足时做形态润色, **不得由 LLM 直接改判档位**";
//     §4.3 又要求 "LLM 不可用/超时 → 走关键词确定性兜底, source='keyword', 照样返回完整结构".
//     这两句合起来 = 本服务必须**先**用纯函数算出档位与覆盖清单, 再决定要不要请模型改写措辞,
//     而且模型失败/越界时必须能**整份**回落到确定性文案 —— 半份替换会让同一屏出现两种口吻.
//   修法: 本服务是"判定 + 润色"的唯一编排点, 职责三块:
//     ① evaluate(): 纯函数判定 → 组装 DrillEvaluation (档位/覆盖清单/批注永远来自纯函数)
//     ② polish(): 可选润色 (boundary 赛道; crisis 恒不走模型, 见下)
//     ③ 兜底: 模型不可用/超时/越界 → 整份回落到确定性文案, source='keyword'
//
//   ── 为什么 crisis 赛道不走模型 (与 boundary 不同) ──
//   任务单 §3.1 把危机内容的**审核责任**划给录入方 ("内容审核责任在录入方"), §6 明确
//   "LLM 自由生成危机人物/剧本（本期全部静态录入）".
//   让模型改写危机批注 = 让未审内容进入危机域, 且模型可能顺手带出热线号码 / 机构名 /
//   临床措辞 (任务单 §3.1 明令禁止出现的三类东西) —— 风险不对等.
//   故: **crisis 恒走确定性路径** (source 恒为 keyword), 只有 boundary 才允许润色.
//
//   ── 反双胞胎 ──
//   - **不在 service 里写判定分支**: 判定规则只在 domain/drill-judge.ts 一份.
//   - **不引入第二套 LLM client**: 复用 counselor 域唯一的结构化出口 CounselorLlmJsonClient
//     (仓库既有约定: 每次结构化输出都走它), 不自己拼 SSE.
//   - **不做逐条合并**: 模型产出**整份**校验通过才采用, 否则整份丢弃 ——
//     逐条合并会让"确定性文案 + 模型文案"混在一屏里, 两种口吻比一种口吻更糟.
//   - **不在这里校验零压词表**: 词表是**共享层**的单一真值 (domain/zero-pressure.guard.ts),
//     本服务只调用, 不自带一份.
//
//   验证:
//     1. tsc 0 错
//     2. env DRILL_LLM_EVALUATION=off → 不发起任何 LLM 调用, source 恒为 keyword
//     3. 模型产出含"得分/及格" → 整份判废 → source 回落到 keyword
//     4. crisis 赛道 → 恒不发起 LLM 调用
//   时间戳: 2026-10-27 21:20 GMT+8
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { hasZeroPressureViolation } from '../../domain/zero-pressure.guard';
import { PracticeFeedbackSource } from '../../enums/practice-feedback-source.enum';
import { CounselorLlmJsonClient } from '../../providers/llm-json.client';
import { DRILL_LLM_EVALUATION_ENV_KEY, isDrillLlmEvaluationEnabled } from '../config/drill-evaluation.config';
import { DRILL_POLISH_SCHEMA_DESCRIPTION, DRILL_POLISH_SYSTEM_PROMPT, buildDrillPolishUserPrompt } from '../config/drill-prompts';
import { judgeDrill } from '../domain/drill-judge';
import type { DrillItem, DrillScript } from '../domain/drill.types';

/**
 * 润色调用的 LLM 参数 (与 practice 的 profile 同款口径, 但**独立取值** —— 演练的产出很短).
 *
 * 独立成常量而不是塞进 counselor-llm.config.ts 的 profile 表: profile 表是"按场景取值"的
 * 共享表, 演练的润色是**可选降级**而非主判定路径, 放进共享表会让人误以为它是主链路的一环.
 */
const DRILL_POLISH_MAX_COMPLETION_TOKENS = 2048;
const DRILL_POLISH_TIMEOUT_MS = 30_000;
const DRILL_POLISH_REASONING_EFFORT = 'low';

/**
 * 模型产出校验: 只接受"条数相同 / tone 相同 / pointKey 相同"的 items 数组.
 *
 * 任何一项不符 → 整份判废 (返回 null), 调用方回落确定性文案.
 */
export function validateDrillPolishPayload(raw: unknown, expected: readonly DrillItem[]): DrillItem[] | null {
  if (typeof raw !== 'object' || raw === null) {
    return null;
  }
  const items = (raw as Record<string, unknown>)['items'];
  if (!Array.isArray(items) || items.length !== expected.length) {
    return null;
  }

  const parsed: DrillItem[] = [];
  for (const [index, candidate] of items.entries()) {
    if (typeof candidate !== 'object' || candidate === null) {
      return null;
    }
    const record = candidate as Record<string, unknown>;
    const tone = record['tone'];
    const pointKey = record['pointKey'];
    const text = record['text'];

    // 条数/顺序/tone/锚点都必须与确定性结果一致 —— 模型只允许改 text.
    if (tone !== expected[index]?.tone || pointKey !== expected[index]?.pointKey) {
      return null;
    }
    if (typeof text !== 'string' || text.trim().length === 0) {
      return null;
    }
    const trimmed = text.trim();
    // 零压守门: 模型一旦写出评分/评级措辞, 整份判废 (与 practice 的口径一致).
    if (hasZeroPressureViolation(trimmed)) {
      return null;
    }
    parsed.push({ tone: expected[index].tone, pointKey: expected[index].pointKey, text: trimmed });
  }

  return parsed;
}

/**
 * 情景演练判定编排服务.
 */
@Injectable()
export class DrillEvaluatorService {
  private readonly logger = new Logger(DrillEvaluatorService.name);

  constructor(
    private readonly llmJson: CounselorLlmJsonClient,
    private readonly config: ConfigService,
  ) {}

  /**
   * 判定一次回应.
   *
   * @param script 情景剧本
   * @param submittedText 学员提交的回应原文
   * @param userId 当前用户 id (计费 + 审计)
   * @returns 判定结果 (档位/覆盖清单/批注/来源)
   */
  async evaluate(script: DrillScript, submittedText: string, userId: string): Promise<DrillEvaluationResult> {
    // ① 纯函数判定: 档位与覆盖清单**永远**来自这里, 与模型无关.
    const judgement = judgeDrill(script, submittedText);
    const base = {
      drillId: script.drillId,
      track: script.track,
      verdict: judgement.verdict,
      coveredPointKeys: judgement.coveredPointKeys,
      missedPointKeys: judgement.missedPointKeys,
      referenceResponse: script.referenceResponse,
      commonPitfalls: [...script.commonPitfalls],
    };

    // ② crisis 恒不走模型 (合规: 危机内容审核责任在录入方).
    if (script.track === 'crisis') {
      return { ...base, items: judgement.items, source: PracticeFeedbackSource.KEYWORD };
    }

    // ③ 开关关闭 → 直接返回确定性文案.
    if (!isDrillLlmEvaluationEnabled(this.config.get<string>(DRILL_LLM_EVALUATION_ENV_KEY))) {
      return { ...base, items: judgement.items, source: PracticeFeedbackSource.KEYWORD };
    }

    // ④ 请求模型润色措辞; 任何失败都整份回落确定性文案.
    const polished = await this.polish(script, submittedText, judgement.items, userId);
    if (polished === null) {
      return { ...base, items: judgement.items, source: PracticeFeedbackSource.KEYWORD };
    }

    return { ...base, items: polished, source: PracticeFeedbackSource.LLM };
  }

  /**
   * 请模型只改写批注措辞.
   *
   * @param script 情景剧本
   * @param submittedText 学员提交的回应原文
   * @param items 确定性批注 (模型只允许改 text)
   * @param userId 当前用户 id
   * @returns 润色后的批注; 失败/越界返回 null (调用方整份回落)
   */
  private async polish(
    script: DrillScript,
    submittedText: string,
    items: readonly DrillItem[],
    userId: string,
  ): Promise<DrillItem[] | null> {
    const result = await this.llmJson.requestJson<DrillItem[]>({
      systemPrompt: DRILL_POLISH_SYSTEM_PROMPT,
      userPrompt: buildDrillPolishUserPrompt({
        title: script.title,
        setting: script.setting,
        visitorPrompt: script.visitorPrompt,
        submittedText,
        items,
      }),
      schemaDescription: DRILL_POLISH_SCHEMA_DESCRIPTION,
      validate: (raw): DrillItem[] | null => validateDrillPolishPayload(raw, items),
      maxCompletionTokens: DRILL_POLISH_MAX_COMPLETION_TOKENS,
      reasoningEffort: DRILL_POLISH_REASONING_EFFORT,
      timeoutMs: DRILL_POLISH_TIMEOUT_MS,
      tenantId: userId, // A9 一人一租户
      userId,
    });

    if (!result.ok || result.data === null) {
      this.logger.warn(
        `[drill_polish_failed] drillId=${script.drillId} errorCode=${result.errorCode ?? 'unknown'} ` + `→ 回落到关键词确定性文案`,
      );
      return null;
    }

    return result.data;
  }
}

/**
 * 判定编排的返回结构 (领域形态; DTO 逐字段映射它).
 */
export interface DrillEvaluationResult {
  /** 剧本 slug. */
  drillId: string;
  /** 赛道. */
  track: DrillScript['track'];
  /** 技术形态标签 (crisis 恒为 null). */
  verdict: ReturnType<typeof judgeDrill>['verdict'];
  /** 已覆盖的技术点 key 清单. */
  coveredPointKeys: string[];
  /** 未覆盖的技术点 key 清单. */
  missedPointKeys: string[];
  /** 零压技术批注. */
  items: DrillItem[];
  /** 参考回应. */
  referenceResponse: string;
  /** 常见偏差. */
  commonPitfalls: string[];
  /** 产出来源. */
  source: PracticeFeedbackSource;
}
