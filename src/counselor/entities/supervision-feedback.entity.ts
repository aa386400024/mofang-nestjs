// V2026-10-15 治本 (V2.1 — supervision_feedback entity, 督导反馈记录表):
//   原因: counselor-mode-v1.0 §6.2 拍板 supervision_feedback 表 (sessionId polymorphic /
//     schoolId / feedback json), V0.3 §8 baseline 0 督导反馈持久化 (V0.x 督导走 V0.3
//     §8 supervisor Agent 6 维度, 但落 V0.x supervisionReport json 字段, 1:1 wire
//     0 破坏). V1.x W3-4 新建独立表, 4 流派可叠加生成多份 feedback (同 session 不同 school).
//
//   修法 (跟 knowledge-chunk.entity.ts V0.x 风格一致):
//     - UUID PK + char(36) id
//     - sessionId char(36) polymorphic (sessionType enum 区分, 跟 W1-2 LongTermCaseSession +
//       V0.x TrainingSession 1:1 配对)
//     - sessionType varchar(40) 存 SessionType enum 字符串
//     - schoolId char(36) FK (应用层校验, 不写 DB-level FK, 软删兼容, 跟
//       knowledge_chunks.itemId 同 pattern)
//     - feedback json (overallScore + perSentence + errorCategories + growthSuggestion,
//       跟 counselor-mode-v1.0 §6.2 1:1)
//     - tenantId char(36) (V0.x 多租户, A9: 一人一租户)
//     - userId char(36) (冗余存储, 加速按 userId 聚合查询, 避免跨 polymorphic 表 join)
//     - 3 索引: PRIMARY + UNIQUE (sessionId+sessionType+schoolId) 防重复 + (userId)
//     - 软删 deletedAt
//
//   反双胞胎:
//     - 不用 polymorphic FK 字段名 (sessionId + sessionType 拆 2 字段): V0.x 风格
//       强类型, 不走 json 字段, 防 drift
//     - 不在 V0.x supervisionReport 字段加流派维度: 破坏 1:1 wire, 1:1 wire 0 破坏
//       V0.3 baseline
//     - 不在 W1-2 LongTermCaseSession.supervisionFeedback json 字段塞 4 流派: 那是
//       session 完成时的"默认流派"反馈, W3-4 4 流派叠加走独立表, 不污染 W1-2 json
//     - 不引 vector store: V0.x 阶段不接 RAG, V2.x 升级再切
//
//   验证:
//     1. tsc 0 错
//     2. pnpm migration:run 后 SHOW INDEX FROM supervision_feedback; 3 索引
//
//   时间戳: 2026-10-15

import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

import { SessionType } from '../enums/session-type.enum';
import { SupervisionFailureCode } from '../enums/supervision-failure-code.enum';

/**
 * 单次督导反馈结构 (feedback json 字段 1:1 对应 counselor-mode-v1.0 §6.2).
 */
export interface SupervisionFeedbackPayload {
  /** 整体评分 0-100 */
  overallScore: number;
  /** 逐句标注 (sentence + score + comment) */
  perSentence: { sentence: string; score: number; comment: string }[];
  /** 错误分类汇总 (e.g. ['打断', '给建议', '过早诊断']) */
  errorCategories: string[];
  /** 成长建议 (1-3 短句) */
  growthSuggestion: string;

  /**
   * 失败标记 (V2026-10-27, spec 任务 D1 — **可空附加字段**).
   *
   * 非空 = 这份流派反馈**生成失败** (BullMQ 重试用尽 / 永久失败).
   * 存在的意义: 以前重试用尽后"什么都不留", 列表只能靠墙钟猜 → 学员盯着转圈;
   * 现在失败有据可查, 报告状态立刻翻成 `parse_error` 并带上原因码.
   *
   * 为什么落在 `feedback` json 而不是新增一列:
   *   - 任务单明确"落报告行/反馈记录的附加字段 (可空)" + "不新增列、不写 migration"
   *   - json 里加可空键对既有 1:1 wire **零破坏** (老数据没这个键 = null)
   *   - 成功态这条键恒为 null → 读方用 `failureCode != null` 判失败, 不会误伤成功记录
   */
  failureCode?: SupervisionFailureCode | null;

  /**
   * 失败原因详情 (可空, **仅供排查**, 不对外展示).
   *
   * 成功态恒为 null. 失败态存一句人类可读的成因 (如 "HTTP 429 限流"),
   * 便于运营在后台直接看出是上游限流还是模型返回格式不对.
   */
  failureMessage?: string | null;
}

/**
 * supervision_feedback 表.
 *
 * 跟 xin_su_app SupervisionFeedback entity 1:1 wire.
 * 1:N session (sessionId polymorphic, 跟 W1-2 LongTermCaseSession + V0.x TrainingSession 1:1 配对).
 */
@Entity('supervision_feedback')
@Index('uniq_sf_session_school', ['sessionId', 'sessionType', 'schoolId'], { unique: true })
@Index('idx_sf_user', ['userId'])
export class SupervisionFeedback {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  // V0.x: tenantId = userId (一人一租户, A9). V1.x 多租户上线后 backfill.
  @Column({ type: 'char', length: 36, name: 'tenant_id' })
  tenantId!: string;

  // 冗余存储 userId 加速按 user 聚合 (避免跨 polymorphic 表 join), V0.x knowledge-chunks 风格一致.
  @Column({ type: 'char', length: 36, name: 'user_id' })
  userId!: string;

  // Polymorphic FK: sessionId + sessionType 配对, 跟 W1-2 LongTermCaseSession +
  // V0.x TrainingSession 1:1 配对 (应用层按 sessionType 走对应 Repository).
  @Column({ type: 'char', length: 36, name: 'session_id' })
  sessionId!: string;

  @Column({ type: 'varchar', length: 40, name: 'session_type' })
  sessionType!: SessionType;

  // 应用层校验, 不写 DB-level FK (软删兼容, 跟 knowledge_chunks.itemId 同 pattern).
  @Column({ type: 'char', length: 36, name: 'school_id' })
  schoolId!: string;

  // 反馈内容 (跟 counselor-mode-v1.0 §6.2 1:1, 4 字段结构化 json).
  @Column({ type: 'json' })
  feedback!: SupervisionFeedbackPayload;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;

  // 软删, 跟 V3 其他模块一致.
  @Column({ type: 'datetime', name: 'deleted_at', nullable: true })
  deletedAt!: Date | null;
}
