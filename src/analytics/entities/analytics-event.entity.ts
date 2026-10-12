// V2026-10-12 (Phase 8.3 — Analytics 事件日志 / SPEC §12.5):
//   analytics_events 表 — 业务事件追踪 (KB 5 workflow action + 2 schedule action),
//   server 端聚合用, 跟客户端 7.8 AnalyticsOverview 4 KPI 严格对应.
//
//   大厂 spec (跟 src/ai-engine/entities/ai-effect-record.entity.ts 同 pattern):
//     - UUID PK + char(36) 风格
//     - 复合 index (tenantId, eventType, createdAt) 覆盖高频聚合查询
//     - eventType enum 列 (跟 wire 字符串严格对齐)
//     - metadata json (V0.x 简单, 后续可加 chunk 关联, RAG 来源等)
//
//   治本:
//     - 不存 denormalized 聚合数据 (V0.x 后端实时聚合 SQL, V1.x 接 OLAP
//       / ClickHouse 物化视图再切), 跟 client 7.8 AnalyticsOverview.fromJson
//       字段严格一致.
//     - 不放系统级事件 (e.g. cron fire), 走单独 ops 表 (V1.x 扩).

import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * 业务事件类型 — 跟客户端 7.8 AnalyticsPage 4 KPI 计算逻辑严格对应.
 *
 * - KbPublished        计数 → KPI 1 (KB 发布量)
 * - DraftSubmitted     分母 → KPI 2 (草稿→发布转化率)
 * - ReviewApproved     分子 → KPI 2
 * - KbArchived         (V0.x 占位, 4 KPI 不直接用)
 * - KbRestored         (V0.x 占位)
 * - KbScheduled        分母 → KPI 4 (排期发布占比)
 * - KbScheduleFired    分子 → KPI 4 (实际到点发布的 item)
 */
export enum AnalyticsEventType {
  KbPublished = 'KB_PUBLISHED',
  DraftSubmitted = 'DRAFT_SUBMITTED',
  ReviewApproved = 'REVIEW_APPROVED',
  KbArchived = 'KB_ARCHIVED',
  KbRestored = 'KB_RESTORED',
  KbScheduled = 'KB_SCHEDULED',
  KbScheduleFired = 'KB_SCHEDULE_FIRED',
}

/**
 * analytics_events 表.
 */
@Entity('analytics_events')
@Index('idx_analytics_tenant_event_created', ['tenantId', 'eventType', 'createdAt'])
@Index('idx_analytics_tenant_item', ['tenantId', 'itemId'])
export class AnalyticsEvent {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'char', length: 36, name: 'tenant_id' })
  tenantId!: string;

  @Column({ type: 'enum', enum: AnalyticsEventType, name: 'event_type' })
  eventType!: AnalyticsEventType;

  // 关联 KB item (nullable: 跟 V0.x 后续系统级事件兼容, V1.x 强制非空)
  @Column({ type: 'char', length: 36, name: 'item_id', nullable: true })
  itemId!: string | null;

  // 触发事件的 user (nullable: cron fire 时无 user)
  @Column({ type: 'char', length: 36, name: 'user_id', nullable: true })
  userId!: string | null;

  // 上下文透传 (e.g. { fromStatus, toStatus, comment })
  @Column({ type: 'json', nullable: true })
  metadata!: Record<string, unknown> | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}
