// V2026-11-08 治本 (Phase2.5 WP-D · 自动对练 — 对练场次表):
//   原因: 批量跑 30+ 场 AI 对 AI 之后, 要有一张表记录"跑了哪几场 / 谁和谁聊 /
//     跑了几轮 / 为什么结束 / 花了多少钱", 才能给 WP-E 自动评测和 WP-B 可复现性
//     提供数据底座. 逐字稿本身落在 debug-session 的 JSON 文件里 (复用现有管道),
//     这张表只存"场次元数据 + 退出原因", 不存对话原文 (隐私红线).
//
//   表结构 (16 列 + 3 索引):
//     id / debug_session_id / character_slug / counselor_mode_id / status /
//     max_turns / turn_count / crisis_ended / exit_reason / batch_id /
//     model_version / seed_value / total_cost / error_message /
//     started_at / finished_at + created_at / updated_at
//
//   反双胞胎:
//     - **不存对话原文**: 逐字稿在 debug-session JSON 文件里 (data/debug-sessions/),
//       这张表只存元数据. WP-E 评测时通过 debug_session_id 去读那个文件.
//     - **model_version / seed_value 是 WP-B 预留字段**: 本期只写不读 (写入模型名
//       和种子), 可复现性逻辑归 WP-B. 现在留字段 = 将来 WP-B 不用 ALTER TABLE.
//     - **不加 DB FK**: debug_session_id 是进程内 id (不是 DB 主键), character_slug
//       指向 character_profiles (应用层校验), 都不加物理外键 (ADR-0003).
//     - **不做软删**: 场次是审计数据, 删了等于让批量统计凭空少一场.
//
//   验证 (大炮跑 pnpm migration:run 后):
//     1. SHOW TABLES LIKE 'ap_practice_sessions';
//     2. DESCRIBE ap_practice_sessions;
//     3. 跑一场单场对练 → 表里多一行 status=completed
//
//   时间戳: 2026-11-08

import { Column, CreateDateColumn, Entity, Index, PrimaryColumn, UpdateDateColumn } from 'typeorm';

/**
 * 对练场次状态机.
 *
 * running → completed (跑满 maxTurns)
 *         → crisis_ended (来访者触发危机, 提前停)
 *         → stagnant (来访者连续 3 轮答非所问 / 重复, 提前停)
 *         → failed (LLM 报错 / 引擎报错)
 *         → canceled (手动取消)
 */
export type PracticeSessionStatus = 'running' | 'completed' | 'crisis_ended' | 'stagnant' | 'failed' | 'canceled';

/**
 * ap_practice_sessions 表 —— 自动对练场次元数据.
 *
 * 一场 = 一个 AI 咨询师 × 一个 AI 来访者, 自动聊若干轮. 逐字稿在 debug-session
 * 的 JSON 文件里; 这张表只回答"这场是谁跟谁 / 跑了多久 / 为什么停 / 花了多少".
 */
@Entity('ap_practice_sessions')
// 批量进度查询主路径: 按 batch_id 列一场批量跑了多少场.
@Index('idx_ap_sessions_batch', ['batchId'])
// 按状态筛 (admin 面板看"跑了几场失败的").
@Index('idx_ap_sessions_status', ['status'])
// 按角色 + 模式查 (WP-E 评测时按 character_slug 聚合).
@Index('idx_ap_sessions_character_mode', ['characterSlug', 'counselorModeId'])
export class PracticeSession {
  /** 场次 id (nanoid, 对外契约). */
  @PrimaryColumn({ type: 'varchar', length: 64 })
  id!: string;

  /**
   * 关联的 debug-session id (逐字稿在 data/debug-sessions/{debugSessionId}.json).
   *
   * 为什么不直接存逐字稿: 复用现有 debug-session 管道 (create/runTurn/close),
   * 它已经把每轮 trace + messages 落 JSON 文件了. 这里只存个指针.
   */
  @Column({ type: 'varchar', length: 128, name: 'debug_session_id' })
  debugSessionId!: string;

  /** 来访者角色 slug (对应 character_profiles / 内置角色种子). */
  @Column({ type: 'varchar', length: 128, name: 'character_slug' })
  characterSlug!: string;

  /** 咨询师模式 id (ap_counselor_modes.id). */
  @Column({ type: 'varchar', length: 64, name: 'counselor_mode_id' })
  counselorModeId!: string;

  /** 场次状态 (见 PracticeSessionStatus). */
  @Column({ type: 'varchar', length: 32, default: 'running' })
  status!: PracticeSessionStatus;

  /** 本场最大轮数 (到了就正常结束). */
  @Column({ type: 'int', default: 15, name: 'max_turns' })
  maxTurns!: number;

  /** 实际跑了几轮. */
  @Column({ type: 'int', default: 0, name: 'turn_count' })
  turnCount!: number;

  /** 是否触发了危机 (来访者说了自伤 / 自杀相关的话). */
  @Column({ type: 'tinyint', default: 0, name: 'crisis_ended' })
  crisisEnded!: number;

  /**
   * 退出原因 (与 status 对应, 便于统计):
   * max_turns / crisis / stagnant / error / manual.
   */
  @Column({ type: 'varchar', length: 64, nullable: true, name: 'exit_reason' })
  exitReason!: string | null;

  /**
   * 批量批次 id (一场批量跑共享同一个 batchId; 单场实时跑为 null).
   *
   * 批量接口入队 N 个 job 时生成一个 batchId, 所有 job 写同一个 batchId,
   * 前端按它轮询进度 ("这批跑完了吗").
   */
  @Column({ type: 'varchar', length: 64, nullable: true, name: 'batch_id' })
  batchId!: string | null;

  /**
   * WP-B 预留: 本场用的 LLM 模型名 (可复现性).
   *
   * 本期只写不读 —— 跑的时候把 model 名记下来, WP-B 做可复现性时按它筛选.
   */
  @Column({ type: 'varchar', length: 128, nullable: true, name: 'model_version' })
  modelVersion!: string | null;

  /**
   * WP-B 预留: 本场用的随机种子 (可复现性).
   *
   * 本期只写不读 —— 引擎会话开的时候 character resolver 给了 seed, 记下来.
   */
  @Column({ type: 'varchar', length: 128, nullable: true, name: 'seed_value' })
  seedValue!: string | null;

  /**
   * WP-B: 角色 semver 版本号 (如 "1.0.0").
   *
   * 会话创建时从 CharacterVersionRegistry 读实时值, 不缓存 —— 版本号记错 = 溯源失效.
   */
  @Column({ type: 'varchar', length: 32, nullable: true, name: 'character_version' })
  characterVersion!: string | null;

  /**
   * WP-B: 本场审议模式 (rule_only / shadow / llm_active).
   *
   * 考核场景恒为 rule_only (硬隔离), 与全局开关无关.
   */
  @Column({ type: 'varchar', length: 16, nullable: true, name: 'deliberation_mode' })
  deliberationMode!: string | null;

  /**
   * WP-B: 后端代码版本 (git sha 或 build id).
   *
   * 用于定位"哪版代码跑出来的数据", 出问题时能快速回溯.
   */
  @Column({ type: 'varchar', length: 64, nullable: true, name: 'engine_version' })
  engineVersion!: string | null;

  /** 本场 LLM 总成本 (美元, 粗略估算; WP-E 做成本分析用). */
  @Column({ type: 'decimal', precision: 10, scale: 4, nullable: true, name: 'total_cost' })
  totalCost!: number | null;

  /**
   * 咨询师侧降级轮数 (V2026-11-09 P1-3).
   *
   * 上游 429 / 超时 / 空回复时, counselor-agent 回 FALLBACK_REPLY ("嗯，我在听").
   * 这种轮次不是真咨询师说的话, 之前场次仍标 completed, 评测时混在真数据里.
   * 这里累计降级轮数; 退出时若降级比 ≥ 50%, exitReason 加 _heavy_degraded 后缀.
   */
  @Column({ type: 'int', default: 0, name: 'degraded_turns' })
  degradedTurns!: number;

  /** 失败时的错误信息 (status=failed 时有值). */
  @Column({ type: 'text', nullable: true, name: 'error_message' })
  errorMessage!: string | null;

  /** 开始时刻. */
  @Column({ type: 'datetime', name: 'started_at' })
  startedAt!: Date;

  /** 结束时刻 (running 时为 null). */
  @Column({ type: 'datetime', nullable: true, name: 'finished_at' })
  finishedAt!: Date | null;

  /** 创建时刻. */
  @CreateDateColumn({ type: 'datetime', name: 'created_at' })
  createdAt!: Date;

  /** 更新时刻. */
  @UpdateDateColumn({ type: 'datetime', name: 'updated_at' })
  updatedAt!: Date;
}
