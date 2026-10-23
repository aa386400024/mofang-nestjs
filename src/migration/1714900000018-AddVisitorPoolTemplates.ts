// V2026-10-23 治本 (AI 模拟来访池 — visitor_pool_templates + visitor_pool_favorites 2 张新表
//   + visitor_full_personas.source_template_id 1 列):
//   原因: spec `docs/specs/counselor-visitor-pool.md` §2 要求公共供给层落地:
//     §2.1 visitor_pool_templates  (公共只读模板: 表层卡片 + 7 大块剧本快照)
//     §2.2 visitor_full_personas   (复用现有表, 仅加 source_template_id 标注副本来源)
//     §2.3 临场参数                 (不建表, 随会话启动参数透传)
//     §3.4 visitor_pool_favorites  (收藏关系, 唯一键 (template_id, user_id))
//     §2 的 17 列 / 2 索引严格按 spec 落, 0 自由发挥.
//
//   反双胞胎:
//     - **不用 typeorm migration:generate**: bin/ormconfig.ts 的 entities glob 只覆盖
//       src/entity/** 里的 sampledb, 扫不到 counselor 系 entity → generate 出来是空壳.
//       counselor 系 migration 历来手写 DDL (1714900000009~0017 全部手写), 保持一致.
//     - **不落内容进 migration**: 6 个官方人物的内容是**会持续演进的内容** (运营改文案/
//       AI 重新生成), 走独立 seed 脚本 bin/seed-visitor-pool-templates.ts 按稳定 id
//       幂等 upsert, 生命周期与 schema 解耦 (同 training_exercises / practice_scenarios
//       / quotes 的 pattern). 灌进 migration 会让"改一句主诉"也要加一条迁移.
//     - **不给 templates 表加 tenant_id**: spec §2.1 明确「system 级, 无个人 userId」.
//     - **不给 templates 表加计数字段 / trust_level**: 零压红线 + 信任度是私有副本的
//       会话演进状态, 公共模板挂全局可变状态必然串号.
//     - **收藏表走硬删** (不软删): MySQL 唯一索引不含 deleted_at, 软删会让
//       「取消收藏 → 再收藏」撞唯一键. 跟 user_quote_favorites 同处刻意的例外.
//     - **不加 DB-level FK**: 跟 ADR-0003 一致, 跨表引用应用层校验.
//     - **不用 synchronize**: schema 只走 migration (ADR-0003).
//
//   验证 (大炮跑 pnpm migration:run 后):
//     1. SHOW TABLES LIKE 'visitor_pool_templates';   # 1 张表
//     2. SHOW TABLES LIKE 'visitor_pool_favorites';   # 1 张表
//     3. DESCRIBE visitor_pool_templates;  # 17 列
//     4. DESCRIBE visitor_full_personas;   # 15 列 (含 source_template_id)
//     5. SHOW INDEX FROM visitor_pool_templates;  # PRIMARY + 2 复合索引
//     6. SHOW INDEX FROM visitor_pool_favorites;  # 3 索引 (含 uniq_vpf_user_template)
//     7. 全表 grep 'trust_level\|favorite_count\|use_count\|score' 列名命中数 = 0
//
//   时间戳: 2026-10-23
import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * 把 `QueryRunner.query()` 的 any 返回值收成"行数组".
 *
 * 原因: `query()` 的返回类型是 `Promise<any>`, 直接赋值给变量会触发
 *   `@typescript-eslint/no-unsafe-assignment`. 跟 1714900000016 同款收口.
 */
function asRows(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? (value as Record<string, unknown>[]) : [];
}

export class AddVisitorPoolTemplates1714900000018 implements MigrationInterface {
  name = 'AddVisitorPoolTemplates1714900000018';

  public async up(qr: QueryRunner): Promise<void> {
    // ─── visitor_pool_templates (spec §2.1: 公共只读模板, 17 列 + 2 索引) ───
    await qr.query(`
      CREATE TABLE IF NOT EXISTS visitor_pool_templates (
        id CHAR(36) NOT NULL PRIMARY KEY,
        codename VARCHAR(100) NOT NULL,
        age_range VARCHAR(20) NOT NULL,
        presenting_complaint VARCHAR(300) NOT NULL,
        defense_type VARCHAR(20) NOT NULL,
        issue_domain VARCHAR(20) NOT NULL,
        training_goal VARCHAR(200) NOT NULL,
        difficulty VARCHAR(4) NOT NULL,
        source VARCHAR(20) NOT NULL DEFAULT 'official',
        style_hint VARCHAR(20) NOT NULL DEFAULT 'cooperative',
        emotion_baseline_default FLOAT NOT NULL DEFAULT 0.35,
        defense_level_default FLOAT NOT NULL DEFAULT 0.2,
        script JSON NOT NULL,
        enabled TINYINT(1) NOT NULL DEFAULT 1,
        sort_order INT NOT NULL DEFAULT 0,
        created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        deleted_at DATETIME(6) NULL,
        INDEX idx_vpt_enabled_domain (enabled, issue_domain),
        INDEX idx_vpt_enabled_difficulty (enabled, difficulty)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // ─── visitor_pool_favorites (spec §3.4: 收藏关系, 5 列 + 2 索引) ───
    await qr.query(`
      CREATE TABLE IF NOT EXISTS visitor_pool_favorites (
        id CHAR(36) NOT NULL PRIMARY KEY,
        tenant_id CHAR(36) NOT NULL,
        user_id CHAR(36) NOT NULL,
        template_id CHAR(36) NOT NULL,
        created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        UNIQUE KEY uniq_vpf_user_template (user_id, template_id),
        INDEX idx_vpf_user_created (user_id, created_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // ─── visitor_full_personas.source_template_id (spec §2.2: 标注副本来源) ───
    // 幂等: 先查列是否存在再 ALTER, 避免重复执行时抛 "Duplicate column name".
    //   可空 + 不加 UNIQUE: 同一人可多次实例化同一模板, 每次得到独立副本.
    const personaColumns = asRows(await qr.query(`SHOW COLUMNS FROM visitor_full_personas LIKE 'source_template_id';`));
    if (personaColumns.length === 0) {
      await qr.query(`
        ALTER TABLE visitor_full_personas
          ADD COLUMN source_template_id CHAR(36) NULL AFTER case_id;
      `);
    }

    // 幂等: 副本来源索引 (追源「我这份副本来自哪个官方人物」 + 模板下架时定位衍生副本).
    const personaIndexes = asRows(await qr.query(`SHOW INDEX FROM visitor_full_personas;`));
    const personaIndexNames = new Set<string>(personaIndexes.map((row) => (typeof row['Key_name'] === 'string' ? row['Key_name'] : '')));
    if (!personaIndexNames.has('idx_vfp_source_template')) {
      await qr.query(`
        ALTER TABLE visitor_full_personas
          ADD INDEX idx_vfp_source_template (source_template_id);
      `);
    }
  }

  public async down(qr: QueryRunner): Promise<void> {
    // 回滚顺序与建表相反: 先摘掉 visitor_full_personas 的列 (它是副本表的附属标注),
    // 再删收藏关系表, 最后删公共模板表.
    const personaColumns = asRows(await qr.query(`SHOW COLUMNS FROM visitor_full_personas LIKE 'source_template_id';`));
    if (personaColumns.length > 0) {
      await qr.query(`ALTER TABLE visitor_full_personas DROP COLUMN source_template_id;`);
    }
    await qr.query(`DROP TABLE IF EXISTS visitor_pool_favorites;`);
    await qr.query(`DROP TABLE IF EXISTS visitor_pool_templates;`);
  }
}
