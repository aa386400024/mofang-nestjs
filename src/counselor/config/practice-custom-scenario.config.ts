// V2026-10-22 治本 (V1.3 §7.4 / §8.5 B2 — 用户私有场景的运行参数与降级策略):
//   原因: §7 是**唯一每次都调 LLM** 的练习接口 (随机/标准场景都是静态 seed),
//     所以它必须自带三道闸门, 否则会成为整个引擎的成本与可用性单点:
//       ① 频次闸门 (§7.4): 默认每用户**每天** 5 次
//       ② 存量闸门 (§8.5 B2): 私有场景条数上限 (防止无限堆积)
//       ③ 时限闸门 (§7.4): 生成超时 8s → 软降级
//     三道闸门的共同原则 (零压红线): **降级不是报错**.
//       - 超频 → 软降级回标准题库, 不弹「今日已用完」红条
//       - 超时 / LLM 挂 → 走确定性模板场景, 不阻塞用户
//     任何一处把降级写成 4xx/5xx, 都等于把"AI 暂时不好用"变成"功能不可用",
//     而这正是 §1.4 留存飞轮要防的"练完就没了".
//
//   修法: 本文件集中所有可调参数 (env 可覆盖) + 降级原因枚举 + 降级响应的组装函数.
//
//   反双胞胎:
//     - 不用会员档位配额管这项: 会员档位管的是"权益" (能动用多少语音场次),
//       这里管的是"单次接口的调用频率", 是**防滥用**不是**卖权益**, 两者混在一张
//       quotas 表里会让"升级会员能不能多生成场景"变成一个产品承诺
//     - 不把默认值写死在 service 里: 线上要能不发版调整
//     - 不在降级时抛异常: 见上 (零压红线在可用性维度上的同一条原则)
//
//   验证:
//     1. tsc 0 错
//     2. env PRACTICE_CUSTOM_SCENARIO_DAILY_LIMIT=0 → 全部生成请求走降级路径
//     3. env PRACTICE_CUSTOM_SCENARIO_GENERATION_TIMEOUT_MS=1 → 走模板降级
//
//   时间戳: 2026-10-22

import { PracticeEngine } from '../enums/practice-engine.enum';
import { PracticeQuotaType } from '../enums/practice-quota-type.enum';
import { PracticeRubricCheck } from '../enums/practice-rubric-check.enum';
import { PracticeScenarioOrigin } from '../enums/practice-scenario-source.enum';
import { TrainingExerciseMode } from '../enums/training-exercise-mode.enum';

/** 每日生成次数上限的 env 键. */
export const PRACTICE_CUSTOM_SCENARIO_DAILY_LIMIT_ENV_KEY = 'PRACTICE_CUSTOM_SCENARIO_DAILY_LIMIT';

/** 私有场景存量上限的 env 键. */
export const PRACTICE_CUSTOM_SCENARIO_MAX_COUNT_ENV_KEY = 'PRACTICE_CUSTOM_SCENARIO_MAX_COUNT';

/** 生成时限的 env 键 (毫秒). */
export const PRACTICE_CUSTOM_SCENARIO_TIMEOUT_ENV_KEY = 'PRACTICE_CUSTOM_SCENARIO_GENERATION_TIMEOUT_MS';

/** 每日生成次数上限的缺省值 (spec §7.4 原文「默认每用户每天 5 次」). */
export const PRACTICE_CUSTOM_SCENARIO_DAILY_LIMIT_DEFAULT = 5;

/** 私有场景存量上限的缺省值 (§8.5 B2: 私有场景需要条数上限, 防无限堆积). */
export const PRACTICE_CUSTOM_SCENARIO_MAX_COUNT_DEFAULT = 50;

/** 生成时限的缺省值 (spec §7.4 原文「超时 8s」). */
export const PRACTICE_CUSTOM_SCENARIO_TIMEOUT_DEFAULT_MS = 8000;

/**
 * 私有场景生成在 quota_usage 表里的配额类型 (日粒度, period = YYYY-MM-DD).
 *
 * **从 enum 派生**而不写死字面量: 配额类型值的唯一事实源是 `PracticeQuotaType`,
 * 这里只做一份别名, 避免两处各写一个字符串后慢慢漂开 (那会让同一个配额
 * 悄悄裂成两个桶, 统计永远对不上).
 */
export const PRACTICE_CUSTOM_SCENARIO_QUOTA_TYPE = PracticeQuotaType.CUSTOM_SCENARIO_GENERATION;

/**
 * 降级原因 (客户端据此决定提示措辞, 服务端不硬编码文案).
 */
export enum PracticeCustomScenarioDegradeReason {
  /** 今日生成次数已用完 (spec §7.4: 软降级回标准题库, 不弹红条). */
  QUOTA_EXCEEDED = 'quota_exceeded',
  /** LLM 生成失败 / 超时 / 产出不合规 (走确定性模板场景). */
  GENERATION_UNAVAILABLE = 'generation_unavailable',
  /** 私有场景存量已达上限 (走标准题库). */
  STORAGE_LIMIT_REACHED = 'storage_limit_reached',
}

/**
 * 解析一个正整数 env 参数.
 *
 * @param raw env 原始值
 * @param defaultValue 缺省值
 * @param min 允许的最小值 (小于此值按 min 处理, 0 是合法值时传 0)
 * @returns 解析后的整数
 */
export function parsePositiveIntEnv(raw: string | undefined, defaultValue: number, min = 0): number {
  if (raw === undefined) {
    return defaultValue;
  }
  const normalized = raw.trim();
  if (normalized.length === 0) {
    return defaultValue;
  }
  const parsed = Number(normalized);
  if (!Number.isInteger(parsed) || parsed < min) {
    return defaultValue;
  }
  return parsed;
}

/**
 * 今日配额的自然日 period 串 (YYYY-MM-DD).
 *
 * 与 `quota_usage.period` 的月度串 ('YYYY-MM') 共存于同一张表, 靠
 * UNIQUE (user_id, quota_type, period) 天然互不干扰.
 *
 * @param now 参照时刻 (默认取当前时间)
 * @returns YYYY-MM-DD
 */
export function practiceDailyPeriod(now: Date = new Date()): string {
  const year = now.getFullYear();
  const month = `${now.getMonth() + 1}`.padStart(2, '0');
  const day = `${now.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * 判定方式 (用 enum 而非字符串字面量: 落库时要跟 PracticeRubricCheck 逐字对齐,
 * 写成字面量联合类型会跟 enum 类型不兼容, 在赋给 rubric.dimensions 时报 TS2322).
 */
export interface PracticeTemplateScenario {
  /** 归属基本功 */
  exerciseMode: TrainingExerciseMode;
  /** 难度 (模板一律入门档, 诚实标注) */
  difficulty: 1;
  /** 来访者称呼 (代称, 符合 §7.3.1 脱敏) */
  personaName: string;
  /** 不可识别的背景注记 */
  personaNote: string;
  /** 来访者第一句话 (忠实引用用户原话, 已做长度裁剪) */
  visitorLine: string;
  /** 任务说明 */
  taskPrompt: string;
  /** 评判维度 */
  dimensions: {
    key: string;
    label: string;
    positiveKeywords: string[];
    antiKeywords: string[];
    check: PracticeRubricCheck;
  }[];
}

/**
 * 由用户原话构造一条确定性模板场景.
 *
 * @param visitorQuote 来访者原话
 * @param exerciseMode 归属基本功
 * @returns 模板场景
 */
export function buildTemplateScenario(visitorQuote: string, exerciseMode: TrainingExerciseMode): PracticeTemplateScenario {
  // 裁剪到 120 字: 既保留原意, 又不会让气泡撑爆练习页.
  const quote = visitorQuote.trim().slice(0, 120);

  return {
    exerciseMode,
    difficulty: 1,
    personaName: '他',
    personaNote: '真实案例还原 (脱敏后)',
    visitorLine: quote,
    taskPrompt: '重新接一次这句话, 先只盯住一个技术动作.',
    dimensions: [
      {
        key: 'namesEmotion',
        label: '是否先命名了对方此刻的情绪',
        positiveKeywords: ['听起来', '好像', '是不是有点', '感觉你', '我猜'],
        antiKeywords: [],
        check: PracticeRubricCheck.CONTAINS_ANY,
      },
      {
        key: 'offersInvitation',
        label: '是否给出了让对方可以继续展开的邀请',
        positiveKeywords: ['愿意说说', '多讲讲', '你想聊', '可以说说', '接着说'],
        antiKeywords: [],
        check: PracticeRubricCheck.CONTAINS_ANY,
      },
      {
        key: 'avoidsAdvice',
        label: '是否在给建议',
        positiveKeywords: ['你应该', '我建议你', '你可以试试', '最好的办法'],
        antiKeywords: ['你应该', '我建议你', '你可以试试', '最好的办法'],
        check: PracticeRubricCheck.CONTAINS_NONE,
      },
    ],
  };
}

/**
 * 模板场景 → 三引擎形态的内容 (供降级响应复用 §7.2 的 content 结构).
 *
 * @param template 模板场景
 * @returns content 结构
 */
export function templateScenarioToContent(template: PracticeTemplateScenario): {
  visitorLine: string;
  taskPrompt: string;
  dimensions: PracticeTemplateScenario['dimensions'];
  referenceResponses: string[];
  commonErrors: string[];
} {
  return {
    visitorLine: template.visitorLine,
    taskPrompt: template.taskPrompt,
    dimensions: template.dimensions,
    referenceResponses: ['你可以先不接住, 只是把刚才那句话里你听到的情绪说出来, 然后停一下, 看对方会不会接。'],
    commonErrors: ['直接跳到解决办法', '连着问了好几个问题', '用了一堆专业术语'],
  };
}

/**
 * 降级响应的**内容出处**标记 (§7.2 的 `source` 字段).
 *
 * 降级到标准题库时, 内容出处是 'standard_library' 而不是 'user_generated' ——
 * 客户端据此可以诚实地告诉用户"这次给你的是标准题库里的场景".
 */
export const PRACTICE_DEGRADED_SCENARIO_ORIGIN = PracticeScenarioOrigin.STANDARD_LIBRARY;

/**
 * 降级到标准题库时使用的引擎 (接话演练 = 最通用的引擎).
 */
export const PRACTICE_DEGRADED_SCENARIO_ENGINE = PracticeEngine.AI_RESPONSE;
