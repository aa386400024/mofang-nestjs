// V2026-10-09 治本 (SupervisionReport 实体 — SPEC §11.2):
//   角色: 督导报告持久化行, V0.x 内存 mock (entity 仍按 TypeORM 装饰器写, V1.x 一键切 DB)
//   字段对齐: SupervisionReportRow (supervisor.types.ts) + 索引 + 审计时间
//   多租户: tenantId 隔离, V0.x 兜底 'default'
//   状态: status (completed / parse_error) 区分有效报告和解析失败占位
//   关联: sessionId 索引便于按 session 查询历史报告 (V0.x 不强 FK, V1.x 接 voice_sessions 表)
//
//   反双胞胎:
//     - 不用 JSONB 整行存 dimensions/annotations/errorPatterns — 字段化便于 Admin 后台查询 + 索引
//     - 不用 MongoDB schema — 项目统一 MySQL + TypeORM (跟 Persona 一致)
//     - 不存 LLM 输入 transcript — 大文本, 督导报告只存"分析结果", 输入由 Visitor / V1.x SessionMemory 负责
//     - 不加 @ManyToOne('Persona') — V0.x 不接 DB, persona snapshot 4 字段冗余已够
//
//   如何验证:
//     1. pnpm build 无 type error
//     2. V1.x 切 TypeORM 时, column name 一一对应 (session_id / overall_score / ...) 无需大改
//     3. supervision_reports 表存在, status 枚举值只允许 'completed' | 'parse_error'

import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

import type { SupervisionAnnotation, SupervisionDimensions, SupervisorReportStatus } from '../../supervisor.types';

/** 实体类型 — V0.x 内存 mock 也用同形状, V1.x 切 TypeORM 字段一一对应. */
@Entity('supervision_reports')
@Index('idx_supervision_tenant_session', ['tenantId', 'sessionId'])
@Index('idx_supervision_status_created', ['status', 'createdAt'])
export class SupervisionReportEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 64, name: 'tenant_id', default: 'default' })
  tenantId!: string;

  @Column({ type: 'varchar', length: 128, name: 'session_id' })
  sessionId!: string;

  @Column({ type: 'varchar', length: 128, name: 'user_id' })
  userId!: string;

  /** persona snapshot id — 锁定督导报告生成时的来访者画像, V1.x 不强 FK. */
  @Column({ type: 'varchar', length: 64, name: 'persona_id' })
  personaId!: string;

  /** persona 名字, 展示冗余, 防 V1.x persona 重命名影响历史报告. */
  @Column({ type: 'varchar', length: 80, name: 'persona_name' })
  personaName!: string;

  /** 难度 (L1 / L2 / L3), 展示冗余. */
  @Column({ type: 'varchar', length: 8, name: 'difficulty' })
  difficulty!: string;

  /** 报告状态. */
  @Column({ type: 'varchar', length: 16, name: 'status' })
  status!: SupervisorReportStatus;

  @Column({ type: 'int', name: 'overall_score' })
  overallScore!: number;

  /** 六维评分, JSON 字段, 整体写入/读取. */
  @Column({ type: 'json', name: 'dimensions' })
  dimensions!: SupervisionDimensions;

  /** 标注列表, JSON 字段. */
  @Column({ type: 'json', name: 'annotations' })
  annotations!: readonly SupervisionAnnotation[];

  /** 错误模式, JSON 字段. */
  @Column({ type: 'json', name: 'error_patterns' })
  errorPatterns!: readonly string[];

  /** 成长建议, JSON 字段. */
  @Column({ type: 'json', name: 'growth_suggestions' })
  growthSuggestions!: readonly string[];

  /** LLM 原始 JSON 文本, parse 失败时存原文便于 V1.x debug + re-parse. */
  @Column({ type: 'text', name: 'raw_response' })
  rawResponse!: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}
