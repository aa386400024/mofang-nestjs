// V2026-11-03 治本 (WP23 · gateway 断连与重连 · 单测):
//   覆盖任务单 §3 验收表里属于 **gateway (transport 层)** 的那些:
//     ① 断连**不杀会话** —— handleDisconnect 不调 endSession (只调 detachSocket);
//     ② 重连 (内存命中) → ready + `session_catchup`, 且**不重新落库**、**不重新开场**;
//     ③ 重连不可续 → 走 fresh 开场流程, 并补推 `session_stale`;
//     ④ 帧出口按落库 id 登记, 断连时注销;
//     ⑤ 旧 socket 断开**不**注销新 socket 的出口 (重连竞态).
//
//   全 mock: voice / jwt / 业务桥 / 音色目录都是 stub; 不起 Nest 容器、不连上游.
//
//   验证: npx vitest run test/voice/wp23-gateway-reconnect.spec.ts
//   时间戳: 2026-11-03 GMT+8

import type { ConfigService } from '@nestjs/config';
import type { JwtService } from '@nestjs/jwt';
import type { Socket } from 'socket.io';
import { vi } from 'vitest';

import { VoiceFrameRegistry } from '../../src/voice/voice-frame-registry.js';
import { VoiceSessionRegistry } from '../../src/voice/voice-session-registry.js';
import { VoiceGateway } from '../../src/voice/voice.gateway.js';
import type { VoiceReconnectOutcome } from '../../src/voice/voice.service.js';
import type { VoiceServerMessage } from '../../src/voice/voice.types.js';

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
const DB_SESSION_ID = 'db-1';

/** 假 socket: 只需要 gateway 用到的那几个面. */
interface FakeSocket {
  id: string;
  handshake: { url: string; query: Record<string, string>; headers: Record<string, string> };
  data: Record<string, unknown>;
  /** 已经发出的帧. */
  frames: VoiceServerMessage[];
  emit(event: string, payload: unknown): void;
  disconnect(force?: boolean): void;
}

/** 造一个假 socket. */
function buildSocket(id: string, url: string): FakeSocket {
  const socket: FakeSocket = {
    id,
    // ⚠️ gateway 取 token 走的是 `handshake.query['token']` (不是从 url 里现解析),
    //   所以这里要把 url 的 query 也填进 query —— 真实 socket.io 两边都有.
    handshake: { url, query: readQuery(url), headers: {} },
    data: {},
    frames: [],
    emit(_event: string, payload: unknown): void {
      if (typeof payload === 'object' && payload !== null && 'type' in payload) {
        socket.frames.push(payload as VoiceServerMessage);
      }
    },
    disconnect(): void {
      /* noop */
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
  readonly reconnectCalls: unknown[] = [];
  /** 重连结果 (测试按场景改). */
  reconnectOutcome: VoiceReconnectOutcome = {
    ready: true,
    dbSessionId: DB_SESSION_ID,
    frame: { type: 'session_reattached', serverLatestTurnIndex: 3 },
    path: 'reattached',
    missedTurnCount: 0,
  };

  /**
   * V2026-11-03 (WP25): 归属判定桩.
   *
   * 默认 false = 没人抢这个 sessionId —— 本单 (WP23) 测的是**断连/重连**语义,
   * 归属校验由 WP25 的专项用例单独覆盖 (test/voice/wp25-ws-session-ownership.spec.ts).
   */
  ownedByOtherUser = false;

  /** V2026-11-03 (WP25): 这个 sessionId 是不是已经属于别人? */
  isSessionOwnedByOtherUser(): boolean {
    return this.ownedByOtherUser;
  }

  async startSession(meta: unknown): Promise<void> {
    this.startSessionCalls.push(meta);
  }

  async reconnectSession(params: unknown): Promise<VoiceReconnectOutcome> {
    this.reconnectCalls.push(params);
    return this.reconnectOutcome;
  }

  endSession(sessionId: string, reason: string): void {
    this.endSessionCalls.push({ sessionId, reason });
  }

  detachSocket(sessionId: string): void {
    this.detachCalls.push(sessionId);
  }
}

/** 装配一个被测的 gateway (端口全 stub). */
function buildGateway(): {
  readonly gateway: VoiceGateway;
  readonly voice: FakeVoiceService;
  readonly frames: VoiceFrameRegistry;
  readonly bridgeOpens: unknown[];
} {
  const voice = new FakeVoiceService();
  const frames = new VoiceFrameRegistry();
  const bridgeOpens: unknown[] = [];
  const bridges = {
    open: async (input: unknown): Promise<{ persisted: boolean; dbSessionId: string | null }> => {
      bridgeOpens.push(input);
      return { persisted: true, dbSessionId: DB_SESSION_ID };
    },
    close: async (): Promise<null> => null,
    appendTurn: async (): Promise<void> => {},
  };
  const jwt = { verifyAsync: async (): Promise<{ sub: string; tenantId?: string }> => ({ sub: USER_ID }) };
  const config = {
    getOrThrow: (): string => 'secret',
    get: (key: string): string | undefined => (key === 'jwtSecret' ? 'secret' : undefined),
  };
  const gateway = new VoiceGateway(
    voice as never,
    jwt as unknown as JwtService,
    config as unknown as ConfigService,
    { resolve: async () => null } as never,
    new VoiceSessionRegistry(),
    { check: async () => 'available' } as never,
    bridges as never,
    frames,
  );
  return { gateway, voice, frames, bridgeOpens };
}

/** 等 verifyAndStart 的异步流程跑完 (它是 fire-and-forget). */
async function flush(): Promise<void> {
  for (let index = 0; index < 5; index += 1) {
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
}

describe('WP23 · gateway 断连与重连', () => {
  describe('① 断连不杀会话', () => {
    it('handleDisconnect → 不调 endSession (只调 detachSocket)', () => {
      const { gateway, voice } = buildGateway();
      const socket = buildSocket('socket-1', `/voice/training?sessionId=${SESSION_ID}`);
      socket.data = { sessionId: SESSION_ID, userId: USER_ID };

      gateway.handleDisconnect(socket as unknown as Socket);

      // 核心断言: 断线**不**结束会话 (BDI / 逐字稿 / 台账都还在).
      expect(voice.endSessionCalls).toHaveLength(0);
      expect(voice.detachCalls).toEqual([SESSION_ID]);
    });
  });

  describe('② 重连 (内存命中) → ready + 补漏帧', () => {
    it('带 lastSeenTurnIndex 重连 → 推 ready + session_catchup, 不重新落库也不重新开场', async () => {
      const { gateway, voice, bridgeOpens } = buildGateway();
      voice.reconnectOutcome = {
        ready: true,
        dbSessionId: DB_SESSION_ID,
        frame: {
          type: 'session_catchup',
          serverLatestTurnIndex: 3,
          missedTurns: [
            {
              turnIndex: 2,
              userText: '漏掉的一句',
              replyText: '漏掉的一句的回复',
              marks: [],
              crisisLevel: 'pass',
            },
          ],
          currentSessionState: { phase: 'listening', riskLevel: 'normal', monitored: false, characterCode: 'vpt_x' },
        },
        path: 'reattached',
        missedTurnCount: 1,
      };
      const socket = buildSocket('socket-1', `/voice/training?sessionId=${SESSION_ID}&token=tk&lastSeenTurnIndex=1`);

      gateway.handleConnection(socket as unknown as Socket);
      await flush();

      expect(frameTypes(socket.frames)).toEqual(['ready', 'session_catchup']);
      // **不重新落库** —— 复用原落库 id (新建行 = 同一场会谈在库里裂成两场).
      expect(bridgeOpens).toHaveLength(0);
      // **不重新开场** —— 会话对象还活着, BDI 状态没被重置.
      expect(voice.startSessionCalls).toHaveLength(0);
      // 重连入参带上了 lastSeenTurnIndex.
      expect(voice.reconnectCalls[0]).toMatchObject({ lastSeenTurnIndex: 1 });
    });

    it('没带 lastSeenTurnIndex → 走正常开场流程 (不是重连)', async () => {
      const { gateway, voice, bridgeOpens } = buildGateway();
      const socket = buildSocket('socket-1', `/voice/training?sessionId=${SESSION_ID}&token=tk`);

      gateway.handleConnection(socket as unknown as Socket);
      await flush();

      expect(voice.reconnectCalls).toHaveLength(0);
      expect(bridgeOpens).toHaveLength(1);
      expect(voice.startSessionCalls).toHaveLength(1);
      expect(frameTypes(socket.frames)).toEqual(['ready']);
    });
  });

  describe('③ 重连不可续 → fresh 开场 + stale 帧', () => {
    it('会话不可续 → 照样开一场新的, 并告诉客户端"上一场接不上了"', async () => {
      const { gateway, voice, bridgeOpens } = buildGateway();
      voice.reconnectOutcome = {
        ready: false,
        frame: { type: 'session_stale', reason: 'unknown_session' },
        path: 'stale',
        missedTurnCount: 0,
      };
      const socket = buildSocket('socket-1', `/voice/training?sessionId=${SESSION_ID}&token=tk&lastSeenTurnIndex=3`);

      gateway.handleConnection(socket as unknown as Socket);
      await flush();

      // ready 先到 (客户端要先知道新会话), stale 帧随后.
      expect(frameTypes(socket.frames)).toEqual(['ready', 'session_stale']);
      expect(bridgeOpens).toHaveLength(1);
      expect(voice.startSessionCalls).toHaveLength(1);
    });
  });

  describe('④⑤ 帧出口的登记与注销', () => {
    it('建连后按落库 id 登记出口, 断连后注销', async () => {
      const { gateway, frames } = buildGateway();
      const socket = buildSocket('socket-1', `/voice/training?sessionId=${SESSION_ID}&token=tk`);
      socket.data = { sessionId: SESSION_ID, userId: USER_ID };

      gateway.handleConnection(socket as unknown as Socket);
      await flush();
      expect(frames.size()).toBe(1);

      gateway.handleDisconnect(socket as unknown as Socket);
      expect(frames.size()).toBe(0);
    });

    it('旧 socket 断开 → **不**注销新 socket 的出口 (重连竞态)', async () => {
      const { gateway, frames } = buildGateway();
      const first = buildSocket('socket-1', `/voice/training?sessionId=${SESSION_ID}&token=tk`);
      gateway.handleConnection(first as unknown as Socket);
      await flush();
      expect(frames.size()).toBe(1);

      // 重连: 新 socket 接管同一场会话.
      const second = buildSocket('socket-2', `/voice/training?sessionId=${SESSION_ID}&token=tk&lastSeenTurnIndex=1`);
      gateway.handleConnection(second as unknown as Socket);
      await flush();

      // 旧 socket 这时才断开 —— 它**不是**当前出口的主人, 不能把新出口注销掉.
      gateway.handleDisconnect(first as unknown as Socket);
      expect(frames.size()).toBe(1);

      // 新 socket 断开才注销.
      gateway.handleDisconnect(second as unknown as Socket);
      expect(frames.size()).toBe(0);
    });
  });
});
