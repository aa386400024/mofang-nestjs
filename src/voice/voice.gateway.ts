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
//   V2026-11-03 治本 (WP26 · §1 安全加固 — 落在 voice 网关的 5 条):
//     P2-1  WS 握手补齐 **token type 校验 + 黑名单查询** (复用 JwtAuthGuard 的口径):
//            已登出 / 已改密的 access token 之前照样能连 WS.
//     P2-2  JWT 改走**握手请求之外**的通道 (?token= 保留兼容兜底):
//            query 里的 token 会落进 nginx access log / Referer / 浏览器历史.
//            现在服务端认两条通道 ——
//              · `handshake.auth.token` (**Socket.IO 标准握手 auth 字段**):
//                `socket.setAuth({ token })` 走 Socket.IO CONNECT 包, 不进 URL,
//                **Socket.IO 客户端走这条** (Flutter 端已在用);
//              · `Sec-WebSocket-Protocol: bearer, <jwt>` 子协议:
//                给**原生 ws 客户端**用 (Socket.IO 客户端不发这个头).
//            ?token= query 保留为老客户端兜底, Flutter 端可以删掉。
//     P2-5  握手写动作全部推到 **鉴权 + 归属校验之后** (复核, 零漏网):
//            归属校验失败时必须零状态写入 (内存 map / 落库桥 / TTS / 演练登记).
//     P2-36 **sessionId 改服务端生成**: 缺省 'default' 让所有不带 ?sessionId= 的
//            客户端共用同一个 key (落库桥 / 演练登记 / 内存会话全串在一起).
//     P2-38 旧 socket 断开加 **socketId 闸门**: 重连竞态下旧 socket 断开会把
//            新 socket 的演练登记一起摘掉.
//
//   反双胞胎 (WP26):
//     - 不自造黑名单存储: 黑名单查询直接用仓库既有的 JwtBlacklistService (与
//       JwtAuthGuard 同一个 Redis key 口径), 免得两套撤销逻辑漂移.
//     - 不强制客户端必须带子协议: 老客户端只有 ?token=, 断掉它们等于把语音链路
//       打死 —— 子协议是**新增**通道, 不是替换通道.
//     - 不在网关里"顺手"改别的模块: 本单只改 gateway, 装配处 (VoiceModule) 的
//       接线在交付说明里列给主线程.
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

import { Logger, Optional } from '@nestjs/common';
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
import { nanoid } from 'nanoid';
import type { Socket } from 'socket.io';
import { WebSocketServer } from 'ws';
import type { ServerOptions as WsServerOptions } from 'ws';

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
import { JwtBlacklistService } from '../user/providers/jwt-blacklist.service.js';
import { TokenType } from '../user/user.constant.js';

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

/**
 * WS 鉴权子协议名 (V2026-11-03, WP26 P2-2).
 *
 * 客户端约定: `Sec-WebSocket-Protocol: bearer, <jwt>`.
 *
 * 为什么单独起一个名字 (而不是直接把 token 当子协议):
 *   子协议值会被**原样回显**在握手响应头里 —— 回显 token 等于把 token 又发了一遍
 *   (落进代理 / 网关 / APM 的响应头日志). 带一个 'bearer' 标记, 服务端只回显
 *   'bearer', token 只在**请求头**里走一趟.
 */
export const WS_AUTH_SUBPROTOCOL = 'bearer';

/**
 * JWT 形状 (三段 base64url, 段内无 '=').
 *
 * 用途: 从子协议列表里认出"哪个值才是 token" —— 客户端可能同时报 'bearer' 标记
 * 和 token, 也可能只报 token. 只认 JWT 形状的值, 别的当噪声忽略.
 */
const JWT_SHAPE = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

/**
 * 解析层给的会话 id 缺省值 (见 voice-handshake.ts).
 *
 * 它是"没传"的占位, 不是"一个具体的会话" —— 所有不带 ?sessionId= 的客户端都会
 * 撞上同一个 key (WP26 P2-36 要治的就是这个).
 */
const DEFAULT_SESSION_ID = 'default';

/**
 * 子协议选择 (V2026-11-03, WP26 P2-2): 客户端报了哪些子协议 → 服务端回显哪个.
 *
 * 为什么必须自己选 (不能吃 ws 的默认值):
 *   ws 的默认行为是**回显客户端报的第一个子协议** —— 客户端要是把 token 放第一位,
 *   响应头 `Sec-WebSocket-Protocol: <jwt>` 就把 token 又发了一遍 (等于没改).
 *
 * 规则 (三级):
 *   ① 报了 'bearer' → 回显 'bearer' (客户端契约: `bearer, <jwt>`) —— token 不回显;
 *   ② 没报 'bearer', 但报了别的**非 token** 值 → 回显它 (ws 客户端要求"客户端报了
 *      子协议, 服务端就必须选一个", 不选它会自己断开 —— 见 ws 的
 *      `Server sent no subprotocol`);
 *   ③ 只报了 token → **一个都不回显**: 回显 token 等于把 token 又发一遍 (WP26 红线).
 *      代价: 严格客户端 (ws) 会以 "Server sent no subprotocol" 中断这次握手 ——
 *      这是"客户端没按契约带 bearer 标记"的明确信号, 比悄悄把 token 回显出去好.
 *      (宽松客户端 —— 例如不带子协议校验的实现 —— 不受影响.)
 *
 * 注意: 客户端**不带**子协议照样能连 (老客户端只有 ?token=) —— 本函数只在客户端
 * 报了子协议时才参与协商.
 *
 * @param protocols 客户端报出的子协议集合
 * @returns 要回显的子协议; false = 不回显任何子协议
 */
export function selectVoiceSubprotocol(protocols: ReadonlySet<string>): string | false {
  if (protocols.has(WS_AUTH_SUBPROTOCOL)) {
    return WS_AUTH_SUBPROTOCOL;
  }
  for (const protocol of protocols) {
    if (!JWT_SHAPE.test(protocol)) {
      return protocol;
    }
  }
  return false;
}

/**
 * 只回显 'bearer' 的 ws 引擎 (V2026-11-03, WP26 P2-2).
 *
 * engine.io 用 `new this.opts.wsEngine({...})` 建 ws 服务 (见 engine.io 的
 * `Server.init()`), 所以把 `handleProtocols` 挂在子类上就能接管子协议协商 ——
 * 不必改 engine.io / socket.io 内部, 也不用改装配处.
 *
 * 导出是为了让回归测试能拿它起一个**真 socket** 服务, 断言握手响应头里
 * 只回显 'bearer' (见 test/voice/wp26-voice-gateway-hardening.spec.ts).
 */
export class VoiceSubprotocolWsServer extends WebSocketServer {
  constructor(options: WsServerOptions) {
    super({
      ...options,
      handleProtocols: (protocols) => selectVoiceSubprotocol(protocols),
    });
  }
}

/**
 * WS 握手要用的 JWT 载荷 (口径对齐 JwtAuthGuard).
 *
 * `type` / `jti` 都可能缺:
 *   · 2026-08-27 之前签发的存量 access token 不带 `type`;
 *   · `auth.service.ts` 那条签发路径不带 `jti` (没法查黑名单, 只能跳过).
 */
interface VoiceJwtPayload {
  readonly sub: string;
  readonly jti?: string;
  readonly type?: string;
  readonly tenantId?: string;
}

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

@WebSocketGateway({
  path: '/voice/training',
  // V2026-11-03 治本 (WP26 P2-2): 自定义 ws 引擎 —— 接管子协议协商, 只回显 'bearer'.
  //   Nest 的 `GatewayMetadata` 把 wsEngine 声明成 string (类型历史包袱), 运行时
  //   engine.io 要的其实是 ws 的 WebSocketServer **类** (它会 `new opts.wsEngine({...})`).
  //   这里的 unknown 桥接只是把那处类型谎言收敛到一行, 不影响运行时行为.
  wsEngine: VoiceSubprotocolWsServer as unknown as string,
})
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
   * JWT 黑名单查询 (V2026-11-03, WP26 P2-1).
   *
   * 用仓库既有的 `JwtBlacklistService` (与 `JwtAuthGuard` 同一个 Redis key 口径) ——
   * 自造一套黑名单存储 = 两套撤销逻辑迟早漂移 (一处登出撤了, 另一处没撤).
   *
   * undefined = 装配处还没把它接进来 (见构造函数的 @Optional 注释).
   */
  private readonly blacklist: JwtBlacklistService | undefined;
  /**
   * "黑名单没装配" 只告警一次 (V2026-11-03, WP26 P2-1).
   *
   * 每条连接都告警一次 = 日志被刷爆, 反而没人看见 —— 一次性告警 + 明确的
   * 处置建议才是有效告警.
   */
  private blacklistMissingWarned = false;
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
   *
   * V2026-11-03 治本 (WP26 P2-38): 这张表同时充当**会话持有者**名册 ——
   *   里面的 socketId 就是"当前持有这场会话的那条 socket", 断连时靠它做闸门.
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
   * @param blacklist JWT 黑名单 (登出 / 改密后 token 失效) — 见类字段说明
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
    /**
     * V2026-11-03 治本 (WP26 P2-1): 黑名单服务用 `@Optional()` 注入.
     *
     * 为什么不是必需依赖:
     *   黑名单服务住在 `UserModule` 里, 而 `VoiceModule` 的装配不在本单改动范围 ——
     *   必需依赖 = 装配没接上时整个服务**起不来**, 等于把一个安全增强变成一次
     *   全站事故. `@Optional()` + 一次性告警 = 装配没接上时降级放行 (可用性优先,
     *   与 `JwtBlacklistService` 自身"Redis 挂了 fail-open"的取舍一致),
     *   同时把"必须补的接线"明确写进告警与交付说明.
     *
     * 装配处补法 (交给主线程, 见交付说明):
     *   `src/voice/voice.module.ts` → `imports: [..., UserModule]`.
     */
    @Optional() blacklist?: JwtBlacklistService,
  ) {
    this.voice = voice;
    this.jwt = jwt;
    this.config = config;
    this.templates = templates;
    this.sessions = sessions;
    this.catalog = catalog;
    this.bridges = bridges;
    this.frames = frames;
    this.blacklist = blacklist;
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
    // V2026-11-03 治本 (WP26 P2-36): 客户端没给 sessionId (或给了缺省值 'default')
    //   → **服务端生成**一个唯一 id.
    //   为什么: 'default' 是解析层的占位, 所有不带 ?sessionId= 的客户端会共用同一个
    //   key —— 落库桥 / 演练登记 / 内存会话全串成一条, 两场对练互相顶替.
    //   注意: 生成出来的 id 从这里开始**贯穿整场** (data.sessionId 是下面所有环节的
    //   唯一来源: 落库桥 / 演练登记 / voice 会话 / 帧出口 / 补漏台账).
    const sessionId = this.resolveSessionId(handshake.sessionId);
    const data: SocketData = {
      sessionId,
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
    client.data.sessionId = sessionId;
    // V2026-11-03 治本 (WP25 · 封版审查): 会话级帧出口的登记**挪到鉴权之后**
    //   (见 verifyAndStart). 原来在这里登记 = 匿名连接只要带个 ?sessionId= 就能顶掉
    //   别人的帧出口, 把人家的实时帧 / 音频改发给自己.
    // V2026-11-03 治本 (WP23): 重连补漏的两个握手参数原样带下去.
    data.lastSeenTurnIndex = handshake.lastSeenTurnIndex;
    data.clientDbSessionId = handshake.dbSessionId;

    // 2. 提取 JWT (子协议优先, 回退 query / Authorization 头)
    const token = this.extractToken(client);
    if (!token) {
      this.logger.warn('[onConnect] no token, session=' + sessionId);
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
   * V2026-11-03 治本 (WP26 P2-36): 决定本场会话 id.
   *
   * 规则:
   *   · 客户端给了**合法** id → 原样用 (兼容 WP23 重连: 客户端拿 `ready.serverSessionId`
   *     回来续同一场, 行为与现在逐字一致);
   *   · 没给 / 给了缺省值 `'default'` → **服务端生成**一个 (nanoid).
   *
   * 为什么 `'default'` 也要重生成:
   *   那是解析层的占位值 (见 voice-handshake.ts), 不是"一个具体的会话" —— 所有不带
   *   `?sessionId=` 的客户端都会撞上同一个 key, 于是两场对练共用一条落库行 / 一份
   *   演练登记 / 一个内存会话, 互相顶替 (P2-36 要治的就是这个).
   *
   * 为什么用 nanoid 而不是 `crypto.randomUUID()`:
   *   · nanoid 是**仓库既有依赖** (内核 in-memory-engine-session / config logger 都在用),
   *     不新增依赖;
   *   · 21 字符 URL-safe (A-Za-z0-9_-), 比 UUID 短一半 —— sessionId 会拼进日志 /
   *     Map key / 下游查询参数, 短 id 在日志里更好读 (UUID 的连字符跟负号混在一起
   *     容易看串);
   *   · 熵 128 bit, 与 uuid v4 的 122 bit 同量级, 撞号概率可忽略.
   *
   * @param clientSessionId 客户端给的会话 id (可能是缺省值 'default')
   * @returns 本场生效的会话 id
   */
  private resolveSessionId(clientSessionId: string): string {
    if (clientSessionId.length > 0 && clientSessionId !== DEFAULT_SESSION_ID) {
      return clientSessionId;
    }
    return nanoid();
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
    //   WP26 P2-5 复核: 这是握手里**第一个**写动作 (内存 map 新增条目), 位置正确 ——
    //   它在「JWT 校验 (1)」与「归属校验 (1.5)」之后.
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
    //   WP26 P2-5 复核: 落库 (bridges.open) 与帧出口登记 (frames.register) 都发生在
    //   「JWT 校验」与「归属校验」之后 —— 归属校验失败时这两处都不会被触发 (零落库行).
    const opened = await this.openSessionStorage(client, data, channel, preset, handshake, visitorCard);

    // 5. 注入到 client 供后续 message 路由用
    //   WP26 P2-5 复核: `client.data` 在校验全过之后才被整体替换 —— 于是断连清理时
    //   "client.data.userId 为空" 仍然精确等于"这条 socket 从没通过校验",
    //   handleDisconnect 的两道闸 (userId + 持有者) 都建立在这一点上.
    client.data = data;

    // 6. 演练登记 (进程内内存, 不落库) — counselor 侧按 sessionId 反查这份登记来注入 vpt 剧本
    //   WP26 P2-5 复核: 演练登记同样在归属校验之后 —— 归属校验失败时演练登记表零新增.
    this.registerDrill(data, channel, preset, handshake);

    // 7. 启动 session
    //   WP26 P2-5 复核: TTS / LLM 会话初始化在最后一步 —— 归属校验失败时 TTS 不会被初始化.
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
   * V2026-11-03 治本 (WP26 P2-1): 这里原来只验签名 —— 已登出 / 已改密的 access token
   *   照样能连 WS (HTTP 侧有 JwtAuthGuard 兜着, WS 侧是**裸的**).
   *   现在补齐两道 (口径复用 `JwtAuthGuard`):
   *     ① token type 必须是 access (refresh token 不许连 WS);
   *     ② jti 不在黑名单里 (登出 / 改密后 token 失效).
   *
   * @param client socket
   * @param data socket 上下文 (成功后写入 userId / tenantId)
   * @param token JWT
   * @returns true = 校验通过
   */
  private async verifyJwt(client: Socket, data: SocketData, token: string): Promise<boolean> {
    let payload: VoiceJwtPayload;
    try {
      payload = await this.jwt.verifyAsync<VoiceJwtPayload>(token, {
        secret: this.config.getOrThrow<string>('jwtSecret'),
      });
    } catch (err) {
      this.logger.warn('[onConnect] jwt verify failed: ' + (err instanceof Error ? err.message : String(err)));
      this.sendJson(client, { type: 'error', error: { code: 'unauthorized', message: 'invalid token', retryable: false } });
      client.disconnect(true);
      return false;
    }

    // ① token type (复用 JwtAuthGuard 的口径: 只有 access token 能当身份凭证用).
    if (!this.isAccessToken(payload)) {
      this.logger.warn(`[onConnect] token type rejected: type=${payload.type ?? '<none>'}`);
      this.sendJson(client, {
        type: 'error',
        error: { code: 'unauthorized', message: 'token 类型错误，需要 access token', retryable: false },
      });
      client.disconnect(true);
      return false;
    }

    // ② 黑名单 (登出 / 改密后 token 已被撤销).
    if (await this.isRevokedToken(payload)) {
      this.logger.warn(`[onConnect] token revoked: jti=${payload.jti ?? '<none>'}`);
      this.sendJson(client, {
        type: 'error',
        error: { code: 'token_revoked', message: '登录状态已失效，请重新登录', retryable: false },
      });
      client.disconnect(true);
      return false;
    }

    data.userId = payload.sub;
    data.tenantId = payload.tenantId ?? 'default';
    return true;
  }

  /**
   * V2026-11-03 治本 (WP26 P2-1): 这个 token 是 access token 吗?
   *
   * 口径对齐 `JwtAuthGuard` (`payload.type !== TokenType.Access` → 拒), 但对
   * **缺 `type`** 的存量 token 放行:
   *   · 2026-08-27 之前签发的 access token 不带 `type` 字段 (那批早就过期了);
   *   · 现在两条签发路径 (`user.service.ts` / `auth.service.ts`) 都带 `type`,
   *     refresh token 一律是 `type='refresh'` —— 那才是真正要挡的.
   * 全量要求 `type === 'access'` = 把没带 type 的老 token 全部拒掉, 而 refresh
   * token 本来就用**另一个 secret** 签 (`jwtRefreshSecret`), 签名校验就已经挡了.
   *
   * @param payload JWT 载荷
   * @returns true = 放行
   */
  private isAccessToken(payload: VoiceJwtPayload): boolean {
    if (payload.type === undefined) return true;
    return payload.type === TokenType.Access;
  }

  /**
   * V2026-11-03 治本 (WP26 P2-1): 这个 token 还在黑名单里吗?
   *
   * 查的是 `JwtBlacklistService` (与 `JwtAuthGuard` 同一个 Redis key 口径) ——
   * 自造一套黑名单存储 = 两套撤销逻辑迟早漂移.
   *
   * 三种"查不了"的情形都**放行** (fail-open, 与 `JwtBlacklistService` 自身
   * "Redis 挂了 fail-open" 的取舍一致 —— 可用性优先, 风险是撤销后有一个短暂窗口):
   *   · token 没有 `jti` (老签发路径不带) → 无从查起;
   *   · 黑名单服务没装配 (VoiceModule 还没接 UserModule) → 一次性告警 + 放行;
   *   · Redis 读失败 → `JwtBlacklistService` 内部已经 fail-open.
   *
   * @param payload JWT 载荷
   * @returns true = 已撤销 (不许连)
   */
  private async isRevokedToken(payload: VoiceJwtPayload): Promise<boolean> {
    const jti = payload.jti;
    if (!jti) return false;
    if (!this.blacklist) {
      if (!this.blacklistMissingWarned) {
        this.blacklistMissingWarned = true;
        this.logger.warn('[onConnect] JWT 黑名单服务未装配 (VoiceModule 需 import UserModule) —— 已撤销的 token 目前仍可连 WS');
      }
      return false;
    }
    return this.blacklist.isRevoked(jti);
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
   * V2026-11-03 治本 (WP26 P2-36): 带上 `serverSessionId` —— **服务端认的**会话 id.
   *   客户端后续重连要带它回来 (否则服务端会当成新会话, WP23 的补漏链路整条断掉);
   *   客户端没传 sessionId 时, 这个值就是服务端新生成的那个.
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
      serverSessionId: data.sessionId,
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
   *
   * V2026-11-03 治本 (WP26 P2-38): 清理前先过**持有者闸门** ——
   *   重连竞态下, 新 socket 已经接管了这场会话, 旧 socket 这时才断开的话, 照旧
   *   清理就会把**新 socket 的**演练登记 / 帧出口一起摘掉 (新客户端当场收不到任何帧,
   *   counselor 侧也反查不到这场演练的模板与临场参数).
   */
  handleDisconnect(client: Socket): void {
    const data = client.data as SocketData | undefined;
    if (data?.sessionId) {
      const sessionId = data.sessionId;
      // 当前持有者 (最新接管这场会话的 socket) 是谁 —— sessionSinks 里记着 socketId.
      const ownerSocketId = this.sessionSinks.get(sessionId)?.socketId;
      // 别人已经接管 → 旧 socket 一律不许碰这场会话的状态.
      const takenOver = ownerSocketId !== undefined && ownerSocketId !== client.id;
      if (takenOver) {
        this.logger.log(`[onDisconnect] session=${sessionId} 已被 socket=${ownerSocketId} 接管, 跳过清理`);
      } else {
        // 只注销**自己**那份出口: 新 socket 可能已经接管了这场会话 (重连),
        //   旧 socket 这时断开还去注销, 会把新出口一起注销掉 —— 重连后收不到任何实时帧.
        if (ownerSocketId === client.id) {
          this.sessionSinks.delete(sessionId);
          data.unregisterFrameSink?.();
        }
        // V2026-11-03 治本 (WP25 · 封版审查): **未通过鉴权的连接不许碰别人的会话**.
        //   client.data.userId 为空 = 这条 socket 从没验过 JWT (它在握手阶段就断了),
        //   而 client.data.sessionId 是**客户端自选**的 —— 不加这道闸, 匿名连接只要带个
        //   ?sessionId=<别人的> 连上再断开, 就能把别人的会话从内存里摘掉 (TTS 被 cancel).
        if (data.userId) {
          this.voice.detachSocket(sessionId);
          this.sessions.remove(sessionId);
        }
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
   * 提取 JWT (V2026-11-03 治本, WP26 P2-2).
   *
   * 优先级:
   *   ① `Sec-WebSocket-Protocol` 子协议 —— token 走**请求头**, 不落 nginx access log /
   *      Referer / 浏览器历史. 给**原生 ws 客户端**用 (Socket.IO 客户端不发这个头).
   *   ② `handshake.auth.token` —— **Socket.IO 标准握手 auth 字段**
   *      (`io(url, { auth: { token } })` / `socket.setAuth({ token })`).
   *      token 走 Socket.IO 的 **CONNECT 包**, 不进 URL query → 同样不进 access log /
   *      Referer / 浏览器历史. **Socket.IO 客户端走这条** (Flutter 端已在用).
   *   ③ `?token=` query (**兼容兜底**) —— dev / 老客户端 (只有这一条传法);
   *      Flutter 端删掉 query 里的 token 后, 这条自然只剩"老客户端兜底"一个用途.
   *   ④ `Authorization: Bearer ***` 头.
   *
   * 为什么 ①② 优先于 ③:
   *   ①② 是**新客户端**的通道, ③ 是兼容通道 —— 同一条连接上两者都带时以 ①② 为准,
   *   免得"query 里那个是旧的、已经撤销的 token"被优先挑中.
   *
   * 为什么 ① 在 ② 之前:
   *   两条通道**互斥** (Socket.IO 客户端不发子协议头, 原生 ws 客户端没有 auth 字段),
   *   谁先谁后都不影响正常路径; 但万一有客户端同时带了两者, 子协议是本单明确定义的
   *   "客户端契约"通道 (`bearer, <jwt>`), 让它优先更符合契约语义.
   *
   * @param client Socket.IO 客户端实例
   * @returns token; 无则 null
   */
  private extractToken(client: Socket): string | null {
    // ① 子协议 (Sec-WebSocket-Protocol: bearer, <jwt>)
    const subprotocolToken = this.readTokenFromSubprotocol(client.handshake.headers['sec-websocket-protocol']);
    if (subprotocolToken) return subprotocolToken;
    // ② Socket.IO 标准握手 auth 字段 (io(url, { auth: { token } }) / socket.setAuth({ token }))
    const authToken = this.readTokenFromAuth(client.handshake.auth);
    if (authToken) return authToken;
    // ③ query ?token=***
    const queryToken = client.handshake.query['token'];
    if (typeof queryToken === 'string' && queryToken.length > 0) {
      return decodeURIComponent(queryToken);
    }
    // ④ Authorization: Bearer *** 头
    const auth = client.handshake.headers.authorization;
    if (auth && auth.toLowerCase().startsWith('bearer ')) {
      return auth.slice(7).trim();
    }
    return null;
  }

  /**
   * 从 Socket.IO 握手的 `auth` 字段里认 token (V2026-11-03, WP26 P2-2 补).
   *
   * **为什么这条通道是 Socket.IO 客户端的正解**:
   *   `socket.io-client` 的 `setAuth({ token })` / `io(url, { auth: { token } })` 把 auth
   *   放在 **Socket.IO CONNECT 包**里, 不进 URL —— 于是 token **不会**落进 nginx access log、
   *   Referer 或浏览器历史, 与 P2-2 "别让 token 走 query" 的目标完全一致.
   *   (反过来说: `Sec-WebSocket-Protocol` 是**原生 ws** 客户端的通道, Socket.IO 客户端
   *   压根不发那个头 —— 只认子协议等于把 Socket.IO 客户端挡在门外.)
   *
   * 为什么只认 `token` 这一个键:
   *   仓库既有约定是 `token` (JwtAuthGuard / admin basic auth 都用这个词), 客户端不用
   *   记第二个键名. 别的键名一律不认 —— 认一堆别名等于给"拼错键名"留后门, 而拼错的后果
   *   是握手失败 (查得到), 不是静默放行.
   *
   * @param auth Socket.IO 握手 auth 对象 (可能是 undefined / 非对象)
   * @returns token; 无则 null
   */
  private readTokenFromAuth(auth: Record<string, unknown> | undefined): string | null {
    if (!auth) return null;
    const raw = auth['token'];
    if (typeof raw !== 'string') return null;
    const trimmed = raw.trim();
    return trimmed.length === 0 ? null : trimmed;
  }

  /**
   * 从 `Sec-WebSocket-Protocol` 头里认 token (V2026-11-03, WP26 P2-2).
   *
   * 客户端约定: `Sec-WebSocket-Protocol: bearer, <jwt>` —— 'bearer' 是标记位,
   * token 是紧随其后的那个值. 只认**JWT 形状**的值 (三段 base64url), 别的当噪声,
   * 于是"客户端只报了 'bearer' 没报 token"这种半吊子握手会自然落到 query 兜底.
   *
   * @param raw 原始请求头 (可能是数组)
   * @returns token; 无则 null
   */
  private readTokenFromSubprotocol(raw: string | string[] | undefined): string | null {
    if (raw === undefined) return null;
    const values = Array.isArray(raw) ? raw : [raw];
    for (const value of values) {
      for (const part of value.split(',')) {
        const candidate = part.trim();
        if (candidate.length === 0) continue;
        // 'bearer' 是标记位, 不是 token.
        if (candidate.toLowerCase() === WS_AUTH_SUBPROTOCOL) continue;
        if (JWT_SHAPE.test(candidate)) return candidate;
      }
    }
    return null;
  }
}
