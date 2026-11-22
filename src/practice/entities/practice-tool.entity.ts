import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

/**
 * Practice 工具元数据 entity — V2.0 §Tab2 练习工具库.
 *
 * 设计:
 *   - 全局唯一 id 用 string (例: 'emergency.5-4-3-2-1'), 跟前端 entity 1:1
 *   - categoryId 走 enum (PracticeCategoryKey), 保证枚举收敛, 避免拼写漂移
 *   - difficulty 1-3, evidenceLevel 走 enum (CBT/ACT/DBT/Mindfulness/Growth/Embodied)
 *   - hasFunMode 区分"经典 / 趣味"模式 (V3.0 设计手册 §1.8)
 *   - unlockHint nullable — locked 状态下展示解锁条件
 *
 * V2.0 sample: 30 行工具预置数据 + TypeORM 建表就绪, V3 接 LLM 个性化推荐时
 *   加上 user-tool-progress (用户-工具进度关联表).
 */
@Entity('practice_tools')
@Index('idx_practice_tools_category', ['categoryId'])
export class PracticeTool {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 64, name: 'tool_key' })
  toolKey!: string;

  @Column({ type: 'varchar', length: 32, name: 'category_id' })
  categoryId!: string;

  @Column({ type: 'varchar', length: 80, name: 'title' })
  title!: string;

  @Column({ type: 'varchar', length: 200, name: 'subtitle', nullable: true })
  subtitle!: string | null;

  @Column({ type: 'text', name: 'description' })
  description!: string;

  @Column({ type: 'varchar', length: 64, name: 'icon_key' })
  iconKey!: string;

  @Column({ type: 'tinyint', name: 'duration_minutes' })
  durationMinutes!: number;

  @Column({ type: 'tinyint', name: 'difficulty' })
  difficulty!: number;

  @Column({ type: 'varchar', length: 32, name: 'evidence_level' })
  evidenceLevel!: string;

  @Column({ type: 'varchar', length: 200, name: 'route_path' })
  routePath!: string;

  @Column({ type: 'simple-json', name: 'tags', nullable: true })
  tags!: string[] | null;

  @Column({ type: 'boolean', name: 'has_fun_mode', default: false })
  hasFunMode!: boolean;

  @Column({ type: 'varchar', length: 200, name: 'unlock_hint', nullable: true })
  unlockHint!: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
