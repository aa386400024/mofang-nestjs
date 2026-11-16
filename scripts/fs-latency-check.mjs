/**
 * 文件读取延迟体检（闸门可信度的前置条件）。
 *
 * 背景：本机曾因安全软件 minifilter 按 inode 收税，导致 node_modules 中约 35%
 * 的文件每次读取要付 200-260ms（读 200 个文件 16.5s，全量 vitest 1102.6s）。
 * 根因是 pnpm 默认 hardlink 装法让 node_modules 继承了 store 的旧 inode。
 * 修复动作：pnpm install --force --config.package-import-method=copy
 *
 * 用法：pnpm doctor:fs [目录] [文件数]
 * 判定：均值 <1ms/文件 且 慢文件（>5ms）占比 <5%，否则 exit 1 并给修复指引。
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const root = process.argv[2] ?? 'node_modules/@nestjs/common';
const limit = Number(process.argv[3] ?? 200);
// 判据基于"税态"与"正常态"的量级差（税态约 80ms/文件、35% 文件 >5ms）。
// 不用绝对值上限，避免被并发负载（如同时跑全量测试）的调度抖动误判。
const MAX_AVG_MS = 1.0; // 正常 0.3-0.8ms；税态 80ms
const MAX_SLOW_RATIO = 0.05; // 正常 0-1 个抖动；税态 35%
const SLOW_MS = 5; // 单文件慢阈值

function collectJs(dir, acc) {
  for (const name of readdirSync(dir)) {
    if (acc.length >= limit) return acc;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) collectJs(full, acc);
    else if (name.endsWith('.js')) acc.push(full);
    if (acc.length >= limit) return acc;
  }
  return acc;
}

function readRound(files) {
  const started = process.hrtime.bigint();
  const slow = [];
  for (const file of files) {
    const t0 = process.hrtime.bigint();
    readFileSync(file, 'utf8');
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    if (ms > SLOW_MS) slow.push(`${ms.toFixed(1)}ms ${file}`);
  }
  const total = Number(process.hrtime.bigint() - started) / 1e6;
  return { total, slow };
}

const walkStart = process.hrtime.bigint();
const files = collectJs(root, []);
const walkMs = Number(process.hrtime.bigint() - walkStart) / 1e6;

if (files.length === 0) {
  console.error(`[doctor:fs] 未找到 .js 文件：${root}`);
  process.exit(2);
}

const cold = readRound(files);
const warm = readRound(files);

const avgMs = warm.total / files.length;
const slowRatio = warm.slow.length / files.length;

console.log(`[doctor:fs] root=${root} files=${files.length}`);
console.log(`[doctor:fs] walk=${walkMs.toFixed(0)}ms`);
console.log(`[doctor:fs] cold=${cold.total.toFixed(0)}ms slow=${cold.slow.length}`);
console.log(`[doctor:fs] warm=${warm.total.toFixed(0)}ms slow=${warm.slow.length}`);
console.log(`[doctor:fs] per-file 均值=${avgMs.toFixed(2)}ms`);

for (const line of warm.slow.slice(0, 10)) console.log(`[doctor:fs]   slow ${line}`);

const pass = avgMs < MAX_AVG_MS && slowRatio < MAX_SLOW_RATIO;
if (!pass) {
  console.error(
    `[doctor:fs] 判定：不合格（均值 ${avgMs.toFixed(2)}ms/文件，慢文件占比 ${(slowRatio * 100).toFixed(0)}%）。` +
      '读税可能已回来 —— 用 pnpm install --force --config.package-import-method=copy 重装依赖，' +
      '复验方法见 docs/team/gate-performance-remediation-2026-11-11.md §1.5。',
  );
  process.exit(1);
}

console.log('[doctor:fs] 判定：合格（读取延迟正常，闸门数字可信）');
