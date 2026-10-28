// V2026-10-28 治本 (WP4 · 引擎内核 · 安全类型契约):
//   职责: 定义伦理安全层的全部**数据形状** —— 等级 / 检测面 / 违规类别 /
//         本轮判定 / 累计事件 / 会后报告, 以及 PsyGUARD 11 类归一等级映射表.
//   边界: 纯 TS, 零 @nestjs/* / typeorm, 不含 IO. 内核**只判定不拦截** ——
//         本文件里的任何类型都不携带"动作指令", 是否阻断由 adapter 决定.
//
//   为什么等级只分三级 (pass/warn/block):
//     等级驱动**动作**, 而动作只有三档 (放行 / 提示 / 拦下). 再细的分级
//     (critical/high/...) 只会让每个调用点都要再做一次映射, 且映射必然漂移.
//     更细的风险信息由**类别**表达 (suicide_plan 比 suicide_exploration 严重得多),
//     类别是给督导看的, 等级是给动作看的 —— 两者职责分开.
//
//   反双胞胎:
//     - **PsyGUARD 11 类 → 等级的映射表集中在这里**: 未来换模型 / 改阈值只改这张表,
//       调用处各写一套映射必然漂移 (一处把 suicide_preparation 当 warn, 另一处当 block,
//       就会出现"同一段来访话术在两个环节给出不同动作"的诡异不一致).
//     - 不把等级做成 enum: 与 WP2 的 MemoryRecallScope / WP3 的 TrajectoryMode 同理 ——
//       它是纯控制流判别式, 字符串联合可让内核保持"零运行时导出".
//     - 不在本文件里写"判定逻辑": 规则判定在 cognition/safety/rule-engine.ts,
//       探测编排在 cognition/safety/assess-safety.ts —— 契约文件只放形状与常量.
//
//   如何验证:
//     1. npx tsc -p tsconfig.build.json --noEmit 0 错
//     2. test/engine-core/wp4-safety.spec.ts 覆盖分级、映射与归一

/**
 * 三级安全等级: pass 放行 / warn 中低告警 / block 高危拦截信号.
 */
export type SafetyLevel = 'pass' | 'warn' | 'block';

/**
 * 检测面向: 咨询师输入 / 来访输出.
 */
export type SafetySide = 'counselor_input' | 'visitor_output';

/**
 * 咨询师侧违规类别 (规则层硬规则覆盖).
 */
export type CounselorSafetyCategory =
  /** 承诺治愈 / 保证疗效. */
  | 'promise_cure'
  /** 价值审判 / 说教 / 给来访者贴病理标签. */
  | 'value_judgment'
  /** 双重关系 / 私下联系. */
  | 'double_relationship'
  /** 过早直接给诊断 / 开药 / 处置建议 (跳过评估). */
  | 'premature_advice'
  /** 违法指导 (伪造证明 / 非法药物 / 帮助实施). */
  | 'illegal_guidance'
  /** 歧视 (性别 / 性取向 / 地域 / 疾病 / 残障). */
  | 'discrimination'
  /** 提供自杀 / 自残方法细节 / 帮助实施. */
  | 'suicide_coaching';

/**
 * 来访侧 = PsyGUARD 11 类归一 wire 名 (probe 回传 + 规则种子共用).
 * 顺序对应参考模型细粒度标签, 名称本期自定为内核内部契约, 不要求与模型输出原文一致.
 */
export type VisitorRiskCategory =
  /** 自杀未遂. */
  | 'suicide_attempt'
  /** 自杀计划. */
  | 'suicide_plan'
  /** 自杀准备行为. */
  | 'suicide_preparation'
  /** 主动自杀意图. */
  | 'active_ideation'
  /** 自伤行为. */
  | 'self_harm_behavior'
  /** 被动自杀意图. */
  | 'passive_ideation'
  /** 关于自杀的探索. */
  | 'suicide_exploration'
  /** 自伤意图. */
  | 'self_harm_ideation'
  /** 他人攻击行为. */
  | 'aggression_others'
  /** 用户攻击行为. */
  | 'aggression_self'
  /** 与自杀 / 自伤 / 攻击无关. */
  | 'neutral';

/** 安全类别 (咨询师侧 ∪ 来访侧). */
export type SafetyCategory = CounselorSafetyCategory | VisitorRiskCategory;

/**
 * 本轮判定结果 (纯观测, 不含口语, 不携带动作指令).
 */
export interface SafetyVerdict {
  /** 等级 (驱动动作). */
  readonly level: SafetyLevel;
  /** 检测面. */
  readonly side: SafetySide;
  /** 命中类别去重集合 (规则类别 / probe 类别合并). */
  readonly categories: readonly SafetyCategory[];
  /** 命中的规则 id (规则层); 纯 probe 来源时为空数组. */
  readonly matchedRules: readonly string[];
  /** 判定来源. */
  readonly source: 'rule' | 'probe' | 'rule+probe';
  /** 供督导 / 报告的中性说明 (一句话, 不渲染给来访者). */
  readonly reason?: string;
}

/**
 * 单条累计事件 (进程内存, 不落库).
 */
export interface SafetyEvent {
  /** 事件所在轮次 (从 1 起). */
  readonly turnIndex: number;
  /** 事件时刻 (ms). */
  readonly at: number;
  /** 本轮判定. */
  readonly verdict: SafetyVerdict;
  /** 命中片段截断 (供报告回看), 不作额外识别依据. */
  readonly snippet: string;
}

/**
 * 会后伦理风险报告 (进程内聚合, adapter 取走后自行决定是否落库).
 */
export interface SafetyReport {
  /** 会话 id. */
  readonly sessionId: string;
  /** 已累计事件中的最高等级 (无事件 → pass). */
  readonly maxLevel: SafetyLevel;
  /** block 级事件计数. */
  readonly blockCount: number;
  /** warn 级事件计数. */
  readonly warnCount: number;
  /** 按轮次升序的事件副本. */
  readonly events: readonly SafetyEvent[];
}

/**
 * PsyGUARD 11 类 → 归一等级 (集中一处, 避免调用处各写一套漂移).
 * critical(行动层) → block; 意念/探索层 → warn; 无关 → pass.
 */
export const PSYGUARD_LEVEL_MAP: Readonly<Record<VisitorRiskCategory, SafetyLevel>> = {
  suicide_attempt: 'block',
  suicide_plan: 'block',
  suicide_preparation: 'block',
  active_ideation: 'block',
  self_harm_behavior: 'block',
  passive_ideation: 'warn',
  suicide_exploration: 'warn',
  self_harm_ideation: 'warn',
  aggression_others: 'block',
  aggression_self: 'warn',
  neutral: 'pass',
};

/** 合法等级清单. */
const SAFETY_LEVELS: readonly SafetyLevel[] = ['pass', 'warn', 'block'];

/** 合法来访类别清单 (脏类别按 pass 忽略). */
const VISITOR_RISK_CATEGORIES: readonly VisitorRiskCategory[] = [
  'suicide_attempt',
  'suicide_plan',
  'suicide_preparation',
  'active_ideation',
  'self_harm_behavior',
  'passive_ideation',
  'suicide_exploration',
  'self_harm_ideation',
  'aggression_others',
  'aggression_self',
  'neutral',
];

/**
 * 判断值是否为合法等级.
 *
 * @param value 待判断值
 * @returns 是否合法等级
 */
export function isSafetyLevel(value: unknown): value is SafetyLevel {
  return typeof value === 'string' && (SAFETY_LEVELS as readonly string[]).includes(value);
}

/**
 * 判断值是否为合法的来访风险类别 (未知类别一律忽略, 不让脏类别炸合并).
 *
 * @param value 待判断值
 * @returns 是否合法来访类别
 */
export function isVisitorRiskCategory(value: unknown): value is VisitorRiskCategory {
  return typeof value === 'string' && (VISITOR_RISK_CATEGORIES as readonly string[]).includes(value);
}

/**
 * 取两个等级中更高的一个 (block > warn > pass).
 *
 * @param a 等级 A
 * @param b 等级 B
 * @returns 更高等级
 */
export function maxSafetyLevel(a: SafetyLevel, b: SafetyLevel): SafetyLevel {
  if (a === 'block' || b === 'block') return 'block';
  if (a === 'warn' || b === 'warn') return 'warn';
  return 'pass';
}
