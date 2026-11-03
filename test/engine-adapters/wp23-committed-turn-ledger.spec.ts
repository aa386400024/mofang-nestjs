// V2026-11-03 治本 (WP23 · 已提交轮次台账 · 单测):
//   覆盖任务单 §1.4 补漏帧的**数据源** (引擎侧那一半):
//     ① 跑完一轮 → 进台账 (轮次号取 voice 层给的号, 不是内核自己数的那套);
//     ② 被 abort 的轮次**不进**台账 (回复没发完, 补回去只会让客户端拿到半句话);
//     ③ catchUp 只返回 `turnIndex > lastSeenTurnIndex` 的轮次, 并带上服务端最新轮次号;
//     ④ 收尾 → 台账清空 (与逐字稿同生命周期, 不留内存泄漏).
//
//   全 mock: 引擎门面用 stub; 不起 Nest 容器, 不发网络.
//
//   验证: npx vitest run test/engine-adapters/wp23-committed-turn-ledger.spec.ts
//   时间戳: 2026-11-03 GMT+8

import type { LlmStreamChunk } from '../../src/agent/llm/llm.types.js';
import type { TurnRenderResult } from '../../src/engine-adapters/rendering/turn-render-orchestrator.js';
import { EngineStreamBackend } from '../../src/engine-adapters/wiring/engine-stream-backend.adapter.js';
import type { EngineTurnService } from '../../src/engine-adapters/wiring/engine-turn.service.js';

const SESSION_ID = 'session-1';
const HANDLE_ID = 'handle-1';
const USER_ID = 'user-1';
const TENANT_ID = 'tenant-1';

/**
 * 假引擎门面: 记录调用, 可脚本化 abort.
 */
class StubEngine {
  readonly turnCalls: { readonly userText: string; readonly signal?: AbortSignal }[] = [];
  /** 本轮回复. */
  reply = '我……不太想聊这个。';
  /** 本轮是否被 abort (模拟 barge-in). */
  abortBeforeReturn = false;
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
    await handlers.onDelta(this.reply);
    if (this.abortBeforeReturn) this.controller?.abort();
    return buildRenderResult(this.reply);
  }
}

/**
 * 造一份本轮渲染结果.
 */
function buildRenderResult(reply: string): TurnRenderResult {
  return {
    reply,
    snapshot: {
      trust: 0.61,
      emotion: { label: 'anxious', valence: -0.31, arousal: 0.45 },
      resistance: { verbal: 0.22, depth: 0.5, style: 0.3 },
    } as TurnRenderResult['snapshot'],
    turnIndex: 7,
    render: {
      fallbackUsed: false,
      providerHint: 'minimax',
      usage: { completionTokens: 604, totalTokens: 604 },
    },
  };
}

/** 装一个被测的后端 (引擎 stub). */
function buildBackend(): { readonly backend: EngineStreamBackend; readonly engine: StubEngine } {
  const engine = new StubEngine();
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
  );
  return { backend, engine };
}

/** 把一条流收成 chunk 数组. */
async function collect(stream: Promise<{ readonly stream: AsyncIterable<LlmStreamChunk> }>): Promise<LlmStreamChunk[]> {
  const { stream: iterable } = await stream;
  const chunks: LlmStreamChunk[] = [];
  for await (const chunk of iterable) {
    chunks.push(chunk);
  }
  return chunks;
}

/** 本轮入参 (带 voice 层给的轮次号). */
function turnOptions(
  userText: string,
  turnIndex: number,
  signal?: AbortSignal,
): {
  sessionId: string;
  tenantId: string;
  userId: string;
  personaId: string;
  userText: string;
  turnIndex: number;
  signal?: AbortSignal;
} {
  return {
    sessionId: SESSION_ID,
    tenantId: TENANT_ID,
    userId: USER_ID,
    personaId: 'visitor',
    userText,
    turnIndex,
    ...(signal === undefined ? {} : { signal }),
  };
}

describe('WP23 · 已提交轮次台账 (补漏帧的数据源)', () => {
  it('① 跑完一轮 → 进台账 (轮次号取 voice 层给的号)', async () => {
    const { backend } = buildBackend();
    await backend.openSession({ sessionId: SESSION_ID, tenantId: TENANT_ID, userId: USER_ID });

    await collect(backend.streamTurn(turnOptions('最近睡得怎么样？', 3)));

    const result = backend.catchUp(SESSION_ID, 0);
    expect(result?.serverLatestTurnIndex).toBe(3);
    expect(result?.missedTurns).toHaveLength(1);
    // 轮次号是 **voice 层**给的那个 (内核自己数的那套是 7 —— barge-in 后会漂).
    expect(result?.missedTurns[0].turnIndex).toBe(3);
    expect(result?.missedTurns[0]).toMatchObject({
      userText: '最近睡得怎么样？',
      replyText: '我……不太想聊这个。',
      crisisLevel: 'pass',
    });
    // BDI 快照走 WP19-R 留痕的形状 (trace / valence / arousal / resistance / anxiousSecure).
    expect(result?.missedTurns[0].bdiSnapshot).toMatchObject({
      trust: 0.61,
      valence: -0.31,
      arousal: 0.45,
      resistance: 0.22,
      anxiousSecure: 'anxious',
    });
    // 标记恒空 (没有可回读的逐轮标记存储).
    expect(result?.missedTurns[0].marks).toEqual([]);
  });

  it('② 被 abort 的轮次不进台账 (回复没发完)', async () => {
    const { backend, engine } = buildBackend();
    await backend.openSession({ sessionId: SESSION_ID, tenantId: TENANT_ID, userId: USER_ID });
    engine.abortBeforeReturn = true;
    const controller = new AbortController();
    engine.controller = controller;

    await collect(backend.streamTurn(turnOptions('被掐断的那句', 1, controller.signal)));

    expect(controller.signal.aborted).toBe(true);
    // 半截轮不进台账 —— 补回去只会让客户端拿到半句话.
    expect(backend.catchUp(SESSION_ID, 0)?.missedTurns).toHaveLength(0);
  });

  it('③ catchUp 只返回 lastSeenTurnIndex 之后的轮次', async () => {
    const { backend } = buildBackend();
    await backend.openSession({ sessionId: SESSION_ID, tenantId: TENANT_ID, userId: USER_ID });

    await collect(backend.streamTurn(turnOptions('第一句', 1)));
    await collect(backend.streamTurn(turnOptions('第二句', 2)));
    await collect(backend.streamTurn(turnOptions('第三句', 3)));

    const all = backend.catchUp(SESSION_ID, 0);
    expect(all?.missedTurns.map((turn) => turn.turnIndex)).toEqual([1, 2, 3]);
    expect(all?.serverLatestTurnIndex).toBe(3);

    const after = backend.catchUp(SESSION_ID, 2);
    expect(after?.missedTurns.map((turn) => turn.turnIndex)).toEqual([3]);
    // 服务端最新轮次号**不随** lastSeen 变化 (客户端要拿它对齐自己的进度).
    expect(after?.serverLatestTurnIndex).toBe(3);

    const none = backend.catchUp(SESSION_ID, 3);
    expect(none?.missedTurns).toHaveLength(0);
    expect(none?.serverLatestTurnIndex).toBe(3);
  });

  it('④ 收尾 → 台账清空 (不留给下一场)', async () => {
    const { backend } = buildBackend();
    await backend.openSession({ sessionId: SESSION_ID, tenantId: TENANT_ID, userId: USER_ID });
    await collect(backend.streamTurn(turnOptions('第一句', 1)));
    expect(backend.catchUp(SESSION_ID, 0)?.missedTurns).toHaveLength(1);

    backend.closeSession(SESSION_ID);

    // 台账没了 → 本后端不认识这场会话 → 无从补起.
    expect(backend.catchUp(SESSION_ID, 0)).toBeUndefined();
  });

  it('④b 重新开场 → 台账重置 (上一场的轮次不会串进新一场)', async () => {
    const { backend } = buildBackend();
    await backend.openSession({ sessionId: SESSION_ID, tenantId: TENANT_ID, userId: USER_ID });
    await collect(backend.streamTurn(turnOptions('上一场的句', 1)));

    await backend.openSession({ sessionId: SESSION_ID, tenantId: TENANT_ID, userId: USER_ID });

    expect(backend.catchUp(SESSION_ID, 0)?.missedTurns).toHaveLength(0);
  });
});
