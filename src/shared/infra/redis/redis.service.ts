import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
// V2026-11-02 ESM/NodeNext: ioredis v5 在 NodeNext 下 default import 拿到 namespace 而非类,
//   改命名导入 { Redis }. 类型 RedisOptions 同名导出, 保持不变.
import { Redis, type RedisOptions } from 'ioredis';

// ⚠️ 必须直接 import 文件, 不能用 barrel '../../../common'.
// 原因同 redis.module.ts: barrel 会触发 filters/biz-exception.filter → observability → shared/infra/index → redis 循环.
// 直接 import 文件保证 ConfigService class token 与 CommonModule 注册的 token 是同一引用.
import { ConfigService } from '../../../common/providers/config.service.js';

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

  /**
   * 原子"仅当不存在时"写 (SET NX [+ EX]).
   *
   * 为什么需要它 (WP65 · per-session mutex):
   *     mutex 的语义就是"同一时刻只有一个持有者" —— 用 "先 get 再 set" 拼出来的是
   *     **读-改-写**: 两个并发调用会同时看到"不存在" → 同时写 → 两个持有者 →
   *     mutex 静默失效 (而且不报错, 最难查的那一类).
   *     SET ... NX 由 Redis 侧原子完成, 才是真的互斥.
   *
   * ⚠️ 返回 false = **没拿到** (key 已存在), 不是失败 —— 调用方要分清
   *     "被占用"与"Redis 挂了"两种情况 (后者的处置口径不同).
   *
   * @param key 逻辑 key
   * @param value 值 (调用方自定, 例如持有者标识)
   * @param ttlSec TTL (秒); 不给 = 不过期
   * @returns true = 写入成功 (拿到); false = key 已存在 (没拿到)
   */
  async setnx(key: string, value: string, ttlSec?: number): Promise<boolean> {
    const result = ttlSec === undefined ? await this.client.set(key, value, 'NX') : await this.client.set(key, value, 'EX', ttlSec, 'NX');
    return result === 'OK';
  }

  async exists(key: string): Promise<boolean> {
    return (await this.client.exists(key)) === 1;
  }

  async incr(key: string): Promise<number> {
    return this.client.incr(key);
  }

  /**
   * 原子累加 (计数器 += amount).
   *
   * 为什么不用 "get + set" 自己拼: 那是读-改-写, 两个会话**同时**收尾时
   *  后写的那个会把先写的覆盖掉 —— 计数会**少算**, 而这个计数的用途恰恰是
   * "防烧额度", 少算等于没算. INCRBY 在 Redis 侧原子完成.
   *
   * @param key 逻辑 key
   * @param amount 增量 (整数)
   * @returns 累加后的值
   */
  async incrby(key: string, amount: number): Promise<number> {
    return this.client.incrby(key, amount);
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
