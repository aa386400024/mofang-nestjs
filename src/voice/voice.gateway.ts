// V2026-10-08 治本 (Voice Gateway WebSocket 端点 — SPEC §9.1):
//   路径: /voice/training (ws upgrade)
//   鉴权: 连接时校验 JWT (url query `?token=***` 或 socket handshake 头),
//     校验通过后注入 socket.data.userId / tenantId / traceId.
//   转发: 客户端消息 → VoiceService.handleMessage, 推流消息 → socket.send.
//
//   V2026-10-23 治本 (v2.0 语音对语音 — 握手扩展, spec §2.1/§2.2):
//     握手 query 新增: templateId / mode / difficulty / style / emotionBaseline /
//     defenseLevel / visitorMode. 全部走 URL (与 personaId 同范式) —— 连接建立即可
//     登记, 不依赖首帧到达顺序, 且值全是短 ASCII.
//     模板校验放在**连接期**: templateId 非空但查不到已上架模板 → error(template_not_found)
//     + close(1008), **不回退默认人物** (回退会让用户以为选的人物生效了).
//
//   V2026-10-26 治本 (音色代理 / 握手扩展, spec §任务 1 / §任务 2):
//     握手 query 新增: voiceId (业务指定音色) / skillCode (专项训练技巧码).
//     - voiceId: 覆盖 env `MINIMAX_TTS_VOICE_ID`; 不在账号可用系统音色内 → 回退 env
//       默认 + warn 日志, **不致命断连** (真正的 1004/2013 留给 TTS 建连阶段归一).
//     - skillCode: `listening / questioning / voice`; 非法值**直接忽略** (不断连).
//     角色来源改为**两条互斥分支**:
//       - 有 templateId → 查到已上架模板则注入; 查不到 → error(template_not_found) + close(1008)
//       - 无 templateId → 走**兜底人设通道** (专项兜底 / 自定义人设来源), **不再**报
//         template_not_found 断连 (老实现把两者混在同一分支, 专项兜底入口被直接断连).
//
//   平台适配: 用 @nestjs/platform-ws (基于 ws 包, 项目已装 8.21.3),
//     不引 socket.io (省 200KB+ 包大小 + 更轻量).
//
//   反双胞胎:
//     - 不用 Socket.IO — @nestjs/platform-ws 更轻
//     - 不在 gateway 里做业务编排 — gateway 只做 transport, 业务在 VoiceService
//     - 不缓存 client 连接 — disconnect 时直接 endSession, 资源清理彻底
//     - 不在 gateway 里查模板表 — 模板数据属 counselor 业务域, 走 VoiceTemplateRegistry 插槽
//
//   如何验证 (由大炮在 Windows 环境手动执行):
//     1. tsc 0 错
//     2. wscat -c "ws://localhost:3000/voice/training/<sid>?token=***<jwt>&templateId=vpt_intimate_avoidance_l1&mode=voice" — 连接成功
//     3. 发 {"type":"user_text","text":"你好"} — 收到 llm_start/llm_text/sentence_start/tts_audio/sentence_end/llm_done/tts_done
//     4. 换一个不存在的 templateId — 收到 error(template_not_found) 且连接被关

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

import { VoiceCatalogRegistry } from './voice-catalog-slot';
import { VoiceFrameRegistry } from './voice-frame-registry';
import { parseVoiceHandshake, resolveVoicePreset } from './voice-handshake';
import { VoiceSessionBridgeRegistry, type VoiceSessionOpenResult } from './voice-session-bridge';
import { VoiceSessionRegistry } from './voice-session-registry';
import type { VoicePersonaChannel, VoiceSessionPreset, VoiceSkillCode, VoiceVisitorCard } from './voice-session.types';
import { VoiceTemplateRegistry } from './voice-template-slot';
import { buildVoiceVisitorCard } from './voice-visitor-card';
import { VoiceService } from './voice.service';
import type { VoiceClientMessage, VoiceServerMessage } from './voice.types';

/**
 * 兜底通道的中性速查卡 (V2026-10-26, spec 任务 1 / 任务 7).
 *
 * 专项兜底 / 自定义人设来源**没有公共人物模板**, 那几个可公开的表层字段 (年龄区间 / 职业 /
 * 主诉 / 风险标签) 无从谈起 —— 所以速查卡**不下发** (前端按"无卡片"渲染), 但落库桥需要一份
 * **可落库的**表层字段 (training_sessions 那些列是 NOT NULL), 用中性缺省占位.
 *
 * 刻意**不**伪造"28-35 岁 / 办公室职员"这类看起来真实的人设: 库里那几列会进督导 prompt,
 * 假人设会污染 AI 对来访者的判断 —— 宁可空着.
 */
const NEUTRAL_VISITOR_CARD: VoiceVisitorCard = {
  templateId: '',
  codename: '来访者',
  ageRange: '',
  ageLowerBound: null,
  occupation: '',
  presentingComplaint: '',
  riskTags: [],
};

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
  /** 会话模式 (text / voice). */
  mode: 'text' | 'voice';
  /** 本场生效的临场参数 (握手时解析并与模板缺省合并). */
  preset: VoiceSessionPreset;
  /**
   * 业务指定的音色 (voice_id) —— 覆盖 env `MINIMAX_TTS_VOICE_ID`.
   *
   * undefined = 走 env 默认 (或模板绑定音色).
   */
  voiceId?: string;
  /** 专项训练技巧码; undefined = 全流程 / 个案 (不聚焦单一技巧). */
  skillCode?: VoiceSkillCode;
  /**
   * 稳定落库 id (training_sessions.id) — V2026-10-26 (spec 任务 1).
   *
   * undefined = 本场未落库 (降级为纯内存会话).
   */
  dbSessionId?: string;
  /** 注销 WS 帧出口的句柄 (连接断开时调). */
  unregisterFrameSink?: () => void;
}

@WebSocketGateway({ path: '/voice/training' })
export class VoiceGateway implements OnGatewayConnection<WsWebSocket>, OnGatewayDisconnect {
  private readonly logger: Logger = new Logger(VoiceGateway.name);
  private readonly voice: VoiceService;
  private readonly jwt: JwtService;
  private readonly config: ConfigService;
  private readonly templates: VoiceTemplateRegistry;
  private readonly sessions: VoiceSessionRegistry;
  private readonly catalog: VoiceCatalogRegistry;
  private readonly bridges: VoiceSessionBridgeRegistry;
  private readonly frames: VoiceFrameRegistry;

  /**
   * @param voice 会话编排
   * @param jwt JWT 校验
   * @param config 全局配置
   * @param templates 公共人物模板解析插槽
   * @param sessions 演练登记
   * @param catalog 账号可用音色查询插槽 (判定握手传入的 voiceId 能不能用)
   * @param bridges vpt 会话落库插槽 (voice → business 方向)
   * @param frames vpt WS 帧出口注册表 (business → voice 方向)
   */
  constructor(
    voice: VoiceService,
    jwt: JwtService,
    config: ConfigService,
    templates: VoiceTemplateRegistry,
    sessions: VoiceSessionRegistry,
    catalog: VoiceCatalogRegistry,
    bridges: VoiceSessionBridgeRegistry,
    frames: VoiceFrameRegistry,
  ) {
    this.voice = voice;
    this.jwt = jwt;
    this.config = config;
    this.templates = templates;
    this.sessions = sessions;
    this.catalog = catalog;
    this.bridges = bridges;
    this.frames = frames;
  }

  /**
   * 连接时鉴权 + 启动 session.
   *   - @nestjs/platform-ws 签名: handleConnection(client, ...args)
   *     - client: ws.WebSocket 实例
   *     - args[0]: 升级请求 (有 URL / headers / auth)
   */
  handleConnection(client: WsWebSocket, ...args: unknown[]): void {
    const request = args[0] as IncomingMessage | undefined;
    // 1. 解析握手 (path sid + query 临场参数)
    const url = request?.url ?? '';
    const handshake = parseVoiceHandshake(url);
    const data: SocketData = {
      sessionId: handshake.sessionId,
      userId: '',
      tenantId: 'default',
      personaId: handshake.personaId,
      mode: handshake.mode,
      // 临时占位: 真正的 preset 在模板解析后回填 (见 verifyAndStart)
      preset: { difficulty: 'L1', style: 'mixed', emotionBaseline: 0.35, defenseLevel: 0.2, visitorMode: 'useMySettings' },
      // V2026-10-09 lint fix (sonarjs/pseudo-random): traceId 仅 6 字符 base36 用来串日志,
      //   非 sessionId / API key 等安全敏感场景, Math.random 足够. 强安全需求改 crypto.randomUUID().
      // eslint-disable-next-line sonarjs/pseudo-random
      traceId: 'vt-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8),
    };
    (client as unknown as { sessionId: string }).sessionId = handshake.sessionId;

    // 2. 提取 JWT
    const token = this.extractToken(url, request);
    if (!token) {
      this.logger.warn('[onConnect] no token, session=' + handshake.sessionId);
      this.sendJson(client, { type: 'error', error: { code: 'unauthorized', message: 'missing token', retryable: false } });
      client.close(1008, 'unauthorized');
      return;
    }
    // 3. 校验 JWT (async, 但 handleConnection 必须 void — 走 fire-and-forget)
    void this.verifyAndStart(client, data, handshake, token);
  }

  /**
   * 校验 JWT → 解析模板 → 登记 → 启动会话.
   *
   * @param client socket
   * @param data socket 上下文
   * @param handshake 握手解析结果
   * @param token JWT
   */
  private async verifyAndStart(
    client: WsWebSocket,
    data: SocketData,
    handshake: ReturnType<typeof parseVoiceHandshake>,
    token: string,
  ): Promise<void> {
    // 1. 校验 JWT (失败已发 error + 断开)
    if (!(await this.verifyJwt(client, data, token))) {
      return;
    }

    // 2. 角色来源通道解析 (连接期):
    //    - 有 templateId → 查到已上架模板则注入; 查不到 → `template_not_found` + 断开 (不回退)
    //    - 无 templateId → 走**兜底人设通道** (专项兜底 / 自定义人设来源), **不再**报
    //      template_not_found (spec §任务 1 §1.1)
    const resolution = await this.resolvePersonaChannel(client, handshake);
    if (!resolution.ok) {
      return;
    }
    const channel = resolution.channel;
    const preset = resolveVoicePreset(handshake, channel.kind === 'template' ? channel.summary : null);
    data.preset = preset;

    // 3. 音色校验 (V2026-10-26, spec §任务 1):
    //   握手带了 voiceId 但不在账号可用系统音色内 → 丢弃它 (回退 env 默认) + warn 日志.
    //   **不致命断连** —— 判不出来 (上游故障) 时也不拦, 交给 TTS 建连阶段归一为 error.
    data.voiceId = await this.resolveVoiceId(handshake.voiceId);
    data.skillCode = handshake.skillCode;

    // 4. 会话落库 + 登记 WS 帧出口
    const visitorCard = this.resolveVisitorCard(channel);
    const opened = await this.openSessionStorage(client, data, channel, preset, handshake, visitorCard);

    // 5. 注入到 client 供后续 message 路由用
    (client as unknown as { data: SocketData }).data = data;

    // 6. 演练登记 (进程内内存, 不落库) — counselor 侧按 sessionId 反查这份登记来注入 vpt 剧本
    this.registerDrill(data, channel, preset, handshake);

    // 7. 启动 session
    if (!(await this.startVoiceSession(client, data, preset, visitorCard))) {
      return;
    }

    this.logger.log(this.describeConnect(data, channel, handshake));

    // 8. 就绪信号 (spec §2.3 帧规则 0 / §7 场景 8): 前置全部成功后才发 `ready`.
    //    前端收到之前不得发 `user_text` —— 否则首条消息会撞上 "not initialized".
    //    前置失败路径已在上面走 error + close, **不发** ready.
    this.sendJson(client, this.buildReadyFrame(visitorCard, opened, data));
  }

  /**
   * 校验 JWT (失败 → 发 error + 断开).
   *
   * 单独拆出来是为了让 `verifyAndStart` 的复杂度回到阈值内 (ESLint complexity 上限 20) ——
   * 拆分的边界按**职责**切 (鉴权 / 落库 / 登记 / 启动 / 发帧), 不是按"凑行数"切.
   *
   * @param client socket
   * @param data socket 上下文 (成功后写入 userId / tenantId)
   * @param token JWT
   * @returns true = 校验通过
   */
  private async verifyJwt(client: WsWebSocket, data: SocketData, token: string): Promise<boolean> {
    try {
      const payload = await this.jwt.verifyAsync<{ sub: string; tenantId?: string }>(token, {
        secret: this.config.getOrThrow<string>('jwtSecret'),
      });
      data.userId = payload.sub;
      data.tenantId = payload.tenantId ?? 'default';
      return true;
    } catch (err) {
      this.logger.warn('[onConnect] jwt verify failed: ' + (err instanceof Error ? err.message : String(err)));
      this.sendJson(client, { type: 'error', error: { code: 'unauthorized', message: 'invalid token', retryable: false } });
      client.close(1008, 'unauthorized');
      return false;
    }
  }

  /**
   * 会话落库 + 登记 WS 帧出口.
   *
   * V2026-10-26 (spec 任务 1 / 任务 2 / 任务 4):
   *   - 落库: vpt 从"纯内存、结束即清"升级成"落 training_sessions 表" —— 督导报告要有稳定
   *     落库 id 可挂、每轮分析要有 transcript 可读、4 流派反馈要有 sessionId 可指.
   *     落库失败**不阻断会话** (降级为纯内存), 但降级状态必须进 `ready` 帧让前端知道.
   *   - 帧出口: 实时轻提示与移情标记产在 counselor 侧 (BullMQ worker), 要经**本条** WS
   *     推给前端. 按**稳定落库 id** 登记 —— worker 只知道 training_sessions.id, 不知道
   *     内存 sessionId.
   *
   * @param client socket
   * @param data socket 上下文
   * @param channel 角色来源通道
   * @param preset 本场临场参数
   * @param handshake 握手解析结果
   * @param visitorCard 来访者速查卡 (无 → null)
   * @returns 落库结果
   */
  private async openSessionStorage(
    client: WsWebSocket,
    data: SocketData,
    channel: VoicePersonaChannel,
    preset: VoiceSessionPreset,
    handshake: ReturnType<typeof parseVoiceHandshake>,
    visitorCard: VoiceVisitorCard | null,
  ): Promise<VoiceSessionOpenResult> {
    const opened = await this.bridges.open({
      sessionId: data.sessionId,
      userId: data.userId,
      tenantId: data.tenantId,
      templateId: channel.kind === 'template' ? channel.templateId : null,
      // 落库桥要的是**可落库的**表层字段, 兜底通道 (专项兜底 / 自定义人设) 没有公共人物,
      // 那几个字段本就无从谈起 → 用中性缺省占位 (training_sessions 那些列是 NOT NULL).
      visitor: visitorCard ?? NEUTRAL_VISITOR_CARD,
      preset,
      skillCode: handshake.skillCode ?? null,
    });
    data.dbSessionId = opened.dbSessionId ?? undefined;

    if (data.dbSessionId) {
      const sessionId = data.dbSessionId;
      data.unregisterFrameSink = this.frames.register(sessionId, (frame) => {
        this.sendJson(client, frame);
      });
    }
    return opened;
  }

  /**
   * 演练登记 (进程内内存, 不落库).
   *
   * counselor 侧按 sessionId 反查这份登记来注入 vpt 剧本.
   *
   * @param data socket 上下文
   * @param channel 角色来源通道
   * @param preset 本场临场参数
   * @param handshake 握手解析结果
   */
  private registerDrill(
    data: SocketData,
    channel: VoicePersonaChannel,
    preset: VoiceSessionPreset,
    handshake: ReturnType<typeof parseVoiceHandshake>,
  ): void {
    this.sessions.register({
      sessionId: data.sessionId,
      userId: data.userId,
      tenantId: data.tenantId,
      mode: data.mode,
      templateId: channel.kind === 'template' ? channel.templateId : null,
      skillCode: handshake.skillCode ?? null,
      preset,
      createdAt: Date.now(),
    });
  }

  /**
   * 启动 voice session (失败 → 发 error + 断开).
   *
   * @param client socket
   * @param data socket 上下文
   * @param preset 本场临场参数
   * @param visitorCard 来访者速查卡 (无 → null)
   * @returns true = 启动成功
   */
  private async startVoiceSession(
    client: WsWebSocket,
    data: SocketData,
    preset: VoiceSessionPreset,
    visitorCard: VoiceVisitorCard | null,
  ): Promise<boolean> {
    try {
      await this.voice.startSession({
        sessionId: data.sessionId,
        userId: data.userId,
        tenantId: data.tenantId,
        traceId: data.traceId,
        personaId: data.personaId,
        mode: data.mode,
        preset,
        voiceId: data.voiceId,
        skillCode: data.skillCode,
        dbSessionId: data.dbSessionId,
        // V2026-10-26 治本 (spec 任务 6 — 报告的人格来源):
        //   vpt 场 AI 扮演的是**公共人物** (晚晴...), 不是 agent 内置 persona ——
        //   把速查卡带进 session, 报告里的人格快照才对得上号.
        visitor: visitorCard ?? undefined,
      });
      return true;
    } catch (err) {
      this.logger.error('[onConnect] start session failed: ' + (err instanceof Error ? err.message : String(err)));
      this.sessions.remove(data.sessionId);
      data.unregisterFrameSink?.();
      this.sendJson(client, {
        type: 'error',
        error: { code: 'session_start_failed', message: '会话启动失败', retryable: true },
      });
      client.close(1011, 'session_start_failed');
      return false;
    }
  }

  /**
   * 连接成功摘要 (日志).
   *
   * @param data socket 上下文
   * @param channel 角色来源通道
   * @param handshake 握手解析结果
   * @returns 日志行
   */
  private describeConnect(data: SocketData, channel: VoicePersonaChannel, handshake: ReturnType<typeof parseVoiceHandshake>): string {
    return (
      `[onConnect] session=${data.sessionId} user=${data.userId} tenant=${data.tenantId} ` +
      `mode=${data.mode} channel=${channel.kind} template=${channel.kind === 'template' ? channel.templateId : '<none>'} ` +
      `skill=${handshake.skillCode ?? '<none>'} voice=${data.voiceId ?? '<env-default>'}`
    );
  }

  /**
   * 构造 `ready` 帧载荷.
   *
   * V2026-10-26: 带上速查卡 (任务 7) + 是否落库 (任务 1) + 稳定落库 id (任务 6).
   * 落库 id 只在落库成功时下发 (降级为纯内存的会话没有报告可取, 别让前端去请求).
   *
   * @param visitorCard 来访者速查卡 (无 → 不带该字段)
   * @param opened 落库结果
   * @param data socket 上下文
   * @returns ready 帧
   */
  private buildReadyFrame(visitorCard: VoiceVisitorCard | null, opened: VoiceSessionOpenResult, data: SocketData): VoiceServerMessage {
    return {
      type: 'ready',
      ...(visitorCard ? { visitor: visitorCard } : {}),
      persisted: opened.persisted,
      ...(data.dbSessionId ? { dbSessionId: data.dbSessionId } : {}),
    };
  }

  /** 断开时清理. */
  handleDisconnect(client: WsWebSocket): void {
    const data = (client as unknown as { data?: SocketData }).data;
    if (data?.sessionId) {
      // V2026-10-26 治本 (spec 任务 1 / 任务 2):
      //   先注销 WS 帧出口 (连接没了, 再推帧就是往死连接写), 再结束会话 (落库收尾).
      data.unregisterFrameSink?.();
      this.voice.endSession(data.sessionId, 'user_finish');
      this.sessions.remove(data.sessionId);
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
          mode: data.mode,
          preset: data.preset,
          voiceId: data.voiceId,
          skillCode: data.skillCode,
          dbSessionId: data.dbSessionId,
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

  /**
   * 解析角色来源通道 (V2026-10-26, spec §任务 1 §1.1).
   *
   * 两条分支的语义**完全不同**, 不能合并:
   * - **有 templateId** → 查到已上架模板就注入; 查不到 → `template_not_found` + 断开,
   *   **不回退** (回退会让用户以为选的人物生效了, 实际演的是另一个人).
   * - **无 templateId** → 走兜底人设通道 (专项兜底 / 自定义人设来源), **不再**报
   *   `template_not_found`. 老实现把两者混在同一个"查不到"分支里, 于是
   *   "专项兜底"这种合法入口会被直接断连 —— 这就是要治的根因.
   *
   * @param client socket (失败时直接报错并断开)
   * @param handshake 握手解析结果
   * @returns ok=true 带通道; ok=false 表示已报错并断开
   */
  private async resolvePersonaChannel(
    client: WsWebSocket,
    handshake: ReturnType<typeof parseVoiceHandshake>,
  ): Promise<{ ok: true; channel: VoicePersonaChannel } | { ok: false }> {
    const templateId = handshake.templateId;
    if (!templateId) {
      // 无 templateId → 兜底人设通道. 本期兜底用 env 默认人物 / 标准陪练;
      // 自定义结构化人涉嫌荷是 P2, 通道已预留 (挂 persona 负载时**不改动**本分支语义).
      return { ok: true, channel: { kind: 'fallback', skillCode: handshake.skillCode ?? null } };
    }
    try {
      const summary = await this.templates.resolve(templateId);
      if (!summary) {
        this.logger.warn(`[onConnect] template not found: ${templateId}`);
        this.sendJson(client, {
          type: 'error',
          error: { code: 'template_not_found', message: '来访人物不存在或已下架', retryable: false },
        });
        client.close(1008, 'template_not_found');
        return { ok: false };
      }
      return { ok: true, channel: { kind: 'template', templateId, summary } };
    } catch (err) {
      this.logger.error('[onConnect] template lookup failed: ' + (err instanceof Error ? err.message : String(err)));
      this.sendJson(client, {
        type: 'error',
        error: { code: 'template_lookup_failed', message: '来访人物查询失败', retryable: true },
      });
      client.close(1011, 'template_lookup_failed');
      return { ok: false };
    }
  }

  /**
   * 构造来访者速查卡 (V2026-10-26, spec 任务 7).
   *
   * 只有**公共人物模板**通道有速查卡 —— 兜底通道 (专项兜底 / 自定义人设) 没有公共人物,
   * 那几个可公开的表层字段 (年龄区间 / 职业 / 主诉 / 风险标签) 无从谈起,
   * 这时返回 null (前端按"无卡片"渲染, 而不是渲染一张空卡).
   *
   * @param channel 角色来源通道
   * @returns 速查卡; 无 → null
   */
  private resolveVisitorCard(channel: VoicePersonaChannel): VoiceVisitorCard | null {
    if (channel.kind !== 'template' || !channel.summary) {
      return null;
    }
    return buildVoiceVisitorCard(channel.summary);
  }

  /**
   * 判定握手传入的音色能不能用 (V2026-10-26, spec §任务 1).
   *
   * 需求原文: 「传入但不在账号可用系统音色内 → 回退 env 默认 + warn 日志, **不致命断连**;
   * 真正的 1004/2013 留到 TTS 建连阶段归一为 error」.
   *
   * 三态处理:
   * - `available`   → 用它
   * - `unavailable` → 丢弃 (回退 env 默认) + warn
   * - `unknown`     → **不拦截**, 继续传下去让 TTS 建连阶段报错 (上游 2013 会归一为 error).
   *   不能在这里当 "unavailable" 处理 —— 上游挂掉时把合法音色误回退成默认音色,
   *   用户选了 A 却听到 B, 且**没有任何报错**, 比直接失败更糟.
   *
   * @param requested 握手传入的 voice_id (undefined = 未传)
   * @returns 本场生效的 voice_id; undefined = 走 env 默认
   */
  private async resolveVoiceId(requested: string | undefined): Promise<string | undefined> {
    if (!requested) {
      return undefined;
    }
    const availability = await this.catalog.check(requested);
    if (availability === 'available') {
      return requested;
    }
    if (availability === 'unavailable') {
      this.logger.warn(`[onConnect] voice not available, fallback to env default: ${requested.slice(0, 64)}`);
      return undefined;
    }
    this.logger.warn(`[onConnect] voice availability unknown, pass through to TTS: ${requested.slice(0, 64)}`);
    return requested;
  }

  /**
   * 发一帧 JSON.
   *
   * @param client socket
   * @param msg 消息
   */
  private sendJson(client: WsWebSocket, msg: VoiceServerMessage): void {
    if (client.readyState !== client.OPEN) return;
    client.send(JSON.stringify(msg));
  }

  /**
   * 提取 JWT (query 优先, 回退 Authorization 头).
   *
   * @param url 原始 URL
   * @param request 升级请求
   * @returns token; 无则 null
   */
  private extractToken(url: string, request: IncomingMessage | undefined): string | null {
    // 优先 query ?token=***
    const matched = /[?&]token=([^&]+)/.exec(url);
    if (matched?.[1]) return decodeURIComponent(matched[1]);
    // 退到 Authorization: Bearer *** 头
    const auth = request?.headers.authorization;
    if (auth && auth.toLowerCase().startsWith('bearer ')) {
      return auth.slice(7).trim();
    }
    return null;
  }
}
