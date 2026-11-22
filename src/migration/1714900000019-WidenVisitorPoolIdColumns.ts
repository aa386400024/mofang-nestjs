// V2026-10-23 治本 (AI 模拟来访池 — 把 3 个 id 列从 CHAR(36) 放宽到 VARCHAR(64)):
//   原因: 首次落库时 `npm run seed:visitor-pool` 报 "Data too long for column 'id'":
//     模板 id 是**内容 slug** (形如 `vpt_self_worth_intellectualization_l1` = 37 字符),
//     而 1714900000018 建表时按 UUID 的形状用了 `CHAR(36)` —— 列宽与 id 方案错配.
//     根因不是"某个 id 写长了", 而是**列宽不匹配 id 方案**: 仓库既有的 `quotes.id`
//     早就是 `varchar(64)` (它同样是内容 slug 主键), 这里却照抄了 UUID 的 36.
//     受影响的 3 列 (都是同一个 id 在不同表里的落点, 必须一起改, 否则收藏路径会以
//     同样的方式炸):
//       ① visitor_pool_templates.id             (主键)
//       ② visitor_pool_favorites.template_id    (收藏关系指向模板)
//       ③ visitor_full_personas.source_template_id (私有副本标注来源)
//     另外 `vpt_social_anxiety_intellectualization_l1` 这类未来组合是 40 字符 ——
//     36 是个 UUID 形状的偶然限制, 不是内容 slug 的合理上界.
//
//   修法: 新增本 migration 把 3 列放宽到 VARCHAR(64) (与 quotes.id 对齐).
//     **不改 1714900000018**: 它已在 dev 库执行过, 修改已执行的迁移会造成
//     "新库 (只跑 0018) 与老库 (跑 0018+0019) 结构分叉" —— 迁移必须**只增不改**.
//
//   反双胞胎:
//     - 不用"把 id 缩短到 36 以内"打补丁: 那是迁就错误列宽, 下一条内容 slug 就会再炸.
//     - 不改用 UUID 主键 + 另加 slug 列: 那样会让对外的 `templateId` 变成不透明 UUID,
//       而 spec §3.1/§3.3 的响应示例本身就把 templateId 写成 `tpl_01` 这类 slug,
//       且前端 templateId 恒来自列表响应 (不需要硬编码) —— slug 主键是更贴契约的选择.
//     - 3 列一起改: id 在三张表间流转, 只改一处 = 把错误从一张表挪到另一张表.
//
//   验证 (大炮跑 pnpm migration:run 后):
//     1. SHOW COLUMNS FROM visitor_pool_templates LIKE 'id';            # varchar(64)
//     2. SHOW COLUMNS FROM visitor_pool_favorites LIKE 'template_id';   # varchar(64)
//     3. SHOW COLUMNS FROM visitor_full_personas LIKE 'source_template_id'; # varchar(64)
//     4. npm run seed:visitor-pool → 6 条全部成功 (前 4 条幂等未变, 后 2 条新增)
//
//   时间戳: 2026-10-23
import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * 把 `QueryRunner.query()` 的 any 返回值收成"行数组".
 *
 * 原因: `query()` 的返回类型是 `Promise<any>`, 直接赋值给变量会触发
 *   `@typescript-eslint/no-unsafe-assignment`. 跟 1714900000016 / 0018 同款收口.
 */
function asRows(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? (value as Record<string, unknown>[]) : [];
}

/**
 * 取某列的当前类型 (大写, 如 "VARCHAR(64)").
 *
 * @param qr 查询执行器
 * @param table 表名
 * @param column 列名
 */
async function readColumnType(qr: QueryRunner, table: string, column: string): Promise<string> {
  const rows = asRows(await qr.query(`SHOW COLUMNS FROM ${table} LIKE '${column}';`));
  const first = rows[0];
  const type = first && typeof first['Type'] === 'string' ? first['Type'] : '';
  return type.toUpperCase();
}

export class WidenVisitorPoolIdColumns1714900000019 implements MigrationInterface {
  name = 'WidenVisitorPoolIdColumns1714900000019';

  public async up(qr: QueryRunner): Promise<void> {
    // 幂等: 已是 varchar(64) 就跳过 (重复执行不报错, 也不做无谓的 ALTER).
    const templateIdType = await readColumnType(qr, 'visitor_pool_templates', 'id');
    if (templateIdType && !templateIdType.includes('VARCHAR(64)')) {
      await qr.query(`ALTER TABLE visitor_pool_templates MODIFY COLUMN id VARCHAR(64) NOT NULL;`);
    }

    const favoriteType = await readColumnType(qr, 'visitor_pool_favorites', 'template_id');
    if (favoriteType && !favoriteType.includes('VARCHAR(64)')) {
      await qr.query(`ALTER TABLE visitor_pool_favorites MODIFY COLUMN template_id VARCHAR(64) NOT NULL;`);
    }

    const sourceType = await readColumnType(qr, 'visitor_full_personas', 'source_template_id');
    if (sourceType && !sourceType.includes('VARCHAR(64)')) {
      await qr.query(`ALTER TABLE visitor_full_personas MODIFY COLUMN source_template_id VARCHAR(64) NULL;`);
    }
  }

  public async down(qr: QueryRunner): Promise<void> {
    // 回滚: 收回 CHAR(36).
    // 注意: 若已有 id 长度 > 36 的行 (即本 migration 放宽后才灌入的 slug), 收窄会失败 ——
    // 这是**预期行为**: 收窄是破坏性的, 该报错比静默截断 id (导致 id 撞号/查不到) 好.
    const templateIdType = await readColumnType(qr, 'visitor_pool_templates', 'id');
    if (templateIdType && !templateIdType.includes('CHAR(36)')) {
      await qr.query(`ALTER TABLE visitor_pool_templates MODIFY COLUMN id CHAR(36) NOT NULL;`);
    }

    const favoriteType = await readColumnType(qr, 'visitor_pool_favorites', 'template_id');
    if (favoriteType && !favoriteType.includes('CHAR(36)')) {
      await qr.query(`ALTER TABLE visitor_pool_favorites MODIFY COLUMN template_id CHAR(36) NOT NULL;`);
    }

    const sourceType = await readColumnType(qr, 'visitor_full_personas', 'source_template_id');
    if (sourceType && !sourceType.includes('CHAR(36)')) {
      await qr.query(`ALTER TABLE visitor_full_personas MODIFY COLUMN source_template_id CHAR(36) NULL;`);
    }
  }
}
