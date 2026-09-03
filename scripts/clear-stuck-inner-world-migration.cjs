#!/usr/bin/env node
/**
 * clear-stuck-inner-world-migration.cjs — V2026-09-03 一次性清脏数据脚本.
 *
 * 背景:
 *   InitInnerWorld1700000008000 在 MySQL 8.0 上首次跑时, 因为
 *     (a) gen_random_uuid() 不存在 (PostgreSQL/MariaDB 10.7+ 专属)
 *     (b) CREATE INDEX IF NOT EXISTS 不支持 (MariaDB 专属)
 *   导致 CREATE TABLE 一连串报错. 但 TypeORM 在某些路径下仍把 migration entry 写进了
 *   migrations 表 (跟 schema 真实状态脱钩),  之后 pnpm migration:run 永远
 *   "No migrations are pending", inner_world_* 6 张表始终不建 → bootstrap 500.
 *
 * 跟 smoke-inner-world.cjs 的区别:
 *   - smoke-inner-world 是验收测试 (spawn 子进程, 走 HTTP)
 *   - 这个是数据修复 (直连 DB, 走 SQL)
 *
 * 工作流 (跟你的两行 SQL 等价, 多 SELECT 预览 + DELETE + 验证 + 失败兜底):
 *   1. 从 .env 读 DB_HOST / DB_PORT / DB_USER / DB_PASSWORD / DB_NAME (loadEnvFile,
 *      跟 bin/ormconfig.ts 同模式)
 *   2. 用 mysql2/promise 连库
 *   3. SELECT * FROM migrations WHERE name LIKE '%InitInnerWorld%'
 *      → 0 行: 干净, exit 0 (说明之前 revert 已清干净, 直接 pnpm migration:run 即可)
 *      → N 行: 打印让用户看清要删啥
 *   4. DELETE FROM migrations WHERE name = 'InitInnerWorld1700000008000'
 *   5. 再 SELECT COUNT(*) 验证 entry 真的没了
 *   6. 提示下一步 pnpm migration:run
 *
 * 跨平台:
 *   - Windows / macOS / Linux 通吃
 *   - 不引入新依赖 (用项目已有的 mysql2/promise)
 *   - 不改 package.json / tsconfig / nest-cli.json / .env
 *
 * 用法 (用户自己跑, 我不替你执行 — 按你的红线):
 *   node scripts/clear-stuck-inner-world-migration.cjs
 *   pnpm migration:run
 *
 * 安全:
 *   - 只 DELETE name = 'InitInnerWorld1700000008000' 精确匹配, 不会误伤其它 migration
 *   - 操作前 SELECT 给用户看, 操作后 COUNT 验证
 *   - 不 DROP TABLE — 表如果已存在保留 (虽然实际根本不存在)
 *   - 只删 migrations 表 entry, 不动业务表
 */

const mysql = require('mysql2/promise');
const path = require('node:path');
const fs = require('node:fs');
const { loadEnvFile } = require('node:process');

// ─── .env 加载 ────────────────────────────────────────────────────────────
// 跟 smoke-inner-world.cjs (line 79-86) / bin/ormconfig.ts (line 2) 同模式.
const ENV_FILE = path.join(__dirname, '..', '.env');
if (fs.existsSync(ENV_FILE)) {
  loadEnvFile(ENV_FILE);
}

const TARGET_MIGRATION = 'InitInnerWorld1700000008000';

// ANSI 配色 (跟 smoke-inner-world.cjs line 220 保持一致).
const CLR = {
  reset: '\u001b[0m',
  red: '\u001b[31m',
  green: '\u001b[32m',
  yellow: '\u001b[33m',
  cyan: '\u001b[36m',
  dim: '\u001b[2m',
};

async function main() {
  const host = process.env.DB_HOST;
  const port = Number(process.env.DB_PORT ?? 3306);
  const user = process.env.DB_USER;
  const password = process.env.DB_PASSWORD ?? '';
  const database = process.env.DB_NAME;

  if (!host || !user || !database) {
    console.error(`${CLR.red}[FAIL]${CLR.reset} .env 缺 DB_HOST / DB_USER / DB_NAME (host=${host}, user=${user}, db=${database})`);
    process.exit(1);
  }

  console.log(`${CLR.cyan}[migration-cleanup]${CLR.reset} 连 mysql://${user}@${host}:${port}/${database} ...`);
  const conn = await mysql.createConnection({ host, port, user, password, database });

  try {
    // ─── 1. SELECT 预览 ──────────────────────────────────────────────
    const [rows] = await conn.execute(
      'SELECT id, name, timestamp FROM migrations WHERE name LIKE ? ORDER BY id DESC',
      ['%InitInnerWorld%'],
    );

    if (rows.length === 0) {
      console.log(`${CLR.yellow}[skip]${CLR.reset} migrations 表里没有匹配 %InitInnerWorld% 的 entry, 无需清理`);
      console.log(`  说明: 之前的 migration:revert 已经把脏数据清干净了, 直接 pnpm migration:run 即可`);
      console.log(`  也可能是你跑过这条脚本了 — 幂等, 重复跑无害`);
      return;
    }

    console.log(`${CLR.cyan}[step]${CLR.reset} 在 migrations 表里找到 ${rows.length} 条 InitInnerWorld 相关 entry:`);
    for (const row of rows) {
      console.log(`  id=${row.id}  name=${CLR.yellow}${row.name}${CLR.reset}  timestamp=${row.timestamp}`);
    }

    // ─── 2. DELETE 精确匹配 ───────────────────────────────────────────
    const [result] = await conn.execute(
      'DELETE FROM migrations WHERE name = ?',
      [TARGET_MIGRATION],
    );
    const affected = result.affectedRows;
    console.log(`${CLR.green}[OK]${CLR.reset} DELETE FROM migrations WHERE name = '${TARGET_MIGRATION}' → affected ${affected} 行`);

    if (affected === 0) {
      console.log(`${CLR.yellow}[warn]${CLR.reset} 精确匹配 name='${TARGET_MIGRATION}' 一条都没删掉 (上面 SELECT 看到的可能是大小写 / 前后缀变体)`);
      console.log(`  上面的 SELECT 结果里如果还有残留, 请检查大小写后手动调整脚本里 TARGET_MIGRATION`);
    }

    // ─── 3. 验证 ────────────────────────────────────────────────────────
    const [verify] = await conn.execute(
      'SELECT COUNT(*) AS cnt FROM migrations WHERE name = ?',
      [TARGET_MIGRATION],
    );
    if (verify[0].cnt === 0) {
      console.log(`${CLR.green}[OK]${CLR.reset} 验证通过: migrations 表里已无 '${TARGET_MIGRATION}'`);
    } else {
      console.error(`${CLR.red}[FAIL]${CLR.reset} 验证失败: 还有 ${verify[0].cnt} 条 '${TARGET_MIGRATION}' 残留`);
      process.exit(1);
    }

    console.log('');
    console.log(`${CLR.cyan}[next]${CLR.reset} 现在跑:`);
    console.log(`  pnpm migration:run`);
    console.log(`预期: InitInnerWorld1700000008000 重新执行 → 6 张 inner_world_* 表落地 (CREATE TABLE 用 UUID() / CREATE INDEX 去掉 IF NOT EXISTS)`);
  } finally {
    await conn.end();
  }
}

main().catch((err) => {
  console.error(`${CLR.red}[FAIL]${CLR.reset} ${err.message}`);
  if (err.code) console.error(`  code=${err.code}`);
  if (err.sqlMessage) console.error(`  sqlMessage=${err.sqlMessage}`);
  process.exit(1);
});