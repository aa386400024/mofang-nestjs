// V2026-10-08 治本 (Voice Gateway WebSocket 端点 — SPEC §9.1):
//   路径: /voice/training (ws upgrade)
//   鉴权: 连接时校验 JWT (url query `?token=***` 或 socket handshake 头),
//     校验通过后注入 socket.data.userId / tenantId / traceId.
//   转发: 客户端消息 → VoiceService.handleMessage, 推流消息 → socket.send.
//
//   平台适配: 用 @nestjs/platform-ws (基于 ws 包, 项目已装 8.21.3),
//     不引 socket.io (省 200KB+ 包大小 + 更轻量).
//
//   反双胞胎:
//     - 不用 Socket.IO — @nestjs/platform-ws 更轻
//     - 不在 gateway 里做业务编排 — gateway 只做 transport, 业务在 VoiceService
//     - 不缓存 client 连接 — disconnect 时直接 endSession, 资源清理彻底
//
//   治本 (TS2420 class not implementing interface, 183 cascade errors):
//     原版用 parameter property (constructor 里的 `private readonly voice: ...`)
//     + implements OnGatewayConnection<any> 泛型接口, 在 ts 5 + strict 模式下
//     触发 corner case: class body 上下文丢失, 所有成员被报"never used".
//     改用显式字段声明 + 构造器赋值, 不用 parameter property, 不用泛型接口
//     (用 OnGatewayConnection<WsWebSocket> 显式类型, ts 能正确 resolve).
//
//   如何验证:
//     1. pnpm build 无 type error
//     2. wscat -c "ws://localhost:3000/voice/training?token=***<jwt>" — 连接成功
//     3. 发 {"type":"user_text","text":"你好"} — 收到 llm_start/llm_text/llm_done/tts_start/audio/tts_done

import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
} from '@nestjs/websockets';
import type { IncomingMessage } from 'node:http';
import type { WebSocket as WsWebSocket } from 'ws';

import { VoiceService } from './voice.service';
import type { VoiceClientMessage, VoiceServerMessage } from './voice.types';

interface SocketData {
  sessionId: string;
  userId: string;
  tenantId: string;
  traceId: string;
  /**
   * 来访者 persona ID — V2026-10-09: 从 URL `?personaId=` 提取, 可选.
   * 缺失时 VisitorService.openSession 走 PersonaRepository.findDefault() 兜底.
   */
  personaId?: string;
}

@WebSocketGateway({ path: '/voice/training' })
export class VoiceGateway implements OnGatewayConnection<WsWebSocket>, OnGatewayDisconnect {
  private readonly logger: Logger = new Logger(VoiceGateway.name);
  private readonly voice: VoiceService;
  private readonly jwt: JwtService;
  private readonly config: ConfigService;

  constructor(voice: VoiceService, jwt: JwtService, config: ConfigService) {
    this.voice = voice;
    this.jwt = jwt;
    this.config = config;
  }

  /**
   * 连接时鉴权 + 启动 session.
   *   - @nestjs/platform-ws 签名: handleConnection(client, ...args)
   *     - client: ws.WebSocket 实例
   *     - args[0]: 升级请求 (有 URL / headers / auth)
   */
  handleConnection(client: WsWebSocket, ...args: unknown[]): void {
    const request = args[0] as IncomingMessage | undefined;
    // 1. 提取 sessionId 从 path: /voice/training/<sid>?token=***
    const url = request?.url ?? '';
    const sessionId = this.extractSessionId(url);
    const data: SocketData = {
      sessionId,
      userId: '',
      tenantId: 'default',
      // V2026-10-09: 提取 personaId 供 VisitorService.openSession 加载来访者
      personaId: this.extractPersonaId(url),
      // V2026-10-09 lint fix (sonarjs/pseudo-random): traceId 仅 6 字符 base36 用来串日志,
      //   非 sessionId / API key 等安全敏感场景, Math.random 足够. 强安全需求改 crypto.randomUUID().
      // eslint-disable-next-line sonarjs/pseudo-random
      traceId: 'vt-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8),
    };
    (client as unknown as { sessionId: string }).sessionId = sessionId;

    // 2. 提取 JWT
    const token = this.extractToken(url, request);
    if (!token) {
      this.logger.warn('[onConnect] no token, session=' + sessionId);
      this.sendJson(client, { type: 'error', error: { code: 'unauthorized', message: 'missing token', retryable: false } });
      client.close(1008, 'unauthorized');
      return;
    }
    // 3. 校验 JWT (async, 但 handleConnection 必须 void — 走 fire-and-forget)
    void this.verifyAndStart(client, data, token);
  }

  private async verifyAndStart(client: WsWebSocket, data: SocketData, token: string): Promise<void> {
    try {
      const payload = await this.jwt.verifyAsync<{ sub: string; tenantId?: string }>(token, {
        secret: this.config.getOrThrow<string>('jwtSecret'),
      });
      data.userId = payload.sub;
      data.tenantId = payload.tenantId ?? 'default';
    } catch (err) {
      this.logger.warn('[onConnect] jwt verify failed: ' + (err instanceof Error ? err.message : String(err)));
      this.sendJson(client, { type: 'error', error: { code: 'unauthorized', message: 'invalid token', retryable: false } });
      client.close(1008, 'unauthorized');
      return;
    }

    // 4. 注入到 client 供后续 message 路由用
    (client as unknown as { data: SocketData }).data = data;

    // 5. 启动 session (V2026-10-09: startSession 改 async, 走 VisitorService 加载 persona)
    await this.voice.startSession({
      sessionId: data.sessionId,
      userId: data.userId,
      tenantId: data.tenantId,
      traceId: data.traceId,
      personaId: data.personaId,
    });
    this.logger.log('[onConnect] session=' + data.sessionId + ' user=' + data.userId + ' tenant=' + data.tenantId);
  }

  /** 断开时清理. */
  handleDisconnect(client: WsWebSocket): void {
    const data = (client as unknown as { data?: SocketData }).data;
    if (data?.sessionId) {
      this.voice.endSession(data.sessionId, 'user_finish');
    }
    this.logger.log('[onDisconnect]');
  }

  /** 客户端消息入口 — 单一入口, 路由到 VoiceService. */
  @SubscribeMessage('message')
  async onMessage(@ConnectedSocket() client: WsWebSocket, @MessageBody() payload: VoiceClientMessage): Promise<void> {
    const data = (client as unknown as { data?: SocketData }).data;
    if (!data?.userId) {
      this.sendJson(client, { type: 'error', error: { code: 'unauthorized', message: 'not initialized', retryable: false } });
      return;
    }
    const send = (msg: VoiceServerMessage): void => {
      this.sendJson(client, msg);
    };
    try {
      await this.voice.handleMessage(
        {
          sessionId: data.sessionId,
          userId: data.userId,
          tenantId: data.tenantId,
          traceId: data.traceId,
        },
        payload,
        send,
      );
    } catch (err) {
      this.logger.error('[onMessage] err=' + (err instanceof Error ? err.message : String(err)));
      send({
        type: 'error',
        error: { code: 'gateway_error', message: 'voice service error', retryable: true },
      });
    }
  }

  // ── private ────────────────────────────────────────────────────

  private sendJson(client: WsWebSocket, msg: VoiceServerMessage): void {
    if (client.readyState !== client.OPEN) return;
    client.send(JSON.stringify(msg));
  }

  private extractSessionId(url: string): string {
    // url 形如 /voice/training/<sid>?token=***
    const m = /\/voice\/training\/([^/?]+)/.exec(url);
    return m && m[1] ? decodeURIComponent(m[1]) : 'default';
  }

  private extractToken(url: string, request: IncomingMessage | undefined): string | null {
    // 优先 query ?token=***
    const m = /[?&]token=([^&]+)/.exec(url);
    if (m && m[1]) return decodeURIComponent(m[1]);
    // 退到 Authorization: Bearer *** 头
    const auth = request?.headers.authorization;
    if (auth && auth.toLowerCase().startsWith('bearer ')) {
      return auth.slice(7).trim();
    }
    return null;
  }

  /**
   * 从 URL query 提取 personaId — V2026-10-09 新增 (Phase 4 Visitor Agent).
   *   URL 形如 /voice/training/<sid>?token=***&personaId=l1_zhang
   *   缺失或空串返回 undefined, VisitorService.openSession 走 findDefault 兜底.
   */
  private extractPersonaId(url: string): string | undefined {
    const m = /[?&]personaId=([^&]+)/.exec(url);
    if (!m || !m[1]) return undefined;
    const decoded = decodeURIComponent(m[1]).trim();
    return decoded.length > 0 ? decoded : undefined;
  }
}
