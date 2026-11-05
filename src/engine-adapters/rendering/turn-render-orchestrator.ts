// V2026-10-28 治本 (WP7 · B 层 · 决策→说话装配门面):
//   职责: 把内核的"决策"接成"一句真实来访口语" —— 调内核 turn → 组装 RenderSpec
//         → 调 RenderPort.render → 回填真实 reply → 问+答成对补写工作记忆.
//         附中文来访风格 system prompt 模板 (仅适配层, 内核零 prompt).
//   边界: 纯类, 可脱离 NestJS 容器 new 出来跑; **零 @nestjs / 零 typeorm**,
//         零网络 (只依赖注入的端口), 零 .env, 零落库 (记忆写入走注入的 MemoryStore 端口).
//
//   为什么"回填 reply"必须在适配层 (第 0 原则):
//     内核零 IO / 零 prompt / 零网络. RenderPort 是**外部能力**, 内核只产出决策状态.
//     "调谁渲染、怎么拼上下文、怎么回填、怎么记记忆"全是装配职责.
//     改内核的 turn 去调 RenderPort = 让内核长出网络依赖 —— 整包搬走就泡汤.
//     所以内核 `reply` 仍恒为 '', 真实话术由本门面产出 (内核出参逐字不动).
//
//   失败语义 (两级, 刻意不同):
//     - 内核 turn 抛错 (ABORTED / INVALID_INPUT / SESSION_NOT_FOUND) → **原样冒泡**.
//       那些是"调用方参数错"或"会话状态错", 该由传输层 (WP8) 处理; 门面的降级出口
//       只管"渲染这块挂了", 越权吞掉内核错误会把参数错误伪装成一次正常对练.
//     - 渲染抛异常 / 文本为空 → **兜底成非空中性话术**, 绝不 reject.
//       渲染是最后一公里, 它挂了不该让整场对练挂掉 (同 WP6 M4).
//
//   V2026-10-29 治本 (WP8-B · 流式出口):
//     新增 `turnStream(handleId, input, handlers)` —— 与 `turn()` **共用**内核决策 /
//     规格组装 / 落账 (settleTurn) 的同一套闭环, 只把"取文"换成流式. 历史与记忆
//     逻辑不复制: 复制一份必然出现"聚合记得、流式忘得"的分裂.
//
//   V2026-11-04 治本 (WP50 · 渲染层接入同盟三维):
//     system prompt 的"内在状态"块多两行 —— 安全感 / 联结感 (与信任同性质).
//     只在规格**提供了**这两个字段时才加; 缺省 = 不显示 = prompt 逐字不变.
//     ⚠️ 文案是**工程种子值, 非临床标定** —— 待真实对练校准.
//     本期**只加数据, 不调策略** —— 轮次长短 (verbosity) 的判定口径一个字没改.
//
//   V2026-11-04 治本 (WP56 · 长期记忆召回进渲染上下文):
//     system prompt 的"内在状态"块多一段 —— "你还记得这些事" (跨会话长期记忆召回).
//     召回结果 (内核 WP2 的 openingContext) 以前**从来没进过 prompt** —— 召回了但
//     模型看不到 = 白召回. 本期把消费端接上, 让三级记忆这一环真正闭合.
//     条件渲染 (recall.length > 0) + 只取 Top3 → 空召回时 prompt 逐字不变.
//     ⚠️ 文案是**工程种子值, 非临床标定** —— 待真实对练校准.
//
//   V2026-11-04 治本 (WP35 · 渲染四手法):
//     system prompt 的"这一轮怎么说"块从**话量三档**升级到**四手法** ——
//       ① 阻抗-表达映射细化: 在话量之外加"语气疏离度" (疏离 / 中性 / 亲近);
//       ② 情绪粒度细化: 在情绪标签 + 数值之外加"这轮该怎么表现情绪";
//       ③ 表达层轻量随机: 在 prompt 里告诉模型"可以有一点变化";
//       ④ 口语化 / 非语言: 补一点停顿 / 叹气 / 犹豫的表现空间.
//     话量三档的判定口径 (resolveTurnVerbosity) **一个字没改** —— 只加维度, 不调策略.
//     条件渲染: ① 依赖同盟维度 (safety / bond), 没有就不渲染那一行;
//               ② 情绪是中性就不给额外指令. 缺省时这两行整个不出现.
//     ⚠️ 文案是**工程种子值, 非临床标定** —— 待真实对练校准.
//     本期**不做**"叙事风格" (话量基线 / 叙事风格 / 语态倾向) —— 那是 WP41 的事.
//
//   V2026-11-04 治本 (WP41 · 表达风格渲染接入):
//     WP10A 在 DB 里预留了话量基线 / 叙事风格 / 语态倾向 3 列, 但从 DB 到 prompt 这条
//     路是**断的** —— 渲染层看不到角色"天生怎么说话": 同样阻抗的两个角色, 一个天生
//     絮叨、一个天生沉默, 输出的长短与腔调完全一样.
//     本文件的扩展:
//       ① `TurnSessionContext` 加 3 个**可选**字段 (装配层登记的角色基线, 整个会话不变);
//       ② `assemble()` 把它们从会话归属读出来传进规格组装器;
//       ③ `resolveTurnVerbosity()` 加**话量基线修正** —— 判据一个字没改, 只是把
//          "话量阻抗"这个量按基线挪一点 (天生话多的人同样阻抗判不到"短");
//       ④ `buildVisitorSystemPrompt()` 渲染"你说话一贯的样子"那一块 (条件渲染).
//     缺省 (没登记表达风格) → 规格与 prompt 与 WP35 **逐字一致** (零回归).
//     ⚠️ 文案是**工程种子值, 非临床标定** —— 待真实对练校准.
//
//   V2026-11-05 治本 (WP64 · LLM 审议层 PoC · 影子模式):
//     本门面成了**影子审议的唯一旁路调用点** —— 每轮渲染完成后, fire-and-forget
//     调一次 LLM 审议, 结果**不生效** (只写 Redis trace 表).
//     为什么接在这里 (而不是内核 turn 里):
//       · 内核是纯层, 改 turn = 破红线; 影子模式的定义就是"旁路观察";
//       · **只有本门面同时握有三样东西** —— 咨询师的话、来访的渲染回应、本轮前后的快照.
//         内核端口拿不到"来访的渲染回应" (那是渲染产物), 审议 prompt 缺了它就答非所问.
//     代价与取舍:
//       · 起始快照 (本轮**之前**的状态) 适配层拿不到 → 门面自己记一份"上一轮结束时的快照".
//         同一场会话内它与内核下一轮载入的状态**逐字相等**; 跨会话接续的第一轮没有 → 跳过.
//       · 规则算子的 delta 用**快照差**反推 (适配层拿不到内核的 cappedTotal) —— 口径与
//         "状态实际怎么动了"一致, 见交付记录 §2.3.
//     缺省 = 不装审议端口 = 行为与本单之前**逐字一致** (零回归).
//
//   V2026-11-05 治本 (WP68 · 意图锁定机制):
//     审议入参多传**一个**字段: `ruleStrategy` (本轮规则算子选的行为策略).
//     为什么门面要传: 意图是内核的**每轮派生输出**, 不在快照里 —— 审议层自己拿不到,
//       而意图锁定必须知道"现在用的是哪个策略" (不知道就没法判断该不该换).
//     ⚠️ 取 `spec.intention.strategy` —— 那是本轮渲染**实际用的**策略
//       (`buildRenderSpec` 保证它永远有值: 内核意图缺失时兜底 `simple_response`),
//       不是"猜一个" —— 猜出来的策略会让锁定判定建立在假数据上.
//     ⚠️ 除多传这一个字段外, 门面的**其它逻辑一个字没动** (不判定、不拦截、不改主流程).
//
//   反双胞胎:
//     - 不重复写咨询师半边记忆: 内核 rememberTurn 已经写了 (source=TURN, tier=WORKING,
//       content=咨询师文本). 门面只补**来访半边**. 重复写 = 工作记忆里同一条出现两次,
//       召回时权重被悄悄翻倍, 而且没人查得出来.
//     - 不改内核 EngineTurnOutput: 门面另起一个 TurnRenderResult, 把内核出参**透传**
//       (snapshot / turnIndex / intention / trajectoryTrace / safety / openingContext),
//       只在外面包一层 render 元信息与真实 reply.
//     - 不把 prompt 写进内核: 模板在本文件, 经 WP6 预留的 buildMessages 缝注入.
//     - 记忆写失败不炸穿: 记忆写不进去是"降级"(这条没被记住), 不是"会话失败"
//       (同 WP2 embedder 的失败语义) —— 让它炸穿等于把一次可降级的抖动升级成整场失败.
//
//   如何验证:
//     1. npx tsc -p tsconfig.build.json --noEmit 0 错
//     2. test/engine-adapters/wp7-turn-render.spec.ts 覆盖映射/裁剪/闭环/成对记忆/降级/冒泡/prompt

import { nanoid } from 'nanoid';

import { runWithProbeSource, type ProbeSource } from './probe-source.js';
import { DEFAULT_RENDER_FALLBACK_UTTERANCES } from './render-adapter.config.js';
import type { AdaptiveRenderSpec } from './render-risk.js';
import { buildRenderSpec, type SpecAssemblyInput } from './spec-assembler.js';
import { splitTextIntoDeltas, type StreamRenderHandlers, type StreamingRenderPort } from './streaming-render.port.js';
import {
  buildStudentRiskDecision,
  mergeStudentRiskDecisions,
  type StudentRiskDecision,
  type StudentRiskGate,
} from './student-risk-disposal.js';
import {
  MemorySource,
  MemoryTier,
  WORKING_MEMORY_WINDOW_TURNS,
  type BehaviorStrategy,
  type BdiSnapshot,
  type EmotionLabel,
  type EngineSessionPort,
  type EngineTurnInput,
  type EngineTurnOutput,
  type Intention,
  type MemoryHit,
  type MemoryStore,
  type RenderContextTurn,
  type RenderSpec,
  type RenderTokenBudget,
  type SafetyVerdict,
  type TrajectoryTrace,
} from '../../engine-core/index.js';
import type { ChatMessage } from '../../llm/common/interfaces/chat-provider.interface.js';
import type { DeliberationMode } from '../deliberation/deliberation-types.js';
import { computeRuleDelta, type DeliberationShadowPort } from '../deliberation/llm-deliberation.service.js';
import type { RollingSummaryPort } from '../persistence/rolling-session-summary.service.js';

/**
 * 会话归属 (写工作记忆所需的 tenant / visitor / session 三元组).
 *
 * 门面自己**不知道**这些 —— 内核会话端口没有"由句柄反查归属"的方法
 * (句柄是运行时维度, 归属是业务维度). 所以归属由装配层注入解析函数.
 */
export interface TurnSessionContext {
  /** 租户隔离键. */
  readonly tenantId: string;
  /** 业务会话 id. */
  readonly sessionId: string;
  /** 稳定来访者 id. */
  readonly visitorId: string;
  /**
   * 角色代号 (如 '晚晴'; 仅供 dev 调试日志核对 prompt 拼装).
   *
   * V2026-10-29 治本 (WP9-C): 归属登记表是**装配层**唯一同时知道"业务会话是谁"
   * 与"这场用的是哪个角色"的地方, 所以代号登记在这里. 它**不进 prompt** ——
   * 模型不该看见自己的角色名 (那会让它开始扮演"角色"而不是"来访者").
   */
  readonly characterLabel?: string;
  /**
   * 学员账号 id (V2026-11-05 WP64).
   *
   * 用途: **LLM 审议的计费 / 审计归属** (`CounselorLlmJsonClient` 要求 userId 非空,
   * `LlmService` 缺 userId 会同步抛). 装配层从 voice 侧的开场参数带进来.
   *
   * 缺省 = 空 = 审议层跳过这一轮 (见 `shadowDeliberation`): 与其拿一个假 id 去记账,
   * 不如不记 —— 归属错账比没账更难查.
   */
  readonly userId?: string;
  /**
   * 角色种子简述 (依恋风格 + 大五人格) (V2026-11-05 WP64).
   *
   * 用途: 审议 prompt 的「角色背景」块 —— 让审议模型知道来访者的**底色**,
   * 否则它只能从本轮对话猜人设 (而规则算子本来就有这份底色).
   *
   * 缺省 = 空 = prompt 写「（未提供角色背景）」(WP63 的既有占位口径).
   */
  readonly characterBrief?: string;
  /**
   * 表达风格三字段 (WP41): 角色"天生怎么说话".
   *
   * 为什么登记在**会话归属**里 (与 characterLabel 同一处):
   *   归属登记表是**装配层唯一同时知道"业务会话是谁"与"这场用的是哪个角色"的位置**
   *   (见 characterLabel 的注释). 表达风格同性质 —— 它是角色的属性, 不是本轮状态,
   *   整个会话不变, 所以登记一次、每轮读同一份.
   *
   * 缺省 = 不带 = 渲染层不消费 = prompt 与 WP35 逐字不变 (零回归).
   */
  readonly speechVolumeBaseline?: RenderSpec['speechVolumeBaseline'];
  readonly narrativeStyle?: RenderSpec['narrativeStyle'];
  readonly expressionTone?: RenderSpec['expressionTone'];
}

/**
 * 本轮渲染规格摘要 (V2026-10-30 WP19-R · 每轮留痕).
 *
 * 为什么是"摘要"而不是整个 RenderSpec:
 *   内核 RenderSpec 含**全量**角色内容 (核心信念 / 敏感议题 / 禁止行为…) ——
 *   那是"这一轮模型看到的全部", 落库等于把角色剧本抄进调试表.
 *   留痕只需要"这轮用哪种任务档 / 多少 token 预算 / 多深思考 / prompt 长什么样".
 */
export interface RenderSpecSummary {
  /** 任务分层 (stable / chat / advanced). */
  readonly taskKind: string;
  /** system prompt 预览 (至多 500 字; 缺省 = 渲染端口没给). */
  readonly promptPreview: string;
  /** 本轮实际下发的生成长度上限 (thinking token 计入). */
  readonly maxCompletionTokens: number;
  /** 本轮实际下发的思考强度 (缺省 = 上游默认档). */
  readonly reasoningEffort: string;
}

/**
 * 门面单轮返回.
 */
export interface TurnRenderResult {
  /** 本轮来访口语 (渲染文本; 降级时为中性兜底句). */
  readonly reply: string;
  /** 内核本轮快照 (透传). */
  readonly snapshot: BdiSnapshot;
  /** 本会话累计轮次 (透传). */
  readonly turnIndex: number;
  /** 本轮意图 (透传; 内核未产出时省略). */
  readonly intention?: Intention;
  /** 渲染元信息 (供观测, 不进内核). */
  readonly render: {
    /** 是否走过备用路径 (切过备 / 走过 block 重生成 / 走过降级). */
    readonly fallbackUsed: boolean;
    /** 实际提供服务的候选标识 (降级时为 'degraded'). */
    readonly providerHint?: string;
    /** 用量 (仅供观测, 不作计费依据). */
    readonly usage?: {
      readonly completionTokens: number;
      readonly totalTokens: number;
      /**
       * 输入 token (WP24 · 成本日志要按输入/输出两侧分别计价).
       *
       * 缺省 = 上游没报 —— **流式路径就是这种情况** (上游只给累计 tokenCount).
       * 缺省不等于 0: 0 是"输入侧确实没花钱", 缺省是"输入侧不可得", 两者意义不同.
       */
      readonly promptTokens?: number;
      /** 思考 token 数 (推理模型专用; V2026-10-29 WP9-C 增, 供探针核对思考量). */
      readonly reasoningTokens?: number;
    };
    /**
     * 本轮实际使用的模型名 (WP24 · 成本日志要按模型归集).
     *
     * 缺省 = 上游没报 / 本轮降级 (降级时没有"实际用的模型"这回事).
     */
    readonly model?: string;
    /**
     * 本轮渲染规格摘要 (V2026-10-30 WP19-R · 每轮留痕).
     *
     * 缺省 = 该渲染端口没给 (内核 RenderPort 契约不含 prompt 与厂商参数).
     */
    readonly spec?: RenderSpecSummary;
    /**
     * 上游结束原因 (V2026-10-30 WP19-R · 每轮留痕).
     *
     * `length` 意味着正文被上游按长度砍断 —— 没有它就分不清"说完了"与"被截断了".
     */
    readonly finishReason?: string;
    /**
     * 首 token 延迟 (ms; V2026-10-30 WP19-R · 每轮留痕).
     *
     * 缺省 = 该渲染端口没给.
     */
    readonly ttftMs?: number;
    /**
     * 本轮 system prompt **全文** (V2026-11-05 WP58 · 引擎调试面板).
     *
     * 缺省 = 调用方**没要** (`turnStream` 的 `includePromptFull` 没开) 或渲染端口没给.
     * 聚合路径 (`turn`) 恒不带 —— 内核契约里没有 prompt, 拿不到就别造.
     *
     * ⚠️ **不落库**: 留痕契约 (`TurnTrace.renderSpec`) 只取 `promptPreview` 那一列 ——
     *   全文含角色约束, 写进调试表等于摊开角色剧本 (WP19-R 的既定纪律).
     */
    readonly promptFull?: string;
  };
  /** 本轮轨迹观测 (透传; 仅注入剧本的会话携带). */
  readonly trajectoryTrace?: TrajectoryTrace;
  /** 本轮安全判定 (透传; 仅非 pass 时携带). */
  readonly safety?: SafetyVerdict;
  /** 跨会话开场上下文 (透传; 仅 resume 首论携带). */
  readonly openingContext?: readonly MemoryHit[];
  /**
   * 本轮学员侧处置决定 (V2026-11-02 WP14).
   *
   * 缺省 = **无处置** (action='none') —— 也就是"这轮没有危机信号, 学员侧无感知".
   * 为了**零回归**, 无处置时**不带这个键**: 既有调用方看到的形状逐字不变.
   * 有处置时:
   *   · action='toast' → 不阻断, AI 正常流式回复, 同时推一条 3 秒轻提示;
   *   · action='block' → **本轮不调 RenderPort.render** (reply 为空), 推全屏弹窗.
   */
  readonly disposal?: StudentRiskDecision;
}

/**
 * 门面构造依赖.
 */
export interface TurnRenderOrchestratorDeps {
  /** 内核会话端口 (openSession / turn / closeSession). */
  readonly session: EngineSessionPort;
  /** 渲染端口 (WP6 的 LlmRenderAdapter, 或任意实现; 支持流式扩展). */
  readonly renderer: StreamingRenderPort;
  /** 记忆仓储端口 (用于补写来访半边工作记忆). */
  readonly memories: MemoryStore;
  /**
   * 会话归属解析 (多会话门面用).
   *
   * 门面拿不到 tenant / visitor —— 内核会话端口没有"由句柄反查归属"的方法.
   * 由装配层 (WP8) 注入: 门面拿 handleId 去问装配层"这场会话是谁".
   */
  readonly resolveSession?: (handleId: string) => TurnSessionContext | undefined;
  /** 固定会话归属 (单会话门面用; 与 resolveSession 二选一, 解析函数优先). */
  readonly sessionContext?: TurnSessionContext;
  /** 规格组装器 (缺省用 buildRenderSpec). */
  readonly assembler?: (input: SpecAssemblyInput) => AdaptiveRenderSpec;
  /**
   * 滚动摘要读取口 (WP37; 缺省 = 本场不注入摘要).
   *
   * 缺省语义: **纯增强** —— 没装就只是"对话超过 8 轮之后模型不记得前面聊过什么",
   * 不影响会话开合, 更不影响既有轮次的渲染 (summary 不存在时 prompt 逐字不变).
   */
  readonly rollingSummary?: RollingSummaryPort;
  /** token 预算种子 (缺省 { maxCompletionTokens: 160, contextTokens: 512 }). */
  readonly tokenBudget?: RenderTokenBudget;
  /** 可注入时钟 (记忆条目发生时刻). */
  readonly now?: () => number;
  /** 可注入 id 工厂 (记忆条目 id). */
  readonly idFactory?: () => string;
  /** 兜底话术 (缺省 DEFAULT_TURN_FALLBACK_UTTERANCE). */
  readonly fallbackUtterance?: string;
  /**
   * 学员侧处置闸门 (V2026-11-02 WP14; 缺省 = 不做处置).
   *
   * 缺省语义: **纯放行** —— 没有闸门就只判不拦 (与本单之前逐字一致).
   * 装配层装上它之后, 门面会在**渲染前**问一次:
   *   ① 内核本轮判定是不是危机 (side/等级/类别三条边界);
   *   ② 重点监测中的场次 → 额外强制问一次远端, 与 ① 合并取更严的一档.
   * 判成 block 时**不调 RenderPort.render** —— 本轮 AI 不出声.
   */
  readonly studentRisk?: StudentRiskGate;
  /**
   * 影子审议端口 (V2026-11-05 WP64; 缺省 = 不跑影子审议).
   *
   * 缺省语义: **纯增强** —— 没装就只是"没有影子审议数据", 会话开合与渲染逐字不变.
   *
   * 为什么用**窄端口**而不是直接依赖 `LlmDeliberationService`:
   *   门面是纯类 (零 @nestjs), 依赖一个 Nest service 会把框架拖进来;
   *   窄端口让单测能用极小替身覆盖, 也让"装配缺席"退化成"没有审议"而不是"门面起不来".
   */
  readonly deliberation?: DeliberationShadowPort;
}

/**
 * 归一后的渲染结果 (区分"真话术"与"系统兜底产物").
 */
interface NormalizedRender {
  readonly text: string;
  /** 是否走过备用路径. */
  readonly fallbackUsed: boolean;
  /** 文本是否为**系统兜底产物** (不是来访真说的话). */
  readonly degraded: boolean;
  readonly providerHint?: string;
  readonly usage: {
    readonly completionTokens: number;
    readonly totalTokens: number;
    /** 输入 token (缺省 = 上游没报; 流式路径即如此). */
    readonly promptTokens?: number;
    /** 思考 token (缺省 = 上游没报). */
    readonly reasoningTokens?: number;
  };
  /** 本轮实际使用的模型名 (缺省 = 上游没报 / 降级). */
  readonly model?: string;
  /**
   * 本轮渲染规格摘要 (V2026-10-30 WP19-R · 留痕).
   *
   * 缺省 = 该渲染端口没给 (内核 RenderPort 契约不含 prompt 与厂商参数).
   */
  readonly spec?: RenderSpecSummary;
  /** 上游结束原因 (V2026-10-30 WP19-R · 留痕; 缺省 = 上游没报). */
  readonly finishReason?: string;
  /** 首 token 延迟 (ms; V2026-10-30 WP19-R · 留痕; 缺省 = 渲染端口没给). */
  readonly ttftMs?: number;
  /**
   * 本轮 system prompt **全文** (V2026-11-05 WP58 · 引擎调试面板).
   *
   * 缺省 = 调用方**没要** (`turnStream` 的 `includePromptFull` 没开) 或渲染端口没给;
   * 聚合路径 (`turn`) 恒缺省 (内核契约里没有 prompt).
   */
  readonly promptFull?: string;
}

/**
 * 默认 token 预算 (种子值, 未标定).
 *
 * 与内核 WP5 的 DEFAULT_COMPLETION_TOKENS 对齐; 上下文预算 512 是
 * "够放最近 8 轮口语" 的工程估计, WP8 接真实模型后按上下文窗口校准.
 *
 * V2026-10-29 治本 (WP9-C): 完成上限从 **160 提到 1500** ——
 *   160 这个数是按"不需要思考"定的, 但生产用的 MiniMax-M3.1-Flash 是**推理模型**:
 *   思考 token **计入**生成长度上限 (实测: 一次普通回答里思考就吃掉 94 token),
 *   160 的预算里思考先吃 94, 留给口语的只剩几十个 token —— 来访"开口"都说不完整.
 *   1500 的分法 (任务单 §2.1): 思考 ~700-1000, 输出 ~500-800 (约 3-6 句中文);
 *   LLM 不凑满预算, 只为实际输出付费, 所以上限放宽不等于账单变贵.
 */
export const DEFAULT_TURN_TOKEN_BUDGET: RenderTokenBudget = { maxCompletionTokens: 1500, contextTokens: 512 };

/**
 * 来访半边工作记忆的重要度 (中性值, 与内核工作记忆口径一致).
 */
export const VISITOR_MEMORY_IMPORTANCE = 0.5;

/**
 * 兜底话术 (中性、不越界、不给建议、不承诺).
 *
 * V2026-10-29 治本 (WP9-C): 兜底句的**唯一真相**在渲染配置层的话术池
 * (`DEFAULT_RENDER_FALLBACK_UTTERANCES`). 这里取池里第一句作为"门面自己兜底"
 * (渲染器抛异常 / 返回空) 的默认 —— 门面兜底与渲染降级是两种失败, 但说的是同一类话,
 * 不该有两份文案 (两份文案一旦漂移, 同一句兜底会出现两种语气).
 */
export const DEFAULT_TURN_FALLBACK_UTTERANCE: string = DEFAULT_RENDER_FALLBACK_UTTERANCES[0] ?? '……我先缓一下，我们接着说。';

/**
 * 门面保留的最近对话轮数上限 (一问一答算两轮).
 *
 * 与内核工作记忆窗口同源 (8 轮 = 16 半轮): 门面持有的历史只是**给模型看的上下文**,
 * 不是决策依据, 不必比内核的工作记忆窗口更宽 —— 更宽只会让 prompt 更贵、
 * 更稀释当前议题.
 */
export const MAX_HISTORY_TURNS = WORKING_MEMORY_WINDOW_TURNS * 2;

/**
 * 影子审议用的会话模式 (V2026-11-05 WP64).
 *
 * 为什么固定 `freeform`:
 *   引擎 turn 管道 today 只服务**语音对练** (自由练习 / 全真执业) —— 两者都是**零压域**
 *   (AGENTS.md §5.3: 分数只允许出现在 MCQ 备考频道). MCQ 备考频道走的是另一条链路
 *   (training-exercises), **不经过** `engineSession.turn()`, 所以审议管道此刻**只该**用
 *   自由练习那套 prompt 措辞.
 *
 *   将来 MCQ 频道接进引擎管道时, 这里改成"按会话归属分发"即可 (prompt 模板两种早已备好,
 *   见 deliberation-prompt.ts) —— 但那之前**不能**猜: 用考核措辞去审自由练习的对话,
 *   会把"判定标准更严"的偏置带进对比数据, PoC 的差异统计就失真了.
 */
const DELIBERATION_SHADOW_MODE: DeliberationMode = 'freeform';

/**
 * 决策→说话装配门面 (纯类, 非 NestJS).
 */
export class TurnRenderOrchestrator {
  private readonly deps: TurnRenderOrchestratorDeps;
  private readonly tokenBudget: RenderTokenBudget;
  private readonly fallbackUtterance: string;
  private readonly now: () => number;
  private readonly idFactory: () => string;
  /** 每个句柄的最近对话序列 (旧 → 新). */
  private readonly histories = new Map<string, RenderContextTurn[]>();
  /**
   * 每个句柄**上一轮结束时的** BDI 快照 (V2026-11-05 WP64 · 影子审议用).
   *
   * 为什么门面要自己记一份:
   *   影子审议要比对"规则算子的 delta"与"LLM 审议的 delta", 而内核 `turn()` 的出口
   *   **只有本轮结束后的快照** —— 起始快照是它内部的局部变量 (`base.snapshot`),
   *   拿不到 (内核零改动是本期红线, 不可能加一个出口字段).
   *   于是适配层自己记一份"上一轮结束时的快照": 下一轮开始时它**就是**本轮的起始快照.
   *
   *   为什么这份记忆是**逐字准确**的: 内核在同一场会话内, 下一轮载入的状态就是上一轮
   *   落库的那份 (`loadState` 的"本场已有状态"分支优先命中, 不再衰减) —— 两者相等.
   *   ⚠️ 唯一的例外是**跨会话接续的第一轮**: 那时内核会先做一次自然衰减 (WP36),
   *     而门面没有接续前的快照 → 这一轮**跳过**影子审议 (见 `shadowDeliberation`).
   *
   * 生命周期: 与 `histories` 同生命周期 (会话关闭时由 `forgetSession` 一起清).
   */
  private readonly lastSnapshots = new Map<string, BdiSnapshot>();

  constructor(deps: TurnRenderOrchestratorDeps) {
    this.deps = deps;
    this.tokenBudget = deps.tokenBudget ?? DEFAULT_TURN_TOKEN_BUDGET;
    this.fallbackUtterance = deps.fallbackUtterance ?? DEFAULT_TURN_FALLBACK_UTTERANCE;
    this.now = deps.now ?? Date.now;
    this.idFactory = deps.idFactory ?? (() => nanoid());
  }

  /**
   * 执行一轮"决策 → 说话".
   *
   * @param handleId 内核会话句柄
   * @param input 本轮入参 (咨询师文本)
   * @returns 本轮来访口语 + 内核出参透传 + 渲染元信息
   * @throws 内核会话端口抛出的错误原样冒泡 (ABORTED / INVALID_INPUT / SESSION_NOT_FOUND)
   */
  async turn(handleId: string, input: EngineTurnInput): Promise<TurnRenderResult> {
    // 1. 内核决策 (错误原样冒泡 —— 门面只兜"渲染这块", 不兜内核).
    //    V2026-11-02 (WP14): 用探测来源通道包住这一段 —— 内核判定在会话端口内部发生,
    //    调用方拿不到"这一轮是谁判的"; 通道记下来, 审计表才有 source 列可填.
    const { value: output, source } = await runWithProbeSource(() => this.deps.session.turn(handleId, input));

    // 1.5 学员侧处置判定 (WP14): side/等级/类别三条边界 + 监测场次的强制远端探测.
    const disposal = await this.resolveDisposal(handleId, input.userText, output.safety, source);

    // 1.6 阻断: block 级危机 → **不调 RenderPort.render** (本轮 AI 不出声), 会话不销毁.
    if (disposal.action === 'block') {
      await this.settleBlockedTurn(handleId, input.userText);
      return this.blockedResult(output, disposal);
    }

    // 2. 组装规格: 历史 = 已累积对话 + 本轮咨询师输入 (当前轮必须在场, 否则模型无从回应).
    const history = this.historyOf(handleId);
    const spec = this.assemble(output, [...history, { role: 'counselor', text: input.userText }], handleId);

    // 3. 渲染 (异常 / 空文本 → 兜底, 永不 reject).
    const rendered = await this.renderSafely(spec);

    // 4. 回填前的落账: 历史 + 来访半边工作记忆.
    await this.settleTurn(handleId, input.userText, rendered);

    // 4.5 影子审议 (WP64): 旁路跑一次 LLM 审议, **不生效** (结果只进 Redis trace 表).
    //     fire-and-forget: 不 await, 主流程响应时间不受审议影响.
    this.shadowDeliberation(handleId, input, output, rendered.text, spec.intention.strategy);

    // 5. 组装返回 (内核出参逐字透传, 外面包一层 render 元信息与真实 reply).
    return {
      reply: rendered.text,
      snapshot: output.snapshot,
      turnIndex: output.turnIndex,
      ...(output.intention ? { intention: output.intention } : {}),
      render: {
        fallbackUsed: rendered.fallbackUsed,
        ...(rendered.providerHint ? { providerHint: rendered.providerHint } : {}),
        usage: rendered.usage,
        ...(rendered.model ? { model: rendered.model } : {}),
        ...(rendered.spec ? { spec: rendered.spec } : {}),
        ...(rendered.finishReason ? { finishReason: rendered.finishReason } : {}),
        ...(rendered.ttftMs === undefined ? {} : { ttftMs: rendered.ttftMs }),
      },
      ...(output.trajectoryTrace ? { trajectoryTrace: output.trajectoryTrace } : {}),
      ...(output.safety ? { safety: output.safety } : {}),
      ...(output.openingContext ? { openingContext: output.openingContext } : {}),
      ...(disposal.action === 'none' ? {} : { disposal }),
    };
  }

  /**
   * 执行一轮"决策 → 说话" (**流式**).
   *
   * 与 `turn()` **共用**同一套闭环: 内核决策 → 组装规格 → 取文 → 落账 → 组装返回.
   * 两者只差"取文的方式": 聚合是一次性拿全文, 流式是边生成边把增量交给消费方.
   * 所以历史 / 记忆 / 落账逻辑**不复制** —— 复制一份必然出现"聚合路径记得、流式
   * 路径忘得"这种只有单测能发现的分裂.
   *
   * 降级语义与聚合路径对齐: 渲染降级 → 只追加咨询师半边, **不写**来访半边记忆
   * (兜底句不是来访真说的话).
   *
   * @param handleId 内核会话句柄
   * @param input 本轮入参 (咨询师文本)
   * @param handlers 增量回调面 (onDelta / signal)
   * @param options 附加选项 (V2026-11-05 WP58)
   * @returns 本轮来访口语 + 内核出参透传 + 渲染元信息
   * @throws 内核会话端口抛出的错误原样冒泡 (ABORTED / INVALID_INPUT / SESSION_NOT_FOUND)
   */
  async turnStream(
    handleId: string,
    input: EngineTurnInput,
    handlers: StreamRenderHandlers,
    options?: { readonly includePromptFull?: boolean },
  ): Promise<TurnRenderResult> {
    // 1. 内核决策 (与 turn() 同一入口, 错误同样原样冒泡; 探测来源通道同样包住这一段).
    const { value: output, source } = await runWithProbeSource(() => this.deps.session.turn(handleId, input));

    // 1.5 学员侧处置判定 (WP14): 与聚合路径**同一份**判定, 不复制一份流式专属逻辑.
    const disposal = await this.resolveDisposal(handleId, input.userText, output.safety, source);

    // 1.6 阻断: block 级危机 → 不流式取文 (本轮 AI 不出声), 会话不销毁.
    if (disposal.action === 'block') {
      await this.settleBlockedTurn(handleId, input.userText);
      return this.blockedResult(output, disposal);
    }

    // 2. 组装规格 (历史 + 本轮咨询师输入).
    const history = this.historyOf(handleId);
    const spec = this.assemble(output, [...history, { role: 'counselor', text: input.userText }], handleId);

    // 3. 流式取文 (增量经 onDelta 转发; 异常 / 空文本 → 兜底, 永不 reject).
    //    ⚠️ prompt 全文**按需取** (WP58): 默认不带 (语音主链路不需要, 也不该把角色约束
    //    天天带在主链路的返回体里); 只有调试面板显式要才带.
    const rendered = await this.streamSafely(spec, handlers, options?.includePromptFull === true);

    // 4. 落账 (与 turn() 共用 settleTurn: 历史 + 来访半边工作记忆).
    await this.settleTurn(handleId, input.userText, rendered);

    // 4.5 影子审议 (WP64): 与聚合路径**同一处**旁路调用, 不复制一份流式专属逻辑.
    this.shadowDeliberation(handleId, input, output, rendered.text, spec.intention.strategy);

    // 5. 组装返回 (与 turn() 同构).
    return {
      reply: rendered.text,
      snapshot: output.snapshot,
      turnIndex: output.turnIndex,
      ...(output.intention ? { intention: output.intention } : {}),
      render: {
        fallbackUsed: rendered.fallbackUsed,
        ...(rendered.providerHint ? { providerHint: rendered.providerHint } : {}),
        usage: rendered.usage,
        ...(rendered.model ? { model: rendered.model } : {}),
        ...(rendered.spec ? { spec: rendered.spec } : {}),
        ...(rendered.finishReason ? { finishReason: rendered.finishReason } : {}),
        ...(rendered.ttftMs === undefined ? {} : { ttftMs: rendered.ttftMs }),
        ...(rendered.promptFull === undefined ? {} : { promptFull: rendered.promptFull }),
      },
      ...(output.trajectoryTrace ? { trajectoryTrace: output.trajectoryTrace } : {}),
      ...(output.safety ? { safety: output.safety } : {}),
      ...(output.openingContext ? { openingContext: output.openingContext } : {}),
      ...(disposal.action === 'none' ? {} : { disposal }),
    };
  }

  /**
   * 丢弃某句柄的会话历史 (会话关闭时调用).
   *
   * 门面是长生命周期对象 (一个实例服务多场会话), 历史必须能被显式释放 ——
   * 否则每场会话的对话都留在内存里, 是缓慢的内存泄漏.
   *
   * @param handleId 内核会话句柄
   */
  forgetSession(handleId: string): void {
    this.histories.delete(handleId);
    // WP64: 影子审议的"上一轮快照"与历史同生命周期 —— 一起清, 不留残留.
    this.lastSnapshots.delete(handleId);
  }

  /**
   * 影子审议 (V2026-11-05 WP64): 旁路跑一次 LLM 审议, **结果不生效**.
   *
   * 三条硬纪律 (任务单 §1.3 / §4.2):
   *   ① 不 await —— fire-and-forget, 主流程响应时间不受审议影响;
   *   ② 不 await 也不 catch 到主流程 —— 异常在审议服务内部吞掉, 这里再兜一层;
   *   ③ 结果只写 Redis trace 表 —— **绝不**回写 BDI 快照.
   *
   * 什么时候**跳过**这一轮 (都是"缺数据", 不是"出错"):
   *   · 没装审议端口 (装配缺席 = 没有影子审议这个能力);
   *   · 没有上一轮快照 (会话的**第一轮** —— 起始快照还没被记下来; 跨会话接续的第一轮同理);
   *   · 拿不到会话归属 (归属登记表里没有这场会话);
   *   · 归属里没有学员账号 id (LLM 调用要求 userId 非空 —— 与其拿假 id 记账, 不如不记).
   *
   * @param handleId 内核会话句柄
   * @param input 本轮入参 (咨询师文本)
   * @param output 内核本轮出参 (含本轮结束后的快照)
   * @param visitorText 本轮来访的渲染文本
   */
  private shadowDeliberation(
    handleId: string,
    input: EngineTurnInput,
    output: EngineTurnOutput,
    visitorText: string,
    ruleStrategy: BehaviorStrategy,
  ): void {
    const deliberation = this.deps.deliberation;
    if (!deliberation) return;
    // 本轮开始时的快照 = 上一轮结束时记下的那份 (首轮没有 → 跳过).
    const baseSnapshot = this.lastSnapshots.get(handleId);
    // 记下本轮结束后的快照, 供下一轮当"起始快照"用.
    this.lastSnapshots.set(handleId, output.snapshot);
    if (!baseSnapshot) return;

    const context = this.resolveContext(handleId);
    if (!context) return;
    const userId = (context.userId ?? '').trim();
    if (!userId) return;

    try {
      void deliberation
        .runShadowMode({
          sessionId: context.sessionId,
          tenantId: context.tenantId,
          userId,
          turnIndex: output.turnIndex,
          mode: DELIBERATION_SHADOW_MODE,
          baseSnapshot,
          counselorText: input.userText,
          visitorText,
          characterBrief: context.characterBrief ?? '',
          ruleDelta: computeRuleDelta(baseSnapshot, output.snapshot),
          // WP68: 意图锁定需要知道"规则算子本轮选的策略" —— 审议层拿不到内核意图
          //   (意图是每轮派生输出, 不在快照里), 所以由门面传进去.
          //   ⚠️ 取 `spec.intention.strategy` (本轮渲染**实际用的**那个策略,
          //   内核意图缺失时有中性兜底 `simple_response`) —— 不是猜一个.
          ruleStrategy,
        })
        .catch((error: unknown) => {
          // 审议服务承诺不抛 —— 这一层是**防御**: 万一它抛了, 也不能炸主流程.
          warn(`[shadow] 审议调用异常 (已忽略): ${errorMessage(error)}`);
        });
    } catch (error) {
      warn(`[shadow] 审议调用异常 (已忽略): ${errorMessage(error)}`);
    }
  }

  /**
   * 组装渲染规格 (走注入的组装器, 缺省内核口径的 buildRenderSpec).
   *
   * 角色代号从**会话归属登记表**取 (装配层唯一同时知道业务会话与角色的位置);
   * 取不到 → 不带 (等价于中性基线, prompt 与日志都不提角色).
   */
  private assemble(output: EngineTurnOutput, recentTurns: readonly RenderContextTurn[], handleId: string): AdaptiveRenderSpec {
    const assembler = this.deps.assembler ?? buildRenderSpec;
    const context = this.resolveContext(handleId);
    const characterLabel = context?.characterLabel;
    // WP37: 本场滚动摘要 (工作窗口挤出的早期轮次被压缩后的产物).
    //   没有摘要 → 不带这个键 → 规格与 prompt 逐字不变 (零回归).
    const sessionSummary = this.resolveSessionSummary(handleId);
    return assembler({
      output,
      recentTurns,
      tokenBudget: this.tokenBudget,
      ...(characterLabel ? { characterLabel } : {}),
      ...(sessionSummary ? { sessionSummary } : {}),
      // WP41: 表达风格三字段 —— 从**会话归属**取 (装配层登记的角色基线, 整个会话不变).
      //   没登记 → 不带这些键 → 规格与 prompt 逐字不变 (零回归).
      ...(context?.speechVolumeBaseline === undefined ? {} : { speechVolumeBaseline: context.speechVolumeBaseline }),
      ...(context?.narrativeStyle === undefined ? {} : { narrativeStyle: context.narrativeStyle }),
      ...(context?.expressionTone === undefined ? {} : { expressionTone: context.expressionTone }),
    });
  }

  /**
   * 取本场当前的滚动摘要 (WP37).
   *
   * 归属从 `resolveSession` 缝拿 (tenantId + sessionId) —— 滚动摘要按**租户 + 会话**
   * 隔离, 只拿 handleId 是取不到的.
   *
   * @param handleId 内核会话句柄
   * @returns 摘要正文; 本场还没有摘要 / 没装滚动摘要服务时返回 undefined
   */
  private resolveSessionSummary(handleId: string): string | undefined {
    const port = this.deps.rollingSummary;
    if (!port) return undefined;
    const context = this.resolveContext(handleId);
    if (!context) return undefined;
    try {
      return port.latestSummary(context.tenantId, context.sessionId);
    } catch {
      // 摘要取不到是增强缺失, 不是渲染失败 (与 collectOpeningContext 同款理由).
      return undefined;
    }
  }

  /**
   * 渲染并归一: 成功 → 真实文本; 异常 / 空文本 → 兜底句 (永不 reject).
   */
  private async renderSafely(spec: RenderSpec): Promise<NormalizedRender> {
    try {
      const result = await this.deps.renderer.render(spec);
      const text = (result?.text ?? '').trim();
      if (!text) {
        warn('[turn] 渲染结果为空, 降级为中性兜底句');
        return this.degradedRender();
      }
      return {
        text,
        fallbackUsed: result.fallbackUsed,
        degraded: false,
        ...(result.providerHint ? { providerHint: result.providerHint } : {}),
        usage: {
          completionTokens: result.usage.completionTokens,
          totalTokens: result.usage.totalTokens,
          // WP24: 上游报了输入侧用量就带上去 (流式路径走不到这里, 那时也没有).
          ...(result.usage.promptTokens === undefined ? {} : { promptTokens: result.usage.promptTokens }),
        },
        ...(result.model ? { model: result.model } : {}),
        // V2026-10-30 治本 (WP19-R · 留痕): 聚合路径只有内核契约里的那几项 ——
        //   prompt / 厂商参数 / TTFT 拿不到就不编 (promptPreview 留空串).
        spec: this.buildSpecSummary(spec, {}),
      };
    } catch (error) {
      // 理论上 WP6 适配器已不 reject; 这里是防御 —— 换别的 RenderPort 实现时兜住.
      warn(`[turn] 渲染异常, 降级为中性兜底句: ${errorMessage(error)}`);
      return this.degradedRender();
    }
  }

  /**
   * 流式渲染并归一: 成功 → 真实文本; 异常 / 空文本 → 兜底句 (永不 reject).
   *
   * 渲染器没实现流式 (可选方法缺失) → 退化成"聚合取文 + 切段成增量".
   * 那只是**兜底形态** (字幕不再是一整段), 主路径永远是渲染器自己的流式.
   *
   * @param spec 本轮渲染规格
   * @param handlers 增量回调面
   * @param includePromptFull 是否把 system prompt **全文**带出去 (V2026-11-05 WP58)
   */
  private async streamSafely(spec: RenderSpec, handlers: StreamRenderHandlers, includePromptFull = false): Promise<NormalizedRender> {
    const renderer = this.deps.renderer;
    if (!renderer.streamRender) {
      warn('[turnStream] 渲染端口未实现流式, 回退聚合取文 + 切段成增量');
      const aggregated = await this.renderSafely(spec);
      for (const chunk of splitTextIntoDeltas(aggregated.text)) {
        await handlers.onDelta(chunk);
      }
      return aggregated;
    }
    try {
      const outcome = await renderer.streamRender(spec, handlers);
      const text = (outcome?.text ?? '').trim();
      if (!text) {
        warn('[turnStream] 流式渲染结果为空, 降级为中性兜底句');
        return this.degradedRender();
      }
      // 降级判定: 渲染器自报 degraded, 或兜底 providerHint —— 两者都表示
      // "这不是来访者完整说出来的真话", 不能写进工作记忆.
      const degraded = outcome.degraded || outcome.providerHint === 'degraded';
      return {
        text,
        fallbackUsed: outcome.fallbackUsed,
        degraded,
        ...(outcome.providerHint ? { providerHint: outcome.providerHint } : {}),
        usage: {
          completionTokens: outcome.usage.completionTokens,
          totalTokens: outcome.usage.totalTokens,
          ...(outcome.usage.promptTokens === undefined ? {} : { promptTokens: outcome.usage.promptTokens }),
          ...(outcome.usage.reasoningTokens === undefined ? {} : { reasoningTokens: outcome.usage.reasoningTokens }),
        },
        ...(outcome.model ? { model: outcome.model } : {}),
        // V2026-10-30 治本 (WP19-R · 留痕): 流式路径能拿到真值 (真值只在适配器里).
        spec: this.buildSpecSummary(spec, {
          ...(outcome.promptPreview === undefined ? {} : { promptPreview: outcome.promptPreview }),
          ...(outcome.maxCompletionTokens === undefined ? {} : { maxCompletionTokens: outcome.maxCompletionTokens }),
          ...(outcome.reasoningEffort === undefined ? {} : { reasoningEffort: outcome.reasoningEffort }),
        }),
        ...(outcome.finishReason === undefined ? {} : { finishReason: outcome.finishReason }),
        ...(outcome.ttftMs === undefined ? {} : { ttftMs: outcome.ttftMs }),
        // V2026-11-05 (WP58): prompt 全文**按需带出** —— 默认不带 (语音主链路不需要),
        //   调试面板显式要 (`includePromptFull`) 时才带.
        ...(includePromptFull && outcome.promptFull !== undefined ? { promptFull: outcome.promptFull } : {}),
      };
    } catch (error) {
      // 理论上渲染器的流式出口已不 reject; 这里是防御 —— 换别的渲染实现时兜住.
      warn(`[turnStream] 流式渲染异常, 降级为中性兜底句: ${errorMessage(error)}`);
      return this.degradedRender();
    }
  }

  /**
   * 构造渲染规格摘要 (WP19-R · 留痕).
   *
   * 口径: **有真值用真值, 没真值不编** ——
   *   · taskKind: 内核规格里有, 直接取;
   *   · maxCompletionTokens: 渲染端口报了真值就用真值 (分层默认 / 候选覆盖会改它),
   *     否则回落到内核 token 预算 (那是"至少允许这么多"的种子值);
   *   · reasoningEffort: 没报就是"上游默认档", 记 'unknown' 而不是编一个 low;
   *   · promptPreview: 没有就是空串 (内核契约不含 prompt, 拿不到就别造).
   *
   * @param spec 本轮内核渲染规格
   * @param actual 渲染端口报上来的真值 (缺省 = 什么都没报)
   * @returns 规格摘要
   */
  private buildSpecSummary(
    spec: RenderSpec,
    actual: { readonly promptPreview?: string; readonly maxCompletionTokens?: number; readonly reasoningEffort?: string },
  ): RenderSpecSummary {
    return {
      taskKind: spec.taskKind,
      promptPreview: actual.promptPreview ?? '',
      maxCompletionTokens: actual.maxCompletionTokens ?? spec.tokenBudget.maxCompletionTokens,
      reasoningEffort: actual.reasoningEffort ?? 'unknown',
    };
  }

  /**
   * 降级渲染结果 (系统兜底产物).
   */
  private degradedRender(): NormalizedRender {
    return {
      text: this.fallbackUtterance,
      fallbackUsed: true,
      degraded: true,
      providerHint: 'degraded',
      usage: { completionTokens: 0, totalTokens: 0 },
    };
  }

  /**
   * 落账: 历史追加 + 来访半边工作记忆.
   *
   * 历史与记忆的差别只在**降级**时:
   *   - 成功 → 历史追加"问 + 答", 并写一条来访半边的工作记忆;
   *   - 降级 → 历史只追加"问" (来访半边是系统兜底句, 不是来访真说的话;
   *     把它当"来访说了这句"喂回模型, 等于教模型输出兜底话术),
   *     且**不写**工作记忆 (兜底句不是来访的真实表达).
   */
  private async settleTurn(handleId: string, counselorText: string, rendered: NormalizedRender): Promise<void> {
    const history = this.historyOf(handleId);
    const next: RenderContextTurn[] = [...history, { role: 'counselor', text: counselorText }];
    if (!rendered.degraded) {
      next.push({ role: 'visitor', text: rendered.text });
    }
    this.setHistory(handleId, next);

    // WP55: 把这一轮**完整**记录 (咨询师话 + 来访者话) 交给滚动摘要服务.
    //   降级轮次 → 来访者侧记 null (兜底句不是来访者真说的话, 不能当成发言).
    this.reportRound(handleId, counselorText, rendered.degraded ? null : rendered.text);

    if (rendered.degraded) return;
    await this.writeVisitorMemory(handleId, rendered.text);
  }

  /**
   * 学员侧处置判定 (V2026-11-02 WP14).
   *
   * 两条证据合并:
   *   ① 内核本轮判定 (`SafetyVerdict`) —— 规则层 + 探测器, 口径与本单之前逐字一致;
   *   ② 重点监测场次的**强制远端探测** —— 本场已经出过一次 high, 后续每轮都强制问一次.
   * 合并口径: **取更严的一档** (宁可多弹一次提示, 不可漏掉一次危机).
   *
   * 缺省闸门 → 只用 ①, 行为与本单之前**逐字一致** (零回归).
   *
   * @param handleId 内核会话句柄
   * @param userText 学员本轮输入
   * @param safety 内核本轮判定
   * @param source 探测来源 (审计口径)
   * @returns 处置决定
   */
  private async resolveDisposal(
    handleId: string,
    userText: string,
    safety: SafetyVerdict | undefined,
    source: ProbeSource | undefined,
  ): Promise<StudentRiskDecision> {
    const base = buildStudentRiskDecision(safety, source);
    const gate = this.deps.studentRisk;
    if (!gate || !gate.isMonitored(handleId)) return base;
    try {
      const forced = await gate.forceRemoteProbe(userText, handleId);
      return mergeStudentRiskDecisions(base, forced);
    } catch (error) {
      // 强制探测失败**不许**把整场对练带崩 —— 按内核判定继续.
      warn(`[turn] 重点监测场次的强制远端探测失败, 按内核判定继续: ${errorMessage(error)}`);
      return base;
    }
  }

  /**
   * 阻断轮次的结果 (V2026-11-02 WP14).
   *
   * 形状与正常轮次**同构** (调用方不用分支): 只是
   *   · `reply` 为空 —— 本轮 AI 不出声;
   *   · `render.usage` 全 0 —— 本轮**没有调过** RenderPort.render, 没有用量;
   *   · `render.fallbackUsed=false` —— 不是渲染降级, 是**主动阻断** (两者语义不同).
   *
   * @param output 内核出参 (逐字透传)
   * @param disposal 处置决定 (action=block)
   * @returns 本轮结果
   */
  private blockedResult(output: EngineTurnOutput, disposal: StudentRiskDecision): TurnRenderResult {
    return {
      reply: '',
      snapshot: output.snapshot,
      turnIndex: output.turnIndex,
      ...(output.intention ? { intention: output.intention } : {}),
      render: {
        fallbackUsed: false,
        usage: { completionTokens: 0, totalTokens: 0 },
      },
      ...(output.trajectoryTrace ? { trajectoryTrace: output.trajectoryTrace } : {}),
      ...(output.safety ? { safety: output.safety } : {}),
      ...(output.openingContext ? { openingContext: output.openingContext } : {}),
      disposal,
    };
  }

  /**
   * 阻断轮次的落账 (V2026-11-02 WP14).
   *
   * 与 `settleTurn` 的差别只有一处: **来访半边没有内容**, 所以
   *   · 历史只追加"问" (不追加"答") —— 下一轮模型仍能看到学员说了什么;
   *   · **不写**来访半边工作记忆 —— 本轮来访者一个字都没说, 写进去就是造假.
   *
   * @param handleId 内核会话句柄
   * @param counselorText 学员本轮输入
   */
  private async settleBlockedTurn(handleId: string, counselorText: string): Promise<void> {
    const history = this.historyOf(handleId);
    this.setHistory(handleId, [...history, { role: 'counselor', text: counselorText }]);
    // WP55: 阻断轮次来访者**没有发言** → 记 null.
    //   记 null 而不是不记: "这一轮来访者没说话"是事实, 摘要里要如实反映;
    //   不记的话, 这一轮就会在配对时**错位**, 把下一轮的回答挂到这一轮上.
    this.reportRound(handleId, counselorText, null);
  }

  /**
   * 上报一轮完整对话给滚动摘要服务 (WP55).
   *
   * 为什么由**门面**上报 (而不是服务自己去找来访者的话):
   *   内核不渲染 —— 拿不到来访者的话 (内核工作窗口里只有咨询师原话).
   *   门面是渲染落账方, 手里有两侧, 而且两侧在**同一个轮次**里 → 配对不会错位.
   *
   * 失败处理: **吞掉异常** —— 摘要写失败是增强缺失, 不是渲染失败
   *   (与 `resolveSessionSummary` 同款理由).
   *
   * @param handleId 内核会话句柄
   * @param counselorText 本轮咨询师的话
   * @param visitorText 本轮来访者的回复; `null` = 来访者没发言
   */
  private reportRound(handleId: string, counselorText: string, visitorText: string | null): void {
    const port = this.deps.rollingSummary;
    if (!port) return;
    const context = this.resolveContext(handleId);
    if (!context) return;
    try {
      port.recordRound(context.tenantId, context.sessionId, context.visitorId, counselorText, visitorText);
    } catch {
      // 摘要上报失败是增强缺失, 不是渲染失败 (与 resolveSessionSummary 同款理由).
    }
  }

  /**
   * 写来访半边工作记忆 (内核已写咨询师半边, 这里只补另一半).
   */
  private async writeVisitorMemory(handleId: string, reply: string): Promise<void> {
    const context = this.resolveContext(handleId);
    if (!context) {
      warn('[turn] 未解析到会话归属 (tenant/visitor), 跳过来访半边工作记忆写入');
      return;
    }
    try {
      await this.deps.memories.remember({
        id: this.idFactory(),
        tenantId: context.tenantId,
        visitorId: context.visitorId,
        sessionId: context.sessionId,
        tier: MemoryTier.WORKING,
        source: MemorySource.TURN,
        content: reply,
        importance: VISITOR_MEMORY_IMPORTANCE,
        occurredAt: this.now(),
      });
    } catch (error) {
      warn(`[turn] 来访半边工作记忆写入失败 (不影响本轮回复): ${errorMessage(error)}`);
    }
  }

  /**
   * 解析会话归属: 注入的解析函数优先, 其次固定归属.
   */
  private resolveContext(handleId: string): TurnSessionContext | undefined {
    return this.deps.resolveSession?.(handleId) ?? this.deps.sessionContext;
  }

  /** 取句柄的最近对话序列. */
  private historyOf(handleId: string): readonly RenderContextTurn[] {
    return this.histories.get(handleId) ?? [];
  }

  /** 写入句柄的最近对话序列 (超上限丢最旧). */
  private setHistory(handleId: string, turns: readonly RenderContextTurn[]): void {
    this.histories.set(handleId, turns.slice(-MAX_HISTORY_TURNS));
  }
}

// ────────────────────────────────────────────────────────────────────
// 中文来访风格 system prompt (仅适配层; 内核不含任何 prompt)
// ────────────────────────────────────────────────────────────────────

/**
 * 行为策略 → 中文标签 (穷尽映射).
 *
 * 用穷尽 Record 而不是查表兜底: 新增策略时 TS 会直接报错, 逼着补上中文标签 ——
 * 否则策略名会以英文原样出现在 prompt 里, 模型既看不懂也不该看到.
 */
const STRATEGY_LABEL: Readonly<Record<BehaviorStrategy, string>> = {
  simple_response: '简单回应',
  request: '提出请求',
  recounting: '复述一段经历',
  cognitive_exploration: '探索想法',
  affective_exploration: '探索情绪',
  insight: '产生一点领悟',
  discussing_plans: '讨论下一步打算',
  resistance: '回避与抵抗',
};

/**
 * 情绪标签 → 中文标签 (穷尽映射).
 */
const EMOTION_LABEL: Readonly<Record<EmotionLabel, string>> = {
  neutral: '平静',
  sad: '低落',
  anxious: '焦虑',
  angry: '愤怒',
  hurt: '受伤',
  guarded: '戒备',
  relieved: '松了口气',
  hopeful: '有点希望',
  ashamed: '羞愧',
  empty: '空落',
};

/**
 * 构造来访者视角的消息序列 (system 模板 + 历史).
 *
 * 注入位置: WP6 适配器构造时的 `buildMessages` 缝 —— 渲染端口只收 spec,
 * 消息怎么拼是**渲染执行侧**的事, 所以模板与拼装都在适配层, 内核零 prompt.
 *
 * 角色映射: 咨询师 → `user`, 来访 → `assistant` (模型扮演来访者, 所以咨询师
 * 的话是"对方说的", 来访自己说过的话是"我说过的").
 *
 * @param spec 渲染规格
 * @returns 消息序列
 */
export function buildVisitorMessages(spec: AdaptiveRenderSpec): ChatMessage[] {
  logPromptCharacterFragment(spec);
  return [
    { role: 'system', content: buildVisitorSystemPrompt(spec) },
    ...spec.recentTurns.map((turn) => ({
      role: turn.role === 'counselor' ? ('user' as const) : ('assistant' as const),
      content: turn.text,
    })),
  ];
}

/**
 * 本轮"话量权重" (短 / 中 / 长).
 *
 * 来源: **内核 turn 决策结果** (阻抗 / 信任 / 行为策略) —— 不是前端传的.
 * 前端没有资格决定"这轮该说几句": 那是 BDI 算完的东西, 前端再传一份就成了
 * 第二份真相, 且必然与内核漂移.
 */
type TurnVerbosity = 'short' | 'medium' | 'long';

/**
 * 由内核状态解析话量权重.
 *
 * 判定口径:
 *   - 短: 话量阻抗高 / 信任低 / 本轮策略就是回避 —— 这轮该躲着说;
 *   - 长: 话量阻抗低 + 信任不低 + 策略偏探索/领悟 —— 这轮愿意展开;
 *   - 中: 其余 (按平时的样子说话).
 *
 * WP41: 判据**一个字没改** (0.55 / 0.3 / 信任 / 策略列表全部原样), 只是多了一个
 *   **基线修正**: 角色"天生话多话少"会把**话量阻抗这个量本身**挪一点 ——
 *   天生话多的人同样的阻抗判不到"短", 天生话少的人反之.
 *   没有话量基线 (undefined) → 修正量为 0 → 判定与 WP35 **逐字一致** (零回归).
 *
 * @param spec 渲染规格
 * @returns 话量权重
 */
function resolveTurnVerbosity(spec: AdaptiveRenderSpec): TurnVerbosity {
  // WP41: 话量基线修正 —— 修正的是"阻抗这个量", 不是判据本身.
  //   修正量 = (基线 - 中位 0.5) × 权重; 基线 0.5 = 中位 = 修正量为 0.
  const verbal = spec.resistance.verbal - resolveSpeechVolumeShift(spec.speechVolumeBaseline);
  const strategy = spec.intention.strategy;
  if (verbal >= 0.55 || spec.trust <= 0.3 || strategy === 'resistance') return 'short';
  if (
    verbal <= 0.3 &&
    spec.trust >= 0.55 &&
    (strategy === 'cognitive_exploration' || strategy === 'affective_exploration' || strategy === 'insight' || strategy === 'recounting')
  ) {
    return 'long';
  }
  return 'medium';
}

/**
 * 话量基线对"话量阻抗"的修正量 (WP41).
 *
 * 口径: 基线 [0,1], 0.5 = 中位 (不修正); 修正量 = (基线 - 0.5) × 权重.
 *   基线 0.8 (天生话多) → 修正量 +0.15 → 阻抗被"看低" 0.15 → 同样的阻抗判不到"短";
 *   基线 0.3 (天生话少) → 修正量 -0.15 → 阻抗被"看高" 0.15 → 同样的阻抗就判"短".
 *
 * 为什么权重是 0.5 (而不是 1):
 *   修正量会把**整条档位阶梯平移**: "短"的门槛 0.55 + 修正量, "长"的门槛 0.3 + 修正量.
 *   权重 0.5 时, 极端基线 (0 或 1) 把阶梯平移 0.25 = 恰好一个档位间距 —— 三档仍然
 *   都够得着 (短门槛最高 0.80 / 长门槛最低 0.05). 权重 1 时, 天生极话多的角色
 *   "短"的门槛会涨到 1.05 (**永远够不着** = 直接删掉一档), 天生极话少的角色
 *   "长"的门槛会掉到 -0.2 (同样够不着) —— 那就不是"修正"而是"改判据"了.
 *
 * 为什么**信任与策略不参与修正**:
 *   话量基线说的是"声音大小" (这个人平时话多话少), 信任低 / 策略是回避说的是
 *   "这一刻愿不愿意说" —— 后者与音量无关 (一个天生话多的人, 不想说时也不出声).
 *   把两者混在一起 = 让"话多"抵消"不想说", 那是错的.
 *
 * 为什么这里**再夹一次** [0,1] (registry 已经夹过):
 *   两处夹取不是两份真相: registry 那处是**数据卫生** (脏值不进内核契约),
 *   这里那处是**本层的口径解释** (基线的取值域与中位点由渲染层定义). 别的生产者
 *   直接造 RenderSpec 时给个 1.5, 这里不能跟着算.
 *
 * ⚠️ 权重与中位点是**工程种子值, 非临床标定** —— 待真实对练校准.
 *
 * @param baseline 话量基线 (缺省 = 没表态 = 不修正)
 * @returns 修正量 (正值 = 阻抗被看低 = 更容易判"长")
 */
function resolveSpeechVolumeShift(baseline: number | undefined): number {
  if (baseline === undefined || !Number.isFinite(baseline)) return 0;
  const clamped = Math.min(1, Math.max(0, baseline));
  return (clamped - 0.5) * SPEECH_VOLUME_SHIFT_WEIGHT;
}

/**
 * 话量基线的最大修正幅度 (WP41).
 *
 * 基线从中位 0.5 挪到端点 (0 或 1) 时, 修正量为 ±0.25 = 一个档位间距 ——
 * 整条档位阶梯平移, 三档仍然都够得着 (见 resolveSpeechVolumeShift 的注释).
 */
const SPEECH_VOLUME_SHIFT_WEIGHT = 0.5;

/**
 * 话量权重 → prompt 指令 (给模型的是**可执行的描述**, 不是状态标签).
 */
const VERBOSITY_INSTRUCTION: Readonly<Record<TurnVerbosity, string>> = {
  short: '这轮你不太想多说：回答要短、要躲闪，可以用「嗯」「还好吧」「不知道」这类短回应。',
  medium: '这轮你按平时的样子说话，不刻意多讲，也不刻意收着。',
  long: '这轮你愿意多说一点：可以多解释几句，把你的想法讲清楚一些。',
};

/**
 * 本轮"语气疏离度" (疏离 / 中性 / 亲近) —— WP35 手法一.
 *
 * 为什么**在话量之外**再加一个语气维度:
 *   话量答的是"这轮说几句", 语气答的是"这轮用什么腔调说".
 *   阻抗高时只压话量, 腔调还是平的 —— "话说得短"和"说话像隔着层"是**两种不同的
 *   阻抗表现**, 后者才是临床上更贴近"阻抗"的那一种 (话少不等于不想让你进来).
 *
 * 为什么**不改** resolveTurnVerbosity 的判定口径:
 *   话量与语气是**两个正交维度**, 不是同一件事的两种说法. 本期只加维度, 不动既有
 *   判定 —— 话量三档的档位边界 (0.55 / 0.3 / 0.6) 一字未改.
 */
type TurnWarmth = 'distant' | 'neutral' | 'warm';

/**
 * 由内核状态解析语气疏离度.
 *
 * 判定口径:
 *   - 疏离: 表达风格阻抗高 / 信任低 / 安全感低 —— 这轮该"隔着点说";
 *   - 亲近: 信任高 + 安全感高 + 联结感不低 —— 这轮愿意露一点真话;
 *   - 中性: 其余 (按平时的样子).
 *
 * 为什么**疏离先判**:
 *   阻抗是这一轮最强的信号 —— 信任/安全感/联结感都高、但表达风格阻抗高, 也该是疏离
 *   (阻抗优先). 亲近则要求三个同盟信号同时成立, 是**更保守**的一档.
 *
 * 为什么 safety / bond 的 undefined 走"不拦"分支:
 *   RenderSpec 的 safety / bond 是**可选**字段 —— 别的生产者可能不带. 缺的那一维
 *   不该被当成"低" (那会把没带数据的规格判成疏离), 只能当成"不知道".
 *
 * ⚠️ 阈值 (0.55 / 0.3 / 0.6) 是**工程种子值, 非临床标定** —— 待真实对练校准.
 *
 * @param spec 渲染规格
 * @returns 语气疏离度
 */
function resolveTurnWarmth(spec: AdaptiveRenderSpec): TurnWarmth {
  if (spec.resistance.style >= 0.55 || spec.trust <= 0.3 || (spec.safety !== undefined && spec.safety <= 0.3)) {
    return 'distant';
  }
  if (spec.trust >= 0.6 && (spec.safety === undefined || spec.safety >= 0.6) && (spec.bond === undefined || spec.bond >= 0.3)) {
    return 'warm';
  }
  return 'neutral';
}

/**
 * 语气疏离度 → prompt 指令 (给模型的是**可执行的描述**, 不是状态标签).
 *
 * ⚠️ 文案是**工程种子值, 非临床标定** —— 待真实对练校准.
 */
const WARMTH_INSTRUCTION: Readonly<Record<TurnWarmth, string>> = {
  distant: '语气有点疏离：像在应付、像隔着一层，不太愿意真正投入。',
  neutral: '语气按平时的样子，不刻意亲近也不刻意疏远。',
  // 为什么"亲近"这一档**不写"愿意多说几句"**:
  //   话量归话量 (话量那一行已经说了这轮该说几句). 语气这一档若也带话量暗示,
  //   就会与话量**打架** —— 阻抗高但信任/安全感/联结感都高时, 两行会给出相反指令
  //   ("回答要短" vs "愿意多说几句"), 模型只能二选一, 另一条就等于白写.
  warm: '语气放松一点：没那么防备，愿意流露一点真实感受。',
};

/**
 * 情绪标签 → 表现方式 (WP35 手法二).
 *
 * 为什么在"标签 + 效价 + 唤醒"之外还要"这轮该怎么表现":
 *   内核给的是"我现在是焦虑" (标签 + 数值), 但模型拿到数字并不知道该**怎么说** ——
 *   焦虑是该语速快、该犹豫、还是该反复确认对方的意思? 光有标签, 表现是随机的.
 *   这一层把"状态"翻译成"语气与节奏", 让情绪真正落到话里.
 *
 * 为什么用**穷尽 Record** 而不是查表兜底 (与 STRATEGY_LABEL / EMOTION_LABEL 同范式):
 *   内核新增情绪标签时 TS 直接报错, 逼着补上中文表现 —— 而不是让新标签静默落到
 *   "中性"分支 (那等于新情绪永远没有表现方式).
 *
 * `base` = 该标签的常规表现; `high` = 同一标签在**高唤醒**下的另一种表现 ——
 *   焦虑与愤怒在" arousal 高"和"arousal 低"时说话方式明显不同 (急 vs 闷).
 *
 * `neutral` 的 base 是空串 —— 中性情绪**不给额外指令** (零回归底线).
 *
 * ⚠️ 文案是**工程种子值, 非临床标定** —— 待真实对练校准.
 */
const EMOTION_EXPRESSION: Readonly<Record<EmotionLabel, { readonly base: string; readonly high?: string }>> = {
  neutral: { base: '' },
  sad: { base: '这轮你情绪低落：语速偏慢、声音轻，可能会叹气或停顿。' },
  anxious: {
    base: '这轮你有点不安：话里带着不确定，可能会停顿一下再说。',
    high: '这轮你有点焦虑：语速偏快、容易犹豫、可能反复确认对方的意思。',
  },
  angry: {
    base: '这轮你有点不爽：语气有点硬，不太想多解释。',
    high: '这轮你有点恼火：语气冲一点、有点不耐烦。',
  },
  hurt: { base: '这轮你有点受伤：话里带着委屈，可能会停顿一下、声音轻一点。' },
  guarded: { base: '这轮你有点戒备：话里带着试探，不太愿意说真话。' },
  relieved: { base: '这轮你松了口气：语气放松、语速正常。' },
  hopeful: { base: '这轮你有点期待：语气放松一点，话里带点盼头。' },
  ashamed: { base: '这轮你有点羞愧：不太想被人细看，话会绕着说。' },
  empty: { base: '这轮你有点空：情绪淡淡的，回答起来有点费劲。' },
};

/**
 * "高唤醒"的分界 (WP35 手法二).
 *
 * 为什么是 0.6: 内核 `resolveEmotionLabel` 用 0.65 分愤怒 / 受伤、0.45 分焦虑 / 愤怒 ——
 *   0.6 落在"明显比平时亢奋"那一侧, 又不至于把轻微的紧张算成高唤醒.
 *
 * ⚠️ 工程种子值, 非临床标定.
 */
const HIGH_AROUSAL_THRESHOLD = 0.6;

/**
 * 解析本轮的情绪表现方式 (标签 + 唤醒 → 怎么表现).
 *
 * 中性情绪返回空串 (调用方据此**不渲染**这一行) —— 中性不该给额外指令.
 *
 * @param spec 渲染规格
 * @returns 情绪表现指令 (中性时为空串)
 */
function resolveEmotionExpression(spec: AdaptiveRenderSpec): string {
  const { label, arousal } = spec.emotion;
  const expression = EMOTION_EXPRESSION[label];
  if (arousal > HIGH_AROUSAL_THRESHOLD && expression.high !== undefined) return expression.high;
  return expression.base;
}

/**
 * 表达层轻量随机提示 (WP35 手法三).
 *
 * 为什么**在 prompt 里提示**, 而不是适配层做随机:
 *   适配层是纯函数 —— 同一份规格每次渲染出来都一样, "随机"做在那一层等于把
 *   随机写进规格 (要么落库, 要么每次生成新 id), 那是**第二份真相**, 而且不可复现.
 *   让模型自己换着花样说, 才是真正的"表达层随机" —— 且不引入任何新状态.
 *
 * ⚠️ 文案是**工程种子值, 非临床标定** —— 待真实对练校准.
 */
const VARIATION_INSTRUCTION = '你可以有一点变化：不是每轮都用一样的句式，可以有时候停顿一下、有时候用短回应、有时候多说一点。';

/**
 * 口语化 / 非语言表达提示 (WP35 手法四).
 *
 * 为什么"非语言"要**明确禁止括号动作描写**:
 *   模型很容易顺手写「（叹气）」这种 —— 但那是旁白, 不是来访者说的话, 会直接破坏
 *   语音对练的沉浸感 (TTS 也会把括号念出来). 所以给表现空间的同时把载体钉死:
 *   用**语气与停顿**表现, 不写动作.
 *
 * ⚠️ 文案是**工程种子值, 非临床标定** —— 待真实对练校准.
 */
const NON_VERBAL_INSTRUCTION = '可以有一点非语言的表达：比如停顿、叹气、犹豫，但不要写括号里的动作描写。';

/**
 * 叙事逻辑风格 (WP41) —— 取值取自内核契约.
 *
 * 为什么用 `NonNullable<RenderSpec[...]>` 而不是自己写一遍联合类型:
 *   内核 `RenderSpec` 是这 3 个字段的**规范定义**; 这里派生出来的类型与它永远
 *   一致 —— 内核加一档而这里没加时, 下面的 Record 立刻编译报错 (而不是运行时
 *   静默落到"没有对应文案"的坑里).
 */
type NarrativeStyle = NonNullable<RenderSpec['narrativeStyle']>;

/** 语态倾向 (WP41) —— 取值取自内核契约 (同 `NarrativeStyle` 的理由). */
type ExpressionTone = NonNullable<RenderSpec['expressionTone']>;

/**
 * 叙事逻辑风格 → prompt 指令 (WP41).
 *
 * 为什么给的是**可执行的描述**而不是状态标签 (与话量 / 语气同一范式):
 *   模型要知道的是"怎么讲", 不是"我的叙事风格是 structured".
 *
 * ⚠️ 文案是**工程种子值, 非临床标定** —— 待真实对练校准.
 */
const NARRATIVE_STYLE_INSTRUCTION: Readonly<Record<NarrativeStyle, string>> = {
  structured: '说话要有条理：先说清楚发生了什么，再说自己的感受，不用东一句西一句。',
  disorganized: '说话东一句西一句：想到哪说到哪，不用刻意把话理顺。',
  mixed: '说话有时有条理、有时会跳开一点：不用刻意保持一致。',
};

/**
 * 语态倾向 → prompt 指令 (WP41).
 *
 * ⚠️ 文案是**工程种子值, 非临床标定** —— 待真实对练校准.
 */
const EXPRESSION_TONE_INSTRUCTION: Readonly<Record<ExpressionTone, string>> = {
  restrained: '情绪不外露：即使有感受也说得淡淡的，不轻易激动。',
  emotional: '情绪容易外露：话里情绪重，容易一下子激动起来。',
  intellectualizing: '习惯用道理代替感受：说到自己的事会讲分析，很少直接说感受。',
  passive_aggressive: '说话带刺：表面顺着说，实际有点抵触，偶尔阴阳两句。',
};

/**
 * 渲染进 prompt 的长期记忆条数上限 (WP56).
 *
 * 为什么是 3: 内核召回上限是 5 条 (`OPENING_CONTEXT_LIMIT`), 全塞进来 prompt
 * 明显变长, 而"来访者是谁、有什么核心议题"3 条就够. 召回策略本身归 WP59.
 */
const RECALL_PROMPT_LIMIT = 3;

/**
 * 风险轮次的安全护栏 (任务单 §2.3).
 *
 * 为什么护栏写在 prompt 而不是只靠输出侧 guard: 输出侧 guard 是**事后**拦截
 * (说出来才发现不对, 已经出声了); prompt 护栏是**事前**约束 —— 让模型根本
 * 不去描述危险做法. 两者都要: 护栏降低概率, guard 兜住漏网的.
 */
const RISK_GUARDRAIL =
  '安全提醒：这轮涉及明显的痛苦或危机信号。你只说自己的感受，不描述任何危险做法、不给方法、不劝对方做任何决定，也不要说出那些词。';

/**
 * 构造中文来访风格系统提示词.
 *
 * 约束三条: 口语 (像人说话, 不像客服)、克制 (不越出决策目标)、守界 (不给建议/
 * 不承诺治愈/ 不评判咨询师). 状态信息只用来**约束语气与节奏**, 并明确禁止
 * 把这些状态词说出口 —— 否则模型会把"阻抗""策略"这类词直接念出来.
 *
 * V2026-10-29 治本 (WP9-C): 补两段 ——
 *   ① "轮次权重"指令 (该说短还是该说长): 让模型别每轮都平均用力说 3 句;
 *   ② 风险轮次的安全护栏.
 *
 * V2026-11-04 治本 (WP35): "这一轮怎么说"从**话量三档**扩到**四手法** ——
 *   ① 语气疏离度 (疏离 / 中性 / 亲近, 依赖同盟维度 → 条件渲染);
 *   ② 情绪表现方式 (标签 + 唤醒 → 怎么表现, 中性 → 不给指令);
 *   ③ 表达层轻量随机 (在 prompt 里让模型换花样, 不在适配层做随机);
 *   ④ 口语化 / 非语言 (补一点停顿 / 叹气 / 犹豫的表现空间).
 *   话量三档的判定口径 (resolveTurnVerbosity) **一个字没改**.
 *
 * @param spec 渲染规格
 * @returns 系统提示词
 */
function buildVisitorSystemPrompt(spec: AdaptiveRenderSpec): string {
  const lines: string[] = [
    '你正在扮演一位来访者，正在和一位咨询师对话。你不是咨询师，也不是助手。',
    '说话方式：用中文口语，短句，像真实的人聊天；可以只说半句、可以停顿。不要写旁白、动作描写、括号补充或列表，不要解释自己。',
    // WP35 手法四: 口语化 / 非语言 —— 放在"说话方式"之后 (它是说话方式的一部分).
    NON_VERBAL_INSTRUCTION,
    '',
    '你此刻的内在状态（只用来约束你的语气与节奏，绝对不要说出口）：',
    `- 行为策略：${STRATEGY_LABEL[spec.intention.strategy]}`,
    `- 情绪：${EMOTION_LABEL[spec.emotion.label]}（效价 ${formatNumber(spec.emotion.valence)}，唤醒 ${formatNumber(spec.emotion.arousal)}）`,
    `- 阻抗：话量 ${formatNumber(spec.resistance.verbal)}／深度 ${formatNumber(spec.resistance.depth)}／风格 ${formatNumber(spec.resistance.style)}（越高越回避、话越短、语气越疏离）`,
    `- 移情：正向 ${formatNumber(spec.transference.positive)}／负向 ${formatNumber(spec.transference.negative)}／依赖 ${formatNumber(spec.transference.dependency)}`,
    `- 信任：${formatNumber(spec.trust)}（越低越戒备、越不愿多说）`,
  ];

  // WP50: 同盟三维接入渲染层 —— safety / bond 与 trust 同性质.
  //
  //   为什么**只在提供时才加这一行** (而不是无条件加):
  //     RenderSpec 的 safety / bond 是**可选**字段 —— 别的生产者可能不带.
  //     不带就不渲染 = 缺省时 prompt 逐字不变 (零回归底线), 与下面
  //     sessionSummary / coreBeliefs / trajectoryNote 的处理完全同一范式.
  //
  //   为什么放在"内在状态"块**里面**:
  //     块头已经写着"绝对不要说出口" —— 安全感/联结感属于同一类"只用来约束
  //     语气与节奏、不能说出来"的内容, 放进去就自动受约束.
  //
  //   ⚠️ 文案是**工程种子值, 非临床标定** —— 待真实对练校准.
  if (spec.safety !== undefined) {
    lines.push(`- 安全感：${formatNumber(spec.safety)}（越低越不敢说真话、越试探性）`);
  }
  if (spec.bond !== undefined) {
    lines.push(`- 联结感：${formatNumber(spec.bond)}（越低越疏离、越像问诊）`);
  }

  // WP37: 本场滚动摘要 (工作窗口挤出的早期轮次被压缩后的产物).
  //
  //   为什么放在"内在状态"块**里面**: 块头已经写着"绝对不要说出口" ——
  //   摘要属于同一类"只用来约束你的语气与节奏、不能说出来"的内容, 放进去就自动受约束.
  //   为什么**不改硬规则文案**: 硬规则是所有轮次共用的, 改它 = 连"没有摘要"的会话
  //   prompt 也变了 —— 那就破坏了"无溢出时行为不变"这条零回归底线.
  //   没有摘要时这一行整个不出现 → prompt 逐字不变.
  if (spec.sessionSummary) {
    lines.push(`- 此前我们聊过（背景，不要说出口）：${spec.sessionSummary}`);
  }

  // WP56: 跨会话长期记忆召回 (内核 WP2 的 openingContext).
  //
  //   为什么放在"内在状态"块**里面**、紧跟 sessionSummary 之后:
  //     块头已经写着"绝对不要说出口" —— 召回的记忆属于同一类"只用来约束
  //     语气与节奏、不能背出来"的内容, 放进去就自动受同一约束.
  //     而 sessionSummary 与 recall 是一对**背景**: 前者是本场滚动摘要
  //     ("刚才我们聊了什么"), 后者是跨会话长期召回 ("你是谁、你有什么核心议题") ——
  //     挨着放, 两块背景连成一段, 模型读起来才是一句完整的"背景".
  //
  //   为什么**条件渲染**:
  //     recall 只在**跨会话接续的首论**有值 (内核 collectOpeningContext 的口径:
  //     resumeFromSessionId 存在 + turnIndex === 1), 其余轮次恒为空数组.
  //     空数组还渲染一行"你还记得这些事"是纯废话, 还会让每一次普通会话的
  //     prompt 都多一行 —— 那就破坏了零回归底线.
  //
  //   为什么只取 **Top3**:
  //     内核召回上限是 5 条 (OPENING_CONTEXT_LIMIT), 全塞进来 prompt 会明显变长,
  //     而"来访者是谁、有什么核心议题"3 条就够. 召回策略本身归 WP59, 本期只管渲染.
  //
  //   ⚠️ 文案是**工程种子值, 非临床标定** —— 待真实对练校准.
  if (spec.recall.length > 0) {
    const memories = spec.recall
      .slice(0, RECALL_PROMPT_LIMIT)
      .map((hit) => `  - ${hit.entry.content}`)
      .join('\n');
    lines.push(`- 你还记得这些事（背景，不要说出口）：\n${memories}`);
  }

  if (spec.coreBeliefs.length > 0) {
    const statements = spec.coreBeliefs.map((belief) => belief.statement).filter((statement) => statement.length > 0);
    if (statements.length > 0) {
      lines.push(`- 你心里坚信、不会动摇的东西：${statements.join('；')}`);
    }
  }
  if (spec.forbiddenBehaviors.length > 0) {
    lines.push(`- 你绝不会做的事（绝不能出现）：${spec.forbiddenBehaviors.join('、')}`);
  }
  if (spec.trajectoryNote) {
    lines.push(`- 你此刻正经历的事：${spec.trajectoryNote}`);
  }

  // WP41: 角色"一贯的样子" (叙事逻辑风格 + 语态倾向).
  //
  //   为什么**单独一块**而不是塞进"内在状态"块:
  //     内在状态块讲的是"**此刻**的状态" (这一轮的阻抗 / 情绪 / 同盟); 表达风格讲的是
  //     "**一贯**的样子" —— 这个人的说话方式本来就这样, 不因为这一轮怎么了.
  //     两块混在一起, 模型分不清"我现在不想说"与"我一向话少" —— 前者该随阻抗变,
  //     后者恒定.
  //
  //   为什么**条件渲染**:
  //     没登记表达风格的角色 (内置种子 / 别的生产者) → 这一块整个不出现 →
  //     prompt 与 WP35 逐字一致 (零回归).
  if (spec.narrativeStyle !== undefined || spec.expressionTone !== undefined) {
    lines.push('', '你说话一贯的样子（这是你平时就有的习惯，不是因为这一轮怎么了；只用来约束你的语气，绝对不要说出口）：');
    if (spec.narrativeStyle !== undefined) {
      lines.push(NARRATIVE_STYLE_INSTRUCTION[spec.narrativeStyle]);
    }
    if (spec.expressionTone !== undefined) {
      lines.push(EXPRESSION_TONE_INSTRUCTION[spec.expressionTone]);
    }
  }

  lines.push('', '这一轮怎么说：', VERBOSITY_INSTRUCTION[resolveTurnVerbosity(spec)]);

  // WP35 手法一: 语气疏离度 (在话量之外再加一个维度).
  //
  //   为什么**条件渲染** (没有 safety / bond 就不渲染这一行):
  //     疏离度由表达风格阻抗 + 信任 + 同盟三维 (safety / bond) 一起判;
  //     RenderSpec 的 safety / bond 是**可选**字段 —— 别的生产者可能不带.
  //     不带就不渲染 = 缺省时这一行整个不出现 (零回归底线), 与 WP50 同一范式.
  //     (生产路径上 BdiSnapshot 三维必填, 所以线上永远有; 条件渲染是给"别的
  //      生产者"与旧调用方留的门 —— 这道门只在"缺数据"时关, 不在"数据低"时关.)
  if (spec.safety !== undefined || spec.bond !== undefined) {
    lines.push(WARMTH_INSTRUCTION[resolveTurnWarmth(spec)]);
  }

  // WP35 手法二: 情绪表现方式.
  //
  //   为什么**中性就不给指令**:
  //     中性情绪没有"该怎么表现"这一说 —— 硬给一条只会凭空造出表演.
  //     中性时返回空串, 这一行整个不出现 (零回归底线).
  const emotionExpression = resolveEmotionExpression(spec);
  if (emotionExpression.length > 0) {
    lines.push(emotionExpression);
  }

  lines.push(
    // WP35 手法三: 表达层轻量随机.
    VARIATION_INSTRUCTION,
    // 为什么把"说完就停"放在这一块**最后**:
    //   这一块现在有四行 (话量 / 语气 / 情绪 / 变化), 收尾的"交还话头"是**硬行为
    //   约束** —— 放最后、紧挨着下面的"硬规则", 权重最高, 不会被上面的表现类指令盖掉.
    '说完一两句就停下来，把话头交还给咨询师 —— 真人对话不是独白。',
  );

  if (spec.riskSignal && spec.riskSignal.level !== 'none') {
    lines.push(RISK_GUARDRAIL);
  }

  lines.push(
    '',
    '硬规则：',
    '1. 只回应咨询师刚说的那一句，别主动换话题，也别追问咨询师自己的经历。',
    '2. 不给建议、不下诊断、不承诺治愈、不评判咨询师。',
    '3. 上面那些状态词（策略／情绪／阻抗／信念等）一个字都不要说出来。',
    '4. 一次最多说一到三句。',
  );
  return lines.join('\n');
}

/**
 * dev 调试日志: 打印**真正拼进 render prompt** 的角色片段.
 *
 * 为什么要它: WP9-B 起角色基线是从角色池查出来注入内核的, 但"注入成功"与
 * "真的进了 prompt"是两件事 —— 中间隔着快照 → spec → prompt 三层拼装.
 * 人工核对时最省事的锚点就是这一行: 代号 + 核心信念片段.
 *
 * 只在非生产环境打印 (NODE_ENV !== 'production'); 生产环境不留来访者信念原文.
 *
 * @param spec 渲染规格
 */
function logPromptCharacterFragment(spec: AdaptiveRenderSpec): void {
  if (process.env.NODE_ENV === 'production') return;
  const beliefs = spec.coreBeliefs.map((belief) => belief.statement).join('；');
  console.log(
    `[TurnRenderOrchestrator] render prompt 角色片段: codename=${spec.characterLabel ?? '<中性基线>'} ` +
      `attachment=${spec.attachmentStyle ?? '-'} risk=${spec.riskSignal?.level ?? 'none'} ` +
      `coreBeliefs(前100字)=${beliefs.slice(0, 100)}`,
  );
}

/**
 * 数字格式化 (两位小数; 非有限数兜底为 0).
 */
function formatNumber(value: number): string {
  return Number.isFinite(value) ? value.toFixed(2) : '0.00';
}

/**
 * 极简告警日志.
 *
 * 为什么不用 NestJS 的 Logger: 任务单 §2 要求门面**零 `@nestjs/*`** ——
 * 门面必须能脱离 Nest 容器独立 new 出来跑与测; 引一个框架 Logger 就等于
 * 把"框架"带进这个本该纯 TS 的装配单元. 这里的日志量极小 (只在异常路径),
 * 用 console 足够; 真要接统一日志, 后续可把日志器做成注入项, 不影响门面语义.
 */
function warn(message: string): void {
  console.warn(`[TurnRenderOrchestrator] ${message}`);
}

/**
 * 错误转可读文案.
 */
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
