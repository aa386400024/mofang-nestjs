// V2026-11-10 一次性脚本 (WP-J · P4 100 场批量入队):
//   职责: 直投 BullMQ 队列, 入队一批 100 场对练 (8 角色 × 2 咨询师模式 × 多 repeats).
//
//   为什么直投而不是调 admin 端点:
//     · admin 端点的 batchId 是服务端 nanoid() 生成的, 给不出精确值
//     · 直投可以精确控制 batch_id / maxTurns / 每角色 repeats
//     · 跟 P1c 的做法一致 (P1c 交付记录 §九 B1)
//
//   前置条件 (5 条全绿才跑, 见 phase2.5-anchor-calibration-plan-2026-11-10.md §四):
//     1. 自动指标 vs 人工标签一致率 ≥70%
//     2. P1d 修完, anxious 通道真的接线了
//     3. verbal_voice 文案落库 (8 角色非 NULL)
//     4. audit 词表覆盖率 ≥15%
//     5. 上游 429 限流有应对 (maxTurns=12 + 并发 1)
//
//   用法:
//     # 先确认 5 条前置全绿
//     # 然后跑:
//     npx tsx scripts/ops/quality/enqueue-p4-batch.ts
//
//   ⚠️ 跑之前确认: 3000 实例的 worker 并发是多少? 并发太高会触发上游 429.
//      建议跑 P4 时临时把 AUTO_PRACTICE_WORKER_CONCURRENCY=1.

import 'dotenv/config';

import { Queue } from 'bullmq';
import { createHash } from 'node:crypto';

// ========== 配置区 (跑之前确认) ==========

/** 批量 ID (跟 P1c 同格式, 便于按 batch_id 隔离逐字稿). */
const BATCH_ID = 'p4-anchor-calibrated-2026-11-10';

/** 8 个角色 slug (跟 DB 实查一致). */
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

/** 咨询师模式 (跟 P1c r2 同口径: cold + expert). */
const COUNSELOR_MODE_IDS: readonly string[] = [
  'cold',
  'expert',
];

/** 每组合重复几场. 8 角色 × 2 模式 × 6 repeats = 96 场 (≈100 场目标). */
const REPEATS_PER_COMBO = 6;

/** 最大轮数 (P1c 实测 30 会触发上游 429, 12 是基线主力批次口径). */
const MAX_TURNS = 12;

// ========== 以下是执行逻辑 ==========

async function main(): Promise<void> {
  const totalExpected = CHARACTER_SLUGS.length * COUNSELOR_MODE_IDS.length * REPEATS_PER_COMBO;
  console.log('=== P4 批量入队 ===\n');
  console.log(`batch_id: ${BATCH_ID}`);
  console.log(`角色数: ${CHARACTER_SLUGS.length}`);
  console.log(`咨询师模式: ${COUNSELOR_MODE_IDS.join(' / ')}`);
  console.log(`每组合 repeats: ${REPEATS_PER_COMBO}`);
  console.log(`maxTurns: ${MAX_TURNS}`);
  console.log(`预计总场数: ${totalExpected}\n`);

  // 前置检查: 总场数不能太离谱
  if (totalExpected > 120) {
    console.warn(`⚠️  预计 ${totalExpected} 场, 超过 120 场上限 —— 上游 429 风险极高. 确认要跑吗?`);
  }

  // BullMQ 连接 (跟 practice-queue.service.ts 同配置)
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
          const jobId = createHash('sha1')
            .update(`${BATCH_ID}:${slug}:${modeId}:${r}`)
            .digest('hex')
            .slice(0, 16);

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
    console.log(`\n下一步:`);
    console.log(`1. 确认 3000 实例的 worker 并发是 1 (AUTO_PRACTICE_WORKER_CONCURRENCY=1)`);
    console.log(`2. 等批量跑完 (预计 ${Math.ceil(totalExpected * 3 / 60)} 小时, 单场 ~3 分钟, 并发 1)`);
    console.log(`3. 跑完后按 batch_id 从 DB 取 debug_session_id → 拷到独立目录 → 跑 audit`);
  } finally {
    await queue.close();
  }
}

main().catch((error) => {
  console.error('入队失败:', error);
  process.exit(1);
});
