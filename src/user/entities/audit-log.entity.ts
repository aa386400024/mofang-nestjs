import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

import type { AuditEvent } from '../enums/audit-event.enum.js';
/**
 * Audit log entity — 用户鉴权事件日志 (大厂合规要求).
 *
 * 设计原则:
 *   - append-only, 不允许 update / delete (用 DB 权限约束)
 *   - 记录 userId + event + ip + ua + metadata
 *   - V2 写走 BullMQ 队列 (异步), 不阻塞主流程
 *   - 合规要求: 保留至少 90 天 (GDPR/SOC2)
 *
 * 索引优化:
 *   - idx_user_id: 按用户查历史
 *   - idx_event_created: 按事件 + 时间窗口查 (e.g. 最近 1 小时登录失败次数)
 *   - idx_created_at: 范围扫描 / 清理老数据
 */
@Entity('user_audit_logs')
@Index('idx_user_id', ['userId'])
@Index('idx_event_created', ['event', 'createdAt'])
@Index('idx_created_at', ['createdAt'])
export class AuditLog {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** 关联 User.uid (nullable: 登录失败时可能 userId 未知) */
  @Column({ type: 'varchar', length: 36, name: 'user_id', nullable: true })
  userId!: string | null;

  /** 事件类型 */
  @Column({ type: 'varchar', length: 64 })
  event!: AuditEvent;

  /** IP 地址 */
  @Column({ type: 'varchar', length: 64, name: 'ip_address', nullable: true })
  ipAddress!: string | null;

  /** User-Agent */
  @Column({ type: 'varchar', length: 512, name: 'user_agent', nullable: true })
  userAgent!: string | null;

  /** 附加元数据 (JSON: 失败原因、device 信息等) */
  @Column({ type: 'text', nullable: true })
  metadata!: string | null;

  /** 是否成功 (false 通常意味着安全事件, 需风控关注) */
  @Column({ type: 'boolean', default: true, name: 'is_success' })
  isSuccess!: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}
