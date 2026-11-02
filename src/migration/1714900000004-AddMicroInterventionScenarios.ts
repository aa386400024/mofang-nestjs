import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * V2026-09-11 治本 (消除「前端 5 硬编 vs 后端 7 trigger」双胞胎).
 *
 * 新建 micro_intervention_scenarios 表, 存 7 个 trigger 的完整元数据
 * (scenario/icon/kind/duration/category/triggerDescription/accentKey/
 *  displayOrder/isEnabled).
 *
 * 同时种子 7 个默认场景:
 *   - before_meeting / before_social / before_sleep (主线场景)
 *   - after_argument / scrolling_anxiety (情绪调节)
 *   - late_night / waking_up_anxious (深度情绪 / 生理调节)
 *
 * V2026-09-11 治本 (run-time fix):
 *   - 第一次跑时 `trigger` 列名裸用触发 `ER_PARSE_ERROR errno 1064` —
 *     `trigger` 是 MySQL 8.0 保留字 (Trigger DDL 关键字).
 *   - 修法: 所有列名 + PK 列名都加反引号包裹 `\`trigger\`` / `\`scenario\`` / ...
 *     不只 trigger, 全列加 (防后续列名升级踩坑 + 风格统一).
 *   - INSERT ... ON DUPLICATE KEY UPDATE 也同步加反引号.
 *
 * V3 升级路径:
 *   - 接日程权限 / 位置权限 / 使用行为识别 — 加 trigger_fingerprint 列
 *   - 多语言 — 加 scenario_i18n 表
 *   - 运营配置化 — 删 is_enabled, 加 enabled_from / enabled_to 时间窗
 */
export class AddMicroInterventionScenarios1714900000004 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. 建表 (无 FK, 7 行常量数据不需要用户级关联)
    //
    // 大厂 standard (V2026-09-11 治本):
    //   - 所有列名 + PK 列名走反引号包裹, 避免任意 MySQL 保留字冲突
    //     (trigger / order / group / key / desc / status 等都是 MySQL 保留字).
    //   - 列名顺序跟 entity 1:1, 改字段必须同步 entity / DTO.
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS \`micro_intervention_scenarios\` (
        \`trigger\`            VARCHAR(64)  NOT NULL,
        \`scenario\`           VARCHAR(32)  NOT NULL,
        \`icon\`               VARCHAR(8)   NOT NULL,
        \`kind\`               VARCHAR(32)  NOT NULL,
        \`duration_seconds\`   INT          NOT NULL,
        \`category\`           VARCHAR(16)  NOT NULL,
        \`trigger_description\` VARCHAR(128) NOT NULL,
        \`accent_key\`         VARCHAR(16)  NOT NULL,
        \`display_order\`      INT          NOT NULL DEFAULT 0,
        \`is_enabled\`         BOOLEAN      NOT NULL DEFAULT TRUE,
        PRIMARY KEY (\`trigger\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        COMMENT='微干预场景化元数据表 — V2.0 后端 source of truth, 替代前端硬编双胞胎'
    `);

    // 2. 索引 (UI 列表按 display_order ASC 查, is_enabled 过滤)
    await queryRunner.query(`
      CREATE INDEX \`idx_mi_scenarios_order_enabled\`
      ON \`micro_intervention_scenarios\` (\`display_order\`, \`is_enabled\`)
    `);

    // 3. 种子 7 个默认场景
    // 大厂做法: 用 INSERT ... ON DUPLICATE KEY UPDATE (upsert),
    // 重跑 migration 不报错 + 字段更新生效.
    // 列名 / 值都加反引号 (跟 CREATE TABLE 保持一致风格, 防 INSERT 列名顺序错位).
    await queryRunner.query(`
      INSERT INTO \`micro_intervention_scenarios\`
        (\`trigger\`, \`scenario\`, \`icon\`, \`kind\`, \`duration_seconds\`,
         \`category\`, \`trigger_description\`, \`accent_key\`, \`display_order\`, \`is_enabled\`)
      VALUES
        ('before_meeting',     '会议前',         '📅', 'breathing',          30, 'work',    '日程检测到会议前 5 分钟',          'softBlue',   1, TRUE),
        ('before_social',      '社交前',         '👥', 'grounding',          45, 'social',  '日程检测到聚会 / 邀约前',           'mistyPink',  2, TRUE),
        ('before_sleep',       '睡前刷手机',     '🌙', 'breathing',          60, 'rest',    '深夜 + 频繁打开时触发',             'mintCyan',   3, TRUE),
        ('after_argument',     '吵架后',         '💢', 'cognitive_defusion', 90, 'emotion', '情绪波动检测 + 自我调节建议',     'crisis',     4, TRUE),
        ('scrolling_anxiety',  '刷圈焦虑',       '📱', 'self_talk',          60, 'emotion', '连续刷朋友圈超过 10 分钟',         'primary',    5, TRUE),
        ('late_night',         '深夜难眠',       '🌌', 'breathing',         120, 'rest',    '深夜 23:00 后仍清醒时柔和提醒',     'softBlue',   6, TRUE),
        ('waking_up_anxious',  '晨起焦虑',       '☀️', 'grounding',          30, 'emotion', '起床后焦虑评分持续偏高时推送',     'mistyPink',  7, TRUE)
      ON DUPLICATE KEY UPDATE
        \`scenario\`            = VALUES(\`scenario\`),
        \`icon\`                = VALUES(\`icon\`),
        \`kind\`                = VALUES(\`kind\`),
        \`duration_seconds\`    = VALUES(\`duration_seconds\`),
        \`category\`            = VALUES(\`category\`),
        \`trigger_description\` = VALUES(\`trigger_description\`),
        \`accent_key\`          = VALUES(\`accent_key\`),
        \`display_order\`       = VALUES(\`display_order\`),
        \`is_enabled\`          = VALUES(\`is_enabled\`)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP INDEX `idx_mi_scenarios_order_enabled` ON `micro_intervention_scenarios`');
    await queryRunner.query('DROP TABLE IF EXISTS `micro_intervention_scenarios`');
  }
}
