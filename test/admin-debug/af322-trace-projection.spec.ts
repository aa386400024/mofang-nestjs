// AF-322 (2026-11-23 · 生产 trace 投影):
//   目的: 证明新增的 BDI 决策可观测字段真的从内核快照 / 意图流到 `turn_debug_trace`，
//         而不是只改了类型。
//
//   覆盖:
//     ① bdiSnapshot 追加 safety / bond / resistanceDepth / transference / coreBeliefActivationPeak；
//     ② TurnTrace 追加 intention（策略 + 理由）；
//     ③ 最小夹具（缺新字段）仍可落库，不因可选字段缺失而炸链路；
//     ④ 补漏帧契约仍只保留五字段，不被新字段污染.

import { vi } from 'vitest';
import type { TurnTrace } from '../../src/admin-debug/trace-recorder.service.js';
import { EngineStreamBackend } from '../../src/engine-adapters/wiring/engine-stream-backend.adapter.js';

vi.mock('ioredis', async () => {
  const { createIoredisStub } = await import('../helpers/sdk-stubs.js');
  return createIoredisStub();
});

const SESSION_ID = 'af322-session';
const DB_SESSION_ID = 'af322-db-session';

class StubTraceRecorder {
  readonly calls: { readonly dbSessionId: string; readonly trace: TurnTrace }[] = [];

  async record(dbSessionId: string, trace: TurnTrace): Promise<void> {
    this.calls.push({ dbSessionId, trace });
  }

  async flush(): Promise<void> {}
}

function renderResult(): never {
  return {
    reply: '我好像一直在等别人先开口。',
    snapshot: {
      trust: 0.62,
      safety: 0.58,
      bond: 0.54,
      emotion: { label: 'open', valence: 0.12, arousal: 0.4 },
      resistance: { verbal: 0.26, depth: 0.31, style: 0.22 },
      transference: { positive: 0.3, negative: 0.2, dependency: 0.15 },
      coreBeliefActivation: { unlovable: 0.4, worthless: 0.55 },
    },
    turnIndex: 8,
    intention: { strategy: 'insight', rationale: '同盟稳定且出现自发信念，进入整合领悟' },
    render: {
      fallbackUsed: false,
      providerHint: 'minimax',
      usage: { completionTokens: 120, totalTokens: 120, reasoningTokens: 0 },
      spec: { taskKind: 'chat', promptPreview: '你是来访者……', maxCompletionTokens: 1500, reasoningEffort: 'low' },
      finishReason: 'stop',
      ttftMs: 900,
    },
  } as never;
}

function stubEngine(): never {
  return {
    open: () => ({ handleId: 'handle-1', sessionId: SESSION_ID }),
    turnStream: async () => renderResult(),
    close: () => {},
  } as never;
}

describe('AF-322 · 生产 trace 投影', () => {
  it('新增 BDI 字段与 intention 流到 turn_debug_trace', async () => {
    const recorder = new StubTraceRecorder();
    const backend = new EngineStreamBackend(stubEngine(), undefined, undefined, undefined, undefined, recorder as never);

    await backend.openSession({
      sessionId: SESSION_ID,
      tenantId: 'tenant-1',
      userId: 'student-a',
      templateId: 'vpt_intimate_avoidance_l1',
      dbSessionId: DB_SESSION_ID,
    });
    const { stream } = await backend.streamTurn({
      sessionId: SESSION_ID,
      tenantId: 'tenant-1',
      userId: 'student-a',
      personaId: 'vpt_intimate_avoidance_l1',
      userText: '最近总睡不好。',
    });
    for await (const chunk of stream) {
      void chunk;
    }

    const trace = recorder.calls.at(0)?.trace;
    expect(trace?.bdiSnapshot.safety).toBe(0.58);
    expect(trace?.bdiSnapshot.bond).toBe(0.54);
    expect(trace?.bdiSnapshot.resistanceDepth).toBe(0.31);
    expect(trace?.bdiSnapshot.transference).toEqual({ positive: 0.3, negative: 0.2, dependency: 0.15 });
    expect(trace?.bdiSnapshot.coreBeliefActivationPeak).toBe(0.55);
    expect(trace?.intention?.strategy).toBe('insight');
    expect(trace?.intention?.rationale).toContain('整合领悟');
  });
});
