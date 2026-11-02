// V2026-10-29 治本 (WP9-B — character_profiles 角色资产池新表):
//   原因: 任务单 `docs/progress/engine-wp9b-db-character-pool-backend-2026-10-29.md`
//     §3 拍板一张 system 级角色表: 5Ps 专业长文 + 内核基线数值 + 结构化心理要素
//     + 审核/上下架状态. WP9-A 把「角色定义从哪来」抽成了可替换端口
//     (`CharacterProfileResolver`), 本轮把端口的数据源从「内置硬编码种子」换成
//     「读这张表」, 并让**真实握手的 vpt_* slug 真正命中角色**
//     (WP9-A 命中率 0 的已知缺口在本轮闭合).
//
//   §3 的列定义 1:1 落地, 0 自由发挥:
//     id / template_id / display_name / attachment_style / five_ps
//     / baseline_trust / baseline_resistance_verbal|depth|style
//     / baseline_emotion_valence / baseline_emotion_arousal
//     / core_beliefs / underlying_desires / forbidden_behaviors / sensitive_topics
//     / audit_status / enabled / version
//     / created_at / updated_at / deleted_at
//   索引: UNIQUE(template_id) + INDEX(audit_status, enabled).
//
//   反双胞胎:
//     - **不用 typeorm migration:generate**: bin/ormconfig.ts 的 entities glob 只覆盖
//       src/entity/** 里的 sampledb, 扫不到本仓实体 → generate 出来是空壳.
//       仓库 63 条 migration 历来手写 DDL, 本条保持一致.
//     - **不落内容进 migration**: 首批 4 个角色的内容是**会持续演进的内容资产**
//       (运营改数值 / 改文案 / 上下架), 走独立 seed 脚本
//       (bin/seed-character-profiles.ts) 按稳定 template_id 幂等 upsert,
//       生命周期与 schema 解耦 (同 visitor_pool / quotes / practice_scenarios 的
//       pattern). 灌进 migration 会让"改一句主诉"也要加一条迁移.
//     - **不加 DB-level FK**: 跟 ADR-0003 一致, 跨表引用应用层校验
//       (template_id → visitor_pool_templates.id).
//     - **不用 synchronize**: schema 只走 migration (ADR-0003).
//     - **不落 tenant_id**: system 级资产, 公共模板同款.
//     - **不落任何计数字段**: 零压红线.
//     - **幂等**: CREATE TABLE IF NOT EXISTS + 索引守卫 —— 重复跑 up 不报错,
//       也不会把已建好的表重建一遍.
//
//   验证 (大炮跑 pnpm migration:run 后):
//     1. SHOW TABLES LIKE 'character_profiles';              # 1 张表
//     2. DESCRIBE character_profiles;                        # 21 列
//     3. SHOW INDEX FROM character_profiles;                 # PRIMARY + uniq_cp_template_id + idx_cp_audit_enabled
//     4. npm run seed:character-profiles → 4 行; 连跑两次行数不变
//     5. pnpm migration:revert → 表消失; 再 migration:run → 表回来
//     6. 全表 grep 'tenant_id\|trust_level\|count\|score' 列名命中数 = 0
//
//   时间戳: 2026-10-29
import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * 把 `QueryRunner.query()` 的 any 返回值收成"行数组".
 *
 * 原因: `query()` 的返回类型是 `Promise<any>`, 直接赋值给变量会触发
 *   `@typescript-eslint/no-unsafe-assignment`. 跟 1714900000018 同款收口.
 */
function asRows(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? (value as Record<string, unknown>[]) : [];
}

export class AddCharacterProfiles1714900000023 implements MigrationInterface {
  name = 'AddCharacterProfiles1714900000023';

  public async up(qr: QueryRunner): Promise<void> {
    // ─── character_profiles (任务单 §3: system 级角色资产池, 21 列 + 2 索引) ───
    await qr.query(`
      CREATE TABLE IF NOT EXISTS character_profiles (
        id CHAR(36) NOT NULL PRIMARY KEY,
        template_id VARCHAR(64) NOT NULL,
        display_name VARCHAR(100) NOT NULL,
        attachment_style VARCHAR(20) NOT NULL,
        five_ps JSON NOT NULL,
        baseline_trust FLOAT NOT NULL DEFAULT 0.3,
        baseline_resistance_verbal FLOAT NOT NULL,
        baseline_resistance_depth FLOAT NOT NULL,
        baseline_resistance_style FLOAT NOT NULL,
        baseline_emotion_valence FLOAT NOT NULL,
        baseline_emotion_arousal FLOAT NOT NULL,
        core_beliefs JSON NOT NULL,
        underlying_desires JSON NOT NULL,
        forbidden_behaviors JSON NOT NULL,
        sensitive_topics JSON NOT NULL,
        audit_status VARCHAR(20) NOT NULL DEFAULT 'draft',
        enabled TINYINT(1) NOT NULL DEFAULT 1,
        version INT NOT NULL DEFAULT 1,
        created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        deleted_at DATETIME(6) NULL,
        UNIQUE KEY uniq_cp_template_id (template_id),
        INDEX idx_cp_audit_enabled (audit_status, enabled)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // 幂等守卫: 表已存在时 (上一轮跑过 / 半途中断), 补齐缺失的索引.
    //   为什么要补: 表是 IF NOT EXISTS 建的, 但索引是**表定义的一部分** ——
    //   若表在更早的版本里被建过 (索引名不同), 重复跑 up 不报错, 却也补不上新索引.
    //   这里显式查一次, 缺才补, 与 1714900000018 的索引守卫同款.
    const indexes = asRows(await qr.query(`SHOW INDEX FROM character_profiles;`));
    const indexNames = new Set<string>(indexes.map((row) => (typeof row['Key_name'] === 'string' ? row['Key_name'] : '')));
    if (!indexNames.has('uniq_cp_template_id')) {
      await qr.query(`ALTER TABLE character_profiles ADD UNIQUE KEY uniq_cp_template_id (template_id);`);
    }
    if (!indexNames.has('idx_cp_audit_enabled')) {
      await qr.query(`ALTER TABLE character_profiles ADD INDEX idx_cp_audit_enabled (audit_status, enabled);`);
    }
  }

  public async down(qr: QueryRunner): Promise<void> {
    // 回滚: 本迁移只建了这 1 张表, 删表即净回滚 (不残留列 / 不残留索引).
    await qr.query(`DROP TABLE IF EXISTS character_profiles;`);
  }
}
