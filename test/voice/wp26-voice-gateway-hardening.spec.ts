// V2026-11-03 治本 (WP26 · §1 安全加固 — 落在 voice 网关的 5 条):
//   P2-1  WS JWT 查黑名单 + token type —— 已登出的 access token 之前照样能连 WS.
//   P2-2  JWT 改走**握手请求之外**的通道 (?token= 保留兼容兜底):
//         · handshake.auth.token  (Socket.IO 标准握手字段 —— Flutter 端在用)
//         · Sec-WebSocket-Protocol 子协议 (给原生 ws 客户端用).
//   P2-5  握手写动作全部推到校验之后 —— 归属校验失败时**零状态写入**.
//   P2-36 sessionId 改服务端生成 —— 缺省 'default' 让所有客户端共用同一个 key.
//   P2-38 旧 socket 断开加 socketId 闸门 —— 旧 socket 断开不许摘新 socket 的登记.
//
//   边界: 全 mock; 不起 Nest 容器; 不连 Redis / 不连上游 / 不起引擎.
//   验证: npx vitest run test/voice/wp26-voice-gateway-hardening.spec.ts
//   时间戳: 2026-11-03 GMT+8

import type { ConfigService } from '@nestjs/config';
import type { JwtService } from '@nestjs/jwt';
import { createServer } from 'node:http';
import type { Socket } from 'socket.io';
import { Server as SocketIoServer } from 'socket.io';
import { vi } from 'vitest';
import { WebSocket as WsClient } from 'ws';

import { toUtf8Text } from '../../src/shared/infra/string-utils/index.js';
import { VoiceFrameRegistry } from '../../src/voice/voice-frame-registry.js';
import { VoiceSessionRegistry } from '../../src/voice/voice-session-registry.js';
import { selectVoiceSubprotocol, VoiceGateway, VoiceSubprotocolWsServer } from '../../src/voice/voice.gateway.js';
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
/** 形状合法的假 JWT (三段 base64url) —— 子协议解析只认这个形状. */
const JWT_LIKE = 'aaa.bbb.ccc';
const OTHER_JWT_LIKE = 'xxx.yyy.zzz';

/** 假 socket: 只需要 gateway 用到的那几个面. */
interface FakeSocket {
  id: string;
  /**
   * 握手上下文: token 的三条通道都在这里 ——
   *   query (`?token=`) / headers (`Sec-WebSocket-Protocol`) / auth (`setAuth({token})`).
   *
   * `auth` 允许是 undefined —— 真实 socket.io 里客户端发 "40"（无 payload）时,
   * `handshake.auth` 就是 undefined（见 socket.io 的 `buildHandshake`).
   */
  handshake: {
    url: string;
    query: Record<string, string>;
    headers: Record<string, string>;
    /** Socket.IO 标准握手 auth 字段 (CONNECT 包里带过来的). */
    auth: Record<string, unknown> | undefined;
  };
  data: Record<string, unknown>;
  /** 已经发出的帧. */
  frames: VoiceServerMessage[];
  /** 被断开过吗. */
  disconnected: boolean;
  emit(event: string, payload: unknown): void;
  disconnect(force?: boolean): void;
}

/**
 * 造一个假 socket.
 *
 * @param id socket id
 * @param url 连接 URL (query 通道从这里读)
 * @param subprotocol `Sec-WebSocket-Protocol` 头 (原生 ws 客户端通道)
 * @param auth 握手 auth 对象 (Socket.IO 客户端通道: `setAuth({ token })`)
 */
function buildSocket(id: string, url: string, subprotocol?: string, auth?: Record<string, unknown>): FakeSocket {
  const socket: FakeSocket = {
    id,
    handshake: {
      url,
      query: readQuery(url),
      headers: subprotocol === undefined ? {} : { 'sec-websocket-protocol': subprotocol },
      auth: auth ?? {},
    },
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
  readonly startSessionCalls: { readonly sessionId: string; readonly userId: string }[] = [];
  readonly reconnectCalls: unknown[] = [];
  /** 重连结果 (测试按场景改). */
  reconnectOutcome: VoiceReconnectOutcome = {
    ready: true,
    dbSessionId: DB_SESSION_ID,
    frame: { type: 'session_reattached', serverLatestTurnIndex: 3 },
    path: 'reattached',
    missedTurnCount: 0,
  };

  /** 归属判定桩: 这个 sessionId 是不是已经属于别人. */
  ownedByOtherUser = false;

  isSessionOwnedByOtherUser(): boolean {
    return this.ownedByOtherUser;
  }

  async startSession(meta: { readonly sessionId: string; readonly userId: string }): Promise<void> {
    this.startSessionCalls.push({ sessionId: meta.sessionId, userId: meta.userId });
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

/** 假黑名单服务: 记录查过哪些 jti, 按桩返回撤销状态. */
class FakeBlacklist {
  readonly checked: string[] = [];
  revoked = false;

  async isRevoked(jti: string): Promise<boolean> {
    this.checked.push(jti);
    return this.revoked;
  }
}

/** 装配参数. */
interface GatewayOptions {
  /** 黑名单桩: 这个 token 是不是已撤销. */
  readonly revoked?: boolean;
  /** JWT 载荷的 type (缺省 'access'). */
  readonly tokenType?: string;
  /** JWT 载荷的 jti (缺省 'jti-1'). */
  readonly jti?: string;
  /** 存量 token: 既没有 type 也没有 jti (老签发路径). */
  readonly legacyToken?: boolean;
  /** 完全不装配黑名单服务 (模拟 VoiceModule 还没接 UserModule). */
  readonly omitBlacklist?: boolean;
}

/** 装配一个被测的 gateway (端口全 stub). */
function buildGateway(options: GatewayOptions = {}): {
  readonly gateway: VoiceGateway;
  readonly voice: FakeVoiceService;
  readonly frames: VoiceFrameRegistry;
  readonly sessions: VoiceSessionRegistry;
  readonly blacklist: FakeBlacklist;
  readonly bridgeOpens: { readonly sessionId: string }[];
  readonly verifiedTokens: string[];
} {
  const voice = new FakeVoiceService();
  const frames = new VoiceFrameRegistry();
  const sessions = new VoiceSessionRegistry();
  const blacklist = new FakeBlacklist();
  blacklist.revoked = options.revoked ?? false;
  const bridgeOpens: { readonly sessionId: string }[] = [];
  const bridges = {
    open: async (input: { readonly sessionId: string }): Promise<{ persisted: boolean; dbSessionId: string | null }> => {
      bridgeOpens.push({ sessionId: input.sessionId });
      return { persisted: true, dbSessionId: DB_SESSION_ID };
    },
    close: async (): Promise<null> => null,
    appendTurn: async (): Promise<void> => {},
  };
  const verifiedTokens: string[] = [];
  const jwt = {
    verifyAsync: async (token: string): Promise<{ sub: string; jti?: string; type?: string }> => {
      verifiedTokens.push(token);
      // 存量 token (老签发路径) 既没有 type 也没有 jti —— 走的是兼容分支.
      if (options.legacyToken === true) {
        return { sub: USER_ID };
      }
      return { sub: USER_ID, jti: options.jti ?? 'jti-1', type: options.tokenType ?? 'access' };
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
    options.omitBlacklist === true ? undefined : (blacklist as never),
  );
  return { gateway, voice, frames, sessions, blacklist, bridgeOpens, verifiedTokens };
}

/** 等 verifyAndStart 的异步流程跑完 (它是 fire-and-forget). */
async function flush(): Promise<void> {
  for (let index = 0; index < 5; index += 1) {
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
}

// ────────────────────────────────────────────────────────────────────
// P2-1 · WS JWT 查黑名单 + token type
// ────────────────────────────────────────────────────────────────────

describe('WP26 · P2-1: WS 握手查黑名单 + token type', () => {
  it('已登出的 token (黑名单命中) → error(token_revoked) + 断开, 且零状态写入', async () => {
    const { gateway, voice, frames, sessions, blacklist, bridgeOpens } = buildGateway({ revoked: true });
    const socket = buildSocket('socket-1', `/voice/training?sessionId=${SESSION_ID}&token=${JWT_LIKE}`);

    gateway.handleConnection(socket as unknown as Socket);
    await flush();

    // 关键: 已撤销的 token 连**握手**都过不去.
    expect(socket.frames).toEqual([
      { type: 'error', error: { code: 'token_revoked', message: '登录状态已失效，请重新登录', retryable: false } },
    ]);
    expect(socket.disconnected).toBe(true);
    expect(blacklist.checked).toEqual(['jti-1']);
    // 零状态写入: 没落库 / 没开场 / 没接管帧出口 / 没写演练登记.
    expect(bridgeOpens).toHaveLength(0);
    expect(voice.startSessionCalls).toHaveLength(0);
    expect(frames.size()).toBe(0);
    expect(sessions.size()).toBe(0);
  });

  it('token type 是 refresh → error(unauthorized) + 断开, 且零状态写入', async () => {
    const { gateway, voice, frames, sessions, bridgeOpens } = buildGateway({ tokenType: 'refresh' });
    const socket = buildSocket('socket-1', `/voice/training?sessionId=${SESSION_ID}&token=${JWT_LIKE}`);

    gateway.handleConnection(socket as unknown as Socket);
    await flush();

    expect(frameTypes(socket.frames)).toEqual(['error']);
    expect(socket.disconnected).toBe(true);
    expect(bridgeOpens).toHaveLength(0);
    expect(voice.startSessionCalls).toHaveLength(0);
    expect(frames.size()).toBe(0);
    expect(sessions.size()).toBe(0);
  });

  it('正常 access token → 放行 (老语义保留)', async () => {
    const { gateway, voice, bridgeOpens, verifiedTokens, blacklist } = buildGateway();
    const socket = buildSocket('socket-1', `/voice/training?sessionId=${SESSION_ID}&token=${JWT_LIKE}`);

    gateway.handleConnection(socket as unknown as Socket);
    await flush();

    expect(frameTypes(socket.frames)).toEqual(['ready']);
    expect(bridgeOpens).toHaveLength(1);
    expect(voice.startSessionCalls).toHaveLength(1);
    expect(verifiedTokens).toEqual([JWT_LIKE]);
    // 黑名单被查过 (证明确实走了那一步, 不是被跳过).
    expect(blacklist.checked).toEqual(['jti-1']);
  });

  it('存量 token (没有 jti / 没有 type) → 放行, 且不查黑名单', async () => {
    const { gateway, blacklist } = buildGateway({ legacyToken: true });
    const socket = buildSocket('socket-1', `/voice/training?sessionId=${SESSION_ID}&token=${JWT_LIKE}`);

    gateway.handleConnection(socket as unknown as Socket);
    await flush();

    expect(frameTypes(socket.frames)).toEqual(['ready']);
    // 没有 jti = 无从查起 (老签发路径不带), 不该发起一次无意义的 Redis 查询.
    expect(blacklist.checked).toEqual([]);
  });

  it('黑名单服务没装配 → 放行 (fail-open) 且不崩', async () => {
    const { gateway } = buildGateway({ omitBlacklist: true });
    const socket = buildSocket('socket-1', `/voice/training?sessionId=${SESSION_ID}&token=${JWT_LIKE}`);

    gateway.handleConnection(socket as unknown as Socket);
    await flush();

    expect(frameTypes(socket.frames)).toEqual(['ready']);
  });
});

// ────────────────────────────────────────────────────────────────────
// P2-2 · JWT 改走 Sec-WebSocket-Protocol
// ────────────────────────────────────────────────────────────────────

describe('WP26 · P2-2: JWT 走 Sec-WebSocket-Protocol 子协议', () => {
  it('子协议 bearer, <jwt> → 握手成功, token 从子协议里取到', async () => {
    const { gateway, verifiedTokens } = buildGateway();
    const socket = buildSocket('socket-1', `/voice/training?sessionId=${SESSION_ID}`, `bearer, ${JWT_LIKE}`);

    gateway.handleConnection(socket as unknown as Socket);
    await flush();

    expect(frameTypes(socket.frames)).toEqual(['ready']);
    expect(verifiedTokens).toEqual([JWT_LIKE]);
  });

  it('只报 token (没有 bearer 标记) → 也认 (客户端实现自由一点)', async () => {
    const { gateway, verifiedTokens } = buildGateway();
    const socket = buildSocket('socket-1', `/voice/training?sessionId=${SESSION_ID}`, JWT_LIKE);

    gateway.handleConnection(socket as unknown as Socket);
    await flush();

    expect(frameTypes(socket.frames)).toEqual(['ready']);
    expect(verifiedTokens).toEqual([JWT_LIKE]);
  });

  it('老客户端只有 ?token= → 仍然能连 (兼容兜底, 不因为没带子协议就连不上)', async () => {
    const { gateway, verifiedTokens } = buildGateway();
    const socket = buildSocket('socket-1', `/voice/training?sessionId=${SESSION_ID}&token=${JWT_LIKE}`);

    gateway.handleConnection(socket as unknown as Socket);
    await flush();

    expect(frameTypes(socket.frames)).toEqual(['ready']);
    expect(verifiedTokens).toEqual([JWT_LIKE]);
  });

  it('子协议与 query 同时给 → 取子协议那个 (新通道优先)', async () => {
    const { gateway, verifiedTokens } = buildGateway();
    const socket = buildSocket('socket-1', `/voice/training?sessionId=${SESSION_ID}&token=${OTHER_JWT_LIKE}`, `bearer, ${JWT_LIKE}`);

    gateway.handleConnection(socket as unknown as Socket);
    await flush();

    expect(frameTypes(socket.frames)).toEqual(['ready']);
    expect(verifiedTokens).toEqual([JWT_LIKE]);
  });

  it('子协议里没有 token → 落到 query 兜底', async () => {
    const { gateway, verifiedTokens } = buildGateway();
    const socket = buildSocket('socket-1', `/voice/training?sessionId=${SESSION_ID}&token=${JWT_LIKE}`, 'bearer');

    gateway.handleConnection(socket as unknown as Socket);
    await flush();

    expect(frameTypes(socket.frames)).toEqual(['ready']);
    expect(verifiedTokens).toEqual([JWT_LIKE]);
  });

  it('子协议协商: 报了 bearer 就只回显 bearer; 没报就一个都不回显 (绝不回显 token)', () => {
    expect(selectVoiceSubprotocol(new Set(['bearer', JWT_LIKE]))).toBe('bearer');
    // 顺序无关: token 在前也只回显 bearer.
    expect(selectVoiceSubprotocol(new Set([JWT_LIKE, 'bearer']))).toBe('bearer');
    // 只报了 token → 不回显任何子协议 (ws 收到 false = 不写这个响应头).
    expect(selectVoiceSubprotocol(new Set([JWT_LIKE]))).toBe(false);
    // 客户端没报子协议 → 不参与协商 (老客户端照连).
    expect(selectVoiceSubprotocol(new Set())).toBe(false);
    // 只报了别的 (非 token) 子协议 → 回显它 (ws 客户端要求"报了就得选一个").
    expect(selectVoiceSubprotocol(new Set(['chat']))).toBe('chat');
  });
});

// ────────────────────────────────────────────────────────────────────
// P2-2 · JWT 走 handshake.auth (Socket.IO 标准握手字段)
// ────────────────────────────────────────────────────────────────────

describe('WP26 · P2-2: JWT 走 handshake.auth.token (Socket.IO 客户端通道)', () => {
  it('auth.token → 握手成功, token 从握手 auth 里取到 (query 里可以完全不带 token)', async () => {
    const { gateway, verifiedTokens } = buildGateway();
    const socket = buildSocket('socket-1', `/voice/training?sessionId=${SESSION_ID}`, undefined, { token: JWT_LIKE });

    gateway.handleConnection(socket as unknown as Socket);
    await flush();

    expect(frameTypes(socket.frames)).toEqual(['ready']);
    expect(verifiedTokens).toEqual([JWT_LIKE]);
  });

  it('auth 与 query 同时给 → 取 auth 那个 (新通道优先于旧兜底)', async () => {
    const { gateway, verifiedTokens } = buildGateway();
    const socket = buildSocket('socket-1', `/voice/training?sessionId=${SESSION_ID}&token=${OTHER_JWT_LIKE}`, undefined, {
      token: JWT_LIKE,
    });

    gateway.handleConnection(socket as unknown as Socket);
    await flush();

    expect(frameTypes(socket.frames)).toEqual(['ready']);
    expect(verifiedTokens).toEqual([JWT_LIKE]);
  });

  it('子协议与 auth 同时给 → 取子协议那个 (三级优先级: 子协议 > auth > query)', async () => {
    const { gateway, verifiedTokens } = buildGateway();
    const socket = buildSocket('socket-1', `/voice/training?sessionId=${SESSION_ID}`, `bearer, ${JWT_LIKE}`, {
      token: OTHER_JWT_LIKE,
    });

    gateway.handleConnection(socket as unknown as Socket);
    await flush();

    expect(frameTypes(socket.frames)).toEqual(['ready']);
    expect(verifiedTokens).toEqual([JWT_LIKE]);
  });

  it('auth.token 是空串 / 纯空白 → 落到 query 兜底', async () => {
    const { gateway, verifiedTokens } = buildGateway();
    const socket = buildSocket('socket-1', `/voice/training?sessionId=${SESSION_ID}&token=${JWT_LIKE}`, undefined, {
      token: ' '.repeat(3),
    });

    gateway.handleConnection(socket as unknown as Socket);
    await flush();

    expect(frameTypes(socket.frames)).toEqual(['ready']);
    expect(verifiedTokens).toEqual([JWT_LIKE]);
  });

  it('auth.token 不是字符串 → 落到 query 兜底', async () => {
    const { gateway, verifiedTokens } = buildGateway();
    const socket = buildSocket('socket-1', `/voice/training?sessionId=${SESSION_ID}&token=${JWT_LIKE}`, undefined, { token: 42 });

    gateway.handleConnection(socket as unknown as Socket);
    await flush();

    expect(frameTypes(socket.frames)).toEqual(['ready']);
    expect(verifiedTokens).toEqual([JWT_LIKE]);
  });

  it('auth 里键名不是 token (如 accessToken) → 不认, 落到 query 兜底 (只认一个键名, 不留别名后门)', async () => {
    const { gateway, verifiedTokens } = buildGateway();
    const socket = buildSocket('socket-1', `/voice/training?sessionId=${SESSION_ID}&token=${JWT_LIKE}`, undefined, {
      accessToken: JWT_LIKE,
    });

    gateway.handleConnection(socket as unknown as Socket);
    await flush();

    expect(frameTypes(socket.frames)).toEqual(['ready']);
    expect(verifiedTokens).toEqual([JWT_LIKE]);
  });

  it('auth.token 前后有空白 → trim 后使用', async () => {
    const { gateway, verifiedTokens } = buildGateway();
    const socket = buildSocket('socket-1', `/voice/training?sessionId=${SESSION_ID}`, undefined, { token: `  ${JWT_LIKE}  ` });

    gateway.handleConnection(socket as unknown as Socket);
    await flush();

    expect(frameTypes(socket.frames)).toEqual(['ready']);
    expect(verifiedTokens).toEqual([JWT_LIKE]);
  });

  it('auth 通道的 token 也查黑名单 (已撤销 → token_revoked + 断开 + 零状态写入)', async () => {
    const { gateway, voice, frames, sessions, blacklist, bridgeOpens } = buildGateway({ revoked: true });
    const socket = buildSocket('socket-1', `/voice/training?sessionId=${SESSION_ID}`, undefined, { token: JWT_LIKE });

    gateway.handleConnection(socket as unknown as Socket);
    await flush();

    expect(socket.frames).toEqual([
      { type: 'error', error: { code: 'token_revoked', message: '登录状态已失效，请重新登录', retryable: false } },
    ]);
    expect(socket.disconnected).toBe(true);
    expect(blacklist.checked).toEqual(['jti-1']);
    expect(bridgeOpens).toHaveLength(0);
    expect(voice.startSessionCalls).toHaveLength(0);
    expect(frames.size()).toBe(0);
    expect(sessions.size()).toBe(0);
  });

  it('handshake.auth 是 undefined（客户端压根没发 auth）→ 落到 query 兜底, 不崩', async () => {
    const { gateway, verifiedTokens } = buildGateway();
    const socket = buildSocket('socket-1', `/voice/training?sessionId=${SESSION_ID}&token=${JWT_LIKE}`);
    // 真实 socket.io: 客户端发 "40"（CONNECT 包无 payload）时 handshake.auth 就是 undefined.
    socket.handshake.auth = undefined;

    gateway.handleConnection(socket as unknown as Socket);
    await flush();

    expect(frameTypes(socket.frames)).toEqual(['ready']);
    expect(verifiedTokens).toEqual([JWT_LIKE]);
  });

  it('三条通道都没给 token → error(unauthorized) + 断开, 且零状态写入', async () => {
    const { gateway, voice, frames, sessions, bridgeOpens } = buildGateway();
    const socket = buildSocket('socket-1', `/voice/training?sessionId=${SESSION_ID}`);

    gateway.handleConnection(socket as unknown as Socket);
    await flush();

    expect(frameTypes(socket.frames)).toEqual(['error']);
    expect(socket.disconnected).toBe(true);
    expect(bridgeOpens).toHaveLength(0);
    expect(voice.startSessionCalls).toHaveLength(0);
    expect(frames.size()).toBe(0);
    expect(sessions.size()).toBe(0);
  });
});

// ────────────────────────────────────────────────────────────────────
// P2-2 · 真 socket 握手: 响应头只回显 'bearer'
// ────────────────────────────────────────────────────────────────────

/** 一次裸 ws 握手的结果. */
interface HandshakeResult {
  /** 服务端协商到的子协议 (空串 = 服务端没选任何子协议). */
  readonly protocol: string;
  /** 握手响应的原始头 (用来断言 token 没出现在响应里). */
  readonly rawHeaders: readonly string[];
}

/**
 * 起一个真的 socket.io 服务 (可选自定义 ws 引擎), 用裸 ws 客户端连一次.
 *
 * 为什么不用 socket.io-client: 仓库没装它 (服务端依赖里没有), 而**裸 ws 客户端
 * 恰好能验证本单最关键的那件事 —— 握手响应头里回显了哪个子协议.
 */
async function handshakeWithProtocols(
  protocols: readonly string[],
  options: { readonly customWsEngine?: boolean } = {},
): Promise<HandshakeResult> {
  const httpServer = createServer();
  const io = new SocketIoServer(httpServer, {
    path: '/voice/training',
    ...(options.customWsEngine === true ? { wsEngine: VoiceSubprotocolWsServer as never } : {}),
  });
  await new Promise<void>((resolve) => {
    httpServer.listen(0, '127.0.0.1', resolve);
  });
  const address = httpServer.address();
  const port = typeof address === 'object' && address !== null ? address.port : 0;

  try {
    return await new Promise<HandshakeResult>((resolve, reject) => {
      const client = new WsClient(`ws://127.0.0.1:${port}/voice/training/?EIO=4&transport=websocket`, [...protocols]);
      let rawHeaders: string[] = [];
      client.on('upgrade', (response) => {
        rawHeaders = Object.entries(response.headers).map(([key, value]) => `${key}: ${String(value)}`);
      });
      client.on('open', () => {
        client.close();
        resolve({ protocol: client.protocol, rawHeaders });
      });
      client.on('error', (err: Error) => {
        reject(err);
      });
    });
  } finally {
    // socket.io 的 close() 返回 Promise (会把 http server 一起关掉).
    await io.close();
  }
}

describe('WP26 · P2-2: 握手响应的子协议协商 (真 socket)', () => {
  it('客户端报 bearer, <jwt> → 握手成功, 协商到 bearer (响应里没有 token)', async () => {
    const result = await handshakeWithProtocols(['bearer', JWT_LIKE], { customWsEngine: true });

    expect(result.protocol).toBe('bearer');
    expect(result.rawHeaders.join('\n')).not.toContain(JWT_LIKE);
  });

  it('即使客户端把 token 放第一位 → 服务端也只回显 bearer (token 不进响应)', async () => {
    const result = await handshakeWithProtocols([JWT_LIKE, 'bearer'], { customWsEngine: true });

    expect(result.protocol).toBe('bearer');
    expect(result.rawHeaders.join('\n')).not.toContain(JWT_LIKE);
  });

  it('客户端只报 token (没有 bearer 标记) → 服务端拒绝回显 → 严格客户端中断握手 (token 不进响应)', async () => {
    // ws 客户端要求"客户端报了子协议, 服务端就必须选一个" —— 我们不选 token,
    // 于是它以 "Server sent no subprotocol" 中断. 这是"客户端没按契约带 bearer
    // 标记"的明确信号, 比把 token 回显出去好.
    await expect(handshakeWithProtocols([JWT_LIKE], { customWsEngine: true })).rejects.toThrow(/no subprotocol/i);
  });

  it('对照组: 用 ws 默认引擎时会把客户端报的**第一个**子协议原样回显 (token 会泄漏) → 所以必须自定义引擎', async () => {
    const result = await handshakeWithProtocols([JWT_LIKE, 'bearer']);

    // 这就是"为什么要接管协商"的实证: 默认引擎把 token 又发了一遍.
    expect(result.protocol).toBe(JWT_LIKE);
  });
});

// ────────────────────────────────────────────────────────────────────
// P2-2 · 真 socket: handshake.auth 的**协议层**来源 (CONNECT 包)
// ────────────────────────────────────────────────────────────────────

/**
 * 用真实的 socket.io 协议握一次手, 看服务端收到的 `handshake.auth` 是什么.
 *
 * 为什么必须真连一次 (只有假 socket 是不够的):
 *   `handshake.auth` 来自 socket.io 的 **CONNECT 包** (`40{"token":"..."}`) —— 既不是 HTTP 头,
 *   也不是 URL query. 假 socket 只能证明"服务端读了 auth.token", 证明不了"socket.io 客户端的
 *   `setAuth({ token })` 真的会被 socket.io 编成 CONNECT 包并落到 handshake.auth 上".
 *   这里用裸 ws 手工发一个 CONNECT 包, 把**协议层**也钉死 —— 哪天 socket.io 改了编码,
 *   这个用例会先红.
 *
 * @param auth CONNECT 包里带的 auth 对象
 * @returns 服务端侧看到的 handshake.auth
 */
async function readWireHandshakeAuth(auth: Record<string, unknown>): Promise<Record<string, unknown>> {
  const httpServer = createServer();
  // 用生产同款 ws 引擎 —— auth 通道不能只在"默认引擎"下成立.
  const io = new SocketIoServer(httpServer, { path: '/voice/training', wsEngine: VoiceSubprotocolWsServer as never });
  const captured = new Promise<Record<string, unknown>>((resolve) => {
    io.on('connection', (socket) => {
      resolve({ ...socket.handshake.auth });
    });
  });
  await new Promise<void>((resolve) => {
    httpServer.listen(0, '127.0.0.1', resolve);
  });
  const address = httpServer.address();
  const port = typeof address === 'object' && address !== null ? address.port : 0;

  const client = new WsClient(`ws://127.0.0.1:${port}/voice/training/?EIO=4&transport=websocket`);
  try {
    // engine.io 的 OPEN 包 ("0{...}") 之后才允许发 CONNECT 包 ("40{...}").
    client.on('message', (raw) => {
      if (toUtf8Text(raw).startsWith('0')) {
        client.send(`40${JSON.stringify(auth)}`);
      }
    });
    return await captured;
  } finally {
    client.close();
    await io.close();
  }
}

describe('WP26 · P2-2: handshake.auth 的真实线上通道 (CONNECT 包)', () => {
  it('客户端在 CONNECT 包里带 auth → 服务端 handshake.auth 拿到 token (与 setAuth({token}) 同一条路)', async () => {
    const seen = await readWireHandshakeAuth({ token: JWT_LIKE });

    // socket.io 把 CONNECT 包的 payload 直接当成 auth —— 所以服务端读到的就是 { token }.
    expect(seen['token']).toBe(JWT_LIKE);
  });

  it('token 走 CONNECT 包 → **不进 URL** (query 里没有 token, 也就不会落进 access log)', async () => {
    const seen = await readWireHandshakeAuth({ token: JWT_LIKE });

    // 断言这条通道的意义: token 走的不是 URL, 而是握手后的 CONNECT 包.
    expect(seen['token']).toBe(JWT_LIKE);
    expect(Object.keys(seen)).toEqual(['token']);
  });
});

// ────────────────────────────────────────────────────────────────────
// P2-5 · 握手写动作全部推到校验之后
// ────────────────────────────────────────────────────────────────────

describe('WP26 · P2-5: 归属校验失败时零状态写入', () => {
  it('别人的 sessionId → 拒绝, 且不落库 / 不开场 / 不写演练登记 / 不接管帧出口', async () => {
    const { gateway, voice, frames, sessions, bridgeOpens } = buildGateway();
    voice.ownedByOtherUser = true;
    const socket = buildSocket('socket-1', `/voice/training?sessionId=${SESSION_ID}&token=${JWT_LIKE}`);

    gateway.handleConnection(socket as unknown as Socket);
    await flush();

    expect(frameTypes(socket.frames)).toEqual(['error']);
    expect(socket.disconnected).toBe(true);
    // 零状态写入 (四项写动作一个都不能发生).
    expect(bridgeOpens).toHaveLength(0);
    expect(voice.startSessionCalls).toHaveLength(0);
    expect(frames.size()).toBe(0);
    expect(sessions.size()).toBe(0);
  });

  it('被拒的连接断开时 → 不碰别人的会话 (不 detach / 不摘登记)', async () => {
    const { gateway, voice, sessions } = buildGateway();
    voice.ownedByOtherUser = true;
    const socket = buildSocket('socket-1', `/voice/training?sessionId=${SESSION_ID}&token=${JWT_LIKE}`);

    gateway.handleConnection(socket as unknown as Socket);
    await flush();
    gateway.handleDisconnect(socket as unknown as Socket);

    expect(voice.detachCalls).toHaveLength(0);
    expect(sessions.find(SESSION_ID)).toBeNull();
  });
});

// ────────────────────────────────────────────────────────────────────
// P2-36 · sessionId 改服务端生成
// ────────────────────────────────────────────────────────────────────

describe('WP26 · P2-36: sessionId 服务端生成', () => {
  it('不带 ?sessionId= 的两个客户端 → 不共用 key (两个 serverSessionId / 两份演练登记)', async () => {
    const { gateway, voice, sessions, bridgeOpens } = buildGateway();
    const first = buildSocket('socket-1', `/voice/training?token=${JWT_LIKE}`);
    const second = buildSocket('socket-2', `/voice/training?token=${JWT_LIKE}`);

    gateway.handleConnection(first as unknown as Socket);
    await flush();
    gateway.handleConnection(second as unknown as Socket);
    await flush();

    const firstReady = first.frames.find((frame) => frame.type === 'ready');
    const secondReady = second.frames.find((frame) => frame.type === 'ready');
    expect(firstReady?.type).toBe('ready');
    expect(secondReady?.type).toBe('ready');
    // 两个客户端拿到**不同**的会话 id (不再是共用的 'default').
    expect(firstReady?.serverSessionId).toBeTruthy();
    expect(secondReady?.serverSessionId).toBeTruthy();
    expect(firstReady?.serverSessionId).not.toBe(secondReady?.serverSessionId);
    expect(firstReady?.serverSessionId).not.toBe('default');
    // 整场都用这个 id: 落库桥 / 演练登记 / voice 会话 三处口径一致.
    expect(bridgeOpens.map((row) => row.sessionId)).toEqual([firstReady?.serverSessionId, secondReady?.serverSessionId]);
    expect(sessions.size()).toBe(2);
    expect(voice.startSessionCalls.map((call) => call.sessionId)).toEqual([firstReady?.serverSessionId, secondReady?.serverSessionId]);
  });

  it('客户端带合法 sessionId → serverSessionId 就是它 (行为与现在逐字一致)', async () => {
    const { gateway, sessions } = buildGateway();
    const socket = buildSocket('socket-1', `/voice/training?sessionId=${SESSION_ID}&token=${JWT_LIKE}`);

    gateway.handleConnection(socket as unknown as Socket);
    await flush();

    const ready = socket.frames.find((frame) => frame.type === 'ready');
    expect(ready?.serverSessionId).toBe(SESSION_ID);
    expect(sessions.find(SESSION_ID)).not.toBeNull();
  });

  it('客户端带缺省值 default → 服务端重新生成 (不再是共用的 default)', async () => {
    const { gateway, sessions } = buildGateway();
    const socket = buildSocket('socket-1', `/voice/training?sessionId=default&token=${JWT_LIKE}`);

    gateway.handleConnection(socket as unknown as Socket);
    await flush();

    const ready = socket.frames.find((frame) => frame.type === 'ready');
    expect(ready?.serverSessionId).toBeTruthy();
    expect(ready?.serverSessionId).not.toBe('default');
    expect(sessions.find('default')).toBeNull();
  });

  it('客户端拿服务端下发的 id 回来重连 → 续同一场 (WP23 补漏链路不断)', async () => {
    const { gateway, sessions } = buildGateway();
    const first = buildSocket('socket-1', `/voice/training?token=${JWT_LIKE}`);
    gateway.handleConnection(first as unknown as Socket);
    await flush();
    const ready = first.frames.find((frame) => frame.type === 'ready');
    const serverSessionId = ready?.serverSessionId ?? '';

    const second = buildSocket('socket-2', `/voice/training?sessionId=${serverSessionId}&token=${JWT_LIKE}&lastSeenTurnIndex=1`);
    gateway.handleConnection(second as unknown as Socket);
    await flush();

    // 重连走的还是同一场: 演练登记没多出一条 (是覆盖, 不是新增).
    expect(sessions.size()).toBe(1);
    expect(sessions.find(serverSessionId)).not.toBeNull();
  });
});

// ────────────────────────────────────────────────────────────────────
// P2-38 · 旧 socket 断开加 socketId 闸门
// ────────────────────────────────────────────────────────────────────

describe('WP26 · P2-38: 旧 socket 断开不许摘新 socket 的登记', () => {
  it('旧 socket 断开 → 新 socket 的演练登记仍在; 新 socket 断开才被摘掉', async () => {
    const { gateway, voice, sessions } = buildGateway();
    const first = buildSocket('socket-1', `/voice/training?sessionId=${SESSION_ID}&token=${JWT_LIKE}`);
    gateway.handleConnection(first as unknown as Socket);
    await flush();
    expect(sessions.find(SESSION_ID)).not.toBeNull();

    // 重连: 新 socket 接管同一场会话.
    const second = buildSocket('socket-2', `/voice/training?sessionId=${SESSION_ID}&token=${JWT_LIKE}&lastSeenTurnIndex=1`);
    gateway.handleConnection(second as unknown as Socket);
    await flush();

    // 旧 socket 这时才断开 —— 它不是当前持有者, 不能把新 socket 的登记摘掉.
    gateway.handleDisconnect(first as unknown as Socket);
    expect(sessions.find(SESSION_ID)).not.toBeNull();
    expect(voice.detachCalls).toHaveLength(0);

    // 新 socket 断开才摘.
    gateway.handleDisconnect(second as unknown as Socket);
    expect(sessions.find(SESSION_ID)).toBeNull();
    expect(voice.detachCalls).toEqual([SESSION_ID]);
  });
});
