// V2026-11-06 治本 (WP44 · 成长档案体系 — 对练信号 → 能力子指标 映射表):
//   职责: 声明"对练数据能喂进哪些能力子指标, 以及怎么喂"这条**唯一口径**.
//   边界: **纯常量 + 纯函数** —— 零 IO / 零 ORM / 零 NestJS.
//
//   为什么是常量表而不是散落在 service 里:
//     映射口径是**临床/教学口径**, 不是实现细节 ——
//       "共情精准度 = 快评的共情次数分 + 督导的共情维度分" 这条等价关系,
//       散落在代码里就会变成"两处各写一遍, 改一处忘一处".
//     表只有一份 → 聚合器读它 → 文档读它 → 未来加子指标只改这一处.
//
//   ⚠️ **boundaryCross 的方向 (最容易搞错的一处, 已被单测逮到)**:
//     `skill_boundary_awareness`（边界意识）= **越高越好**;
//     快评的 `technicalScores.boundaryCross` 字段名带着"越界"事件名, **但值已经是得分**:
//     WP43 的刻度是"0 次越界 = 100 分, 每越界一次扣 50 分" —— 所以它**本身就是越高越好**.
//     若再多翻一次 (100 - boundaryCross), 0 次越界会记成 0 分、越界 2 次记成 100 分 —— 正好反过来.
//     教训: **字段名带"坏事件"不代表值是坏方向** —— 方向要看刻度, 不能看名字.
//
//   与既有两处能力画像写入的关系 (别造双胞胎):
//     · `ability_scores` 一行 = 一个 (用户 × 子指标) —— **物理上只有一行**;
//     · MCQ 刷题 (`practice-ability-sync`) 与对练 (本单) 写的是**同一批行**;
//     · 所以"重叠子指标取合并均值"必须由**统一聚合器**算 (见 ability-aggregate.service.ts),
//       否则两路各写各的 → 谁后写谁赢 → 雷达分会漂移.
//
//   只喂 5 个子指标的理由 (任务单 §三):
//     26 个子指标里, 只有这 5 个能从对练数据里提取出**明确的分数信号**;
//     语音 4 / 习惯 4 / 错误 3 / 备考 4 / 游戏化 3 —— 对练数据里没有对应信号,
//     硬映射就是造噪声. 留后续 WP.
//
//   数值防御 (为什么每处取值都过一道 scoreOrNull):
//     两个来源都是 **JSON 列** —— 快评的 technical_scores / ethics_scores 是本仓自己写的 (可控),
//     但督导的 dimensions 是 **LLM 解析出来的**, 字段可能缺 / 可能不是数字.
//     直接解引用 + 参与均值 → NaN 污染整条雷达线, 而且 NaN 会静默传播 (最难查的一类 bug).
//     所以所有取值都先过一道"有限数"校验, 缺项当"没有这项信号" (不是 0 分).

import type { SupervisionDimensions } from '../../agent/supervisor/supervisor.types.js';
import type { EthicsScores, TechnicalScores } from '../evaluation/evaluation-engine.js';

/**
 * 快评信号取值视图 (只暴露映射表真正用到的两块).
 *
 * 为什么不给整个 SessionEvaluationScores: 映射表不该看见 raw (原始统计) 与 bdiDelta ——
 *   给得越窄, 越不容易被"顺手多读一个字段"带偏口径.
 */
export interface SessionEvaluationSignalView {
  /** 技术维度分 (9 维 + 平均). */
  readonly technical: TechnicalScores;
  /** 伦理维度分. */
  readonly ethics: EthicsScores;
}

/**
 * 对练信号 → 能力子指标 的映射规则.
 */
export interface SessionAbilitySignalRule {
  /** 能力子指标 code (ability_dimensions.sub_indicator_code). */
  readonly dimensionCode: string;
  /** 子指标中文名 (日志 / 文档用). */
  readonly dimensionName: string;
  /**
   * 快评来源 (WP43 的 session_evaluations) → 0-100 信号.
   *
   * 返回 null = 该来源**没有**这个子指标的信号 (不是 0 分, 是"没有这项数据").
   */
  readonly fromEvaluation: (scores: SessionEvaluationSignalView) => number | null;
  /**
   * 督导来源 (supervision_reports 六维) → 0-100 信号.
   *
   * 返回 null = 该来源没有这个子指标的信号.
   */
  readonly fromReport: (dimensions: SupervisionDimensions) => number | null;
}

/**
 * 取一个有限数值 (缺 / 非法 / NaN → null).
 *
 * @param value 候选值
 * @returns 有限数值; 否则 null
 */
function scoreOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * 取两个数值的均值 (缺一 → 取另一个; 都缺 → null).
 *
 * @param a 值 1
 * @param b 值 2
 * @returns 均值 (0-100); 两个都缺 → null
 */
function meanOrNull(a: unknown, b: unknown): number | null {
  const x = scoreOrNull(a);
  const y = scoreOrNull(b);
  if (x === null) return y;
  if (y === null) return x;
  return (x + y) / 2;
}

/**
 * 对练信号 → 能力子指标 映射表 (5 个核心子指标).
 *
 * 顺序按 ability_dimensions 的展示顺序 (基础技能在前) 排, 便于日志阅读.
 */
export const SESSION_ABILITY_MAPPING: readonly SessionAbilitySignalRule[] = [
  {
    dimensionCode: 'skill_empathy_precision',
    dimensionName: '共情精准度',
    // 快评: 共情手法次数分 (0-100, 越高越好); 督导: 共情维度分.
    fromEvaluation: (scores) => scoreOrNull(scores.technical.empathy),
    fromReport: (dimensions) => scoreOrNull(dimensions.empathy),
  },
  {
    dimensionCode: 'skill_listening_accuracy',
    dimensionName: '倾听准确率',
    // 快评: **无对应信号** —— 规则引擎评的是"我做了什么手法", 没有"我听懂了没有"这一维.
    //   宁可少一个来源, 也不拿别的维度的分硬凑 (硬凑 = 造噪声).
    fromEvaluation: () => null,
    // 督导: 主动倾听 + 回应质量 两维取均值 (两者都是越高越好).
    fromReport: (dimensions) => meanOrNull(dimensions.activeListening, dimensions.response),
  },
  {
    dimensionCode: 'skill_questioning_openness',
    dimensionName: '提问开放度',
    fromEvaluation: (scores) => scoreOrNull(scores.technical.openProbe),
    fromReport: (dimensions) => scoreOrNull(dimensions.questioning),
  },
  {
    dimensionCode: 'skill_boundary_awareness',
    dimensionName: '边界意识',
    // 快评的 boundaryCross 已经是**边界意识得分** (越高越好: 0 次越界 = 100 分),
    //   直接用 —— 再翻一次就反了 (见文件头的说明).
    fromEvaluation: (scores) => scoreOrNull(scores.technical.boundaryCross),
    fromReport: (dimensions) => scoreOrNull(dimensions.boundary),
  },
  {
    dimensionCode: 'knowledge_ethics_mastery',
    dimensionName: '伦理规范掌握度',
    fromEvaluation: (scores) => scoreOrNull(scores.ethics.score),
    fromReport: (dimensions) => scoreOrNull(dimensions.professionalism),
  },
];

/**
 * 全部可由对练数据喂养的子指标 code (顺序同映射表).
 */
export const SESSION_ABILITY_DIMENSION_CODES: readonly string[] = SESSION_ABILITY_MAPPING.map((rule) => rule.dimensionCode);

/**
 * 按子指标 code 找映射规则.
 *
 * @param dimensionCode 子指标 code
 * @returns 映射规则; 没配 → undefined
 */
export function sessionAbilityRuleOf(dimensionCode: string): SessionAbilitySignalRule | undefined {
  return SESSION_ABILITY_MAPPING.find((rule) => rule.dimensionCode === dimensionCode);
}
