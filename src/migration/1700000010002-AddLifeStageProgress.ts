import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * V2026-09-01 — 心塑「人生地图」Tab 阶段梳理表 (mofang-nestjs life-map module).
 *
 * 设计:
 *   - life_stage_progress: 4 阶段任务完成度 (一行 = 一用户一阶段, UNIQUE)
 *   - completionPct NULL 表示尚未填写, NOT 0 (语义区别于"已填 0%")
 *   - 软删 (deleted_at), 跟 V3 其他模块一致
 *
 * 反双胞胎 (重要):
 *   - 不新建 practice_stage_progress / dashboard_stage_progress — 单一真相源
 *   - 阶段枚举 (adolescence/emerging_adulthood/transition/midlife) 在前端/后端共享
 *     shared/types/practice.types.ts, Entity 通过 @Column({ type: 'enum', enum: LIFE_STAGES }) 引用
 *
 * 大厂做法:
 *   - UNIQUE (user_id, stage): 一行一阶段, 重复写入走 ON DUPLICATE KEY UPDATE 等价语义
 *   - INDEX (user_id) 普通: 高频 _loadAllStages(uid) 全量查
 *   - 不加 FK (user_id → users.uid): 软删兼容, 应用层校验用户存在
 *   - datetime(6) 精度: 跟时间戳统一
 */
export class AddLifeStageProgress1700000010002 implements MigrationInterface {
  name = 'AddLifeStageProgress1700000010002';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE \`life_stage_progress\` (
        \`id\` char(36) NOT NULL,
        \`user_id\` varchar(64) NOT NULL,
        \`stage\` ENUM('adolescence', 'emerging_adulthood', 'transition', 'midlife') NOT NULL,
        \`completion_pct\` int NULL,
        \`stuck_points\` text NULL,
        \`gains\` text NULL,
        \`created_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        \`updated_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        \`deleted_at\` datetime(6) NULL,
        PRIMARY KEY (\`id\`),
        INDEX \`idx_lsp_user\` (\`user_id\`),
        UNIQUE INDEX \`uniq_lsp_user_stage\` (\`user_id\`, \`stage\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS \`life_stage_progress\`;`);
  }
}
