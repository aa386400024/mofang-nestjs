import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * V2026-09-01 — 心塑「人生地图」Tab 心理基因盘点表 (mofang-nestjs life-map module).
 *
 * 设计:
 *   - genome_dimensions: 5 维度盘点 (一行 = 一用户一维度, UNIQUE)
 *   - key 枚举: security / self_esteem / autonomy / resilience / self_integration
 *   - score 0-100, 必填
 *   - tier 由 score 自动计算 (gentle/balanced/stable/strong), 写库冗余以加速查询
 *   - 软删 (deleted_at), 跟 V3 其他模块一致
 *
 * 反双胞胎 (重要):
 *   - 不新建 assessment_dimensions / genome_scores — 单一真相源
 *   - tier 字段冗余: 避免每次查询都重算, 但 source-of-truth 仍是 score
 *
 * 大厂做法:
 *   - UNIQUE (user_id, key): 一行一维度, 重复写入走 ON DUPLICATE KEY UPDATE 等价语义
 *   - INDEX (user_id): 高频 listGenomeDimensions(uid) 全量查
 *   - 不加 FK (user_id → users.uid): 软删兼容, 应用层校验
 *   - varchar(16) tier: 4 个枚举值, 8 字节足够
 */
export class AddGenomeDimensions1700000010004 implements MigrationInterface {
  name = 'AddGenomeDimensions1700000010004';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE \`genome_dimensions\` (
        \`id\` char(36) NOT NULL,
        \`user_id\` varchar(64) NOT NULL,
        \`key\` ENUM('security', 'self_esteem', 'autonomy', 'resilience', 'self_integration') NOT NULL,
        \`score\` int NOT NULL,
        \`tier\` varchar(16) NOT NULL,
        \`source\` text NULL,
        \`improvement\` text NULL,
        \`created_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        \`updated_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        \`deleted_at\` datetime(6) NULL,
        PRIMARY KEY (\`id\`),
        INDEX \`idx_gd_user\` (\`user_id\`),
        UNIQUE INDEX \`uniq_gd_user_key\` (\`user_id\`, \`key\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS \`genome_dimensions\`;`);
  }
}
