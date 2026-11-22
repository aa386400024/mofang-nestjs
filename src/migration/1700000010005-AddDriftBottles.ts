// V2026-10-14 治本 (VS-life-merge P0-治本 — life_map_drift_bottles migration 缺失):
//   原因: DriftBottleEntry entity 早声明 (@Entity('life_map_drift_bottles')), 但
//     V3.0 dash 版 module 写完后 migration 漏写. 跟前序 3 张 V3.0 表
//     (life_stage_progress + key_events + genome_dimensions) 模式一致, 漏写第 4 张.
//     即便现在挂上 life-map/ module, 6 endpoint 一调就 TypeORM TableNotFoundError.
//   修法: 创表 + 3 索引 + down 段 DROP TABLE. 跟 entity 字段 1:1.
//   反双胞胎: 3 索引 (author_created + status_created + picked_by) 都跟 entity @Index
//     注解严格对应, 防 query plan 全表扫.
//   验证: pnpm migration:run 创 life_map_drift_bottles 表成功 +
//     跑 pnpm build 验 TS 编译过 +
//     SHOW INDEX FROM life_map_drift_bottles 返 3 索引 (idx_ldb_author_created +
//     idx_ldb_status_created + idx_ldb_picked_by) + PRIMARY (id).
//   时间戳: 2026-10-14 09:45 GMT+8 (V3 深度扫描发现 → 今日 VS-life-merge 治本).
import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddDriftBottles1700000010005 implements MigrationInterface {
  name = 'AddDriftBottles1700000010005';

  public async up(qr: QueryRunner): Promise<void> {
    await qr.query(`
      CREATE TABLE IF NOT EXISTS life_map_drift_bottles (
        id CHAR(36) NOT NULL PRIMARY KEY,
        author_id CHAR(36) NOT NULL,
        author_anonymous_name VARCHAR(64) NOT NULL,
        content VARCHAR(500) NOT NULL,
        status ENUM('drift', 'picked', 'responded') NOT NULL DEFAULT 'drift',
        picked_by_user_id CHAR(36) NULL,
        picked_by_anonymous_name VARCHAR(64) NULL,
        picked_at DATETIME NULL,
        responded_text VARCHAR(500) NULL,
        responded_at DATETIME NULL,
        created_at DATETIME NOT NULL,
        updated_at DATETIME NOT NULL,
        INDEX idx_ldb_author_created (author_id, created_at),
        INDEX idx_ldb_status_created (status, created_at),
        INDEX idx_ldb_picked_by (picked_by_user_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
  }

  public async down(qr: QueryRunner): Promise<void> {
    await qr.query(`DROP TABLE IF EXISTS life_map_drift_bottles;`);
  }
}
