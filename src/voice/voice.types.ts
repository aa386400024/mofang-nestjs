// V2026-10-23 治本 (Voice Gateway WS 协议类型 — spec §2.2/§2.3):
//   变化 (相对 V2026-10-08 旧版):
//     ① 音频从"服务端 binary PCM 帧"改为"**句级完整 mp3** (base64, JSON 帧内)" ——
//        前端 just_audio 直接播完整句, web / native 双端最稳, 且前端不需要拼 mp3 帧
//     ② 新增 `sentence_start` / `tts_audio` / `sentence_end` 三帧, 让前端能按句
//        高亮字幕 + 排队播报
//     ③ `tts_cancelled` → 通用 `cancelled` (纯文字模式没有 TTS, 回 tts_cancelled 是语义误导)
//     ④ 删掉 `tts_start` (无信息量: 一句音频到达就说明 TTS 已经启动)
//   客户端 → 服务端消息不变 (user_text / user_speaking / session_finish).
//
//   反双胞胎:
//     - 不用 GraphQL subscription: 实时语音场景 REST/GraphQL 复杂, WS 一阶消息最简
//     - 不用 MsgPack / Protobuf: 纯 JSON 帧足够, 调试直接看文本
//     - V2026-10-30: 从原生 ws 切回 Socket.IO (见 voice.gateway.ts 的注释)

import type { StudentRiskAuditChoice } from './student-risk-audit-slot.js';
import type { VoiceSessionMode, VoiceSessionPreset, VoiceSkillCode, VoiceVisitorCard } from './voice-session.types.js';

/**
 * 客户端 → 服务端消息.
 *
 * V2026-10-26 增量 (spec 任务 5): 新增 `session_pause` / `session_resume` 两个**控制帧**.
 * 语义是"挂起"不是"中断" —— 暂停不清 transcript、不 abort 会话、不断 WS.
 */
export type VoiceClientMessage =
  | {
      readonly type: 'user_text';
      readonly text: string;
      readonly generation?: number;
      /**
       * 轮次号 (V2026-11-02, WP16 · 幂等键).
       *
       * 语义: 客户端给这一轮编的号. 后端凭它认出"这是同一轮的重发" ——
       * 同一会话同一 round_id 重发时, 后端**不重跑 BDI** (阻抗 / 情绪 / 信任不再二次跳变),
       * 而是复用上一轮的结果.
       *
       * 缺省 = 客户端没给号 → 后端不走幂等 (行为与 WP16 之前逐字一致, 老客户端零影响).
       *
       * 收到 `turn_incomplete` 错误码时, 客户端应当 **round_id + 1** 重发新一轮:
       * 那一轮的状态已经提交、但回复没发完, 重发同一号只会再撞一次.
       */
      readonly roundId?: number;
    }
  | { readonly type: 'user_speaking' }
  | { readonly type: 'session_finish' }
  /** 主动暂停: 挂起 LLM / TTS, 保留会话与逐字稿, 不断连. */
  | { readonly type: 'session_pause' }
  /** 恢复: 从挂起点继续, 状态回待命. */
  | { readonly type: 'session_resume' }
  /**
   * 危机弹窗后的选择回写 (V2026-11-02, WP14 §1.3).
   *
   * 学员在 `crisis_modal` 上点了哪个按钮. **只**用来回写审计表的 `user_choice`
   * (那张表唯一允许 update 的列), 不改变会话状态、不重置任何东西 ——
   * 学员点"继续"之后这场对练照常往下走.
   */
  | { readonly type: 'crisis_resume'; readonly choice: StudentRiskAuditChoice };

/**
 * 会话结束时的报告状态 (业务侧派生, V2026-10-27 spec 任务 B).
 *
 * 为什么要放在 voice 层: `session_ended` 帧要带上它, 而帧类型定义在 voice 层;
 * 但**判定口径在业务侧** (counselor 的 domain 层) —— voice 层只声明"有这么个字段",
 * 不复制判定逻辑 (跟 `VoiceSessionBridge` 插槽同一思路: 依赖倒置).
 *
 * 取值与 counselor 的 `SessionReportStatus` 对齐 (多一档 'none' = 不会有报告):
 *   - `no_content`: 这场没有足够的对话内容 → 报告**永远不会**生成 (前端不进轮询页)
 *   - `pending`    : 正常在生成
 *   - `completed`  : 已生成
 *   - `parse_error`: 生成失败 (可重试)
 *   - `none`       : 这条会话不会有报告 (未结束 / 中断)
 */
export type VoiceSessionReportStatus = 'completed' | 'pending' | 'parse_error' | 'no_content' | 'none';

/**
 * 补漏帧里的一轮 (V2026-11-03, WP23).
 *
 * 形状来源: **引擎侧已提交轮次台账** (内存命中时) 或 **持久化逐字稿 + trace**
 * (进程重启后重建时). 两侧口径必须一致 —— 否则同一场会话在"重连"与"重启后重连"
 * 两种路径下补出来的内容形状不同, 客户端要写两套解析.
 */
export interface VoiceCatchUpTurn {
  /** 本场第几轮 (从 1 起). */
  readonly turnIndex: number;
  /** 咨询师这一轮说的话. */
  readonly userText: string;
  /** 来访者这一轮的回应 (最终文本; 没有则空串). */
  readonly replyText: string;
  /**
   * 本轮 BDI 快照.
   *
   * 形状**逐字沿用 WP19-R 的调试快照契约** (`turn_debug_trace` 里那份):
   * `{ trust, valence, arousal, resistance, anxiousSecure }`.
   *
   * 为什么不用别的形状: 那份契约已经被调试器 SPA 与报告页依赖, 是**持久化口径**;
   * 另造第三套 BDI 快照形状必然漂移 (三套形状迟早有两套对不上).
   *
   * 缺省 = 这一轮没有快照 (降级轮 / 留痕没开 / 重建时还原不出来).
   */
  readonly bdiSnapshot?: VoiceCatchUpBdiSnapshot;
  /**
   * 本轮的标记 (移情 / 阻抗).
   *
   * 恒为空数组: 标记由 counselor 侧 worker 产出并**实时推帧**, 没有可回读的
   * "逐轮标记"存储. 补漏只补"说了什么 + 状态", 不补标记 (客户端拿不到就当没有).
   */
  readonly marks: readonly unknown[];
  /** 本轮危机等级 (pass = 无; warn = 有信号未阻断; block = 已阻断). */
  readonly crisisLevel: 'pass' | 'warn' | 'block';
}

/**
 * 补漏帧里的 BDI 快照 (WP19-R 契约的逐字形状).
 */
export interface VoiceCatchUpBdiSnapshot {
  readonly trust: number;
  readonly valence: number;
  readonly arousal: number;
  /** 阻抗 (取话量阻抗 —— 与"这轮说了多少"直接相关). */
  readonly resistance: number;
  /** 情绪标签 (内核按 valence × arousal 象限算的离散标签). */
  readonly anxiousSecure: string;
}

/**
 * 补漏帧里的本场当前状态 (V2026-11-03, WP23).
 */
export interface VoiceCatchUpSessionState {
  /** 会话相位 (listening = 在听用户说话; speaking = 来访者正在说). */
  readonly phase: 'listening' | 'speaking' | 'paused';
  /** 风险等级 (normal = 无重点监测; elevated = 本场已出过 high). */
  readonly riskLevel: 'normal' | 'elevated';
  /** 是否处于重点监测 (危机处置的高危标记). */
  readonly monitored: boolean;
  /** 本场角色 key (公共人物 slug; 无角色时是中性基线 id). */
  readonly characterCode: string;
}

/** 服务端 → 客户端消息 (全部 JSON 文本帧). */
export type VoiceServerMessage =
  /**
   * 就绪信号 — 鉴权 + 模板校验 + 演练登记 + startSession **全部成功**后才发 (spec §2.3 帧规则 0).
   *
   * 前端收到 `ready` 之前**不得**发 `user_text`: 连接已打开但会话可能尚未就绪,
   * 否则首条消息会撞上 "not initialized" (竞态).
   * 任一前置失败走 `error` + close, **不发** `ready`.
   *
   * V2026-10-26 增量 (spec 任务 1 / 任务 7):
   *   - `visitor`: 来访者速查卡 (可公开的表层字段; **不含** 7 大块剧本).
   *     字段可选 = 老客户端 (不认识这个键) 直接忽略, 向后兼容.
   *   - `persisted`: 本场是否已落 training_sessions 表. false = 降级为纯内存会话,
   *     本场不会有复盘报告 —— 必须让前端知道, 不能让用户以为"存下来了".
   *   - `dbSessionId`: **稳定落库 id** (training_sessions.id) —— 前端结束后用它调
   *     `GET /counselor/supervision/report/:sessionId` 取复盘报告.
   *     只在 `persisted=true` 时下发 (降级成纯内存的会话没有这个 id, 也就没有报告可取);
   *     字段缺失 = 本场不落库, 前端本地记得别去请求报告.
   *     为什么放 `ready` 而不是 `session_ended`: 用户主动结束是前端**直接断开**,
   *     可能根本等不到 `session_ended` 帧; ready 阶段连接稳定, 前端拿到后本地留存即可.
   */
  | {
      readonly type: 'ready';
      readonly visitor?: VoiceVisitorCard;
      readonly persisted?: boolean;
      readonly dbSessionId?: string;
    }
  /** 本轮回复开始. */
  | { readonly type: 'llm_start' }
  /** LLM 增量字幕 (可多次; 与音频并行到达, 互不阻塞). */
  | { readonly type: 'llm_text'; readonly text: string }
  /**
   * LLM 文本已全部发完 (**不代表**音频播完, 音频结束看 tts_done).
   *
   * V2026-10-29 治本 (WP9-C): 带**可选** usage —— 端上验收需要看
   * "思考 token 吃了多少 / 输出被截断没有". 字段可选 = 老客户端不认识就忽略, 向后兼容.
   *
   * V2026-11-03 治本 (WP23): 带**可选** turnIndex —— 本场第几轮 (从 1 起).
   *   用途: 客户端断线重连时要报 `lastSeenTurnIndex` (我上次听到第几轮), 靠的就是它.
   *   缺省 = 后端没给轮次号 (旧链路 `VisitorService` 没有轮次概念) → 客户端按
   *   "不知道听到哪" 处理 (握手不带 lastSeenTurnIndex → 服务端走 fresh 会话).
   */
  | {
      readonly type: 'llm_done';
      readonly usage?: {
        readonly promptTokens?: number;
        readonly completionTokens?: number;
        readonly totalTokens?: number;
        /** 思考 token 数 (推理模型专用). */
        readonly reasoningTokens?: number;
      };
      /** 本场第几轮 (从 1 起; 缺省 = 后端没给轮次号). */
      readonly turnIndex?: number;
    }
  /** 一句开始 (seq 本轮内从 1 递增). */
  | { readonly type: 'sentence_start'; readonly seq: number; readonly text: string }
  /** 一句完整 mp3 (可独立播放) —— 前端排队播. */
  | { readonly type: 'tts_audio'; readonly seq: number; readonly text: string; readonly mime: string; readonly audio_base64: string }
  /** 一句结束. */
  | { readonly type: 'sentence_end'; readonly seq: number }
  /** 本轮音频全部下发完. */
  | { readonly type: 'tts_done'; readonly usage: { readonly characters: number } }
  /** 打断成功 (LLM 已 abort, TTS 已 task_cancel); 之后不再下发本轮剩余帧. */
  | { readonly type: 'cancelled' }
  /** 错误. */
  | { readonly type: 'error'; readonly error: VoiceError }
  /**
   * 会话结束.
   *
   * `reportStatus` (V2026-10-27, spec 任务 B — **新增可选字段**, 向后兼容):
   *   本场会话的**报告状态** (业务侧派生). 前端据此决定要不要进"报告生成中"的轮询页:
   *     · `no_content` = 这场没有足够的对话内容, 报告**永远不会**生成 → 直接展示空态
   *     · `pending`     = 正常在生成 → 进轮询页
   *   字段缺失 = 业务侧没给出结论 (降级 / 桥超时) → 前端按 `pending` 处理 (旧行为).
   */
  | {
      readonly type: 'session_ended';
      readonly reason: VoiceSessionEndReason;
      readonly reportStatus?: VoiceSessionReportStatus;
    }
  /**
   * 实时督导轻提示 (V2026-10-26, spec 任务 2).
   *
   * 只在 `light` 档推; `off` 档不推 (但分析与落库照常, 见硬约束 16).
   * 正文只给**方向**, 不含可照念的替代话术 (防依赖硬约束 1).
   */
  | {
      readonly type: 'supervision_hint';
      readonly turnIndex: number;
      readonly category: string;
      readonly hintText: string;
      readonly tier: string;
    }
  /**
   * 移情 / 阻抗标记 (V2026-10-26, spec 任务 4).
   *
   * 只描述来访行为现象, 不做临床诊断、不贴病理标签.
   */
  | {
      readonly type: 'mark';
      readonly turnIndex: number;
      readonly direction: string;
      readonly markType: string;
      readonly note: string;
    }
  /**
   * 学员危机轻提示 (V2026-11-02, WP14 · warn 级).
   *
   * 只在**学员自己说的话**命中危机类别时推; AI 来访角色的台词**绝不**推 ——
   * 那是演练素材 (学员在练自杀危机干预剧本, AI 来访本来就要说痛苦的话).
   * 推它**不阻断**本轮 AI 回复 (AI 照常流式回话), 前端 3 秒自动消失.
   */
  | { readonly type: 'crisis_toast'; readonly level: 'medium'; readonly category: string }
  /**
   * 学员危机全屏弹窗 (V2026-11-02, WP14 · block 级).
   *
   * 学员自己说出危机表达时推: 本轮 AI 回复被**阻断** (不调 RenderPort.render,
   * 不发 llm/tts 内容帧), 弹窗给心理援助热线 12356 与急救 120.
   * 会话**不销毁** —— 学员点完仍可继续这场对练.
   */
  | {
      readonly type: 'crisis_modal';
      readonly level: 'high';
      readonly category: string;
      readonly hotline: string;
      readonly emergency: string;
    }
  /** 已确认暂停 (spec 任务 5). */
  | { readonly type: 'paused' }
  /** 已确认恢复 (spec 任务 5). */
  | { readonly type: 'resumed' }
  /**
   * 断线重连补漏 (V2026-11-03, WP23).
   *
   * 语义: 客户端重连时上报 `lastSeenTurnIndex=N` ("我上次听到第 N 轮"),
   * 服务端把 N 之后**已提交**的轮次一次性补回来.
   *
   * ⚠️ **只补最终文本, 不补流式 chunk / 不补音频**: TTS 已播出不可撤回, 且断连期间
   * 服务端压根不调 TTS (见 §1.5) —— 客户端拿 `replyText` 自己渲染文字气泡即可,
   * 不重新烧 TTS 配额.
   *
   * `missedTurns` 为空时**不发这个帧**, 改发轻量的 `session_reattached`.
   */
  | {
      readonly type: 'session_catchup';
      /** 服务端本场已提交的最大轮次号 (从 1 起; 没有则 0). */
      readonly serverLatestTurnIndex: number;
      /** 漏掉的轮次 (turnIndex > lastSeenTurnIndex, 按轮次升序). */
      readonly missedTurns: readonly VoiceCatchUpTurn[];
      /** 本场当前状态快照 (让客户端知道重连后会话处在什么状态). */
      readonly currentSessionState: VoiceCatchUpSessionState;
    }
  /**
   * 轻量重连确认 (V2026-11-03, WP23).
   *
   * 语义: 重连成功, 且客户端**没漏任何东西** (lastSeenTurnIndex 已经是最新的).
   * 比 `session_catchup` 轻 —— 不带任何逐轮内容.
   */
  | { readonly type: 'session_reattached'; readonly serverLatestTurnIndex: number }
  /**
   * 会话已不可续 (V2026-11-03, WP23).
   *
   * 两种原因:
   *   · `too_far_behind` —— 落后太多 (漏的轮次超过上限), 不塞历史, 让客户端自己决定从头开始;
   *   · `unknown_session` —— 这场会话已经不存在了 (正常结束过 / 进程重启后没恢复出来),
   *     客户端应走 fresh openSession.
   */
  | {
      readonly type: 'session_stale';
      readonly reason: 'too_far_behind' | 'unknown_session';
      /** 服务端已提交的最大轮次号 (可得时). */
      readonly serverLatestTurnIndex?: number;
    };

/** 错误信息. */
export interface VoiceError {
  readonly code: string;
  readonly message: string;
  readonly retryable: boolean;
}

/** session 状态. */
export type VoiceSessionStatus = 'idle' | 'processing' | 'cancelled' | 'ended' | 'paused';

/** session 元数据. */
export interface VoiceSessionMeta {
  readonly sessionId: string;
  readonly userId: string;
  readonly tenantId: string;
  readonly traceId: string;
  /**
   * 来访者 persona ID — 从 query `?personaId=` 提取, 可选.
   * 缺失时 VisitorService.openSession 走 PersonaRepository.findDefault() 兜底.
   */
  readonly personaId?: string;
  /** 会话模式 (text = 不出声; voice = 逐句出声). */
  readonly mode: VoiceSessionMode;
  /** 本场生效的临场参数 (供日志与业务侧插槽消费). */
  readonly preset: VoiceSessionPreset;
  /**
   * 业务指定的音色 (voice_id).
   *
   * 缺省 = 走 env `MINIMAX_TTS_VOICE_ID`; 有值 = 覆盖它 (spec §任务 3 的优先级链:
   * 握手 voiceId > 模板绑定音色 > env).
   */
  readonly voiceId?: string;
  /**
   * 专项训练技巧码 (V2026-10-26, spec §任务 1).
   *
   * undefined = 全流程 / 个案 (不聚焦单一技巧).
   */
  readonly skillCode?: VoiceSkillCode;
  /**
   * 稳定落库 id (training_sessions.id) — V2026-10-26 (spec 任务 1).
   *
   * undefined = 本场未落库 (降级为纯内存会话, 不会有复盘报告).
   * 督导反馈 / 实时提示 / 报告**全部**挂这个 id, 不用内存 sessionId.
   */
  readonly dbSessionId?: string;
  /**
   * 来访者速查卡 (vpt 公共人物) — V2026-10-26 (spec 任务 6).
   *
   * undefined = 非 vpt 公共人物场 (普通 voice session), 报告用 agent 内置 persona.
   * 有值 = 报告里的人格快照取自**速查卡** —— vpt 场 AI 扮演的是公共人物 (晚晴…),
   * 而 agent 内置 persona 是另一个虚构人物, 报告里写错名字, 学员看了会认不出
   * 自己在跟谁做督导.
   */
  readonly visitor?: VoiceVisitorCard;
  /**
   * 轨迹剧本 id (V2026-10-30, WP10) — 伦理盲盒剧本的 key.
   *
   * undefined = 本场无剧本约束 (BDI 自由运行, 与现状行为逐字一致).
   * 有值 = 透传给引擎侧, 由剧本解析器决定它对应哪份剧本; 查不到 → warn + 回退自由运行.
   */
  readonly trajectoryScriptId?: string;
  /**
   * 跨会话接续来源会话 id (V2026-10-30, WP12).
   *
   * undefined = **新会话** (与现状逐字一致); 有值 = 接续上一场 ——
   * 引擎搬上一场的 BDI 快照, 并按 visitorId 召回长时记忆.
   */
  readonly resumeFromSessionId?: string;
}

/** 来访者 persona 快照 (VoiceService 缓存, 用于 TTS 音色 + 日志). */
export interface VoiceSessionPersona {
  readonly id: string;
  readonly name: string;
  readonly voiceId: string;
  readonly difficulty: string;
}

/** 会话结束原因 (帧契约). */
export type VoiceSessionEndReason = 'user_finish' | 'timeout' | 'error' | 'idle_timeout';

/** session 内部状态. */
export interface VoiceSessionState {
  readonly meta: VoiceSessionMeta;
  /**
   * 已 resolve 的 persona 快照 — startSession 阶段从 VisitorService.openSession 取,
   * 用于日志 persona 标签. 整个 session 期间不变.
   */
  persona: VoiceSessionPersona | null;
  status: VoiceSessionStatus;
  /** 每次新 user_text / user_speaking 递增, 老 pipeline 检查不匹配自己退出. */
  currentGeneration: number;
  /** 当前 TTS session 句柄 (来自 TtsService.startSession). */
  ttsHandle: import('./tts/tts.types.js').TtsSessionHandle | null;
  /** 当前 LLM 流的可控 AbortController, signal 透传给 LlmService. */
  llmAbort: AbortController | null;
  /**
   * 会话开始时刻 (ms 时间戳) — V2026-10-26 (spec 任务 1: 结束回写时长).
   *
   * 用**墙钟**而不是累加各轮耗时: 训练场里有大量"人在思考"的沉默, 那正是会谈时长的一部分,
   * 累加各轮会把沉默漏掉 (报告里的"实际时长"会系统性偏短).
   */
  startedAt: number;
  /**
   * 已完成的咨询师发言轮数 (spec 任务 1: 结束回写轮次).
   *
   * ⚠️ 这是**轮次号的唯一真相** (V2026-11-03, WP23): 客户端断线重连时报的
   * `lastSeenTurnIndex`、补漏帧里每一轮的 `turnIndex`、逐字稿的轮次锚点 ——
   * 三处都从这里出, 谁也不自己数一遍.
   */
  turnCount: number;
  /**
   * 客户端 socket 是否还连着 (V2026-11-03, WP23).
   *
   * 为什么要有这个字段: 断线**不杀会话** (会话还在内存里, in-flight 的轮次让它跑完),
   * 但"socket 还在不在"决定两件事:
   *   · 要不要调 TTS provider —— 没人听还合成就是白烧钱 (§1.5);
   *   · 要不要发帧 —— 往死连接写帧没有意义 (帧出口在 gateway 侧, 断连时已注销).
   *
   * true = 在线; false = 断连中 (会话仍然活着).
   */
  attached: boolean;
}
