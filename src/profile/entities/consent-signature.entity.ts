import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * 陪伴者知情同意书签字记录 entity — 陪伴者专属 (大厂企业级 V3).
 *
 * V2.0 §Tab4 知情同意书页 (陪伴者):
 *   - 6 章节文档 (服务边界 / 隐私保护 / 危机干预 / 资质培训 / 解除终止 / 签字生效)
 *   - 用户滚动到底部 → 勾选"已阅读并同意"→ 签字记录入库
 *
 * 字段:
 *   - documentVersion: 文档版本 (e.g. 'v1.0'), 后续版本升级时记录
 *   - signedAt: 签字时间
 *   - ipAddress / userAgent: 合规取证 (个保法 + GDPR 同意留痕)
 *   - scrolledToBottom: 是否真滚到底 (前端传 boolean, 防止跳过阅读)
 *
 * 大厂做法:
 *   - 1:N (uid, 多次重签历史), INDEX (uid, signed_at DESC)
 *   - 隐私: ip 走 UserService 现有 IP util 解析, 不暴露
 *   - 文档版本强校验: 后端当前 version 跟签字 version 不一致 → 提示重签
 *   - 软删由 users cascade
 */
@Entity('consent_signatures')
@Index('idx_consent_uid_signed', ['uid', 'signedAt'])
export class ConsentSignature {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** 关联 users.uid (陪伴者). */
  @Column({ type: 'char', length: 36, name: 'uid' })
  uid!: string;

  @Column({ type: 'varchar', length: 32, name: 'document_version' })
  documentVersion!: string;

  @Column({ type: 'datetime', name: 'signed_at' })
  signedAt!: Date;

  /** 是否真滚到底 (前端传 boolean, 防跳过阅读). */
  @Column({ type: 'boolean', default: true, name: 'scrolled_to_bottom' })
  scrolledToBottom!: boolean;

  @Column({ type: 'varchar', length: 64, name: 'ip_address', nullable: true })
  ipAddress!: string | null;

  @Column({ type: 'varchar', length: 512, name: 'user_agent', nullable: true })
  userAgent!: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}
