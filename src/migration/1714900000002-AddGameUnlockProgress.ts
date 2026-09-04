import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * V2026-09-04 — 心塑 V6.0 §6 + §3.3 游戏化模块解锁进度表 (audit P0-1).
 *
 * 设计:
 *   - module_id 跟 ai_unlock_states.feature.code 一一对应 (§3.3 表).
 *   - state enum 复用 AIUnlockState (locked / unlocking / unlocked / rolled_back),
 *     不重新定义, 跟 V6.0 §3.3 表保持一致.
 *   - progress_json 存模块专用字段 (companion_tree 浇水次数 / pet_cultivation
 *     体型 / time_capsule 封存时间 等) — 大厂 standard: 模块专用字段不建
 *     独立表, 存 JSON 减少 join 成本.
 *   - (uid, module_id) 唯一约束, upsert 幂等.
 *
 * 反双胞胎:
 *   - 跟 ai_unlock_states 是两个独立模块, 不是镜像 — 那个是 AI 评估结果
 *     (服务端权威), 这个是 Inner World 模块进度详情 (端侧优先, 服务端
 *     用于跨设备同步).
 *   - V2 阶段两端数据通过 cron sync; V3 合并 (ai_unlock_states.feature
 *     加 INNER_WORLD_* 前缀, 一个表覆盖两个场景).
 */
export class AddGameUnlockProgress1714900000002 implements MigrationInterface {
  name = 'AddGameUnlockProgress1714900000002';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE \`inner_world_game_unlock_progress\` (
        \`id\` char(36) NOT NULL,
        \`uid\` char(36) NOT NULL,
        \`module_id\` varchar(64) NOT NULL,
        \`state\` enum('locked','unlocking','unlocked','rolled_back') NOT NULL DEFAULT 'locked',
        \`progress_json\` json NULL,
        \`updated_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`idx_inner_game_unlock_uid_module\` (\`uid\`, \`module_id\`),
        INDEX \`idx_inner_game_unlock_state\` (\`state\`),
        CONSTRAINT \`FK_inner_game_unlock_uid\`
          FOREIGN KEY (\`uid\`) REFERENCES \`users\` (\`uid\`) ON DELETE CASCADE ON UPDATE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS \`inner_world_game_unlock_progress\`;`);
  }
}
