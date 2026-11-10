// V2026-11-10 治本 (WP-J P2 · 专业级标注工具 · quality_annotation 表实体):
//   职责: 承载**人工标注**结果 —— 一场锚点会话一行.
//   边界: 只描述表结构与列语义; 零业务逻辑.
//
//   ⚠️ **人工标注列与自动口径列是同一张表里的两类东西, 不能混**:
//     · 人工列 (first_exploration_turn / dominant_label / crisis_peak_level /
//       crisis_first_turn / should_end_turn): **大炮在浏览器里点出来的**, 唯一真相.
//     · 自动列: **不落库** —— 自动判定结果一律现算 (reveal / 一致性报告现取现算),
//       落库就变成"第二份真相", 改内核后永远对不上.
//
//   ⚠️ **CSV 里的自动口径值不导入**: `data/quality/anchor-sample-30.csv` 后三列
//   (first_exploration_turn / dominant_label / crisis_peak_level) 是审计脚本产出的
//   **自动值**, 不是人工标注 (任务单 §1 说"后三列空"与仓库事实不符, 见交付记录 B1).
//   导入它们 = 破坏双盲 (标注员会照抄自动值). 所以 seed **只导身份三列**.
//
//   反双胞胎 (与 gate_decisions / eval_reports 同款纪律):
//     - **不加 DB-level FK**: 跟 ADR-0003 一致, 跨表引用应用层校验;
//     - **不做软删**: 标注是校准依据, 删了就等于把"当时标成什么"永远查不到;
//     - **手写 DDL 建表**: schema 只走 migration (ADR-0003), 禁用 synchronize.
//
//   验证 (大炮跑 pnpm migration:run 后):
//     1. SHOW CREATE TABLE quality_annotation;
//     2. 连跑两次 migration:run → 第二次不报错 (幂等)
//
//   时间戳: 2026-11-10 GMT+8

import { Column, CreateDateColumn, Entity, Index, PrimaryColumn, UpdateDateColumn } from 'typeorm';

/**
 * quality_annotation 表 —— 一场锚点会话的人工标注 = 一行.
 */
@Entity('quality_annotation')
@Index('idx_quality_annotation_debug_session', ['debugSessionId'], { unique: true })
export class QualityAnnotationEntity {
  /**
   * 主键 (UUID v4, 由应用层用 `node:crypto` 的 randomUUID 生成).
   *
   * 为什么用 UUID 而不是自增: 这张表会被 seed 脚本批量写入, UUID 让"同一场会话
   * 重复导入"变成幂等 upsert (按 debug_session_id 命中), 不依赖自增值连续性.
   *
   * ⚠️ **不用 `@PrimaryGeneratedColumn('uuid')`**: 那条路走 TypeORM 的 uuid 生成器,
   *   它在运行时 `require('uuid')` —— 本仓库**没有** uuid 依赖, 启动即炸.
   *   应用层生成反而更可控 (Node 内置, 无新依赖).
   */
  @PrimaryColumn({ type: 'char', length: 36 }) id!: string;

  /**
   * 调试会话 id (逐字稿文件名) —— **唯一键**.
   *
   * 它是锚点清单与逐字稿之间的唯一连接键 (CSV 第一列).
   */
  @Column({ type: 'varchar', length: 128, name: 'debug_session_id' }) debugSessionId!: string;

  /**
   * 锚点清单里的顺序 (CSV 行号, 从 1 起).
   *
   * 为什么**要保留这个顺序**: 标注台是**队列** —— 标注员按顺序标 30 场.
   * 若按主键 (UUID) 排序, 队列顺序每次刷新都不一样, 标到第 12 场时不知道上次标到哪.
   */
  @Column({ type: 'int', name: 'anchor_order', default: 0 }) anchorOrder!: number;

  /**
   * 角色代号 (CSV 第二列).
   */
  @Column({ type: 'varchar', length: 64, name: 'character_slug' }) characterSlug!: string;

  /**
   * 依恋风格 (CSV 第三列).
   */
  @Column({ type: 'varchar', length: 32, name: 'attachment_style' }) attachmentStyle!: string;

  /**
   * 人工标注: 探索开始轮次 (NULL = 本场没有探索 / 还没标).
   */
  @Column({ type: 'int', name: 'first_exploration_turn', nullable: true }) firstExplorationTurn!: number | null;

  /**
   * 人工标注: 主导行为标签 (NULL = 待标).
   *
   * 取值域见 `ANNOTATION_LABEL` (5 个); NULL 既是"待标"也是"本场无主导标签".
   */
  @Column({ type: 'varchar', length: 32, name: 'dominant_label', nullable: true }) dominantLabel!: string | null;

  /**
   * 人工标注: 危机峰值档位 (0~3).
   *
   * 缺省 0 = 没标 = "本场无危机" —— 与自动口径的 0 档同义, 参与一致率对比.
   */
  @Column({ type: 'int', name: 'crisis_peak_level', default: 0 }) crisisPeakLevel!: number;

  /**
   * 人工标注: 危机首次出现轮次 (NULL = 无危机 / 还没标).
   */
  @Column({ type: 'int', name: 'crisis_first_turn', nullable: true }) crisisFirstTurn!: number | null;

  /**
   * 人工标注: 咨询师"该断轮次" (NULL = 没标).
   */
  @Column({ type: 'int', name: 'should_end_turn', nullable: true }) shouldEndTurn!: number | null;

  /**
   * 存疑 / 待复审标记.
   */
  @Column({ type: 'boolean', name: 'needs_review', default: false }) needsReview!: boolean;

  /**
   * 本场标注耗时 (毫秒) —— 前端打点, 用于后续评估"标注工时".
   */
  @Column({ type: 'int', name: 'duration_ms', default: 0 }) durationMs!: number;

  /**
   * 标注人 (basic 账号名 / 学员用户名) —— NULL = 未知.
   */
  @Column({ type: 'varchar', length: 64, name: 'annotator', nullable: true }) annotator!: string | null;

  /**
   * 备注 (存疑原因等).
   */
  @Column({ type: 'text', name: 'notes', nullable: true }) notes!: string | null;

  /**
   * 建档时刻.
   */
  @CreateDateColumn({ type: 'datetime', name: 'created_at' }) createdAt!: Date;

  /**
   * 最后一次保存时刻 (人工标注的更新时间).
   */
  @UpdateDateColumn({ type: 'datetime', name: 'updated_at' }) updatedAt!: Date;
}
