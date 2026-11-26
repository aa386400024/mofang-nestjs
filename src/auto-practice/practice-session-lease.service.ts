// AF-526 治本 (验证环境隔离 · 会话租约):
//   病根: PracticeRunnerService.onModuleInit 把共享 MySQL 里**所有** status='running'
//     的场次无差别标成 failed/interrupted. 单实例时代这是对的; 共享 MySQL 上
//     任一实例重启都会误伤其他实例正在跑的会话 (AF-524 期间现场发生过).
//   修法: running 行落库前先在 Redis 抢一把会话租约, 运行期心跳续租, 收尾按 owner
//     安全释放; 启动清理只回收"没有活跃租约"的行.
//   边界:
//     - 不新增 DB 列 / 不做 migration, 租约只放 Redis;
//     - 用 BullMQ 专用连接 (无 ioredis keyPrefix) + 显式拼 REDIS_KEY_PREFIX,
//       避免 Lua 脚本里 keyPrefix 不生效导致 compare-and-delete 删错 key;
//     - release / refresh 全部 Lua compare-and-owner, 只对自己的 key 生效.

import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { randomUUID } from 'node:crypto';

import { REDIS_KEYS } from '../shared/infra/redis/redis.constants.js';
import { RedisService } from '../shared/infra/redis/redis.service.js';

/** 租约 TTL: 30 秒没有心跳即视为持有者已死. */
export const PRACTICE_LEASE_TTL_SECONDS = 30;

/** 心跳间隔: TTL 的 1/3, 允许两次心跳丢失仍不丢租约. */
export const PRACTICE_LEASE_HEARTBEAT_MS = 10_000;

export interface PracticeLeaseOptions {
  /** 租约 TTL (秒). */
  readonly ttlSeconds: number;
  /** 心跳间隔 (毫秒). */
  readonly heartbeatIntervalMs: number;
}

const DEFAULT_OPTIONS: PracticeLeaseOptions = {
  ttlSeconds: PRACTICE_LEASE_TTL_SECONDS,
  heartbeatIntervalMs: PRACTICE_LEASE_HEARTBEAT_MS,
};

// 只续自己的租约: GET 到 owner 才 EXPIRE.
const REFRESH_SCRIPT = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('EXPIRE', KEYS[1], ARGV[2])
end
return 0
`;

// 只删自己的租约: GET 到 owner 才 DEL. 不能直接 DEL —— 否则会把别人刚抢到的租约删掉.
const RELEASE_SCRIPT = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0
`;

@Injectable()
export class PracticeSessionLeaseService {
  private readonly logger = new Logger(PracticeSessionLeaseService.name);

  /** 本进程唯一 owner token: 同进程内所有场次共用, key 本身按场次隔离. */
  private readonly ownerToken = randomUUID();

  /** 场次 id → 心跳 timer. */
  private readonly heartbeats = new Map<string, NodeJS.Timeout>();

  constructor(
    private readonly redis: RedisService,
    @Optional() @Inject('PRACTICE_LEASE_OPTIONS') private readonly options: PracticeLeaseOptions = DEFAULT_OPTIONS,
  ) {}

  /** 逻辑 key 加业务 keyPrefix, 供无 prefix 的 Bull 连接使用. */
  buildKey(practiceSessionId: string): string {
    return `${this.redis.getKeyPrefix()}${REDIS_KEYS.practiceLease(practiceSessionId)}`;
  }

  /**
   * 尝试获取租约.
   *
   * @returns true = 拿到; false = 已被其他进程持有 (不是 Redis 故障)
   */
  async acquire(practiceSessionId: string): Promise<boolean> {
    const key = this.buildKey(practiceSessionId);
    const result = await this.redis.getBullClient().set(key, this.ownerToken, 'EX', this.options.ttlSeconds, 'NX');
    if (result !== 'OK') {
      return false;
    }
    this.startHeartbeat(practiceSessionId);
    return true;
  }

  /** 当前是否有活跃租约 (启动清理用). Redis 故障会抛给调用方, 由调用方决定跳过清理. */
  async hasActiveLease(practiceSessionId: string): Promise<boolean> {
    const key = this.buildKey(practiceSessionId);
    return (await this.redis.getBullClient().exists(key)) === 1;
  }

  /** 只续自己的租约; 已被别人持有 / 已过期返回 false. */
  async refresh(practiceSessionId: string): Promise<boolean> {
    const key = this.buildKey(practiceSessionId);
    const result = await this.redis.getBullClient().eval(REFRESH_SCRIPT, 1, key, this.ownerToken, String(this.options.ttlSeconds));
    return Number(result) === 1;
  }

  /** 只释放自己的租约; 失败只告警, 不阻断对练收尾. */
  async release(practiceSessionId: string): Promise<void> {
    this.stopHeartbeat(practiceSessionId);
    try {
      const key = this.buildKey(practiceSessionId);
      await this.redis.getBullClient().eval(RELEASE_SCRIPT, 1, key, this.ownerToken);
    } catch (error) {
      this.logger.warn(`[auto_practice] 释放会话租约失败 session=${practiceSessionId}: ${errorName(error)}`);
    }
  }

  /** 进程退出时清掉 timer; 租约靠 TTL 自然回收, 不在 shutdown 里做网络调用. */
  onModuleDestroy(): void {
    for (const timer of this.heartbeats.values()) {
      clearInterval(timer);
    }
    this.heartbeats.clear();
  }

  private startHeartbeat(practiceSessionId: string): void {
    if (this.heartbeats.has(practiceSessionId)) return;
    const timer = setInterval(() => {
      void this.refresh(practiceSessionId).catch((error: unknown) => {
        this.logger.warn(`[auto_practice] 续租失败 session=${practiceSessionId}: ${errorName(error)}`);
      });
    }, this.options.heartbeatIntervalMs);
    // 心跳不应阻止进程退出.
    timer.unref?.();
    this.heartbeats.set(practiceSessionId, timer);
  }

  private stopHeartbeat(practiceSessionId: string): void {
    const timer = this.heartbeats.get(practiceSessionId);
    if (timer) {
      clearInterval(timer);
      this.heartbeats.delete(practiceSessionId);
    }
  }
}

function errorName(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
