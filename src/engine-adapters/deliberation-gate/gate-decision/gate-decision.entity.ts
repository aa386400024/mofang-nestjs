// V2026-11-09 治本 (Phase2.5 闸门 trace 查询接口 · gate_decisions 表实体):
//   职责: 承载 gate_decisions 表 —— 每条闸门决策一行, 长期可查、可统计、可复盘.
//   边界: 只描述表结构与列语义; 零业务逻辑.
//
//   为什么要有这张表 (WP-C 只写 Redis 的三个问题):
//     ① Redis 7 天 TTL + LRU 淘汰 → 复盘时数据没了 (灰度期调阈值正需要"回头看");
//     ② Redis 里是"每轮一个 key", 要列全部只能 SCAN 全库 (生产阻塞命令);
//     ③ 会话 id 双口径 (引擎侧 sessionId / 落库 dbSessionId) 在 Redis key 里根本表达不了.
//   于是: **MySQL 是真相源**, Redis 只做 7 天热缓存 + 写时预聚合计数.
//
//   ⚠️ **本表只存枚举 / 数值 / id** —— 零对话原文, 零心理画像 (delta 是状态数值, 与审议 trace 同一档).
//     隐私红线 (AGENTS.md §5.4) 对这张表同样成立.
//
//   反双胞胎 (与 eval_reports / turn_delta_audits 同款纪律):
//     - **不加 DB-level FK**: 跟 ADR-0003 一致, 跨表引用应用层校验;
//     - **不做软删**: 闸门决策是审计数据, 删了就等于让"当时为什么没跑"永远查不到;
//     - **手写 DDL 建表**: schema 只走 migration (ADR-0003), 禁用 synchronize.
//
//   验证 (大炮跑 pnpm migration:run 后):
//     1. SHOW CREATE TABLE gate_decisions;
//     2. 连跑两次 migration:run → 第二次不报错 (幂等)
//
//   时间戳: 2026-11-09

import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

import type { GateThresholds } from '../deliberation-gate.types.js';

/**
 * gate_decisions 表 —— 一条闸门决策 = 一行.
 */
@Entity('gate_decisions')
@Index('idx_gate_decision_recorded_at', ['recordedAt'])
@Index('idx_gate_decision_recorded_day', ['recordedDay'])
@Index('idx_gate_decision_session_turn', ['sessionId', 'turnIndex'])
@Index('idx_gate_decision_db_session', ['dbSessionId'])
@Index('idx_gate_decision_mode_reason', ['mode', 'reason'])
@Index('idx_gate_decision_user', ['userId'])
export class GateDecisionEntity {
  /**
   * 主键 (MySQL 自增).
   *
   * ⚠️ 类型声明成 `string`: mysql2 对 BIGINT 默认返回**字符串** (避免精度丢失),
   *   所以读侧一律 `Number(...)` 转成 number 再出接口 (契约要求 id 是 number).
   */
  @PrimaryGeneratedColumn({ type: 'bigint' }) id!: string;

  /** 引擎侧会话 id (运行时口径). */
  @Column({ type: 'varchar', length: 128, name: 'session_id' }) sessionId!: string;

  /**
   * 落库会话 id (`training_sessions.id`) —— 可空.
   *
   * ⚠️ 真实列是 **uuid char(36)** (不是任务单写的 BIGINT) —— 见交付记录偏差 B1.
   */
  @Column({ type: 'varchar', length: 36, name: 'db_session_id', nullable: true }) dbSessionId!: string | null;

  /**
   * 学员账号 id —— 可空 (学员隔离用).
   *
   * ⚠️ 任务单 DDL 里没有这一列, 但硬约束要求"学员隔离走 buildOwnerFilter 同款口径"
   *   —— 没有归属列, 隔离就**无处落地** (只能 join training_sessions, 那是另一套口径).
   *   见交付记录偏差 B2.
   */
  @Column({ type: 'varchar', length: 36, name: 'user_id', nullable: true }) userId!: string | null;

  /** 轮次 (从 1 起). */
  @Column({ type: 'int', name: 'turn_index' }) turnIndex!: number;

  /** 模式 (shadow | effect). */
  @Column({ type: 'varchar', length: 16 }) mode!: string;

  /** 决策 (run | skip). */
  @Column({ type: 'varchar', length: 16 }) decision!: string;

  /** 决策理由 (枚举值). */
  @Column({ type: 'varchar', length: 64 }) reason!: string;

  /**
   * 当时用的阈值 ({ alliance, resistance, calm }).
   *
   * ⚠️ **可为 `{}`** (V2026-11-11 G-3): 结构性跳过 (`mode=rule_only`) 压根没做判定,
   *   没有阈值 —— 写空对象, 不伪造零值三元组.
   */
  @Column({ type: 'json', name: 'threshold_used' }) thresholdUsed!: GateThresholds | Record<string, never>;

  /** 逐维 delta 摘要 (数值). */
  @Column({ type: 'json', name: 'delta_summary', nullable: true }) deltaSummary!: Record<string, number> | null;

  /** 判定耗时 (毫秒). */
  @Column({ type: 'int', name: 'elapsed_ms' }) elapsedMs!: number;

  /** 发生时刻 (DATETIME(3)). */
  @Column({ type: 'datetime', precision: 3, name: 'recorded_at' }) recordedAt!: Date;

  /**
   * 上海日期键 (`YYYY-MM-DD`) —— 写时算好的**按天口径**.
   *
   * ⚠️ 为什么单独存一列 (任务单 DDL 里没有, 见交付记录偏差 B3):
   *   DATETIME 列没有时区, 按天筛选要靠"把日界换算成 UTC 时刻再交给驱动序列化" ——
   *   而驱动按**进程本地时区**序列化, 于是同一批数据在不同环境落进不同的天 (不可比).
   *   把上海日键**写进数据里** (仓库纪律: "口径要写在数据里"), 筛选就与环境无关,
   *   且与统计侧的日 key (`gate_stats:global:YYYY-MM-DD`) **完全对齐**.
   */
  @Column({ type: 'varchar', length: 10, name: 'recorded_day' }) recordedDay!: string;

  /** 落库时刻. */
  @CreateDateColumn({ type: 'datetime', name: 'created_at' }) createdAt!: Date;
}
