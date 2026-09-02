/**
 * Home 模块常量 — 大厂「配置即代码」做法, 不写 magic string.
 *
 * 范围:
 *   - 情绪档位 (great / okay / low / crisis)
 *   - 权限等级 (L1 / L2 / L3) — 跟 profile 模块保持同一份定义
 *   - 时段 (早 / 中 / 晚 / 夜) — 首页问候 + 兜底推荐用
 *   - 推荐工具 kind / 微干预 kind — 与前端 enum 一一对应
 *
 * 设计原则:
 *   - 全部 `as const` 暴露, 跨模块引用安全
 *   - 跟前端 `lib/features/home/domain/entities/*.dart` 的 enum **完全一致**,
 *     任何一端加字段必须同步另一端
 */

/** 情绪档位 — 4 档无评判分级, 跟 DESIGN V2.0 §3 一致. */
export const HOME_EMOTION_LEVELS = ['great', 'okay', 'low', 'crisis'] as const;
export type HomeEmotionLevel = (typeof HOME_EMOTION_LEVELS)[number];

/** 时段 — 时段化推荐 + 时段问候. */
export const HOME_TIME_SLOTS = ['dawn', 'morning', 'noon', 'afternoon', 'evening', 'night'] as const;
export type HomeTimeSlot = (typeof HOME_TIME_SLOTS)[number];

/** 推荐工具类型 — 决定落地页路由 + 卡片视觉. */
export const HOME_RECOMMENDATION_KINDS = ['breathing_and_mindfulness', 'cbt', 'act', 'growth', 'embodied'] as const;
export type HomeRecommendationKind = (typeof HOME_RECOMMENDATION_KINDS)[number];

/** 微干预类型. */
export const HOME_MICRO_INTERVENTION_KINDS = ['breathing', 'grounding', 'cognitive_defusion', 'self_talk'] as const;
export type HomeMicroInterventionKind = (typeof HOME_MICRO_INTERVENTION_KINDS)[number];

/** 微干预触发场景 — V2.0 「日常微干预植入系统」, 跟设备行为识别挂钩. */
export const HOME_MICRO_INTERVENTION_TRIGGERS = [
  'before_meeting',
  'before_social',
  'before_sleep',
  'after_argument',
  'scrolling_anxiety',
  'late_night',
  'waking_up_anxious',
] as const;
export type HomeMicroInterventionTrigger = (typeof HOME_MICRO_INTERVENTION_TRIGGERS)[number];

/** 关系类型 (陪伴者头像 / 标签). */
export const HOME_COMPANION_RELATIONS = ['family', 'friend', 'partner', 'colleague', 'other'] as const;
export type HomeCompanionRelation = (typeof HOME_COMPANION_RELATIONS)[number];

/** 权限等级 — 与 profile 模块 PermissionLevel 对齐. */
export const HOME_PERMISSION_LEVELS = ['L1', 'L2', 'L3'] as const;
export type HomePermissionLevel = (typeof HOME_PERMISSION_LEVELS)[number];

/** 时段判定工具 — 给 greeting + 推荐兜底用. */
export function getTimeSlotFromHour(hour: number): HomeTimeSlot {
  if (hour >= 0 && hour < 5) return 'dawn';
  if (hour >= 5 && hour < 11) return 'morning';
  if (hour >= 11 && hour < 13) return 'noon';
  if (hour >= 13 && hour < 18) return 'afternoon';
  if (hour >= 18 && hour < 22) return 'evening';
  return 'night';
}

/** 时段问候文案. */
export const HOME_GREETING_BY_SLOT: Record<HomeTimeSlot, string> = {
  dawn: '夜深了',
  morning: '早安',
  noon: '中午好',
  afternoon: '下午好',
  evening: '晚上好',
  night: '夜深了',
};

/** 日期标签 — 「11 月 18 日 · 周二」. */
export function formatDateLabel(date: Date): string {
  // 大厂命名: strictCamelCase 排斥所有大写缩写 (CN), 要么全小写 (weekdayCn), 要么 UPPER_CASE.
  // 选 camelCase (项目本地 const 风格, 跟变量语义一致).
  const weekdayCn = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
  const w = weekdayCn[(date.getDay() + 6) % 7] ?? '周一';
  return `${date.getMonth() + 1} 月 ${date.getDate()} 日 · ${w}`;
}
