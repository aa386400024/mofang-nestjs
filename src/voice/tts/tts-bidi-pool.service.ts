// V2026-10-23 治本 (TTS bidi 连接池 — 生命周期修正版, spec §3.6):
//   旧实现的 3 个隐患 (本次全部修掉):
//     ① **config 没注入**: TtsBidiClient 是手动 new (不走 DI), 旧代码靠 `pool.init(config)`
//        在 onApplicationBootstrap 里手工塞 —— 模块若没被 bootstrap (单测 / 独立引入)
//        就会在 `this.configServiceRef!` 上炸 undefined. 治本: 池自己用构造器注入 ConfigService,
//        并把它**显式传给** client, 不再靠"外部偷偷调 init"这种隐式契约.
//     ② **每轮结束不 release**: 旧 VoiceService 只 cancel 不 release, 连接池里的条目只增不减,
//        最终要么打满上限, 要么留下已死连接占坑. 治本: 租约 (lease) 化 —— 每条连接一个
//        独立 id, 释放按 id 走, 天然幂等, 且**不会误伤同 session 的新连接**.
//     ③ **不可重建**: 旧 release 只是从 Map 删条目; 现在条目在连接真正关闭时自动出池,
//        且 acquire 每次新建连接 (官方协议一轮 = 一条连接: task_start → task_finish → 关).
//   容量模型: 1 条连接 = 1 个上游 bidi 会话; 上限跟 MiniMax 单账号并发限制对齐.
//   排队: 上限满时 acquire 进 FIFO 队列, 带超时 (默认 10s), 防无限等待.
//
//   反双胞胎:
//     - 不用 LRU / Map 直接当池: 需要上限 + 等待队列
//     - 不用 RxJS Subject / Semaphore: AsyncIterator + 普通数组就够
//     - 不在池里做重连: 重连是"本轮要不要继续"的业务决策, 交给上层
//
//   验证 (由大炮在 Windows 环境手动执行):
//     1. tsc 0 错
//     2. 并发 acquire 达上限后第 N+1 个排队; 释放 1 个立刻唤醒队头
//     3. acquire 超时 → 抛错, 不阻塞
//     4. 一轮结束后池内条目数回到 0
//
//   时间戳: 2026-10-23

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { TtsBidiClient } from './tts-bidi-client';
import type { TtsOptions } from './tts.types';

interface QueueItem {
  readonly opts: TtsOptions;
  readonly resolve: (lease: TtsPoolLease) => void;
  readonly reject: (err: Error) => void;
}

/**
 * 连接租约 — 连接池对外的唯一持有凭证.
 *
 * 释放按 `id` 走 (而不是 sessionId): 一轮 = 一条连接, 下一轮会拿到**新** id,
 * 上一轮的迟到 dispose 不会把新连接误关掉.
 */
export interface TtsPoolLease {
  /** 租约 id (池内唯一). */
  readonly id: string;
  /** 本次会话 id (日志用). */
  readonly sessionId: string;
  /** 底层客户端. */
  readonly client: TtsBidiClient;
}

interface PoolEntry {
  readonly lease: TtsPoolLease;
  readonly sessionId: string;
}

@Injectable()
export class TtsBidiPoolService {
  private readonly logger = new Logger(TtsBidiPoolService.name);
  private readonly maxConnections: number;
  private readonly acquireTimeoutMs: number;
  private readonly config: ConfigService;
  private readonly entries = new Map<string, PoolEntry>();
  private readonly waitQueue: QueueItem[] = [];
  private leaseCounter = 0;

  /**
   * @param config 全局配置 (构造器注入, 不再依赖外部手工 init)
   */
  constructor(config: ConfigService) {
    this.config = config;
    this.maxConnections = config.get<number>('minimax.ttsMaxConnections') ?? 100;
    this.acquireTimeoutMs = config.get<number>('minimax.ttsAcquireTimeoutMs') ?? 10_000;
  }

  /**
   * 获取一条连接 (满员时排队等待).
   *
   * @param opts 本次会话选项
   * @returns 连接租约
   * @throws 排队超时 / 连接建立失败
   */
  async acquire(opts: TtsOptions): Promise<TtsPoolLease> {
    if (this.entries.size < this.maxConnections) {
      return this.createLease(opts);
    }

    this.logger.log(
      `[queue] session=${opts.sessionId} tenant=${opts.tenantId} ` +
        `current=${this.entries.size}/${this.maxConnections} queue=${this.waitQueue.length + 1}`,
    );
    return new Promise<TtsPoolLease>((resolve, reject) => {
      const item: QueueItem = { opts, resolve, reject };
      this.waitQueue.push(item);
      const timer = setTimeout(() => {
        const index = this.waitQueue.indexOf(item);
        if (index === -1) return; // 已被处理
        this.waitQueue.splice(index, 1);
        reject(
          new Error(
            `TtsBidiPool: acquire timeout after ${this.acquireTimeoutMs}ms ` +
              `(session=${opts.sessionId}, queue position was ${index + 1})`,
          ),
        );
      }, this.acquireTimeoutMs);
      timer.unref?.();
    });
  }

  /**
   * 释放租约 — 关闭连接并唤醒队头 (幂等).
   *
   * @param leaseId 租约 id
   */
  release(leaseId: string): void {
    const entry = this.entries.get(leaseId);
    if (entry) {
      this.entries.delete(leaseId);
      entry.lease.client.close();
      this.logger.log(`[release] session=${entry.sessionId} current=${this.entries.size}/${this.maxConnections}`);
    }
    this.drainQueue();
  }

  /**
   * 池状态 (健康检查 / 诊断).
   */
  stats(): { active: number; queued: number; max: number } {
    return {
      active: this.entries.size,
      queued: this.waitQueue.length,
      max: this.maxConnections,
    };
  }

  /**
   * 进程退出时全量关闭.
   */
  async shutdown(): Promise<void> {
    this.logger.warn(`[shutdown] closing ${this.entries.size} clients + ${this.waitQueue.length} queue`);
    for (const entry of this.entries.values()) {
      entry.lease.client.close();
    }
    this.entries.clear();
    for (const item of this.waitQueue.splice(0)) {
      item.reject(new Error('TtsBidiPool: pool shutting down'));
    }
  }

  // ── private ────────────────────────────────────────────────────

  /**
   * 新建连接并登记.
   *
   * @param opts 会话选项
   * @returns 租约
   */
  private async createLease(opts: TtsOptions): Promise<TtsPoolLease> {
    this.leaseCounter += 1;
    const leaseId = `${opts.sessionId}#${this.leaseCounter}`;

    const client = new TtsBidiClient(this.config, opts, () => {
      // 连接真正关闭时自动出池 (task_finished / task_failed / 异常断开都走这里)
      const entry = this.entries.get(leaseId);
      if (entry) {
        this.entries.delete(leaseId);
        this.drainQueue();
      }
    });

    try {
      await client.connect();
    } catch (err) {
      client.close();
      this.logger.warn(`[create_failed] session=${opts.sessionId} ${err instanceof Error ? err.message : String(err)}`);
      throw err;
    }

    const lease: TtsPoolLease = { id: leaseId, sessionId: opts.sessionId, client };
    this.entries.set(leaseId, { lease, sessionId: opts.sessionId });
    this.logger.log(`[acquired] session=${opts.sessionId} lease=${leaseId} ` + `current=${this.entries.size}/${this.maxConnections}`);
    return lease;
  }

  /**
   * 唤醒排队中的队头.
   */
  private drainQueue(): void {
    while (this.entries.size < this.maxConnections && this.waitQueue.length > 0) {
      const next = this.waitQueue.shift();
      if (!next) break;
      this.createLease(next.opts).then(next.resolve).catch(next.reject);
    }
  }
}
