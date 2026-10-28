import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * V2026-09-11 治本 (好状态日记 · 建表 migration):
 *   范围:
 *     - good_state_diary_entries 1 张表
 *
 *   设计原则 (跟 entity/good-state-diary-entry.entity.ts 严格对齐):
 *     - author_id CHAR(36) FK → users.uid ON DELETE CASCADE
 *       (用户真删时日记物理擦除, 合规友好, 不留死行)
 *     - status VARCHAR(32) DEFAULT 'draft' (枚举: draft / finalized)
 *     - mood_snapshot 拆 4 列 (mood_level / mood_snapshotted_at / mood_note /
 *       source_emotion_log_id), 跨 feature 不建 emotion_logs FK
 *     - tags VARCHAR(64) comma-separated (4 选多, max 51 字节留 buffer)
 *     - ai_feedback JSON (整对象序列化), ai_feedback_generated_at datetime
 *     - deleted_at datetime NULL (TypeORM @DeleteDateColumn 自动过滤)
 *
 *   索引:
 *     - idx_gsde_author_status_time: 主查询路径 (列表 + 草稿箱按状态过滤 + 时间倒序)
 *     - idx_gsde_author_deleted: 「最近删除」页面按软删时间查
 *
 *   MySQL 8.0 兼容: 用 ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci.
 */
export class AddGoodStateDiary1714900000003 implements MigrationInterface {
  name = 'AddGoodStateDiary1714900000003';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE \`good_state_diary_entries\` (
        \`id\` char(36) NOT NULL,
        \`author_id\` char(36) NOT NULL,
        \`status\` varchar(32) NOT NULL DEFAULT 'draft',
        \`title\` varchar(200) NULL,
        \`body\` text NOT NULL,
        \`mood_level\` varchar(32) NULL,
        \`mood_snapshotted_at\` datetime(6) NULL,
        \`mood_note\` varchar(500) NULL,
        \`source_emotion_log_id\` char(36) NULL,
        \`tags\` varchar(64) NULL,
        \`linked_practice_id\` varchar(64) NULL,
        \`ai_feedback\` json NULL,
        \`ai_feedback_generated_at\` datetime(6) NULL,
        \`is_private\` tinyint(1) NOT NULL DEFAULT 1,
        \`created_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        \`updated_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        \`deleted_at\` datetime(6) NULL,
        PRIMARY KEY (\`id\`),
        INDEX \`idx_gsde_author_status_time\` (\`author_id\`, \`status\`, \`created_at\` DESC),
        INDEX \`idx_gsde_author_deleted\` (\`author_id\`, \`deleted_at\`),
        CONSTRAINT \`FK_gsde_author_uid\`
          FOREIGN KEY (\`author_id\`) REFERENCES \`users\` (\`uid\`) ON DELETE CASCADE ON UPDATE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS \`good_state_diary_entries\`;`);
  }
}
