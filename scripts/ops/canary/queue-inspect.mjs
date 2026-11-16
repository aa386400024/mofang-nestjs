/**
 * 自动对练队列巡检（默认只读）。
 *
 * 用法:
 *   node scripts/ops/canary/queue-inspect.mjs            # 只看: 计数 + 排队任务归属批次
 *   node scripts/ops/canary/queue-inspect.mjs --drain     # 清空 waiting/delayed（会删任务，谨慎）
 *
 * 何时需要 drain: 判定某批已"污染"（前后跑了不同代码版本），要让新批次从干净队列起跑时。
 * 排空不影响已完成/失败的归档, 只删还没开始的排队任务。
 *
 * 队列参数必须与 src/auto-practice/practice-queue.service.ts 保持一致:
 *   name = QUEUE_NAMES.autoPractice ('auto-practice'), prefix = 'bullmq'
 */
import 'dotenv/config';
import { Queue } from 'bullmq';

const conn = {
  host: process.env.REDIS_HOST,
  port: Number(process.env.REDIS_PORT ?? 6379),
  password: process.env.REDIS_PASSWORD || undefined,
  db: Number(process.env.REDIS_DB ?? 0),
};

const queue = new Queue('auto-practice', { connection: conn, prefix: 'bullmq' });

const before = await queue.getJobCounts();
console.log('--- 清理前计数 ---', JSON.stringify(before));

const pending = await queue.getJobs(['waiting', 'delayed'], 0, 500, false);
const byBatch = {};
for (const job of pending) {
  const b = job?.data?.batchId ?? '(null)';
  byBatch[b] = (byBatch[b] ?? 0) + 1;
}
console.log('--- 排队任务归属批次 ---', JSON.stringify(byBatch));

if (process.argv.includes('--drain')) {
  await queue.drain();
  console.log('--- 已清空排队任务，清理后计数 ---', JSON.stringify(await queue.getJobCounts()));
} else {
  console.log('--- 只读模式；如需清空排队任务，加 --drain ---');
}

await queue.close();
