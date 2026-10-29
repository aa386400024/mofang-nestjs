// V2026-10-29 治本 (WP8-B · voice 侧 · 对话后端窄接口):
//   职责: 声明"语音链路要一个什么样的对话后端" —— 四个方法 (开场 / 一轮流式 /
//         收尾 / 逐字稿), 以及该后端在依赖注入里的运行时 token.
//   边界: 纯类型 + 一个 Symbol; 不含任何实现, 不依赖引擎 / 不依赖 NestJS.
//         旧 `agent/visitor` 链路**不改一行** —— 它天然满足本接口.
//
//   为什么要有这个窄接口 (而不是让 VoiceService 直接依赖新引擎):
//     VoiceService 是**成熟资产** (WS 帧协议 / TTS 句切 / barge-in / 逐字稿落库
//     都已跑通), 而新引擎是**灰度期资产**. 两者要并存, 就必须有一个"两边都像"的
//     契约面. 如果 VoiceService 直接依赖 `EngineTurnService`, 那"关掉灰度"就得改
//     VoiceService 的构造签名 —— 开关就变成了不可回退的改动, 违背"灰度可回退".
//     走窄接口后: VoiceService 持有接口, 按开关选实现, 关掉开关 = 选回旧实现,
//     一行代码都不用动.
//
//   为什么接口形状**贴着旧 VisitorService** (而不是照新引擎的能力设计):
//     新引擎的能力 (流式 / 主备 / guard) 是**实现细节**, 由实现方在自己的边界内
//     吸收. 窄接口只暴露"语音链路真正用到的四件事", 于是:
//       - 旧实现零改动即满足 (结构化类型直接成立);
//       - 新实现必须自己把引擎语义翻译成语音语义 (三态 chunk), 翻译点只有一处.
//     若窄接口按新引擎设计 (比如暴露 RenderSpec / 主备候选), 旧实现就再也塞不进来,
//     "并存可回退"当场破产.
//
//   反双胞胎:
//     - 不在本文件里复制 `LlmStreamChunk` / `TranscriptTurn` / `VoiceSessionPersona`:
//       直接 import 既有类型. 复制一份就会与旧链路慢慢漂移 (字段加了/改名了这里
//       不知道), 而窄接口的价值恰恰是"两边一模一样".
//     - 不用 interface 当 Nest 的 provider token: interface 编译后没有运行时值,
//       必须有一个真实的 token —— 这里用 Symbol (不可能与别的 provider 撞名;
//       字符串 token 撞车时 Nest 不报错, 而是静默注入错东西).
//     - 不把"灰度开关"写进接口: 开关是**装配层**的决策 (选哪个实现), 不是后端
//       自己的属性. 写进接口等于让每个实现都去读 env —— 同一份开关读两遍必然漂移.
//     - V2026-10-29 (WP9-A): 角色参数**只增可选字段** (templateId / skillCode / preset).
//       必填字段会让旧实现 (VisitorService) 再也塞不进这个契约, "并存可回退"当场破产;
//       可选字段的缺省语义是"本场无角色 → 中性基线", 与现状行为完全一致.
//
//   如何验证:
//     1. npx tsc -p tsconfig.build.json --noEmit 0 错
//     2. test/voice/wp8b-grayscale.spec.ts: 旧 VisitorService 结构化满足本接口;
//        新引擎适配实现同一接口; 灰度开关选实现、失败回落

import type { VoiceSessionPersona } from './voice.types';
import type { LlmStream } from '../agent/llm/llm.types';
import type { TranscriptTurn } from '../agent/supervisor/supervisor.types';

/**
 * 对话后端窄接口 (新旧同构).
 *
 * 形状与旧 `VisitorService` 的公开方法**逐项对齐**, 所以旧实现可以直接塞进来,
 * 新实现只需把引擎语义翻译成同一组三态 chunk.
 */
export interface VoiceTurnBackend {
  /**
   * 开场: 解析来访者身份 + 建立会话记忆.
   *
   * @param opts 开场参数
   * @returns 来访者人格快照 (供日志 / 报告用)
   * @throws 解析不到任何可用身份时抛错 (调用方负责回落)
   */
  openSession(opts: VoiceTurnBackendOpenOptions): Promise<VoiceSessionPersona>;

  /**
   * 一轮对话: 返回三态流 (content / done / error).
   *
   * @param opts 本轮入参 (含 AbortSignal —— barge-in 时真正断流)
   * @returns 包装后的流 (消费方负责转发到 TTS + client)
   */
  streamTurn(opts: VoiceTurnBackendTurnOptions): Promise<{ readonly stream: LlmStream }>;

  /**
   * 收尾: 释放会话资源, 返回本场统计.
   *
   * @param sessionId 会话 id
   * @returns 最终轮数与消息条数
   */
  closeSession(sessionId: string): VoiceTurnBackendCloseResult;

  /**
   * 逐字稿副本 (供督导报告).
   *
   * @param sessionId 会话 id
   * @returns 完整消息副本; 会话不存在返 []
   */
  transcript(sessionId: string): readonly TranscriptTurn[];
}

/** 开场参数. */
export interface VoiceTurnBackendOpenOptions {
  /** 会话 id. */
  readonly sessionId: string;
  /** 租户隔离键. */
  readonly tenantId: string;
  /** 来访者 persona id (可选; 缺省走后端自己的默认). */
  readonly personaId?: string;
  /**
   * V2026-10-29 (WP9-A): 公共人物模板 id —— 角色解析的 key.
   *
   * 缺省 = 本场无角色 (普通 voice session 没有公共人物模板), 后端走中性基线.
   */
  readonly templateId?: string;
  /** V2026-10-29 (WP9-A): 专项训练技巧码 (仅观测, 不参与基线映射). */
  readonly skillCode?: string;
  /** V2026-10-29 (WP9-A): 本场临场参数 (叠加在角色基线之上). */
  readonly preset?: VoiceTurnBackendCharacterPreset;
  /**
   * V2026-10-29 治本 (WP9-C): 稳定落库 id (training_sessions.id).
   *
   * 用途: 危机轮次要**同步**给督导推 `supervision_hint` 帧, 而 WS 帧出口注册表
   * 是按落库 id 登记的 —— WS 会话 id (客户端给的内存 id) 与它不是一回事.
   *
   * 缺省 = 本场没落库 (纯内存降级) → 推不出提示帧, 不影响对话本身.
   */
  readonly dbSessionId?: string;
}

/**
 * 本场临场参数 (窄接口侧的内联形状).
 *
 * 为什么在这里**内联**而不 import 角色解析包的类型:
 *   voice 层不该知道"角色内核"这件事 —— 它只负责把握手带来的现场旋钮**原样透传**,
 *   角色语义 (回避型意味着多高阻抗) 由角色解析器负责. 内联结构让 voice 层与角色
 *   解析实现**解耦**: 将来 WP9-B 换数据源、改映射口径, voice 层一行都不用动.
 *
 * 为什么全部可选: 临场参数缺省 = "这一场没有临场调整", 走角色种子自己的基线.
 */
export interface VoiceTurnBackendCharacterPreset {
  /** 难度档 (L1 / L2 / L3); 越高阻抗基线越高. */
  readonly difficulty?: string;
  /** 配合风格 (cooperative / mixed / resistant / avoidant / defensive). */
  readonly style?: string;
  /** 情绪基线 0..1 (内在空洞感起点). */
  readonly emotionBaseline?: number;
  /** 防御水平 0..1 (对"被看穿"的警觉度). */
  readonly defenseLevel?: number;
}

/** 一轮对话的入参. */
export interface VoiceTurnBackendTurnOptions {
  /** 会话 id. */
  readonly sessionId: string;
  /** 租户隔离键. */
  readonly tenantId: string;
  /** 用户 id (计费 / 审计). */
  readonly userId: string;
  /** persona 已 resolve 后的 id. */
  readonly personaId: string;
  /** 用户本轮文本 (ASR final). */
  readonly userText: string;
  /** 链路 trace id (透传给上游). */
  readonly traceId?: string;
  /** AbortSignal — barge-in 时 abort(), 请求真正中断. */
  readonly signal?: AbortSignal;
}

/** 收尾统计 (旧链路的 hadMemory 字段与语音侧无关, 不进窄接口). */
export interface VoiceTurnBackendCloseResult {
  /** 本场完成的轮数. */
  readonly finalTurnCount: number;
  /** 本场留下的消息条数 (一问一答算两条). */
  readonly finalMessageCount: number;
}

/**
 * 对话后端的依赖注入 token.
 *
 * 用 Symbol 而不是字符串: 字符串 token 与仓内其它 provider 撞名时 Nest **不报错**,
 * 而是静默注入错的东西, 排查时表现为"某个模块拿到了另一个模块的依赖".
 */
export const VOICE_TURN_BACKEND = Symbol('VOICE_TURN_BACKEND');
