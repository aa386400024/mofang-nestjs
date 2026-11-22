// V2026-11-02 治本 (WP16 · round_id 幂等 + 断流不重复叠加 · 单测):
//   覆盖任务单 §4 验收表:
//     ① 同 sessionId + 同 round_id 第二次请求 → 直接返回缓存结果, BDI 不重跑、LLM 不调;
//     ② 流式中途 abort → 状态已提交但回复不完整 (缓存标记 complete=false);
//     ③ 断流后重发同一 round_id → 返回 turn_incomplete 错误码, 不重放旧轮;
//     ④ 关闭会话后内存 Map 清理;
//   外加三条护栏:
//     ⑤ 不带 round_id → 行为与 WP16 之前逐字一致 (不走幂等);
//     ⑥ 并发重发 (上一轮还在跑) → 等它落定后复用, 引擎只被调一次;
//     ⑦ 重放**不重复副作用** (逐字稿不落第二条 / 引擎不再被调).
//
//   全 mock: 引擎门面用 stub (记录调用次数, 可脚本化中断/降级); 不起 Nest 容器, 不发网络.
//
//   验证: npx vitest run test/engine-adapters/wp16-round-id-idempotency.spec.ts
//   时间戳: 2026-11-02 GMT+8

import type { LlmStreamChunk } from '../../src/agent/llm/llm.types.js';
import type { TurnRenderResult } from '../../src/engine-adapters/rendering/turn-render-orchestrator.js';
import { EngineStreamBackend } from '../../src/engine-adapters/wiring/engine-stream-backend.adapter.js';
import type { EngineTurnService } from '../../src/engine-adapters/wiring/engine-turn.service.js';
import { TurnIdempotencyService } from '../../src/engine-adapters/wiring/turn-idempotency.service.js';
import { TURN_INCOMPLETE_CODE } from '../../src/voice/voice-turn-backend.port.js';

const SESSION_ID = 'session-1';
const HANDLE_ID = 'handle-1';
const USER_ID = 'user-1';
const TENANT_ID = 'tenant-1';

/**
 * 一轮的行为脚本 (stub 引擎按它演).
 */
interface TurnPlan {
  /** 引擎逐段吐出的增量. */
  readonly deltas: readonly string[];
  /** 本轮回复全文 (正常路径 = deltas 拼起来). */
  readonly reply: string;
  /** 是否走降级 (providerHint='degraded'). */
  readonly degraded?: boolean;
  /** 引擎流是否抛错 (模拟建流失败 / 流中断). */
  readonly fail?: boolean;
  /** 抛错前是否先 abort 掉 signal (模拟 barge-in / 前端取消). */
  readonly abortBeforeFail?: boolean;
  /** 返回前先等这么久 (并发重发测试用). */
  readonly delayMs?: number;
}

/**
 * 假引擎门面: 记录调用, 按脚本演.
 */
class StubEngine {
  readonly turnCalls: { readonly userText: string; readonly signal?: AbortSignal }[] = [];
  /** 本轮脚本 (每次调用可换). */
  plan: TurnPlan = { deltas: ['我……不太想聊这个。'], reply: '我……不太想聊这个。' };
  /**
   * 打断用的控制器 (测试注入).
   *
   * 为什么单独注入: `abort()` 在 **AbortController** 上, 不在 AbortSignal 上 ——
   * 信号只有 `aborted` / `reason`. 引擎侧模拟"被 barge-in"时, 拿到的是信号,
   * 要把它置成 aborted 得回头找控制器.
   */
  controller: AbortController | undefined;

  open(input: { sessionId: string }): { handleId: string; sessionId: string } {
    return { handleId: HANDLE_ID, sessionId: input.sessionId };
  }

  close(): void {
    /* noop */
  }

  async turnStream(
    _handleId: string,
    input: { userText: string; signal?: AbortSignal },
    handlers: { onDelta: (delta: string) => void | Promise<void> },
  ): Promise<TurnRenderResult> {
    this.turnCalls.push({ userText: input.userText, signal: input.signal });
    const plan = this.plan;
    for (const delta of plan.deltas) {
      await handlers.onDelta(delta);
    }
    if (plan.abortBeforeFail) this.controller?.abort();
    if (plan.delayMs && plan.delayMs > 0) {
      await new Promise<void>((resolve) => setTimeout(resolve, plan.delayMs));
    }
    if (plan.fail) throw new Error('引擎流中断');
    return buildRenderResult(plan);
  }
}

/**
 * 造一份本轮渲染结果.
 */
function buildRenderResult(plan: TurnPlan): TurnRenderResult {
  return {
    reply: plan.reply,
    snapshot: {
      trust: 0.31,
      emotion: { label: 'anxious', valence: -0.42, arousal: 0.58 },
      resistance: { verbal: 0.44, depth: 0.5, style: 0.3 },
    } as TurnRenderResult['snapshot'],
    turnIndex: 1,
    render: {
      fallbackUsed: false,
      providerHint: plan.degraded ? 'degraded' : 'minimax',
      usage: { completionTokens: 604, totalTokens: 604 },
    },
  };
}

/**
 * 装一个被测的后端 (引擎 stub + 自己的幂等表, 便于断言).
 */
function buildBackend(): {
  readonly backend: EngineStreamBackend;
  readonly engine: StubEngine;
  readonly idempotency: TurnIdempotencyService;
} {
  const engine = new StubEngine();
  const idempotency = new TurnIdempotencyService();
  const backend = new EngineStreamBackend(
    engine as unknown as EngineTurnService,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    idempotency,
  );
  return { backend, engine, idempotency };
}

/**
 * 把一条流收成 chunk 数组.
 */
async function collect(stream: Promise<{ readonly stream: AsyncIterable<LlmStreamChunk> }>): Promise<LlmStreamChunk[]> {
  const { stream: iterable } = await stream;
  const chunks: LlmStreamChunk[] = [];
  for await (const chunk of iterable) {
    chunks.push(chunk);
  }
  return chunks;
}

/**
 * 本轮入参.
 */
function turnOptions(roundId?: number): {
  sessionId: string;
  tenantId: string;
  userId: string;
  personaId: string;
  userText: string;
  roundId?: number;
} {
  return {
    sessionId: SESSION_ID,
    tenantId: TENANT_ID,
    userId: USER_ID,
    personaId: 'visitor',
    userText: '最近睡得怎么样？',
    ...(roundId === undefined ? {} : { roundId }),
  };
}

/** 取出流里的正文 (content chunk 拼起来). */
function textOf(chunks: readonly LlmStreamChunk[]): string {
  return chunks
    .filter((chunk): chunk is Extract<LlmStreamChunk, { type: 'content' }> => chunk.type === 'content')
    .map((chunk) => chunk.content)
    .join('');
}

/** 取出流里的错误码. */
function errorCodeOf(chunks: readonly LlmStreamChunk[]): string | undefined {
  const error = chunks.find((chunk): chunk is Extract<LlmStreamChunk, { type: 'error' }> => chunk.type === 'error');
  return error?.error.code;
}

describe('WP16 · round_id 幂等 + 断流不重复叠加', () => {
  describe('① 同 sessionId + 同 round_id → 复用缓存, BDI 不重跑 / LLM 不重调', () => {
    it('第二次请求直接回缓存结果, 引擎一次都没被多调', async () => {
      const { backend, engine } = buildBackend();
      await backend.openSession({ sessionId: SESSION_ID, tenantId: TENANT_ID, userId: USER_ID });

      const first = await collect(backend.streamTurn(turnOptions(1)));
      const second = await collect(backend.streamTurn(turnOptions(1)));

      // 引擎只被调了一次 —— BDI 状态没有二次跳变.
      expect(engine.turnCalls).toHaveLength(1);
      // 两次拿到的是同一份结果.
      expect(textOf(second)).toBe(textOf(first));
      expect(textOf(first)).toBe('我……不太想聊这个。');
      // 重放的那次带 replayed 标记 (消费方据此知道"不是新的一轮").
      expect(second.at(-1)).toMatchObject({ type: 'done', replayed: true });
      // 第一次那条不带 (它是真跑的一轮).
      expect(first.at(-1)).toMatchObject({ type: 'done' });
      expect(first.at(-1)).not.toHaveProperty('replayed');
    });

    it('重放不重复落逐字稿 (同一轮只记一次)', async () => {
      const { backend, engine } = buildBackend();
      await backend.openSession({ sessionId: SESSION_ID, tenantId: TENANT_ID, userId: USER_ID });

      await collect(backend.streamTurn(turnOptions(1)));
      expect(backend.transcript(SESSION_ID)).toHaveLength(2);

      await collect(backend.streamTurn(turnOptions(1)));
      // 逐字稿仍然只有一问一答 —— 重放不追加第二条.
      expect(backend.transcript(SESSION_ID)).toHaveLength(2);
      expect(engine.turnCalls).toHaveLength(1);
    });

    it('不同 round_id → 正常跑新一轮 (各跑各的)', async () => {
      const { backend, engine } = buildBackend();
      await backend.openSession({ sessionId: SESSION_ID, tenantId: TENANT_ID, userId: USER_ID });

      await collect(backend.streamTurn(turnOptions(1)));
      await collect(backend.streamTurn(turnOptions(2)));

      expect(engine.turnCalls).toHaveLength(2);
      expect(backend.transcript(SESSION_ID)).toHaveLength(4);
    });
  });

  describe('② 流式中途 abort → 状态已提交但回复不完整', () => {
    it('abort 后缓存标记 complete=false', async () => {
      const { backend, engine, idempotency } = buildBackend();
      await backend.openSession({ sessionId: SESSION_ID, tenantId: TENANT_ID, userId: USER_ID });
      engine.plan = {
        deltas: ['我……'],
        reply: '我……不太想聊这个。',
        degraded: true,
        abortBeforeFail: true,
      };
      const controller = new AbortController();
      engine.controller = controller;

      const chunks = await collect(backend.streamTurn({ ...turnOptions(1), signal: controller.signal }));

      // 引擎这一轮确实跑过 (状态已提交), 且确实被打断.
      expect(engine.turnCalls).toHaveLength(1);
      expect(controller.signal.aborted).toBe(true);
      // 缓存里这一轮是"不完整"的.
      const entry = idempotency.lookup(SESSION_ID, 1);
      expect(entry?.status).toBe('done');
      if (entry?.status === 'done') {
        expect(entry.snapshot.complete).toBe(false);
        // 不完整时缓存的是**已发出的部分**.
        expect(entry.snapshot.reply).toBe('我……');
      }
      expect(chunks.length).toBeGreaterThan(0);
    });

    it('引擎流抛错 (没 abort) → 同样标记不完整', async () => {
      const { backend, engine, idempotency } = buildBackend();
      await backend.openSession({ sessionId: SESSION_ID, tenantId: TENANT_ID, userId: USER_ID });
      engine.plan = { deltas: ['我……'], reply: '我……', fail: true };

      await collect(backend.streamTurn(turnOptions(1)));

      const entry = idempotency.lookup(SESSION_ID, 1);
      expect(entry?.status).toBe('done');
      if (entry?.status === 'done') {
        expect(entry.snapshot.complete).toBe(false);
      }
    });

    it('降级但一个字都没产出 → 算完整 (兜底句已完整发出)', async () => {
      const { backend, engine, idempotency } = buildBackend();
      await backend.openSession({ sessionId: SESSION_ID, tenantId: TENANT_ID, userId: USER_ID });
      engine.plan = { deltas: [], reply: '我有点困惑，请再说一遍。', degraded: true };

      await collect(backend.streamTurn(turnOptions(1)));

      const entry = idempotency.lookup(SESSION_ID, 1);
      expect(entry?.status).toBe('done');
      if (entry?.status === 'done') {
        expect(entry.snapshot.complete).toBe(true);
      }
    });
  });

  describe('③ 断流后重发同一 round_id → turn_incomplete, 不重放旧轮', () => {
    it('缓存 complete=false 时再调 → 回 turn_incomplete 错误码', async () => {
      const { backend, engine } = buildBackend();
      await backend.openSession({ sessionId: SESSION_ID, tenantId: TENANT_ID, userId: USER_ID });
      engine.plan = { deltas: ['我……'], reply: '我……', degraded: true, abortBeforeFail: true };
      const controller = new AbortController();
      engine.controller = controller;

      await collect(backend.streamTurn({ ...turnOptions(1), signal: controller.signal }));
      const retry = await collect(backend.streamTurn(turnOptions(1)));

      // 回的是特殊错误码, 不是旧轮的内容.
      expect(errorCodeOf(retry)).toBe(TURN_INCOMPLETE_CODE);
      expect(textOf(retry)).toBe('');
      // 旧轮**没有**被重放 (引擎仍然只被调过一次).
      expect(engine.turnCalls).toHaveLength(1);
    });

    it('turn_incomplete 不可重试 (重发同一个号还会再撞一次)', async () => {
      const { backend, engine } = buildBackend();
      await backend.openSession({ sessionId: SESSION_ID, tenantId: TENANT_ID, userId: USER_ID });
      engine.plan = { deltas: ['我……'], reply: '我……', fail: true };

      await collect(backend.streamTurn(turnOptions(1)));
      const retry = await collect(backend.streamTurn(turnOptions(1)));

      const error = retry.find((chunk): chunk is Extract<LlmStreamChunk, { type: 'error' }> => chunk.type === 'error');
      expect(error?.error.retryable).toBe(false);
    });
  });

  describe('④ 关闭会话 → 内存 Map 清理', () => {
    it('closeSession 后该 sessionId 的 key 清空', async () => {
      const { backend, idempotency } = buildBackend();
      await backend.openSession({ sessionId: SESSION_ID, tenantId: TENANT_ID, userId: USER_ID });
      await collect(backend.streamTurn(turnOptions(1)));
      expect(idempotency.roundCount(SESSION_ID)).toBe(1);

      backend.closeSession(SESSION_ID);

      expect(idempotency.roundCount(SESSION_ID)).toBe(0);
      expect(idempotency.sessionCount()).toBe(0);
    });

    it('重开同一 sessionId → 上一场的轮次快照被清掉 (新会话 = 新状态)', async () => {
      const { backend, idempotency } = buildBackend();
      await backend.openSession({ sessionId: SESSION_ID, tenantId: TENANT_ID, userId: USER_ID });
      await collect(backend.streamTurn(turnOptions(1)));
      expect(idempotency.roundCount(SESSION_ID)).toBe(1);

      await backend.openSession({ sessionId: SESSION_ID, tenantId: TENANT_ID, userId: USER_ID });

      expect(idempotency.roundCount(SESSION_ID)).toBe(0);
    });
  });

  describe('⑤ 不带 round_id → 行为与 WP16 之前逐字一致', () => {
    it('两次同样的请求 → 各跑各的 (引擎被调两次)', async () => {
      const { backend, engine } = buildBackend();
      await backend.openSession({ sessionId: SESSION_ID, tenantId: TENANT_ID, userId: USER_ID });

      await collect(backend.streamTurn(turnOptions()));
      await collect(backend.streamTurn(turnOptions()));

      expect(engine.turnCalls).toHaveLength(2);
    });

    it('非法轮次号 (0 / 负数 / 小数) → 当作没给, 不走幂等', async () => {
      const { backend, engine } = buildBackend();
      await backend.openSession({ sessionId: SESSION_ID, tenantId: TENANT_ID, userId: USER_ID });

      await collect(backend.streamTurn(turnOptions(0)));
      await collect(backend.streamTurn(turnOptions(-1)));
      await collect(backend.streamTurn(turnOptions(1.5)));

      expect(engine.turnCalls).toHaveLength(3);
    });
  });

  describe('⑥ 并发重发 (上一轮还在跑) → 等它落定后复用', () => {
    it('同一 round_id 并发两次 → 引擎只被调一次', async () => {
      const { backend, engine } = buildBackend();
      await backend.openSession({ sessionId: SESSION_ID, tenantId: TENANT_ID, userId: USER_ID });
      engine.plan = { deltas: ['我……不太想聊这个。'], reply: '我……不太想聊这个。', delayMs: 20 };

      // 两个请求**同时**发起 (客户端超时重发的现场).
      const firstPromise = backend.streamTurn(turnOptions(1));
      const secondPromise = backend.streamTurn(turnOptions(1));

      const first = await collect(firstPromise);
      const second = await collect(secondPromise);

      // 引擎只跑了一遍 —— 并发重发不会变成"再跑一遍 BDI".
      expect(engine.turnCalls).toHaveLength(1);
      expect(textOf(second)).toBe(textOf(first));
      expect(second.at(-1)).toMatchObject({ type: 'done', replayed: true });
    });
  });
});
