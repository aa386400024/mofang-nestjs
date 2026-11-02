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

import type { VoiceSessionMode, VoiceSessionPreset, VoiceSkillCode, VoiceVisitorCard } from './voice-session.types';

/**
 * 客户端 → 服务端消息.
 *
 * V2026-10-26 增量 (spec 任务 5): 新增 `session_pause` / `session_resume` 两个**控制帧**.
 * 语义是"挂起"不是"中断" —— 暂停不清 transcript、不 abort 会话、不断 WS.
 */
export type VoiceClientMessage =
  | { readonly type: 'user_text'; readonly text: string; readonly generation?: number }
  | { readonly type: 'user_speaking' }
  | { readonly type: 'session_finish' }
  /** 主动暂停: 挂起 LLM / TTS, 保留会话与逐字稿, 不断连. */
  | { readonly type: 'session_pause' }
  /** 恢复: 从挂起点继续, 状态回待命. */
  | { readonly type: 'session_resume' };

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
      readonly reason: 'user_finish' | 'timeout' | 'error';
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
  /** 已确认暂停 (spec 任务 5). */
  | { readonly type: 'paused' }
  /** 已确认恢复 (spec 任务 5). */
  | { readonly type: 'resumed' };

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
  ttsHandle: import('./tts/tts.types').TtsSessionHandle | null;
  /** 当前 LLM 流的可控 AbortController, signal 透传给 LlmService. */
  llmAbort: AbortController | null;
  /**
   * 会话开始时刻 (ms 时间戳) — V2026-10-26 (spec 任务 1: 结束回写时长).
   *
   * 用**墙钟**而不是累加各轮耗时: 训练场里有大量"人在思考"的沉默, 那正是会谈时长的一部分,
   * 累加各轮会把沉默漏掉 (报告里的"实际时长"会系统性偏短).
   */
  startedAt: number;
  /** 已完成的咨询师发言轮数 (spec 任务 1: 结束回写轮次). */
  turnCount: number;
}
