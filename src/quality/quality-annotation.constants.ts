// V2026-11-10 治本 (WP-J P2 · 专业级标注工具 · 常量与词表):
//   职责: 标注台的**唯一词表来源** —— 人工标签 / 内核策略映射 / 危机档位 / 状态枚举.
//   边界: 零逻辑 (只有常量与一个类型守卫); 口径计算在 quality-annotation-auto.ts.
//
//   ⚠️ **两套词表不能混** (任务单 §2.2 与仓库事实有出入, 见交付记录偏差 B3):
//     · **人工标签词表** (本文件 ANNOTATION_LABEL): 5 个值, 与前端
//       `AnnotationLabel` 严格 1:1 —— 标注员在浏览器里只能从这 5 个里点.
//       它对齐的是**内核策略枚举**, 不是文本关键词.
//     · **文本行为标签词表** (approach/avoid/attack/appease/neutral):
//       只存在于 `scripts/ops/quality/visitor-quality-audit.ts`, 是**词表推断**,
//       与人工点选不同源 —— 本工具的一致性报告**不用它** (用它就等于拿猜的猜猜人).
//
//   反双胞胎:
//     - 危机档位常量**自带**在这里, 不 import `practice-runner.service.ts` (红线文件);
//       数值与该文件 `CRISIS_LEVEL_BY_CATEGORY` 同口径 (来源同源, 见交付记录 B4).
//     - 标签词表只有一份: 后端常量 = 前端 types.ts, 改一边必须改另一边 (交付记录写明).

/**
 * 人工标注的主导行为标签 (与前端 `AnnotationLabel` 严格 1:1).
 */
export const ANNOTATION_LABEL = {
  /** 叙述 (内核策略 recounting). */
  Recounting: 'recounting',
  /** 阻抗 (内核策略 resistance). */
  Resistance: 'resistance',
  /** 简单回应 (内核策略 simple_response). */
  SimpleResponse: 'simple_response',
  /** 情感流露 (内核策略 affective_exploration —— 词表里少了 _exploration 后缀). */
  Affective: 'affective',
  /** 认知探索 (内核策略 cognitive_exploration). */
  CognitiveExploration: 'cognitive_exploration',
} as const;

/**
 * 人工标签的字面量联合类型.
 */
export type AnnotationLabel = (typeof ANNOTATION_LABEL)[keyof typeof ANNOTATION_LABEL];

/**
 * 人工标签词表 (顺序 = 并列时的定序口径, 与前端 LABELS 数组同序).
 */
export const ANNOTATION_LABELS: readonly AnnotationLabel[] = Object.values(ANNOTATION_LABEL);

/**
 * 列表筛选状态.
 */
export const ANNOTATION_STATUS = {
  /** 待标 (人工标签为空). */
  Pending: 'pending',
  /** 已标 (人工标签非空). */
  Done: 'done',
  /** 全部. */
  All: 'all',
} as const;

/**
 * 列表筛选状态 (字面量联合类型).
 */
export type AnnotationStatus = (typeof ANNOTATION_STATUS)[keyof typeof ANNOTATION_STATUS];

/**
 * 探索类内核策略 (与 `visitor-quality-audit.ts` 的 EXPLORATION_STRATEGIES 同口径).
 */
export const EXPLORATION_STRATEGIES: readonly string[] = ['affective_exploration', 'cognitive_exploration'];

/**
 * 内核策略 → 人工标签的映射.
 *
 * ⚠️ **只映射这 5 个**: 内核还有 request / insight / discussing_plans 三个策略,
 *   它们在人工词表里**没有对应项** —— 标注员点不出来, 所以不参与"主导标签"评选
 *   (见 quality-annotation-auto.ts 的口径说明).
 */
export const STRATEGY_TO_LABEL: Readonly<Record<string, AnnotationLabel | undefined>> = {
  recounting: ANNOTATION_LABEL.Recounting,
  resistance: ANNOTATION_LABEL.Resistance,
  simple_response: ANNOTATION_LABEL.SimpleResponse,
  affective_exploration: ANNOTATION_LABEL.Affective,
  cognitive_exploration: ANNOTATION_LABEL.CognitiveExploration,
};

/**
 * 危机类别 → 档位 (0~3).
 *
 * ⚠️ **与 `practice-runner.service.ts` 的 `CRISIS_LEVEL_BY_CATEGORY` 同口径**,
 *   但**独立复制**而非 import —— 那份文件是本任务的红线禁区 (不许改),
 *   且它属于业务层, 让 admin 读侧 import 业务层会把依赖方向搞浑.
 *   两边若要改档位, 必须一起改 (交付记录 B4 已登记).
 */
export const CRISIS_LEVEL_BY_CATEGORY: Readonly<Record<string, number>> = {
  suicide_exploration: 0,
  passive_ideation: 1,
  active_ideation: 2,
  self_harm_ideation: 2,
  suicide_plan: 3,
  suicide_preparation: 3,
  suicide_attempt: 3,
  self_harm_behavior: 3,
  aggression_others: 3,
  aggression_self: 3,
};

/**
 * 未知危机类别的兜底档位 (与审计脚本同口径: 认到危机就至少是 1 档).
 */
export const CRISIS_LEVEL_FALLBACK = 1;

/**
 * 危机档位下界.
 */
export const CRISIS_LEVEL_MIN = 0;

/**
 * 危机档位上界.
 */
export const CRISIS_LEVEL_MAX = 3;

/**
 * 轮次下界 (轮次从 1 起).
 */
export const ANNOTATION_TURN_MIN = 1;

/**
 * 单场标注耗时上限 (毫秒) —— 24 小时; 超过就是前端打点坏了, 不该落库.
 */
export const ANNOTATION_DURATION_MS_MAX = 86_400_000;

/**
 * 备注长度上限.
 */
export const ANNOTATION_NOTES_MAX_LENGTH = 2000;

/**
 * 判断一个值是不是合法的人工标签.
 *
 * @param value 待判断的值
 * @returns 是合法标签 → true
 */
export function isAnnotationLabel(value: unknown): value is AnnotationLabel {
  return typeof value === 'string' && (ANNOTATION_LABELS as readonly string[]).includes(value);
}
