/**
 * TTS 会话并发闸门 — provider 级上限 + FIFO 排队.
 *
 * 为什么需要: 豆包 premium 一场一条双向流式 WS，原实现直接 `new DoubaoTtsClient`
 * 建连。并发场次升高时既没有上限，也没有排队，上游会把连接直接打满/限流。
 * MiniMax 侧已有 TtsBidiPoolService；本类把同一套容量模型抽成 provider 无关的
 * 纯闸门，供豆包路径复用，避免复制第二份连接池。
 *
 * 边界:
 * - 只控并发数量，不建连、不重连、不缓存连接；
 * - 租约按 id 释放，幂等；超时只拒绝排队项，不影响已在跑的会话。
 */

import { Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';

interface Waiter {
  readonly id: string;
  readonly label: string;
  readonly resolve: (lease: TtsSessionLease) => void;
  readonly reject: (error: Error) => void;
  readonly timer: NodeJS.Timeout;
}

/** 并发租约. */
export interface TtsSessionLease {
  readonly id: string;
  readonly label: string;
}

/**
 * provider 无关的 TTS 会话并发闸门.
 */
export class TtsSessionLimiter {
  private readonly logger = new Logger(TtsSessionLimiter.name);
  private readonly waiters: Waiter[] = [];
  private active = 0;

  /**
   * @param maxConcurrent 最大并发会话数（<=0 时按 1 处理）
   * @param acquireTimeoutMs 排队超时（<=0 时不超时）
   */
  constructor(
    maxConcurrent: number,
    private readonly acquireTimeoutMs: number,
  ) {
    this.max = Math.max(1, Math.floor(maxConcurrent));
  }

  private readonly max: number;

  /** 当前并发 / 排队长度（诊断用）. */
  stats(): { readonly active: number; readonly queued: number; readonly max: number } {
    return { active: this.active, queued: this.waiters.length, max: this.max };
  }

  /**
   * 申请一个并发槽位；满员时 FIFO 排队，超时拒绝.
   *
   * @param label 日志用标签（sessionId / tenant 等）
   */
  async acquire(label: string): Promise<TtsSessionLease> {
    if (this.active < this.max) {
      this.active += 1;
      return { id: randomUUID(), label };
    }
    return new Promise<TtsSessionLease>((resolve, reject) => {
      const waiter: Waiter = {
        id: randomUUID(),
        label,
        resolve,
        reject,
        timer: setTimeout(() => {
          const index = this.waiters.indexOf(waiter);
          if (index === -1) return;
          this.waiters.splice(index, 1);
          reject(new Error(`TtsSessionLimiter: acquire timeout after ${this.acquireTimeoutMs}ms (label=${label})`));
        }, this.acquireTimeoutMs),
      };
      waiter.timer.unref?.();
      this.waiters.push(waiter);
      this.logger.log(`[queue] label=${label} active=${this.active}/${this.max} queued=${this.waiters.length}`);
    });
  }

  /**
   * 释放槽位（幂等由调用方保证只调一次；重复调用不会减少 active 到负数）.
   *
   * @param leaseId 租约 id
   */
  release(_leaseId: string): void {
    if (this.active <= 0) return;
    this.active -= 1;
    const next = this.waiters.shift();
    if (!next) return;
    clearTimeout(next.timer);
    this.active += 1;
    next.resolve({ id: next.id, label: next.label });
  }

  /** 进程退出：拒绝所有排队项. */
  shutdown(): void {
    for (const waiter of this.waiters.splice(0)) {
      clearTimeout(waiter.timer);
      waiter.reject(new Error('TtsSessionLimiter: shutting down'));
    }
  }
}
