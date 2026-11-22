import { Column, Entity, Index, PrimaryColumn, UpdateDateColumn } from 'typeorm';

/**
 * 心理健身房 — 用户当前训练计划 (1:1 with users).
 *
 * V2.0 §Tab2 分类7 心理健身房 + 进阶地图.
 *
 * 设计:
 *   - 1 行/用户 (uid PK), weeklyPlans JSON 字段存 12 周进阶地图
 *   - completedThisWeek 走 DB 原子字段, 写完练习时 +1 (大厂 dashboard standard)
 *   - totalCompleted / totalMinutes 走单独聚合查询 (Dashboard module 已有),
 *     这里只存"本周"快照, 避免 dashboard 与 practice 互相耦合
 *
 * 反双胞胎:
 *   - 不重复 dashboard 模块的聚合逻辑; 本 entity 只存"用户当前 plan 静态结构"
 */
@Entity('gym_current_plans')
@Index('idx_gym_current_plans_uid_stage', ['uid', 'stage'])
export class GymCurrentPlan {
  @PrimaryColumn({ type: 'char', length: 36, name: 'uid' })
  uid!: string;

  @Column({ type: 'varchar', length: 16, name: 'stage', default: 'foundation' })
  stage!: 'foundation' | 'intermediate' | 'advanced';

  @Column({ type: 'int', name: 'completed_this_week', default: 0 })
  completedThisWeek!: number;

  @Column({ type: 'int', name: 'weekly_target', default: 5 })
  weeklyTarget!: number;

  @Column({ type: 'simple-json', name: 'weekly_plans' })
  weeklyPlans!: {
    weekNumber: number;
    stage: 'foundation' | 'intermediate' | 'advanced';
    module: string;
    title: string;
    goals: string[];
    tools: string[];
  }[];

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
