import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * V2026-08-31 — home_messages 表 (心塑首页消息).
 *
 * 设计:
 *   - PK = id (uuid)
 *   - uid FK → users.uid
 *   - type: system / companion / companion_request / micro_intervention_nudge
 *   - title / preview: 短文案
 *   - ref_id: 关联业务 id (companion_binding_id / intervention_id 等)
 *   - read_at: 已读时间 (NULL = 未读)
 *   - updated_at: 自动维护
 *   - 索引: (uid, read_at) — 未读数查询
 */
export class AddHomeMessages1700000008003 implements MigrationInterface {
  name = 'AddHomeMessages1700000008003';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE \`home_messages\` (
        \`id\` char(36) NOT NULL,
        \`uid\` char(36) NOT NULL,
        \`type\` varchar(32) NOT NULL,
        \`title\` varchar(64) NULL,
        \`preview\` varchar(280) NULL,
        \`ref_id\` varchar(64) NULL,
        \`read_at\` datetime NULL,
        \`updated_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        PRIMARY KEY (\`id\`),
        INDEX \`idx_home_messages_uid_read\` (\`uid\`, \`read_at\`),
        CONSTRAINT \`FK_home_messages_uid\`
          FOREIGN KEY (\`uid\`) REFERENCES \`users\` (\`uid\`) ON DELETE CASCADE ON UPDATE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE \`home_messages\`;`);
  }
}
