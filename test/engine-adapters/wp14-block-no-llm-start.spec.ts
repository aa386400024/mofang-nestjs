// V2026-11-02 治本 (WP14 优化项 · 前置 safety gate —— block 不发 llm_start):
//   覆盖优化项任务单 §5 验收表里**属于 adapter 侧**的那几条:
//     ① block 级 → 推 crisis_modal + 写审计 + 置位重点监测 (动作与内核判定同一套);
//     ② warn 级 → 前置 gate **只判不拦** (帧与审计留给内核侧, 时序不变);
//     ③ 普通话术 → 放行, 不推帧不写审计;
//     ④ PsyGUARD 挂掉 → 委托本地词典兜底, block 仍能拦住 (D12 治本在前置 gate 上同样成立);
//     ⑤ 探测器异常 → 静默放行 (不推帧不写审计, 交给内核侧那一层防御);
//     ⑥ **不重复写审计** —— 前置 gate 拦下时不调内核 turn, 审计表只有一条.
//
//   全 mock: 探测器 / 引擎门面 / 审计插槽 / 处置闸门全用 stub; 不起 NestJS, 不发网络.
//   帧序列 (voice 层那侧) 由 test/voice/wp14-pre-check-gate.spec.ts 覆盖.
//
//   验证: npx vitest run test/engine-adapters/wp14-block-no-llm-start.spec.ts
//   时间戳: 2026-11-02

import { EngineStreamBackend } from '../../src/engine-adapters/wiring/engine-stream-backend.adapter.js';
import type { EngineTurnService } from '../../src/engine-adapters/wiring/engine-turn.service.js';
import { HttpPsyGuardProbe, type PsyGuardFetch } from '../../src/engine-adapters/wiring/risk/http-psyguard.probe.js';
import { LocalCrisisProbe } from '../../src/engine-adapters/wiring/risk/local-crisis.probe.js';
import type { RiskProbePort, RiskProbeResult, SafetySide } from '../../src/engine-core/index.js';
import type { StudentRiskAuditEventInput, StudentRiskAuditRegistry } from '../../src/voice/student-risk-audit-slot.js';
import type { VoiceServerMessage } from '../../src/voice/voice.types.js';

const SESSION_ID = 'session-1';
const HANDLE_ID = 'handle-1';
const DB_SESSION_ID = 'db-session-1';
const USER_ID = 'user-1';

/**
 * 探测器 stub: 按文本返回固定结果; 可选抛错.
 */
class StubProbe implements RiskProbePort {
  readonly calls: { text: string; side: SafetySide }[] = [];
  /** 固定返回的探测结果. */
  result: RiskProbeResult = { level: 'pass', categories: [] };
  /** 抛错开关 (模拟探测器炸了). */
  error?: Error;

  async probe(text: string, side: SafetySide): Promise<RiskProbeResult> {
    this.calls.push({ text, side });
    if (this.error) throw this.error;
    return this.result;
  }
}

/**
 * 引擎门面 stub: 只提供 open / close (前置 gate 不该碰 turn).
 */
class StubEngine {
  readonly opened: { sessionId: string; userId?: string; dbSessionId?: string }[] = [];
  readonly closed: string[] = [];

  open(input: { sessionId: string; userId?: string; dbSessionId?: string }): { handleId: string; sessionId: string } {
    this.opened.push(input);
    return { handleId: HANDLE_ID, sessionId: input.sessionId };
  }

  close(handleId: string): void {
    this.closed.push(handleId);
  }
}

/**
 * 审计插槽 stub: 记录落库行.
 */
class StubAuditSink {
  readonly events: StudentRiskAuditEventInput[] = [];
  readonly choices: { sessionId: string; choice: string }[] = [];

  async record(event: StudentRiskAuditEventInput): Promise<void> {
    this.events.push(event);
  }

  async markUserChoice(sessionId: string, choice: 'phone' | 'continue' | 'dismissed'): Promise<void> {
    this.choices.push({ sessionId, choice });
  }
}

/**
 * 处置闸门 stub: 记录重点监测置位.
 */
class StubRiskGate {
  readonly monitored = new Set<string>();

  isMonitored(handleId: string): boolean {
    return this.monitored.has(handleId);
  }

  markMonitored(handleId: string): void {
    this.monitored.add(handleId);
  }

  clearMonitored(handleId: string): void {
    this.monitored.delete(handleId);
  }

  async forceRemoteProbe(): Promise<undefined> {
    return undefined;
  }
}

/** 装配一个被测的 adapter (只给前置 gate 需要的那几个依赖). */
function buildBackend(options: { readonly probe?: RiskProbePort; readonly audit?: StubAuditSink; readonly gate?: StubRiskGate }): {
  readonly backend: EngineStreamBackend;
  readonly engine: StubEngine;
  readonly audit: StubAuditSink;
  readonly gate: StubRiskGate;
} {
  const engine = new StubEngine();
  const audit = options.audit ?? new StubAuditSink();
  const gate = options.gate ?? new StubRiskGate();
  const registry = {
    get: () => audit,
  } as unknown as StudentRiskAuditRegistry;
  const backend = new EngineStreamBackend(
    engine as unknown as EngineTurnService,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    gate,
    registry,
    options.probe,
  );
  return { backend, engine, audit, gate };
}

describe('WP14 优化项 · adapter 侧前置 safety gate', () => {
  describe('① block 级 → 推 crisis_modal + 写审计 + 置位重点监测', () => {
    it('判 block → 返回 block, 推全屏弹窗帧, 写一条审计, 置位重点监测', async () => {
      const probe = new StubProbe();
      probe.result = { level: 'block', categories: ['active_ideation'] };
      const { backend, audit, gate } = buildBackend({ probe });
      await backend.openSession({ sessionId: SESSION_ID, tenantId: 'tenant-1', userId: USER_ID, dbSessionId: DB_SESSION_ID });
      const frames: VoiceServerMessage[] = [];

      const result = await backend.preCheckSafety({
        sessionId: SESSION_ID,
        userText: '我想死',
        turnIndex: 3,
        publishFrame: (frame) => frames.push(frame),
      });

      expect(result.level).toBe('block');
      expect(result.category).toBe('active_ideation');
      // 帧: 全屏 modal (含热线 / 急救), 不是轻提示.
      expect(frames.map((frame) => frame.type)).toEqual(['crisis_modal']);
      expect(frames[0]).toMatchObject({ type: 'crisis_modal', level: 'high', hotline: '12356', emergency: '120' });
      // 审计: 一条, 轮次 / 动作 / 监测口径都对.
      expect(audit.events).toHaveLength(1);
      expect(audit.events[0]).toMatchObject({
        sessionId: DB_SESSION_ID,
        userId: USER_ID,
        turnIndex: 3,
        level: 'high',
        category: 'active_ideation',
        actionTaken: 'modal',
        monitoredAfter: true,
      });
      expect(audit.events[0]?.snippet).toBe('我想死');
      // 重点监测: 置位 (与内核判 block 同一套逻辑).
      expect(gate.monitored.has(HANDLE_ID)).toBe(true);
    });

    it('探测器按 counselor_input 侧判 (绝不问 visitor_output)', async () => {
      const probe = new StubProbe();
      probe.result = { level: 'block', categories: ['active_ideation'] };
      const { backend } = buildBackend({ probe });
      await backend.openSession({ sessionId: SESSION_ID, tenantId: 'tenant-1', userId: USER_ID, dbSessionId: DB_SESSION_ID });

      await backend.preCheckSafety({ sessionId: SESSION_ID, userText: '我想死', turnIndex: 1 });

      expect(probe.calls).toHaveLength(1);
      expect(probe.calls[0]?.side).toBe('counselor_input');
    });
  });

  describe('② warn 级 → 只判不拦 (留给内核侧)', () => {
    it('判 warn → 返回 warn, 不推帧不写审计 (内核侧按原时序发 crisis_toast)', async () => {
      const probe = new StubProbe();
      probe.result = { level: 'warn', categories: ['passive_ideation'] };
      const { backend, audit, gate } = buildBackend({ probe });
      await backend.openSession({ sessionId: SESSION_ID, tenantId: 'tenant-1', userId: USER_ID, dbSessionId: DB_SESSION_ID });
      const frames: VoiceServerMessage[] = [];

      const result = await backend.preCheckSafety({
        sessionId: SESSION_ID,
        userText: '活着没意思',
        turnIndex: 1,
        publishFrame: (frame) => frames.push(frame),
      });

      expect(result.level).toBe('warn');
      expect(result.category).toBe('passive_ideation');
      expect(frames).toHaveLength(0);
      expect(audit.events).toHaveLength(0);
      expect(gate.monitored.size).toBe(0);
    });
  });

  describe('③ 普通话术 / 非危机类别 → 放行', () => {
    it('pass → 放行, 不推帧不写审计', async () => {
      const probe = new StubProbe();
      const { backend, audit } = buildBackend({ probe });
      await backend.openSession({ sessionId: SESSION_ID, tenantId: 'tenant-1', userId: USER_ID, dbSessionId: DB_SESSION_ID });
      const frames: VoiceServerMessage[] = [];

      const result = await backend.preCheckSafety({
        sessionId: SESSION_ID,
        userText: '最近睡得怎么样？',
        turnIndex: 1,
        publishFrame: (frame) => frames.push(frame),
      });

      expect(result.level).toBe('pass');
      expect(frames).toHaveLength(0);
      expect(audit.events).toHaveLength(0);
    });

    it('非危机类别 (专业越界) → 放行 (类别边界不能因前置 gate 丢掉)', async () => {
      const probe = new StubProbe();
      // promise_cure = 承诺治愈 —— 属督导事后复盘项, 不是危机类别.
      // ⚠️ 'promise_cure' 是**咨询师侧**类别 (不是来访侧 VisitorRiskCategory) ——
      //   本用例恰好喂它, 验前置 gate 不因为"不是危机类别"就把信号丢掉.
      probe.result = { level: 'block', categories: ['promise_cure'] } as unknown as RiskProbeResult;
      const { backend, audit } = buildBackend({ probe });
      await backend.openSession({ sessionId: SESSION_ID, tenantId: 'tenant-1', userId: USER_ID, dbSessionId: DB_SESSION_ID });
      const frames: VoiceServerMessage[] = [];

      const result = await backend.preCheckSafety({
        sessionId: SESSION_ID,
        userText: '我保证能治好你',
        turnIndex: 1,
        publishFrame: (frame) => frames.push(frame),
      });

      expect(result.level).toBe('pass');
      expect(frames).toHaveLength(0);
      expect(audit.events).toHaveLength(0);
    });

    it('没装探测器 → 直接放行 (增强缺席不能让会话起不来)', async () => {
      const { backend, audit } = buildBackend({});
      await backend.openSession({ sessionId: SESSION_ID, tenantId: 'tenant-1', userId: USER_ID, dbSessionId: DB_SESSION_ID });

      const result = await backend.preCheckSafety({ sessionId: SESSION_ID, userText: '我想死', turnIndex: 1 });

      expect(result.level).toBe('pass');
      expect(audit.events).toHaveLength(0);
    });
  });

  describe('④ PsyGUARD 挂掉 → 本地词典兜底仍能拦住', () => {
    it('远端 503 → 委托本地词典 → 仍判 block, 审计来源记 local_dict', async () => {
      const fetchImpl: PsyGuardFetch = async () => ({
        ok: false,
        status: 503,
        json: async () => ({}),
      });
      const probe = new HttpPsyGuardProbe({
        baseUrl: 'http://127.0.0.1:8100',
        fetchImpl,
        fallback: new LocalCrisisProbe(),
      });
      const { backend, audit } = buildBackend({ probe });
      await backend.openSession({ sessionId: SESSION_ID, tenantId: 'tenant-1', userId: USER_ID, dbSessionId: DB_SESSION_ID });
      const frames: VoiceServerMessage[] = [];

      const result = await backend.preCheckSafety({
        sessionId: SESSION_ID,
        userText: '我想死',
        turnIndex: 1,
        publishFrame: (frame) => frames.push(frame),
      });

      expect(result.level).toBe('block');
      expect(frames.map((frame) => frame.type)).toEqual(['crisis_modal']);
      expect(audit.events).toHaveLength(1);
      // 来源必须记成"本地词典给的" —— 虚报成 psyguard 就是虚报远端识别能力.
      expect(audit.events[0]?.source).toBe('local_dict');
    });

    it('远端挂掉 + 文本普通 → 放行 (降级不等于误报)', async () => {
      const fetchImpl: PsyGuardFetch = async () => {
        throw new Error('ECONNREFUSED');
      };
      const probe = new HttpPsyGuardProbe({
        baseUrl: 'http://127.0.0.1:8100',
        fetchImpl,
        fallback: new LocalCrisisProbe(),
      });
      const { backend, audit } = buildBackend({ probe });
      await backend.openSession({ sessionId: SESSION_ID, tenantId: 'tenant-1', userId: USER_ID, dbSessionId: DB_SESSION_ID });

      const result = await backend.preCheckSafety({ sessionId: SESSION_ID, userText: '最近睡得怎么样？', turnIndex: 1 });

      expect(result.level).toBe('pass');
      expect(audit.events).toHaveLength(0);
    });
  });

  describe('⑤ 探测器异常 → 静默放行 (内核侧那一层兜底仍然在)', () => {
    it('探测器抛错 → 放行, 不推帧不写审计, 不把异常抛给 voice 层', async () => {
      const probe = new StubProbe();
      probe.error = new Error('探测器炸了');
      const { backend, audit } = buildBackend({ probe });
      await backend.openSession({ sessionId: SESSION_ID, tenantId: 'tenant-1', userId: USER_ID, dbSessionId: DB_SESSION_ID });
      const frames: VoiceServerMessage[] = [];

      const result = await backend.preCheckSafety({
        sessionId: SESSION_ID,
        userText: '我想死',
        turnIndex: 1,
        publishFrame: (frame) => frames.push(frame),
      });

      expect(result.level).toBe('pass');
      expect(frames).toHaveLength(0);
      expect(audit.events).toHaveLength(0);
    });
  });

  describe('⑥ 不重复写审计', () => {
    it('前置 gate 拦下 → 内核 turn 一次都没跑, 审计表只有一条', async () => {
      const probe = new StubProbe();
      probe.result = { level: 'block', categories: ['active_ideation'] };
      const { backend, engine, audit } = buildBackend({ probe });
      await backend.openSession({ sessionId: SESSION_ID, tenantId: 'tenant-1', userId: USER_ID, dbSessionId: DB_SESSION_ID });

      await backend.preCheckSafety({ sessionId: SESSION_ID, userText: '我想死', turnIndex: 1 });

      // 内核 turn 没被调 (所以内核侧不会再写第二条审计).
      expect((engine as unknown as { turnStream?: unknown }).turnStream).toBeUndefined();
      expect(audit.events).toHaveLength(1);
    });
  });
});
