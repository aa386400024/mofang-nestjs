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
  currentRole!: Role;

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

/**
 * V2026-10-08 治本 (V6.1 §1 — 心理咨询师学员端后端枚举同步):
 *   前端 role switch sheet 切换 /profile/me/current-role 传 'counselor_learner'
 *   被后端 @IsIn(['growth_user', 'companion']) 拒绝, 返 400 + code 1000.
 *   根因: 前端加了 enum value + 9 个 switch + UserRoleMeta.all + DI 路由, 但后端
 *         验证器 + entity TS 字面量 + service 函数签名都没同步.
 *
 *   治本: 跟 GenderValues / OccupationValues 同模式抽常量 (单一真理源, 改一处全 3
 *   处跟着变), 后端 3 处硬编码:
 *     - profile.dto.ts line 95-96 SwitchRoleDto @IsIn()
 *     - profile.dto.ts line 46 ProfileDto ApiProperty enum
 *     - profile.service.ts line 96 switchRole 函数签名
 *
 *   schema 设计: current_role varchar(32) (entity line 44) 已能容纳 'counselor_learner'
 *   (16 字符), 不需要 migration — 这是治本要点, 不要因此推 schema migration.
 *
 *   反双胞胎:
 *     - 不后端枚举值改成中文 (咨重心理): 数据库 v-模型交叉取数/开发者 trace 反而难查,
 *       跟前端 snake_case 不一致 (前端用的是 counselor_learner), 反双胞胎硬约束.
 *     - 不改 entity varchar 长度 (未来加 3 个角色还能装下 32, 不提前扩, YAGNI).
 */
export const RoleValues = ['growth_user', 'companion', 'counselor_learner'] as const;

/**
 * Role TS 类型 — 从 RoleValues 推导 (跟 Gender 同模式, 加新角色只改上面 const 即可).
 */
export type Role = (typeof RoleValues)[number];
