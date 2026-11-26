// AF-526 治本 (验证环境隔离 · BullMQ 命名空间):
//   病根: 所有 Queue / Worker 构造点把 prefix 写死成 'bullmq' ——
//     共享 Redis 上不同工作树 / 不同实例的 worker 会抢同一个队列的 job,
//     本地验证实例的 job 被远端 / 旧 worktree 的 worker 消费, 报出与代码无关的环境错误.
//   修法: 队列前缀收敛到这一个解析入口.
//     - 显式 BULLMQ_PREFIX 优先 (生产 / 演练可指定稳定命名空间);
//     - production / test 未配置时回落 'bullmq', 保持存量队列键与测试断言不变;
//     - development 未配置时按 REDIS_DB + 主机名 + 工作树路径哈希生成实例级命名空间,
//       同一工作树重启后前缀不变 (队列可续跑), 不同工作树 / DB 自动隔离.
//   注意: 这里只决定 BullMQ 自己的 prefix. ioredis 业务连接的 REDIS_KEY_PREFIX 是另一层,
//     两者不要互相替代.

import { createHash } from 'node:crypto';
import { hostname } from 'node:os';

/** 存量 / 生产 / 测试环境的统一默认前缀. */
export const DEFAULT_BULLMQ_PREFIX = 'bullmq';

/** 队列前缀只关心这几个变量; 单独收窄类型, 避免 index signature 的括号访问. */
type QueueEnv = NodeJS.ProcessEnv & {
  BULLMQ_PREFIX?: string;
  VITEST?: string;
  REDIS_DB?: string;
};

/**
 * 解析当前进程应使用的 BullMQ 队列前缀.
 *
 * @param env 环境变量 (测试可注入, 避免改 process.env)
 * @param cwd 当前工作树路径 (测试可注入)
 * @param host 主机名 (测试可注入)
 */
export function resolveBullPrefix(env: QueueEnv = process.env, cwd: string = process.cwd(), host: string = hostname()): string {
  const explicit = (env.BULLMQ_PREFIX ?? '').trim();
  if (explicit.length > 0) {
    return explicit;
  }

  const nodeEnv = (env.NODE_ENV ?? '').trim();
  const isTest = nodeEnv === 'test' || env.VITEST === 'true' || env.VITEST === '1';
  if (nodeEnv === 'production' || isTest) {
    return DEFAULT_BULLMQ_PREFIX;
  }

  const db = (env.REDIS_DB ?? '').trim() || '0';
  const hostToken = host.replaceAll(/[^a-zA-Z0-9_-]/g, '-') || 'unknown-host';
  const worktreeHash = createHash('sha1').update(cwd).digest('hex').slice(0, 8);
  return `${DEFAULT_BULLMQ_PREFIX}:dev:${db}:${hostToken}:${worktreeHash}`;
}
