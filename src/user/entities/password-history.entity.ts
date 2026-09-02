import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';

import { User } from './user.entity';

/**
 * Password history entity — 密码历史 (大厂安全合规).
 *
 * 设计:
 *   - 每次改密保留最近 N 条 hash (默认 5)
 *   - 改密时检查新密码 hash 不在历史里 (防复用)
 *   - 历史只保留 hash, 不存明文 (合规)
 *   - 软删用户时 cascade 删历史 (GDPR 友好)
 *
 * 大厂做法:
 *   - 不存明文, 只存 bcrypt hash (跟 user.password_hash 一样安全)
 *   - 不存"密码提示"或"上次修改时间"等元数据, 减少暴露面
 *   - 老历史定期清理 (cron 保留最近 N 条即可, V3 加)
 *
 * 性能:
 *   - 单用户最多 5 条, 索引 user_id 足够
 *   - 改密检查: SELECT WHERE user_id = ? ORDER BY created_at DESC LIMIT N
 */
@Entity('user_password_history')
@Index('idx_user_id', ['userId'])
@Index('idx_user_created', ['userId', 'createdAt'])
export class PasswordHistory {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** 关联 User.uid */
  @Column({ type: 'varchar', length: 36, name: 'user_id' })
  userId!: string;

  /** 历史密码 hash (bcrypt) */
  @Column({ type: 'varchar', length: 255, name: 'password_hash' })
  passwordHash!: string;

  /** 何时废弃 (改成此密码的时间, 即"现在的新密码覆盖了它") */
  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  /** 关联 (不预加载) */
  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id', referencedColumnName: 'uid' })
  user?: User;
}
