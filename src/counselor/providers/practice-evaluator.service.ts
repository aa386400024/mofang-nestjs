// V2026-10-22 治本 (V1.3 §1.3 / §3.3 / §3.5 — 练习评判引擎: LLM 主路径 + 确定性降级 + 零压红线守门):
//   原因: spec §3.3 拍板「评判实现 (P1 上线后) 复用现有结构化 LLM client;
//     降级 (P0 未接 LLM 前) 服务端先按 rubric.dimensions[].positiveKeywords/
//     antiKeywords 做确定性关键词匹配产出批注 (跟 MCQ submitAttempt 同思路, 零随机),
//     LLM 就绪后无缝替换, **接口形状不变**」. 这意味着评判器必须同时持有两条路径,
//     且两者产出的**结构完全一致** —— 否则 LLM 时有时无会让客户端渲染逻辑分叉.
//   修法:
//     - evaluate(): 先走 LLM, 失败或越界则无缝降级到关键词路径, 返回结构恒定
//     - 零压红线**双保险**: (a) system prompt 里逐条写死禁令;
//       (b) 服务端守门: LLM 产出里出现评分/评级/评价人措辞 → 整份判废 → 降级
//     - 批注条数 3-5 条: 越界的条数同样判废 (太多是模型在凑, 太少是没看清)
//     - 确定性路径零随机: 同一份回应任意次评判结果恒等 (可复盘)
//   反双胞胎:
//     - 不把零压红线只写在 prompt 里: 模型是唯一能产出"你这次不太行"的地方,
//       必须有服务端兜底; 只靠 prompt 是"寄希望于模型听话"
//     - 不在降级路径里返回分数: 关键词匹配出来的"命中/未命中"是**动作判定**,
//       不是评级, 措辞上必须写成技术描述
//     - 不用温度参数做确定性: M3.1-Flash 官方忽略 temperature/top_p
//     - 不静默吞掉 LLM 失败: 记 warn 日志 + 降级, 让问题可追溯
//   验证:
//     1. tsc 0 错
//     2. 关掉 LLM (env 指向不存在的模型) → 接口仍 200, 批注来自 keyword 路径
//     3. 同一份回应连评 2 次 → 批注逐字相同 (降级路径零随机)
//     4. 模型若产出含"得分/等级/你不行"的文案 → 整份被拦下, 走降级
//     5. 语音引擎 ASR 文本为空 → 只出 ℹ️ 技术提示, 不出现"未达成"式判定
//
//   时间戳: 2026-10-22
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { CounselorLlmJsonClient } from './llm-json.client';
import { COUNSELOR_LLM_PROFILES } from '../config/counselor-llm.config';
import {
  buildPracticeCustomScenarioUserPrompt,
  PRACTICE_CUSTOM_SCENARIO_SCHEMA_DESCRIPTION,
  PRACTICE_CUSTOM_SCENARIO_SYSTEM_PROMPT,
} from '../config/practice-custom-scenario-prompts';
import { engineOfMode, labelOfMode } from '../config/practice-display-meta';
import {
  buildPracticeEvaluationUserPrompt,
  buildPracticeScenarioGenerationPrompt,
  buildPracticeVisitorReactionPrompt,
  PRACTICE_EVALUATION_SCHEMA_DESCRIPTION,
  PRACTICE_EVALUATION_SYSTEM_PROMPT,
  PRACTICE_SCENARIO_GENERATION_SCHEMA_DESCRIPTION,
  PRACTICE_SCENARIO_GENERATION_SYSTEM_PROMPT,
  PRACTICE_VISITOR_REACTION_SCHEMA_DESCRIPTION,
  PRACTICE_VISITOR_REACTION_SYSTEM_PROMPT,
} from '../config/practice-evaluation-prompts';
import {
  isPracticeLlmEvaluationEnabled,
  isPracticeLlmGenerationEnabled,
  PRACTICE_LLM_EVALUATION_ENV_KEY,
  PRACTICE_LLM_GENERATION_ENV_KEY,
  SPEECH_RATE_TARGET_HIGH,
  SPEECH_RATE_TARGET_LOW,
} from '../config/practice-evaluation.config';
import {
  validateCustomScenarioPayload,
  validateGeneratedScenarioPayload,
  validatePracticeFeedbackPayload,
  type PracticeCustomScenarioContent,
  type PracticeFeedback,
  type PracticeFeedbackItem,
  type PracticeScenarioRubric,
  type PracticeScenarioView,
  type PracticeTurn,
} from '../domain/practice/practice.types';
import { PRACTICE_DEFENSE_STYLE_LABELS } from '../enums/practice-defense-style.enum';
import { PRACTICE_DIFFICULTY_LABELS } from '../enums/practice-difficulty.enum';
import { PRACTICE_EMOTION_INTENSITY_LABELS } from '../enums/practice-emotion-intensity.enum';
import { PracticeEngine } from '../enums/practice-engine.enum';
import { PracticeFeedbackSource } from '../enums/practice-feedback-source.enum';
import { PracticeFeedbackTone } from '../enums/practice-feedback-tone.enum';
import { PracticeRubricCheck } from '../enums/practice-rubric-check.enum';
import { TrainingExerciseMode } from '../enums/training-exercise-mode.enum';

/**
 * 评判入参.
 */
export interface PracticeEvaluationInput {
  /** 场景视图 (V1.3 §7.5: 共享库 / 私有库两种物理来源统一投影而来) */
  scenario: PracticeScenarioView;
  /** 三引擎 */
  engine: PracticeEngine;
  /** 第几次作答 (1-based) */
  attemptOrdinal: number;
  /** 用户本次提交的文本 (语音引擎为 ASR 转写文本, 可为空串) */
  submittedText: string;
  /** 折算出的语速 (字/分), 非语音引擎为 null */
  speechRateWpm: number | null;
  /** 录音时长 (秒), 非语音引擎为 null */
  recordSeconds: number | null;
  /** P2 多轮: 该场景此前的转写 */
  transcript: PracticeTurn[];
  /** 当前用户 id (计费 + 审计) */
  userId: string;
  /** 租户 id (强隔离) */
  tenantId: string;
}

/**
 * 零压红线**禁用词表**.
 *
 * 命中任意一个 → 整份 LLM 产出判废 → 降级到确定性路径.
 * 词表设计原则: 只收"**语义上必然是评级或评价人**"的词, 不收可能出现在正常
 * 技术描述里的词 (如 "正确" —— "正确地命名情绪" 是正常表述, 收进来会误杀).
 */
const ZERO_PRESSURE_FORBIDDEN_TOKENS: readonly string[] = [
  '分数',
  '得分',
  '评分',
  '打分',
  '正确率',
  '错误率',
  '及格',
  '通过率',
  '评级',
  '等级',
  '不合格',
  '优秀',
  '太差',
  '很差',
  '你不行',
  '水平不够',
  '加油',
  '有进步',
  '太好了',
];

/** 批注条数下限 (§1.3 固定 3-5 条). */
const FEEDBACK_MIN_ITEMS = 3;
/** 批注条数上限 (§1.3 固定 3-5 条). */
const FEEDBACK_MAX_ITEMS = 5;

/** 降级路径的通用 ℹ️ 提示 (按序取, 用来把批注补到 3 条下限). */
const GENERIC_TECH_NOTES: readonly string[] = [
  '对照参考回应再过一遍, 留意自己在哪一句上停住了。',
  '这一轮只盯一个动作就够了, 其余的可以留到下一轮再看。',
  '把这句话放慢半拍再读, 更容易听出自己是在提问还是在陈述。',
];

/**
 * 微技能练习评判引擎.
 */
@Injectable()
export class PracticeEvaluatorService {
  private readonly logger = new Logger(PracticeEvaluatorService.name);

  constructor(
    private readonly llmJson: CounselorLlmJsonClient,
    private readonly config: ConfigService,
  ) {}

  // ══════════════════════════════════════════════════════════════════════
  // §3.3 评判主入口
  // ══════════════════════════════════════════════════════════════════════

  /**
   * 评判一次作答, 产出零压技术批注.
   *
   * 主路径 = LLM 结构化输出; LLM 不可用 / 产出越界 / 条数不合规 → 确定性关键词降级.
   * **两条路径返回的结构完全一致**, 客户端无需感知切换.
   *
   * @param input 评判入参
   * @returns 反馈
   */
  async evaluate(input: PracticeEvaluationInput): Promise<PracticeFeedback> {
    const fromLlm = await this.evaluateWithLlm(input);
    if (fromLlm) {
      return fromLlm;
    }
    return this.evaluateWithKeywords(input);
  }

  /**
   * LLM 评判路径.
   *
   * @returns 合法反馈; 任何一环不合规返回 null (交由调用方降级)
   */
  private async evaluateWithLlm(input: PracticeEvaluationInput): Promise<PracticeFeedback | null> {
    // 线上开关: 置 off 时直接走确定性路径, 不发起任何 LLM 调用 (见 practice-evaluation.config.ts).
    if (!isPracticeLlmEvaluationEnabled(this.config.get<string>(PRACTICE_LLM_EVALUATION_ENV_KEY))) {
      return null;
    }

    const profile = COUNSELOR_LLM_PROFILES.practiceEvaluation;
    const result = await this.llmJson.requestJson({
      systemPrompt: PRACTICE_EVALUATION_SYSTEM_PROMPT,
      userPrompt: buildPracticeEvaluationUserPrompt({
        engine: input.engine,
        modeLabel: labelOfMode(input.scenario.exerciseMode),
        difficultyLabel: PRACTICE_DIFFICULTY_LABELS[input.scenario.difficulty],
        personaSummary: this.describePersona(input.scenario),
        openingLine: input.scenario.openingLine,
        taskPrompt: input.scenario.taskPrompt,
        botchedUtterance: input.scenario.botchedUtterance,
        voiceScript: input.scenario.voiceScript,
        dimensions: input.scenario.rubric.dimensions,
        submittedText: input.submittedText,
        speechRateWpm: input.speechRateWpm,
        recordSeconds: input.recordSeconds,
        attemptOrdinal: input.attemptOrdinal,
        transcript: input.transcript,
      }),
      schemaDescription: PRACTICE_EVALUATION_SCHEMA_DESCRIPTION,
      validate: validatePracticeFeedbackPayload,
      maxCompletionTokens: profile.maxCompletionTokens,
      reasoningEffort: profile.reasoningEffort,
      timeoutMs: profile.timeoutMs,
      tenantId: input.tenantId,
      userId: input.userId,
    });

    if (!result.ok || result.data === null) {
      this.logger.warn(`[practice_eval_llm_failed] scenario=${input.scenario.scenarioKey} code=${result.errorCode ?? 'unknown'}`);
      return null;
    }

    const payload = result.data;

    // 条数闸门: 少于下限 = 模型没认真看; 多于上限 = 模型在凑数. 两种都判废.
    if (payload.items.length < FEEDBACK_MIN_ITEMS || payload.items.length > FEEDBACK_MAX_ITEMS) {
      this.logger.warn(`[practice_eval_llm_item_count] scenario=${input.scenario.scenarioKey} items=${payload.items.length}`);
      return null;
    }

    // 零压红线守门: 整份判废 (不做局部清洗 —— 局部清洗会留下"半截越界"的文案)
    if (this.violatesZeroPressure(payload.items)) {
      this.logger.warn(`[practice_eval_llm_zero_pressure] scenario=${input.scenario.scenarioKey} payload=rejected`);
      return null;
    }

    return {
      items: payload.items,
      referenceResponse: payload.referenceResponse,
      commonPitfalls: payload.commonPitfalls,
      attemptOrdinal: input.attemptOrdinal,
      source: PracticeFeedbackSource.LLM,
      visitorReaction: null,
    };
  }

  /**
   * 确定性关键词评判路径 (P0 降级 / LLM 不可用).
   *
   * 规则 (零随机, 可复盘):
   *   - CONTAINS_ANY 维度: 命中 positiveKeywords → ✅ 动作达成; 未命中 → ⚠️ 可以留意
   *   - CONTAINS_NONE 维度: 命中 antiKeywords → ⚠️ 可能越位; 未命中 → ✅ 没有越位
   *   - CUSTOM_LLM 维度: 关键词判不了 → ℹ️ 技术提示 (不下判定)
   *   - 语音引擎且 ASR 文本为空: 只出 ℹ️ 提示, 不做任何"未达成"判定
   *
   * @param input 评判入参
   * @returns 反馈
   */
  private evaluateWithKeywords(input: PracticeEvaluationInput): PracticeFeedback {
    const text = input.submittedText;
    const items: PracticeFeedbackItem[] = [];

    // 语音引擎且未识别到文本: 只给技术提示, 不做动作判定
    // (spec §3.3「voiceMetric 时传 ASR 文本 (空字符串 = 未识别)」)
    if (input.engine === PracticeEngine.VOICE_METRIC && text.trim().length === 0) {
      items.push({
        tone: PracticeFeedbackTone.INFO,
        dimensionKey: '',
        text: '这次没有识别到语音内容, 可以对着录音再听一遍, 留意语速和句尾。',
      });
      if (input.speechRateWpm !== null) {
        items.push(this.buildPaceItem(input.speechRateWpm));
      }
      return this.finalizeKeywordFeedback(items, input);
    }

    for (const dimension of input.scenario.rubric.dimensions) {
      items.push(...this.buildDimensionItems(dimension, text));
    }

    if (input.engine === PracticeEngine.VOICE_METRIC && input.speechRateWpm !== null) {
      items.push(this.buildPaceItem(input.speechRateWpm));
    }

    return this.finalizeKeywordFeedback(items, input);
  }

  /**
   * 单个维度的确定性判定.
   */
  private buildDimensionItems(dimension: PracticeScenarioRubric['dimensions'][number], text: string): PracticeFeedbackItem[] {
    switch (dimension.check) {
      case PracticeRubricCheck.CONTAINS_ANY: {
        const hit = dimension.positiveKeywords.find((keyword) => text.includes(keyword));
        if (hit) {
          return [
            {
              tone: PracticeFeedbackTone.POSITIVE,
              dimensionKey: dimension.key,
              text: `「${hit}」这个动作出现了 —— ${dimension.label}.`,
            },
          ];
        }
        return [
          {
            tone: PracticeFeedbackTone.WARNING,
            dimensionKey: dimension.key,
            text: `${dimension.label} 这一步还没有出现, 可以在下一轮里专门盯住它.`,
          },
        ];
      }
      case PracticeRubricCheck.CONTAINS_NONE: {
        const hit = dimension.antiKeywords.find((keyword) => text.includes(keyword));
        if (hit) {
          return [
            {
              tone: PracticeFeedbackTone.WARNING,
              dimensionKey: dimension.key,
              text: `出现了「${hit}」这类措辞, 留意${dimension.label}上的越位风险.`,
            },
          ];
        }
        return [
          {
            tone: PracticeFeedbackTone.POSITIVE,
            dimensionKey: dimension.key,
            text: `${dimension.label} 这次没有越位, 保持住了.`,
          },
        ];
      }
      case PracticeRubricCheck.CUSTOM_LLM: {
        return [
          {
            tone: PracticeFeedbackTone.INFO,
            dimensionKey: dimension.key,
            text: `${dimension.label} 这一点靠文本判不了, 建议对照参考回应再听一遍自己的表达.`,
          },
        ];
      }
      default: {
        // 穷尽分支不可达 (enum 3 档已全覆盖); 兜底给一条 ℹ️ 而不是抛错,
        // 保证评判链路永不因内容脏数据中断.
        return [
          {
            tone: PracticeFeedbackTone.INFO,
            dimensionKey: dimension.key,
            text: `${dimension.label} 建议对照参考回应再看一遍.`,
          },
        ];
      }
    }
  }

  /**
   * 语速指标批注 (语音引擎专用).
   */
  private buildPaceItem(speechRateWpm: number): PracticeFeedbackItem {
    const rounded = Math.round(speechRateWpm);
    const inRange = rounded >= SPEECH_RATE_TARGET_LOW && rounded <= SPEECH_RATE_TARGET_HIGH;
    return {
      tone: PracticeFeedbackTone.INFO,
      dimensionKey: 'speechRate',
      text: inRange
        ? `这次语速约 ${rounded} 字/分, 落在 ${SPEECH_RATE_TARGET_LOW}-${SPEECH_RATE_TARGET_HIGH} 的专业区间里.`
        : `这次语速约 ${rounded} 字/分, 专业区间是 ${SPEECH_RATE_TARGET_LOW}-${SPEECH_RATE_TARGET_HIGH}, 可以对着录音再压一压/放一放.`,
    };
  }

  /**
   * 关键词路径的收尾: 按批注侧重点轮换排序 → 补足条数 → 截断到上限.
   */
  private finalizeKeywordFeedback(items: PracticeFeedbackItem[], input: PracticeEvaluationInput): PracticeFeedback {
    const ordered = this.orderByFocus(items, input.attemptOrdinal);
    const padded = this.padToMinimum(ordered);

    return {
      items: padded.slice(0, FEEDBACK_MAX_ITEMS),
      referenceResponse: input.scenario.referenceResponse,
      commonPitfalls: input.scenario.commonPitfalls,
      attemptOrdinal: input.attemptOrdinal,
      source: PracticeFeedbackSource.KEYWORD,
      visitorReaction: null,
    };
  }

  /**
   * 按批注侧重点轮换排序 (§3.3: 第1次看动作 / 第2次看语气长度 / 第3次给稳定确认).
   */
  private orderByFocus(items: PracticeFeedbackItem[], attemptOrdinal: number): PracticeFeedbackItem[] {
    const focusIndex = (((attemptOrdinal - 1) % 3) + 3) % 3;
    if (focusIndex === 0) {
      return items;
    }
    if (focusIndex === 1) {
      // 语气轮: ⚠️ 与 ℹ️ 优先 (越位风险与技术提示优先于"做对了什么")
      return [
        ...items.filter((item) => item.tone !== PracticeFeedbackTone.POSITIVE),
        ...items.filter((item) => item.tone === PracticeFeedbackTone.POSITIVE),
      ];
    }
    // 稳定确认轮: ✅ 优先 (先确认保持住了什么)
    return [
      ...items.filter((item) => item.tone === PracticeFeedbackTone.POSITIVE),
      ...items.filter((item) => item.tone !== PracticeFeedbackTone.POSITIVE),
    ];
  }

  /**
   * 补足到条数下限 (用通用技术提示).
   */
  private padToMinimum(items: PracticeFeedbackItem[]): PracticeFeedbackItem[] {
    if (items.length >= FEEDBACK_MIN_ITEMS) {
      return items;
    }
    const padded = [...items];
    let index = 0;
    while (padded.length < FEEDBACK_MIN_ITEMS && index < GENERIC_TECH_NOTES.length) {
      const note = GENERIC_TECH_NOTES[index];
      if (note) {
        padded.push({ tone: PracticeFeedbackTone.INFO, dimensionKey: '', text: note });
      }
      index++;
    }
    return padded;
  }

  // ══════════════════════════════════════════════════════════════════════
  // P2 多轮: AI 来访者反应
  // ══════════════════════════════════════════════════════════════════════

  /**
   * 生成 AI 来访者对用户这一轮的情绪反应 (P2 多轮).
   *
   * @returns 反应文本; 生成失败返回 null (调用方按"无反应"处理, 不阻断主链路)
   */
  async generateVisitorReaction(input: {
    scenario: PracticeScenarioView;
    counselorText: string;
    transcript: PracticeTurn[];
    userId: string;
    tenantId: string;
  }): Promise<string | null> {
    // V1.3 §8.5 C1: 生成类调用读**生成开关** (PRACTICE_LLM_GENERATION),
    // 不再沿用评判开关 —— 两个开关语义正交, 关掉生成不影响评判.
    if (!isPracticeLlmGenerationEnabled(this.config.get<string>(PRACTICE_LLM_GENERATION_ENV_KEY))) {
      this.logger.warn(`[practice_visitor_reaction_skipped] reason=generation_switch_off scenario=${input.scenario.scenarioKey}`);
      return null;
    }

    const profile = COUNSELOR_LLM_PROFILES.practiceVisitorReaction;
    const result = await this.llmJson.requestJson({
      systemPrompt: PRACTICE_VISITOR_REACTION_SYSTEM_PROMPT,
      userPrompt: buildPracticeVisitorReactionPrompt({
        personaSummary: this.describePersona(input.scenario),
        openingLine: input.scenario.openingLine,
        taskPrompt: input.scenario.taskPrompt,
        counselorText: input.counselorText,
        transcript: input.transcript,
      }),
      schemaDescription: PRACTICE_VISITOR_REACTION_SCHEMA_DESCRIPTION,
      validate: (raw): { reaction: string } | null => {
        if (typeof raw !== 'object' || raw === null) return null;
        const reaction = (raw as Record<string, unknown>)['reaction'];
        if (typeof reaction !== 'string' || reaction.trim().length === 0) return null;
        return { reaction: reaction.trim() };
      },
      maxCompletionTokens: profile.maxCompletionTokens,
      reasoningEffort: profile.reasoningEffort,
      timeoutMs: profile.timeoutMs,
      tenantId: input.tenantId,
      userId: input.userId,
    });

    if (!result.ok || result.data === null) {
      this.logger.warn(`[practice_visitor_reaction_failed] scenario=${input.scenario.scenarioKey} code=${result.errorCode ?? 'unknown'}`);
      return null;
    }
    return result.data.reaction;
  }

  // ══════════════════════════════════════════════════════════════════════
  // §3.5 自定义场景生成 (P3)
  // ══════════════════════════════════════════════════════════════════════

  /**
   * 把用户描述的真实情况生成成一条可练习的场景.
   *
   * @returns 场景内容; 生成失败返回 null (调用方据此报错)
   */
  async generateScenario(input: {
    mode: TrainingExerciseMode;
    situation: string;
    userId: string;
    tenantId: string;
  }): Promise<ReturnType<typeof validateGeneratedScenarioPayload>> {
    // V1.3 §8.5 C1: 场景生成读生成开关.
    if (!isPracticeLlmGenerationEnabled(this.config.get<string>(PRACTICE_LLM_GENERATION_ENV_KEY))) {
      this.logger.warn(`[practice_scenario_generation_skipped] reason=generation_switch_off mode=${input.mode}`);
      return null;
    }

    const profile = COUNSELOR_LLM_PROFILES.practiceScenarioGeneration;
    const result = await this.llmJson.requestJson({
      systemPrompt: PRACTICE_SCENARIO_GENERATION_SYSTEM_PROMPT,
      userPrompt: buildPracticeScenarioGenerationPrompt({
        modeLabel: labelOfMode(input.mode),
        engine: engineOfMode(input.mode),
        situation: input.situation,
      }),
      schemaDescription: PRACTICE_SCENARIO_GENERATION_SCHEMA_DESCRIPTION,
      validate: validateGeneratedScenarioPayload,
      maxCompletionTokens: profile.maxCompletionTokens,
      reasoningEffort: profile.reasoningEffort,
      timeoutMs: profile.timeoutMs,
      tenantId: input.tenantId,
      userId: input.userId,
    });

    if (!result.ok || result.data === null) {
      this.logger.warn(`[practice_scenario_generation_failed] mode=${input.mode} code=${result.errorCode ?? 'unknown'}`);
      return null;
    }
    return result.data;
  }

  // ══════════════════════════════════════════════════════════════════════
  // §7.2 用户真实场景生成 (三问表单版)
  // ══════════════════════════════════════════════════════════════════════

  /**
   * 把用户的三问 (来访者说了什么 / 咨询师怎么回的 / 卡在哪) 生成成一条可练场景.
   *
   * 与 §3.5 `generateScenario` 的区别:
   *   - 输入更结构化 (三问 vs 一段自由描述)
   *   - prompt 多了 §7.3 的 5 条硬约束 (脱敏 / 零压 / 贴近真实 / stuckPoint 对齐 rubric / 可练习性)
   *   - 输出多了 2 个路由元信息 (exerciseMode / difficulty)
   *   - 走独立的 LLM profile (low 档 + 30s, 能在 §7.4 的 8s 有效窗口内跑完)
   *
   * @param input 生成输入
   * @returns 归一化后的场景内容; 生成失败 / 产出不合规返回 null (调用方走降级)
   */
  async generateCustomScenario(input: {
    visitorQuote: string;
    counselorReply: string;
    stuckPoint: string;
    hintMode: TrainingExerciseMode | null;
    hintModeLabel: string | null;
    engine: PracticeEngine | null;
    userId: string;
    tenantId: string;
    /**
     * 硬时限 (ms). V1.3 §7.4 「超时 8s → 降级为本地模板场景」——
     * 调用方给一个比 profile 更紧的窗口, 让**服务端**先于客户端拿到失败结论.
     * 传 undefined 时用 profile 里的 30s.
     */
    timeoutMs?: number;
  }): Promise<PracticeCustomScenarioContent | null> {
    // V1.3 §8.5 C1: 场景生成读生成开关.
    if (!isPracticeLlmGenerationEnabled(this.config.get<string>(PRACTICE_LLM_GENERATION_ENV_KEY))) {
      this.logger.warn(`[practice_custom_scenario_generation_skipped] reason=generation_switch_off`);
      return null;
    }

    const profile = COUNSELOR_LLM_PROFILES.practiceCustomScenarioGeneration;
    const result = await this.llmJson.requestJson({
      systemPrompt: PRACTICE_CUSTOM_SCENARIO_SYSTEM_PROMPT,
      userPrompt: buildPracticeCustomScenarioUserPrompt({
        visitorQuote: input.visitorQuote,
        counselorReply: input.counselorReply,
        stuckPoint: input.stuckPoint,
        hintMode: input.hintMode,
        hintModeLabel: input.hintModeLabel,
        engine: input.engine,
      }),
      schemaDescription: PRACTICE_CUSTOM_SCENARIO_SCHEMA_DESCRIPTION,
      validate: validateCustomScenarioPayload,
      maxCompletionTokens: profile.maxCompletionTokens,
      reasoningEffort: profile.reasoningEffort,
      timeoutMs: input.timeoutMs ?? profile.timeoutMs,
      tenantId: input.tenantId,
      userId: input.userId,
    });

    if (!result.ok || result.data === null) {
      this.logger.warn(`[practice_custom_scenario_generation_failed] code=${result.errorCode ?? 'unknown'}`);
      return null;
    }
    return result.data;
  }

  // ══════════════════════════════════════════════════════════════════════
  // 内部工具
  // ══════════════════════════════════════════════════════════════════════

  /**
   * 零压红线守门: 产出里出现评分/评级/评价人措辞即判废.
   *
   * V2026-10-22 治本 (V1.3 §8.5 D1 — 守门范围收窄到 items[].text):
   *   原因: 原实现把 `referenceResponse` 与 `commonPitfalls` 也一起扫禁用词,
   *     但这两段是**种子/参考内容**而不是"对用户的反馈":
   *       - referenceResponse 来自 practice_scenarios.reference_response (人工审过的示范回应)
   *       - commonPitfalls   来自 practice_scenarios.common_pitfalls   (人工审过的偏差清单)
   *     一份写得好的参考句里出现"等级""优秀"这类词 (比如"给个优秀的评价")
   *     就会让**整份** LLM 产出被判废并静默降级 —— 而那条参考句本身没问题,
   *     问题在扫描范围. 这就是 §8.5 D1 说的「静默降级」事故.
   *   修法: 只扫 `items[].text` —— 那是**唯一**由模型现写、面向用户、
   *     且真正可能夹带评级/评价人的部分. 参考回应与常见偏差要么是人工内容,
   *     要么是模型的补充材料, 不在这条守门线的射程内.
   *   反双胞胎:
   *     - 不做"局部清洗": 局部清洗会留下"半截越界"的文案 (前半句被删, 后半句还在)
   *     - 不把参考内容也纳入扫描: 见上 (宁可放过一条可疑的参考句, 也不误杀整份产出)
   */
  private violatesZeroPressure(items: PracticeFeedbackItem[]): boolean {
    const haystack = items.map((item) => item.text).join('\n');
    return ZERO_PRESSURE_FORBIDDEN_TOKENS.some((token) => haystack.includes(token));
  }

  /**
   * 把来访者画像拼成一句人设摘要 (给 prompt 用).
   */
  private describePersona(scenario: PracticeScenarioView): string {
    const persona = scenario.persona;
    return [
      `${persona.name}（${persona.age} 岁 ${persona.gender}，${persona.occupation}）`,
      `防御风格: ${PRACTICE_DEFENSE_STYLE_LABELS[persona.defenseStyle]}`,
      `情绪负荷: ${PRACTICE_EMOTION_INTENSITY_LABELS[persona.emotionIntensity]}`,
      persona.background,
    ].join('；');
  }
}
