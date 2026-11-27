// AF-459: 语音真人度 · 厂商无关的韵律契约（纯类型，无 IO、无 Nest）。
//
// 为什么单独成层：
//   真人感不是"音色问题"，而是**文本里没有韵律信号**。AF-329/AF-331 已证明靠 prompt
//   教模型自然停顿不可靠（密度失控、跨轮预算不遵守、短会话方差近一倍）。
//   所以这块改成**确定性计划 + 句级注入**：模型只负责干净口语，服务端按临床画像
//   决定"这一轮该不该有停顿/思考垫"，过程可审计、可单测、可一键回退。
//
// 反双胞胎：
//   - 不把计划塞进 prompt：那又回到"靠模型记预算"的老路
//   - 不在这里依赖 VoiceVisitorStyle 等业务类型：纯层只认字符串，业务侧做映射
//   - 不直接生成厂商标记：语义形态（[pause:0.4]）与厂商形态（<#0.4#>）分开，
//     以后接豆包/其它厂商时只换渲染器

/** 韵律强度档. */
export type ProsodyLevel = 'off' | 'light' | 'medium';

/**
 * 一条韵律事件的类型.
 *
 * - filler    思考垫（「嗯，」），只在本轮第 0 句句首
 * - pause     句内短停顿（0.1–1.0s）
 * - trailoff  句末拖音（「。」→「……」）
 * - thinking  带时长的思考段（「嗯……」+ 1.5–3.0s），与 filler 分开计量
 * - silence   长沉默（1.0–10.0s），只在句末，按临床配额出现
 * - breath    呼吸声（MiniMax `(breath)`；豆包不支持，渲染器会丢弃）
 * - sigh      叹气声（MiniMax `(sighs)`；豆包不支持，渲染器会丢弃）
 */
export type ProsodyEventKind = 'filler' | 'pause' | 'trailoff' | 'thinking' | 'silence' | 'breath' | 'sigh';

/** 事件落在句子的哪个位置. */
export type ProsodyEventAnchor = 'sentence_start' | 'sentence_mid' | 'sentence_end';

/**
 * 一条已落到具体位置的事件.
 *
 * `text` 与 `durationMs` 按 kind 二选一：filler/thinking/breath/sigh 带文本，
 * pause/silence 带时长，trailoff 用文本 `……` 表示（它本身是标点改写，不是时长）。
 * thinking 既有文本也有时长；预览与渲染器都可同时使用。
 */
export interface ProsodyEvent {
  readonly kind: ProsodyEventKind;
  readonly anchor: ProsodyEventAnchor;
  /** filler/thinking 的口语填充词 / trailoff 的省略号文本 / 副语言标签名. */
  readonly text?: string;
  /** pause/silence/thinking 时长（毫秒）. */
  readonly durationMs?: number;
  /**
   * AF-565: 长沉默中"思考声"之前的静默长度（毫秒）.
   *
   * 只对 silence 生效：下一句下发前先等 leadMs，再用一句隐藏的“嗯……”把
   * 剩余沉默填成可听见的思考声；不填时按完整 durationMs 静默.
   */
  readonly leadMs?: number;
  /** AF-565: 长沉默中间穿插的思考声（只进 TTS，不进 display）. */
  readonly thinkingText?: string;
}

/** 本轮配额（每轮重置，不做跨轮预算——跨轮预算正是 prompt 方案失控的地方）. */
export interface ProsodyTurnLimits {
  readonly maxEventsPerTurn: number;
  /** 两次事件之间至少隔几句（防连续句句都顿）. */
  readonly minSentenceGap: number;
  readonly filler: boolean;
  readonly pause: boolean;
  readonly trailoff: boolean;
  /** AF-460: 思考段开关（「嗯……」+ 1.5–3.0s）；缺省 false = 与 AF-459 逐字一致. */
  readonly thinking?: boolean;
  /** AF-460: 长沉默开关（3–10s）；缺省 false. */
  readonly longSilence?: boolean;
  /** AF-460: 副语言（breath/sigh）开关；缺省 false. */
  readonly paralinguistic?: boolean;
  /** 本轮最多几个思考段；缺省 0. */
  readonly maxThinkingBeats?: number;
  /** 本轮最多几个长沉默；缺省 0. */
  readonly maxLongSilences?: number;
  /** 本轮最多几个副语言事件；缺省 0. */
  readonly maxParalinguistic?: number;
  /** 思考段时长范围（毫秒）；缺省 [1200, 2200]. */
  readonly thinkingPauseMs?: readonly [number, number];
  /** 长沉默时长范围（毫秒）；缺省 [3000, 6000]. */
  readonly longSilenceMs?: readonly [number, number];
}

/** 一轮的韵律计划（确定性：同 seed + 同句序号 = 同结果）. */
export interface ProsodyTurnPlan {
  readonly level: ProsodyLevel;
  readonly seed: string;
  /** 计划依据的来访者风格（仅用于审计，不参与选词以外的计算）. */
  readonly style: string;
  readonly limits: ProsodyTurnLimits;
  /** AF-565: 本轮序号（用于口头语轮换；缺省时退化为纯哈希）. */
  readonly turnIndex?: number;
}

/** 计划输入（业务侧从会话元数据取值，纯层不做读取）. */
export interface ProsodyPlanInput {
  /** 总开关；false 直接给 off 计划（行为与改前逐字一致）. */
  readonly enabled: boolean;
  readonly sessionId: string;
  /** 本场第几轮（从 1 起；与 voice 层轮次号同源）. */
  readonly turnIndex: number;
  /** 来访者配合风格（defensive/cooperative/resistant/avoidant/mixed）. */
  readonly style?: string;
  /** 难度档（L1/L2/L3）. */
  readonly difficulty?: string;
  /** AF-565: 情绪基线（0–1，越低越接近抑郁/空洞；缺省按 0.5）. */
  readonly emotionBaseline?: number;
  /** AF-565: 防御水平（0–1，越高越回避；缺省按 0.5）. */
  readonly defenseLevel?: number;
}

/** 注入上下文（句序号 + 本轮已用配额 + 上次事件的句序号）. */
export interface ProsodyApplyContext {
  /** 本轮内第几句（从 0 起）. */
  readonly sentenceIndex: number;
  /** 本轮已注入的事件数. */
  readonly appliedEvents: number;
  /** 上一次事件落在第几句；-1 = 还没有. */
  readonly lastEventSentenceIndex: number;
  /** AF-460: 本轮已用的思考段数量；缺省 0. */
  readonly appliedThinkingBeats?: number;
  /** AF-460: 本轮已用的长沉默数量；缺省 0. */
  readonly appliedLongSilences?: number;
  /** AF-460: 本轮已用的副语言数量；缺省 0. */
  readonly appliedParalinguistic?: number;
}

/** 单句注入结果. */
export interface ProsodySentenceResult {
  /** 展示文本（原句，不含任何标签）. */
  readonly displayText: string;
  /** 语义形态文本（可读标记，管理端气泡用它对照）. */
  readonly speechText: string;
  /** 本句实际落下去的事件（0 或 1 条）. */
  readonly events: readonly ProsodyEvent[];
}
