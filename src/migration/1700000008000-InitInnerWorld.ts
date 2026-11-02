import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * V2026-09-03: 初始化 Inner World 模块 6 张表 — V4.0 §3 完整游戏化核心层.
 *
 * 范围:
 *   - inner_world_fragment_logs        碎片流水
 *   - inner_world_badge_states         徽章解锁状态
 *   - inner_world_island_elements      小岛元素 (用户解锁)
 *   - inner_world_island_decorations    小岛装饰 (用户购买)
 *   - inner_world_tool_skin_states     工具皮肤用户状态
 *   - inner_world_theme_pack_states    主题包用户状态
 *
 * 设计原则:
 *   - 用 snake_case 表名 (跟 naming-strategy 一致)
 *   - 每个表都有 user_id 索引, 业务键 (badge_id / element_id / ...) 联合 unique
 *   - 时间字段 created_at / updated_at, 解锁类用 unlocked_at
 *   - idempotency_key 用 varchar(128) 兼容 UUID / 业务方自定义
 */
export class InitInnerWorld1700000008000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // ─── 1. 碎片流水表 ──────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS inner_world_fragment_logs (
        -- V2026-09-03 治本: MySQL 没有原生 UUID 数据类型, MariaDB 才有 — 用 CHAR(36) 存储 UUID() 返回的 36 字符 hyphenated 串.
        -- DEFAULT (UUID()) 在 MySQL 8.0 原生支持 (返回 'xxxxxxxx-xxxx-...'), 跟 CHAR(36) 完美匹配.
        -- entity 用 @PrimaryGeneratedColumn('uuid') (entity/FragmentLog.ts 等), 应用层拿到的还是 string 36 字符,
        -- TypeORM 列映射 CHAR(36) → varchar 双向兼容.
        id CHAR(36) PRIMARY KEY DEFAULT (UUID()),
        user_id VARCHAR(64) NOT NULL,
        type VARCHAR(32) NOT NULL,
        delta INTEGER NOT NULL,
        source VARCHAR(64) NOT NULL,
        idempotency_key VARCHAR(128),
        context TEXT,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await queryRunner.query(`
      -- V2026-09-03 治本: 去掉 IF NOT EXISTS — 这是 MariaDB 专属语法, MySQL 8.0 不支持 CREATE INDEX 的 IF NOT EXISTS.
      -- migration 本来就走 revert→run 闭环 (down() DROP TABLE 顺带抹索引), 不需要幂等. MySQL 严格抛 syntax error 会阻断后续 migration.
      CREATE INDEX idx_iwf_user_type_time
        ON inner_world_fragment_logs (user_id, type, created_at DESC)
    `);
    await queryRunner.query(`
      CREATE INDEX idx_iwf_user_time
        ON inner_world_fragment_logs (user_id, created_at DESC)
    `);

    // ─── 2. 徽章状态表 ──────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS inner_world_badge_states (
        id CHAR(36) PRIMARY KEY DEFAULT (UUID()),
        user_id VARCHAR(64) NOT NULL,
        badge_id VARCHAR(64) NOT NULL,
        unlocked_at TIMESTAMP NOT NULL,
        unlock_consumed_at TIMESTAMP,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT uk_iwb_user_badge UNIQUE (user_id, badge_id)
      )
    `);
    await queryRunner.query(`
      CREATE INDEX idx_iwb_user_time
        ON inner_world_badge_states (user_id, unlocked_at DESC)
    `);

    // ─── 3. 小岛元素表 ──────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS inner_world_island_elements (
        id CHAR(36) PRIMARY KEY DEFAULT (UUID()),
        user_id VARCHAR(64) NOT NULL,
        element_id VARCHAR(64) NOT NULL,
        unlocked_at TIMESTAMP NOT NULL,
        growth_value INTEGER NOT NULL DEFAULT 0,
        placed_x FLOAT,
        placed_y FLOAT,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT uk_iwie_user_element UNIQUE (user_id, element_id)
      )
    `);
    await queryRunner.query(`
      CREATE INDEX idx_iwie_user_growth
        ON inner_world_island_elements (user_id, growth_value DESC)
    `);

    // ─── 4. 小岛装饰表 ──────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS inner_world_island_decorations (
        id CHAR(36) PRIMARY KEY DEFAULT (UUID()),
        user_id VARCHAR(64) NOT NULL,
        decoration_id VARCHAR(64) NOT NULL,
        purchased_at TIMESTAMP NOT NULL,
        placed_area VARCHAR(32),
        placed_x FLOAT,
        placed_y FLOAT,
        spent_fragments INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT uk_iwid_user_decoration UNIQUE (user_id, decoration_id)
      )
    `);
    await queryRunner.query(`
      CREATE INDEX idx_iwid_user_placed
        ON inner_world_island_decorations (user_id, placed_area)
    `);

    // ─── 5. 工具皮肤状态表 ──────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS inner_world_tool_skin_states (
        id CHAR(36) PRIMARY KEY DEFAULT (UUID()),
        user_id VARCHAR(64) NOT NULL,
        skin_id VARCHAR(96) NOT NULL,
        unlocked_at TIMESTAMP NOT NULL,
        equipped_at TIMESTAMP,
        unlock_source VARCHAR(32) NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT uk_iwts_user_skin UNIQUE (user_id, skin_id)
      )
    `);
    await queryRunner.query(`
      CREATE INDEX idx_iwts_user_equipped
        ON inner_world_tool_skin_states (user_id, equipped_at DESC)
    `);

    // ─── 6. 主题包状态表 ────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS inner_world_theme_pack_states (
        id CHAR(36) PRIMARY KEY DEFAULT (UUID()),
        user_id VARCHAR(64) NOT NULL,
        pack_id VARCHAR(96) NOT NULL,
        unlocked_at TIMESTAMP NOT NULL,
        active_at TIMESTAMP,
        unlock_source VARCHAR(32) NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT uk_iwtp_user_pack UNIQUE (user_id, pack_id)
      )
    `);
    await queryRunner.query(`
      CREATE INDEX idx_iwtp_user_active
        ON inner_world_theme_pack_states (user_id, active_at DESC)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS inner_world_theme_pack_states`);
    await queryRunner.query(`DROP TABLE IF EXISTS inner_world_tool_skin_states`);
    await queryRunner.query(`DROP TABLE IF EXISTS inner_world_island_decorations`);
    await queryRunner.query(`DROP TABLE IF EXISTS inner_world_island_elements`);
    await queryRunner.query(`DROP TABLE IF EXISTS inner_world_badge_states`);
    await queryRunner.query(`DROP TABLE IF EXISTS inner_world_fragment_logs`);
  }
}
