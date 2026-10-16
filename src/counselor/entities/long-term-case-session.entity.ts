// V2026-10-15 治本 (V1.1 — long_term_case_sessions entity):
//   原因: counselor-mode-v1.0 §6.1 设计 long_term_case_sessions 表, V0.3 §13 baseline 0
//     长程会话语义, 1:1 wire 0 破坏. 跟 V0.x TrainingSession (单次) 区别: 长程 1:N 次会话
//     有 sessionNumber 序号, nextSessionContext 跨会话 memory 字段.
//
//   修法 (跟 knowledge-chunk.entity.ts V0.x 风格一致):
//     - UUID PK + char(36) id (跟 long_term_cases.id 1:1)
//     - tenantId + caseId 双索引 (V0.x 多租户 + 1:N 软删兼容, 走应用层校验不加 DB-level FK)
//     - sessionNumber int 1-based, 跟 (caseId, sessionNumber) UNIQUE 约束
//     - transcript json 字段 (跟 V0.x TrainingSession.transcript 风格一致, 数组结构)
//     - supervisionFeedback json nullable (V1.x W3-4 多流派督导接)
//     - overallScore int 0-100 nullable (本次会话督导总分)
//     - nextSessionContext json nullable (🆕 V1.2 跨会话 agent memory, 5 字段结构化)
//     - durationSeconds int (本次会话时长, UI 进度用)
//     - 软删 deletedAt (跟 V3 其他模块一致)
//
//   反双胞胎:
//     - 不复用 V0.x TrainingSession: 长程有跨会话 memory 字段, 单次没有, 1:1 wire 混淆
//       会破坏 V0.x baseline, 单独建 entity
//     - 不引 vector store for nextSessionContext: V1.x JSONB 存结构化 5 字段, V2.x
//       再切 RAG (跟 knowledge_chunks V0.x → V1.x Qdrant 升级同 pattern, 不在 V1.1 范围)
//     - 不存完整 transcript 副本: transcript 字段已有, nextSessionContext 是 LLM 摘要
//       (跟 supervisionReport json 字段同 pattern, 摘要 + 原始数据分离)
//     - 不加 DB-level FK (软删兼容, 应用层校验, 跟 knowledge_chunks.itemId 同 pattern)
//
//   验证:
//     1. tsc 0 错
//     2. pnpm migration:run 后 SHOW INDEX FROM long_term_case_sessions; 3 索引
//     3. UNIQUE (caseId, sessionNumber) 验证: 同 caseId 重复 sessionNumber 报 DUP_ENTRY
//
//   时间戳: 2026-10-15

import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

import { LongTermCase } from './long-term-case.entity';

/**
 * 单次会话的转录 (跟 V0.x TrainingSession.transcript 1:1 风格).
 * 数组结构, 每个元素 1 轮对话.
 */
export interface SessionTranscriptTurn {
  role: 'counselor' | 'visitor';
  content: string;
  /** 毫秒级时间戳, 跟录音对齐用 */
  ts: number;
}

/**
 * 🆕 V1.2 跨会话 agent memory (nextSessionContext).
 * 5 字段结构化 JSON, 由 LLM 在本次 session 结束时生成, 下次 session 启动时
 * 作为 system prompt context 注入, 实现 4-12 次长程一致性.
 *
 * 字段语义:
 *   - currentEmotion: 来访者当前主导情绪 (0.0-1.0 + 文本标签, 跨会话累积变化)
 *   - topic: 本次核心议题 (1-3 短句, 跨会话累积演进)
 *   - usedTechniques: 咨询师已用技术 (数组, 跨会话反查防重复)
 *   - counselorStrengths: 咨询师表现亮点 (1-3 短句, 督导正面反馈)
 *   - counselorWeaknesses: 咨询师待改进 (1-3 短句, 督导负面反馈)
 */
export interface NextSessionContext {
  currentEmotion: { score: number; label: string };
  topic: string[];
  usedTechniques: string[];
  counselorStrengths: string[];
  counselorWeaknesses: string[];
}

@Entity('long_term_case_sessions')
@Index('uniq_ltcs_case_session', ['caseId', 'sessionNumber'], { unique: true })
@Index('idx_ltcs_tenant_case', ['tenantId', 'caseId'])
export class LongTermCaseSession {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  // V0.x 多租户: tenantId = userId (一人一租户, A9). char(36) 跟 long_term_cases 1:1.
  @Column({ type: 'char', length: 36, name: 'tenant_id' })
  tenantId!: string;

  // 1:N 关系, 走应用层校验, 不写 DB-level FK (软删兼容, 跟 knowledge_chunks.itemId 同 pattern).
  @Column({ type: 'char', length: 36, name: 'case_id' })
  caseId!: string;

  // 1-based 序号, 跟 UNIQUE (case_id, session_number) 配对, 1:1 wire 防重复.
  @Column({ type: 'int', name: 'session_number' })
  sessionNumber!: number;

  // 本次会话转录 (跟 V0.x TrainingSession.transcript 1:1 风格).
  @Column({ type: 'json' })
  transcript!: SessionTranscriptTurn[];

  // V1.x W3-4 多流派督导接 (V0.5 已有 6 维度, V1.x 加 4 流派视角).
  // V1.1 阶段 nullable, 等 W3-4 写 supervision_feedback entity 后填.
  @Column({ type: 'json', name: 'supervision_feedback', nullable: true })
  supervisionFeedback!: object | null;

  // 本次会话督导总分 0-100, nullable (W3-4 接后填).
  @Column({ type: 'int', name: 'overall_score', nullable: true })
  overallScore!: number | null;

  /**
   * 🆕 V1.2 跨会话 agent memory (nextSessionContext).
   * 由本次 session 完成时 LLM 生成, 下次 session 启动时作为 system prompt context 注入.
   * 简化 (V0.x 阶段): JSONB 5 字段结构化, V2.x 升级 RAG 时再切.
   * nullable: 第一次 session (N=1) 没有上一次 context, 留 null.
   */
  @Column({ type: 'json', name: 'next_session_context', nullable: true })
  nextSessionContext!: NextSessionContext | null;

  // 本次会话时长 (秒), UI 进度条用, 跟 V0.x TrainingSession.durationSeconds 同 pattern.
  @Column({ type: 'int', name: 'duration_seconds', default: 0 })
  durationSeconds!: number;

  // 1:N 反向引用 (应用层校验, 跟 long_term_cases.sessions 对应).
  // V0.5: 不用 @ManyToOne eager / cascade, 显式 service 层 query, 防 N+1.
  @ManyToOne(() => LongTermCase, (longTermCase) => longTermCase.sessions, { createForeignKeyConstraints: false })
  @JoinColumn({ name: 'case_id', referencedColumnName: 'id' })
  caseRef?: LongTermCase;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;

  // 软删, 跟 V3 其他模块一致.
  @Column({ type: 'datetime', name: 'deleted_at', nullable: true })
  deletedAt!: Date | null;
}
