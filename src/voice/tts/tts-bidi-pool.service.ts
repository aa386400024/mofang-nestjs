// V2026-10-08 治本 (TTS bidi 连接池):
//   容量模型: 1 session = 1 bidi WS 连接 (MiniMax 协议约束, SPEC §6.4)
//   上限: 跟 MiniMax 单账号并发限制对齐, V0.x 默认 100 (保守; 实测后调)
//   排队: 上限满时 acquire 进入 FIFO 队列, 带超时 (默认 10s), 防止无限等待
//   释放: client 调 task_finish 或 close 后, pool 移除 + 唤醒队列头
//
// 反双胞胎:
//   - 不用 LRU cache / Map<string, TtsBidiClient> 直接当池 — 需要上限 + 等待队列
//   - 不用 RxJS Subject / Semaphore — AsyncIterator + 普通数组就够
//   - 不在 pool 里做 reconnect — V0.x 简化, client 错误直接 fail, 上层重建
//
// 如何验证:
//   1. 并发 acquire 100 次都成功, 第 101 次排队
//   2. 释放 1 个, 队列头立刻拿到 client
//   3. acquire 超时 (10s) → 抛 TimeoutError, 不阻塞

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { TtsBidiClient } from './tts-bidi-client';
import type { TtsOptions } from './tts.types';

interface QueueItem {
  readonly opts: TtsOptions;
  readonly resolve: (client: TtsBidiClient) => void;
  readonly reject: (err: Error) => void;
  readonly enqueuedAt: number;
}

@Injectable()
export class TtsBidiPoolService {
  private readonly logger = new Logger(TtsBidiPoolService.name);
  private readonly maxConnections: number;
  private readonly acquireTimeoutMs: number;
  private readonly pool = new Map<string, TtsBidiClient>();
  private readonly waitQueue: QueueItem[] = [];

  constructor(config: ConfigService) {
    this.maxConnections = config.get<number>('minimax.ttsMaxConnections') ?? 100;
    this.acquireTimeoutMs = config.get<number>('minimax.ttsAcquireTimeoutMs') ?? 10_000;
  }

  /** 获取或排队等一个 client. */
  async acquire(opts: TtsOptions): Promise<TtsBidiClient> {
    // 已有 (重复 acquire 同一 session — 直接返回)
    const existing = this.pool.get(opts.sessionId);
    if (existing) return existing;

    // 有空位
    if (this.pool.size < this.maxConnections) {
      return this.createClient(opts);
    }

    // 排队
    this.logger.log(
      `[queue] session=${opts.sessionId} tenant=${opts.tenantId} ` +
        `current=${this.pool.size}/${this.maxConnections} queue=${this.waitQueue.length + 1}`,
    );
    return new Promise<TtsBidiClient>((resolve, reject) => {
      const item: QueueItem = {
        opts,
        resolve,
        reject,
        enqueuedAt: Date.now(),
      };
      this.waitQueue.push(item);

      // 超时
      setTimeout(() => {
        const idx = this.waitQueue.indexOf(item);
        if (idx === -1) return; // 已被处理
        this.waitQueue.splice(idx, 1);
        reject(
          new Error(
            `TtsBidiPool: acquire timeout after ${this.acquireTimeoutMs}ms ` + `(session=${opts.sessionId}, queue position was ${idx + 1})`,
          ),
        );
      }, this.acquireTimeoutMs);
    });
  }

  /** 释放 — 关闭 client, 唤醒队列头. */
  release(sessionId: string): void {
    const client = this.pool.get(sessionId);
    if (client) {
      client.close();
      this.pool.delete(sessionId);
      this.logger.log(`[release] session=${sessionId} current=${this.pool.size}/${this.maxConnections}`);
    }
    this.drainQueue();
  }

  /** 健康检查 — V1.x 用, V0.x 暂不需要. */
  stats(): { active: number; queued: number; max: number } {
    return {
      active: this.pool.size,
      queued: this.waitQueue.length,
      max: this.maxConnections,
    };
  }

  /** 进程退出时全量关闭. */
  async shutdown(): Promise<void> {
    this.logger.warn(`[shutdown] closing ${this.pool.size} clients + ${this.waitQueue.length} queue`);
    for (const client of this.pool.values()) {
      client.close();
    }
    this.pool.clear();
    // 拒绝所有还在排队的
    for (const item of this.waitQueue.splice(0)) {
      item.reject(new Error('TtsBidiPool: pool shutting down'));
    }
  }

  // ── private ────────────────────────────────────────────────────

  private async createClient(opts: TtsOptions): Promise<TtsBidiClient> {
    const client = new TtsBidiClient(this.injectConfigService(), opts);
    try {
      await client.connect();
    } catch (err) {
      this.logger.warn(`[create_failed] session=${opts.sessionId} ${err instanceof Error ? err.message : String(err)}`);
      throw err;
    }
    this.pool.set(opts.sessionId, client);
    this.logger.log(`[acquired] session=${opts.sessionId} tenant=${opts.tenantId} ` + `current=${this.pool.size}/${this.maxConnections}`);
    return client;
  }

  private drainQueue(): void {
    while (this.pool.size < this.maxConnections && this.waitQueue.length > 0) {
      const next = this.waitQueue.shift();
      if (!next) break;
      this.createClient(next.opts).then(next.resolve).catch(next.reject);
    }
  }

  /**
   * 注入 ConfigService 给 client — 因为 TtsBidiClient 是手动 new (不在 DI 容器).
   * V0.x 简单做法: 通过 Pool 持有 ConfigService 引用, createClient 时传入.
   * 后期可改成工厂 provider (`{ provide: TtsBidiClient, useFactory: ... }`).
   */
  private injectConfigService(): ConfigService {
    // NestJS DI 通过 constructor 注入; Pool 自己持有 config, 这里复用.
    return this.configServiceRef;
  }

  // V0.x: 显式持有引用 (因为 TtsBidiClient 是手动 new, 不走 DI)
  private configServiceRef!: ConfigService;

  /** Module 初始化时调用, 注入 ConfigService. */
  init(configService: ConfigService): void {
    this.configServiceRef = configService;
  }
}
