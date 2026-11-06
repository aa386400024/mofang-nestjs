// V2026-11-06 治本 (WP38 — 角色版本 semver + 会话绑定版本):
//   原因: 任务单 docs/worklog/pending/wp38-character-semver-and-debug-event-tags-2026-11-06.md
//     §2.1 —— 角色版本从"简单自增 int"升级成 semver (major/minor/patch), 并让会话绑定版本.
//
//   本迁移做 3 件事 (一条迁移做完, 避免"加了列但表还没建"的中间态):
//     ① character_profiles 加 3 列: version_major / version_minor / version_patch
//        (INT NOT NULL DEFAULT 1 / 0 / 0 —— 存量行加列后自动是 1.0.0, 零回归);
//     ② 新表 character_profile_versions (9 列 + 2 索引): 每次改版留一份完整快照;
//     ③ training_sessions 加 2 列: character_template_id / character_version
//        (会话建的时候绑定当时的角色与版本).
//
//   ③ 为什么必须**同时**加 character_template_id (任务单 §3.1 只提了 character_version):
//     任务单 §3.1 写"查 training_sessions 里 character_template_id = ? 判活跃会话",
//     但该列**当时并不存在** (角色只留在 turn_debug_trace 的 JSON 里) —— 照字面做会查不到.
//     不加这列, 主版本锁定就无从判定 (查什么?), 会话存的版本也无从归属 (谁的版本?).
//     所以本迁移把两列一起加: 一列回答"是谁的版本", 一列回答"哪一版".
//
//   存量数据怎么办: **不需要 UPDATE**.
//     · character_profiles 三列由 DEFAULT 填成 1/0/0 (= 1.0.0), 行为与加列前逐字一致;
//     · training_sessions 两列存量行是 NULL —— **不回填**: 回填等于伪造"当时用的是哪版"
//       (迁移前的会话其实用的就是那时的角色, 但我们已经无从知道是哪一版了).
//       NULL 的语义就是"不知道" —— 诚实, 也让主版本锁定只覆盖迁移后的会话 (零回归).
//
//   反双胞胎:
//     - **不用 typeorm migration:generate**: bin/ormconfig.ts 的 entities glob 只覆盖
//       src/entity/**, 扫不到本仓实体 → generate 出来是空壳. 仓库 60+ 条 migration 历来
//       手写 DDL, 本条保持一致.
//     - **不用 synchronize**: schema 只走 migration (ADR-0003).
//     - **幂等**: 加列前查 INFORMATION_SCHEMA (缺才加); 建表用 IF NOT EXISTS.
//       重复跑 up 不报错, 半途中断后重跑能补齐.
//     - **不改已执行的迁移**: 0013/0023/0025/0027/0028 等已在 dev 库跑过的一行不动.
//     - **不加 DB-level FK**: character_profile_versions.template_id 与
//       training_sessions.character_template_id 都是逻辑外键, 跟 ADR-0003 一致.
//     - **不给历史表加 updated_at**: 它是 append-only 的版本事实, 不是可改的行
//       (同 student_risk_events 的口径).
//     - **不写内容进 migration**: 版本快照由管理服务在运行时写, 本条只改 schema.
//
//   部署顺序 (重要):
//     entity 加了列 → 运行时读写会带上这些列 → **migration 必须先跑**,
//     否则报 "Unknown column 'version_major'". 这是加列类迁移的固有代价.
//
//   验证 (大炮跑 pnpm migration:run 后):
//     1. DESCRIBE character_profiles;                    # 30 列 (27 + 3)
//     2. SHOW TABLES LIKE 'character_profile_versions';   # 1 张表
//     3. DESCRIBE character_profile_versions;            # 9 列
//     4. SHOW INDEX FROM character_profile_versions;      # PRIMARY + 2 索引
//     5. DESCRIBE training_sessions;                     # 27 列 (25 + 2)
//     6. SELECT version_major, version_minor, version_patch FROM character_profiles;
//        → 存量行全部 1 / 0 / 0
//     7. 连跑两次 migration:run → 第二次不报错 (幂等守卫)
//
//   时间戳: 2026-11-06
import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * 要加的列 (DDL 与 entity 的一一对应; 默认值只有这里一处真相).
 *
 * 为什么把列定义收成常量而不是散在 query 调用里:
 *   幂等守卫要判断"在不在", DDL 也要**同一份清单**驱动 —— 才不会出现"守卫查了列 A、
 *   DDL 加了列 B"这种静默漂移.
 */
interface ColumnSpec {
  /** 列名 (DB 侧). */
  readonly column: string;
  /** 完整 DDL 片段 (ADD COLUMN 之后的部分). */
  readonly ddl: string;
}

/** character_profiles 的 semver 三列. */
const CHARACTER_VERSION_COLUMNS: readonly ColumnSpec[] = [
  {
    column: 'version_major',
    ddl: 'version_major INT NOT NULL DEFAULT 1 AFTER version',
  },
  {
    column: 'version_minor',
    ddl: 'version_minor INT NOT NULL DEFAULT 0 AFTER version_major',
  },
  {
    column: 'version_patch',
    ddl: 'version_patch INT NOT NULL DEFAULT 0 AFTER version_minor',
  },
];

/** training_sessions 的角色绑定两列. */
const SESSION_CHARACTER_COLUMNS: readonly ColumnSpec[] = [
  {
    column: 'character_template_id',
    ddl: 'character_template_id VARCHAR(64) NULL AFTER supervision_report_id',
  },
  {
    column: 'character_version',
    ddl: 'character_version VARCHAR(32) NULL AFTER character_template_id',
  },
];

/**
 * 查表里已有的列名 (INFORMATION_SCHEMA; 走 DATABASE() = 当前连接的库).
 *
 * @param qr 查询执行器
 * @param table 表名
 * @returns 已存在的列名集合
 */
async function existingColumns(qr: QueryRunner, table: string): Promise<Set<string>> {
  const rows = (await qr.query(
    `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
    [table],
  )) as Record<string, unknown>[];
  return new Set(rows.map((row) => (typeof row['COLUMN_NAME'] === 'string' ? row['COLUMN_NAME'] : '')));
}

/**
 * 给表加一组列 (幂等: 缺才加).
 *
 * @param qr 查询执行器
 * @param table 表名
 * @param specs 列清单
 */
async function addColumns(qr: QueryRunner, table: string, specs: readonly ColumnSpec[]): Promise<void> {
  const present = await existingColumns(qr, table);
  for (const spec of specs) {
    if (present.has(spec.column)) continue;
    await qr.query(`ALTER TABLE ${table} ADD COLUMN ${spec.ddl};`);
  }
}

/**
 * 给表删一组列 (幂等: 有才删).
 *
 * @param qr 查询执行器
 * @param table 表名
 * @param specs 列清单
 */
async function dropColumns(qr: QueryRunner, table: string, specs: readonly ColumnSpec[]): Promise<void> {
  const present = await existingColumns(qr, table);
  const drops = specs.filter((spec) => present.has(spec.column)).map((spec) => `DROP COLUMN ${spec.column}`);
  if (drops.length === 0) return;
  await qr.query(`ALTER TABLE ${table} ${drops.join(', ')};`);
}

export class AddCharacterVersionSemver1714900000029 implements MigrationInterface {
  name = 'AddCharacterVersionSemver1714900000029';

  public async up(qr: QueryRunner): Promise<void> {
    // ① character_profiles 加 semver 三列 (存量行自动 1.0.0).
    await addColumns(qr, 'character_profiles', CHARACTER_VERSION_COLUMNS);

    // ② 新表 character_profile_versions (append-only 的版本快照).
    await qr.query(`
      CREATE TABLE IF NOT EXISTS character_profile_versions (
        id CHAR(36) NOT NULL PRIMARY KEY,
        template_id VARCHAR(64) NOT NULL,
        version_major INT NOT NULL,
        version_minor INT NOT NULL,
        version_patch INT NOT NULL,
        change_type VARCHAR(16) NOT NULL,
        snapshot JSON NOT NULL,
        changed_by VARCHAR(64) NULL,
        created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        UNIQUE KEY uniq_cpv_template_version (template_id, version_major, version_minor, version_patch),
        INDEX idx_cpv_template_created (template_id, created_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // ③ training_sessions 加角色绑定两列 (存量行 NULL = 不知道当时用的哪版).
    await addColumns(qr, 'training_sessions', SESSION_CHARACTER_COLUMNS);
  }

  public async down(qr: QueryRunner): Promise<void> {
    // 回滚顺序与 up 相反: 先去掉会话侧的引用, 再删历史表, 最后去掉 semver 三列.
    await dropColumns(qr, 'training_sessions', SESSION_CHARACTER_COLUMNS);
    await qr.query('DROP TABLE IF EXISTS character_profile_versions;');
    await dropColumns(qr, 'character_profiles', CHARACTER_VERSION_COLUMNS);
  }
}
