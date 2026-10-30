// V2026-10-30 治本 (WP10A — character_profiles 加 3 列表达风格基线字段):
//   原因: 任务单 `docs/progress/engine-wp10a-character-expression-style-fields-backend-2026-10-30.md`
//     §1 拍板三个**角色人格特质**字段 (话量基线 / 叙事风格 / 语态倾向) —— 它们属于角色基线,
//     不是剧本节点的行为模式. 表刚建 (WP9-B), 现在加列成本最低.
//
//   §1.1 的列定义 1:1 落地, 0 自由发挥:
//     speech_volume_baseline FLOAT      NOT NULL DEFAULT 0.5
//     narrative_style        VARCHAR(20) NOT NULL DEFAULT 'mixed'
//     expression_tone        VARCHAR(20) NOT NULL DEFAULT 'restrained'
//
//   已有数据怎么办: **不需要 UPDATE** —— `ADD COLUMN ... NOT NULL DEFAULT <值>` 在 MySQL 里
//     会把存量行直接填成该 DEFAULT (不是 NULL). 所以 WP9-B seed 灌进来的那 4 个 vpt slug
//     行, 加列后自动就是 0.5 / 'mixed' / 'restrained', 一条 UPDATE 都不写.
//
//   反双胞胎:
//     - **不用 typeorm migration:generate**: bin/ormconfig.ts 的 entities glob 只覆盖
//       src/entity/**, 扫不到本仓实体 → generate 出来是空壳. 仓库 60+ 条 migration 历来
//       手写 DDL, 本条保持一致.
//     - **不用 synchronize**: schema 只走 migration (ADR-0003).
//     - **幂等**: 每列加之前先查 INFORMATION_SCHEMA —— 缺才加. 重复跑 up 不报错,
//       半途中断后重跑也能补齐 (跟 WP19 `AddTurnDebugTrace` 同款守卫).
//     - **不改已执行的迁移**: 0013/0023 等已在 dev 库跑过的迁移**一行不动** —— 迁移只增不改.
//     - **不写内容进 migration**: 表达风格是**内容资产** (Phase2 P1 要逐个角色标定),
//       归 seed 脚本; migration 只改 schema.
//     - **不加 DB-level FK / 不落 tenant_id**: system 级资产, 跟 0023 同款.
//     - **不加索引**: 这三列本期不参与查询 (resolver 的主查询路径仍是 template_id +
//       audit_status/enabled), 加索引是给"还没人查的字段"做优化 —— 过度工程.
//
//   部署顺序 (重要):
//     entity 加了列 → resolver 的 `SELECT` 会带上这三列 → **migration 必须先跑**,
//     否则查询报 "Unknown column 'speech_volume_baseline'". 这是加列类迁移的固有代价,
//     与仓库既有 ALTER 迁移 (0019/0022/0024) 同款.
//
//   验证 (大炮跑 pnpm migration:run 后):
//     1. DESCRIBE character_profiles;                  # 24 列 (21 + 3)
//     2. SELECT speech_volume_baseline, narrative_style, expression_tone FROM character_profiles;
//        → 存量 4 行全部是 0.5 / 'mixed' / 'restrained' (DEFAULT 自动填充)
//     3. pnpm migration:revert → 三列消失; 再 migration:run → 三列回来
//     4. 连跑两次 migration:run → 第二次不报错 (幂等守卫)
//
//   时间戳: 2026-10-30
import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * 本迁移要加的三列 (DDL 与 entity 的一一对应; 默认值只有这里一处真相).
 *
 * 为什么把列定义收成常量而不是散在三个 `qr.query` 调用里:
 *   幂等守卫要**逐列**判断"在不在", DDL 也要**逐列**执行 —— 同一份列清单驱动两件事,
 *   才不会出现"守卫查了列 A、DDL 加了列 B"这种静默漂移.
 */
interface ExpressionColumnSpec {
  /** 列名 (DB 侧). */
  readonly column: string;
  /** 完整 DDL 片段 (`ADD COLUMN` 之后的部分). */
  readonly ddl: string;
}

const EXPRESSION_COLUMNS: readonly ExpressionColumnSpec[] = [
  {
    column: 'speech_volume_baseline',
    ddl: 'speech_volume_baseline FLOAT NOT NULL DEFAULT 0.5 AFTER baseline_emotion_arousal',
  },
  { column: 'narrative_style', ddl: "narrative_style VARCHAR(20) NOT NULL DEFAULT 'mixed' AFTER speech_volume_baseline" },
  {
    column: 'expression_tone',
    ddl: "expression_tone VARCHAR(20) NOT NULL DEFAULT 'restrained' AFTER narrative_style",
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

export class AddCharacterProfileExpressionFields1714900000025 implements MigrationInterface {
  name = 'AddCharacterProfileExpressionFields1714900000025';

  public async up(qr: QueryRunner): Promise<void> {
    // 幂等: 逐列判断, 缺才加 (半途中断后重跑能补齐; 重复跑不报错).
    const present = await existingColumns(qr);
    for (const spec of EXPRESSION_COLUMNS) {
      if (present.has(spec.column)) continue;
      await qr.query(`ALTER TABLE character_profiles ADD COLUMN ${spec.ddl};`);
    }
  }

  public async down(qr: QueryRunner): Promise<void> {
    // 回滚: 净删这 3 列 (不动其余 21 列, 不残留数据).
    //   幂等守卫同样给上 —— 回滚一个"只加了一半"的迁移时, 缺列不该让整条 down 失败.
    const present = await existingColumns(qr);
    const drops = EXPRESSION_COLUMNS.filter((spec) => present.has(spec.column)).map((spec) => `DROP COLUMN ${spec.column}`);
    if (drops.length === 0) return;
    await qr.query(`ALTER TABLE character_profiles ${drops.join(', ')};`);
  }
}
