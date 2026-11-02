// V2026-10-22 治本 (V1.3 §7.5 — practice_custom_scenarios 新表 + practice_attempts.scenario_source 列):
//   原因: spec §7.5 拍板两件事:
//     (1) 新表 `practice_custom_scenarios` —— 存用户私有场景 (LLM 按用户三问生成),
//         跟共享内容库 `practice_scenarios` **物理隔离** (审核边界)
//     (2) `practice_attempts` 增加 `scenario_source` 枚举列 (seed / custom, 默认 seed),
//         "不迁移旧数据" —— 已有行的默认值即为 'seed', 语义正确
//   附带: `quota_usage.period` 从 VARCHAR(7) 放宽到 VARCHAR(10).
//     原因: spec §7.4 要求「沿用现有 quota_usage 配额体系统计, 默认每用户**每天** 5 次」,
//       而现有 period 是月度粒度 'YYYY-MM' (7 字符). 要在**同一张表**里记日粒度,
//       period 必须能放下 'YYYY-MM-DD' (10 字符).
//     这是**加宽**不是改语义: 月度行 ('2026-10') 与日粒度行 ('2026-10-22') 因
//     UNIQUE (user_id, quota_type, period) 而天然互不冲突, 且既有月度聚合查询
//     (period = 'YYYY-MM') 不会命中日粒度行.
//   设计 (跟 1714900000015-AddPracticeScenarios V1.3 §2 风格一致):
//     - practice_custom_scenarios: 14 列 + 3 索引 (PRIMARY + uniq_pcs_scenario_key
//       + idx_pcs_user_created)
//     - practice_attempts: ALTER 加 1 列 scenario_source VARCHAR(20) NOT NULL DEFAULT 'seed'
//     - 全部软删 (deleted_at) + tenant_id + user_id (spec §6.4 硬约束)
//     - 无 DB-level FK (跟 ADR-0003 一致, 跨表引用应用层校验)
//     - **内容不进 migration**: 用户私有场景是运行时 LLM 产物, 不是静态内容
//
//   反双胞胎:
//     - 不用 ENUM 列类型: 跟 V0.x/V1.x 一致, varchar + 应用层 enum 校验
//     - 不给 practice_attempts 加 score / is_correct 列: spec §6.2 明令不下发分数
//     - 不建 practice_custom_scenario_attempts 之类的派生表: 练习记录统一在
//       practice_attempts, 靠 scenario_source 列区分来源 (不再造第三张记录表)
//     - 不在 migration 里塞默认的 'seed' 历史回填逻辑: ALTER 的 DEFAULT 天然覆盖
//       存量行, 再写一遍 UPDATE 反而多一次全表扫描
//
//   验证 (大炮跑 pnpm migration:run 后):
//     1. SHOW TABLES LIKE 'practice_custom_scenarios'; # 1 张表
//     2. SHOW INDEX FROM practice_custom_scenarios; # 3 索引
//     3. DESCRIBE practice_custom_scenarios; # 14 列
//     4. SHOW COLUMNS FROM practice_attempts LIKE 'scenario_source';
//        # Field=scenario_source, Default='seed', Null=NO
//     5. SELECT COUNT(*) FROM practice_attempts WHERE scenario_source = 'seed';
//        # = 存量行数 (旧数据未迁移且语义正确)
//     6. SHOW COLUMNS FROM quota_usage LIKE 'period'; # Type=varchar(10)
//
//   时间戳: 2026-10-22
import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * 把 `QueryRunner.query()` 的 any 返回值收成"行数组".
 *
 * 原因: `query()` 的返回类型是 `Promise<any>`, 直接赋值给变量会触发
 *   `@typescript-eslint/no-unsafe-assignment` (8 处). 这里统一收口:
 *   运行时用 Array.isArray 判形状 (非数组 = 空结果, 语义上等价于"没查到"),
 *   类型上声明为 `Record<string, unknown>[]`, 取值时用下标访问.
 */
function asRows(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? (value as Record<string, unknown>[]) : [];
}

export class AddPracticeCustomScenarios1714900000016 implements MigrationInterface {
  name = 'AddPracticeCustomScenarios1714900000016';

  public async up(qr: QueryRunner): Promise<void> {
    // ─── practice_custom_scenarios (V1.3 §7.5 拍板 用户私有场景, 14 列 + 3 索引) ───
    await qr.query(`
      CREATE TABLE IF NOT EXISTS practice_custom_scenarios (
        id CHAR(36) NOT NULL PRIMARY KEY,
        tenant_id CHAR(36) NOT NULL,
        user_id CHAR(36) NOT NULL,
        exercise_id CHAR(36) NULL,
        exercise_mode VARCHAR(50) NOT NULL,
        difficulty INT NOT NULL DEFAULT 1,
        source_payload JSON NOT NULL,
        generated_scenario JSON NOT NULL,
        generation_mode VARCHAR(20) NOT NULL DEFAULT 'llm',
        scenario_key VARCHAR(80) NOT NULL,
        enabled TINYINT NOT NULL DEFAULT 1,
        created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        deleted_at DATETIME(6) NULL,
        UNIQUE KEY uniq_pcs_scenario_key (scenario_key),
        INDEX idx_pcs_user_created (user_id, created_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // ─── practice_attempts.scenario_source (V1.3 §7.5 拍板: seed / custom, 默认 seed) ───
    // 幂等: 先查列是否存在再 ALTER, 避免重复执行时抛 "Duplicate column name".
    const attemptColumns = asRows(await qr.query(`SHOW COLUMNS FROM practice_attempts LIKE 'scenario_source';`));
    if (attemptColumns.length === 0) {
      await qr.query(`
        ALTER TABLE practice_attempts
          ADD COLUMN scenario_source VARCHAR(20) NOT NULL DEFAULT 'seed' AFTER turn;
      `);
    }

    // ─── practice_attempts.attempt_ordinal (§8.5 E1 治本: 取号从 JSON 提到独立列) ───
    // 原因: attemptOrdinal 之前只存在 feedback JSON 里, 无法建唯一索引, 于是取号靠
    //   "count() 再 insert" —— 并发双击同场景会拿到相同序号, 且没有任何东西拦得住.
    //   抽成独立列后, (user_id, scenario_id, attempt_ordinal) 可建 UNIQUE 约束,
    //   取号正确性由数据库强制保证.
    const ordinalColumns = asRows(await qr.query(`SHOW COLUMNS FROM practice_attempts LIKE 'attempt_ordinal';`));
    if (ordinalColumns.length === 0) {
      await qr.query(`
        ALTER TABLE practice_attempts
          ADD COLUMN attempt_ordinal INT NOT NULL DEFAULT 1 AFTER turn;
      `);
    }

    // ─── practice_attempts 画像回写 2 列 (§7.6 P3-c) ───
    // 零压红线说明: 这两列是**内部**记账字段, 从不出现在任何 practice 出参 DTO 里.
    const abilityColumns = asRows(await qr.query(`SHOW COLUMNS FROM practice_attempts LIKE 'ability_dimension_code';`));
    if (abilityColumns.length === 0) {
      await qr.query(`
        ALTER TABLE practice_attempts
          ADD COLUMN ability_dimension_code VARCHAR(50) NULL AFTER scenario_source,
          ADD COLUMN ability_signal INT NULL AFTER ability_dimension_code;
      `);
    }

    // ─── practice_attempts 2 个新索引 (§8.5 E1 唯一约束 + §7.6 P3-c 聚合索引) ───
    // 幂等: 先查索引是否存在再创建.
    const attemptIndexes = asRows(await qr.query(`SHOW INDEX FROM practice_attempts;`));
    const existingIndexNames = new Set<string>(attemptIndexes.map((row) => (typeof row['Key_name'] === 'string' ? row['Key_name'] : '')));
    if (!existingIndexNames.has('uniq_pa_user_scenario_ordinal')) {
      await qr.query(`
        ALTER TABLE practice_attempts
          ADD UNIQUE KEY uniq_pa_user_scenario_ordinal (user_id, scenario_id, attempt_ordinal);
      `);
    }
    if (!existingIndexNames.has('idx_pa_user_ability')) {
      await qr.query(`
        ALTER TABLE practice_attempts
          ADD INDEX idx_pa_user_ability (user_id, ability_dimension_code);
      `);
    }

    // ─── quota_usage.period 放宽到 10 字符 (V1.3 §7.4: 每天 5 次的日粒度计数) ───
    // 幂等: 已是 varchar(10) 则跳过.
    const periodColumns = asRows(await qr.query(`SHOW COLUMNS FROM quota_usage LIKE 'period';`));
    const periodType = periodColumns.length > 0 && typeof periodColumns[0]?.['Type'] === 'string' ? periodColumns[0]['Type'] : '';
    if (!/varchar\(10\)/i.test(periodType)) {
      await qr.query(`ALTER TABLE quota_usage MODIFY COLUMN period VARCHAR(10) NOT NULL;`);
    }
  }

  public async down(qr: QueryRunner): Promise<void> {
    // 反向: 先回退 ALTER (索引随列一起删), 再删表 (保持语义顺序, 便于人工回滚时阅读).
    const abilityColumns = asRows(await qr.query(`SHOW COLUMNS FROM practice_attempts LIKE 'ability_dimension_code';`));
    if (abilityColumns.length > 0) {
      await qr.query(`
        ALTER TABLE practice_attempts
          DROP INDEX idx_pa_user_ability,
          DROP INDEX uniq_pa_user_scenario_ordinal,
          DROP COLUMN ability_signal,
          DROP COLUMN ability_dimension_code;
      `);
    }
    const ordinalColumns = asRows(await qr.query(`SHOW COLUMNS FROM practice_attempts LIKE 'attempt_ordinal';`));
    if (ordinalColumns.length > 0) {
      await qr.query(`ALTER TABLE practice_attempts DROP COLUMN attempt_ordinal;`);
    }
    const attemptColumns = asRows(await qr.query(`SHOW COLUMNS FROM practice_attempts LIKE 'scenario_source';`));
    if (attemptColumns.length > 0) {
      await qr.query(`ALTER TABLE practice_attempts DROP COLUMN scenario_source;`);
    }
    await qr.query(`DROP TABLE IF EXISTS practice_custom_scenarios;`);
  }
}
