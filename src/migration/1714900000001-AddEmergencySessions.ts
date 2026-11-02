import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * V2026-09-04 — 心塑 V6.0 §4.2 急救会话上报表 (audit P0-3 治本).
 *
 * 设计:
 *   - id 用 varchar(36) = 前端 UUID (跨设备 upsert 幂等键).
 *   - started_at_ms / completed_at_ms 用 bigint 存前端毫秒时间戳
 *     (前端 schema 一致, 服务端不二次转换).
 *   - notes TEXT 走 SQLCipher at-rest 加密 (传输层 HTTPS).
 *   - (uid, started_at_ms) + (uid, tool_kind, started_at_ms) 索引支撑
 *     趋势查询 + 跨设备同步.
 *
 * 反双胞胎 (重要):
 *   - 不重复 inner_world_* 表 — emergency 是独立的急救闭环模块, 不混入
 *     内心世界游戏化体系.
 *   - 不存 LLM 输入 / 输出原始内容 (§11.1 最小必要采集).
 *   - intensity_before / intensity_after nullable (用户跳过自评, §3.4 无评判).
 */
export class AddEmergencySessions1714900000001 implements MigrationInterface {
  name = 'AddEmergencySessions1714900000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE \`emergency_sessions\` (
        \`id\` char(36) NOT NULL,
        \`uid\` char(36) NOT NULL,
        \`tool_kind\` enum('grounding_54321','breath_448','safe_place','tipp','thought_bubble') NOT NULL,
        \`phase\` enum('idle','prerating','running','postrating','completed','abandoned') NOT NULL DEFAULT 'idle',
        \`intensity_before\` tinyint NULL,
        \`intensity_after\` tinyint NULL,
        \`stages_completed\` int NOT NULL DEFAULT 0,
        \`started_at_ms\` bigint NOT NULL,
        \`completed_at_ms\` bigint NULL,
        \`notes\` text NULL,
        \`context\` json NULL,
        \`created_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        PRIMARY KEY (\`id\`),
        INDEX \`idx_emergency_uid_started\` (\`uid\`, \`started_at_ms\`),
        INDEX \`idx_emergency_uid_tool_started\` (\`uid\`, \`tool_kind\`, \`started_at_ms\`),
        INDEX \`idx_emergency_phase\` (\`phase\`),
        CONSTRAINT \`FK_emergency_uid\`
          FOREIGN KEY (\`uid\`) REFERENCES \`users\` (\`uid\`) ON DELETE CASCADE ON UPDATE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS \`emergency_sessions\`;`);
  }
}
