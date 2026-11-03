// V2026-11-03 治本 (WP25 · 封版审查 · WS 会话归属校验):
//   职责: 钉死「sessionId 归属」这条安全边界 —— 一个登录用户**不许**用别人的
//         sessionId 连上来顶掉那场会话, 也不许借重连把人家的逐字稿拉走.
//
//   背景 (为什么这是 P1):
//     `sessionId` 由客户端在握手 query 里自选 (`?sessionId=<uuid>`), 服务端此前
//     **从不核对**它属于谁. 于是任何登录用户带着别人的 sessionId 连上来就能:
//       ① 顶掉那场会话 (TTS dispose + LLM abort) —— 对方的对练当场崩;
//       ② 走重连分支拿到 `session_catchup` 帧 —— 里面是**对方整场咨询对话原文**.
//     这是跨用户数据泄漏 + 跨用户干扰, 内测前必修.
//
//   覆盖两层 (边界分层, 各自独立可测):
//     · Part A — VoiceService: 归属判定的**内核** (顶替前拒 / 补漏前拒);
//     · Part B — VoiceGateway: 归属判定的**接线** (拒在**任何写动作之前**).
//
//   边界: 全 mock; 不起 Nest 容器; 不连 Redis / 不连上游 / 不起引擎.
//
//   验证: npx vitest run test/voice/wp25-ws-session-ownership.spec.ts
//   时间戳: 2026-11-03 GMT+8

import type { ConfigService } from '@nestjs/config';
import type { JwtService } from '@nestjs/jwt';
import type { Socket } from 'socket.io';

import type { VisitorService } from '../../src/agent/visitor/visitor.service.js';
import { VoiceFrameRegistry } from '../../src/voice/voice-frame-registry.js';
import { VoiceSessionLimitError } from '../../src/voice/voice-session-limit.error.js';
import { VoiceSessionRegistry } from '../../src/voice/voice-session-registry.js';
import { VoiceGateway } from '../../src/voice/voice.gateway.js';
import { VoiceService } from '../../src/voice/voice.service.js';
import type { VoiceSessionMeta, VoiceServerMessage } from '../../src/voice/voice.types.js';

const SESSION_ID = 'session-1';
const OWNER_ID = 'user-owner';
const ATTACKER_ID = 'user-attacker';

/** 造一个只认几个键的 config stub. */
function stubConfig(values: Readonly<Record<string, unknown>>): ConfigService {
  return { get: (key: string): unknown => values[key] } as unknown as ConfigService;
}

/** 会话元数据 (text 模式: 不碰 TTS). */
function metaOf(sessionId: string, userId: string): VoiceSessionMeta {
  return {
    sessionId,
    userId,
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
}

/**
 * 假 visitor (旧链路): 只实现 voice 层开场 / 收尾要的那几个方法.
 *
 * `catchUp` 用来验"重连补漏"这条路径 —— 它返回的内容就是**逐字稿原文**,
 * 所以归属校验漏了它 = 把别人的咨询记录发出去.
 */
class FakeVisitor {
  readonly openCalls: { readonly sessionId: string }[] = [];
  readonly closed: string[] = [];
  /** 补漏台账 (归属正确时会被读走). */
  readonly catchUpCalls: { readonly sessionId: string; readonly lastSeenTurnIndex: number }[] = [];

  async openSession(opts: { readonly sessionId: string }): Promise<{
    id: string;
    name: string;
    voiceId: string;
    difficulty: string;
  }> {
    this.openCalls.push(opts);
    return { id: 'visitor-1', name: '来访者', voiceId: 'voice-1', difficulty: 'L1' };
  }

  closeSession(sessionId: string): { finalTurnCount: number; finalMessageCount: number } {
    this.closed.push(sessionId);
    return { finalTurnCount: 0, finalMessageCount: 0 };
  }

  transcript(): readonly never[] {
    return [];
  }

  catchUp(
    sessionId: string,
    lastSeenTurnIndex: number,
  ): {
    missedTurns: {
      turnIndex: number;
      userText: string;
      replyText: string;
      marks: unknown[];
      crisisLevel: string;
    }[];
    serverLatestTurnIndex: number;
  } {
    this.catchUpCalls.push({ sessionId, lastSeenTurnIndex });
    return {
      missedTurns: [{ turnIndex: 2, userText: '人家的咨询原文', replyText: '人家的回复原文', marks: [], crisisLevel: 'pass' }],
      serverLatestTurnIndex: 3,
    };
  }
}

/** 装配一个被测的 VoiceService (端口全 stub). */
function buildService(): { readonly service: VoiceService; readonly visitor: FakeVisitor } {
  const visitor = new FakeVisitor();
  const supervisor = { enqueue: async (): Promise<boolean> => true, processSync: async (): Promise<void> => {} };
  const bridges = { appendTurn: async (): Promise<void> => {}, close: async (): Promise<null> => null };
  const tts = { startSession: async (): Promise<null> => null };
  const service = new VoiceService(
    visitor as unknown as VisitorService,
    supervisor as never,
    tts as never,
    bridges as never,
    stubConfig({}),
  );
  return { service, visitor };
}

// ────────────────────────────────────────────────────────────────────
// Part A · VoiceService —— 归属判定的内核
// ────────────────────────────────────────────────────────────────────

describe('WP25 · A: VoiceService 会话归属校验', () => {
  it('A1 顶替别人的会话 → 抛 session_owned_by_other_user, 且**不**动那场会话', async () => {
    const { service } = buildService();
    await service.startSession(metaOf(SESSION_ID, OWNER_ID));

    // 攻击者用同一个 sessionId 开一场.
    let thrown: unknown;
    try {
      await service.startSession(metaOf(SESSION_ID, ATTACKER_ID));
    } catch (err) {
      thrown = err;
    }

    expect(thrown).toBeInstanceOf(VoiceSessionLimitError);
    expect((thrown as VoiceSessionLimitError).code).toBe('session_owned_by_other_user');
    // 关键: 原来那场**还在**, 还是**原主人**的 —— 没被顶掉 (顶掉 = TTS 被 dispose + 对练当场崩).
    expect(service.hasSession(SESSION_ID)).toBe(true);
    expect(service.isSessionOwnedByOtherUser(OWNER_ID, SESSION_ID)).toBe(false);
    expect(service.isSessionOwnedByOtherUser(ATTACKER_ID, SESSION_ID)).toBe(true);
  });

  it('A2 同一用户重开同名会话 → 正常替换 (老语义保留, 不误伤自己)', async () => {
    const { service, visitor } = buildService();
    await service.startSession(metaOf(SESSION_ID, OWNER_ID));
    await service.startSession(metaOf(SESSION_ID, OWNER_ID));

    // 替换 = 重新开场一次, 会话仍在.
    expect(visitor.openCalls).toHaveLength(2);
    expect(service.hasSession(SESSION_ID)).toBe(true);
  });

  it('A3 拿别人的 sessionId 重连 → 不给补漏, 回 session_stale/unknown_session', async () => {
    const { service, visitor } = buildService();
    await service.startSession(metaOf(SESSION_ID, OWNER_ID));

    const outcome = await service.reconnectSession({
      meta: metaOf(SESSION_ID, ATTACKER_ID),
      lastSeenTurnIndex: 1,
    });

    // 不可续 (ready=false) —— 且**不能**是"另一场会话"或"补漏帧".
    expect(outcome.ready).toBe(false);
    expect(outcome.frame).toEqual({ type: 'session_stale', reason: 'unknown_session' });
    // 关键: 补漏台账**一次都没读** —— 读了就是把人家的逐字稿原样发出去.
    expect(visitor.catchUpCalls).toHaveLength(0);
  });

  it('A4 自己的 sessionId 重连 → 正常绑回并补漏 (老语义保留)', async () => {
    const { service, visitor } = buildService();
    await service.startSession(metaOf(SESSION_ID, OWNER_ID));

    const outcome = await service.reconnectSession({
      meta: metaOf(SESSION_ID, OWNER_ID),
      lastSeenTurnIndex: 1,
    });

    expect(outcome.ready).toBe(true);
    expect(visitor.catchUpCalls).toHaveLength(1);
    expect(outcome.frame?.type).toBe('session_catchup');
  });

  it('A5 归属判定真值表: 内存里没这场会话 = 谁开都合法', () => {
    const { service } = buildService();
    expect(service.isSessionOwnedByOtherUser(ATTACKER_ID, 'never-seen')).toBe(false);
    expect(service.isSessionOwnedByOtherUser('', 'never-seen')).toBe(false);
  });
});

// ────────────────────────────────────────────────────────────────────
// Part B · VoiceGateway —— 归属判定的接线
// ────────────────────────────────────────────────────────────────────

/** 假 socket: 只需要 gateway 用到的那几个面. */
interface FakeSocket {
  id: string;
  handshake: { url: string; query: Record<string, string>; headers: Record<string, string> };
  data: Record<string, unknown>;
  frames: VoiceServerMessage[];
  /** 被断开过吗. */
  disconnected: boolean;
  emit(event: string, payload: unknown): void;
  disconnect(force?: boolean): void;
}

/** 造一个假 socket. */
function buildSocket(id: string, url: string): FakeSocket {
  const socket: FakeSocket = {
    id,
    handshake: { url, query: readQuery(url), headers: {} },
    data: {},
    frames: [],
    disconnected: false,
    emit(_event: string, payload: unknown): void {
      if (typeof payload === 'object' && payload !== null && 'type' in payload) {
        socket.frames.push(payload as VoiceServerMessage);
      }
    },
    disconnect(): void {
      socket.disconnected = true;
    },
  };
  return socket;
}

/** 从 url 里读出 query (键 → 值). */
function readQuery(url: string): Record<string, string> {
  const parsed = new URL(url, 'http://localhost');
  const query: Record<string, string> = {};
  for (const [key, value] of parsed.searchParams) {
    query[key] = value;
  }
  return query;
}

/** 帧类型序列. */
function frameTypes(frames: readonly VoiceServerMessage[]): string[] {
  return frames.map((frame) => frame.type);
}

/** 假 voice 服务: 只记录 gateway 会调的几个方法. */
class FakeVoiceService {
  readonly endSessionCalls: { readonly sessionId: string; readonly reason: string }[] = [];
  readonly detachCalls: string[] = [];
  readonly startSessionCalls: unknown[] = [];
  /** 这个 sessionId 是不是已经属于别人 (WP25: 归属判定的桩). */
  ownedByOtherUser = false;

  isSessionOwnedByOtherUser(): boolean {
    return this.ownedByOtherUser;
  }

  async startSession(meta: unknown): Promise<void> {
    this.startSessionCalls.push(meta);
  }

  async reconnectSession(): Promise<never> {
    throw new Error('本用例不应走到重连分支');
  }

  endSession(sessionId: string, reason: string): void {
    this.endSessionCalls.push({ sessionId, reason });
  }

  detachSocket(sessionId: string): void {
    this.detachCalls.push(sessionId);
  }
}

/** 装配一个被测的 gateway (端口全 stub). */
function buildGateway(options: { readonly jwtValid?: boolean; readonly jwtUserId?: string } = {}): {
  readonly gateway: VoiceGateway;
  readonly voice: FakeVoiceService;
  readonly frames: VoiceFrameRegistry;
  readonly sessions: VoiceSessionRegistry;
  readonly bridgeOpens: unknown[];
} {
  const voice = new FakeVoiceService();
  const frames = new VoiceFrameRegistry();
  const sessions = new VoiceSessionRegistry();
  const bridgeOpens: unknown[] = [];
  const bridges = {
    open: async (input: unknown): Promise<{ persisted: boolean; dbSessionId: string | null }> => {
      bridgeOpens.push(input);
      return { persisted: true, dbSessionId: 'db-1' };
    },
    close: async (): Promise<null> => null,
    appendTurn: async (): Promise<void> => {},
  };
  const jwtValid = options.jwtValid ?? true;
  const jwtUserId = options.jwtUserId ?? OWNER_ID;
  const jwt = {
    verifyAsync: async (): Promise<{ sub: string; tenantId?: string }> => {
      if (!jwtValid) throw new Error('bad token');
      return { sub: jwtUserId };
    },
  };
  const config = {
    getOrThrow: (): string => 'secret',
    get: (key: string): string | undefined => (key === 'jwtSecret' ? 'secret' : undefined),
  };
  const gateway = new VoiceGateway(
    voice as never,
    jwt as unknown as JwtService,
    config as unknown as ConfigService,
    { resolve: async () => null } as never,
    sessions,
    { check: async () => 'available' } as never,
    bridges as never,
    frames,
  );
  return { gateway, voice, frames, sessions, bridgeOpens };
}

/** 等 verifyAndStart 的异步流程跑完 (它是 fire-and-forget). */
async function flush(): Promise<void> {
  for (let index = 0; index < 5; index += 1) {
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
}

describe('WP25 · B: VoiceGateway 会话归属校验', () => {
  it('B1 别人的 sessionId 连上来 → error(session_owned_by_other_user) + 断开, 且**没落库 / 没开场 / 没接管出口**', async () => {
    const { gateway, voice, frames, bridgeOpens } = buildGateway();
    voice.ownedByOtherUser = true;
    const socket = buildSocket('socket-1', `/voice/training?sessionId=${SESSION_ID}&token=tk`);

    gateway.handleConnection(socket as unknown as Socket);
    await flush();

    // 拒绝帧: 前端按 code 分支 (换 sessionId 重来), 不该重试.
    expect(socket.frames).toEqual([
      {
        type: 'error',
        error: { code: 'session_owned_by_other_user', message: '该会话标识已被他人占用，请换一个', retryable: false },
      },
    ]);
    expect(socket.disconnected).toBe(true);
    // 关键: 拒绝发生在**任何写动作之前** —— 没落库行、没开场、没顶掉别人的帧出口.
    expect(bridgeOpens).toHaveLength(0);
    expect(voice.startSessionCalls).toHaveLength(0);
    expect(frames.size()).toBe(0);
  });

  it('B2 演练登记里属于别人 (voice 内存里已无) → 同样拒绝', async () => {
    const { gateway, voice, frames, sessions, bridgeOpens } = buildGateway({ jwtUserId: ATTACKER_ID });
    // voice 内存里查不到 (会话已结束), 但演练登记还挂着 → 只查 voice 内存会漏判.
    voice.ownedByOtherUser = false;
    sessions.register({
      sessionId: SESSION_ID,
      userId: OWNER_ID,
      tenantId: 'tenant-1',
      mode: 'voice',
      templateId: null,
      skillCode: null,
      preset: { difficulty: 'L1', style: 'mixed', emotionBaseline: 0.35, defenseLevel: 0.2, visitorMode: 'fullyReal' },
      createdAt: Date.now(),
    });
    const socket = buildSocket('socket-1', `/voice/training?sessionId=${SESSION_ID}&token=tk`);

    gateway.handleConnection(socket as unknown as Socket);
    await flush();

    expect(frameTypes(socket.frames)).toEqual(['error']);
    expect(socket.disconnected).toBe(true);
    expect(bridgeOpens).toHaveLength(0);
    expect(frames.size()).toBe(0);
  });

  it('B3 自己的 sessionId → 正常开场 (老语义保留)', async () => {
    const { gateway, voice, frames, bridgeOpens } = buildGateway();
    const socket = buildSocket('socket-1', `/voice/training?sessionId=${SESSION_ID}&token=tk`);

    gateway.handleConnection(socket as unknown as Socket);
    await flush();

    expect(frameTypes(socket.frames)).toEqual(['ready']);
    expect(bridgeOpens).toHaveLength(1);
    expect(voice.startSessionCalls).toHaveLength(1);
    expect(frames.size()).toBe(1);
  });

  it('B4 JWT 无效 → 断开, 且**不**登记帧出口 (登记已挪到鉴权之后)', async () => {
    const { gateway, frames, bridgeOpens } = buildGateway({ jwtValid: false });
    const socket = buildSocket('socket-1', `/voice/training?sessionId=${SESSION_ID}&token=bad`);

    gateway.handleConnection(socket as unknown as Socket);
    await flush();

    expect(socket.disconnected).toBe(true);
    // 关键: 鉴权没过 = 不许顶掉任何人的帧出口.
    expect(frames.size()).toBe(0);
    expect(bridgeOpens).toHaveLength(0);
  });

  it('B5 未鉴权的连接断开 → 不碰别人的会话 (不 detach / 不摘登记)', async () => {
    const { gateway, voice, sessions } = buildGateway();
    // 场景: 攻击者连上来 (只带 ?sessionId=, 没通过鉴权) 就被踢掉.
    //   socket.data.sessionId 是**客户端自选**的, userId 为空 = 从没验过 JWT.
    const socket = buildSocket('socket-1', `/voice/training?sessionId=${SESSION_ID}`);
    socket.data = { sessionId: SESSION_ID, userId: '' };

    gateway.handleDisconnect(socket as unknown as Socket);

    // 关键: 不许把别人的会话从内存里摘掉 (那会让对方的 TTS 被 cancel).
    expect(voice.detachCalls).toHaveLength(0);
    expect(sessions.find(SESSION_ID)).toBeNull();
  });
});
