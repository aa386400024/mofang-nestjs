/**
 * V2026-09-11 治本 (好状态日记 · 跨 feature 情绪对齐):
 *   原因: 镜像前端 DiaryMoodLevel (大厂 spec: 不跨 feature 直接 import EmotionLevel,
 *         跨 feature 走 DI bridge). 保留 4 档语义 (great / okay / low / crisis),
 *         enum name 故意保持英文小写, 跟 emotion 模块的 EmotionLevel.name 一致,
 *         简化双向无损转换.
 *   修复: 4 档均「被看见」, 无好坏之分 (符合 PRD §6 「无评判」原则). crisis 档
 *         触发 crisisFlag=true 路径 (AI 反馈层), 业务层调用方按需处理.
 *   如何验证: 编辑器选「状态很差」→ DB 存 'crisis' → 重启后解析回 DiaryMoodLevel.Crisis.
 */

/**
 * 写日记时的情绪档位 — 本地枚举, 镜像 emotion 模块的 EmotionLevel 语义.
 *
 * 命名: 跟前端 DiaryMoodLevel.name / EmotionLevel.name 1:1 ('great' / 'okay' /
 *       'low' / 'crisis'), 简化 bridge 转换.
 *
 * 隐私产品原则 (PRD §6 「无评判」): 4 档均「被看见」, 无好坏之分.
 */
export enum DiaryMoodLevel {
  /** 状态很好 — 阳光开朗, 情绪稳定. */
  Great = 'great',

  /** 状态一般 — 平平淡淡, 没什么特别. */
  Okay = 'okay',

  /** 状态不太好 — 有些低落 / 烦躁 / 疲惫. */
  Low = 'low',

  /** 状态很差 — 难受到需要支持. */
  Crisis = 'crisis',
}

export const DIARY_MOOD_LEVEL_VALUES: DiaryMoodLevel[] = [
  DiaryMoodLevel.Great,
  DiaryMoodLevel.Okay,
  DiaryMoodLevel.Low,
  DiaryMoodLevel.Crisis,
];

/** 字符串解析 — 非法值返回 null (moodSnapshot 是可选字段, 容错). */
export function parseDiaryMoodLevel(value: string | null | undefined): DiaryMoodLevel | null {
  if (!value) return null;
  for (const level of DIARY_MOOD_LEVEL_VALUES) {
    if (level === value) return level;
  }
  return null;
}
