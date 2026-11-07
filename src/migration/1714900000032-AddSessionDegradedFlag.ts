// V2026-11-07 治本 (degraded 会话打标 — training_sessions 加 2 列):
//   原因: 任务单 `docs/worklog/completed/phase2/session-degraded-flag-2026-11-07.md`
//     §4.1 拍板"TrainingSession 表加 2 列 (ALTER TABLE, 不加新表)":
//     `degraded` (tinyint, 默认 0) + `degraded_reason` (varchar(50), 可空).
//
//   列定义 1:1 落地 (与 `src/counselor/entities/training-session.entity.ts` 严格对应):
//     degraded       TINYINT NOT NULL DEFAULT 0
//     degraded_reason VARCHAR(50) NULL
//
//   存量数据怎么办: **不需要 UPDATE** ——
//     `ADD COLUMN ... NOT NULL DEFAULT 0` 在 MySQL 里把存量行填成 0 (= "没降级"),
//     所以迁移前的老会话**全部**保持"参与考核"的原行为 (零回归).
//     这正是任务单 §八 闸门 5 要求的"老会话默认 degraded=0".
//
//   为什么是 **tinyint** 而不是 boolean:
//     MySQL 无原生 boolean, 跟仓库既有 `supervision_schools.is_active` /
//     `training_sessions.informed_consent_required` 口径一致 (代码里用 === 1 判断).
//
//   为什么 `degraded_reason` 可空:
//     "没打标"与"打标了但原因不明"是两件事 —— 给个 DEFAULT 会把它们在数据源上抹平.
//
//   反双胞胎:
//     - **不用 typeorm migration:generate**: bin/ormconfig.ts 的 entities glob 只覆盖
//       src/entity/**, 扫不到本仓实体 → generate 出来是空壳. 仓库 60+ 条 migration
//       历来手写 DDL, 本条保持一致.
//     - **不用 synchronize**: schema 只走 migration (ADR-0003).
//     - **幂等**: 加之前先查 INFORMATION_SCHEMA —— 缺才加. 重复跑 up 不报错, 半途中断
//       后重跑也能补齐 (跟 0028 / 0029 同款守卫).
//     - **不改已执行的迁移**: 0029 及以前的一行不动 —— 迁移只增不改.
//     - **不加索引**: 本列本期只按 user_id 过滤 (idx_ts_tenant_user / idx_ts_user_started
//       已覆盖), 单独给 degraded 建索引是给"还没人查的字段"做优化 —— 过度工程.
//     - **不加 DB-level FK / 不落心理内容**: 纯元数据 (ADR-0003 + 隐私红线).
//
//   部署顺序 (重要):
//     entity 加了列 → 运行时的 SELECT 会带上这一列 → **migration 必须先跑**,
//     否则查询报 "Unknown column 'degraded'". 这是加列类迁移的固有代价,
//     与仓库既有 ALTER 迁移 (0019/0022/0024/0027/0029) 同款.
//
//   验证 (大炮跑 pnpm migration:run 后):
//     1. DESCRIBE training_sessions;              # 29 列 (27 + 2)
//     2. SELECT degraded, degraded_reason FROM training_sessions;
//        → 存量行全部是 0 / NULL (= 没降级 = 照旧参与考核)
//     3. 连跑两次 migration:run → 第二次不报错 (幂等守卫)
//     4. pnpm migration:revert → 这两列消失; 再 migration:run → 两列回来
//
//   时间戳: 2026-11-07
import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * 本迁移要加的列 (DDL 与 entity 的一一对应; 默认值只有这里一处真相).
 *
 * 为什么把列定义收成常量而不是散在 `qr.query` 调用里:
 *   幂等守卫要判断"在不在", DDL 也要**同一份清单**驱动 —— 才不会出现"守卫查了列 A、
 *   DDL 加了列 B"这种静默漂移.
 */
interface SessionDegradedColumnSpec {
  /** 列名 (DB 侧). */
  readonly column: string;
  /** 完整 DDL 片段 (`ADD COLUMN` 之后的部分). */
  readonly ddl: string;
}

/** training_sessions 的 degraded 两列. */
const SESSION_DEGRADED_COLUMNS: readonly SessionDegradedColumnSpec[] = [
  {
    column: 'degraded',
    // tinyint NOT NULL DEFAULT 0 —— 存量行加列后自动是 0 (= 没降级), 零回归.
    ddl: 'degraded TINYINT NOT NULL DEFAULT 0 AFTER character_version',
  },
  {
    column: 'degraded_reason',
    // 可空 = "没打标"; 不给 DEFAULT (默认值会抹平"没打标"与"原因不明"的差别).
    ddl: 'degraded_reason VARCHAR(50) NULL AFTER degraded',
  },
];

/**
 * 查表里已有的列名 (INFORMATION_SCHEMA; 走 DATABASE() = 当前连接的库).
 *
 * @param qr 查询执行器
 * @returns 已存在的列名集合
 */
async function existingColumns(qr: QueryRunner): Promise<Set<string>> {
  const rows = (await qr.query(
    `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'training_sessions'`,
  )) as Record<string, unknown>[];
  return new Set(rows.map((row) => (typeof row['COLUMN_NAME'] === 'string' ? row['COLUMN_NAME'] : '')));
}

export class AddSessionDegradedFlag1714900000032 implements MigrationInterface {
  name = 'AddSessionDegradedFlag1714900000032';

  /**
   * 加两列 (幂等: 缺才加).
   *
   * @param qr 查询执行器
   */
  public async up(qr: QueryRunner): Promise<void> {
    const present = await existingColumns(qr);
    for (const spec of SESSION_DEGRADED_COLUMNS) {
      if (present.has(spec.column)) continue;
      await qr.query(`ALTER TABLE training_sessions ADD COLUMN ${spec.ddl};`);
    }
  }

  /**
   * 回滚 (净删本单加的两列, 不动其余列).
   *
   * @param qr 查询执行器
   */
  public async down(qr: QueryRunner): Promise<void> {
    const present = await existingColumns(qr);
    const drops = SESSION_DEGRADED_COLUMNS.filter((spec) => present.has(spec.column)).map((spec) => `DROP COLUMN ${spec.column}`);
    if (drops.length === 0) return;
    await qr.query(`ALTER TABLE training_sessions ${drops.join(', ')};`);
  }
}
