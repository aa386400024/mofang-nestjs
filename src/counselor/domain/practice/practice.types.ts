// V2026-10-22 治本 (V1.3 §2.1 / §2.2 — 微技能练习的领域类型定义):
//   原因: V1.3 有 4 段结构化 JSON 内容 (persona / rubric / feedback / 场景内容),
//     它们同时被 3 处消费:
//       1) TypeORM entity 的 json 列 (落库)
//       2) DTO (出参, 进 swagger)
//       3) LLM 评判的输入 + 输出契约 (校验函数)
//     如果三处各写一份 interface, 内容库一改就会出现"entity 认了 / DTO 不认"或
//     "DTO 认了 / 校验函数不认"的静默漂移 —— 而且这类漂移只有在线上数据里才暴露.
//     故本文件是这 4 段 JSON 的**唯一类型定义处**, entity / DTO / 校验函数全部
//     从这里 import.
//   反双胞胎:
//     - 不用 class-validator 装饰 json 列: json 列的**内部结构**校验走手写
//       validate 函数 (跟 v1.2 session-core.types.ts 的 validate* 同 pattern),
//       不用 DTO 装饰器 (DTO 装饰器只能校验顶层字段)
//     - 不用 zod / 类校验库: 大炮红线禁自动装依赖; 手写校验函数跟既有 pattern 一致
//     - 不用 optional chaining 深取值当校验: `a?.b?.c` 遇 null 返回 undefined,
//       与"字段缺失"无法区分, 校验必须显式判存在
//
//   验证:
//     1. tsc 0 错
//     2. validate* 函数对"合法 / 缺字段 / 类型错 / 越界"四类输入分别给出正确结论
//     3. entity / DTO / 校验函数三处类型引用同一份 interface (改一处, 编译期全链路报错)
//
//   时间戳: 2026-10-22

import { PracticeDefenseStyle } from '../../enums/practice-defense-style.enum';
import { PracticeDifficulty } from '../../enums/practice-difficulty.enum';
import { PracticeEmotionIntensity } from '../../enums/practice-emotion-intensity.enum';
import { PracticeFeedbackSource } from '../../enums/practice-feedback-source.enum';
import { PracticeFeedbackTone } from '../../enums/practice-feedback-tone.enum';
import { PracticeRubricCheck } from '../../enums/practice-rubric-check.enum';
import { PracticeScenarioSource } from '../../enums/practice-scenario-source.enum';
import { TrainingExerciseMode } from '../../enums/training-exercise-mode.enum';

/**
 * 来访者画像 (practice_scenarios.persona json 列).
 *
 * spec §2.1 拍板: 表层人设 (跟 v1.2 M1 浅表层同口径) —— 只描述"来访者是谁",
 * 不含成长时间线等重人设 (自由练习场景是轻量全局题库, 不需要成长叙事).
 */
export interface PracticeScenarioPersona {
  /** 来访者称呼 (气泡上的名字) */
  name: string;
  /** 年龄 */
  age: number;
  /** 性别 */
  gender: string;
  /** 职业 */
  occupation: string;
  /** 防御风格 (6 档 enum) */
  defenseStyle: PracticeDefenseStyle;
  /** 情绪负荷 (3 档 enum) */
  emotionIntensity: PracticeEmotionIntensity;
  /** 一两句背景 */
  background: string;
}

/**
 * 单条 rubric 评判维度 (practice_scenarios.rubric.dimensions[]).
 */
export interface PracticeRubricDimension {
  /** 维度稳定 key (如 namesEmotion) */
  key: string;
  /** 维度中文名 (如"说出了对方的情绪") */
  label: string;
  /** 命中即视为该动作达成的关键词 */
  positiveKeywords: string[];
  /** 命中即提示越位的关键词 */
  antiKeywords: string[];
  /** 判定方式 (3 档 enum) */
  check: PracticeRubricCheck;
}

/**
 * 评判 rubric (practice_scenarios.rubric json 列).
 */
export interface PracticeScenarioRubric {
  dimensions: PracticeRubricDimension[];
}

/**
 * 练习场景**视图** —— 评判与开练链路的唯一输入形态.
 *
 * V2026-10-22 治本 (V1.3 §7.5 — 场景分表后必须有的抽象):
 *   原因: §7.5 把用户私有场景拆到 `practice_custom_scenarios` 独立表, 于是
 *     「一个可练习的场景」有了**两个物理来源**:
 *       - practice_scenarios         (共享内容库, user_id IS NULL 或 = 本人)
 *       - practice_custom_scenarios  (用户私有, user_id = 本人)
 *     而 §3.2 取场景 / §3.3 评判 / §7.5 的"按 scenarioSource 路由取 content"
 *     三条链路**都只关心场景的内容**, 不关心它存在哪张表.
 *     若让这些链路直接依赖 `PracticeScenario` (TypeORM entity), 就等于把
 *     "实体" 当成了"领域概念" —— 私有场景要么被迫塞回主表 (违反 §7.5 的审核边界),
 *     要么每次都手工把 entity 摊平成一坨匿名对象 (重复代码 ×3, 必然漂移).
 *   修法: 抽出 `PracticeScenarioView` 这个**领域视图**, 由两个 entity 各自投影而来.
 *     上层 (scenario service / evaluator / attempt service) 只认 view, 不认表.
 *     新增第三种场景来源时, 只需再写一个投影函数, 上层零改动.
 *
 *   反双胞胎:
 *     - 不让 service 层直接吃 TypeORM entity: entity 携带 createdAt/enabled/
 *       userId 等持久化细节, 评判链路不需要, 依赖它等于把持久化模型泄漏进领域层
 *     - 不在 view 里放 rubric 之外的判定锚点: view 是"可练习场景"的最小充分集
 *     - 不用 union 类型 (PracticeScenario | PracticeCustomScenario):
 *       调用方会到处写类型分支, 换个表就全链路报错; view 把差异**收敛在投影处**
 */
export interface PracticeScenarioView {
  /** 场景 id (UUID; 来自所属表的 PK) */
  scenarioId: string;
  /** 稳定 slug (共享库为 seed slug; 私有库为随机派生键) */
  scenarioKey: string;
  /** 场景来源表 (决定 §7.5 的评判路由) */
  source: PracticeScenarioSource;
  /** 归属基本功 (10 档) */
  exerciseMode: TrainingExerciseMode;
  /** 难度梯 1/2/3 */
  difficulty: PracticeDifficulty;
  /** 来访者画像 */
  persona: PracticeScenarioPersona;
  /** 来访者开场白 */
  openingLine: string;
  /** 训练任务说明 */
  taskPrompt: string;
  /** rewrite 引擎专用: 被砸了的原话 */
  botchedUtterance: string | null;
  /** voiceMetric 引擎专用: 要求朗读的文本 */
  voiceScript: string | null;
  /** 参考回应 */
  referenceResponse: string;
  /** 常见偏差 */
  commonPitfalls: string[];
  /** 评判 rubric */
  rubric: PracticeScenarioRubric;
  /** 期望往返轮数 (单轮场景恒为 1) */
  expectedTurns: number;
}

/**
 * 用户私有场景的**原始输入** (practice_custom_scenarios.source_payload json 列).
 *
 * spec §7.1 的三问表单原文, **原样保留不做脱敏改写**:
 * 这是用户自己的输入, 脱敏要求 (§7.3.1) 只针对"生成出来给用户看的场景内容".
 * 脱敏掉原文等于丢失"用户当时到底遇到了什么"这个唯一有复盘价值的信息.
 */
export interface PracticeCustomScenarioSourcePayload {
  /** 来访者当时说了什么 / 什么反应 (必填) */
  visitorQuote: string;
  /** 咨询师当时怎么回应的 (可空) */
  counselorReply: string;
  /** 用户觉得卡在哪 (可空) */
  stuckPoint: string;
  /** 用户指定的基本功线索 (training_exercises id; 可空 = 由 LLM 自行判断) */
  hintExerciseId: string | null;
}

/**
 * 用户私有场景的**生成内容** (practice_custom_scenarios.generated_scenario json 列).
 *
 * 与 `validateGeneratedScenarioPayload` 的返回结构 1:1 (同一份类型, 不写第二份).
 */
export interface PracticeCustomScenarioContent {
  /** 归属基本功 (LLM 判断, 服务端会跟 hint / 引擎口径交叉校验) */
  exerciseMode: TrainingExerciseMode;
  /** 难度梯 (LLM 自评, 服务端夹到 [1,3]) */
  difficulty: PracticeDifficulty;
  /** 来访者画像 (脱敏后: 称呼用代称) */
  persona: PracticeScenarioPersona;
  /** 来访者第一句话 */
  openingLine: string;
  /** 训练任务说明 */
  taskPrompt: string;
  /** rewrite 引擎专用 */
  botchedUtterance: string | null;
  /** voiceMetric 引擎专用 */
  voiceScript: string | null;
  /** 参考回应 */
  referenceResponse: string;
  /** 常见偏差 */
  commonPitfalls: string[];
  /** 评判 rubric */
  rubric: PracticeScenarioRubric;
}

/**
 * 单条反馈批注 (practice_attempts.feedback.items[]).
 */
export interface PracticeFeedbackItem {
  /** 语气三态 (positive / warning / info) */
  tone: PracticeFeedbackTone;
  /** 锚定的 rubric 维度 key (custom_llm / 语音指标等无对应维度的批注可为空串) */
  dimensionKey: string;
  /** 批注文案 (只做技术描述, 禁止评价人) */
  text: string;
}

/**
 * 一次练习的完整反馈 (practice_attempts.feedback json 列).
 *
 * spec §2.2 拍板结构 + P2 多轮扩展 (visitorReaction) + 产出来源标记 (source).
 */
export interface PracticeFeedback {
  /** 批注清单 (3-5 条, 三态语气) */
  items: PracticeFeedbackItem[];
  /** 参考回应 (可参考这样回应) */
  referenceResponse: string;
  /** 常见偏差 (留意避免) */
  commonPitfalls: string[];
  /** 该用户在本场景的第几次作答 (批注侧重点按此轮换) */
  attemptOrdinal: number;
  /** 产出来源 (keyword / llm) */
  source: PracticeFeedbackSource;
  /**
   * P2 多轮: AI 来访者对用户这一轮回应的情绪反应.
   * 单轮场景恒为 null; 多轮场景由 LLM 生成, 客户端把这段话作为来访者下一轮气泡.
   */
  visitorReaction: string | null;
}

/**
 * 一次练习的完整转写 (P2 多轮评判用).
 */
export interface PracticeTurn {
  /** 轮次序号 (1-based) */
  turn: number;
  /** 咨询师这一轮说了什么 */
  counselorText: string;
  /** AI 来访者这一轮的反应 (空串 = 本轮尚无来访者反应, 即首轮) */
  visitorReaction: string;
}

// ════════════════════════════════════════════════════════════════════════════
// 校验函数 (手写, 跟 v1.2 session-core.types.ts 同 pattern)
// ════════════════════════════════════════════════════════════════════════════

/** 判定是否为"非空字符串" (内容库字段的最小合法形态). */
function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

/** 判定是否为"字符串数组" (允许空数组). */
function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

/**
 * 校验来访者画像.
 *
 * @returns 合法时返回规范化后的画像, 非法返回 null.
 */
export function validatePracticePersona(raw: unknown): PracticeScenarioPersona | null {
  if (typeof raw !== 'object' || raw === null) {
    return null;
  }
  const candidate = raw as Record<string, unknown>;
  const name = candidate['name'];
  const age = candidate['age'];
  const gender = candidate['gender'];
  const occupation = candidate['occupation'];
  const defenseStyle = candidate['defenseStyle'];
  const emotionIntensity = candidate['emotionIntensity'];
  const background = candidate['background'];

  if (!isNonEmptyString(name)) return null;
  if (typeof age !== 'number' || !Number.isInteger(age) || age <= 0 || age > 120) return null;
  if (!isNonEmptyString(gender)) return null;
  if (!isNonEmptyString(occupation)) return null;
  if (!isNonEmptyString(background)) return null;
  if (!Object.values(PracticeDefenseStyle).includes(defenseStyle as PracticeDefenseStyle)) return null;
  if (!Object.values(PracticeEmotionIntensity).includes(emotionIntensity as PracticeEmotionIntensity)) return null;

  return {
    name,
    age,
    gender,
    occupation,
    defenseStyle: defenseStyle as PracticeDefenseStyle,
    emotionIntensity: emotionIntensity as PracticeEmotionIntensity,
    background,
  };
}

/**
 * 校验单条 rubric 维度.
 */
export function validatePracticeRubricDimension(raw: unknown): PracticeRubricDimension | null {
  if (typeof raw !== 'object' || raw === null) {
    return null;
  }
  const candidate = raw as Record<string, unknown>;
  const key = candidate['key'];
  const label = candidate['label'];
  const positiveKeywords = candidate['positiveKeywords'];
  const antiKeywords = candidate['antiKeywords'];
  const check = candidate['check'];

  if (!isNonEmptyString(key)) return null;
  if (!isNonEmptyString(label)) return null;
  if (!isStringArray(positiveKeywords)) return null;
  if (!isStringArray(antiKeywords)) return null;
  if (!Object.values(PracticeRubricCheck).includes(check as PracticeRubricCheck)) return null;

  return {
    key,
    label,
    positiveKeywords,
    antiKeywords,
    check: check as PracticeRubricCheck,
  };
}

/**
 * 校验 rubric.
 */
export function validatePracticeRubric(raw: unknown): PracticeScenarioRubric | null {
  if (typeof raw !== 'object' || raw === null) {
    return null;
  }
  const candidate = raw as Record<string, unknown>;
  const dimensions = candidate['dimensions'];
  if (!Array.isArray(dimensions) || dimensions.length === 0) {
    return null;
  }
  const parsed = dimensions.map((item) => validatePracticeRubricDimension(item));
  if (parsed.includes(null)) {
    return null;
  }
  return { dimensions: parsed as PracticeRubricDimension[] };
}

/**
 * 校验单条反馈批注.
 */
export function validatePracticeFeedbackItem(raw: unknown): PracticeFeedbackItem | null {
  if (typeof raw !== 'object' || raw === null) {
    return null;
  }
  const candidate = raw as Record<string, unknown>;
  const tone = candidate['tone'];
  const dimensionKey = candidate['dimensionKey'];
  const text = candidate['text'];

  if (!Object.values(PracticeFeedbackTone).includes(tone as PracticeFeedbackTone)) return null;
  if (typeof dimensionKey !== 'string') return null;
  if (!isNonEmptyString(text)) return null;

  return { tone: tone as PracticeFeedbackTone, dimensionKey, text };
}

/**
 * 校验 LLM 输出的反馈结构 (不含 attemptOrdinal / source / visitorReaction —— 那三项由
 * 服务端自己算, 不接受模型给, 避免模型伪造"第几次作答"这类客观事实).
 */
export function validatePracticeFeedbackPayload(raw: unknown): {
  items: PracticeFeedbackItem[];
  referenceResponse: string;
  commonPitfalls: string[];
} | null {
  if (typeof raw !== 'object' || raw === null) {
    return null;
  }
  const candidate = raw as Record<string, unknown>;
  const items = candidate['items'];
  const referenceResponse = candidate['referenceResponse'];
  const commonPitfalls = candidate['commonPitfalls'];

  if (!Array.isArray(items) || items.length === 0) {
    return null;
  }
  const parsedItems = items.map((item) => validatePracticeFeedbackItem(item));
  if (parsedItems.includes(null)) {
    return null;
  }
  if (!isNonEmptyString(referenceResponse)) return null;
  if (!isStringArray(commonPitfalls)) return null;

  return {
    items: parsedItems as PracticeFeedbackItem[],
    referenceResponse,
    commonPitfalls,
  };
}

/**
 * 校验 LLM 生成的场景内容 (P3 自定义场景用).
 *
 * V2026-10-22 治本 (V1.3 §7):
 *   本函数只校验"**场景内容**"这一段 (人设 / 开场白 / 任务 / rubric / 参考回应 / 偏差),
 *   **不**校验归属基本功与难度 —— 那两项在 §7.2 的语义里是"路由信息 + 主观自评",
 *   由 §7.2 的 `validateCustomScenarioPayload` 单独校验 (它在上层组合二者).
 *   拆成两层的原因: §3.5 的生成入口 (用户已指定基本功) 不需要模型再判一次 mode,
 *   让模型重复输出一个用户已经给定的值只会引入不一致的机会.
 */
export function validateGeneratedScenarioPayload(raw: unknown): {
  persona: PracticeScenarioPersona;
  openingLine: string;
  taskPrompt: string;
  botchedUtterance: string | null;
  voiceScript: string | null;
  referenceResponse: string;
  commonPitfalls: string[];
  rubric: PracticeScenarioRubric;
} | null {
  if (typeof raw !== 'object' || raw === null) {
    return null;
  }
  const candidate = raw as Record<string, unknown>;

  const persona = validatePracticePersona(candidate['persona']);
  if (!persona) return null;

  const openingLine = candidate['openingLine'];
  const taskPrompt = candidate['taskPrompt'];
  const referenceResponse = candidate['referenceResponse'];
  const commonPitfalls = candidate['commonPitfalls'];
  const rubric = validatePracticeRubric(candidate['rubric']);

  if (!isNonEmptyString(openingLine)) return null;
  if (!isNonEmptyString(taskPrompt)) return null;
  if (!isNonEmptyString(referenceResponse)) return null;
  if (!isStringArray(commonPitfalls)) return null;
  if (!rubric) return null;

  const botchedUtterance = candidate['botchedUtterance'];
  const voiceScript = candidate['voiceScript'];

  return {
    persona,
    openingLine,
    taskPrompt,
    botchedUtterance: typeof botchedUtterance === 'string' && botchedUtterance.trim().length > 0 ? botchedUtterance : null,
    voiceScript: typeof voiceScript === 'string' && voiceScript.trim().length > 0 ? voiceScript : null,
    referenceResponse,
    commonPitfalls,
    rubric,
  };
}

/**
 * 校验 §7.2 场景生成的完整 LLM 输出 (场景内容 + 归属基本功 + 难度).
 *
 * 与 `validateGeneratedScenarioPayload` 的关系: 本函数 = 场景内容校验 + 两项路由元信息校验,
 * 并且对这两项做**交叉校验** (下面 3 条), 因为它们是"模型主观输出"而不是"客观事实":
 *   1. `exerciseMode` 必须是 10 档 TrainingExerciseMode 之一 (否则模型自造了一个 mode)
 *   2. `difficulty` 必须是 1/2/3 整数 (夹到区间, 而不是直接判废 ——
 *      难度是自评项, 模型给 4 档时夹到 3 比整份判废更划算, 且不会污染零压红线)
 *   3. `rubric.dimensions` 至少 3 条 (少于 3 条的 rubric 撑不起 §1.3 的 3-5 条批注)
 *
 * @param raw LLM 原始输出
 * @returns 合法时返回归一化后的私有场景内容; 非法返回 null.
 */
export function validateCustomScenarioPayload(raw: unknown): PracticeCustomScenarioContent | null {
  const content = validateGeneratedScenarioPayload(raw);
  if (!content) {
    return null;
  }
  if (typeof raw !== 'object' || raw === null) {
    return null;
  }
  const candidate = raw as Record<string, unknown>;

  const exerciseMode = candidate['exerciseMode'];
  if (!Object.values(TrainingExerciseMode).includes(exerciseMode as TrainingExerciseMode)) {
    return null;
  }

  // 难度: 缺失/非法 → 夹到 L1 (诚实标注, 不假装是进阶素材); 越界 → 夹到 [1,3].
  const rawDifficulty = candidate['difficulty'];
  const difficulty = clampPracticeDifficulty(rawDifficulty);

  // rubric 维度下限: 少于 3 条撑不起 §1.3 的 3-5 条批注 (评判端会逐维度各出 1 条).
  if (content.rubric.dimensions.length < 3) {
    return null;
  }

  return {
    exerciseMode: exerciseMode as TrainingExerciseMode,
    difficulty,
    ...content,
  };
}

/**
 * 把任意难度输入夹到合法的 1/2/3 区间.
 *
 * 非数字 / NaN / 缺失 → L1 (最保守, 不假装是进阶素材);
 * 越界 → 夹到边界 (0 → 1, 9 → 3).
 */
export function clampPracticeDifficulty(raw: unknown): PracticeDifficulty {
  const value = typeof raw === 'number' ? raw : Number.NaN;
  if (!Number.isFinite(value)) {
    return PracticeDifficulty.L1;
  }
  const rounded = Math.round(value);
  if (rounded < PracticeDifficulty.L1) return PracticeDifficulty.L1;
  if (rounded > PracticeDifficulty.L3) return PracticeDifficulty.L3;
  return rounded;
}

/**
 * 校验用户私有场景的原始输入 (source_payload json 列).
 *
 * 从 DB 读回时做防御性校验: 万一有人手工改库写进了脏值, 宁可当作"无输入"降级,
 * 也不能让脏值渗透到 prompt 里 (prompt 注入风险).
 *
 * @returns 合法时返回归一化后的 payload; 非法返回 null.
 */
export function validateCustomScenarioSourcePayload(raw: unknown): PracticeCustomScenarioSourcePayload | null {
  if (typeof raw !== 'object' || raw === null) {
    return null;
  }
  const candidate = raw as Record<string, unknown>;

  const visitorQuote = candidate['visitorQuote'];
  const counselorReply = candidate['counselorReply'];
  const stuckPoint = candidate['stuckPoint'];
  const hintExerciseId = candidate['hintExerciseId'];

  if (!isNonEmptyString(visitorQuote)) return null;
  if (typeof counselorReply !== 'string') return null;
  if (typeof stuckPoint !== 'string') return null;
  if (hintExerciseId !== null && typeof hintExerciseId !== 'string') return null;

  return {
    visitorQuote,
    counselorReply,
    stuckPoint,
    hintExerciseId,
  };
}

/**
 * 难度档位是否属于合法枚举 (DB 读到脏值时的兜底判据).
 */
export function isPracticeDifficulty(value: unknown): value is PracticeDifficulty {
  return Object.values(PracticeDifficulty).includes(value as PracticeDifficulty);
}
