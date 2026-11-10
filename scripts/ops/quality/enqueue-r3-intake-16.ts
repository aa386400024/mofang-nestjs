// V2026-11-11 一次性脚本 (WP-L · 16 场 intake 重跑批量入队):
//   职责: 直投 BullMQ 队列, 入队一批 16 场对练 (8 角色 × 仅 expert 模式 × 2 repeats).
//
//   为什么直投而不是调 admin 端点:
//     · admin 端点的 batchId 是服务端 nanoid() 生成的, 给不出精确值
//     · 直投可以精确控制 batch_id / maxTurns / 每角色 repeats
//     · 跟 P4 / P1c 的做法一致
//
//   与 enqueue-p4-batch.ts 的差异:
//     · 咨询师模式只保留 expert (intake 12 轮档口径, 不跑 cold)
//     · 每组合 repeats = 2 → 8 × 1 × 2 = 16 场
//     · BATCH_ID 换新 (p1d-r3-intake-2026-11-11), 避免 jobId 与历史批次碰撞被静默去重
//
//   用法:
//     pnpm exec tsx scripts/ops/quality/enqueue-r3-intake-16.ts
//
//   ⚠️ 跑之前确认: 实例 worker 并发 = 1 (AUTO_PRACTICE_WORKER_CONCURRENCY=1), 避免上游 429.

import 'dotenv/config';

import { Queue } from 'bullmq';
import { createHash } from 'node:crypto';

// ========== 配置区 (跑之前确认) ==========

/** 批量 ID (WP-L 新批次, 跟历史 verify-route1-p1d 隔离). */
const BATCH_ID = 'p1d-r3-intake-2026-11-11';

/** 8 个角色 slug (跟 DB 实查 / P4 一致). */
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

/** 咨询师模式 (intake 重跑只验 expert). */
const COUNSELOR_MODE_IDS: readonly string[] = ['expert'];

/** 每组合重复几场. 8 角色 × 1 模式 × 2 repeats = 16 场. */
const REPEATS_PER_COMBO = 2;

/** 最大轮数 (intake 12 轮档口径). */
const MAX_TURNS = 12;

// ========== 以下是执行逻辑 ==========

async function main(): Promise<void> {
  const totalExpected = CHARACTER_SLUGS.length * COUNSELOR_MODE_IDS.length * REPEATS_PER_COMBO;
  console.log('=== WP-L intake 16 场批量入队 ===\n');
  console.log(`batch_id: ${BATCH_ID}`);
  console.log(`角色数: ${CHARACTER_SLUGS.length}`);
  console.log(`咨询师模式: ${COUNSELOR_MODE_IDS.join(' / ')}`);
  console.log(`每组合 repeats: ${REPEATS_PER_COMBO}`);
  console.log(`maxTurns: ${MAX_TURNS}`);
  console.log(`预计总场数: ${totalExpected}\n`);

  // BullMQ 连接 (跟 practice-queue.service.ts / P4 同配置)
  const queue = new Queue('auto-practice', {
    connection: {
      host: process.env.REDIS_HOST ?? '127.0.0.1',
      port: Number(process.env.REDIS_PORT ?? 6379),
      password: process.env.REDIS_PASSWORD ?? undefined,
      db: Number(process.env.REDIS_DB ?? 0),
    },
    prefix: 'bullmq',
    defaultJobOptions: {
      attempts: 2,
      backoff: { type: 'exponential', delay: 2000 },
      removeOnComplete: { count: 5000, age: 7 * 24 * 3600 },
      removeOnFail: { count: 10_000 },
    },
  });

  let enqueued = 0;
  try {
    for (const slug of CHARACTER_SLUGS) {
      for (const modeId of COUNSELOR_MODE_IDS) {
        for (let r = 0; r < REPEATS_PER_COMBO; r += 1) {
          // jobId 用内容派生 (batch_id + slug + mode + repeat), 幂等 —— 重跑不会重复入队
          const jobId = createHash('sha1').update(`${BATCH_ID}:${slug}:${modeId}:${r}`).digest('hex').slice(0, 16);

          await queue.add(
            'run-practice',
            {
              characterSlug: slug,
              counselorModeId: modeId,
              maxTurns: MAX_TURNS,
              batchId: BATCH_ID,
            },
            { jobId },
          );
          enqueued += 1;
          process.stdout.write(`\r已入队: ${enqueued}/${totalExpected}`);
        }
      }
    }
    console.log(`\n\n=== 完成 ===`);
    console.log(`已入队: ${enqueued} 场`);
    console.log(`batch_id: ${BATCH_ID}`);
  } finally {
    await queue.close();
  }
}

main().catch((error) => {
  console.error('入队失败:', error);
  process.exitCode = 1;
});
