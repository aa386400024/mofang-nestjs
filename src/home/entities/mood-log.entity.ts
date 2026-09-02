import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

import type { HomeEmotionLevel } from '../home.constants';

/**
 * 心塑首页情绪打卡 — 单次「你现在的感受更接近哪一个?」选择.
 *
 * 设计要点 (DESIGN.md V2.0 §3):
 *   - 无评分: 没有「昨天 8 分今天 5 分」排名压迫
 *   - 无强制: 允许多次记录, 允许多次改主意
 *   - 时段化: 每条记录带时间戳, 用于推荐匹配 + 陪伴者端曲线 (L2+ 可见)
 *
 * 大厂做法:
 *   - INDEX (uid, created_at) — 首页「今日记录」查询
 *   - INDEX (uid, created_at DESC) — 历史曲线
 *   - 不存 ip / ua (合规: 心理健康数据最小必要)
 *   - 真删由 users.deleted_at cascade 触发, 软删不走这条线
 */
@Entity('mood_logs')
@Index('idx_mood_logs_uid_created_at', ['uid', 'createdAt'])
export class MoodLog {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'char', length: 36, name: 'uid' })
  uid!: string;

  /** 4 档枚举: great / okay / low / crisis. */
  @Column({ type: 'varchar', length: 16, name: 'level' })
  level!: HomeEmotionLevel;

  /** 用户可选备注 (DESIGN §1.5「下拉页面触发轻量快速情绪记录」). */
  @Column({ type: 'varchar', length: 280, name: 'note', nullable: true })
  note!: string | null;

  /** 触发自动弹出的微干预 id (例如选了 crisis 自动推「2 分钟平稳呼吸」). */
  @Column({ type: 'varchar', length: 64, name: 'triggered_micro_intervention_id', nullable: true })
  triggeredMicroInterventionId!: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}
