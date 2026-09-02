import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * V2026-09-01 — 心塑「人生地图」Tab 关键事件表 (mofang-nestjs life-map module).
 *
 * 设计:
 *   - key_events: 关键事件 CRUD (一行 = 一个事件, 用户可增删改)
 *   - type 枚举: positive / negative / turning (正向 / 负向 / 转折)
 *   - stage 可空: 关联 LIFE_STAGES 之一, 未关联时 NULL
 *   - 软删 (deleted_at), 跟 V3 其他模块一致
 *
 * 反双胞胎 (重要):
 *   - 不新建 life_event / mood_log_event — 关键事件独立表, 跟 mood_logs 模块
 *     (1700000008000) 区分语义 (情绪日志是 daily mood, 关键事件是 milestone)
 *   - stage 字段 nullable: 允许先记录事件, 后补充归类阶段 (前端表单渐进填写)
 *
 * 大厂做法:
 *   - INDEX (user_id, age): 时间轴按年龄正序查 (idx_ke_user_age)
 *   - 不加 FK (stage → life_stage_progress): 事件可独立存在, 应用层校验
 *   - 不加 FK (user_id → users.uid): 软删兼容, 应用层校验
 *   - varchar(100) title: 标题够用, 长描述走 description text
 */
export class AddKeyEvents1700000010003 implements MigrationInterface {
  name = 'AddKeyEvents1700000010003';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE \`key_events\` (
        \`id\` char(36) NOT NULL,
        \`user_id\` varchar(64) NOT NULL,
        \`title\` varchar(100) NOT NULL,
        \`age\` int NOT NULL,
        \`type\` ENUM('positive', 'negative', 'turning') NOT NULL,
        \`description\` text NULL,
        \`feelings\` text NULL,
        \`influence\` text NULL,
        \`interpretation\` text NULL,
        \`stage\` ENUM('adolescence', 'emerging_adulthood', 'transition', 'midlife') NULL,
        \`created_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        \`updated_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        \`deleted_at\` datetime(6) NULL,
        PRIMARY KEY (\`id\`),
        INDEX \`idx_ke_user_age\` (\`user_id\`, \`age\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS \`key_events\`;`);
  }
}
