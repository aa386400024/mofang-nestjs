// V2026-11-02 治本 (WP16 · voice 层轮次幂等接线):
//   覆盖引擎侧 (test/engine-adapters/wp16-round-id-idempotency.spec.ts) 之外的**接线**那几条:
//     ① 轮次号原样透传给后端 (幂等键的另一半确实到了);
//     ② `turn_incomplete` **不回落旧链路** —— 回落会让同一句话在两条链路上各跑一遍;
//     ③ `turn_incomplete` 不落逐字稿 (半句话进报告, 每轮分析就在半句上做判定);
//     ④ 重放 (`replayed`) 不重复落逐字稿 (第一次那一轮已经落过了).
//
//   全 mock: visitor / 引擎后端 / TTS / 业务桥全用 stub; 不起容器、不连上游.
//
//   验证: npx vitest run test/voice/wp16-turn-incomplete.spec.ts
//   时间戳: 2026-11-02

import type { ConfigService } from '@nestjs/config';

import type { LlmStream, LlmStreamChunk } from '../../src/agent/llm/llm.types.js';
import type { VisitorPersonaSnapshot } from '../../src/agent/supervisor/supervisor.types.js';
import type { VisitorService } from '../../src/agent/visitor/visitor.service.js';
import { TURN_INCOMPLETE_CODE, type VoiceTurnBackend, type VoiceTurnBackendTurnOptions } from '../../src/voice/voice-turn-backend.port.js';
import { VoiceService } from '../../src/voice/voice.service.js';
import type { VoiceSessionMeta, VoiceServerMessage } from '../../src/voice/voice.types.js';

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

/** 假 visitor (旧链路): 记录"被碰过几次" —— 回落旧链路时它会被调. */
class FakeVisitor {
  readonly turnCalls: string[] = [];

  async openSession(): Promise<VisitorPersonaSnapshot> {
    return { id: 'visitor-1', name: '来访者', voiceId: 'voice-1', difficulty: 'L1' };
  }

  async streamTurn(opts: VoiceTurnBackendTurnOptions): Promise<{ stream: LlmStream }> {
    this.turnCalls.push(opts.userText);
    return { stream: buildStream(['旧链路回复']) };
  }

  closeSession(): { finalTurnCount: number; finalMessageCount: number } {
    return { finalTurnCount: 0, finalMessageCount: 0 };
  }

  transcript(): readonly never[] {
    return [];
  }
}

/** 构造一条三态流. */
function buildStream(chunks: readonly LlmStreamChunk[]): LlmStream {
  return (async function* (): AsyncGenerator<LlmStreamChunk> {
    for (const chunk of chunks) {
      yield chunk;
    }
  })();
}

/**
 * 假引擎后端: 按脚本吐三态 chunk, 并记录收到的轮次号.
 */
class FakeEngineBackend implements VoiceTurnBackend {
  readonly turnCalls: { readonly userText: string; readonly roundId?: number }[] = [];
  /** 本轮要吐的 chunk 序列. */
  chunks: LlmStreamChunk[] = [
    { type: 'content', content: '我最近' },
    { type: 'content', content: '，有点累。' },
    { type: 'done', usage: { promptTokens: 0, completionTokens: 6, totalTokens: 6 } },
  ];

  async openSession(): Promise<VisitorPersonaSnapshot> {
    return { id: 'voice_visitor', name: '来访者', voiceId: '', difficulty: 'L1' };
  }

  async streamTurn(opts: VoiceTurnBackendTurnOptions): Promise<{ stream: LlmStream }> {
    this.turnCalls.push({ userText: opts.userText, roundId: opts.roundId });
    return { stream: buildStream(this.chunks) };
  }

  closeSession(): { finalTurnCount: number; finalMessageCount: number } {
    return { finalTurnCount: 1, finalMessageCount: 2 };
  }

  transcript(): readonly never[] {
    return [];
  }
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

/** 装配一个被测的 VoiceService (端口全 stub). */
function buildService(engine: FakeEngineBackend): {
  readonly service: VoiceService;
  readonly visitor: FakeVisitor;
  readonly transcripts: TranscriptRow[];
} {
  const visitor = new FakeVisitor();
  const transcripts: TranscriptRow[] = [];
  const bridges = {
    appendTurn: async (row: TranscriptRow): Promise<void> => {
      transcripts.push(row);
    },
    close: async () => null,
  };
  const service = new VoiceService(
    visitor as unknown as VisitorService,
    { enqueue: async () => true, processSync: async () => {} } as never,
    { startSession: async () => null } as never,
    bridges as never,
    stubConfig({ ENGINE_VOICE_ENABLED: 'true' }),
    engine,
  );
  return { service, visitor, transcripts };
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

describe('WP16 · voice 层轮次幂等接线', () => {
  describe('① 轮次号透传', () => {
    it('user_text 带 roundId → 原样交给后端', async () => {
      const engine = new FakeEngineBackend();
      const { service } = buildService(engine);
      const { send } = frameCollector();

      await service.startSession(META);
      await service.handleMessage(META, { type: 'user_text', text: '第一轮', roundId: 7 }, send);

      expect(engine.turnCalls).toHaveLength(1);
      expect(engine.turnCalls[0]?.roundId).toBe(7);
    });

    it('user_text 不带 roundId → 后端拿到的也是 undefined (老客户端零影响)', async () => {
      const engine = new FakeEngineBackend();
      const { service } = buildService(engine);
      const { send } = frameCollector();

      await service.startSession(META);
      await service.handleMessage(META, { type: 'user_text', text: '第一轮' }, send);

      expect(engine.turnCalls[0]?.roundId).toBeUndefined();
    });
  });

  describe('② turn_incomplete → 不回落旧链路', () => {
    it('收到 turn_incomplete → 错误帧原样发给前端, 旧链路一次都没被碰', async () => {
      const engine = new FakeEngineBackend();
      engine.chunks = [{ type: 'error', error: { code: TURN_INCOMPLETE_CODE, message: '本轮回复未发完', retryable: false } }];
      const { service, visitor } = buildService(engine);
      const { frames, send } = frameCollector();

      await service.startSession(META);
      await service.handleMessage(META, { type: 'user_text', text: '第一轮', roundId: 1 }, send);

      // 错误帧带着特殊错误码到了前端.
      expect(frameTypes(frames)).toEqual(['llm_start', 'error']);
      const error = frames.find((frame) => frame.type === 'error');
      expect(error).toMatchObject({ type: 'error', error: { code: TURN_INCOMPLETE_CODE, retryable: false } });
      // 旧链路**没被碰** —— 回落会让同一句话在两条链路上各跑一遍.
      expect(visitor.turnCalls).toHaveLength(0);
    });
  });

  describe('③ turn_incomplete → 不落逐字稿', () => {
    it('断流那一轮不进逐字稿 (半句话进报告, 每轮分析就在半句上做判定)', async () => {
      const engine = new FakeEngineBackend();
      engine.chunks = [{ type: 'error', error: { code: TURN_INCOMPLETE_CODE, message: '本轮回复未发完', retryable: false } }];
      const { service, transcripts } = buildService(engine);
      const { send } = frameCollector();

      await service.startSession(META);
      await service.handleMessage(META, { type: 'user_text', text: '第一轮', roundId: 1 }, send);

      expect(transcripts).toHaveLength(0);
    });
  });

  describe('④ 重放 → 不重复落逐字稿', () => {
    it('replayed 的那一轮不再落第二条逐字稿', async () => {
      const engine = new FakeEngineBackend();
      engine.chunks = [
        { type: 'content', content: '我最近' },
        { type: 'done', usage: { promptTokens: 0, completionTokens: 6, totalTokens: 6 }, replayed: true },
      ];
      const { service, transcripts } = buildService(engine);
      const { send } = frameCollector();

      await service.startSession(META);
      await service.handleMessage(META, { type: 'user_text', text: '第一轮', roundId: 1 }, send);

      expect(transcripts).toHaveLength(0);
    });

    it('正常轮 (没带 replayed) 照常落逐字稿', async () => {
      const engine = new FakeEngineBackend();
      const { service, transcripts } = buildService(engine);
      const { send } = frameCollector();

      await service.startSession(META);
      await service.handleMessage(META, { type: 'user_text', text: '第一轮', roundId: 1 }, send);

      expect(transcripts).toHaveLength(1);
      expect(transcripts[0]).toMatchObject({ turnIndex: 0, counselorText: '第一轮', visitorText: '我最近，有点累。' });
    });
  });
});
