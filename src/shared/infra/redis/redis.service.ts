import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
// eslint-disable-next-line @typescript-eslint/naming-convention
import Redis, { type RedisOptions } from 'ioredis';

import { ConfigService } from '../../../common';

/**
 * Redis service — 大厂基础设施层 (心塑 + 魔方共用).
 *
 * 职责:
 *   - 维护 ioredis 单例连接 (主实例 + BullMQ 副本)
 *   - 提供 KV / Hash / Stream 等常用命令封装
 *   - 暴露 health() 用于健康检查
 *   - Redis 不可用时不 throw, 业务层降级 (JWT blacklist miss / 验证码重发)
 *
 * 设计:
 *   - 单例连接 (ioredis 自带连接池, 不用额外 pool)
 *   - lazyConnect: false (启动时立即连接, fail-fast)
 *   - enableReadyCheck + maxRetriesPerRequest: null (BullMQ 要求)
 *   - keyPrefix 通过 env 注入, ioredis 自动拼接 (无需手动)
 *
 * 与 V1 内存 Map 对比:
 *   - V1: 单实例 / 重启丢
 *   - V2: 多实例共享 / TTL 自动清理 / 大集群水平扩展
 */
@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);

  /** 通用 Redis 连接 (业务 KV 用) */
  private client!: Redis;

  /** BullMQ 专用连接 (BullMQ 要求独立连接, maxRetriesPerRequest=null) */
  private bullClient!: Redis;

  /** 缓存 keyPrefix (仅给 SCAN MATCH 等 ioredis 不自动前缀的命令用) */
  private keyPrefixStr = '';

  constructor(@Inject(ConfigService) private readonly config: ConfigService) {}

  // ========================================================================
  // Lifecycle
  // ========================================================================

  async onModuleInit(): Promise<void> {
    const cfg = this.config.get('redis');
    this.keyPrefixStr = cfg.keyPrefix;
    const baseOptions: RedisOptions = {
      host: cfg.host,
      port: cfg.port,
      password: cfg.password ?? undefined,
      db: cfg.db,
      keyPrefix: cfg.keyPrefix,
      lazyConnect: false,
      enableReadyCheck: true,
    };

    // 业务连接: 标准重试
    this.client = new Redis({
      ...baseOptions,
      maxRetriesPerRequest: 3,
    });

    // BullMQ 专用连接: maxRetriesPerRequest=null + 不要 keyPrefix
    // (BullMQ 不支持 ioredis prefix, 它会自己用 prefix 选项)
    this.bullClient = new Redis({
      host: cfg.host,
      port: cfg.port,
      password: cfg.password ?? undefined,
      db: cfg.db,
      // 故意不传 keyPrefix
      lazyConnect: false,
      enableReadyCheck: true,
      maxRetriesPerRequest: cfg.bullMaxRetriesPerRequest,
    });

    this.client.on('error', (err) => {
      this.logger.error(`Redis client error: ${err.message}`);
    });
    this.client.on('connect', () => {
      this.logger.log(`Redis connected: ${cfg.host}:${cfg.port}/${cfg.db}`);
    });
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.allSettled([this.client?.quit(), this.bullClient?.quit()]);
  }

  // ========================================================================
  // 基础命令封装 (ioredis 自动加 keyPrefix, 这里只传"逻辑 key")
  // ========================================================================

  /** 获取原始 client (供特殊场景如 multi / pipeline / SCAN MATCH) */
  getClient(): Redis {
    return this.client;
  }

  /** 获取 BullMQ 专用 client */
  getBullClient(): Redis {
    return this.bullClient;
  }

  /** 获取 keyPrefix (供 SCAN MATCH 这类 ioredis 不自动前缀的命令) */
  getKeyPrefix(): string {
    return this.keyPrefixStr;
  }

  // ----- String -----

  async set(key: string, value: string, ttlSec?: number): Promise<void> {
    await (ttlSec ? this.client.set(key, value, 'EX', ttlSec) : this.client.set(key, value));
  }

  async get(key: string): Promise<string | null> {
    return this.client.get(key);
  }

  async del(key: string): Promise<number> {
    return this.client.del(key);
  }

  async exists(key: string): Promise<boolean> {
    return (await this.client.exists(key)) === 1;
  }

  async incr(key: string): Promise<number> {
    return this.client.incr(key);
  }

  async expire(key: string, ttlSec: number): Promise<void> {
    await this.client.expire(key, ttlSec);
  }

  async ttl(key: string): Promise<number> {
    return this.client.ttl(key);
  }

  // ----- Hash -----

  async hset(key: string, field: string, value: string): Promise<void> {
    await this.client.hset(key, field, value);
  }

  async hget(key: string, field: string): Promise<string | null> {
    return this.client.hget(key, field);
  }

  async hgetall(key: string): Promise<Record<string, string>> {
    return this.client.hgetall(key);
  }

  // ----- Sorted Set (rate limit) -----

  /**
   * ZADD + EXPIRE (原子操作, 用 multi).
   * 用于滑动窗口限流 (e.g. 短信发送频率).
   */
  async slidingWindowAdd(key: string, member: string, score: number, windowSec: number): Promise<void> {
    await this.client
      .multi()
      .zadd(key, score, member)
      .zremrangebyscore(key, 0, score - windowSec * 1000)
      .expire(key, windowSec)
      .exec();
  }

  /** 滑动窗口计数 (key 范围内 [now-window, now] 的元素数) */
  async slidingWindowCount(key: string, windowSec: number): Promise<number> {
    const now = Date.now();
    return this.client.zcount(key, now - windowSec * 1000, now);
  }

  // ----- Stream (审计日志, 异步消费) -----

  /**
   * XADD 写审计日志 (异步消费, V2 主流程).
   * 失败兜底: 业务层可以 catch 后改用 sync 写 DB.
   */
  async xadd(streamKey: string, fields: Record<string, string>): Promise<string | null> {
    try {
      const args = Object.entries(fields).flatMap(([k, v]) => [k, v]);
      return await this.client.xadd(streamKey, '*', ...args);
    } catch (err) {
      this.logger.warn(`xadd failed (${streamKey}): ${(<Error>err).message}`);
      return null;
    }
  }

  // ----- Health -----

  async ping(): Promise<boolean> {
    try {
      const res = await this.client.ping();
      return res === 'PONG';
    } catch {
      return false;
    }
  }
}
