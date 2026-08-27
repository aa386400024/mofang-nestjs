import { Column, CreateDateColumn, Entity, JoinColumn, OneToOne, PrimaryColumn, UpdateDateColumn } from 'typeorm';

import { User } from '../../user/entities/user.entity';

/**
 * 用户画像 entity — 1:1 关联 users (大厂企业级 V3).
 *
 * 设计要点:
 *   - 1:1 with users.uid (PK + FK 同列, 避免冗余)
 *   - 业务数据跟账号系统分离: 用户表只放账号, 业务表放画像
 *   - 所有字段都可空 (心塑 V2.0 设计: 所有信息非必填)
 *   - currentRole 决定「我的」Tab 双角色视图
 *   - Soft delete 跟用户表 (依赖 users.deleted_at, 不再单独存)
 *
 * 字段映射 (V2.0 设计文档 §Tab4 我的):
 *   - nickname: 昵称 (20 字内, 前端限长)
 *   - avatarUrl: 头像 URL (OSS / CDN, V2.0 当前后端不接 OSS, 用 placeholder)
 *   - birthDate: 出生日期 (DATE, 隐私敏感, 仅本人可见)
 *   - gender: 性别 (female / male / undisclosed, 不公开非二元)
 *   - occupation: 职业 (枚举字符串, V2.0 给 6 个选项)
 *   - currentRole: 当前激活角色 (persisted, 下次启动默认进上次激活的角色)
 */
@Entity('user_profiles')
export class UserProfile {
  /** UUID 主键, 同时是 FK 到 users.uid */
  @PrimaryColumn({ type: 'char', length: 36, name: 'uid' })
  uid!: string;

  @Column({ type: 'varchar', length: 20, name: 'nickname', nullable: true })
  nickname!: string | null;

  @Column({ type: 'varchar', length: 512, name: 'avatar_url', nullable: true })
  avatarUrl!: string | null;

  @Column({ type: 'date', name: 'birth_date', nullable: true })
  birthDate!: string | null;

  @Column({ type: 'varchar', length: 16, name: 'gender', nullable: true })
  gender!: 'female' | 'male' | 'undisclosed' | null;

  @Column({ type: 'varchar', length: 64, name: 'occupation', nullable: true })
  occupation!: string | null;

  @Column({ type: 'varchar', length: 32, name: 'current_role', default: 'growth_user' })
  currentRole!: 'growth_user' | 'companion';

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;

  /** 关联 users.uid (FK + 1:1). */
  @OneToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'uid', referencedColumnName: 'uid' })
  user?: User;
}

/**
 * 性别枚举 — 跟前端 UserRole 命名一致 (V2.0 §Tab4).
 * 大厂: 'undisclosed' 而不是 'private', 文案更中性.
 */
export const GenderValues = ['female', 'male', 'undisclosed'] as const;

/**
 * 职业枚举 — V2.0 §Tab4 个人资料编辑.
 */
export const OccupationValues = ['学生', '职场新人', '管理层', '自由职业', '全职父母', '其他'] as const;
