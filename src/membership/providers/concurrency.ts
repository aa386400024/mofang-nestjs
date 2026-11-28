/**
 * 会员 cron 批处理默认并发上限.
 *
 * 8 是「明显快于串行、又不会把连接池打满」的折中；单测直接引用该常量校验上限.
 */
export const MEMBERSHIP_CRON_CONCURRENCY = 8;

/**
 * 有界并发的批量执行器.
 *
 * 用于 cron / 定时任务：既不像串行那样把 N 条独立事务排成一列，也不像
 * `Promise.all` 那样一次性打满连接池。工作协程数固定为 `limit`，任务按入参顺序领取.
 *
 * AF-595: 会员到期发放 / 过期订单关闭从「逐条串行 await」改成「有界并发」，
 * 事务本身仍是一 term / 一 order 一条，行锁与幂等语义不变.
 */
export async function forEachWithConcurrency<T>(
  items: readonly T[],
  limit: number,
  handler: (item: T, index: number) => Promise<void>,
): Promise<void> {
  if (items.length === 0) return;
  const workerCount = Math.min(Math.max(1, limit), items.length);
  let nextIndex = 0;

  const workers = Array.from({ length: workerCount }, async () => {
    while (true) {
      const index = nextIndex++;
      if (index >= items.length) return;
      await handler(items[index], index);
    }
  });

  await Promise.all(workers);
}
