// V2026-11-06 治本 (WP43 · 评估引擎基础版 · 评估结果表实体):
//   职责: 承载 `session_evaluations` 表 —— 一场对练的**规则引擎快速评分**.
//   边界: 只描述表结构与列语义; 零业务逻辑、零 IO.
//
//   这张表与既有两张"评分表"的关系 (别造双胞胎):
//     · `supervision_reports` = **LLM 深度督导报告** (六维综合打分 + 标注 + 建议, 30-120s);
//     · `ability_scores` = 能力雷达的**累计画像** (跨会话聚合);
//     · 本表 = **单场规则快评** (毫秒级, 纯计数 + 首末差值) —— 补的是"立刻能看到"这一档.
//
//   为什么 `session_id` 唯一:
//     一场会话只该有一份评估 —— 会话被重开/续接时会重算, **覆盖**旧的 (新的是全量),
//     而不是堆出第二行 (列表里两行同一场 = 用户看不懂).
//
//   反双胞胎:
//     - **不加 DB-level FK**: 与 ADR-0003 一致, 跨表引用应用层校验;
//     - **不做软删**: 评估是"某场聊完算出来的事实", 删掉它等于让复盘凭空消失;
//     - **不落对话原文**: raw_stats 只落计数与首末关键值 —— 心理内容不进普通表
//       (逐字稿有它自己的表 `training_sessions.transcript`).
//     - **不加 updated_at**: 本表是**覆盖式**快照 (每次重算覆盖同一行), created_at 表达
//       "这份评估是什么时候算出来的" —— 加一个 updated_at 会让人以为有多版本历史.
//
//   验证 (大炮跑 pnpm migration:run 后):
//     1. DESCRIBE session_evaluations;              # 9 列
//     2. SHOW INDEX FROM session_evaluations;       # PRIMARY + 2 索引 (其中 session_id 唯一)
//
//   时间戳: 2026-11-06

import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

import type { BdiDeltaScores, EthicsScores, RawEvaluationStats, TechnicalScores } from '../evaluation/evaluation-engine.js';

/**
 * `session_evaluations` 表 —— 单场对练的规则引擎快评 (覆盖式快照).
 *
 * 一行 = 一场训练会话的快速评分 (总会话唯一).
 */
@Entity('session_evaluations')
// 学员维度: "我的评估列表"按创建时间倒序分页 (索引跟着查询走).
@Index('idx_se_user_created', ['userId', 'createdAt'])
// 一场会话一份评估 (重算覆盖, 不堆行).
@Index('uq_se_session', ['sessionId'], { unique: true })
export class SessionEvaluation {
  /** 主键 (uuid). */
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** 关联训练会话 id (`training_sessions.id`). */
  @Column({ type: 'varchar', length: 36, name: 'session_id' })
  sessionId!: string;

  /** 归属学员 id (与 `training_sessions.user_id` 同口径: uuid 字符串). */
  @Column({ type: 'varchar', length: 36, name: 'user_id' })
  userId!: string;

  /** 综合总分 (0-100). */
  @Column({ type: 'float', name: 'overall_score' })
  overallScore!: number;

  /** 技术维度分 (9 维 + 平均分). */
  @Column({ type: 'json', name: 'technical_scores' })
  technicalScores!: TechnicalScores;

  /** BDI 变化维度分 (4 维 + 平均分). */
  @Column({ type: 'json', name: 'bdi_delta_scores' })
  bdiDeltaScores!: BdiDeltaScores;

  /** 伦理维度分 (crisis 次数 + warn/block 计数 + 安全评级). */
  @Column({ type: 'json', name: 'ethics_scores' })
  ethicsScores!: EthicsScores;

  /** 原始统计 (事件计数 / 首末轮关键值 / 安全判定计数) —— 供调试与回溯. */
  @Column({ type: 'json', name: 'raw_stats' })
  rawStats!: RawEvaluationStats;

  /** 计算时刻. */
  @CreateDateColumn({ type: 'datetime', name: 'created_at' })
  createdAt!: Date;
}
