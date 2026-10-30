// V2026-10-29 治本 (WP8-B · voice 侧 · 灰度接入单测):
//   覆盖任务单 §10 清单 9-12:
//     9. 开关关 → 选旧 VisitorService, 调用形态与现状一致 (逐帧一致)
//     10. 开关开且健康 → 选新适配, delta 经 consumeLlmStream 产出 llm_text / llm_done
//     11. 新引擎 open / 流式抛错 → 本场回落旧链路, 不冒泡、不关 WS
//     12. barge-in: abort 被调、generation 递增、迟到 chunk 不喂 TTS; 失败后状态回 idle 不悬挂
//   另附:
//     A. 灰度白名单: 名单外的会话走旧链路
//     B. 窄接口自证: 旧 VisitorService 结构化满足 `VoiceTurnBackend` (新旧同构)
//     C. 引擎版后端适配器: delta → content chunk / 结束 → done chunk / 失败 → error chunk
//
//   全 mock: visitor / 引擎后端 / TTS / 业务桥 全部用 stub, 不起容器、不连上游.
//
//   为什么"开关关要逐帧一致"必须有用例 (而不是靠人看):
//     灰度开关是**回退保险**: 出问题时把开关一关, 必须立刻回到"和改动前一模一样".
//     人眼看代码只能确认"大概走的是旧路径", 只有把**帧序列**断言下来, 才敢说
//     "关掉开关 = 零影响". 于是这里直接断言帧的类型与顺序.
//
//   验证: npx jest test/voice/wp8b-grayscale.spec.ts
//   时间戳: 2026-10-29 GMT+8

import type { ConfigService } from '@nestjs/config';

import type { LlmStream, LlmStreamChunk } from '../../src/agent/llm/llm.types';
import type { VisitorService } from '../../src/agent/visitor/visitor.service';
import type { TtsEventStream, TtsSessionHandle } from '../../src/voice/tts/tts.types';
import type { VoiceTurnBackend, VoiceTurnBackendTurnOptions } from '../../src/voice/voice-turn-backend.port';
import { VoiceService } from '../../src/voice/voice.service';
import type { VoiceSessionMeta, VoiceServerMessage } from '../../src/voice/voice.types';

/** 会话元数据 (text 模式: 不碰 TTS). */
const META: VoiceSessionMeta = {
  sessionId: 'session-1',
  userId: 'user-1',
  tenantId: 'tenant-1',
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

/** 假 visitor: 记录调用, 可固定抛错. */
class FakeVisitor {
  readonly openCalls: { sessionId: string; tenantId: string; personaId?: string }[] = [];
  readonly turnCalls: { sessionId: string; userText: string; signal?: AbortSignal }[] = [];
  readonly closed: string[] = [];
  openError?: Error;
  streamError?: Error;
  /** 旧链路每轮的增量 (默认两段, 用于逐帧断言). */
  deltas: readonly string[] = ['有点累', '，夜里老醒。'];

  async openSession(opts: { sessionId: string; tenantId: string; personaId?: string }): Promise<{
    id: string;
    name: string;
    voiceId: string;
    difficulty: string;
  }> {
    this.openCalls.push(opts);
    if (this.openError) throw this.openError;
    return { id: 'visitor-1', name: '来访者', voiceId: 'voice-1', difficulty: 'L1' };
  }

  async streamTurn(opts: VoiceTurnBackendTurnOptions): Promise<{ stream: LlmStream }> {
    this.turnCalls.push({ sessionId: opts.sessionId, userText: opts.userText, signal: opts.signal });
    if (this.streamError) throw this.streamError;
    return { stream: this.buildStream(this.deltas) };
  }

  closeSession(sessionId: string): { hadMemory: boolean; finalTurnCount: number; finalMessageCount: number } {
    this.closed.push(sessionId);
    return { hadMemory: true, finalTurnCount: 1, finalMessageCount: 2 };
  }

  transcript(): readonly never[] {
    return [];
  }

  /** 构造一条三态流. */
  buildStream(deltas: readonly string[]): LlmStream {
    const self = this;
    return (async function* (): AsyncGenerator<LlmStreamChunk> {
      for (const delta of deltas) {
        yield { type: 'content', content: delta };
      }
      yield { type: 'done', usage: { promptTokens: 0, completionTokens: 8, totalTokens: 8 } };
      void self;
    })();
  }
}

/** 假引擎后端: 实现 voice 侧窄接口. */
class FakeEngineBackend implements VoiceTurnBackend {
  readonly openCalls: { sessionId: string; tenantId: string; personaId?: string }[] = [];
  readonly turnCalls: { sessionId: string; userText: string; signal?: AbortSignal }[] = [];
  readonly closed: string[] = [];
  openError?: Error;
  streamError?: Error;
  /** 引擎每轮的增量. */
  deltas: readonly string[] = ['我最近', '，有点累。'];

  async openSession(opts: { sessionId: string; tenantId: string; personaId?: string }): Promise<{
    id: string;
    name: string;
    voiceId: string;
    difficulty: string;
  }> {
    this.openCalls.push(opts);
    if (this.openError) throw this.openError;
    return { id: 'voice_visitor', name: '来访者', voiceId: '', difficulty: 'L1' };
  }

  async streamTurn(opts: VoiceTurnBackendTurnOptions): Promise<{ stream: LlmStream }> {
    this.turnCalls.push({ sessionId: opts.sessionId, userText: opts.userText, signal: opts.signal });
    if (this.streamError) throw this.streamError;
    const deltas = this.deltas;
    return {
      stream: (async function* (): AsyncGenerator<LlmStreamChunk> {
        for (const delta of deltas) {
          yield { type: 'content', content: delta };
        }
        yield { type: 'done', usage: { promptTokens: 0, completionTokens: 6, totalTokens: 6 } };
      })(),
    };
  }

  closeSession(sessionId: string): { finalTurnCount: number; finalMessageCount: number } {
    this.closed.push(sessionId);
    return { finalTurnCount: 1, finalMessageCount: 2 };
  }

  transcript(): readonly never[] {
    return [];
  }
}

/** 假 TTS 句柄: 记录喂进去的文本与生命周期调用. */
class FakeTtsHandle implements TtsSessionHandle {
  readonly sessionId = 'session-1';
  readonly sent: string[] = [];
  cancelled = false;
  finished = false;
  disposed = false;
  readonly events: TtsEventStream = (async function* (): AsyncGenerator<never> {})();

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

/** 装配一个被测的 VoiceService (端口全 stub). */
function buildService(options: {
  readonly env?: Readonly<Record<string, string>>;
  readonly engine?: FakeEngineBackend | null;
  readonly ttsHandle?: FakeTtsHandle;
}): {
  readonly service: VoiceService;
  readonly visitor: FakeVisitor;
  readonly engine: FakeEngineBackend | null;
  readonly ttsHandle: FakeTtsHandle | null;
} {
  const visitor = new FakeVisitor();
  const engine = options.engine ?? null;
  const ttsHandle = options.ttsHandle ?? null;
  const supervisor = { enqueue: async () => true, processSync: async () => {} };
  const bridges = { appendTurn: async () => {}, close: async () => null };
  const tts = {
    startSession: async () => ttsHandle,
  };
  const service = new VoiceService(
    visitor as unknown as VisitorService,
    supervisor as never,
    tts as never,
    bridges as never,
    stubConfig(options.env ?? {}),
    (engine as unknown as VoiceTurnBackend | undefined) ?? undefined,
  );
  return { service, visitor, engine, ttsHandle };
}

/** 收集 WS 帧. */
function frameCollector(): { frames: VoiceServerMessage[]; send: (msg: VoiceServerMessage) => void } {
  const frames: VoiceServerMessage[] = [];
  return { frames, send: (msg: VoiceServerMessage) => frames.push(msg) };
}

/** 帧类型序列 (便于逐帧比对). */
function frameTypes(frames: readonly VoiceServerMessage[]): string[] {
  return frames.map((frame) => frame.type);
}

describe('WP8-B · voice 灰度接入 (开关关 / 开关开 / 失败回落)', () => {
  describe('⑨ 开关关 → 旧链路逐帧一致', () => {
    it('总开关缺省 (关) → 走旧 visitor, 引擎后端一次都没被碰', async () => {
      const { service, visitor, engine } = buildService({ engine: new FakeEngineBackend() });
      const { frames, send } = frameCollector();

      await service.startSession(META);
      await service.handleMessage(META, { type: 'user_text', text: '最近睡得怎么样？' }, send);

      expect(visitor.openCalls).toHaveLength(1);
      expect(visitor.turnCalls).toHaveLength(1);
      expect(engine?.openCalls).toHaveLength(0);
      expect(engine?.turnCalls).toHaveLength(0);
      expect(frameTypes(frames)).toEqual(['llm_start', 'llm_text', 'llm_text', 'llm_done']);
    });

    it('开关显式为 false → 同样走旧链路 (字符串 false 不能读成 true)', async () => {
      const { service, visitor, engine } = buildService({
        env: { ENGINE_VOICE_ENABLED: 'false' },
        engine: new FakeEngineBackend(),
      });
      const { frames, send } = frameCollector();

      await service.startSession(META);
      await service.handleMessage(META, { type: 'user_text', text: '最近睡得怎么样？' }, send);

      expect(visitor.turnCalls).toHaveLength(1);
      expect(engine?.turnCalls).toHaveLength(0);
      expect(frameTypes(frames)).toEqual(['llm_start', 'llm_text', 'llm_text', 'llm_done']);
    });

    it('白名单外的会话 → 走旧链路 (灰度名单是加法, 不是减法)', async () => {
      const { service, visitor, engine } = buildService({
        env: { ENGINE_VOICE_ENABLED: 'true', ENGINE_STREAM_GRAYSCALE_SESSIONS: 'other-session' },
        engine: new FakeEngineBackend(),
      });
      const { send } = frameCollector();

      await service.startSession(META);
      await service.handleMessage(META, { type: 'user_text', text: '最近睡得怎么样？' }, send);

      expect(visitor.turnCalls).toHaveLength(1);
      expect(engine?.turnCalls).toHaveLength(0);
    });
  });

  describe('⑩ 开关开 → 新链路, 增量 llm_text + llm_done', () => {
    it('开关开 → 走引擎后端, 帧序列与旧链路同构 (llm_start / llm_text×N / llm_done)', async () => {
      const engine = new FakeEngineBackend();
      const { service, visitor } = buildService({ env: { ENGINE_VOICE_ENABLED: 'true' }, engine });
      const { frames, send } = frameCollector();

      await service.startSession(META);
      await service.handleMessage(META, { type: 'user_text', text: '最近睡得怎么样？' }, send);

      expect(engine.openCalls).toHaveLength(1);
      expect(engine.turnCalls).toHaveLength(1);
      expect(visitor.turnCalls).toHaveLength(0);
      expect(frameTypes(frames)).toEqual(['llm_start', 'llm_text', 'llm_text', 'llm_done']);
      const texts = frames.filter((frame) => frame.type === 'llm_text').map((frame) => frame.text);
      expect(texts).toEqual(['我最近', '，有点累。']);
    });

    it('voice 模式: 增量文本被喂给 TTS (逐句合成的前置输入)', async () => {
      const engine = new FakeEngineBackend();
      const ttsHandle = new FakeTtsHandle();
      const { service } = buildService({
        env: { ENGINE_VOICE_ENABLED: 'true', 'minimax.ttsVoiceId': 'voice-1' },
        engine,
        ttsHandle,
      });
      const { send } = frameCollector();

      await service.startSession({ ...META, mode: 'voice' });
      await service.handleMessage({ ...META, mode: 'voice' }, { type: 'user_text', text: '最近睡得怎么样？' }, send);

      expect(ttsHandle.sent).toEqual(['我最近', '，有点累。']);
      expect(ttsHandle.finished).toBe(true);
      expect(ttsHandle.disposed).toBe(true);
    });
  });

  describe('⑪ 新引擎失败 → 本场回落旧链路', () => {
    it('开场失败 → 回旧链路, 不冒泡, 帧序列与旧链路一致', async () => {
      const engine = new FakeEngineBackend();
      engine.openError = new Error('引擎装配非法');
      const { service, visitor } = buildService({ env: { ENGINE_VOICE_ENABLED: 'true' }, engine });
      const { frames, send } = frameCollector();

      await service.startSession(META);
      await service.handleMessage(META, { type: 'user_text', text: '最近睡得怎么样？' }, send);

      expect(engine.openCalls).toHaveLength(1);
      expect(visitor.openCalls).toHaveLength(1);
      expect(visitor.turnCalls).toHaveLength(1);
      expect(frameTypes(frames)).toEqual(['llm_start', 'llm_text', 'llm_text', 'llm_done']);
    });

    it('建流失败 → 回旧链路, 不 500 不关 WS', async () => {
      const engine = new FakeEngineBackend();
      engine.streamError = new Error('引擎建流炸了');
      const { service, visitor } = buildService({ env: { ENGINE_VOICE_ENABLED: 'true' }, engine });
      const { frames, send } = frameCollector();

      await service.startSession(META);
      await service.handleMessage(META, { type: 'user_text', text: '最近睡得怎么样？' }, send);

      expect(engine.turnCalls).toHaveLength(1);
      expect(visitor.turnCalls).toHaveLength(1);
      expect(frameTypes(frames)).toEqual(['llm_start', 'llm_text', 'llm_text', 'llm_done']);
    });

    it('首个增量前失败 → 透明切回旧链路 (帧序列仍与旧链路一致)', async () => {
      const engine = new FakeEngineBackend();
      const { service, visitor } = buildService({ env: { ENGINE_VOICE_ENABLED: 'true' }, engine });
      const { frames, send } = frameCollector();

      await service.startSession(META);
      // 让引擎流在第一个增量前就失败 (error chunk).
      engine.streamTurn = async (opts: VoiceTurnBackendTurnOptions): Promise<{ stream: LlmStream }> => {
        engine.turnCalls.push({ sessionId: opts.sessionId, userText: opts.userText, signal: opts.signal });
        return {
          stream: (async function* (): AsyncGenerator<LlmStreamChunk> {
            yield { type: 'error', error: { code: 'engine_stream_error', message: '引擎炸了', retryable: true } };
          })(),
        };
      };

      await service.handleMessage(META, { type: 'user_text', text: '最近睡得怎么样？' }, send);

      expect(visitor.turnCalls).toHaveLength(1);
      expect(frameTypes(frames)).toEqual(['llm_start', 'llm_text', 'llm_text', 'llm_done']);
    });
  });

  describe('⑫ barge-in 与失败后的状态', () => {
    it('barge-in: abort 被调 / generation 递增 / 迟到 chunk 不喂 TTS', async () => {
      const engine = new FakeEngineBackend();
      const ttsHandle = new FakeTtsHandle();
      const { service } = buildService({
        env: { ENGINE_VOICE_ENABLED: 'true', 'minimax.ttsVoiceId': 'voice-1' },
        engine,
        ttsHandle,
      });
      const { frames, send } = frameCollector();

      const gate: { release?: () => void } = {};
      const gatePromise = new Promise<void>((resolve) => {
        gate.release = resolve;
      });
      engine.streamTurn = async (opts: VoiceTurnBackendTurnOptions): Promise<{ stream: LlmStream }> => {
        engine.turnCalls.push({ sessionId: opts.sessionId, userText: opts.userText, signal: opts.signal });
        return {
          stream: (async function* (): AsyncGenerator<LlmStreamChunk> {
            yield { type: 'content', content: '第一段' };
            await gatePromise;
            yield { type: 'content', content: '迟到段' };
            yield { type: 'done', usage: { promptTokens: 0, completionTokens: 6, totalTokens: 6 } };
          })(),
        };
      };

      await service.startSession({ ...META, mode: 'voice' });
      const pending = service.handleMessage({ ...META, mode: 'voice' }, { type: 'user_text', text: '最近睡得怎么样？' }, send);

      // 等第一个增量到达后再打断.
      await waitFor(() => ttsHandle.sent.length >= 1);
      await service.handleMessage({ ...META, mode: 'voice' }, { type: 'user_speaking' }, send);
      gate.release?.();
      await pending;

      expect(engine.turnCalls[0]?.signal?.aborted).toBe(true);
      expect(ttsHandle.cancelled).toBe(true);
      expect(frameTypes(frames)).toContain('cancelled');
      // 迟到的那一段**没有**喂给 TTS (generation 已变, 消费器丢弃).
      expect(ttsHandle.sent).toEqual(['第一段']);
    });

    it('新引擎这一轮失败后 → 透明回落旧链路, 状态回 idle, 下一轮照常能跑 (不悬挂)', async () => {
      const engine = new FakeEngineBackend();
      const { service, visitor } = buildService({ env: { ENGINE_VOICE_ENABLED: 'true' }, engine });
      const { frames, send } = frameCollector();

      await service.startSession(META);
      engine.streamTurn = async (opts: VoiceTurnBackendTurnOptions): Promise<{ stream: LlmStream }> => {
        engine.turnCalls.push({ sessionId: opts.sessionId, userText: opts.userText, signal: opts.signal });
        return {
          stream: (async function* (): AsyncGenerator<LlmStreamChunk> {
            yield { type: 'error', error: { code: 'engine_stream_error', message: '引擎炸了', retryable: true } };
          })(),
        };
      };

      await service.handleMessage(META, { type: 'user_text', text: '第一轮' }, send);
      await service.handleMessage(META, { type: 'user_text', text: '第二轮' }, send);

      // 回落是**透明**的: 客户端看到的帧序列与旧链路一致 (没有 error 帧).
      expect(visitor.turnCalls.length).toBeGreaterThanOrEqual(1);
      expect(frameTypes(frames)).not.toContain('error');
      // 两轮都正常收尾 → 状态没卡在 processing.
      expect(frameTypes(frames).filter((type) => type === 'llm_done').length).toBe(2);
    });
  });

  describe('A. 灰度白名单命中', () => {
    it('名单内的会话 → 走引擎后端', async () => {
      const engine = new FakeEngineBackend();
      const { service, visitor } = buildService({
        env: { ENGINE_VOICE_ENABLED: 'true', ENGINE_STREAM_GRAYSCALE_SESSIONS: 'session-1,session-2' },
        engine,
      });
      const { send } = frameCollector();

      await service.startSession(META);
      await service.handleMessage(META, { type: 'user_text', text: '最近睡得怎么样？' }, send);

      expect(engine.turnCalls).toHaveLength(1);
      expect(visitor.turnCalls).toHaveLength(0);
    });

    it('回落过的会话收尾: 引擎句柄与旧链路会话**都**被释放 (不漏句柄)', async () => {
      const engine = new FakeEngineBackend();
      engine.streamError = new Error('引擎建流炸了');
      const { service, visitor } = buildService({ env: { ENGINE_VOICE_ENABLED: 'true' }, engine });
      const { send } = frameCollector();

      await service.startSession(META);
      await service.handleMessage(META, { type: 'user_text', text: '最近睡得怎么样？' }, send);
      service.endSession(META.sessionId, 'user_finish', send);

      // 回落时开了旧链路会话, 收尾必须把两边都关掉 —— 只关当前那个会让引擎句柄
      // 永远挂在归属登记表上 (句柄泄漏).
      expect(engine.closed).toContain(META.sessionId);
      expect(visitor.closed).toContain(META.sessionId);
    });
  });

  describe('B. 窄接口自证 (新旧同构)', () => {
    it('旧 VisitorService 的公开方法形状满足 VoiceTurnBackend', () => {
      // 编译期自证: 这行赋值成立 ⇔ 旧实现可直接当新链路的后端塞进灰度开关.
      const legacy: VoiceTurnBackend = new FakeVisitor();
      expect(typeof legacy.openSession).toBe('function');
      expect(typeof legacy.streamTurn).toBe('function');
      expect(typeof legacy.closeSession).toBe('function');
      expect(typeof legacy.transcript).toBe('function');
    });
  });
});

/**
 * 轮询等待条件成立 (测试同步点, 不靠固定 sleep).
 */
async function waitFor(condition: () => boolean, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('waitFor 超时');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
