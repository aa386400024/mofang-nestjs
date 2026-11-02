// V2026-10-21 治本 (V1.2 VS-C — 逐字稿打点标记 entity):
//   原因: v1.2 spec §6.2 会谈录音与逐字稿打点标记 —— 咨询师在逐字稿上打点 (good / improve /
//     key_node), 督导报告可锚定到 bookmark 位置, 前端点击跳转逐字稿对应时间戳.
//     现状: 逐字稿本身在 training_sessions.transcript (json), 但**没有任何"打点"数据**,
//     督导报告无法精确指到"第几分钟哪一句".
//   修法: transcript_bookmarks 表, 字段跟 spec §6.2 的 entity 草图 1:1 + 补齐仓库统一模板字段.
//   反双胞胎:
//     - 不落音频二进制: 延续 v1.0 §10.1 隐私承诺 (录音仅本地存储, 后端只落 transcript + bookmark)
//     - 不把 markType 塞进 transcript json: 打点是**独立的、可查询的**标注实体
//       (要按类型筛"所有 key_node"), 塞 json 就只能全量捞出来在应用层过滤
//     - 不加 DB-level FK 到 training_sessions: 跟仓库既有 pattern 一致 (软删兼容)
//     - 补 tenant_id / user_id / deleted_at: 跟 counselor 既有 12 个 entity 同一模板 (多租户隔离)
//   验证:
//     1. tsc 0 错
//     2. 大炮跑 migration:run 后 SHOW CREATE TABLE transcript_bookmarks → 2 索引
//   时间戳: 2026-10-21

import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

import { TranscriptBookmarkMarkType } from '../enums/transcript-bookmark-mark-type.enum';

/**
 * 逐字稿打点标记.
 */
@Entity('transcript_bookmarks')
@Index('idx_tbm_session_turn', ['sessionId', 'turnIndex'])
@Index('idx_tbm_user', ['userId'])
export class TranscriptBookmark {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  // V0.x: tenantId = userId (一人一租户, A9).
  @Column({ type: 'char', length: 36, name: 'tenant_id' })
  tenantId!: string;

  @Column({ type: 'char', length: 36, name: 'user_id' })
  userId!: string;

  /** 所属训练会话 id (training_sessions.id). */
  @Column({ type: 'char', length: 36, name: 'session_id' })
  sessionId!: string;

  /** 打点所在轮次 (transcript 里的 turn index). */
  @Column({ type: 'int', name: 'turn_index' })
  turnIndex!: number;

  /**
   * 在录音中的毫秒级偏移 (跟逐字稿时间戳对齐).
   *
   * 用途: 前端点击打点 → 跳到录音/逐字稿的对应位置.
   */
  @Column({ type: 'float', name: 'offset_ms' })
  offsetMs!: number;

  /** 打点类型 (good / improve / key_node). */
  @Column({ type: 'varchar', length: 20 })
  markType!: TranscriptBookmarkMarkType;

  /** 咨询师备注 (可空). */
  @Column({ type: 'text', nullable: true })
  note!: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;

  // 软删 (跟 counselor 其它 entity 一致, 查询需手写 IsNull()).
  @Column({ type: 'datetime', name: 'deleted_at', nullable: true })
  deletedAt!: Date | null;
}
