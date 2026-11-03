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
//   平台适配: V2026-10-30 从 @nestjs/platform-ws 切回 @nestjs/platform-socket.io.
//     原因: 原生 ws 要自己写心跳/重连/断连检测, Socket.IO 开箱即用.
//     语音对练长连接场景, 移动端网络不稳定, 重连和保活是刚需.
//
//   反双胞胎:
//     - 不在 gateway 里做业务编排 — gateway 只做 transport, 业务在 VoiceService
//     - 不缓存 client 连接 — disconnect 时直接 endSession, 资源清理彻底
//     - 不在 gateway 里查模板表 — 模板数据属 counselor 业务域, 走 VoiceTemplateRegistry 插槽
//
//   如何验证 (由大炮在 Windows 环境手动执行):
//     1. tsc 0 错
//     2. 用 socket.io-client 连接: io('http://localhost:3000/voice/training', { query: { token: '<jwt>', sessionId: '<sid>' } })
//     3. 发 { type: 'user_text', text: '你好' } — 收到 llm_start/llm_text/sentence_start/tts_audio/sentence_end/llm_done/tts_done
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
import type { Socket } from 'socket.io';

import { VoiceCatalogRegistry } from './voice-catalog-slot.js';
import { VoiceFrameRegistry } from './voice-frame-registry.js';
import { parseVoiceHandshake, resolveVoicePreset } from './voice-handshake.js';
import { VoiceSessionBridgeRegistry, type VoiceSessionOpenResult } from './voice-session-bridge.js';
import { buildVoiceLimitErrorFrame, VoiceSessionLimitError } from './voice-session-limit.error.js';
import { VoiceSessionRegistry } from './voice-session-registry.js';
import type { VoicePersonaChannel, VoiceSessionPreset, VoiceSkillCode, VoiceVisitorCard } from './voice-session.types.js';
import { VoiceTemplateRegistry } from './voice-template-slot.js';
import { buildVoiceVisitorCard } from './voice-visitor-card.js';
import { VoiceService } from './voice.service.js';
import type { VoiceClientMessage, VoiceServerMessage, VoiceSessionMeta } from './voice.types.js';

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
  /**
   * 轨迹剧本 id (伦理盲盒剧本 key) — V2026-10-30 (WP10).
   *
   * undefined = 本场无剧本约束 (BDI 自由运行, 与现状行为逐字一致).
   */
  trajectoryScriptId?: string;
  /**
   * 跨会话接续来源会话 id (V2026-10-30, WP12).
   *
   * undefined = 新会话 (与现状逐字一致); 有值 = 接续上一场.
   */
  resumeFromSessionId?: string;
  /**
   * V2026-11-03 治本 (WP23): 客户端上次确认收到的最后一轮 (从 1 起; 0 = 一轮都没收到).
   *
   * undefined = 不是重连 (全新会话) → 服务端走 fresh openSession.
   */
  lastSeenTurnIndex?: number;
  /**
   * V2026-11-03 治本 (WP23): 客户端记得的落库 id (进程重启后重建的必需键).
   */
  clientDbSessionId?: string;
  /** 注销 WS 帧出口的句柄 (连接断开时调). */
  unregisterFrameSink?: () => void;
}

/**
 * 帧出口 (一帧 → 客户端).
 */
type FrameSink = (msg: VoiceServerMessage) => void;

@WebSocketGateway({ path: '/voice/training' })
export class VoiceGateway implements OnGatewayConnection<Socket>, OnGatewayDisconnect {
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
   * 会话 id → 当前帧出口 (V2026-11-03, WP23).
   *
   * 为什么是**会话级**而不是"每 socket 一个闭包":
   *   断线瞬间还在跑的 in-flight 轮次, 它手里的 send 若绑死在旧 socket 上,
   *   重连后那一轮的后半段 (llm_text / tts_audio) 就永远送不到客户端 ——
   *   客户端以为"这轮没跑完", 而服务端明明跑完了 (还会把它记进补漏台账).
   *   改成"每次发帧时按 sessionId 查当前出口", 重连后那一轮的后半段自然接到新 socket.
   *
   * 断连时出口被移除 → 帧**丢弃** (不排队、不回放): 断连期间的帧没有接收方,
   *   排队等重连再放 = 服务端替客户端缓存历史 —— 那正是补漏帧的活 (只做一次, 只补文本).
   */
  private readonly sessionSinks = new Map<string, { readonly socketId: string; readonly sink: FrameSink }>();

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
   *   - Socket.IO 签名: handleConnection(client)
   *     - client: Socket 实例, 握手信息在 client.handshake 里
   */
  handleConnection(client: Socket): void {
    // Socket.IO: 握手 URL 和 headers 都在 client.handshake 里
    const url = client.handshake.url ?? '';
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
    client.data.sessionId = handshake.sessionId;
    // V2026-11-03 治本 (WP25 · 封版审查): 会话级帧出口的登记**挪到鉴权之后**
    //   (见 verifyAndStart). 原来在这里登记 = 匿名连接只要带个 ?sessionId= 就能顶掉
    //   别人的帧出口, 把人家的实时帧 / 音频改发给自己.
    // V2026-11-03 治本 (WP23): 重连补漏的两个握手参数原样带下去.
    data.lastSeenTurnIndex = handshake.lastSeenTurnIndex;
    data.clientDbSessionId = handshake.dbSessionId;

    // 2. 提取 JWT (query 优先, 回退 Authorization 头)
    const token = this.extractToken(client);
    if (!token) {
      this.logger.warn('[onConnect] no token, session=' + handshake.sessionId);
      this.sendJson(client, { type: 'error', error: { code: 'unauthorized', message: 'missing token', retryable: false } });
      client.disconnect(true);
      return;
    }
    // 3. 校验 JWT (async, 但 handleConnection 必须 void — 走 fire-and-forget)
    //    ⚠️ 必须挂 .catch(): Node ≥15 对未处理的 promise rejection **直接终止进程** ——
    //      verifyAndStart 里任何一处抛错 (DB 抖动 / 第三方接口抽风 / 未来的新分支忘了兜)
    //      都会把整个服务打挂, 而这只是一条**客户端连接**失败, 不该影响别人.
    void this.verifyAndStart(client, data, handshake, token).catch((err: unknown) => {
      this.logger.error('[onConnect] verifyAndStart crashed: ' + (err instanceof Error ? (err.stack ?? err.message) : String(err)));
      this.sendJson(client, {
        type: 'error',
        error: { code: 'session_start_failed', message: '会话启动失败', retryable: true },
      });
      client.disconnect(true);
    });
  }

  /**
   * V2026-11-03 治本 (WP25 · 封版审查): 这个 sessionId 是不是已经**属于别人**?
   *
   * 判据取**两处**注册表的并集 —— 少查一处就留一个洞:
   *   · voice 层内存会话 (`VoiceService`): 活跃会话带着 `meta.userId`;
   *   · 演练登记 (`VoiceSessionRegistry`): 进程内登记, 断连时清; 但**会话已结束、登记还在**
   *     的窗口里, 只查 voice 内存会漏判 (那时候 memory 里已经没有这场会话了).
   *
   * 为什么要查:
   *   `sessionId` 由客户端在握手 query 里自选 (`?sessionId=<uuid>`), 服务端此前**从不核对**
   *   它属于谁 —— 于是任何登录用户带着别人的 sessionId 连上来就能:
   *     ① 顶掉那场会话 (TTS dispose + LLM abort) —— 对方的对练当场崩;
   *     ② 走重连分支拿到 `session_catchup` 帧 —— 里面是**对方整场咨询对话原文**.
   *
   * @param data socket 上下文 (鉴权后, userId 必有值)
   * @returns true = 该 sessionId 已属于另一个用户
   */
  private isOwnedByOtherUser(data: SocketData): boolean {
    if (this.voice.isSessionOwnedByOtherUser(data.userId, data.sessionId)) return true;
    const drill = this.sessions.find(data.sessionId);
    return drill !== null && drill.userId !== data.userId;
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
    client: Socket,
    data: SocketData,
    handshake: ReturnType<typeof parseVoiceHandshake>,
    token: string,
  ): Promise<void> {
    // 1. 校验 JWT (失败已发 error + 断开)
    if (!(await this.verifyJwt(client, data, token))) {
      return;
    }

    // 1.5 V2026-11-03 治本 (WP25 · 封版审查): 会话归属校验 —— 放在**任何写动作之前**.
    //   判据: 这个 sessionId 是不是已经属于别人.
    //   为什么不能等到 startSession 才判: 落库 / 演练登记 / 帧出口接管都发生在那之前 ——
    //   等到那时才拒, 攻击者已经写了一条落库行、顶掉了别人的帧出口.
    if (this.isOwnedByOtherUser(data)) {
      this.logger.warn(`[onConnect] session=${data.sessionId} 已属于他人, 拒绝接管 (user=${data.userId})`);
      this.sendJson(client, {
        type: 'error',
        error: { code: 'session_owned_by_other_user', message: '该会话标识已被他人占用，请换一个', retryable: false },
      });
      client.disconnect(true);
      return;
    }

    // 1.6 V2026-11-03 治本 (WP23): 会话级帧出口 —— 新 socket 接管这场会话的出口.
    //   (旧 socket 的出口在它自己断开时被移除 —— 见 handleDisconnect 的 socketId 比对.)
    //   WP25: 登记放在鉴权**之后** —— 匿名连接不许顶掉别人的出口.
    this.sessionSinks.set(data.sessionId, { socketId: client.id, sink: (msg) => this.sendJson(client, msg) });

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

    // 3. 音色校验 (V2026-10-26, spec §任务 1; V2026-10-27 治本: 补「模板绑定音色」优先级):
    //   优先级: 握手 voiceId > 模板绑定音色 > env 默认.
    //   握手带了 voiceId 但不在账号可用系统音色内 → 丢弃它 (回退**下一级**) + warn 日志.
    //   **不致命断连** —— 判不出来 (上游故障) 时也不拦, 交给 TTS 建连阶段归一为 error.
    data.voiceId = await this.resolveVoiceId(handshake.voiceId, this.resolveTemplateVoiceId(channel));
    data.skillCode = handshake.skillCode;
    // V2026-10-30 治本 (WP10): 轨迹剧本 id 原样透传 —— gateway 不判断剧本是否存在,
    //   也不认识剧本内容 (那两件事归引擎侧的剧本解析器).
    data.trajectoryScriptId = handshake.scriptId;
    // V2026-10-30 治本 (WP12): 跨会话接续来源 id 原样透传 —— gateway 不判断上一场
    //   在不在 (那是运行时的事, 查不到由引擎侧 warn + 回退新会话).
    data.resumeFromSessionId = handshake.resumeFromSessionId;

    // V2026-11-03 治本 (WP23): 重连分支.
    //   判据: 握手带了 `lastSeenTurnIndex` → 客户端认为自己在重连.
    //   两条路径由 voice 层判 (它才知道内存里有没有这场会话):
    //     · 内存命中 → 绑回原会话, 从引擎侧补漏台账补漏;
    //     · 内存没命中 → 走 WP12 重建, 从持久化补漏.
    //   gateway 只负责 transport: 把 socket 接上、把补漏帧推出去.
    const visitorCard = this.resolveVisitorCard(channel);
    let staleFrame: VoiceServerMessage | null = null;
    if (handshake.lastSeenTurnIndex !== undefined) {
      const reconnect = await this.handleReconnect(client, data, handshake, preset, visitorCard, channel);
      if (reconnect.handled) return;
      // 会话不可续 → 落到下面的 fresh 开场流程, 收尾时补推 stale 帧.
      //   帧留在**局部变量**里 (不写实例字段): gateway 单进程多连接, 写实例字段
      //   会让两个并发连接互相覆盖对方的帧.
      staleFrame = reconnect.frame;
    }

    // 4. 会话落库 + 登记 WS 帧出口
    const opened = await this.openSessionStorage(client, data, channel, preset, handshake, visitorCard);

    // 5. 注入到 client 供后续 message 路由用
    client.data = data;

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
    // V2026-11-03 (WP23): fresh 开场后补推 stale 帧 —— 让客户端知道"上一场接不上了".
    //   放在 ready **之后**: 客户端得先知道新会话的 ready (落库 id 等), 才知道自己该重新开始.
    if (staleFrame) this.sendJson(client, staleFrame);
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
  private async verifyJwt(client: Socket, data: SocketData, token: string): Promise<boolean> {
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
      client.disconnect(true);
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
    client: Socket,
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

    // 帧出口按**落库 id** 登记 (worker 侧只知道 training_sessions.id).
    //   ⚠️ 刻意**不**额外登记 WS 会话 id: 那把 id 是**客户端给的**, 客户端可以
    //   故意填成别人的落库 id, 于是"A 会话的帧被推给 B 会话" —— 那是隐私事故.
    this.registerFrameSink(client, data);
    return opened;
  }

  /**
   * 登记 WS 帧出口 (按落库 id).
   *
   * 抽成独立方法: **重连时也要重新登记** (断连时注销过) —— 两处共用一份口径,
   * 两份口径迟早漂移 (一处按落库 id, 另一处按会话 id).
   *
   * @param client socket
   * @param data socket 上下文 (需带 dbSessionId)
   */
  private registerFrameSink(client: Socket, data: SocketData): void {
    if (!data.dbSessionId) return;
    const sessionId = data.dbSessionId;
    data.unregisterFrameSink = this.frames.register(sessionId, (frame) => {
      this.sendJson(client, frame);
    });
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
    client: Socket,
    data: SocketData,
    preset: VoiceSessionPreset,
    visitorCard: VoiceVisitorCard | null,
  ): Promise<boolean> {
    try {
      await this.voice.startSession(this.buildSessionMeta(data, preset, visitorCard));
      return true;
    } catch (err) {
      // WP22: 会话闸门 (并发上限 / 当日 token 预算) 拦下 ——
      //   发**专属** error 帧 (带自己的 code 与可读文案), 不走通用
      //   `session_start_failed` —— 前端要能区分"你已经有了一场"和"额度用完了",
      //   这两件事给用户的下一步完全不同.
      if (err instanceof VoiceSessionLimitError) {
        this.logger.warn(`[onConnect] session rejected by limit: code=${err.code} session=${data.sessionId} user=${data.userId}`);
        this.sessions.remove(data.sessionId);
        data.unregisterFrameSink?.();
        this.sendJson(client, buildVoiceLimitErrorFrame(err));
        client.disconnect(true);
        return false;
      }
      this.logger.error('[onConnect] start session failed: ' + (err instanceof Error ? err.message : String(err)));
      this.sessions.remove(data.sessionId);
      data.unregisterFrameSink?.();
      this.sendJson(client, {
        type: 'error',
        error: { code: 'session_start_failed', message: '会话启动失败', retryable: true },
      });
      client.disconnect(true);
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
      `skill=${handshake.skillCode ?? '<none>'} voice=${data.voiceId ?? '<env-default>'} ` +
      `script=${handshake.scriptId ?? '<none>'}`
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

  /**
   * V2026-11-03 治本 (WP23): 重连分支.
   *
   * 两条路径 (由 **voice 层**判定并执行 —— 它才知道内存里有没有这场会话):
   *   · 路径 1 (内存命中): 绑回原会话 → 从引擎侧补漏台账补漏;
   *   · 路径 2 (进程重启过): 走 WP12 `resumeFromSessionId` 重建 → 从持久化补漏.
   *
   * gateway 在这里只做三件 **transport** 的事 (任务单 §2 红线: 不在 gateway 里加业务编排):
   *   ① 把新 socket 接上这场会话 (帧出口按落库 id 重新登记);
   *   ② 发 `ready` (客户端要先知道 ready 才能继续发 user_text);
   *   ③ 把补漏帧推出去 (`session_catchup` / `session_reattached` / `session_stale`).
   *
   * 不做什么:
   *   · **不重新落库** —— 复用原落库 id (新建行 = 同一场会谈在库里裂成两场,
   *     督导报告 / 4 流派反馈全挂到空的那场);
   *   · **不重新初始化角色基线 / 不重跑 BDI** (路径 1 的会话对象还活着, 状态就在内存里).
   *
   * @param client socket
   * @param data socket 上下文
   * @param handshake 握手解析结果
   * @param preset 本场临场参数
   * @param visitorCard 来访者速查卡
   * @param channel 角色来源通道
   * @returns handled=true → 这条连接已收尾 (ready + 补漏帧都推完了);
   *          handled=false → 会话不可续 → 调用方走 fresh 开场流程 (并补推 stale 帧)
   */
  private async handleReconnect(
    client: Socket,
    data: SocketData,
    handshake: ReturnType<typeof parseVoiceHandshake>,
    preset: VoiceSessionPreset,
    visitorCard: VoiceVisitorCard | null,
    channel: VoicePersonaChannel,
  ): Promise<{ handled: boolean; frame: VoiceServerMessage | null }> {
    const outcome = await this.voice.reconnectSession({
      meta: this.buildSessionMeta(data, preset, visitorCard),
      lastSeenTurnIndex: handshake.lastSeenTurnIndex ?? 0,
      ...(handshake.dbSessionId ? { dbSessionId: handshake.dbSessionId } : {}),
    });
    if (!outcome.ready) {
      // 会话不可续 (落库会话不存在 / 不属于该学员) → 交给调用方走 fresh 流程.
      return { handled: false, frame: outcome.frame };
    }

    // 复用落库 id (不新建行) + 重新登记帧出口 (断连时注销过).
    data.dbSessionId = outcome.dbSessionId;
    this.registerFrameSink(client, data);
    client.data = data;
    // 演练登记: 断连时移除过, 这里重建 (counselor 侧按 sessionId 反查它注入 vpt 剧本).
    this.registerDrill(data, channel, preset, handshake);

    this.logger.log(
      outcome.path === 'reattached'
        ? `[onConnect] reattached session=${data.sessionId}, catchup turns=${outcome.missedTurnCount}`
        : `[onConnect] session=${data.sessionId} not in memory, reconstructing via WP12 resume`,
    );
    if (outcome.frame?.type === 'session_stale' && outcome.frame.reason === 'too_far_behind') {
      this.logger.warn(`[onConnect] session=${data.sessionId} too far behind (missed=${outcome.missedTurnCount}), sending session_stale`);
    }

    this.sendJson(
      client,
      this.buildReadyFrame(visitorCard, { persisted: data.dbSessionId !== undefined, dbSessionId: data.dbSessionId ?? null }, data),
    );
    if (outcome.frame) this.sendJson(client, outcome.frame);
    return { handled: true, frame: null };
  }

  /**
   * 构造会话 meta (voice 层入参).
   *
   * 抽成独立方法: **重连与开场共用同一份口径** —— 两处各写一份, 迟早有一处漏字段
   * (漏的正是 `dbSessionId` / `resumeFromSessionId` 这种"少一个就静默降级"的字段).
   *
   * @param data socket 上下文
   * @param preset 本场临场参数
   * @param visitorCard 来访者速查卡
   * @returns 会话 meta
   */
  private buildSessionMeta(data: SocketData, preset: VoiceSessionPreset, visitorCard: VoiceVisitorCard | null): VoiceSessionMeta {
    return {
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
      trajectoryScriptId: data.trajectoryScriptId,
      resumeFromSessionId: data.resumeFromSessionId,
      // V2026-10-26 治本 (spec 任务 6 — 报告的人格来源):
      //   vpt 场 AI 扮演的是**公共人物** (晚晴...), 不是 agent 内置 persona ——
      //   把速查卡带进 session, 报告里的人格快照才对得上号.
      visitor: visitorCard ?? undefined,
    };
  }

  /**
   * 断开时清理.
   *
   * V2026-11-03 治本 (WP23 §1.1): **断线不杀会话** ——
   *   ❌ 不 endSession (BDI / 情绪 / 阻抗 / 信任全清, 用户网抖一下整场报废);
   *   ❌ 不删内存会话;
   *   ❌ 不挂任何判死定时器 (那是游戏式妥协, 本单明确放弃).
   *   ✅ 会话留在内存里, in-flight 的 LLM 渲染让它自然跑完;
   *   ✅ 客户端重连时带 `lastSeenTurnIndex` 回来, 服务端把漏的轮次补给它.
   *
   * 仍然要做的: 注销帧出口 (往死连接推帧没有意义) + 演练登记 (那是**演练元数据**,
   *   不是会话状态; 重连时会重建 —— 留着只是泄漏).
   */
  handleDisconnect(client: Socket): void {
    const data = client.data as SocketData | undefined;
    if (data?.sessionId) {
      // 只注销**自己**那份出口: 新 socket 可能已经接管了这场会话 (重连),
      //   旧 socket 这时断开还去注销, 会把新出口一起注销掉 —— 重连后收不到任何实时帧.
      if (this.sessionSinks.get(data.sessionId)?.socketId === client.id) {
        this.sessionSinks.delete(data.sessionId);
        data.unregisterFrameSink?.();
      }
      // V2026-11-03 治本 (WP25 · 封版审查): **未通过鉴权的连接不许碰别人的会话**.
      //   client.data.userId 为空 = 这条 socket 从没验过 JWT (它在握手阶段就断了),
      //   而 client.data.sessionId 是**客户端自选**的 —— 不加这道闸, 匿名连接只要带个
      //   ?sessionId=<别人的> 连上再断开, 就能把别人的会话从内存里摘掉 (TTS 被 cancel).
      if (data.userId) {
        this.voice.detachSocket(data.sessionId);
        this.sessions.remove(data.sessionId);
      }
    }
    this.logger.log('[onDisconnect]');
  }

  /** 客户端消息入口 — 单一入口, 路由到 VoiceService. */
  @SubscribeMessage('message')
  async onMessage(@ConnectedSocket() client: Socket, @MessageBody() payload: VoiceClientMessage): Promise<void> {
    const data = client.data as SocketData | undefined;
    if (!data?.userId) {
      this.sendJson(client, { type: 'error', error: { code: 'unauthorized', message: 'not initialized', retryable: false } });
      return;
    }
    const send = this.sessionSender(data.sessionId);
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
   * 会话级帧出口 (V2026-11-03, WP23).
   *
   * 每次发帧时按 sessionId 查**当前**出口 —— 于是:
   *   · 重连后, 断线瞬间还在跑的那一轮的后半段, 自然接到新 socket;
   *   · 断连期间没有出口 → 帧**丢弃** (不排队、不回放: 排队等重连再放 =
   *     服务端替客户端缓存历史, 那正是补漏帧的活, 而且只做一次).
   *
   * @param sessionId 会话 id
   * @returns 帧发送函数
   */
  private sessionSender(sessionId: string): FrameSink {
    return (msg: VoiceServerMessage): void => {
      const entry = this.sessionSinks.get(sessionId);
      if (!entry) return;
      entry.sink(msg);
    };
  }

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
    client: Socket,
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
        client.disconnect(true);
        return { ok: false };
      }
      return { ok: true, channel: { kind: 'template', templateId, summary } };
    } catch (err) {
      this.logger.error('[onConnect] template lookup failed: ' + (err instanceof Error ? err.message : String(err)));
      this.sendJson(client, {
        type: 'error',
        error: { code: 'template_lookup_failed', message: '来访人物查询失败', retryable: true },
      });
      client.disconnect(true);
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
   * 判定本场用哪个音色 (V2026-10-27 治本: 补「模板绑定音色」优先级).
   *
   * 优先级链 (任务单 A3):
   *   1. **握手 voiceId** (用户显式选择) —— 优先级最高, 但仍要过账号可用音色目录校验
   *   2. **模板绑定音色** (公共人物各配一个音色, 避免 6 个人物共用 env 同一把嗓子)
   *   3. **env 默认** (`MINIMAX_TTS_VOICE_ID`)
   *
   * 三态处理 (与改前一致, 只是多了一个候选):
   * - `available`   → 用它
   * - `unavailable` → 丢弃 (回退**下一级**) + warn
   * - `unknown`     → **不拦截**, 继续传下去让 TTS 建连阶段报错 (上游 2013 会归一为 error).
   *   不能在这里当 "unavailable" 处理 —— 上游挂掉时把合法音色误回退成默认音色,
   *   用户选了 A 却听到 B, 且**没有任何报错**, 比直接失败更糟.
   *
   * 反双胞胎:
   * - 不把「模板音色」当成强约束: 它绑不上 / 不可用时回退 env, **不致命断连**
   *   (老行 voice_id 为 NULL 时行为与改前完全一致)
   * - 不用「握手传了就一定用它」: 握手音色同样要过目录校验, 不可用时才有 warn + 回退
   *
   * @param requested 握手传入的 voice_id (undefined = 未传)
   * @param templateVoiceId 模板绑定音色 (undefined = 该人物未绑定)
   * @returns 本场生效的 voice_id; undefined = 走 env 默认
   */
  private async resolveVoiceId(requested: string | undefined, templateVoiceId: string | undefined): Promise<string | undefined> {
    // 1. 握手显式传了 → 以用户选择为准 (不可用时才落到模板).
    if (requested) {
      const resolved = await this.resolveCandidateVoiceId(requested, 'handshake');
      if (resolved !== undefined) {
        return resolved;
      }
    }
    // 2. 模板绑定音色 (公共人物各配一个, 声线不再千篇一律).
    if (templateVoiceId) {
      const resolved = await this.resolveCandidateVoiceId(templateVoiceId, 'template');
      if (resolved !== undefined) {
        return resolved;
      }
    }
    // 3. env 默认.
    return undefined;
  }

  /**
   * 判定单个候选音色能不能用 (三态, 与改前语义一致).
   *
   * @param candidate 候选 voice_id
   * @param source 候选来源 (日志用: handshake = 用户选的 / template = 人物绑定的)
   * @returns 该候选可用则返回它; 不可用则 undefined (调用方回退下一级)
   */
  private async resolveCandidateVoiceId(candidate: string, source: 'handshake' | 'template'): Promise<string | undefined> {
    const availability = await this.catalog.check(candidate);
    if (availability === 'available') {
      return candidate;
    }
    if (availability === 'unavailable') {
      this.logger.warn(`[onConnect] ${source} voice not available, fallback: ${candidate.slice(0, 64)}`);
      return undefined;
    }
    this.logger.warn(`[onConnect] ${source} voice availability unknown, pass through to TTS: ${candidate.slice(0, 64)}`);
    return candidate;
  }

  /**
   * 从角色来源通道取模板绑定音色 (V2026-10-27 治本).
   *
   * 只在 `kind === 'template'` 时有 (兜底通道没有模板); 摘要缺失 / 未绑定 / 空串 → undefined.
   *
   * @param channel 角色来源通道
   * @returns 模板绑定的 voice_id (undefined = 未绑定)
   */
  private resolveTemplateVoiceId(channel: VoicePersonaChannel): string | undefined {
    if (channel.kind !== 'template') {
      return undefined;
    }
    const voiceId = channel.summary?.voiceId;
    if (typeof voiceId !== 'string') {
      return undefined;
    }
    const trimmed = voiceId.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }

  /**
   * 发一帧 JSON.
   *
   * @param client socket
   * @param msg 消息
   */
  private sendJson(client: Socket, msg: VoiceServerMessage): void {
    // Socket.IO: emit 直接传对象, 不需要 JSON.stringify.
    // 连接断了 emit 自动被忽略, 不需要手动检查 readyState.
    client.emit('message', msg);
  }

  /**
   * 提取 JWT (query 优先, 回退 Authorization 头).
   *
   * @param client Socket.IO 客户端实例
   * @returns token; 无则 null
   */
  private extractToken(client: Socket): string | null {
    // 优先 query ?token=***
    const queryToken = client.handshake.query['token'];
    if (typeof queryToken === 'string' && queryToken.length > 0) {
      return decodeURIComponent(queryToken);
    }
    // 退到 Authorization: Bearer *** 头
    const auth = client.handshake.headers.authorization;
    if (auth && auth.toLowerCase().startsWith('bearer ')) {
      return auth.slice(7).trim();
    }
    return null;
  }
}
