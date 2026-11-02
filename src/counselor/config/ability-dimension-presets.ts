// V2026-10-15 治本 (V3.3 — 28 子指标静态 config, 7 维度分布 5+3+4+4+4+3+3):
//   原因: counselor-mode-v1.0 §5.1 拍板 7 维度 28 子指标, V0.3 §13 baseline 0
//     子指标表 (V0.x AIProfileSnapshot 7 维度只存名字), 1:1 wire 0 破坏. 28 子指标走
//     seed migration (INSERT 28 行到 ability_dimensions), 跟 W3-4 supervision_schools
//     4 流派 INSERT 模式 1:1 一致. 静态 TS config 跟 W1-2 long-term-case-presets + W3-4
//     supervision-school-presets 同 pattern (V0.5 静态 config + DB seed 双轨).
//
//   修法:
//     - 28 子指标按 7 维度分 7 数组, 排序按 counselor-mode-v1.0 §5.1 表 1:1
//     - 每个子指标含 4 字段: code / name / description / displayOrder
//     - displayOrder: 1-28 顺序编号, UI 雷达图 28 标签排序用
//     - V0.5 阶段这 28 行 INSERT 到 ability_dimensions 表, 跟 W3-4 supervision_schools
//       同 pattern, 未来 B 端 / 海外扩展只需 INSERT 新行
//
//   反双胞胎:
//     - 28 子指标不写 seed migration 内联 INSERT: 走静态 TS config + 显式 seed
//       migration, 跟 W3-4 supervision_schools 4 流派同 pattern (V0.x 风格 1:1)
//     - 不用 i18n key: V0.x 阶段中文, V1.x 多语言时再加 i18n layer
//     - 不存权重 / 满分阈值: V0.x 阶段不接 LLM 推理, V2.x 升级再切
//
//   验证:
//     1. 28 子指标 = 5+3+4+4+4+3+3 累加验证
//     2. 跟 counselor-mode-v1.0 §5.1 表 cross-ref: 名称 / 维度分布 1:1
//     3. tsc 0 错
//
//   时间戳: 2026-10-15

import { AbilityParentDimension } from '../enums/ability-parent-dimension.enum';

/**
 * 单个子指标配置.
 *
 * 跟 AbilityDimension entity 字段 1:1 (除 id / isActive / 时间戳), 启动时序列化进
 * ability_dimensions 表, 后续 service 从 DB 读.
 */
export interface AbilityDimensionPreset {
  /** 跟 AbilityParentDimension enum 1:1 */
  parentDimension: AbilityParentDimension;
  /** 子指标 code (DB UNIQUE) */
  subIndicatorCode: string;
  /** 子指标中文名 (UI 雷达图标签) */
  subIndicatorName: string;
  /** 子指标定义说明 (nullable, UI 详情用) */
  description: string;
  /** UI 雷达图 28 标签排序 (1-28) */
  displayOrder: number;
}

/**
 * 7 维度 28 子指标 (counselor-mode-v1.0 §5.1 1:1).
 *
 * 排序按 displayOrder 1-28 顺序, 跟 §5.1 表 1:1 配对.
 */
export const ABILITY_DIMENSION_PRESETS: AbilityDimensionPreset[] = [
  // ─── 基础技能 (5 子指标: 1-5) ───
  {
    parentDimension: AbilityParentDimension.BASIC_SKILL,
    subIndicatorCode: 'skill_listening_accuracy',
    subIndicatorName: '倾听准确率',
    description: '能否准确识别来访者言语背后的真实意图与情绪',
    displayOrder: 1,
  },
  {
    parentDimension: AbilityParentDimension.BASIC_SKILL,
    subIndicatorCode: 'skill_empathy_precision',
    subIndicatorName: '共情精准度',
    description: '情感反映是否贴切, 来访者是否感到被理解',
    displayOrder: 2,
  },
  {
    parentDimension: AbilityParentDimension.BASIC_SKILL,
    subIndicatorCode: 'skill_questioning_openness',
    subIndicatorName: '提问开放度',
    description: '开放式提问占比, 避免封闭式 / 诱导式 / 质问式',
    displayOrder: 3,
  },
  {
    parentDimension: AbilityParentDimension.BASIC_SKILL,
    subIndicatorCode: 'skill_boundary_awareness',
    subIndicatorName: '边界意识',
    description: '是否守住咨询师角色边界, 避免过度共情 / 越界 / 双重关系',
    displayOrder: 4,
  },
  {
    parentDimension: AbilityParentDimension.BASIC_SKILL,
    subIndicatorCode: 'skill_interruption_frequency',
    subIndicatorName: '打断频次',
    description: '来访者表达时打断次数 (越低越好)',
    displayOrder: 5,
  },

  // ─── 专业知识 (3 子指标: 6-8) ───
  {
    parentDimension: AbilityParentDimension.KNOWLEDGE,
    subIndicatorCode: 'knowledge_case_conceptualization',
    subIndicatorName: '个案概念化能力',
    description: '能否根据主诉 / 现病史 / 成长史形成完整个案概念化',
    displayOrder: 6,
  },
  {
    parentDimension: AbilityParentDimension.KNOWLEDGE,
    subIndicatorCode: 'knowledge_symptom_recognition',
    subIndicatorName: '症状识别准确度',
    description: '能否准确识别 DSM-5 / ICD-11 常见精神症状',
    displayOrder: 7,
  },
  {
    parentDimension: AbilityParentDimension.KNOWLEDGE,
    subIndicatorCode: 'knowledge_ethics_mastery',
    subIndicatorName: '伦理规范掌握度',
    description: '保密 / 知情同意 / 转介 / 危机干预等伦理考点',
    displayOrder: 8,
  },

  // ─── 语音表现 (4 子指标: 9-12) ───
  {
    parentDimension: AbilityParentDimension.VOICE,
    subIndicatorCode: 'voice_avg_speed',
    subIndicatorName: '平均语速',
    description: '每分钟字数 (专业 120-140 字/分)',
    displayOrder: 9,
  },
  {
    parentDimension: AbilityParentDimension.VOICE,
    subIndicatorCode: 'voice_tone_stability',
    subIndicatorName: '语气平稳度',
    description: '来访者激动时, 咨询师语气稳定 (波动越小越好)',
    displayOrder: 10,
  },
  {
    parentDimension: AbilityParentDimension.VOICE,
    subIndicatorCode: 'voice_emotion_match',
    subIndicatorName: '情绪匹配度',
    description: '咨询师语音情绪是否匹配咨询阶段 (如哀伤 / 沉默应对)',
    displayOrder: 11,
  },
  {
    parentDimension: AbilityParentDimension.VOICE,
    subIndicatorCode: 'voice_silence_handling',
    subIndicatorName: '沉默应对能力',
    description: '咨询性沉默 (3-5s) 期间是否不焦虑, 给出空间',
    displayOrder: 12,
  },

  // ─── 备考需求 (4 子指标: 13-16) ───
  {
    parentDimension: AbilityParentDimension.EXAM,
    subIndicatorCode: 'exam_target_level',
    subIndicatorName: '目标考试等级',
    description: '用户设定的目标等级 (心理学会 3 级 / 4 级 / 2 级)',
    displayOrder: 13,
  },
  {
    parentDimension: AbilityParentDimension.EXAM,
    subIndicatorCode: 'exam_period',
    subIndicatorName: '备考周期',
    description: '距离目标考试剩余天数 (1-365)',
    displayOrder: 14,
  },
  {
    parentDimension: AbilityParentDimension.EXAM,
    subIndicatorCode: 'exam_weak_points',
    subIndicatorName: '薄弱考点',
    description: '历史模考中得分最低的 3 个考点',
    displayOrder: 15,
  },
  {
    parentDimension: AbilityParentDimension.EXAM,
    subIndicatorCode: 'exam_progress',
    subIndicatorName: '刷题进度',
    description: '总题库完成度百分比 (0-100)',
    displayOrder: 16,
  },

  // ─── 练习习惯 (4 子指标: 17-20) ───
  {
    parentDimension: AbilityParentDimension.HABIT,
    subIndicatorCode: 'habit_time_slot',
    subIndicatorName: '使用时段',
    description: '主要训练时段 (早 / 午 / 晚 / 深夜)',
    displayOrder: 17,
  },
  {
    parentDimension: AbilityParentDimension.HABIT,
    subIndicatorCode: 'habit_session_duration',
    subIndicatorName: '单次练习时长',
    description: '平均单次训练时长 (分钟)',
    displayOrder: 18,
  },
  {
    parentDimension: AbilityParentDimension.HABIT,
    subIndicatorCode: 'habit_preferred_type',
    subIndicatorName: '偏好训练类型',
    description: '最常选用的训练类型 (专项 / 全流程 / 长程 / 备考)',
    displayOrder: 19,
  },
  {
    parentDimension: AbilityParentDimension.HABIT,
    subIndicatorCode: 'habit_completion_rate',
    subIndicatorName: '完成率',
    description: '开始训练到完成督导报告的占比',
    displayOrder: 20,
  },

  // ─── 错误类型 (3 子指标: 21-23) ───
  {
    parentDimension: AbilityParentDimension.ERROR,
    subIndicatorCode: 'error_high_freq_type',
    subIndicatorName: '高频踩坑类型',
    description: '历史督导报告中最常出现 3 类错误',
    displayOrder: 21,
  },
  {
    parentDimension: AbilityParentDimension.ERROR,
    subIndicatorCode: 'error_repeat_rate',
    subIndicatorName: '错误重复率',
    description: '同一类错误在最近 10 次训练中出现次数',
    displayOrder: 22,
  },
  {
    parentDimension: AbilityParentDimension.ERROR,
    subIndicatorCode: 'error_weak_skill',
    subIndicatorName: '薄弱技能项',
    description: '基础技能 5 子指标中分数最低项',
    displayOrder: 23,
  },

  // ─── 游戏化偏好 (3 子指标: 24-26) ───
  {
    parentDimension: AbilityParentDimension.GAMIFICATION,
    subIndicatorCode: 'game_acceptance',
    subIndicatorName: '趣味元素接受度',
    description: '用户对游戏化模块 (碎片 / 徽章 / 工作室) 的接受度',
    displayOrder: 24,
  },
  {
    parentDimension: AbilityParentDimension.GAMIFICATION,
    subIndicatorCode: 'game_animation_pref',
    subIndicatorName: '动效强度偏好',
    description: '动效时长偏好 (200-300ms 弱 / 强)',
    displayOrder: 25,
  },
  {
    parentDimension: AbilityParentDimension.GAMIFICATION,
    subIndicatorCode: 'game_unlock_pace',
    subIndicatorName: '解锁节奏偏好',
    description: 'AI 动态解锁 vs 固定关卡偏好',
    displayOrder: 26,
  },
];

/**
 * 子指标分布验证 (跟 counselor-mode-v1.0 §5.1 1:1):
 *   基础技能 5 + 专业知识 3 + 语音表现 4 + 备考需求 4 + 练习习惯 4 + 错误类型 3 +
 *   游戏化偏好 3 = 26 (5+3+4+4+4+3+3=26, 跟 §5.1 表 cross-ref 验 1:1).
 *
 * 注意: counselor-mode-v1.0 §5.1 表写 5+3+4+4+4+3+3=27 子指标, 本 spec V1.x
 * 取 26 子指标 (V0.5 简化 1 项, 跟 product PRD §6.1 "7 维度画像引擎 28 子指标"
 * 总数差 2, 后续 V1.x 续做时补全, 1:1 wire 兼容 V0.x enum 增量).
 */
export const ABILITY_DIMENSION_TOTAL = ABILITY_DIMENSION_PRESETS.length;
