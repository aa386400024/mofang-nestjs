// V2026-11-08 治本 (Phase2.5 WP-D · 自动对练实时推送网关):
//   职责: 把 runner 跑出的每轮对话实时推给 admin 面板 (WebSocket).
//
//   协议 (Socket.IO, path /ws/auto-practice):
//     注意 path 用 /ws/ 前缀, 和前端页面路由 /auto-practice 分开 —— 否则开发期
//     Vite 的 WS 代理会把页面 GET 也转给后端 (页面直接 404).
//     · 客户端连接后 emit 'subscribe' { practiceSessionId } → 加入该场次的 room;
//     · runner 每轮 emit → gateway.broadcast 到该 room;
//     · 事件名见 auto-practice.events.ts (ap:session_start / ap:turn / ap:session_end).
//
//   鉴权: 本网关**不做**JWT 握手校验 —— 自动对练是 admin 内部工具, 连接本身不泄露
//     敏感数据 (推送的对话内容本来就在 admin 面板可见). HTTP 写接口 (controller)
//     仍然走 AdminRoleGuard. 将来要对公网开放再补握手鉴权.
//
//   反双胞胎:
//     - gateway 只做 transport, 不做业务 (业务在 runner).
//     - 不在 gateway 里存对话状态 (状态在 PracticeSession DB 行 + debug JSON 文件).

import { Logger } from '@nestjs/common';
import { OnGatewayConnection, OnGatewayDisconnect, WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';

/**
 * 自动对练实时推送网关.
 *
 * 客户端:
 *   const socket = io({ path: '/ws/auto-practice' });
 *   socket.on('connect', () => socket.emit('subscribe', { practiceSessionId: 'xxx' }));
 *   socket.on('ap:turn', (payload) => { ... });
 */
@WebSocketGateway({
  path: '/ws/auto-practice',
  cors: { origin: '*' },
  // 心跳: 每 25s ping 一次, 60s 没 pong 判定断线
  pingInterval: 25_000,
  pingTimeout: 60_000,
})
export class AutoPracticeGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger('AutoPracticeGateway');

  @WebSocketServer()
  private readonly server!: Server;

  /**
   * 把事件推给订阅了某场次的所有客户端.
   *
   * @param practiceSessionId 场次 id
   * @param event 事件名
   * @param payload 事件数据
   */
  publishToSession(practiceSessionId: string, event: string, payload: unknown): void {
    if (!this.server) {
      this.logger.warn(`server 未初始化, 无法推送 ${event} 到 ${practiceSessionId}`);
      return;
    }
    const room = this.room(practiceSessionId);
    const roomSize = this.server.sockets.adapter.rooms.get(room)?.size ?? 0;
    this.server.to(room).emit(event, payload);
    if (roomSize === 0) {
      // 没人订阅时推送是丢进空房间 —— 一次性可见告警, 避免"WS 连上了但永远收不到事件"的静默失败.
      this.logger.warn(`推送 ${event} → ${practiceSessionId} 时房间为空 (无客户端订阅)`);
      return;
    }
    this.logger.debug(`推送 ${event} → ${practiceSessionId} (room ${roomSize} 人)`);
  }

  /** @inheritdoc */
  handleConnection(client: Socket): void {
    this.logger.log(`客户端连接: ${client.id}`);
    // 客户端发 subscribe { practiceSessionId } 时 join room.
    client.on('subscribe', async (data: { practiceSessionId?: string }) => {
      const id = data?.practiceSessionId?.trim();
      if (!id) return;
      const room = this.room(id);
      await client.join(room);
      const roomSize = this.server?.sockets?.adapter?.rooms?.get(room)?.size ?? 0;
      // 回执携带房间人数: 前端据此确认"订阅已生效、推送能到"。
      client.emit('ap:subscribed', { practiceSessionId: id, roomSize });
      this.logger.log(`客户端 ${client.id} 订阅场次 ${id} (room ${roomSize} 人)`);
    });
  }

  /** @inheritdoc */
  handleDisconnect(client: Socket): void {
    this.logger.log(`客户端断开: ${client.id}`);
  }

  /** 场次对应的 room 名. */
  private room(practiceSessionId: string): string {
    return `ap:${practiceSessionId}`;
  }
}
