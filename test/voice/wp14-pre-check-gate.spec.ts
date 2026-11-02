// V2026-11-02 治本 (WP14 优化项 · 前置 safety gate —— voice 层帧序列):
//   覆盖优化项任务单 §5 验收表里**属于 voice 层**的那几条:
//     ① "我想死" → 前端**先收到 crisis_modal**, 全程无 llm_start / llm_done / tts 帧;
//     ② warn ("活着没意思") → llm_start → 流式回复 → llm_done, 时序与优化项之前一致;
//     ③ 普通咨询话术 → 完全正常, 无任何额外帧;
//     ⑤ 前置 gate 抛错 → 静默降级到现有流程 (不把对练搞挂).
//
//   另加两条**边界**的钉死:
//     · **旧链路零变化**: 没有 `preCheckSafety` 的后端 (VisitorService) 行为逐字不变;
//     · **轮次不错位**: 阻断轮仍记逐字稿 ("问" 有 / "答" 空), 否则报告里的危机标注
//       会锚到别的轮次上.
//
//   另有一段**端到端** (voice 层 + 真 adapter + stub 探测器): 前置 gate 拦下时
//   内核 turn 一次都没跑, 审计表只有一条 —— 这就是"不重复写审计"的实锤.
//
//   全 mock: visitor / 引擎后端 / TTS / 业务桥 / 探测器全用 stub; 不起容器、不连上游.
//
//   验证: npx vitest run test/voice/wp14-pre-check-gate.spec.ts
//   时间戳: 2026-11-02

import type { ConfigService } from '@nestjs/config';

import type { LlmStream, LlmStreamChunk } from '../../src/agent/llm/llm.types.js';
import type { VisitorService } from '../../src/agent/visitor/visitor.service.js';
import { EngineStreamBackend } from '../../src/engine-adapters/wiring/engine-stream-backend.adapter.js';
import type { EngineTurnService } from '../../src/engine-adapters/wiring/engine-turn.service.js';
import type { RiskProbePort, RiskProbeResult, SafetySide } from '../../src/engine-core/index.js';
import type { StudentRiskAuditEventInput, StudentRiskAuditRegistry } from '../../src/voice/student-risk-audit-slot.js';
import type { TtsSessionHandle } from '../../src/voice/tts/tts.types.js';
import type {
  VoiceSafetyPreCheckInput,
  VoiceSafetyPreCheckResult,
  VoiceTurnBackend,
  VoiceTurnBackendTurnOptions,
} from '../../src/voice/voice-turn-backend.port.js';
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

/** 假 visitor (旧链路): 只求"不被碰". */
class FakeVisitor {
  readonly turnCalls: string[] = [];

  async openSession(): Promise<{ id: string; name: string; voiceId: string; difficulty: string }> {
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
function buildStream(deltas: readonly string[]): LlmStream {
  return (async function* (): AsyncGenerator<LlmStreamChunk> {
    for (const delta of deltas) {
      yield { type: 'content', content: delta };
    }
    yield { type: 'done', usage: { promptTokens: 0, completionTokens: 6, totalTokens: 6 } };
  })();
}

/**
 * 假引擎后端: 实现窄接口 + 可选的前置 safety gate.
 */
class FakeEngineBackend implements VoiceTurnBackend {
  readonly turnCalls: string[] = [];
  readonly preCheckCalls: VoiceSafetyPreCheckInput[] = [];
  /** 前置判定结果 (null = 不实现前置 gate → 旧链路行为). */
  preCheck: VoiceSafetyPreCheckResult | null = { level: 'pass' };
  /** 前置判定抛错开关 (静默降级验收). */
  preCheckError?: Error;

  async openSession(): Promise<{ id: string; name: string; voiceId: string; difficulty: string }> {
    return { id: 'voice_visitor', name: '来访者', voiceId: '', difficulty: 'L1' };
  }

  async streamTurn(opts: VoiceTurnBackendTurnOptions): Promise<{ stream: LlmStream }> {
    this.turnCalls.push(opts.userText);
    return { stream: buildStream(['我最近', '，有点累。']) };
  }

  closeSession(): { finalTurnCount: number; finalMessageCount: number } {
    return { finalTurnCount: 1, finalMessageCount: 2 };
  }

  transcript(): readonly never[] {
    return [];
  }

  async preCheckSafety(input: VoiceSafetyPreCheckInput): Promise<VoiceSafetyPreCheckResult> {
    this.preCheckCalls.push(input);
    if (this.preCheckError) throw this.preCheckError;
    const result = this.preCheck ?? { level: 'pass' };
    // 与真 adapter 同款约定: 判 block 时由**后端**推危机帧 (voice 层只给出口回调).
    if (result.level === 'block') {
      input.publishFrame?.({
        type: 'crisis_modal',
        level: 'high',
        category: result.category ?? 'active_ideation',
        hotline: '12356',
        emergency: '120',
      });
    }
    return result;
  }
}

/** 假 TTS 句柄. */
class FakeTtsHandle implements TtsSessionHandle {
  readonly sessionId = 'session-1';
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

/** 装配一个被测的 VoiceService (端口全 stub). */
function buildService(options: { readonly engine?: FakeEngineBackend | null }): {
  readonly service: VoiceService;
  readonly visitor: FakeVisitor;
  readonly engine: FakeEngineBackend | null;
  readonly ttsStarts: { count: number };
  readonly transcripts: TranscriptRow[];
} {
  const visitor = new FakeVisitor();
  const engine = options.engine ?? null;
  const ttsStarts = { count: 0 };
  const transcripts: TranscriptRow[] = [];
  const supervisor = { enqueue: async () => true, processSync: async () => {} };
  const bridges = {
    appendTurn: async (row: TranscriptRow): Promise<void> => {
      transcripts.push(row);
    },
    close: async () => null,
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
    stubConfig({ ENGINE_VOICE_ENABLED: 'true', 'minimax.ttsVoiceId': 'voice-1' }),
    (engine as unknown as VoiceTurnBackend | undefined) ?? undefined,
  );
  return { service, visitor, engine, ttsStarts, transcripts };
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

describe('WP14 优化项 · voice 层前置 safety gate (block 不发 llm_start)', () => {
  describe('① block → 先收 crisis_modal, 全程无 llm_start / llm_done / tts 帧', () => {
    it('判 block → 只发 crisis_modal, 内核 turn 一次都没跑', async () => {
      const engine = new FakeEngineBackend();
      engine.preCheck = { level: 'block', category: 'active_ideation' };
      const { service } = buildService({ engine });
      const { frames, send } = frameCollector();

      await service.startSession(META);
      await service.handleMessage(META, { type: 'user_text', text: '我想死' }, send);

      expect(frameTypes(frames)).toEqual(['crisis_modal']);
      expect(frames[0]).toMatchObject({ type: 'crisis_modal', level: 'high', hotline: '12356', emergency: '120' });
      // 内核 turn 没跑 (所以不会有 llm_start / llm_done / llm_text).
      expect(engine.turnCalls).toHaveLength(0);
      expect(frameTypes(frames)).not.toContain('llm_start');
      expect(frameTypes(frames)).not.toContain('llm_done');
      expect(frameTypes(frames)).not.toContain('llm_text');
    });

    it('voice 模式 → TTS 连接根本没起 (连 tts 帧都不会有)', async () => {
      const engine = new FakeEngineBackend();
      engine.preCheck = { level: 'block', category: 'active_ideation' };
      const { service, ttsStarts } = buildService({ engine });
      const { frames, send } = frameCollector();
      const meta = { ...META, mode: 'voice' as const };

      await service.startSession(meta);
      await service.handleMessage(meta, { type: 'user_text', text: '我想死' }, send);

      expect(ttsStarts.count).toBe(0);
      expect(frameTypes(frames)).toEqual(['crisis_modal']);
    });

    it('阻断轮仍记逐字稿 ("问" 有 / "答" 空), 轮次编号与审计 turnIndex 对齐', async () => {
      const engine = new FakeEngineBackend();
      engine.preCheck = { level: 'block', category: 'active_ideation' };
      const { service, transcripts } = buildService({ engine });
      const { send } = frameCollector();

      await service.startSession(META);
      await service.handleMessage(META, { type: 'user_text', text: '我想死' }, send);

      expect(transcripts).toHaveLength(1);
      expect(transcripts[0]).toMatchObject({ turnIndex: 0, counselorText: '我想死', visitorText: '' });
    });

    it('前置 gate 拿到的轮次号 = 本场第几轮 (与逐字稿下标同源)', async () => {
      const engine = new FakeEngineBackend();
      engine.preCheck = { level: 'pass' };
      const { service } = buildService({ engine });
      const { send } = frameCollector();

      await service.startSession(META);
      await service.handleMessage(META, { type: 'user_text', text: '第一轮' }, send);
      await service.handleMessage(META, { type: 'user_text', text: '第二轮' }, send);

      expect(engine.preCheckCalls.map((call) => call.turnIndex)).toEqual([1, 2]);
    });
  });

  describe('② warn → 时序与优化项之前完全一致', () => {
    it('判 warn → 正常 llm_start → 流式回复 → llm_done, 前置 gate 不发任何帧', async () => {
      const engine = new FakeEngineBackend();
      engine.preCheck = { level: 'warn', category: 'passive_ideation' };
      const { service } = buildService({ engine });
      const { frames, send } = frameCollector();

      await service.startSession(META);
      await service.handleMessage(META, { type: 'user_text', text: '活着没意思' }, send);

      expect(frameTypes(frames)).toEqual(['llm_start', 'llm_text', 'llm_text', 'llm_done']);
      expect(engine.turnCalls).toHaveLength(1);
    });
  });

  describe('③ 普通咨询话术 → 完全正常, 无任何额外帧', () => {
    it('判 pass → 帧序列与优化项之前逐帧一致', async () => {
      const engine = new FakeEngineBackend();
      engine.preCheck = { level: 'pass' };
      const { service } = buildService({ engine });
      const { frames, send } = frameCollector();

      await service.startSession(META);
      await service.handleMessage(META, { type: 'user_text', text: '最近睡得怎么样？' }, send);

      expect(frameTypes(frames)).toEqual(['llm_start', 'llm_text', 'llm_text', 'llm_done']);
    });
  });

  describe('⑤ 前置 gate 异常 → 静默降级到现有流程', () => {
    it('前置判定抛错 → 照常 llm_start → 流式回复 → llm_done, 不冒泡', async () => {
      const engine = new FakeEngineBackend();
      engine.preCheckError = new Error('探测器炸了');
      const { service } = buildService({ engine });
      const { frames, send } = frameCollector();

      await service.startSession(META);
      await service.handleMessage(META, { type: 'user_text', text: '我想死' }, send);

      expect(frameTypes(frames)).toEqual(['llm_start', 'llm_text', 'llm_text', 'llm_done']);
      expect(engine.turnCalls).toHaveLength(1);
    });
  });

  describe('边界 · 旧链路零变化', () => {
    it('后端没有 preCheckSafety → 行为逐字不变 (帧序列与优化项之前一致)', async () => {
      const engine = new FakeEngineBackend();
      // 抹掉前置 gate 方法 = 旧链路那种"没有这个能力"的后端.
      (engine as unknown as { preCheckSafety?: unknown }).preCheckSafety = undefined;
      const { service } = buildService({ engine });
      const { frames, send } = frameCollector();

      await service.startSession(META);
      await service.handleMessage(META, { type: 'user_text', text: '我想死' }, send);

      expect(frameTypes(frames)).toEqual(['llm_start', 'llm_text', 'llm_text', 'llm_done']);
      expect(engine.turnCalls).toHaveLength(1);
    });
  });

  describe('端到端 · voice 层 + 真 adapter + stub 探测器', () => {
    it('探测器判 block → 只收 crisis_modal, 内核 turn 没跑, 审计表只有一条', async () => {
      const probe: RiskProbePort = {
        probe: async (_text: string, _side: SafetySide): Promise<RiskProbeResult> => ({
          level: 'block',
          categories: ['active_ideation'],
        }),
      };
      const turnStreamCalls: unknown[] = [];
      const engineStub = {
        open: (input: { sessionId: string }): { handleId: string; sessionId: string } => ({
          handleId: 'handle-1',
          sessionId: input.sessionId,
        }),
        turnStream: (...args: unknown[]): Promise<never> => {
          turnStreamCalls.push(args);
          return Promise.reject(new Error('不该被调到'));
        },
        close: (): void => {},
      };
      const auditEvents: StudentRiskAuditEventInput[] = [];
      const auditRegistry = {
        get: () => ({
          record: async (event: StudentRiskAuditEventInput): Promise<void> => {
            auditEvents.push(event);
          },
          markUserChoice: async (): Promise<void> => {},
        }),
      } as unknown as StudentRiskAuditRegistry;

      const backend = new EngineStreamBackend(
        engineStub as unknown as EngineTurnService,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        auditRegistry,
        probe,
      );
      const visitor = new FakeVisitor();
      const transcripts: TranscriptRow[] = [];
      const service = new VoiceService(
        visitor as unknown as VisitorService,
        { enqueue: async () => true, processSync: async () => {} } as never,
        { startSession: async (): Promise<null> => null } as never,
        {
          appendTurn: async (row: TranscriptRow): Promise<void> => {
            transcripts.push(row);
          },
          close: async () => null,
        } as never,
        stubConfig({ ENGINE_VOICE_ENABLED: 'true' }),
        backend,
      );
      const { frames, send } = frameCollector();

      await service.startSession({ ...META, dbSessionId: 'db-session-1' });
      await service.handleMessage({ ...META, dbSessionId: 'db-session-1' }, { type: 'user_text', text: '我想死' }, send);

      expect(frameTypes(frames)).toEqual(['crisis_modal']);
      expect(turnStreamCalls).toHaveLength(0);
      expect(auditEvents).toHaveLength(1);
      expect(auditEvents[0]).toMatchObject({ turnIndex: 1, level: 'high', actionTaken: 'modal', monitoredAfter: true });
      expect(transcripts).toHaveLength(1);
    });
  });
});
