import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * V2026-08-28 — ai_chat_sessions 表 (AI 对话历史浏览).
 *
 * 设计:
 *   - PK = id (uuid)
 *   - uid FK → users.uid (1:N, 一个用户可多次对话)
 *   - mode: normal / inner_voice_coach (V2.0 §5.5)
 *   - summary_title / summary_text: AI 异步生成的摘要 (≤ 80 / ≤ 200)
 *   - emotion_emoji: 开题情绪标签
 *   - round_count: 对话轮数
 *   - archived: 软标记 (true 时 UI 显示但禁止修改/删除)
 *   - 索引: (uid, createdAt) 时间倒序 + (uid, archived) 多条件
 */
export class AddAiChatSessions1700000007011 implements MigrationInterface {
  name = 'AddAiChatSessions1700000007011';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE \`ai_chat_sessions\` (
        \`id\` char(36) NOT NULL,
        \`uid\` char(36) NOT NULL,
        \`mode\` varchar(32) NOT NULL DEFAULT 'normal',
        \`summary_title\` varchar(80) NULL,
        \`summary_text\` varchar(200) NULL,
        \`emotion_emoji\` varchar(16) NULL,
        \`round_count\` int NOT NULL DEFAULT 0,
        \`archived\` tinyint(1) NOT NULL DEFAULT 0,
        \`created_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        \`updated_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        PRIMARY KEY (\`id\`),
        INDEX \`idx_chat_sessions_uid_created\` (\`uid\`, \`created_at\`),
        INDEX \`idx_chat_sessions_uid_archived\` (\`uid\`, \`archived\`),
        CONSTRAINT \`FK_ai_chat_sessions_uid\`
          FOREIGN KEY (\`uid\`) REFERENCES \`users\` (\`uid\`) ON DELETE CASCADE ON UPDATE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE \`ai_chat_sessions\`;`);
  }
}
