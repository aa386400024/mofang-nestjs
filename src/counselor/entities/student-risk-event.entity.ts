// V2026-11-02 治本 (WP14 · 学员心理风险事件审计表 entity):
//   原因: 任务单 `docs/progress/engine-wp14-student-risk-disposal-backend-2026-11-02.md`
//     §1.2 —— 检测层 (WP4/WP9-C/WP11) 已经能判出"学员这句话命中了危机类别",
//     但**判出来之后没有任何留痕**: 谁、在哪一场、第几轮、判成什么、怎么处置的,
//     全都查不到. 平台有安全保障义务, 这张表就是那份义务的证据.
//   边界: **append-only 审计表** —— 只增不改不删 (唯一例外见 `userChoice`).
//
//   为什么与仓库既有 entity 模板**故意不一样** (别的表都有 updated_at / deleted_at):
//     审计表的价值恰恰在于"不可篡改". 给了软删列, 就会出现"这条风险记录被删了"
//     这种查不到事实 —— 那比没有表更糟. 所以本表:
//       · **没有** `updated_at` (无修改时间);
//       · **没有** `deleted_at` (无软删);
//       · 只有 `created_at` 一个时间字段.
//     唯一的例外是 `user_choice`: 学员点完 modal 后的选择要**回写**到原来那一行
//     (它是"用户主动反馈", 不是"审计篡改") —— 任务单 §1.3 已拍板允许这一列 update.
//
//   隐私口径:
//     · `snippet` 只存**截断 200 字**的命中片段, 不存完整对话原文;
//     · 表**不对学员端 API 暴露** (只给 admin / 督导).
//
//   id 用 bigint auto_increment (不是 uuid): 审计表是**追加流**, 自增主键天然按写入顺序,
//     也不需要"跨服务唯一" —— 这是与仓库其它业务表不同的取舍.
//
//   验证:
//     1. tsc 0 错
//     2. 大炮跑 migration:run 后 SHOW CREATE TABLE student_risk_events → 无 updated_at / deleted_at
//   时间戳: 2026-11-02

import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * 风险等级 (审计口径; 内测期实际只写 medium / high).
 *
 * 与内核 `SafetyLevel` (pass/warn/block) 的对应:
 *   warn  → medium (轻提示, 不阻断); block → high (阻断 + 全屏弹窗).
 */
export type StudentRiskEventLevel = 'low' | 'medium' | 'high';

/**
 * 判定来源 (审计口径).
 *
 *   rule       = 内核规则层判的 (专业越界类; 危机处置不会走这一路);
 *   psyguard   = 独立仓库的 PsyGUARD Python 服务判的;
 *   local_dict = 本地词典判的 (远端服务不可用时的兜底).
 */
export type StudentRiskEventSource = 'rule' | 'psyguard' | 'local_dict';

/**
 * 对用户采取的动作.
 *
 *   silent = 只记录不提示 (本期不写; 保留是为了审计口径完整);
 *   toast  = 轻提示 (warn 级);
 *   modal  = 全屏弹窗 + 阻断本轮 (block 级).
 */
export type StudentRiskEventAction = 'silent' | 'toast' | 'modal';

/**
 * 学员在 modal 后的选择 (可空 = 还没选 / 不适用).
 */
export type StudentRiskUserChoice = 'phone' | 'continue' | 'dismissed';

/**
 * 学员心理风险事件 (append-only 审计表).
 */
@Entity('student_risk_events')
@Index('idx_sre_session', ['sessionId'])
@Index('idx_sre_user', ['userId'])
export class StudentRiskEvent {
  /**
   * 自增主键 (append-only 流的天然顺序).
   *
   * MySQL 的 bigint 经驱动返回是**字符串** —— 这里照实声明, 不假装是 number.
   */
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id!: string;

  /** 关联训练会话 id (training_sessions.id). */
  @Column({ type: 'varchar', length: 64, name: 'session_id' })
  sessionId!: string;

  /**
   * 学员 id (users.uid).
   *
   * ⚠️ 任务单写的是 bigint, 本仓实际是 **uuid (varchar 36)** —— 跟着仓库走,
   * 否则写进去的是一串数字, 跟 training_sessions.user_id 对不上.
   */
  @Column({ type: 'varchar', length: 36, name: 'user_id' })
  userId!: string;

  /** 触发轮次 (从 1 起). */
  @Column({ type: 'int', name: 'turn_index' })
  turnIndex!: number;

  /** 风险等级. */
  @Column({ type: 'enum', enum: ['low', 'medium', 'high'], name: 'level' })
  level!: StudentRiskEventLevel;

  /** 命中类别 (内核 SafetyCategory 口径, 如 passive_ideation / active_ideation). */
  @Column({ type: 'varchar', length: 64, name: 'category' })
  category!: string;

  /**
   * 命中片段 (截断 200 字; **不存完整对话原文**).
   */
  @Column({ type: 'varchar', length: 200, name: 'snippet' })
  snippet!: string;

  /** 判定来源. */
  @Column({ type: 'enum', enum: ['rule', 'psyguard', 'local_dict'], name: 'source' })
  source!: StudentRiskEventSource;

  /** 对用户采取的动作. */
  @Column({ type: 'enum', enum: ['silent', 'toast', 'modal'], name: 'action_taken' })
  actionTaken!: StudentRiskEventAction;

  /**
   * 学员在弹窗后的选择 (可空).
   *
   * 唯一允许 update 的字段 (任务单 §1.3 拍板): 它是**用户主动反馈**,
   * 不是"事后篡改审计" —— 记成"用户点了哪个按钮"才有意义.
   */
  @Column({ type: 'enum', enum: ['phone', 'continue', 'dismissed'], name: 'user_choice', nullable: true })
  userChoice!: StudentRiskUserChoice | null;

  /** 本场后续是否进入重点监测 (high 事件后为 true). */
  @Column({ type: 'boolean', name: 'monitored_after' })
  monitoredAfter!: boolean;

  /** 督导 / admin 复核人 id (null = 未复核). */
  @Column({ type: 'varchar', length: 36, name: 'reviewed_by', nullable: true })
  reviewedBy!: string | null;

  /**
   * 写入时刻.
   *
   * 本表**只有**这一个时间字段 —— 没有 updated_at (append-only).
   */
  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}
