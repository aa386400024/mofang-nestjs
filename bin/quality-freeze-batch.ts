// V2026-11-11 治本 (WP-N · 标注台批次化 — 逐字稿批量冻结 CLI):
//
//   用法: pnpm exec tsx bin/quality-freeze-batch.ts --batch <batchId> [--dry-run]
//
//   作用: 把某一批的逐字稿**预冻结**到 data/quality/transcripts/<batchId>/.
//     逐字稿活文件受 MAX_DEBUG_SESSIONS=500 约束, 会被 prune 淘汰 ——
//     淘汰后标注记录还在, 但台词读不出来. 冻结副本是标注结论的唯一回看依据.
//
//   输出 (JSON, 一行): {"frozen":N,"alreadyFrozen":N,"missing":N}
//     · frozen         —— 本次真的写下的份数;
//     · alreadyFrozen  —— 冻结副本已存在 (跳过, 不重复写);
//     · missing        —— 冻结前逐字稿就已不在 (活文件被淘汰 / 从没跑过).
//
//   退出码 (语义化):
//     0 —— 全部成功 (frozen + alreadyFrozen > 0, missing = 0);
//     1 —— 有 missing (逐字稿已丢失, 那些场次回看不了);
//     2 —— 参数错误 (没给 --batch / --batch 非法).
//
//   ⚠️ **台词不进日志**: 本脚本只打 id / 计数 / 错误名.
//   ⚠️ **不碰 DebugSessionStore 的行为**: 只是**读**它, 冻结副本写到独立目录.

import 'reflect-metadata';

import { ConfigService } from '@nestjs/config';
import { config as loadEnvFile } from 'dotenv';
import { DataSource, type DataSourceOptions } from 'typeorm';

import { DebugSessionStore } from '../src/admin-debug/debug-session-store.js';
import { PracticeSession } from '../src/auto-practice/entities/practice-session.entity.js';
import { configuration } from '../src/config/configuration.js';
import { isValidBatchId } from '../src/quality/quality-annotation-batch.js';
import { QualityTranscriptFreeze } from '../src/quality/quality-transcript-freeze.js';

type DbConfig = DataSourceOptions & { autoLoadEntities?: boolean };

/**
 * 命令行参数.
 */
interface CliArgs {
  /** 批次 id. */
  readonly batch: string | null;
  /** 只演练不落盘. */
  readonly dryRun: boolean;
}

/**
 * 解析命令行参数.
 *
 * @param argv 参数数组
 * @returns 解析结果
 */
function parseArgs(argv: readonly string[]): CliArgs {
  let batch: string | null = null;
  let dryRun = false;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index] ?? '';
    if (arg === '--batch') {
      batch = argv[index + 1] ?? null;
      index += 1;
      continue;
    }
    if (arg.startsWith('--batch=')) {
      batch = arg.slice('--batch='.length);
      continue;
    }
    if (arg === '--dry-run') {
      dryRun = true;
      continue;
    }
    throw new Error(`未知参数: ${arg} (用法: --batch <batchId> [--dry-run])`);
  }
  return { batch, dryRun };
}

/**
 * 跑一次批量冻结.
 *
 * @returns 退出码
 */
async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  if (args.batch === null || !isValidBatchId(args.batch)) {
    process.stderr.write('[quality-freeze-batch] 参数错误: 必须给合法的 --batch <batchId>\n');
    return 2;
  }
  const batchId = args.batch;

  const envResult = loadEnvFile();
  if (envResult.error) {
    process.stderr.write(`[quality-freeze-batch] 加载 .env 失败: ${envResult.error.message}\n`);
    return 2;
  }

  const config = (await configuration()) as { db: DbConfig };
  const dbOptions: DbConfig = { ...config.db };
  delete dbOptions.autoLoadEntities;

  const dataSource = new DataSource({
    ...dbOptions,
    entities: [PracticeSession],
    migrations: [],
    logging: false,
    synchronize: false,
  });
  await dataSource.initialize();

  const store = new DebugSessionStore(new ConfigService({ ADMIN_DEBUG_SESSION_DIR: process.env['ADMIN_DEBUG_SESSION_DIR'] ?? '' }));
  const freeze = new QualityTranscriptFreeze(store);

  try {
    const sessions = await dataSource.getRepository(PracticeSession).find({ where: { batchId } });
    let frozen = 0;
    let alreadyFrozen = 0;
    let missing = 0;

    for (const session of sessions) {
      if (freeze.hasFrozen(session.debugSessionId, batchId)) {
        alreadyFrozen += 1;
        continue;
      }
      if (args.dryRun) {
        const live = await store.get(session.debugSessionId);
        if (live === null) missing += 1;
        else frozen += 1;
        continue;
      }
      const result = await freeze.freeze(session.debugSessionId, batchId);
      if (result.reason === 'frozen') frozen += 1;
      else if (result.reason === 'already-frozen') alreadyFrozen += 1;
      else missing += 1;
    }

    process.stdout.write(`${JSON.stringify({ frozen, alreadyFrozen, missing })}\n`);
    return missing > 0 ? 1 : 0;
  } finally {
    await dataSource.destroy();
  }
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    const name = error instanceof Error ? error.name : 'UnknownError';
    process.stderr.write(`[quality-freeze-batch] 失败: ${name}\n`);
    process.exitCode = 2;
  });
