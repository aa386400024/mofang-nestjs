// V2026-09-04 治本 (V6.0 §3.1 + audit P0-1):
//   AI 用户画像枚举 — 7 维度 + 3 来源.
//   原因: 前端 lib/features/ai_engine/domain/entities/ai_user_profile.dart
//         已定义 7 维度, 后端必须保持 enum 稳定, 后续新增维度只在尾部追加,
//         不改顺序 (避免序列化兼容破坏).
//   修复: enum code 跟前端 AIProfileDimension.code / AIProfileSource.code
//         字符串字面量一一对齐.
//   如何验证: 前后端 round-trip JSON 用同样的 code 字符串, 后端不引入
//             与前端不一致的 alias.

/**
 * 7 维度画像 — V6.0 §3.1 表.
 *
 * 顺序固定: emotion / trait / habit / stage / tolerance / effect / gamification.
 * 新增维度只在尾部追加, 不重排.
 */
export enum AIProfileDimension {
  EMOTION = 'emotion',
  TRAIT = 'trait',
  HABIT = 'habit',
  STAGE = 'stage',
  TOLERANCE = 'tolerance',
  EFFECT = 'effect',
  GAMIFICATION = 'gamification',
}

/**
 * 画像来源 — 端侧推断 / 云端 RAG / 用户主动修正.
 * 前端 AIProfileSourceX.code 对齐.
 */
export enum AIProfileSource {
  CLOUD = 'cloud',
  LOCAL = 'local',
  USER_OVERRIDE = 'user_override',
}

/** 7 维度全部值 — 业务枚举完整性校验 / DTO 校验 / 批量 upsert 用. */
export const ALL_PROFILE_DIMENSIONS: readonly AIProfileDimension[] = [
  AIProfileDimension.EMOTION,
  AIProfileDimension.TRAIT,
  AIProfileDimension.HABIT,
  AIProfileDimension.STAGE,
  AIProfileDimension.TOLERANCE,
  AIProfileDimension.EFFECT,
  AIProfileDimension.GAMIFICATION,
] as const;
