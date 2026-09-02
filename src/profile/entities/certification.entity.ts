import { Column, CreateDateColumn, Entity, JoinColumn, OneToOne, PrimaryColumn, UpdateDateColumn } from 'typeorm';

import { User } from '../../user/entities/user.entity';

/**
 * 陪伴者实名认证 entity — 1:1 关联 users (大厂企业级 V3).
 *
 * V2.0 §Tab4 实名认证 (陪伴者专属):
 *   - status: unverified / pending / verified / rejected
 *   - realName: 真实姓名 (加密存储, 严格保密)
 *   - idCardLast4: 身份证后 4 位 (业务展示用, 不存全号)
 *   - faceVerifiedAt: 人脸核验通过时间
 *   - submittedAt / reviewedAt: 提交 + 审核时间
 *   - rejectReason: 拒绝原因 (审核人员填)
 *
 * 大厂合规:
 *   - 真实姓名跟身份证用 RsaKeyService 加密 (跟 auth 字段一致, V2.0 已有)
 *   - 业务展示只暴露 last4 + 状态
 *   - 不存完整身份证号 (GDPR / 个保法 PII 最小化)
 *   - 审核流程 V3 接运营后台, V2.0 自动 verified (mock)
 *   - 修密 / 软删 / 真删时 row 跟着 users cascade 删除
 *
 * 设计选择: V2.0 简化 — 提交即 verified (不接实际审核),
 * V3 接人脸核验 + 人工审核后再改 verified 状态.
 */
@Entity('user_c_certifications')
export class Certification {
  @PrimaryColumn({ type: 'char', length: 36, name: 'uid' })
  uid!: string;

  @Column({ type: 'varchar', length: 16, name: 'status', default: 'unverified' })
  status!: 'unverified' | 'pending' | 'verified' | 'rejected';

  /** 真实姓名 (加密存储, V3 接入 RsaKeyService). V2.0 暂用明文. */
  @Column({ type: 'varchar', length: 64, name: 'real_name', nullable: true })
  realName!: string | null;

  /** 身份证后 4 位 (业务展示用, 不存全号). */
  @Column({ type: 'char', length: 4, name: 'id_card_last4', nullable: true })
  idCardLast4!: string | null;

  /** 人脸核验通过时间 (V3 接入). V2.0 占位 = status=verified 的时间. */
  @Column({ type: 'datetime', name: 'face_verified_at', nullable: true })
  faceVerifiedAt!: Date | null;

  @Column({ type: 'datetime', name: 'submitted_at', nullable: true })
  submittedAt!: Date | null;

  @Column({ type: 'datetime', name: 'reviewed_at', nullable: true })
  reviewedAt!: Date | null;

  @Column({ type: 'varchar', length: 255, name: 'reject_reason', nullable: true })
  rejectReason!: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;

  @OneToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'uid', referencedColumnName: 'uid' })
  user?: User;
}
