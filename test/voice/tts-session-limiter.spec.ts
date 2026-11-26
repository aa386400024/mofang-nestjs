import { afterEach, describe, expect, it, vi } from 'vitest';

import { TtsSessionLimiter } from '../../src/voice/tts/tts-session-limiter.js';

afterEach(() => {
  vi.useRealTimers();
});

describe('AF-561 · TtsSessionLimiter', () => {
  it('满员时排队，释放一个唤醒队头', async () => {
    const limiter = new TtsSessionLimiter(2, 10_000);
    const a = await limiter.acquire('a');
    const b = await limiter.acquire('b');
    expect(limiter.stats()).toEqual({ active: 2, queued: 0, max: 2 });

    let third: Awaited<ReturnType<TtsSessionLimiter['acquire']>> | null = null;
    const thirdPromise = limiter.acquire('c').then((lease) => {
      third = lease;
      return lease;
    });
    expect(limiter.stats()).toEqual({ active: 2, queued: 1, max: 2 });

    limiter.release(a.id);
    const acquired = await thirdPromise;
    expect(acquired.label).toBe('c');
    expect(third).not.toBeNull();
    expect(limiter.stats()).toEqual({ active: 2, queued: 0, max: 2 });
    limiter.release(b.id);
    limiter.release(acquired.id);
    expect(limiter.stats().active).toBe(0);
  });

  it('排队超时拒绝，不占槽位', async () => {
    vi.useFakeTimers();
    const limiter = new TtsSessionLimiter(1, 500);
    await limiter.acquire('a');
    const pending = limiter.acquire('b');
    const rejection = pending.catch((error: unknown) => (error as Error).message);
    await vi.advanceTimersByTimeAsync(600);
    expect(await rejection).toContain('acquire timeout');
    expect(limiter.stats()).toEqual({ active: 1, queued: 0, max: 1 });
    limiter.shutdown();
  });

  it('shutdown 拒绝所有排队项', async () => {
    const limiter = new TtsSessionLimiter(1, 10_000);
    await limiter.acquire('a');
    const pending = limiter.acquire('b');
    limiter.shutdown();
    await expect(pending).rejects.toThrow('shutting down');
    expect(limiter.stats().queued).toBe(0);
  });
});
