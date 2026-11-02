// V2026-10-21 治本 (V1.2 VS-C — 实时督导轻提示 entity):
//   原因: v1.2 spec §6.1 实时督导提示: 「后端在每轮 counselor 发言后, 异步跑一个轻量 classifier,
//     命中规则写 live_hint 表」. 表要承载: 哪一轮触发的 + 命中哪类规则 + 提示正文 + 档位.
//   修法: live_supervision_hints 表, 字段跟 spec §6.1 的 entity 草图 1:1 + 补 3 个治本字段.
//   反双胞胎:
//     - 不落"是否已读": 本产品**没有红点/未读角标**设计 (PRD v1.0 §8.3 铁律), 提示是静默浮窗,
//       加已读位会诱发"未读徽标"这种产品没要过的形态
//     - 提示正文只存**方向**, 不存替代话术: spec §6.1 防依赖硬约束 1「禁止输出替代话术原文」,
//       由生成侧 (prompt + 校验) 保证, 落库时再兜一层长度上限
//     - 仍落 tenant_id / user_id: 跟 counselor 既有 12 个 entity 同一模板. 多租户库里
//       少一列租户字段 = 潜在越权口子 (哪次查询忘了校验会话归属就会跨用户泄露),
//       即便当前所有查询都经 sessionId 定位, 也不拿"现在用不上"当省列的理由
//     - 不加"是否已读"派生列
//   验证:
//     1. tsc 0 错
//     2. 大炮跑 migration:run 后 SHOW CREATE TABLE live_supervision_hints → 2 索引
//   时间戳: 2026-10-21

import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

import { LiveSupervisionHintTier } from '../enums/live-supervision-hint-tier.enum';

/**
 * 实时督导轻提示.
 *
 * 命中规则 → 落一行 → SSE 推给前端侧边浮窗.
 */
@Entity('live_supervision_hints')
@Index('idx_lsh_session_turn', ['sessionId', 'turnIndex'])
@Index('idx_lsh_session_category', ['sessionId', 'category'])
export class LiveSupervisionHint {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  // V0.x: tenantId = userId (一人一租户, A9). 跟 counselor 既有 12 个 entity 同一模板.
  @Column({ type: 'char', length: 36, name: 'tenant_id' })
  tenantId!: string;

  @Column({ type: 'char', length: 36, name: 'user_id' })
  userId!: string;

  /** 所属训练会话 id (training_sessions.id). */
  @Column({ type: 'char', length: 36, name: 'session_id' })
  sessionId!: string;

  /** 触发提示的轮次 (transcript 里的 turn index). */
  @Column({ type: 'int', name: 'turn_index' })
  turnIndex!: number;

  /**
   * 命中规则类别 (closed_question_run / suicide_cue / premature_advice ...).
   *
   * 类别是**防抖的 key**: 同一 session 同一 category 5 分钟内不重复推送 (spec §6.1 硬约束 4).
   */
  @Column({ type: 'varchar', length: 50 })
  category!: string;

  /**
   * 提示正文 (只给方向, **不含替代话术**).
   *
   * 长度上限 500: 提示是侧边浮窗里的一句话, 超长就说明模型没按约束输出.
   */
  @Column({ type: 'varchar', length: 500 })
  hintText!: string;

  /** 触发时的档位 (light / off; off 时压根不生成, 落库只为留痕). */
  @Column({ type: 'varchar', length: 20, default: LiveSupervisionHintTier.LIGHT })
  tier!: LiveSupervisionHintTier;

  /**
   * 关联的逐字稿打点 (transcript_bookmarks.id), 可空.
   *
   * 用途: 用户在提示上点"定位"→ 跳到逐字稿对应位置. 打点是用户手动标的, 所以这里允许为空.
   */
  @Column({ type: 'char', length: 36, name: 'bookmark_id', nullable: true })
  bookmarkId!: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;

  // 软删 (跟 counselor 其它 entity 一致, 非 @DeleteDateColumn → 查询需手写 IsNull()).
  @Column({ type: 'datetime', name: 'deleted_at', nullable: true })
  deletedAt!: Date | null;
}
