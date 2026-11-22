// V2026-11-04 治本 (WP49 — character_profiles 加 1 列大五人格):
//   原因: 任务单 `docs/worklog/completed/phase2/wp49-character-five-factor-personality-2026-11-04.md`
//     §3.4 拍板一列 —— 角色的**大五人格 (OCEAN) 数值**要有地方存. 内核的
//     `PersonalityTraits` 类型早就有 (WP34), 但适配层一次都没传过数据, 于是
//     `resolveAgreeablenessTrustScale()` 里的 `input.traits?.agreeableness` 永远是
//     undefined —— 宜人性调节算子在生产上是**休眠**的.
//
//   §3.4 的列定义 1:1 落地, 0 自由发挥:
//     personality_traits JSON NULL AFTER five_ps
//
//   已有数据怎么办: **不需要 UPDATE** —— `ADD COLUMN ... JSON NULL` 在 MySQL 里把
//     存量行填成 NULL (不是任何默认值). 于是 WP9-B seed 灌进来的那 4 个 vpt slug 行,
//     加列后仍然是"没表态" —— **老角色加列后的行为与加列前逐字一致** (零回归).
//     本期**不**给这 4 个角色灌大五人格: 任务单 §5.2 明确大五人格是可选的, 4 个 DB
//     角色本期不表态 (它们也不进 WP34 的宜人性规则, 因为该列按任务单 §4.3 的口径是 NULL).
//
//   为什么是 **JSON NULL** 而不是 NOT NULL DEFAULT (与 WP51 的两列口径相反):
//     大五人格是**可选**的 —— "没表态"与"正好是 0.5"是两个不同的事实, 给个 DEFAULT
//     就把它们在数据源上抹平了 (适配层的条件展开也就失去意义).
//     另: MySQL 的 JSON 列本来就不该挂 DEFAULT —— 默认值写进 DDL 就是第二份真相源
//     (内核已经有一份: 特质缺省 = 不做特质调节).
//
//   为什么放在 `five_ps` 之后 (而不是 baseline_* 那一组):
//     `five_ps` 是**临床 5Ps** (易感 / 维持 / 诱发 / 保护 / 持续因素), 是给人读的长材料;
//     `personality_traits` 是**大五人格数值**, 是给内核算子吃的. 两者不是一回事
//     (内核 `PersonalityTraits` 的注释里专门警告过), 但并排放能让人一眼看到"这是两列".
//
//   反双胞胎:
//     - **不用 typeorm migration:generate**: bin/ormconfig.ts 的 entities glob 只覆盖
//       src/entity/**, 扫不到本仓实体 → generate 出来是空壳. 仓库 60+ 条 migration 历来
//       手写 DDL, 本条保持一致.
//     - **不用 synchronize**: schema 只走 migration (ADR-0003).
//     - **幂等**: 加之前先查 INFORMATION_SCHEMA —— 缺才加. 重复跑 up 不报错, 半途中断
//       后重跑也能补齐 (跟 WP51 `AddCharacterProfileAllianceBaseline` 同款守卫).
//     - **不改已执行的迁移**: 0013/0023/0025/0027 等已在 dev 库跑过的迁移**一行不动** ——
//       迁移只增不改.
//     - **不写内容进 migration**: 大五人格的**数值**是内容资产 (归种子 / seed 脚本),
//       本条只改 schema.
//     - **不加 DB-level FK / 不落 tenant_id**: system 级资产, 跟 0023 / 0027 同款.
//     - **不加索引**: 本列本期不参与查询 (resolver 的主查询路径仍是 template_id +
//       audit_status/enabled), 加索引是给"还没人查的字段"做优化 —— 过度工程.
//
//   部署顺序 (重要):
//     entity 加了列 → resolver 的 `SELECT` 会带上这一列 → **migration 必须先跑**,
//     否则查询报 "Unknown column 'personality_traits'". 这是加列类迁移的固有代价,
//     与仓库既有 ALTER 迁移 (0019/0022/0024/0027) 同款.
//
//   验证 (大炮跑 pnpm migration:run 后):
//     1. DESCRIBE character_profiles;                  # 27 列 (26 + 1)
//     2. SELECT personality_traits FROM character_profiles;
//        → 存量 4 行全部是 NULL (= 没表态 = 内核不做特质调节)
//     3. pnpm migration:revert → 本列消失; 再 migration:run → 本列回来
//     4. 连跑两次 migration:run → 第二次不报错 (幂等守卫)
//
//   时间戳: 2026-11-04
import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * 本迁移要加的列 (DDL 与 entity 的一一对应; 默认值只有这里一处真相).
 *
 * 为什么把列定义收成常量而不是散在 `qr.query` 调用里:
 *   幂等守卫要判断"在不在", DDL 也要**同一份清单**驱动 —— 才不会出现"守卫查了列 A、
 *   DDL 加了列 B"这种静默漂移.
 */
interface PersonalityTraitsColumnSpec {
  /** 列名 (DB 侧). */
  readonly column: string;
  /** 完整 DDL 片段 (`ADD COLUMN` 之后的部分). */
  readonly ddl: string;
}

const PERSONALITY_TRAITS_COLUMNS: readonly PersonalityTraitsColumnSpec[] = [
  {
    column: 'personality_traits',
    // JSON + NULL, **无 DEFAULT** —— "没表态"与"某个值"必须在数据源上分得开.
    ddl: 'personality_traits JSON NULL AFTER five_ps',
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

export class AddCharacterProfilePersonalityTraits1714900000028 implements MigrationInterface {
  name = 'AddCharacterProfilePersonalityTraits1714900000028';

  public async up(qr: QueryRunner): Promise<void> {
    // 幂等: 逐列判断, 缺才加 (半途中断后重跑能补齐; 重复跑不报错).
    const present = await existingColumns(qr);
    for (const spec of PERSONALITY_TRAITS_COLUMNS) {
      if (present.has(spec.column)) continue;
      await qr.query(`ALTER TABLE character_profiles ADD COLUMN ${spec.ddl};`);
    }
  }

  public async down(qr: QueryRunner): Promise<void> {
    // 回滚: 净删本列 (不动其余 26 列, 不残留数据).
    //   幂等守卫同样给上 —— 回滚一个"只加了一半"的迁移时, 缺列不该让整条 down 失败.
    const present = await existingColumns(qr);
    const drops = PERSONALITY_TRAITS_COLUMNS.filter((spec) => present.has(spec.column)).map((spec) => `DROP COLUMN ${spec.column}`);
    if (drops.length === 0) return;
    await qr.query(`ALTER TABLE character_profiles ${drops.join(', ')};`);
  }
}
