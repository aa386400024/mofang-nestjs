import { Column, CreateDateColumn, DeleteDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

import { DiaryEntryStatus } from '../enums/diary-entry-status.enum';
import { DiaryMoodLevel } from '../enums/diary-mood-level.enum';

/**
 * V2026-09-11 治本 (好状态日记 · 核心 entity).
 *
 * 范围 (跟前端 lib/features/good_state_diary/domain/entities/good_state_diary_entry.dart 1:1):
 *   - 用户的私密心理记录, 默认 is_private=1 (私密)
 *   - body 必填, 长度上限 5000 (PRD §6 心理产品合规底线)
 *   - title 可选, 长度上限 100
 *   - status draft / finalized 二态, 默认 draft (前端草稿 = 崩溃恢复载体)
 *   - moodSnapshot 拆 4 列存储 (mood_level / mood_snapshotted_at / mood_note / source_emotion_log_id)
 *   - tags VARCHAR comma-separated (4 选多, max 4 × 12 + 3 = 51 字节, VARCHAR(64) 留 buffer)
 *   - aiFeedback 整对象序列化为 JSON (详情页懒加载, 列表页不取)
 *   - ai_feedback_generated_at: aiFeedback 的缓存时间, 让列表能直接按时间倒序, 无需 JSON_EXTRACT
 *   - deleted_at 软删, 30 天后由 purge cron 物理擦除
 *
 * 反双胞胎:
 *   - 不引用 emotion_logs 表 (跨 feature 不建 FK), source_emotion_log_id 弱关联, V3 emotion
 *     模块实装时通过 DI bridge 跨 feature 走 join
 *   - 不建 FTS 表 (P0 LIKE 模糊查询足够, V3 接 MeiliSearch / Elasticsearch 时再加)
 *
 * 索引:
 *   - (author_id, status, created_at DESC): 主查询路径 (列表 + 草稿箱按状态过滤 + 时间倒序)
 *   - (author_id, deleted_at): 「最近删除」页面按软删时间查
 */
@Entity('good_state_diary_entries')
@Index('idx_gsde_author_status_time', ['authorId', 'status', 'createdAt'])
@Index('idx_gsde_author_deleted', ['authorId', 'deletedAt'])
export class GoodStateDiaryEntry {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** 关联 users.uid (ON DELETE CASCADE, 用户账号真删时日记物理擦除, 合规友好). */
  @Column({ type: 'char', length: 36, name: 'author_id' })
  authorId!: string;

  @Column({ type: 'varchar', length: 32, name: 'status', default: DiaryEntryStatus.Draft })
  status!: DiaryEntryStatus;

  @Column({ type: 'varchar', length: 200, name: 'title', nullable: true })
  title!: string | null;

  @Column({ type: 'text', name: 'body' })
  body!: string;

  // ─── moodSnapshot (4 列拆解, 跨 feature 不建 emotion_logs FK) ───

  @Column({ type: 'varchar', length: 32, name: 'mood_level', nullable: true })
  moodLevel!: DiaryMoodLevel | null;

  @Column({ type: 'datetime', precision: 6, name: 'mood_snapshotted_at', nullable: true })
  moodSnapshottedAt!: Date | null;

  @Column({ type: 'varchar', length: 500, name: 'mood_note', nullable: true })
  moodNote!: string | null;

  /**
   * 弱关联 emotion 模块的 emotion_log.id — 跨 feature 走 bridge,
   * 不建外键 (P0 emotion_log 表未建, V3 emotion 模块实装时同步上线).
   */
  @Column({ type: 'char', length: 36, name: 'source_emotion_log_id', nullable: true })
  sourceEmotionLogId!: string | null;

  // ─── tags / linked_practice ───

  /** comma-separated DiaryTag.name (例: 'goodMoment,challenge'), 见 diary-tag.enum.ts. */
  @Column({ type: 'varchar', length: 64, name: 'tags', nullable: true })
  tags!: string | null;

  @Column({ type: 'varchar', length: 64, name: 'linked_practice_id', nullable: true })
  linkedPracticeId!: string | null;

  // ─── aiFeedback (JSON blob + 生成时间, 详情页懒加载) ───

  @Column({ type: 'json', name: 'ai_feedback', nullable: true })
  aiFeedback!: Record<string, unknown> | null;

  /**
   * aiFeedback 的生成时间 — 让列表能按「最新反馈时间」倒序, 不需 JSON_EXTRACT.
   * NULL 表示这条日记从未生成 AI 反馈.
   */
  @Column({ type: 'datetime', precision: 6, name: 'ai_feedback_generated_at', nullable: true })
  aiFeedbackGeneratedAt!: Date | null;

  // ─── privacy / 时间戳 / 软删 ───

  @Column({ type: 'boolean', name: 'is_private', default: true })
  isPrivate!: boolean;

  @CreateDateColumn({ type: 'datetime', precision: 6, name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'datetime', precision: 6, name: 'updated_at' })
  updatedAt!: Date;

  /**
   * 软删时间 — @DeleteDateColumn 让 TypeORM 自动过滤:
   *   - Repository.find() 默认排除 deleted_at IS NOT NULL
   *   - Repository.find({ withDeleted: true }) 包含所有
   * 30 天后由 purge cron 物理擦除 (PRD §11.1 合规底线).
   *
   * V2026-09-11 治本 (TS2769):
   *   @DeleteDateColumn (typeorm 1.1) 只接受最小 ColumnOptions 子集,
   *   不接受 `type` / `nullable` 显式声明 (默认 datetime + nullable).
   *   跟 @CreateDateColumn / @UpdateDateColumn 重载签名不同, 传多余字段触发
   *   "Object literal may only specify known properties" 错.
   */
  @DeleteDateColumn({ precision: 6, name: 'deleted_at' })
  deletedAt!: Date | null;
}
