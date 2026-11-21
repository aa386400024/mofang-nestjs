#!/usr/bin/env node
// V2026-11-21 建立 (AF-225 · R6-B 评分稳定性恢复探针):
//   职责: 按 R5 复算的失败 packetId 精确重跑 AI 双盲评分，验证 compact 重试
//         不再因思考 token 吃满预算而整包失败。
//
//   边界:
//     · 复用 bin/visitor-realism-blind.ts 的同一评分链路，不另写评分逻辑；
//     · 报告由评分 CLI 落盘，只含 packetId / 分数 / 计数 / 失败原因，不含台词原文；
//     · 任一 packet 失败即 exit 1，避免闸门假绿。

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const DEFAULT_OUT = join('data', 'phase25-exit', 'af225-realism-stability');

function arg(name: string): string | null {
  const index = process.argv.indexOf(name);
  if (index === -1 || index + 1 >= process.argv.length) return null;
  return process.argv[index + 1];
}

function fail(message: string): never {
  console.error(`[FAIL] ${message}`);
  process.exit(1);
}

function main(): number {
  const packetIdsRaw = arg('--packet-ids');
  if (!packetIdsRaw) fail('缺少 --packet-ids（逗号分隔的 R5 失败 packetId）');
  const packetIds = packetIdsRaw
    .split(',')
    .map((id) => id.trim())
    .filter((id) => id.length > 0);
  if (packetIds.length === 0) fail('--packet-ids 为空');

  const outDir = resolve(arg('--out') ?? DEFAULT_OUT);
  const maxOutputTokens = arg('--max-output-tokens') ?? '5000';
  const source = arg('--source') ?? join('data', 'debug-sessions');

  const args = [
    '--import',
    'tsx',
    join('bin', 'visitor-realism-blind.ts'),
    '--source',
    source,
    '--out',
    outDir,
    '--packet-ids',
    packetIds.join(','),
    '--target-scored',
    String(packetIds.length),
    '--max-packets',
    '400',
    '--max-output-tokens',
    maxOutputTokens,
    '--max-parse-retries',
    '1',
    '--report-title',
    'AF-225 · R6-B 评分稳定性恢复探针',
  ];
  console.log(`[PROBE] packetIds=${packetIds.length} maxOutputTokens=${maxOutputTokens} out=${outDir}`);
  const result = spawnSync(process.execPath, args, { stdio: 'inherit' });
  if (result.status !== 0) {
    console.error(`[FAIL] 评分 CLI 退出码：${result.status ?? 'null'}`);
    return result.status ?? 1;
  }

  const reportPath = join(outDir, 'report.json');
  if (!existsSync(reportPath)) fail(`评分 CLI 未产出报告：${reportPath}`);
  const report = JSON.parse(readFileSync(reportPath, 'utf8')) as {
    readonly ratedPackets?: number;
    readonly failedPackets?: number;
    readonly failed?: readonly { readonly packetId: string; readonly error: string }[];
  };
  const rated = report.ratedPackets ?? 0;
  const failed = report.failedPackets ?? 0;
  console.log(`[PROBE] rated=${rated}/${packetIds.length} failed=${failed}`);
  if (rated !== packetIds.length || failed !== 0) {
    for (const item of report.failed ?? []) console.error(`[FAIL] ${item.packetId}：${item.error.slice(0, 160)}`);
    console.error(`[FAIL] 恢复未达标：${rated}/${packetIds.length} packet 完成五维评分`);
    return 1;
  }
  return 0;
}

process.exit(main());
