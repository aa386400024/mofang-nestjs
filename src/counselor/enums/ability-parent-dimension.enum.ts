// V2026-10-15 治本 (V3.1 — ability_dimension.parentDimension 7 维度枚举):
//   原因: counselor-mode-v1.0 §5.1 拍板 7 维度 (基础技能/专业知识/语音表现/备考需求/
//     练习习惯/错误类型/游戏化偏好) × 28 子指标, V0.3 §13 baseline 已有 AIProfileSnapshot
//     7 维度名字 (listening/empathy/questioning/boundary/voiceProfessionalism/
//     caseConceptualization/customDimension), 1:1 wire 0 破坏. V1.x W5-6 新建
//     ability_dimension 表, 7 维度 enum 走 V0.x 风格 snake_case 字符串.
//
//   修法:
//     - 7 parentDimension 跟 counselor-mode-v1.0 §5.1 严格 1:1
//     - 跟 V0.x AIProfileSnapshot 7 维度 (英文) 1:1 配对: basicSkill (V0.x listening
//       + empathy + questioning + boundary 合并) / knowledge / voice / exam / habit /
//       error / gamification
//     - 静态 enum (无 DB 行, 跟 V0.x enum 风格一致)
//     - 28 子指标分布: 5 + 3 + 4 + 4 + 4 + 3 + 3 = 28
//
//   反双胞胎:
//     - 不复用 V0.x AIProfileSnapshot 7 维度英文 enum: V0.3 §13 写的是 7 维度名字
//       (listening/empathy/questioning/boundary/voiceProfessionalism/caseConceptualization/
//       customDimension), 跟 counselor-mode-v1.0 §5.1 中文 7 维度映射关系, 1:1 wire
//       增量
//     - 不用 i18n key: V0.x 阶段中文, V1.x 多语言时再加 i18n layer
//
//   验证:
//     1. SELECT enum: 7 值全在
//     2. 跟 counselor-mode-v1.0 §5.1 表 cross-ref: 7 名称 1:1
//     3. 28 子指标分布: 5+3+4+4+4+3+3 = 28 (ability-dimension-presets.ts 验证)
//
//   时间戳: 2026-10-15

/**
 * 7 大维度 (V1.x counselor-mode §5.1).
 *
 * 跟 V0.3 §13 AIProfileSnapshot 7 维度 (listening/empathy/questioning/boundary/
 * voiceProfessionalism/caseConceptualization/customDimension) 1:1 配对.
 * 跟 src/counselor/config/ability-dimension-presets.ts 28 子指标 1:1 配对.
 */
export enum AbilityParentDimension {
  /** 基础技能 (5 子指标: 倾听准确率 / 共情精准度 / 提问开放度 / 边界意识 / 打断频次) */
  BASIC_SKILL = 'basic_skill',
  /** 专业知识 (3 子指标: 个案概念化能力 / 症状识别准确度 / 伦理规范掌握度) */
  KNOWLEDGE = 'knowledge',
  /** 语音表现 (4 子指标: 平均语速 / 语气平稳度 / 情绪匹配度 / 沉默应对能力) */
  VOICE = 'voice',
  /** 备考需求 (4 子指标: 目标考试等级 / 备考周期 / 薄弱考点 / 刷题进度) */
  EXAM = 'exam',
  /** 练习习惯 (4 子指标: 使用时段 / 单次练习时长 / 偏好训练类型 / 完成率) */
  HABIT = 'habit',
  /** 错误类型 (3 子指标: 高频踩坑类型 / 错误重复率 / 薄弱技能项) */
  ERROR = 'error',
  /** 游戏化偏好 (3 子指标: 趣味元素接受度 / 动效强度偏好 / 解锁节奏偏好) */
  GAMIFICATION = 'gamification',
}
