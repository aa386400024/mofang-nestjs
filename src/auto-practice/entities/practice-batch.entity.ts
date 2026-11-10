// V2026-11-10 治本 (Phase2.5 WP-H 第三波 · 改动 9 — 批次有效性门禁落库):
//   原因: 改动 9 要"把批次状态写成 INVALID", 但 ap_practice_sessions 是**场次**表,
//     没有批次级状态位 —— 批次是"一组场次", 它的结论无处安放.
//     于是本表专门存"这一批能不能用"的判定结果: 一批一行.
//   表结构 (13 列):
//     batch_id / total_sessions / total_turns /
//     render_fallback_turns / llm_call_turns /
//     llm_call_ratio / fallback_ratio /
//     counter_consistent / valid / validity_flags /
//     engine_version / created_at / updated_at
//
//   反双胞胎:
//     - **不做软删**: 批次结论是审计数据, 删了就等于让"这批不能用"这件事凭空消失.
//     - **不加 DB FK**: batch_id 是应用层概念 (nanoid), 不加物理外键 (ADR-0003).
//     - **不存对话原文**: 只有计数 / 比例 / 枚举标签 (隐私红线 AGENTS.md §5.4).
//     - 批次还在跑时也会被刷新 —— 判定是**读时算**的, 不是"跑完才算"的:
//       跑到一半的批次同样可能已经不合格, 早标出来早提醒人.
import { Column, Entity, PrimaryColumn } from 'typeorm';

/**
 * 批次有效性判定结果 (一批一行).
 *
 * 语义: `valid = 1` = 这一批的指标可以拿去下结论; `valid = 0` = **不可用**,
 *   `validity_flags` 里写明是哪几条不达标.
 */
@Entity('ap_practice_batches')
export class PracticeBatch {
  /** 批次 id (nanoid; 单场实时跑没有批次, 这张表不记它). */
  @PrimaryColumn({ type: 'varchar', length: 64, name: 'batch_id' })
  batchId!: string;

  /** 本批场次数 (聚合时点的快照). */
  @Column({ type: 'int', default: 0, name: 'total_sessions' })
  totalSessions!: number;

  /** 本批总轮数 (所有场次 turn_count 之和). */
  @Column({ type: 'int', default: 0, name: 'total_turns' })
  totalTurns!: number;

  /** 本批渲染兜底轮数合计 (改动 6). */
  @Column({ type: 'int', default: 0, name: 'render_fallback_turns' })
  renderFallbackTurns!: number;

  /** 本批真实 LLM 调用轮数合计 (改动 6). */
  @Column({ type: 'int', default: 0, name: 'llm_call_turns' })
  llmCallTurns!: number;

  /** 有真实调用的场次占比 (0~1; 合格线 ≥ 0.9). */
  @Column({ type: 'decimal', precision: 5, scale: 4, nullable: true, name: 'llm_call_ratio' })
  llmCallRatio!: number | null;

  /** 渲染兜底率批次均值 (0~1; 合格线 < 0.05). NULL = 没测过 (不是 0). */
  @Column({ type: 'decimal', precision: 5, scale: 4, nullable: true, name: 'fallback_ratio' })
  fallbackRatio!: number | null;

  /** 计数一致性 (degraded_turns ≤ turn_count) 是否全场满足 (1/0). */
  @Column({ type: 'tinyint', default: 1, name: 'counter_consistent' })
  counterConsistent!: number;

  /** 批次是否通过有效性门禁 (1 = 通过, 0 = 不通过 / INVALID). */
  @Column({ type: 'tinyint', default: 1, name: 'valid' })
  valid!: number;

  /** 不达标原因 (逗号分隔的枚举标签; 通过时为 NULL). */
  @Column({ type: 'varchar', length: 255, nullable: true, name: 'validity_flags' })
  validityFlags!: string | null;

  /** 本批跑的时候的引擎版本 (git describe --dirty; 改动 8). */
  @Column({ type: 'varchar', length: 64, nullable: true, name: 'engine_version' })
  engineVersion!: string | null;

  /** 首次判定时刻. */
  @Column({ type: 'datetime', name: 'created_at' })
  createdAt!: Date;

  /** 最近一次刷新时刻. */
  @Column({ type: 'datetime', name: 'updated_at' })
  updatedAt!: Date;
}
