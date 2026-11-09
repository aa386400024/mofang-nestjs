// V2026-11-09 治本 (Phase2.5 WP-C · 触发式审议闸门 · 类型契约):
//   职责: 定义闸门的**输入 / 输出 / 策略 / 端口**四组类型 —— 纯 TS, 零依赖, 零 IO.
//   边界: 零 @nestjs / 零 Redis / 零 env / 零 prompt. 只描述"形状".
//
//   为什么闸门要单独一个类型文件 (而不是塞进 service):
//     ① **编排门面是纯类** (零 @nestjs, 见 turn-render-orchestrator.ts) —— 门面只认
//        一个**窄端口** (DeliberationGatePort), 不能直接依赖 Nest service.
//        类型契约放独立文件, 门面 import 它不会把框架拖进来.
//     ② **可独立拆分** (任务单 §三): 以后把闸门拆成微服务时, 整个目录搬出去就行 ——
//        前提是这一层**不认识** Nest / Redis / ioredis, 只认这组纯类型.
//     ③ **判定只有一份**: 阈值 / 理由码 / 维度清单都在这里与 config/evaluator 里,
//        别处不再写第二份 (仓库反双胞胎纪律).
//
//   事件词表的**唯一真相**在 ../deliberation/deliberation-types.ts (WP63 的契约层):
//     · 规则对齐标签 (10 个) = 规则算子**也**能打出来的标签 —— 它们是"规则有把握"的那批;
//     · LLM 专属标签 (3 个) = 规则**根本看不到**的信号 (隐性阻抗 / 微表情 / 关系氛围).
//     闸门的"规则置信清单"用的是前者 —— 命中后者就说明规则算不准, 该让 LLM 上.
//     ⚠️ 本文件**不复制**那份清单 (只 import), 免得两处漂移.
//
//   如何验证:
//     1. npx tsc -p tsconfig.build.json --noEmit 0 错
//     2. test/engine-adapters/deliberation-gate/evaluator.spec.ts 覆盖维度/事件口径

import type { BdiSnapshot, CounselorEventKind } from '../../engine-core/index.js';
import type { DeliberationOperatorTag, DeliberationRiskLevel } from '../deliberation/deliberation-types.js';

/**
 * 闸门模式 (两套阈值 / 两套配额, 彼此独立).
 *
 * - `shadow` —— 影子模式: 审议**只观察**不生效. 门槛**低** (多收集数据), 冷却**短**,
 *   会话次数与全局配额**不设限**, **不熔断** (任务单 §2.1 参数表).
 * - `effect` —— 生效模式: 审议建议**真的改 delta**. 门槛**高** (谨慎干预), 冷却**长**,
 *   每会话最多跑 N 次, 全局每分钟配额, 连续失败即熔断.
 *
 * ⚠️ 两套模式的**状态互不干扰** (Redis key 带 mode 段) —— 同一场会话可以先影子后切生效,
 *   冷却计数不会互相污染 (切灰度时最怕这个: "以为在冷却, 其实没冷却").
 */
export type GateMode = 'shadow' | 'effect';

/**
 * 闸门决策 (只有两种: 跑 / 不跑).
 *
 * ⚠️ **没有第三种** —— 闸门不"降级跑", 也不"稍后再跑". 拿不准就是 skip (走纯规则 delta),
 *   这是四层兜底里最保守的一层.
 */
export type GateDecision = 'run' | 'skip';

/**
 * 决策理由 (决策 trace 的口径 —— 看板按它统计"为什么跑 / 为什么没跑").
 *
 * ⚠️ 每个值都是**可枚举的**, 不允许自由文本 —— 自由文本进 trace 等于把判断依据
 *   变成不可统计的字符串 (仓库纪律: 判定与观测口径都要能机器读).
 */
export type GateReason =
  /** 危机轮次: 永远不跑 LLM 审议 (合规红线). */
  | 'crisis_skip'
  /** 本场第一次跑: 强制建立基线. */
  | 'first_turn_baseline'
  /** 关键事件硬触发 (越界 / 评判 / 触碰敏感议题): 不管 delta 多大都跑. */
  | 'key_event'
  /** 冷却中: 距上次跑不到 N 轮. */
  | 'cooldown'
  /** 配额用尽: 会话次数上限 或 全局每分钟上限. */
  | 'quota_exceeded'
  /** 熔断中: 连续失败次数达阈值 (仅生效模式). */
  | 'circuit_open'
  /** 出现规则**算不准**的事件类型 (LLM 专属标签): 规则没把握, 交给 LLM. */
  | 'unknown_event_type'
  /** 同盟三维 (trust/safety/bond) 变化超过阈值. */
  | 'alliance_delta_high'
  /** 阻抗三维 (verbal/depth/style) 变化超过阈值. */
  | 'resistance_delta_high'
  /** 全平静: 所有维度变化都很小 —— 规则算得准, 不用问 LLM. */
  | 'calm_turn'
  /** 默认: 规则有把握, 不跑. */
  | 'rule_confident'
  /**
   * 闸门自身出故障 (Redis 读不出来 / 纯判定抛异常): **放行** (退化成改造前每轮都跑).
   *
   * ⚠️ 为什么单独一个码 (而不是复用 'rule_confident'):
   *     复用会让看板把"闸门挂了"统计成"规则有把握" —— 那是**撒谎**,
   *     排障时最怕这种 (看上去一切正常, 实际审议成本已经失控).
   *     与审议层的 skipped_high_risk / circuit_open 分开是同一款理由.
   */
  | 'gate_error';

/**
 * 闸门看得到的事件标签.
 *
 * ⚠️ 为什么是**内核事件 + 审议标签**的并集, 而不是只用审议标签:
 *   · 内核事件 (CounselorEventKind) 里有 neutral —— "没命中任何规则"的占位.
 *     它**不在**规则置信清单里, 所以闸门会把它判成"规则算不准" → 跑审议.
 *     这正是我们要的: 规则一条都没匹配上, 说明这一轮得靠 LLM 去看.
 *   · 审议标签 (DeliberationOperatorTag) 多了 LLM 专属的 3 个 —— 将来若把闸门
 *     接到"上一轮 LLM 打的标签"上, 无需再改类型.
 */
export type GateEventTag = DeliberationOperatorTag | CounselorEventKind;

/**
 * 闸门读到的安全信息.
 *
 * ⚠️ 口径**复用**审议层的风险等级 (WP-A 的 DeliberationRiskLevel), 不另立一套:
 *   闸门要判的"能不能出境"与审议服务要判的"能不能出境"必须是**同一个问题** ——
 *   两套口径必然漂移, 于是出现"闸门放行但审议层拒绝"的白跑一轮.
 */
export interface GateSafety {
  /** 风险等级: low 允许出境; medium / high 永远不跑 (WP-A 合规红线). */
  readonly riskLevel: DeliberationRiskLevel;
}

/**
 * 闸门的输入 (一轮一次评估).
 *
 * ⚠️ **零对话原文** (合规红线, Phase2.5 §4.2): 这里没有任何字段装咨询师 / 来访者说过的话.
 *   闸门只看**结构化数据** —— 快照前后对比 / 事件标签 / 风险等级.
 *   所以闸门**不构成**心理数据出境的新路径 (它连原文都拿不到).
 */
export interface GateInput {
  /** 业务会话 id (Redis key 的一段). */
  readonly sessionId: string;
  /** 本轮轮次 (从 1 起; 冷却与"首轮"判定都用它). */
  readonly turnIndex: number;
  /** 本轮**开始时**的 BDI 快照 (R0). */
  readonly stateBefore: BdiSnapshot;
  /** 本轮**结束**后的 BDI 快照 (R1). */
  readonly stateAfter: BdiSnapshot;
  /** 本轮咨询师行为的事件标签 (内核事件 + 审议标签). */
  readonly events: readonly GateEventTag[];
  /** 本轮风险等级 (审议口径: low 可出境 / medium / high 永不出境). */
  readonly safety: GateSafety;
  /** 闸门模式 (决定用哪一套阈值与配额). */
  readonly mode: GateMode;
}

/**
 * 一次判定用到的阈值 (某个模式的那一套).
 */
export interface GateThresholds {
  /** 同盟三维 (trust/safety/bond) 的 |delta| 阈值. */
  readonly alliance: number;
  /** 阻抗三维 (verbal/depth/style) 的 |delta| 阈值. */
  readonly resistance: number;
  /** "全平静"阈值: 所有维度 |delta| 都小于它 = 这一轮不值得问 LLM. */
  readonly calm: number;
}

/**
 * 一个模式下的整套闸门策略 (阈值 + 冷却 + 配额 + 熔断开关).
 *
 * ⚠️ 为什么不写死"影子不限配额"这种隐含规则:
 *   把它显式化成 `maxPerSession` / `globalRpm` 两个数字 (不限 = 一个极大哨兵值),
 *   纯判定函数就不需要"if (mode === 'shadow')"的分支 —— 判定只有一份.
 */
export interface GatePolicy {
  /** 三个触发阈值. */
  readonly thresholds: GateThresholds;
  /** 冷却轮数: 跑完后 N 轮内不再跑. */
  readonly cooldownTurns: number;
  /** 每会话最多跑几次 (不限 = 极大哨兵值). */
  readonly maxPerSession: number;
  /** 全局每分钟最多跑几次 (不限 = 极大哨兵值). */
  readonly globalRpm: number;
  /** 这一模式要不要看熔断状态 (仅生效模式为 true). */
  readonly circuitEnabled: boolean;
}

/**
 * 闸门配置 (两种模式各一套策略 + 一份熔断参数).
 *
 * ⚠️ 为什么在**契约层**而不是配置层: 配置层 (deliberation-gate.config.ts) 负责**装配**它,
 *   而判定层与服务层都要**认**它 —— 放契约层才不会被任何一方"顺手改一份".
 */
export interface GateConfig {
  /** 影子模式的策略 (低门槛 / 短冷却 / 不限配额 / 不熔断). */
  readonly shadow: GatePolicy;
  /** 生效模式的策略 (高门槛 / 长冷却 / 有限额 / 熔断). */
  readonly effect: GatePolicy;
  /** 连续失败多少次触发熔断. */
  readonly circuitFailCount: number;
  /** 熔断持续时长 (毫秒). */
  readonly circuitCooldownMs: number;
}

/**
 * 闸门读到的运行时状态 (由 Redis 读出, 喂给纯判定函数).
 *
 * ⚠️ 这是"**外部世界**的状态" —— 冷却 / 计数 / 配额 / 熔断都在 Redis, 不在进程内存
 *   (红线: 以后拆微服务不用改逻辑). 这里只是把那些状态**快照**成纯数据,
 *   好让判定函数保持纯函数 (零 IO, 好测).
 */
export interface GateRuntimeState {
  /** 上次跑审议的轮次 (null = 本会话本模式从没跑过). */
  readonly lastTurn: number | null;
  /** 本会话本模式已跑次数. */
  readonly sessionRunCount: number;
  /** 全局本分钟已跑次数. */
  readonly globalRunCount: number;
  /** 熔断中 (仅生效模式有意义). */
  readonly circuitOpen: boolean;
}

/**
 * 闸门的输出 (决策 + 依据).
 */
export interface GateOutput {
  /** 跑 / 不跑. */
  readonly decision: GateDecision;
  /** 决策理由 (可枚举). */
  readonly reason: GateReason;
  /** 11 维逐维 delta (观测用; 数值, **不含任何对话原文**). */
  readonly deltaSummary: Readonly<Record<string, number>>;
  /** 本次判定实际用的阈值 (观测用: 看板要能看出"当时按什么标准判的"). */
  readonly thresholdUsed: GateThresholds;
}

/**
 * 一次审议执行的结局 (成功 / 失败) —— 熔断器的输入.
 *
 * ⚠️ 为什么要有它: 闸门只**决定**要不要跑, 跑成没跑成它不知道.
 *   熔断阈值 ("连续 5 次超时 → 熔断 10 分钟") 必须由**执行方**回报 ——
 *   没人回报, 熔断器就永远不触发 (一个永不生效的保护 = 没有保护).
 */
export type GateExecutionOutcome = 'success' | 'failure';

/**
 * 闸门的**窄端口** (编排门面只依赖这两个方法).
 *
 * ⚠️ 为什么是接口而不是实现类 (与 DeliberationShadowPort / DeliberationEffectPort 同款纪律):
 *   门面是纯类 (零 @nestjs), 直接依赖 Nest service 会把框架拖进门面,
 *   让"装配缺席"从"没有闸门"退化成"门面起不来".
 *   窄端口 + 缺省缺席 = 纯增强: 没装闸门 = 与本单之前**逐字一致**.
 */
export interface DeliberationGatePort {
  /**
   * 判定这一轮要不要跑 LLM 审议.
   *
   * ⚠️ **不抛**: 闸门挂了不该炸会话 (与审议服务同款纪律) —— 实现里自己兜住,
   *   失败时按"放行"处理 (退化成改造前的行为: 每轮都跑).
   *
   * @param input 本轮输入 (零对话原文)
   * @returns 决策 + 依据
   */
  evaluate(input: GateInput): Promise<GateOutput>;

  /**
   * 回报一次审议执行的结局 (给熔断器喂数据).
   *
   * ⚠️ **可选**: 装配缺席 / 只想用判定能力时可以不实现.
   *
   * @param mode 走的哪条路径 (影子 / 生效)
   * @param outcome 成功还是失败
   */
  reportOutcome?(mode: GateMode, outcome: GateExecutionOutcome): void;
}
