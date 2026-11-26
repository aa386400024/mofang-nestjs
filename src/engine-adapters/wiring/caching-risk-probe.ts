// AF-537 P1 6.16: 同一轮里前置 gate、内核 assessSafety、输出侧 guard 会对同一段文本
// 用同一个 probe 重复探测，结论必然相同却要付 3 次 Python BERT 往返。
// 这里在装配层套一层短 TTL 缓存（按 text + side），不改内核、不改端口契约。

import type { RiskProbePort, RiskProbeResult, SafetySide } from '../../engine-core/index.js';

/** 缓存条目有效期（毫秒）。只用于吸收同一轮内的重复探测，不做跨轮记忆。 */
const DEFAULT_TTL_MS = 2000;
/** 缓存条目上限，防止恶意长文本把内存打满。 */
const DEFAULT_MAX_ENTRIES = 5000;

interface CacheEntry {
  readonly at: number;
  readonly result: Promise<RiskProbeResult>;
}

/**
 * 风险探测器缓存装饰器。
 *
 * 失败不缓存（避免一次网络抖动让后续判定都拿到失败），并发同键共享同一个 Promise。
 */
export class CachingRiskProbe implements RiskProbePort {
  private readonly entries = new Map<string, CacheEntry>();

  constructor(
    private readonly inner: RiskProbePort,
    private readonly ttlMs: number = DEFAULT_TTL_MS,
    private readonly maxEntries: number = DEFAULT_MAX_ENTRIES,
  ) {}

  async probe(text: string, side: SafetySide): Promise<RiskProbeResult> {
    const key = `${side}\u0000${text}`;
    const now = Date.now();
    const cached = this.entries.get(key);
    if (cached && now - cached.at < this.ttlMs) {
      return await cached.result;
    }

    const promise = this.inner.probe(text, side).catch((error: unknown) => {
      this.entries.delete(key);
      throw error;
    });
    this.entries.set(key, { at: now, result: promise });
    this.evictIfNeeded();
    return await promise;
  }

  private evictIfNeeded(): void {
    if (this.entries.size <= this.maxEntries) return;
    const now = Date.now();
    for (const [key, entry] of this.entries) {
      if (now - entry.at >= this.ttlMs) this.entries.delete(key);
    }
    // 仍然超限时按插入顺序淘汰最旧条目（Map 保持插入序）。
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
  }
}
