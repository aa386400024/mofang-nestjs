// V2026-11-04 治本 (WP51 — character_profiles 加 2 列同盟三维基线):
//   原因: 任务单 `docs/worklog/completed/phase2/wp51-character-seed-alliance-baseline-2026-11-04.md`
//     §3.6 拍板两列 —— 角色种子要能给出**开场**的安全感 / 联结感, 按依恋风格分化
//     (回避型 safety 低, 焦虑型 safety 中等偏低但 bond 高).
//
//   §3.6 的列定义 1:1 落地, 0 自由发挥:
//     baseline_safety FLOAT NOT NULL DEFAULT 0.5
//     baseline_bond   FLOAT NOT NULL DEFAULT 0
//
//   已有数据怎么办: **不需要 UPDATE** —— `ADD COLUMN ... NOT NULL DEFAULT <值>` 在 MySQL 里
//     会把存量行直接填成该 DEFAULT (不是 NULL). 所以 WP9-B seed 灌进来的那 4 个 vpt slug
//     行, 加列后自动就是 0.5 / 0 —— **老角色的开场行为与加列前逐字一致** (零回归).
//     补值靠重跑 `npm run seed:character-profiles` (幂等 upsert → hasDrift 命中 → UPDATE).
//
//   默认值为什么是 0.5 / 0:
//     与内核 `DEFAULT_SAFETY` (0.5) / `DEFAULT_BOND` (0) 对齐 —— DB 默认值与内核
//     默认值是**同一个口径**, 否则会出现"库里是 0.5、内核兜底是 0.3"这种静默分裂.
//
//   反双胞胎:
//     - **不用 typeorm migration:generate**: bin/ormconfig.ts 的 entities glob 只覆盖
//       src/entity/**, 扫不到本仓实体 → generate 出来是空壳. 仓库 60+ 条 migration 历来
//       手写 DDL, 本条保持一致.
//     - **不用 synchronize**: schema 只走 migration (ADR-0003).
//     - **幂等**: 每列加之前先查 INFORMATION_SCHEMA —— 缺才加. 重复跑 up 不报错,
//       半途中断后重跑也能补齐 (跟 WP10A `AddCharacterProfileExpressionFields` 同款守卫).
//     - **不改已执行的迁移**: 0013/0023/0025 等已在 dev 库跑过的迁移**一行不动** ——
//       迁移只增不改.
//     - **不写内容进 migration**: 两列的**数值**是内容资产 (归 seed 脚本), 本条只改 schema.
//     - **不加 DB-level FK / 不落 tenant_id**: system 级资产, 跟 0023 同款.
//     - **不加索引**: 这两列本期不参与查询 (resolver 的主查询路径仍是 template_id +
//       audit_status/enabled), 加索引是给"还没人查的字段"做优化 —— 过度工程.
//
//   部署顺序 (重要):
//     entity 加了列 → resolver 的 `SELECT` 会带上这两列 → **migration 必须先跑**,
//     否则查询报 "Unknown column 'baseline_safety'". 这是加列类迁移的固有代价,
//     与仓库既有 ALTER 迁移 (0019/0022/0024) 同款.
//     再跑 seed 补 4 个角色的值 (可选 —— 不跑也只是回到 DEFAULT 0.5 / 0).
//
//   验证 (大炮跑 pnpm migration:run 后):
//     1. DESCRIBE character_profiles;                  # 26 列 (24 + 2)
//     2. SELECT baseline_safety, baseline_bond FROM character_profiles;
//        → 存量 4 行全部是 0.5 / 0 (DEFAULT 自动填充)
//     3. npm run seed:character-profiles → 4 行更新 (补 0.25/0.05 或 0.4/0.5);
//        连跑两次行数不变
//     4. pnpm migration:revert → 两列消失; 再 migration:run → 两列回来
//     5. 连跑两次 migration:run → 第二次不报错 (幂等守卫)
//
//   时间戳: 2026-11-04
import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * 本迁移要加的两列 (DDL 与 entity 的一一对应; 默认值只有这里一处真相).
 *
 * 为什么把列定义收成常量而不是散在两个 `qr.query` 调用里:
 *   幂等守卫要**逐列**判断"在不在", DDL 也要**逐列**执行 —— 同一份列清单驱动两件事,
 *   才不会出现"守卫查了列 A、DDL 加了列 B"这种静默漂移.
 */
interface AllianceBaselineColumnSpec {
  /** 列名 (DB 侧). */
  readonly column: string;
  /** 完整 DDL 片段 (`ADD COLUMN` 之后的部分). */
  readonly ddl: string;
}

const ALLIANCE_BASELINE_COLUMNS: readonly AllianceBaselineColumnSpec[] = [
  {
    column: 'baseline_safety',
    ddl: 'baseline_safety FLOAT NOT NULL DEFAULT 0.5 AFTER baseline_emotion_arousal',
  },
  {
    column: 'baseline_bond',
    ddl: 'baseline_bond FLOAT NOT NULL DEFAULT 0 AFTER baseline_safety',
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
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'character_profiles'`,
  )) as Record<string, unknown>[];
  return new Set(rows.map((row) => (typeof row['COLUMN_NAME'] === 'string' ? row['COLUMN_NAME'] : '')));
}

export class AddCharacterProfileAllianceBaseline1714900000027 implements MigrationInterface {
  name = 'AddCharacterProfileAllianceBaseline1714900000027';

  public async up(qr: QueryRunner): Promise<void> {
    // 幂等: 逐列判断, 缺才加 (半途中断后重跑能补齐; 重复跑不报错).
    const present = await existingColumns(qr);
    for (const spec of ALLIANCE_BASELINE_COLUMNS) {
      if (present.has(spec.column)) continue;
      await qr.query(`ALTER TABLE character_profiles ADD COLUMN ${spec.ddl};`);
    }
  }

  public async down(qr: QueryRunner): Promise<void> {
    // 回滚: 净删这 2 列 (不动其余 24 列, 不残留数据).
    //   幂等守卫同样给上 —— 回滚一个"只加了一半"的迁移时, 缺列不该让整条 down 失败.
    const present = await existingColumns(qr);
    const drops = ALLIANCE_BASELINE_COLUMNS.filter((spec) => present.has(spec.column)).map((spec) => `DROP COLUMN ${spec.column}`);
    if (drops.length === 0) return;
    await qr.query(`ALTER TABLE character_profiles ${drops.join(', ')};`);
  }
}
