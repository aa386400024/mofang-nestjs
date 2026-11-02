// V2026-10-15 治本 (V3.2 — ability_dimensions + ability_scores 2 表 + 5 索引):
//   原因: counselor-mode-v1.0 §6.3 拍板 2 张表 (ability_dimensions 28 子指标配置 +
//     ability_scores user × dimension 聚合), V0.3 §13 baseline 0 子指标表 (V0.x
//     AIProfileSnapshot 7 维度存 json 字段), 1:1 wire 0 破坏. W1-2 + W3-4 supervision_feedback
//     不动, V0.5 阶段 ability_score 走手动 upsert, V1.x 续做 W3-4 自动累加联动.
//
//   设计 (跟 W3-4 supervision_schools + supervision_feedback 同 pattern):
//     - ability_dimensions: 28 子指标配置 (parentDimension + subIndicatorCode + name + description + displayOrder)
//       列: id / parent_dimension / sub_indicator_code / sub_indicator_name / description /
//            display_order / is_active / created_at / updated_at / deleted_at (10 列)
//       索引: PRIMARY + UNIQUE uniq_ad_code (sub_indicator_code) + idx_ad_parent (parent_dimension) = 3 索引
//     - ability_scores: user × dimension 聚合 (1 user 最多 28 行)
//       列: id / tenant_id / user_id / dimension_id / score / source / evidence /
//            created_at / updated_at / deleted_at (10 列)
//       索引: PRIMARY + UNIQUE uniq_as_user_dim (user_id, dimension_id) +
//             idx_as_user (user_id) = 3 索引
//     - 28 子指标走 seed migration (INSERT 28 行到 ability_dimensions), 跟 V0.x
//       SeedDevData + W3-4 supervision_schools 模式同
//     - source varchar(20) 走 string union (跟 V0.x AIProfileSnapshot.source 1:1: cloud/local/user_override)
//
//   反双胞胎:
//     - 不复用 V0.x AIProfileSnapshot 7 维度 json 字段: 28 子指标粒度更细, 1:1 wire 增量
//     - 不用 enum 类型 (parentDimension 走 varchar + 应用层 enum 校验): V0.x pattern
//     - 不在 W1-2 LongTermCaseSession / W3-4 supervision_feedback 加 ability_score 字段:
//       走独立表, 1:1 wire 0 破坏
//     - V0.5 阶段不接 W3-4 supervision.service 自动累加: 避免 V0.5 scope 蔓延,
//       V1.x 续做时 W3-4 service.generateFeedback 完成后回调 ability.service.upsertScore
//
//   验证 (大炮跑 pnpm migration:run + seed 后):
//     1. SHOW TABLES LIKE 'ability_%';  # 2 张表
//     2. SHOW INDEX FROM ability_dimensions; # 3 索引
//     3. SHOW INDEX FROM ability_scores; # 3 索引
//     4. SELECT * FROM ability_dimensions;  # 28 行 (seed)
//     5. SELECT * FROM ability_scores LIMIT 0;  # 空表
//
//   时间戳: 2026-10-15

import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAbilityDimensions1714900000007 implements MigrationInterface {
  name = 'AddAbilityDimensions1714900000007';

  public async up(qr: QueryRunner): Promise<void> {
    // ─── 1. ability_dimensions (28 子指标配置, 10 列 + 3 索引) ───
    await qr.query(`
      CREATE TABLE IF NOT EXISTS ability_dimensions (
        id CHAR(36) NOT NULL PRIMARY KEY,
        parent_dimension VARCHAR(50) NOT NULL,
        sub_indicator_code VARCHAR(100) NOT NULL,
        sub_indicator_name VARCHAR(200) NOT NULL,
        description TEXT NULL,
        display_order INT NOT NULL DEFAULT 0,
        is_active TINYINT(1) NOT NULL DEFAULT 1,
        created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        deleted_at DATETIME(6) NULL,
        UNIQUE INDEX uniq_ad_code (sub_indicator_code),
        INDEX idx_ad_parent (parent_dimension)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // ─── 2. ability_scores (user × dimension 聚合, 10 列 + 3 索引) ───
    await qr.query(`
      CREATE TABLE IF NOT EXISTS ability_scores (
        id CHAR(36) NOT NULL PRIMARY KEY,
        tenant_id CHAR(36) NOT NULL,
        user_id CHAR(36) NOT NULL,
        dimension_id CHAR(36) NOT NULL,
        score INT NOT NULL DEFAULT 0,
        source VARCHAR(20) NOT NULL DEFAULT 'cloud',
        evidence JSON NULL,
        created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        deleted_at DATETIME(6) NULL,
        UNIQUE INDEX uniq_as_user_dim (user_id, dimension_id),
        INDEX idx_as_user (user_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
  }

  public async down(qr: QueryRunner): Promise<void> {
    // 反向: 先删从表 (ability_scores) 再删主表 (ability_dimensions),
    // 跟 up 顺序倒置, 跟 V0.x migration 风格一致.
    await qr.query(`DROP TABLE IF EXISTS ability_scores;`);
    await qr.query(`DROP TABLE IF EXISTS ability_dimensions;`);
  }
}
