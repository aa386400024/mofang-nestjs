// V2026-10-30 治本 (WP10 · B 层 · 剧本注入链路与零回归单测):
//   职责: 钉死「握手 scriptId → openSession opts → resolver → engine.open().trajectory」
//         这条注入链路的四段, 以及"不传 / 查不到"时的**逐字一致**回退.
//   边界: 全 mock + 真实内存内核; 不起容器、不连 DB、不发网络.
//
//   为什么这条链路要逐段钉 (而不是只测最后一段):
//     注入链有 4 个环节, 任何一段漏传都会表现为"剧本没生效", 而症状完全一样 ——
//     逐段钉死才能在失败时立刻知道断在哪一环 (这与 WP9-A 角色注入的测法同款).
//
//   为什么"不传 scriptId"要断言**键集合**而不是只断言 trajectory 为 undefined:
//     `trajectory: undefined` 与"根本没有这个键"在结果上一样, 但前者仍然污染了
//     入参形状 (JSON 序列化后多一个键). 零回归的口径是"与现状逐字一致" ——
//     现状的入参只有 sessionId / tenantId / visitorId, 不多不少.
//
//   验证: npx jest test/engine-adapters/wp10-trajectory-injection.spec.ts
//   时间戳: 2026-10-30 GMT+8

import type { ConfigService } from '@nestjs/config';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import type { VisitorService } from '../../src/agent/visitor/visitor.service';
import { EngineStreamBackend } from '../../src/engine-adapters/wiring/engine-stream-backend.adapter';
import type { EngineTurnService } from '../../src/engine-adapters/wiring/engine-turn.service';
import {
  ETHICAL_TRAJECTORY_SCRIPT_MAP,
  StaticTrajectoryScriptResolver,
  type TrajectoryScriptResolver,
} from '../../src/engine-adapters/wiring/trajectory';
import type { BdiSnapshot, OpenEngineSessionInput, TrajectoryScript } from '../../src/engine-core';
import { InMemoryBdiStateRepository } from '../../src/engine-core/in-memory/in-memory-bdi-state.repository';
import { InMemoryEngineSession } from '../../src/engine-core/in-memory/in-memory-engine-session';
import { InMemoryMemoryStore } from '../../src/engine-core/in-memory/in-memory-memory.store';
import { parseVoiceHandshake } from '../../src/voice/voice-handshake';
import type { VoiceTurnBackend, VoiceTurnBackendOpenOptions } from '../../src/voice/voice-turn-backend.port';
import { VoiceService } from '../../src/voice/voice.service';
import type { VoiceSessionMeta } from '../../src/voice/voice.types';

const TENANT = 'tenant-1';
const VISITOR = 'visitor-1';
const CLOCK = 1_700_000_000_000;
const SCRIPT_ID = 'ethical_romantic_confession';

/** 引擎门面 stub: 记录 open 入参 (只看装配, 不跑决策). */
class FakeEngineTurnService {
  readonly openCalls: OpenEngineSessionInput[] = [];
  readonly closed: string[] = [];

  open(input: OpenEngineSessionInput): { readonly handleId: string; readonly sessionId: string } {
    this.openCalls.push(input);
    return { handleId: `handle-${this.openCalls.length}`, sessionId: input.sessionId };
  }

  close(handleId: string): void {
    this.closed.push(handleId);
  }
}

/** 记录调用参数的剧本解析器 (用于断言"没传 scriptId 时一次都没被碰"). */
class RecordingScriptResolver implements TrajectoryScriptResolver {
  readonly requests: (string | undefined)[] = [];

  resolve(scriptId: string | undefined): TrajectoryScript | undefined {
    this.requests.push(scriptId);
    return scriptId ? ETHICAL_TRAJECTORY_SCRIPT_MAP[scriptId] : undefined;
  }
}

/** 记录开场参数的假后端 (用于断言 voice → backend 的透传). */
class RecordingBackend implements VoiceTurnBackend {
  readonly openCalls: VoiceTurnBackendOpenOptions[] = [];

  async openSession(opts: VoiceTurnBackendOpenOptions): Promise<{
    id: string;
    name: string;
    voiceId: string;
    difficulty: string;
  }> {
    this.openCalls.push(opts);
    return { id: 'voice_visitor', name: '来访者', voiceId: '', difficulty: 'L1' };
  }

  async streamTurn(): Promise<{ readonly stream: never }> {
    throw new Error('本用例不跑对话');
  }

  closeSession(): { readonly finalTurnCount: number; readonly finalMessageCount: number } {
    return { finalTurnCount: 0, finalMessageCount: 0 };
  }

  transcript(): readonly [] {
    return [];
  }
}

/** 真实内核会话 (内存实现) + 确定性 id / 时钟. */
function buildKernelSession(): InMemoryEngineSession {
  const bdiStates = new InMemoryBdiStateRepository();
  let idSeq = 0;
  return new InMemoryEngineSession({
    bdiStates,
    memories: new InMemoryMemoryStore({ now: () => CLOCK }),
    idFactory: () => {
      idSeq += 1;
      return `wp10-id-${idSeq}`;
    },
    now: () => CLOCK,
  });
}

/** 假配置. */
function stubConfig(env: Readonly<Record<string, string>>): ConfigService {
  return { get: (key: string): string | undefined => env[key] } as unknown as ConfigService;
}

/** 语音会话元数据 (带剧本 id). */
function buildMeta(overrides: Partial<VoiceSessionMeta> = {}): VoiceSessionMeta {
  return {
    sessionId: 'session-1',
    userId: 'user-1',
    tenantId: TENANT,
    traceId: 'trace-1',
    mode: 'text',
    preset: {
      difficulty: 'L1',
      style: 'mixed',
      emotionBaseline: 0.3,
      defenseLevel: 0.2,
      visitorMode: 'fullyReal',
    },
    ...overrides,
  };
}

/**
 * 一条固定的咨询师对话序列 (6 轮).
 *
 * 逐轮设计 (照内核真实语义):
 *   1 轮  中性开场           → 幕 0 (自由运行) 进入
 *   2 轮  中性 (闸门未到)    → 停在幕 1 等待 (afterTurns 3 未到)
 *   3 轮  开放式探问         → 幕 1 (伦理事件) 进入 ← 事件在此幕的来访回应里出现
 *   4 轮  开放式探问         → 幕 2 (事件展开) 进入
 *   5 轮  开放式探问         → 幕 3 (收束) 进入
 *   6 轮  共情 + 边界关键词  → 命中 completion → completed
 */
const COUNSELOR_SCRIPT: readonly string[] = [
  '我们开始吧。',
  '我们继续。',
  '你能具体说说吗？',
  '你怎么看这件事？',
  '当时发生了什么？',
  '我理解你的感受，同时我们要设定边界。',
];

describe('WP10 · 剧本注入链路 (握手 → opts → resolver → engine.open)', () => {
  it('① 握手 query 的 scriptId 被解析出来 (原样透传, 不做白名单)', () => {
    const query = parseVoiceHandshake(`/voice/training/s?scriptId=${SCRIPT_ID}`);

    expect(query.scriptId).toBe(SCRIPT_ID);
  });

  it('② 握手不传 scriptId → undefined (旧客户端零影响)', () => {
    expect(parseVoiceHandshake('/voice/training/s').scriptId).toBeUndefined();
    expect(parseVoiceHandshake('/voice/training/s?scriptId=').scriptId).toBeUndefined();
    expect(parseVoiceHandshake('/voice/training/s?scriptId=%20%20').scriptId).toBeUndefined();
  });

  it('③ 握手 scriptId 的控制字符被清洗且超长被截断 (防日志注入)', () => {
    const injected = parseVoiceHandshake('/voice/training/s?scriptId=abc%0A%5Bfake%5D').scriptId;
    const oversized = parseVoiceHandshake(`/voice/training/s?scriptId=${'x'.repeat(200)}`).scriptId;

    expect(injected).toBe('abc[fake]');
    expect(injected).not.toContain('\n');
    expect(oversized).toHaveLength(64);
  });

  it('④ voice 层把 scriptId 原样透传给后端 (voice 不认识剧本内容)', async () => {
    const backend = new RecordingBackend();
    const visitor = { openSession: async () => ({ id: 'voice_visitor', name: '来访者', voiceId: '', difficulty: 'L1' }) };
    const service = new VoiceService(
      visitor as unknown as VisitorService,
      { enqueue: async () => true, processSync: async () => {} } as never,
      { startSession: async () => null } as never,
      { appendTurn: async () => {}, close: async () => null } as never,
      stubConfig({ ENGINE_VOICE_ENABLED: 'true' }),
      backend,
    );

    await service.startSession(buildMeta({ trajectoryScriptId: SCRIPT_ID }));

    expect(backend.openCalls).toHaveLength(1);
    expect(backend.openCalls[0]?.trajectoryScriptId).toBe(SCRIPT_ID);
  });

  it('⑤ 后端解析到剧本 → engine.open 收到 trajectory 字段', async () => {
    const engine = new FakeEngineTurnService();
    const backend = new EngineStreamBackend(
      engine as unknown as EngineTurnService,
      undefined,
      undefined,
      new StaticTrajectoryScriptResolver(),
    );

    await backend.openSession({ sessionId: 'session-1', tenantId: TENANT, personaId: VISITOR, trajectoryScriptId: SCRIPT_ID });

    const input = engine.openCalls[0];
    expect(input?.trajectory).toBeDefined();
    expect(input?.trajectory?.scriptId).toBe(SCRIPT_ID);
    expect(input?.trajectory?.mode).toBe('force_override');
  });

  it('⑥ 查不到的 scriptId → 不传 trajectory, 不抛错 (回退自由运行)', async () => {
    const engine = new FakeEngineTurnService();
    const backend = new EngineStreamBackend(
      engine as unknown as EngineTurnService,
      undefined,
      undefined,
      new StaticTrajectoryScriptResolver(),
    );

    const persona = await backend.openSession({
      sessionId: 'session-1',
      tenantId: TENANT,
      personaId: VISITOR,
      trajectoryScriptId: 'ethical_not_exists',
    });

    expect(engine.openCalls[0]?.trajectory).toBeUndefined();
    expect('trajectory' in (engine.openCalls[0] ?? {})).toBe(false);
    expect(persona.name).toBe('来访者');
  });

  it('⑦ 剧本解析器未装配 (@Optional 缺省) → 不抛, 不传 trajectory', async () => {
    const engine = new FakeEngineTurnService();
    const backend = new EngineStreamBackend(engine as unknown as EngineTurnService);

    await backend.openSession({ sessionId: 'session-1', tenantId: TENANT, personaId: VISITOR, trajectoryScriptId: SCRIPT_ID });

    expect(engine.openCalls[0]?.trajectory).toBeUndefined();
  });

  it('⑧ 解析器抛错 → 回退自由运行, 不把异常冒泡给会话', async () => {
    const engine = new FakeEngineTurnService();
    const brokenResolver: TrajectoryScriptResolver = {
      resolve: () => {
        throw new Error('剧本池炸了');
      },
    };
    const backend = new EngineStreamBackend(engine as unknown as EngineTurnService, undefined, undefined, brokenResolver);

    await backend.openSession({ sessionId: 'session-1', tenantId: TENANT, personaId: VISITOR, trajectoryScriptId: SCRIPT_ID });

    expect(engine.openCalls[0]?.trajectory).toBeUndefined();
  });

  it('⑨ 不传 scriptId → 入参形状与现状逐字一致 (零回归)', async () => {
    const engine = new FakeEngineTurnService();
    const resolver = new RecordingScriptResolver();
    const backend = new EngineStreamBackend(engine as unknown as EngineTurnService, undefined, undefined, resolver);

    await backend.openSession({ sessionId: 'session-1', tenantId: TENANT, personaId: VISITOR });

    const input = engine.openCalls[0] ?? {};
    // 现状的入参只有这三个键 —— 不多不少 (没有 trajectory, 也没有角色字段).
    expect(Object.keys(input).toSorted((a, b) => a.localeCompare(b))).toEqual(['sessionId', 'tenantId', 'visitorId']);
    expect('trajectory' in input).toBe(false);
    // 没传 scriptId 时连解析器都不该被碰 (不是"查一次再回退").
    expect(resolver.requests).toHaveLength(0);
  });
});

describe('WP10 · 剧本注入链路 · 装配层绑定', () => {
  it('engine.module.ts 必须绑定剧本解析端口并装进后端', () => {
    const source = readFileSync(path.join(__dirname, '..', '..', 'src', 'engine-adapters', 'wiring', 'engine.module.ts'), 'utf8');

    expect(source).toContain('provide: TRAJECTORY_SCRIPT_RESOLVER');
    const start = source.indexOf('provide: EngineStreamBackend');
    // 窗口放大 (900 → 1600): V2026-10-30 (WP24) 给 EngineStreamBackend 的 useFactory
    //   加了成本单价装配 (多几行), 剧本解析端口的 token 落在 inject 数组里 —— 窗口
    //   太小会把断言的目标挤出切片. 断言的内容没变, 只是看得更远一点.
    const block = source.slice(start, start + 1600);
    expect(block).toContain('TRAJECTORY_SCRIPT_RESOLVER');
    // 端口是可选增强 —— 装配缺席不该让应用起不来.
    expect(block).toContain('optional: true');
  });
});

describe('WP10 · 剧本注入链路 · 真实内核行为 (轨迹 trace 与可复现)', () => {
  /**
   * 用真实内核跑一遍固定对话序列, 返回每轮的轨迹 trace 与初始快照.
   *
   * 为什么用真实内核而不是断言入参: "注入生效"不等于"内核真的按剧本推进了" ——
   * 游标 / 幕 / 终态全在内核侧, 只有真实内核能验.
   */
  async function runDrill(sessionId: string): Promise<{
    readonly traces: readonly unknown[];
    readonly firstSnapshot: BdiSnapshot;
  }> {
    const session = buildKernelSession();
    const handle = session.openSession({
      sessionId,
      tenantId: TENANT,
      visitorId: VISITOR,
      trajectory: ETHICAL_TRAJECTORY_SCRIPT_MAP[SCRIPT_ID],
    });

    const traces: unknown[] = [];
    let firstSnapshot: BdiSnapshot | undefined;
    for (const userText of COUNSELOR_SCRIPT) {
      const output = await session.turn(handle.handleId, { userText });
      traces.push(output.trajectoryTrace);
      firstSnapshot ??= output.snapshot;
    }
    return { traces, firstSnapshot: firstSnapshot! };
  }

  it('① 每轮出参都带 trajectoryTrace (走到第几幕 / visitedNodeIds / outcome 可见)', async () => {
    const { traces } = await runDrill('session-a');

    expect(traces).toHaveLength(COUNSELOR_SCRIPT.length);
    for (const trace of traces) {
      expect(trace).toBeDefined();
    }
    const last = traces.at(-1) as { visitedNodeIds: readonly string[]; outcome?: string };
    // 四幕全部走过.
    expect(last.visitedNodeIds).toEqual(['confession_free', 'confession_event', 'confession_expand', 'confession_settle']);
    // 咨询师正确应对 (共情 + 边界) → completed.
    expect(last.outcome).toBe('completed');
  });

  it('② 伦理事件幕在闸门满足的那一轮才进入 (不会第一轮就爆)', async () => {
    const { traces } = await runDrill('session-b');

    const second = traces[1] as { activeNodeId?: string; advanced: boolean };
    const third = traces[2] as { activeNodeId?: string; advanced: boolean };
    // 第 2 轮: 停在事件幕等待 (闸门 afterTurns 3 未到) —— 未推进.
    expect(second.activeNodeId).toBe('confession_event');
    expect(second.advanced).toBe(false);
    // 第 3 轮: 闸门满足 → 事件幕进入 → 推进.
    expect(third.activeNodeId).toBe('confession_event');
    expect(third.advanced).toBe(true);
  });

  it('③ 同一剧本同一开场跑两次 → 初始快照与推进轨迹完全一致 (可复现)', async () => {
    const first = await runDrill('session-1');
    const second = await runDrill('session-2');

    expect(second.firstSnapshot).toEqual(first.firstSnapshot);
    expect(second.traces).toEqual(first.traces);
  });

  it('④ 不带剧本的同一段对话 → 无 trajectoryTrace (内核零行为差异)', async () => {
    const session = buildKernelSession();
    const handle = session.openSession({ sessionId: 'session-3', tenantId: TENANT, visitorId: VISITOR });

    const output = await session.turn(handle.handleId, { userText: COUNSELOR_SCRIPT[0] });

    expect(output.trajectoryTrace).toBeUndefined();
  });
});
