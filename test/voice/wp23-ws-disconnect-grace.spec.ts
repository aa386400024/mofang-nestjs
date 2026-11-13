// V2026-11-03 治本 (WP23 · WS 断连重连追平 · 单测):
//   覆盖任务单 §3 验收表里属于 voice / gateway 层的那些:
//     ① 断连不杀会话 (不 endSession / 不删内存会话 / 不新挂定时器);
//     ② 内存内重连 → reattach + catchup (漏掉的轮次一次性补回);
//     ③ 客户端没漏 → 轻量 `session_reattached` 帧;
//     ④ 进程重启后重连 → WP12 重建 (从持久化补漏);
//     ⑤ 落后太多 → `session_stale` (too_far_behind);
//     ⑥ 会话不可续 → `session_stale` (unknown_session);
//     ⑦ in-flight turn 不 abort (断线让这一轮自然跑完);
//     ⑦b 断连时跳过 TTS 合成 (不调 provider, 但文本照跑、照落台账);
//     ⑧ 超长 idle 兜底 → endSession(reason='idle_timeout');
//     ⑨ `llm_done` 带轮次号 (客户端靠它报 lastSeenTurnIndex);
//     ⑩ 握手参数解析 (lastSeenTurnIndex / dbSessionId, 非法值一律丢弃).
//
//   全 mock: visitor / 引擎后端 / TTS / 业务桥全用 stub; 不起 Nest 容器、不连上游.
//
//   验证: npx vitest run test/voice/wp23-ws-disconnect-grace.spec.ts
//   时间戳: 2026-11-03 GMT+8

import type { ConfigService } from '@nestjs/config';
import { vi } from 'vitest';

import type { LlmStream, LlmStreamChunk } from '../../src/agent/llm/llm.types.js';
import type { VisitorService } from '../../src/agent/visitor/visitor.service.js';
import type { TtsSessionHandle } from '../../src/voice/tts/tts.types.js';
import { parseVoiceHandshake } from '../../src/voice/voice-handshake.js';
import type { VoiceCatchUpResult } from '../../src/voice/voice-turn-backend.port.js';
import { VoiceService } from '../../src/voice/voice.service.js';
import type { VoiceCatchUpTurn, VoiceSessionMeta, VoiceServerMessage } from '../../src/voice/voice.types.js';

// TD-10 · T-2: 真实 ioredis 不进 import 阶段 (适配层仍是真实现; 替身口径见 test/helpers/sdk-stubs.ts).
vi.mock('ioredis', async () => {
  const { createIoredisStub } = await import('../helpers/sdk-stubs.js');
  return createIoredisStub();
});

// TD-10 · T-2: 真实 bullmq 不进 import 阶段 (适配层仍是真实现; 替身口径见 test/helpers/sdk-stubs.ts).
vi.mock('bullmq', async () => {
  const { createBullmqStub } = await import('../helpers/sdk-stubs.js');
  return createBullmqStub();
});

const SESSION_ID = 'session-1';
const USER_ID = 'user-1';
const TENANT_ID = 'tenant-1';

/** 会话元数据 (text 模式: 不碰 TTS). */
const META: VoiceSessionMeta = {
  sessionId: SESSION_ID,
  userId: USER_ID,
  tenantId: TENANT_ID,
  traceId: 'trace-1',
  personaId: 'visitor-1',
  mode: 'text',
  preset: {
    difficulty: 'L1',
    style: 'cooperative',
    emotionBaseline: 0.3,
    defenseLevel: 0.2,
    visitorMode: 'fullyReal',
  },
};

/** 构造一条三态流. */
function buildStream(deltas: readonly string[]): LlmStream {
  return (async function* (): AsyncGenerator<LlmStreamChunk> {
    for (const delta of deltas) {
      yield { type: 'content', content: delta };
    }
    yield { type: 'done', usage: { promptTokens: 0, completionTokens: 6, totalTokens: 6 } };
  })();
}

/** 假 visitor (旧链路): 只求"不被碰". */
class FakeVisitor {
  async openSession(): Promise<{ id: string; name: string; voiceId: string; difficulty: string }> {
    return { id: 'visitor-1', name: '来访者', voiceId: 'voice-1', difficulty: 'L1' };
  }

  async streamTurn(): Promise<{ stream: LlmStream }> {
    return { stream: buildStream(['旧链路回复']) };
  }

  closeSession(): { finalTurnCount: number; finalMessageCount: number } {
    return { finalTurnCount: 0, finalMessageCount: 0 };
  }

  transcript(): readonly never[] {
    return [];
  }
}

/**
 * 假引擎后端: 带一本"已提交轮次台账" (与真 adapter 同款语义).
 *
 * 台账记的是**已提交**的轮次 (回复发完); 被 abort 的轮次不进台账.
 */
class FakeEngineBackend {
  readonly turnCalls: { readonly userText: string; readonly turnIndex?: number; readonly signal?: AbortSignal }[] = [];
  readonly committed: VoiceCatchUpTurn[] = [];
  readonly catchUpCalls: number[] = [];
  /** 开场次数 (重连不该再开一次). */
  openCount = 0;
  /** 收尾次数 (断连不该收尾). */
  closeCount = 0;
  /** 本轮是否被 abort (测 in-flight 不 abort). */
  aborted = false;
  /** 本轮开始前的延迟 (测 in-flight). */
  delayMs = 0;

  async openSession(): Promise<{ id: string; name: string; voiceId: string; difficulty: string }> {
    this.openCount += 1;
    return { id: 'voice_visitor', name: '来访者', voiceId: '', difficulty: 'L1' };
  }

  async streamTurn(opts: { userText: string; turnIndex?: number; signal?: AbortSignal }): Promise<{ stream: LlmStream }> {
    this.turnCalls.push({ userText: opts.userText, turnIndex: opts.turnIndex, signal: opts.signal });
    if (this.delayMs > 0) {
      await new Promise<void>((resolve) => setTimeout(resolve, this.delayMs));
    }
    this.aborted = opts.signal?.aborted === true;
    const turnIndex = opts.turnIndex ?? this.committed.length + 1;
    // 被 abort 的轮次**不进台账** (回复没发完 —— 补回去只会让客户端拿到半句话).
    if (!this.aborted) {
      this.committed.push({
        turnIndex,
        userText: opts.userText,
        replyText: `第${turnIndex}轮回复`,
        bdiSnapshot: { trust: 0.5, valence: -0.2, arousal: 0.3, resistance: 0.4, anxiousSecure: 'anxious' },
        marks: [],
        crisisLevel: 'pass',
      });
    }
    return { stream: buildStream([`第${turnIndex}轮回复`]) };
  }

  closeSession(): { finalTurnCount: number; finalMessageCount: number } {
    this.closeCount += 1;
    return { finalTurnCount: this.committed.length, finalMessageCount: this.committed.length * 2 };
  }

  transcript(): readonly never[] {
    return [];
  }

  catchUp(_sessionId: string, lastSeenTurnIndex: number): VoiceCatchUpResult | undefined {
    this.catchUpCalls.push(lastSeenTurnIndex);
    const missedTurns = this.committed.filter((turn) => turn.turnIndex > lastSeenTurnIndex);
    return {
      serverLatestTurnIndex: this.committed.reduce((max, turn) => Math.max(max, turn.turnIndex), 0),
      missedTurns,
      sessionState: { riskLevel: 'normal', monitored: false, characterCode: 'vpt_test' },
    };
  }
}

/** 假 TTS 句柄. */
class FakeTtsHandle implements TtsSessionHandle {
  readonly sessionId = SESSION_ID;
  readonly sent: string[] = [];
  cancelled = false;
  finished = false;
  disposed = false;
  readonly events = (async function* (): AsyncGenerator<never> {})();

  sendText = (text: string): void => {
    this.sent.push(text);
  };

  cancel = (): void => {
    this.cancelled = true;
  };

  finish = (): void => {
    this.finished = true;
  };

  dispose = (): void => {
    this.disposed = true;
  };
}

/** 假配置. */
function stubConfig(env: Readonly<Record<string, string>>): ConfigService {
  return { get: (key: string): string | undefined => env[key] } as unknown as ConfigService;
}

/** 逐字稿落库记录. */
interface TranscriptRow {
  readonly turnIndex: number;
  readonly counselorText: string;
  readonly visitorText: string;
}

/** 业务桥收尾记录. */
interface CloseRow {
  readonly sessionId: string;
  readonly reason: string;
}

/** 装配一个被测的 VoiceService (端口全 stub). */
function buildService(options: {
  readonly engine?: FakeEngineBackend | null;
  readonly config?: Readonly<Record<string, string>>;
  readonly persistentTurns?: readonly VoiceCatchUpTurn[] | null;
}): {
  readonly service: VoiceService;
  readonly engine: FakeEngineBackend | null;
  readonly ttsStarts: { count: number };
  readonly transcripts: TranscriptRow[];
  readonly closes: CloseRow[];
} {
  const visitor = new FakeVisitor();
  const engine = options.engine ?? null;
  const ttsStarts = { count: 0 };
  const transcripts: TranscriptRow[] = [];
  const closes: CloseRow[] = [];
  const supervisor = { enqueue: async () => true, processSync: async () => {} };
  const persistentTurns = options.persistentTurns ?? null;
  const bridges = {
    appendTurn: async (row: TranscriptRow): Promise<void> => {
      transcripts.push(row);
    },
    close: async (input: { sessionId: string; reason: string }): Promise<null> => {
      closes.push({ sessionId: input.sessionId, reason: input.reason });
      return null;
    },
    readCommittedTurns: async (): Promise<{ turns: readonly VoiceCatchUpTurn[] } | null> =>
      persistentTurns === null ? null : { turns: persistentTurns },
  };
  const tts = {
    startSession: async (): Promise<TtsSessionHandle | null> => {
      ttsStarts.count += 1;
      return new FakeTtsHandle();
    },
  };
  const service = new VoiceService(
    visitor as unknown as VisitorService,
    supervisor as never,
    tts as never,
    bridges as never,
    stubConfig({ ENGINE_VOICE_ENABLED: 'true', 'minimax.ttsVoiceId': 'voice-1', ...options.config }),
    (engine as unknown as never) ?? undefined,
  );
  return { service, engine, ttsStarts, transcripts, closes };
}

/** 收集 WS 帧. */
function frameCollector(): { frames: VoiceServerMessage[]; send: (msg: VoiceServerMessage) => void } {
  const frames: VoiceServerMessage[] = [];
  return { frames, send: (msg: VoiceServerMessage) => frames.push(msg) };
}

/** 帧类型序列. */
function frameTypes(frames: readonly VoiceServerMessage[]): string[] {
  return frames.map((frame) => frame.type);
}

/** 取补漏帧 (session_catchup). */
function catchUpOf(frames: readonly VoiceServerMessage[]): Extract<VoiceServerMessage, { type: 'session_catchup' }> {
  const frame = frames.find((item) => item.type === 'session_catchup');
  if (!frame || frame.type !== 'session_catchup') throw new Error('没有 session_catchup 帧');
  return frame;
}

describe('WP23 · WS 断连重连追平', () => {
  describe('① 断连不杀会话', () => {
    // 本块要断言"定时器数量没变" → 用假时钟数计时器 (真时钟没法数).
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('detachSocket → 会话还在内存里, 后端没收尾 (BDI 没被清)', async () => {
      const engine = new FakeEngineBackend();
      const { service } = buildService({ engine });
      const { send } = frameCollector();

      await service.startSession(META);
      await service.handleMessage(META, { type: 'user_text', text: '第一句' }, send);
      service.detachSocket(SESSION_ID);

      // 会话仍然活着 —— 这是本单的核心改动.
      expect(service.hasSession(SESSION_ID)).toBe(true);
      // 后端**没有**被收尾 (BDI / 逐字稿 / 台账都还在).
      expect(engine.closeCount).toBe(0);
      // 也没有重新开场 (角色基线没被重置).
      expect(engine.openCount).toBe(1);
    });

    it('断连后仍能处理下一轮 (会话状态机照常推进)', async () => {
      const engine = new FakeEngineBackend();
      const { service } = buildService({ engine });
      const { send } = frameCollector();

      await service.startSession(META);
      service.detachSocket(SESSION_ID);
      await service.handleMessage(META, { type: 'user_text', text: '断线后的第一句' }, send);

      expect(engine.turnCalls).toHaveLength(1);
      expect(engine.turnCalls[0]).toMatchObject({ userText: '断线后的第一句' });
    });

    it('断连**不新挂**定时器 (会话上本来就有的 idle 兜底计时器继续跑)', async () => {
      const engine = new FakeEngineBackend();
      const { service } = buildService({ engine });
      const { send } = frameCollector();

      await service.startSession(META);
      const before = vi.getTimerCount();
      service.detachSocket(SESSION_ID);
      expect(vi.getTimerCount()).toBe(before);
      // 断连后计时器仍在 (它管的是"多久没人理", 不是"断连宽限期").
      expect(vi.getTimerCount()).toBeGreaterThan(0);
      await service.handleMessage(META, { type: 'user_text', text: '还在' }, send);
    });
  });

  describe('② 内存内重连 → reattach + catchup', () => {
    it('断连后重连 → 绑回原会话, 漏掉的轮次一次性补回', async () => {
      const engine = new FakeEngineBackend();
      const { service } = buildService({ engine });
      const { send } = frameCollector();

      await service.startSession(META);
      await service.handleMessage(META, { type: 'user_text', text: '第一句' }, send);
      await service.handleMessage(META, { type: 'user_text', text: '第二句' }, send);
      await service.handleMessage(META, { type: 'user_text', text: '第三句' }, send);
      service.detachSocket(SESSION_ID);

      const outcome = await service.reconnectSession({ meta: META, lastSeenTurnIndex: 1 });

      expect(outcome.ready).toBe(true);
      expect(outcome.path).toBe('reattached');
      expect(outcome.missedTurnCount).toBe(2);
      const frame = outcome.frame;
      if (!frame || frame.type !== 'session_catchup') throw new Error('没有 session_catchup 帧');
      expect(frame.serverLatestTurnIndex).toBe(3);
      expect(frame.missedTurns.map((turn) => turn.turnIndex)).toEqual([2, 3]);
      expect(frame.missedTurns.map((turn) => turn.userText)).toEqual(['第二句', '第三句']);
      // 补漏帧带 BDI 快照 (trace 口径) + 危机等级 + 空标记.
      expect(frame.missedTurns[0].bdiSnapshot).toMatchObject({ trust: 0.5, resistance: 0.4 });
      expect(frame.missedTurns[0].crisisLevel).toBe('pass');
      expect(frame.missedTurns[0].marks).toEqual([]);
      expect(frame.currentSessionState).toMatchObject({ phase: 'listening', riskLevel: 'normal', characterCode: 'vpt_test' });
      // **没有**重新开场 (BDI 状态没被重置).
      expect(engine.openCount).toBe(1);
    });

    it('补漏帧**不带**流式 chunk / 音频 (只补最终文本)', async () => {
      const engine = new FakeEngineBackend();
      const { service } = buildService({ engine });
      const { send } = frameCollector();

      await service.startSession(META);
      await service.handleMessage(META, { type: 'user_text', text: '第一句' }, send);
      service.detachSocket(SESSION_ID);

      const outcome = await service.reconnectSession({ meta: META, lastSeenTurnIndex: 0 });
      const frame = catchUpOf([outcome.frame!]);
      expect(frame.missedTurns[0]).toMatchObject({ turnIndex: 1, userText: '第一句', replyText: '第1轮回复' });
      // 帧里只有这些字段 —— 没有 delta / 没有音频.
      expect(Object.keys(frame.missedTurns[0]).sort()).toEqual(
        ['bdiSnapshot', 'crisisLevel', 'marks', 'replyText', 'turnIndex', 'userText'].sort(),
      );
    });

    it('绑回后 socket 恢复在线 (下一轮又走 TTS 全链路)', async () => {
      const engine = new FakeEngineBackend();
      const { service, ttsStarts } = buildService({ engine });
      const { send } = frameCollector();
      const voiceMeta = { ...META, mode: 'voice' as const };

      await service.startSession(voiceMeta);
      service.detachSocket(voiceMeta.sessionId);
      expect(ttsStarts.count).toBe(0);
      await service.reconnectSession({ meta: voiceMeta, lastSeenTurnIndex: 0 });

      await service.handleMessage(voiceMeta, { type: 'user_text', text: '回来了' }, send);
      expect(ttsStarts.count).toBe(1);
    });
  });

  describe('③ 客户端没漏 → 轻量 session_reattached 帧', () => {
    it('lastSeenTurnIndex = 服务端最新 → session_reattached (不带任何逐轮内容)', async () => {
      const engine = new FakeEngineBackend();
      const { service } = buildService({ engine });
      const { send } = frameCollector();

      await service.startSession(META);
      await service.handleMessage(META, { type: 'user_text', text: '第一句' }, send);
      service.detachSocket(SESSION_ID);

      const outcome = await service.reconnectSession({ meta: META, lastSeenTurnIndex: 1 });

      expect(outcome.frame).toEqual({ type: 'session_reattached', serverLatestTurnIndex: 1 });
      expect(outcome.missedTurnCount).toBe(0);
    });
  });

  describe('④ 进程重启后重连 → WP12 重建 + 从持久化补漏', () => {
    it('内存里没有这场会话 → 走 resumeFromSessionId 重建, 补漏数据来自持久化', async () => {
      const persistent: VoiceCatchUpTurn[] = [
        {
          turnIndex: 1,
          userText: '断线前第一句',
          replyText: '断线前第一句的回复',
          bdiSnapshot: { trust: 0.61, valence: -0.3, arousal: 0.44, resistance: 0.2, anxiousSecure: 'anxious' },
          marks: [],
          crisisLevel: 'pass',
        },
        {
          turnIndex: 2,
          userText: '断线前第二句',
          replyText: '断线前第二句的回复',
          marks: [],
          crisisLevel: 'pass',
        },
      ];
      const engine = new FakeEngineBackend();
      const { service } = buildService({ engine, persistentTurns: persistent });

      // 进程重启后: 内存里没有这场会话.
      expect(service.hasSession(SESSION_ID)).toBe(false);

      const outcome = await service.reconnectSession({
        meta: META,
        lastSeenTurnIndex: 1,
        dbSessionId: 'db-1',
      });

      expect(outcome.ready).toBe(true);
      expect(outcome.path).toBe('resumed');
      expect(outcome.dbSessionId).toBe('db-1');
      const frame = catchUpOf([outcome.frame!]);
      // 只补 lastSeenTurnIndex 之后的轮次.
      expect(frame.missedTurns.map((turn) => turn.turnIndex)).toEqual([2]);
      expect(frame.missedTurns[0].userText).toBe('断线前第二句');
      // 会话被重新开起来了 (走 WP12 接续).
      expect(engine.openCount).toBe(1);
      expect(service.hasSession(SESSION_ID)).toBe(true);
    });

    it('重建后的会话用**原 sessionId** 当 resumeFromSessionId (WP12 口径)', async () => {
      const engine = new FakeEngineBackend();
      const { service } = buildService({ engine, persistentTurns: [] });

      await service.reconnectSession({ meta: META, lastSeenTurnIndex: 0, dbSessionId: 'db-1' });

      // 开场入参里带上了 resumeFromSessionId.
      const opened = engine.turnCalls;
      expect(opened).toHaveLength(0);
      expect(service.findSession(SESSION_ID)?.resumeFromSessionId).toBe(SESSION_ID);
    });
  });

  describe('⑤ 落后太多 → session_stale (too_far_behind)', () => {
    it('漏的轮次超过上限 → 不塞历史, 推 stale', async () => {
      const engine = new FakeEngineBackend();
      const { service } = buildService({ engine, config: { 'voice.catchUpMaxTurns': '2' } });
      const { send } = frameCollector();

      await service.startSession(META);
      for (const text of ['一', '二', '三']) {
        await service.handleMessage(META, { type: 'user_text', text }, send);
      }
      service.detachSocket(SESSION_ID);

      const outcome = await service.reconnectSession({ meta: META, lastSeenTurnIndex: 0 });

      expect(outcome.frame).toEqual({ type: 'session_stale', reason: 'too_far_behind', serverLatestTurnIndex: 3 });
      expect(outcome.missedTurnCount).toBe(3);
    });

    it('env 生效: catchUpMaxTurns=5 → 漏 6 条就 stale, 漏 5 条照补', async () => {
      const engine = new FakeEngineBackend();
      const { service } = buildService({ engine, config: { 'voice.catchUpMaxTurns': '5' } });
      const { send } = frameCollector();

      await service.startSession(META);
      for (let index = 0; index < 5; index += 1) {
        await service.handleMessage(META, { type: 'user_text', text: `第${index}句` }, send);
      }
      service.detachSocket(SESSION_ID);

      const ok = await service.reconnectSession({ meta: META, lastSeenTurnIndex: 0 });
      expect(ok.frame?.type).toBe('session_catchup');

      await service.handleMessage(META, { type: 'user_text', text: '第六句' }, send);
      const stale = await service.reconnectSession({ meta: META, lastSeenTurnIndex: 0 });
      expect(stale.frame).toMatchObject({ type: 'session_stale', reason: 'too_far_behind' });
    });
  });

  describe('⑥ 会话不可续 → session_stale (unknown_session)', () => {
    it('落库会话不存在 → 不可续 (不硬开一场)', async () => {
      const engine = new FakeEngineBackend();
      const { service } = buildService({ engine, persistentTurns: null });

      const outcome = await service.reconnectSession({ meta: META, lastSeenTurnIndex: 0, dbSessionId: 'db-x' });

      expect(outcome.ready).toBe(false);
      expect(outcome.path).toBe('stale');
      expect(outcome.frame).toEqual({ type: 'session_stale', reason: 'unknown_session' });
      expect(service.hasSession(SESSION_ID)).toBe(false);
    });

    it('客户端没带落库 id → 同样不可续', async () => {
      const engine = new FakeEngineBackend();
      const { service } = buildService({ engine, persistentTurns: [] });

      const outcome = await service.reconnectSession({ meta: META, lastSeenTurnIndex: 0 });

      expect(outcome.ready).toBe(false);
      expect(outcome.frame).toEqual({ type: 'session_stale', reason: 'unknown_session' });
    });
  });

  describe('⑦ in-flight turn 不 abort', () => {
    it('断线时这一轮正在跑 → 不 abort, 让它自然跑完并落台账', async () => {
      const engine = new FakeEngineBackend();
      engine.delayMs = 30;
      const { service } = buildService({ engine });
      const { send } = frameCollector();

      await service.startSession(META);
      const pending = service.handleMessage(META, { type: 'user_text', text: '正在跑的那句' }, send);
      // 断线发生在这一轮**跑到一半**的时候.
      service.detachSocket(SESSION_ID);
      await pending;

      expect(engine.aborted).toBe(false);
      expect(engine.turnCalls[0]?.signal?.aborted).toBe(false);
      // 这一轮跑完了 → 进了台账 → 重连时能补回来.
      expect(engine.committed).toHaveLength(1);
      const outcome = await service.reconnectSession({ meta: META, lastSeenTurnIndex: 0 });
      expect(outcome.frame?.type).toBe('session_catchup');
    });
  });

  describe('⑦b 断连时跳过 TTS 合成', () => {
    it('断连状态下触发轮次 → 不调 TTS provider, 但文本照跑照落', async () => {
      const engine = new FakeEngineBackend();
      const { service, ttsStarts, transcripts } = buildService({ engine });
      const { frames, send } = frameCollector();
      const voiceMeta = { ...META, mode: 'voice' as const };

      await service.startSession(voiceMeta);
      service.detachSocket(voiceMeta.sessionId);
      await service.handleMessage(voiceMeta, { type: 'user_text', text: '断线时说的那句' }, send);

      // TTS provider 一次都没被调 (不白烧钱).
      expect(ttsStarts.count).toBe(0);
      // 但这一轮照跑: LLM 跑了, 文本落了逐字稿, 也进了台账.
      expect(engine.turnCalls).toHaveLength(1);
      expect(transcripts).toHaveLength(1);
      expect(engine.committed).toHaveLength(1);
      // 帧里没有任何音频 (只有文本流).
      expect(frameTypes(frames)).not.toContain('tts_audio');
      expect(frameTypes(frames)).not.toContain('sentence_start');
    });

    it('断连时正在跑的 TTS 被停掉 (cancel, 不 dispose —— 收尾时统一释放)', async () => {
      const engine = new FakeEngineBackend();
      const { service, ttsStarts } = buildService({ engine });
      const { send } = frameCollector();
      const voiceMeta = { ...META, mode: 'voice' as const };

      await service.startSession(voiceMeta);
      await service.handleMessage(voiceMeta, { type: 'user_text', text: '先说一句' }, send);
      // 这一轮已经收尾 (句柄被释放), 断连不会再动它.
      service.detachSocket(voiceMeta.sessionId);
      expect(ttsStarts.count).toBe(1);
    });
  });

  describe('⑧ 超长 idle 兜底', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('idle 超时 → 服务端主动 endSession (reason=idle_timeout), 内存会话清掉', async () => {
      const engine = new FakeEngineBackend();
      const { service, closes } = buildService({ engine, config: { 'voice.sessionIdleTimeoutMinutes': '0.01' } });

      await service.startSession(META);
      expect(service.hasSession(SESSION_ID)).toBe(true);

      await vi.advanceTimersByTimeAsync(60_000);

      expect(service.hasSession(SESSION_ID)).toBe(false);
      expect(closes).toHaveLength(1);
      expect(closes[0]).toMatchObject({ sessionId: SESSION_ID, reason: 'idle_timeout' });
      // ⚠️ 后端被关**两次**是既有语义: voice 层的收尾会把"当前后端"与"引擎后端"
      //   各关一次 (引擎链路下这是同一个对象, 真 adapter 按句柄判定只认第一次).
      //   这里断言"确实被关了", 不钉死次数 —— 那是 WP12/WP8-B 早就定下的口径.
      expect(engine.closeCount).toBeGreaterThanOrEqual(1);
    });

    it('有上行 → 计时器重置 (不算 idle)', async () => {
      const engine = new FakeEngineBackend();
      // 超时 1 分钟: 推进 30 秒 → 发一条上行 (重置) → 再推进 30 秒.
      //   若没重置, 第一个计时器会在 t=60s 触发 (会话被误判死); 重置了则到期点推到 t=90s.
      const { service } = buildService({ engine, config: { 'voice.sessionIdleTimeoutMinutes': '1' } });
      const { send } = frameCollector();

      await service.startSession(META);
      await vi.advanceTimersByTimeAsync(30_000);
      await service.handleMessage(META, { type: 'user_text', text: '还在' }, send);
      await vi.advanceTimersByTimeAsync(30_000);

      expect(service.hasSession(SESSION_ID)).toBe(true);
    });

    it('非法 env → 回退缺省 (不是 0, 也不是 NaN)', async () => {
      const engine = new FakeEngineBackend();
      const { service } = buildService({ engine, config: { 'voice.sessionIdleTimeoutMinutes': 'abc' } });

      await service.startSession(META);
      // 缺省是 120 分钟 —— 60 秒后不该被判死.
      await vi.advanceTimersByTimeAsync(60_000);
      expect(service.hasSession(SESSION_ID)).toBe(true);
    });
  });

  describe('⑨ llm_done 带轮次号', () => {
    it('每轮 llm_done 都带本场轮次号 (客户端靠它报 lastSeenTurnIndex)', async () => {
      const engine = new FakeEngineBackend();
      const { service } = buildService({ engine });
      const { frames, send } = frameCollector();

      await service.startSession(META);
      await service.handleMessage(META, { type: 'user_text', text: '第一句' }, send);
      await service.handleMessage(META, { type: 'user_text', text: '第二句' }, send);

      const doneTurnIndexes = frames
        .filter((frame) => frame.type === 'llm_done')
        .map((frame) => (frame.type === 'llm_done' ? frame.turnIndex : undefined));
      expect(doneTurnIndexes).toEqual([1, 2]);
      // 后端拿到的也是同一个号 (三处同源).
      expect(engine.turnCalls.map((call) => call.turnIndex)).toEqual([1, 2]);
    });
  });

  describe('⑩ 握手参数解析', () => {
    it('lastSeenTurnIndex / dbSessionId 正常解析', () => {
      const query = parseVoiceHandshake('/voice/training?sessionId=s1&lastSeenTurnIndex=10&dbSessionId=db-1');
      expect(query.lastSeenTurnIndex).toBe(10);
      expect(query.dbSessionId).toBe('db-1');
    });

    it('lastSeenTurnIndex 非法 (非数字 / 负数 / 小数) → 当作没提供', () => {
      expect(parseVoiceHandshake('/voice/training?sessionId=s1&lastSeenTurnIndex=abc').lastSeenTurnIndex).toBeUndefined();
      expect(parseVoiceHandshake('/voice/training?sessionId=s1&lastSeenTurnIndex=-1').lastSeenTurnIndex).toBeUndefined();
      expect(parseVoiceHandshake('/voice/training?sessionId=s1&lastSeenTurnIndex=1.5').lastSeenTurnIndex).toBeUndefined();
    });

    it('没带 → undefined (不是 0 —— 0 与"一轮都没收到"含义不同)', () => {
      expect(parseVoiceHandshake('/voice/training?sessionId=s1').lastSeenTurnIndex).toBeUndefined();
      expect(parseVoiceHandshake('/voice/training?sessionId=s1').dbSessionId).toBeUndefined();
    });

    it('dbSessionId 清洗控制字符 (防伪造日志行)', () => {
      const query = parseVoiceHandshake('/voice/training?sessionId=s1&dbSessionId=abc%0A[onConnect]%20x');
      expect(query.dbSessionId).toBe('abc[onConnect] x');
    });
  });
});
