import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

/**
 * UserConsent entity — 使用协议 + 隐私条款同意记录 (大厂合规级 V3).
 *
 * 设计原则:
 *   - deviceId 主标识 (游客态也能记录, 符合个保法对游客态同样要求明示同意)
 *   - UNIQUE(deviceId, consentVersion, consentType) 幂等 (多次点击 / 网络重试不重复行)
 *   - consentVersion 字符串字段 (后端可强制升级, 触发客户端重弹 dialog)
 *   - appId 区分前端 (xin_su / mofang 共用同一服务, 隔离数据; 见 ARCHITECTURE)
 *   - 审计字段: ipAddress / userAgent / metadata (合规取证 + GDPR / 个保法 evidence)
 *   - userId 启动时为 NULL (游客态), 登录后由 bindToUser() 关联 (审计追溯完整链路)
 *
 * V3 启用场景:
 *   - 心塑 (xin_su) 《服务协议与隐私政策》首次启动同意
 *   - 后续心塑 / 魔方业务, 按 consentType 扩展 (e.g. 'data_export', 'ai_chat')
 */
@Entity('user_consents')
@Index('uq_user_consents_device_version_type', ['deviceId', 'consentVersion', 'consentType'], { unique: true })
@Index('idx_user_consents_user_id', ['userId'])
@Index('idx_user_consents_app_id', ['appId'])
@Index('idx_user_consents_accepted_at', ['acceptedAt'])
export class UserConsent {
  /** UUID 主键 */
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** 关联 users.uid (游客态 NULL, 登录后由 bindToUser 回填) */
  @Column({ type: 'char', length: 36, name: 'user_id', nullable: true })
  userId!: string | null;

  /** 设备指纹 (前端用 flutter_secure_storage 持久化的 UUIDv4) */
  @Column({ type: 'varchar', length: 128, name: 'device_id' })
  deviceId!: string;

  /** 协议版本 (e.g. 'v1.0'), 后端通过 config 升级时强制客户端重弹 */
  @Column({ type: 'varchar', length: 32, name: 'consent_version' })
  consentVersion!: string;

  /** 协议类型 (e.g. 'agreement+privacy', 'ai_chat', 'data_export') */
  @Column({ type: 'varchar', length: 64, name: 'consent_type' })
  consentType!: string;

  /** 平台 (android / ios / web / windows / macos / linux) */
  @Column({ type: 'varchar', length: 32 })
  platform!: string;

  /** 应用 ID (xin_su / mofang), 共用后台时区分数据 */
  @Column({ type: 'varchar', length: 64, name: 'app_id' })
  appId!: string;

  /** 首次同意时间 (幂等写入时保留首次) */
  @CreateDateColumn({ name: 'accepted_at', type: 'datetime', precision: 6 })
  acceptedAt!: Date;

  /** 最近一次 update (幂等写入时刷新 IP/UA/metadata) */
  @UpdateDateColumn({ name: 'updated_at', type: 'datetime', precision: 6 })
  updatedAt!: Date;

  /** 客户端 IP (审计) */
  @Column({ type: 'varchar', length: 64, name: 'ip_address', nullable: true })
  ipAddress!: string | null;

  /** 原始 User-Agent (审计) */
  @Column({ type: 'varchar', length: 512, name: 'user_agent', nullable: true })
  userAgent!: string | null;

  /** 客户端 metadata (浏览器语言 / 屏幕尺寸 / 设备型号, 灵活 JSON) */
  @Column({ type: 'json', nullable: true })
  metadata!: Record<string, unknown> | null;
}
