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
//     - V2026-10-30 (WP10): 剧本参数同样**只增可选字段** (trajectoryScriptId).
//       缺省语义 = "本场无剧本 → BDI 自由运行", 与现状行为完全一致; 旧实现
//       (VisitorService) 天然是 undefined, 一行都不用改.
//
//   如何验证:
//     1. npx tsc -p tsconfig.build.json --noEmit 0 错
//     2. test/voice/wp8b-grayscale.spec.ts: 旧 VisitorService 结构化满足本接口;
//        新引擎适配实现同一接口; 灰度开关选实现、失败回落

import type { StudentRiskAuditChoice } from './student-risk-audit-slot.js';
import type { VoiceServerMessage, VoiceSessionPersona } from './voice.types.js';
import type { LlmStream } from '../agent/llm/llm.types.js';
import type { TranscriptTurn } from '../agent/supervisor/supervisor.types.js';

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

  /**
   * 回写学员在危机弹窗后的选择 (V2026-11-02, WP14 §1.3).
   *
   * **可选方法**: 旧链路 (`VisitorService`) 没有危机弹窗, 不实现它**完全正常** ——
   * 必填会把旧实现挡在契约外, "并存可回退"当场破产 (与角色 / 剧本参数同款理由).
   *
   * 语义: 只回写审计表的 `user_choice` (唯一允许 update 的列),
   * **不**重置 monitored 状态、**不**改会话状态.
   *
   * @param sessionId 会话 id
   * @param choice 学员的选择
   */
  markUserChoice?(sessionId: string, choice: StudentRiskAuditChoice): Promise<void>;

  /**
   * 前置 safety 判定 (V2026-11-02, WP14 优化项 · block 不发 llm_start).
   *
   * **可选方法**: 旧链路 (`VisitorService`) 不做危机处置, 不实现它**完全正常** ——
   * 必填会把旧实现挡在契约外, "并存可回退"当场破产 (与角色 / 剧本参数同款理由).
   *
   * 为什么要有它: 内核的 safety 判定发生在**内核 turn 内部** —— 等它判完,
   * voice 层已经把 `llm_start` 发出去 (前端 loading 圈转起来了), 而 block 之后
   * 前端既收不到 `llm_done` (后端根本没渲染), 又被全屏 modal 抢屏 ——
   * 体感是"开始了但永远不会结束". 前置判一次就能把 modal 干干净净地弹出来.
   *
   * 语义:
   *   · `block` → voice 层**不发** `llm_start` / `llm_done` / `tts_done`,
   *     直接发 `crisis_modal`, **不调**内核 turn / render;
   *   · `warn` / `pass` → 走既有流程, 一行不动 (warn 仍由内核侧按原时序发 toast).
   *
   * 失败语义: **静默失败** —— 调用方按"放行"处理, 不能因为前置判定挂了就把
   * 整场对练搞挂 (内核侧仍会再判一次, 双层防御).
   *
   * @param input 判定入参 (会话 / 文本 / 轮次 / 帧出口)
   * @returns 判定结果
   */
  preCheckSafety?(input: VoiceSafetyPreCheckInput): Promise<VoiceSafetyPreCheckResult>;
}

/**
 * 前置 safety 判定入参.
 *
 * 为什么用**入参对象**而不是一个 `text` 字符串:
 *   判定为 block 时, 后端要**当场**做三件事 —— 推 `crisis_modal` 帧、写审计行、
 *   置位重点监测. 三件事都要"本场"的口径:
 *     · 推帧要知道推给**哪一场** (WS 会话 id 客户端可控, 不能拿它当注册键);
 *     · 写审计要知道**落库 id + 学员 id + 轮次**;
 *     · 置位要知道**内核句柄**.
 *   只给一个 `text` 的话, 后端**无从判断这些口径** —— 判定得了, 却推不出弹窗、
 *   留不下痕. 所以这里把"本场上下文"显式传进来.
 */
export interface VoiceSafetyPreCheckInput {
  /** 会话 id (voice 会话 id). */
  readonly sessionId: string;
  /** 学员本轮输入 (ASR 定稿). */
  readonly userText: string;
  /**
   * 本场轮次 (从 1 起).
   *
   * 为什么必须由 voice 层给: 前置 gate 在**内核 turn 之前**拦截, 内核的轮次计数器
   * 还没动 —— 只有 voice 层知道"这是本场第几轮". 而审计表的 `turn_index` 口径与
   * 逐字稿锚点一致 (报告按 `(turnIndex - 1) * 2` 定位那条"问"), 两边必须同源.
   */
  readonly turnIndex: number;
  /**
   * 推一帧给**本场**的客户端 (危机弹窗).
   *
   * 缺省 = 没有出口 (独立调用后端) → 后端只记审计, 不推帧.
   */
  readonly publishFrame?: (frame: VoiceServerMessage) => void;
}

/**
 * 前置 safety 判定结果.
 */
export interface VoiceSafetyPreCheckResult {
  /**
   * 等级.
   *
   * `pass` = 放行; `warn` = 放行但有风险信号 (由内核侧按原时序处置);
   * `block` = 阻断 (voice 层不发 `llm_start`, 直接发 `crisis_modal`).
   */
  readonly level: 'pass' | 'warn' | 'block';
  /** 命中的危机类别 (block / warn 时有值). */
  readonly category?: string;
}

/** 开场参数. */
export interface VoiceTurnBackendOpenOptions {
  /** 会话 id. */
  readonly sessionId: string;
  /** 租户隔离键. */
  readonly tenantId: string;
  /**
   * 学员 id (V2026-10-30, WP12).
   *
   * 用途: 长时记忆的归属作用域 = `(学员, 角色)` —— 角色 key 对所有学员都相同,
   * 只用它当归属键会让**不同学员互相读到对方的咨询内容**.
   *
   * 缺省 = 无学员身份 → 后端**不写**长时记忆 (没有归属就没有隔离).
   */
  readonly userId?: string;
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
  /**
   * V2026-10-30 治本 (WP10): 轨迹剧本 id (伦理盲盒剧本的 key).
   *
   * 缺省 = 本场无剧本约束 → 后端走 BDI 自由运行, 行为与现状**逐字一致**.
   *
   * 为什么只传字符串: voice 层**不判断**"有没有剧本"、也不认识剧本内容 ——
   * 它只把握手带来的现场旋钮原样透传. 剧本语义 (这个 id 意味着什么样的伦理
   * 事件与督导要点) 归引擎侧的剧本解析器负责.
   *
   * 查不到剧本 (id 不存在 / 解析器未装配) → 后端 warn + 回退自由运行,
   * **不抛错** —— 剧本是可选增强, 不是会话的前置条件.
   */
  readonly trajectoryScriptId?: string;
  /**
   * V2026-10-30 治本 (WP12): 跨会话接续来源会话 id.
   *
   * 缺省 = **新会话** (行为与现状**逐字一致**); 有值 = 接续上一场 ——
   * 后端据此把上一场的 BDI 快照搬过来, 并按 visitorId 召回长时记忆.
   *
   * 为什么只增可选字段: 必填字段会让旧实现 (`VisitorService`) 再也塞不进这个契约,
   * "并存可回退"当场破产 (与 WP9-A 角色参数 / WP10 剧本参数同款理由).
   *
   * 接续失败**不阻断**: 上一场不存在 / 已过期 / 记忆召回失败 → 后端记 warn,
   * 按新会话开, **不抛错、不断连**.
   */
  readonly resumeFromSessionId?: string;
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
  /**
   * 轮次号 (V2026-11-02, WP16 · 幂等键的另一半).
   *
   * 语义: 客户端给这一轮编的号. **同一会话 + 同一 round_id**, 后端认得出
   * "这是同一轮的重发", 于是**不重跑 BDI** (阻抗 / 情绪 / 信任不再二次跳变).
   *
   * 缺省 = 客户端没给号 → 后端**不走幂等**, 行为与 WP16 之前逐字一致.
   *   为什么缺省是"正常跑"而不是"报错": 老客户端 (以及还没适配的端) 不带这个字段,
   *   后端不能因此把对练搞挂 —— 幂等是**增强**, 不是会话的前置条件.
   *
   * 只增可选字段: 旧实现 (`VisitorService`) 天然是 undefined, 一行都不用改.
   */
  readonly roundId?: number;
  /** 链路 trace id (透传给上游). */
  readonly traceId?: string;
  /** AbortSignal — barge-in 时 abort(), 请求真正中断. */
  readonly signal?: AbortSignal;
  /**
   * 推一帧给**本场**的客户端 (V2026-11-02, WP14 · 危机帧).
   *
   * 为什么走窄接口而不是让后端去碰帧出口注册表:
   *   · 帧出口注册表按**落库 id** 索引, 而 WS 会话 id 是**客户端给的** ——
   *     让后端用客户端可控的 id 去注册出口, 等于开一个"把 A 的帧推给 B"的口子;
   *   · 落库 id 在"本场没落库"(降级成纯内存)时**没有** ——
   *     而**危机弹窗不能因为数据库降级就推不出去**;
   *   · 传一个"推给本场"的回调, 两条问题一起消失: 后端不需要知道任何 id 口径.
   *
   * 缺省 = 没有出口 (旧链路 / 独立调用后端) → 后端**不推**危机帧, 只记 warn.
   */
  readonly publishFrame?: (frame: VoiceServerMessage) => void;
}

/**
 * 「本轮不完整」错误码 (V2026-11-02, WP16).
 *
 * 语义: 这一轮的**状态已经提交**, 但**回复没发完** (流式断流 / LLM 超时 / 前端 abort).
 * 客户端拿到它应当**换一个轮次号**重发新一轮, 而不是重发同一轮 ——
 * 重发同一轮会被后端幂等挡下, 拿到的还是这句"不完整".
 *
 * 为什么这个码住在**窄接口**文件里 (而不是引擎侧):
 *   它是"引擎 → 语音层 → 客户端"三方共用的**协议词汇**. 引擎侧要产出它,
 *   语音层要**认出它并放过它** (不能把它当引擎故障去回落旧链路 ——
 *   旧链路没有轮次语义, 回落等于让同一句话在两条链路上各跑一遍).
 *   放窄接口 = 两侧都从同一处 import, 不会各写一份字符串常量然后慢慢漂移.
 */
export const TURN_INCOMPLETE_CODE = 'turn_incomplete';

/** 收尾统计 (旧链路的 hadMemory 字段与语音侧无关, 不进窄接口). */
export interface VoiceTurnBackendCloseResult {
  /** 本场完成的轮数. */
  readonly finalTurnCount: number;
  /** 本场留下的消息条数 (一问一答算两条). */
  readonly finalMessageCount: number;
  /**
   * 本场累计的 completion tokens (V2026-11-02, WP22).
   *
   * 用途: 全局日 token 预算要按"这场真的花了多少"累加 —— 复用引擎侧已有的用量
   * 累加器 (WP24), 不另算一套 (两套口径必然对不上).
   *
   * **可选字段** (缺省 = 这场没给出用量):
   *   · 旧链路 (`VisitorService`) 没有用量累加器 → 缺省;
   *   · 引擎侧已经收过尾 (同一场被 close 两次) → 第二次拿不到 → 缺省.
   * 缺省语义是"不可得", **不是 0** —— 两者不能混: 0 会被当成"这场没花钱",
   * 而"不可得"是"不知道花了多少". 预算宁可少算也不能把 0 当成事实.
   */
  readonly totalCompletionTokens?: number;
}

/**
 * 对话后端的依赖注入 token.
 *
 * 用 Symbol 而不是字符串: 字符串 token 与仓内其它 provider 撞名时 Nest **不报错**,
 * 而是静默注入错的东西, 排查时表现为"某个模块拿到了另一个模块的依赖".
 */
export const VOICE_TURN_BACKEND = Symbol('VOICE_TURN_BACKEND');
