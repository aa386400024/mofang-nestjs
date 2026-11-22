/**
 * 默契拼图题目分类 — V2026-09-12 §6.4 共种默契拼图.
 *
 * 大厂 standard (跟前端 PuzzleCategory 1:1):
 *   - emotionRecognition: 情绪识别 (看图片 / 文字, 选对方的情绪)
 *   - coreValues: 价值观 (面对选择, 你的偏好)
 *   - dailyHabits: 日常习惯 (周末 / 早起 / 工作方式)
 *   - boundaries: 关系边界 (让不让步 / 私事 / 朋友)
 *
 * 反双胞胎:
 *   - 不复用 assessment/... 的 Category (那是测评分类, 无关)
 */
export enum DualPuzzleCategory {
  EMOTION_RECOGNITION = 'emotion_recognition',
  CORE_VALUES = 'core_values',
  DAILY_HABITS = 'daily_habits',
  BOUNDARIES = 'boundaries',
}
