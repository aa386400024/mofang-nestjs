// AF-563 · 出口⑤ 1000 场批次入队器
//
// 为什么单独写: P4 的 enqueue-p4-batch.ts 是 8 角色 × 2 模式 × 6 repeats = 96 场
// 的一次性脚本。出口⑤要按“当前 completed 数 → 1000”补差，且必须可复跑、不重复。
//
// 用法:
//   pnpm exec tsx scripts/eval/enqueue-exit5-batch.ts --target 487 --dry-run
//   pnpm exec tsx scripts/eval/enqueue-exit5-batch.ts --target 487 --batch-id exit5-1000-2026-11-27
//
// 前置:
//   - 3000 实例 worker 已启动（AUTO_PRACTICE_WORKER_CONCURRENCY 默认 3，不主动抬高）
//   - 上游 429 风险已知：maxTurns 默认 12；不要为了跑快改并发。

import 'dotenv/config';

import { Queue } from 'bullmq';
import { createHash } from 'node:crypto';
import { parseArgs } from 'node:util';

import { resolveBullPrefix } from '../../src/shared/infra/queue/bullmq-prefix.js';

const CHARACTER_SLUGS: readonly string[] = [
  'vpt_general_secure_l1',
  'vpt_social_anxious_l1',
  'vpt_intimate_avoidance_l1',
  'vpt_self_worth_intellectualization_l1',
  'vpt_depression_avoidant_l1',
  'vpt_grief_avoidance_l1',
  'vpt_workplace_intellectualization_l1',
  'vpt_trauma_disorganized_l1',
];

const COUNSELOR_MODE_IDS: readonly string[] = ['cold', 'expert'];
const DEFAULT_MAX_TURNS = 12;
const MAX_BATCH_SIZE = 600;

function usage(): never {
  console.log(
    [
      '出口⑤批次入队器',
      '',
      '  --target <n>      要补的场数（默认 487）',
      '  --batch-id <id>   批次 ID（默认 exit5-1000-2026-11-27）',
      '  --max-turns <n>   单场最大轮数（默认 12）',
      '  --dry-run         只打印分配，不入队',
      '',
    ].join('\n'),
  );
  process.exit(0);
}

function positiveInt(value: string | undefined, fallback: number, name: string): number {
  const parsed = Number(value ?? fallback);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`${name} 必须是正整数，收到: ${value}`);
  return parsed;
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      target: { type: 'string' },
      'batch-id': { type: 'string' },
      'max-turns': { type: 'string' },
      'dry-run': { type: 'boolean', default: false },
      help: { type: 'boolean', default: false },
    },
    allowPositionals: false,
  });
  if (values.help) usage();

  const target = positiveInt(values.target, 487, '--target');
  if (target > MAX_BATCH_SIZE) throw new Error(`--target=${target} 超过单批上限 ${MAX_BATCH_SIZE}，请拆批`);
  const batchId = values['batch-id'] ?? 'exit5-1000-2026-11-27';
  const maxTurns = positiveInt(values['max-turns'], DEFAULT_MAX_TURNS, '--max-turns');

  const combos: Array<{ slug: string; modeId: string; count: number }> = [];
  const base = Math.floor(target / (CHARACTER_SLUGS.length * COUNSELOR_MODE_IDS.length));
  const remainder = target % (CHARACTER_SLUGS.length * COUNSELOR_MODE_IDS.length);
  let comboIndex = 0;
  for (const slug of CHARACTER_SLUGS) {
    for (const modeId of COUNSELOR_MODE_IDS) {
      combos.push({ slug, modeId, count: base + (comboIndex < remainder ? 1 : 0) });
      comboIndex += 1;
    }
  }

  console.log('=== 出口⑤批次入队 ===');
  console.log(`batch_id=${batchId} target=${target} maxTurns=${maxTurns} dryRun=${values['dry-run']}`);
  for (const combo of combos) console.log(`  ${combo.slug} / ${combo.modeId}: ${combo.count}`);

  if (values['dry-run']) {
    console.log(`\n[dry-run] 合计 ${combos.reduce((sum, combo) => sum + combo.count, 0)} 场，未连接队列。`);
    return;
  }

  const queue = new Queue('auto-practice', {
    connection: {
      host: process.env.REDIS_HOST ?? '127.0.0.1',
      port: Number(process.env.REDIS_PORT ?? 6379),
      password: process.env.REDIS_PASSWORD ?? undefined,
      db: Number(process.env.REDIS_DB ?? 0),
    },
    // 与 worker 用同一前缀: 写死 'bullmq' 会落到生产队列, 被未开 debug 的远端 worker 抢占.
    prefix: resolveBullPrefix(),
    defaultJobOptions: {
      attempts: 2,
      backoff: { type: 'exponential', delay: 2000 },
      removeOnComplete: { count: 5000, age: 7 * 24 * 3600 },
      removeOnFail: { count: 10_000 },
    },
  });

  let enqueued = 0;
  try {
    for (const combo of combos) {
      for (let repeat = 0; repeat < combo.count; repeat += 1) {
        const jobId = `j${createHash('sha1')
          .update(`${batchId}:${combo.slug}:${combo.modeId}:${repeat}`)
          .digest('hex')
          .slice(0, 16)}`;
        await queue.add(
          'run-practice',
          { characterSlug: combo.slug, counselorModeId: combo.modeId, maxTurns, batchId },
          { jobId },
        );
        enqueued += 1;
        process.stdout.write(`\r已入队: ${enqueued}/${target}`);
      }
    }
    const counts = await queue.getJobCounts('waiting', 'active', 'completed', 'failed', 'delayed');
    console.log(`\n\n=== 完成 ===`);
    console.log(`入队 ${enqueued} 场；batch_id=${batchId}`);
    console.log(`队列现场: ${JSON.stringify(counts)}`);
  } finally {
    await queue.close();
  }
}

main().catch((error) => {
  console.error(`[enqueue-exit5-batch] ${(error as Error).message}`);
  process.exit(1);
});
