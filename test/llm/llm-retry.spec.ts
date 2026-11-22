// V2026-11-09 治本 (Phase2.5 WP-H · 改动 3): 显式退避重试层的单测.
//
// 为什么这层要有单测: 此前重试策略藏在 LangChain 内部 (AsyncCaller 默认 6 次),
//   次数不可配、判定不可见、单测够不着 —— 于是"到底重试了几次、为什么重试"
//   没人答得上来. 现在它是**我们自己**的一份真相, 就该被钉死.
//
// 边界: 纯函数 + 注入时钟/随机源/睡眠, 零网络零等待.
//
// 验证: npx vitest run test/llm/llm-retry.spec.ts

import { describe, expect, it } from 'vitest';

import {
  DEFAULT_LLM_MAX_RETRIES,
  LLM_RETRY_BASE_DELAYS_MS,
  computeLlmRetryDelayMs,
  isRetryableLlmError,
  runWithLlmRetry,
} from '../../src/llm/common/llm-retry.js';

/**
 * 构造一个带 HTTP 状态码的错误 (OpenAI SDK 的 APIError 就是这个形状).
 *
 * @param status HTTP 状态码
 * @returns 错误对象
 */
function httpError(status: number): Error {
  const error = new Error(`upstream status=${status}`) as Error & { status: number };
  error.status = status;
  return error;
}

/**
 * 构造一个网络层错误 (带 code).
 *
 * @param code 错误码
 * @returns 错误对象
 */
function networkError(code: string): Error {
  const error = new Error(`network ${code}`) as Error & { code: string };
  error.code = code;
  return error;
}

/** 记录每次等待的毫秒数 (不真的等). */
function recordingSleep(): { readonly sleep: (ms: number) => Promise<void>; readonly waits: number[] } {
  const waits: number[] = [];
  return {
    waits,
    sleep: async (ms: number) => {
      waits.push(ms);
    },
  };
}

describe('WP-H 改动 3 · LLM 显式退避重试层', () => {
  describe('① 可重试判定 (只对 429 / 5xx / 超时 / 网络抖动重试)', () => {
    it('429 限流 → 可重试', () => {
      expect(isRetryableLlmError(httpError(429))).toBe(true);
    });

    it('5xx 上游故障 → 可重试', () => {
      for (const status of [500, 502, 503, 504]) {
        expect(isRetryableLlmError(httpError(status))).toBe(true);
      }
    });

    it('408 请求超时 → 可重试', () => {
      expect(isRetryableLlmError(httpError(408))).toBe(true);
    });

    it('401 / 403 鉴权失败 → 不可重试 (坏 key 对所有候选都坏, 重试只是放大延迟)', () => {
      expect(isRetryableLlmError(httpError(401))).toBe(false);
      expect(isRetryableLlmError(httpError(403))).toBe(false);
    });

    it('400 / 404 / 422 参数错 → 不可重试', () => {
      for (const status of [400, 404, 422]) {
        expect(isRetryableLlmError(httpError(status))).toBe(false);
      }
    });

    it('连接重置 / 超时类网络错 → 可重试', () => {
      expect(isRetryableLlmError(networkError('ECONNRESET'))).toBe(true);
      expect(isRetryableLlmError(networkError('ETIMEDOUT'))).toBe(true);
    });

    it('调用方主动中止 (AbortError) → 不可重试 (重试它等于无视调用方的放弃决定)', () => {
      const aborted = new Error('The operation was aborted');
      aborted.name = 'AbortError';
      expect(isRetryableLlmError(aborted)).toBe(false);
    });
  });

  describe('② 退避时长 (指数基数 + 抖动)', () => {
    it('退避基数是 500ms / 1.5s / 4s', () => {
      expect(LLM_RETRY_BASE_DELAYS_MS).toEqual([500, 1500, 4000]);
    });

    it('随机源取中点时抖动为 0 (基数字面量)', () => {
      const mid = () => 0.5;
      expect(computeLlmRetryDelayMs(0, LLM_RETRY_BASE_DELAYS_MS, mid)).toBe(500);
      expect(computeLlmRetryDelayMs(1, LLM_RETRY_BASE_DELAYS_MS, mid)).toBe(1500);
      expect(computeLlmRetryDelayMs(2, LLM_RETRY_BASE_DELAYS_MS, mid)).toBe(4000);
    });

    it('抖动幅度不超过基数的 25% (下界 / 上界)', () => {
      expect(computeLlmRetryDelayMs(0, LLM_RETRY_BASE_DELAYS_MS, () => 0)).toBe(375);
      expect(computeLlmRetryDelayMs(0, LLM_RETRY_BASE_DELAYS_MS, () => 1)).toBe(625);
    });

    it('超出基数序列时取最后一个 (不越界成 Infinity)', () => {
      expect(computeLlmRetryDelayMs(9, LLM_RETRY_BASE_DELAYS_MS, () => 0.5)).toBe(4000);
    });
  });

  describe('③ 重试执行 (次数 / 上抛 / 中止)', () => {
    it('429 连续失败 → 重试到次数用尽后**原样上抛**最后一个错误', async () => {
      const { sleep, waits } = recordingSleep();
      let attempts = 0;

      await expect(
        runWithLlmRetry(
          async () => {
            attempts += 1;
            throw httpError(429);
          },
          { maxRetries: 2, sleep, random: () => 0.5 },
        ),
      ).rejects.toMatchObject({ status: 429 });

      expect(attempts, '2 次重试 = 共 3 次尝试').toBe(3);
      expect(waits, '每次重试前都要退避一次').toEqual([500, 1500]);
    });

    it('401 鉴权失败 → 立即上抛, 一次都不重试', async () => {
      const { sleep, waits } = recordingSleep();
      let attempts = 0;

      await expect(
        runWithLlmRetry(
          async () => {
            attempts += 1;
            throw httpError(401);
          },
          { maxRetries: 2, sleep, random: () => 0.5 },
        ),
      ).rejects.toMatchObject({ status: 401 });

      expect(attempts, '鉴权失败不重试').toBe(1);
      expect(waits).toEqual([]);
    });

    it('成功 → 不重试 (只调用一次)', async () => {
      const { sleep, waits } = recordingSleep();
      let attempts = 0;

      const result = await runWithLlmRetry(
        async () => {
          attempts += 1;
          return 'ok';
        },
        { sleep, random: () => 0.5 },
      );

      expect(result).toBe('ok');
      expect(attempts).toBe(1);
      expect(waits).toEqual([]);
    });

    it('调用方 signal 已中止 → 不再重试 (幽灵重试的解药)', async () => {
      const controller = new AbortController();
      controller.abort();
      const { sleep } = recordingSleep();
      let attempts = 0;

      await expect(
        runWithLlmRetry(
          async () => {
            attempts += 1;
            throw httpError(429);
          },
          { maxRetries: 2, sleep, signal: controller.signal, random: () => 0.5 },
        ),
      ).rejects.toMatchObject({ status: 429 });

      expect(attempts, '已中止就不该再打上游').toBe(1);
    });

    it('默认重试次数是 2 (共 3 次尝试)', () => {
      expect(DEFAULT_LLM_MAX_RETRIES).toBe(2);
    });
  });
});
