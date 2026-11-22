// V2026-11-09 治本 (Phase2.5 WP-E · 自动评测 + 参数调优 · 类型契约):
//   职责: 定义评测流水线的**数据形状** —— 数据集记录 / 指标 / 报告 / 运行参数.
//   边界: 纯 TS, 零 @nestjs / 零 IO / 零 env / 零 prompt / 零 typeorm.
//
//   为什么"建议质量"只认**六维** (trust/safety/bond/verbal/depth/style):
//     任务单 §4.2 把建议质量定义在这六维上 —— 同盟三维 (信任/安全感/纽带感) +
//     阻抗三维 (话量/深度/风格). 内核另有 valence/arousal/positive/negative/dependency
//     五维 (情绪 + 移情), 它们**不进临床可解释的建议口径**: 情绪是状态描述,
//     移情是长周期关系变量 —— 混进同一个"准确率"分数里, 分数升高说不清是哪件事变好了.
//     ⚠️ 维度名单只在这里有**一份**: 指标层 / 报告层 / 真值层都从这里取, 不各自抄一份.
//
//   为什么数据集存"紧凑状态"而不是完整 BdiSnapshot:
//     完整快照带信念层 / 愿望层 / 记忆层, 一场会话几十轮 → JSON 体积爆炸, 而且那些字段
//     跟"闸门该不该跑 / 审议准不准"**毫无关系**. 数据集只留 11 维数值 (状态) +
//     事件标签 + 风险等级; 需要完整快照时由 eval.dataset.ts 用内核工厂现场还原.
//     ⚠️ 还原走的是内核唯一出口 (createEmptyBdiSnapshot), 不是自己拼一个假快照 ——
//     拼出来的假快照会让 buildStateComparison 少算维度, 闸门重算结果全错.
//
//   ⚠️ 心理数据边界: 数据集**不含任何对话原文** —— 只有数值化的状态 / 事件标签 / delta.
//     督导案例的逐字稿属于外部语料, 解析后也只落"标注结果" (哪一轮该跑 + 期望 delta),
//     原文不进入评测数据集, 更不进报告.

/** 评测口径的六个维度 (建议质量的计算范围). */
export const EVAL_DIMENSIONS = ['trust', 'safety', 'bond', 'verbal', 'depth', 'style'] as const;

/** 评测维度名. */
export type EvalDimension = (typeof EVAL_DIMENSIONS)[number];

/**
 * 方向判定的中性带.
 *
 * ⚠️ 口径来自任务单 §4.2: |delta| <= 0.01 视为"平稳" (既不算涨也不算跌).
 *   为什么不是 0: 数值有浮点噪声, 0.004 的变化在临床上没有意义, 判成"涨了"会
 *   把指标刷成噪声 —— 方向准确率会被浮点尾数支配.
 */
export const EVAL_DIRECTION_EPSILON = 0.01;

/** delta 的方向. */
export type EvalDirection = 'up' | 'flat' | 'down';

/**
 * 求一个 delta 的方向.
 *
 * ⚠️ 非有限值一律判"平稳" —— 脏数据不该把指标拉偏, 该被清洗层过滤掉.
 *
 * @param value delta 数值
 * @returns 方向
 */
export function directionOf(value: number): EvalDirection {
  if (!Number.isFinite(value)) return 'flat';
  if (value > EVAL_DIRECTION_EPSILON) return 'up';
  if (value < -EVAL_DIRECTION_EPSILON) return 'down';
  return 'flat';
}

/** 六维 delta (缺维视为 0). */
export type EvalDelta = Partial<Record<EvalDimension, number>>;

/**
 * 紧凑状态 (数据集里存的 11 维数值).
 *
 * ⚠️ 这 11 维与内核 DELIBERATION_DIMS **同口径** (值域与维度名一致), 差别只在:
 *   数据集存"绝对值"而不是"增量", 且不含信念/愿望/记忆层 —— 评测不需要那些.
 */
export interface EvalCompactState {
  /** 信任 [0,1]. */
  readonly trust: number;
  /** 安全感 [0,1]. */
  readonly safety: number;
  /** 纽带感 [0,1]. */
  readonly bond: number;
  /** 情绪效价 [-1,1]. */
  readonly valence: number;
  /** 情绪唤醒 [0,1]. */
  readonly arousal: number;
  /** 话量阻抗 [0,1]. */
  readonly verbal: number;
  /** 内容深度阻抗 [0,1]. */
  readonly depth: number;
  /** 表达风格阻抗 [0,1]. */
  readonly style: number;
  /** 正向移情强度 [0,1]. */
  readonly positive: number;
  /** 负向移情强度 [0,1]. */
  readonly negative: number;
  /** 依赖型移情强度 [0,1]. */
  readonly dependency: number;
}

/** 紧凑状态的维度名单 (顺序固定, 便于逐维对比). */
export const EVAL_STATE_DIMS = [
  'trust',
  'safety',
  'bond',
  'valence',
  'arousal',
  'verbal',
  'depth',
  'style',
  'positive',
  'negative',
  'dependency',
] as const satisfies readonly (keyof EvalCompactState)[];

/** 数据集切分: 训练集 (可随便用) / 验收集 (只用于最终验收). */
export type EvalSplit = 'train' | 'validation';

/** 评测模式: 离线评测 (读已有数据) / 全量重跑 (重算决策链路). */
export type EvalMode = 'offline' | 'full';

/** 风险等级 (沿用审议层口径: low 允许出境, medium/high 永不跑). */
export type EvalRiskLevel = 'low' | 'medium' | 'high';

/** 闸门决策 (只有跑 / 不跑两种 —— 判定只有一份, 见 deliberation-gate.types.ts). */
export type EvalGateDecision = 'run' | 'skip';

/**
 * 数据集里的一轮.
 *
 * ⚠️ 每一轮都要能回答两个问题: "闸门当时判了什么" 与 "这一轮**应该**判什么".
 *   前者是**记录** (gateDecision), 后者是**真值** (expectedShouldRun) —— 两者不可混用.
 */
export interface EvalTurnRecord {
  /** 轮次 (从 1 起). */
  readonly turnIndex: number;
  /** 本轮开始时的紧凑状态. */
  readonly before: EvalCompactState;
  /** 本轮结束后的紧凑状态. */
  readonly after: EvalCompactState;
  /** 本轮咨询师行为的事件标签 (内核事件 + 审议标签). */
  readonly events: readonly string[];
  /** 本轮风险等级. */
  readonly riskLevel: EvalRiskLevel;
  /** 纯规则模式这一轮产出的 delta (基线预测). */
  readonly ruleDelta: EvalDelta;
  /**
   * 审议模式这一轮产出的 delta (被测预测).
   *
   * ⚠️ 离线评测里它是**记录下来的历史输出** (不是本次重跑的结果) —— 所以离线评测评的是
   *   "上一版跑得怎么样", 不是"现在跑得怎么样". 要评当前代码 → 用全量重跑模式.
   */
  readonly llmDelta: EvalDelta | null;
  /** 闸门当时的决策 (null = 没有 trace 记录). */
  readonly gateDecision: EvalGateDecision | null;
  /** 闸门当时的理由码 (观测用). */
  readonly gateReason?: string;
  /** 本轮是否降级 (模型超时 / 上游错误导致的兜底回复). */
  readonly degraded?: boolean;
  /** 本轮是否报错 (错误 / 空回复 / 超时 —— 三者都算脏). */
  readonly hasError?: boolean;
  /** 督导标注: 这一轮**应该**跑审议 (B 方案验收集才有). */
  readonly expectedShouldRun?: boolean;
  /** 督导标注: 期望的 delta (B 方案验收集才有). */
  readonly expectedDeltas?: EvalDelta;
  /** 本轮 LLM token 消耗 (成本统计用). */
  readonly totalTokens?: number;
}

/** 数据集里的一场会话. */
export interface EvalSessionRecord {
  /** 会话 id (用于样本追溯 / 抽检导出). */
  readonly sessionId: string;
  /** 本场切分 (缺省 = 数据集级切分). */
  readonly split?: EvalSplit;
  /** 逐轮记录. */
  readonly turns: readonly EvalTurnRecord[];
}

/**
 * 一个评测数据集 (版本化).
 *
 * ⚠️ `synthetic` 是**必填**的: 合成数据集与真实督导案例必须能被一眼区分 ——
 *   拿合成数据的指标当验收结论, 等于自己骗自己.
 */
export interface EvalDataset {
  /** 数据集版本 (写进报告, 用于跨版本对比). */
  readonly version: string;
  /** 默认切分. */
  readonly split: EvalSplit;
  /** 是否为合成数据 (true = 只能验证链路, 不能当验收结论). */
  readonly synthetic: boolean;
  /** 会话列表. */
  readonly sessions: readonly EvalSessionRecord[];
}

/** 清洗丢弃原因 (可枚举 —— 报告里要能统计"为什么扔"). */
export type EvalDropReason = 'too_short' | 'has_error' | 'bdi_anomaly' | 'missing_gate_trace';

/** 数据质量统计 (报告里单独一节, 让人一眼看到扔了多少、为什么扔). */
export interface EvalDataQuality {
  /** 读进来的总场次. */
  readonly totalSessions: number;
  /** 通过清洗的场次. */
  readonly validSessions: number;
  /** 被丢弃的场次. */
  readonly droppedSessions: number;
  /** 各类丢弃原因的计数. */
  readonly dropReasons: Record<EvalDropReason, number>;
  /** 闸门 trace 缺失的**轮次**数 (场次没被丢, 但这一轮算不了触发质量). */
  readonly turnsWithMissingGateTrace: number;
}

/** 触发质量指标 (闸门准不准). */
export interface EvalTriggerQuality {
  /** 精确率 TP / (TP + FP). */
  readonly precision: number;
  /** 召回率 TP / (TP + FN). */
  readonly recall: number;
  /** F1. */
  readonly f1: number;
  /** 真阳性. */
  readonly tp: number;
  /** 假阳性 (不该跑却跑了). */
  readonly fp: number;
  /** 假阴性 (该跑却没跑). */
  readonly fn: number;
  /** 真阴性. */
  readonly tn: number;
  /** 参与计算的轮次数. */
  readonly support: number;
}

/** 单维方向得分. */
export interface EvalDirectionScore {
  /** 方向命中率 (三分类的总体正确率). */
  readonly accuracy: number;
  /** 三分类 macro F1 (任务单 §4.2 口径: 每个维度各算 F1 再取平均). */
  readonly macroF1: number;
  /** 参与计算的轮次数. */
  readonly support: number;
  /**
   * 真值非平稳的轮次数 (这一维在数据集上**有没有信号**).
   *
   * ⚠️ 为什么单独统计: 某一维如果整场都是平稳 (真值恒为 0), 那么"全押平稳"的退化解
   *   就能在这一维拿满分 —— 把它算进 macro 平均, 分数会被这些**没有信息**的维度抬高.
   *   所以只有 signalTurns > 0 的维度才进 macro 平均与幅度 MAE.
   */
  readonly signalTurns: number;
  /** 方向对的那些轮次的幅度平均绝对误差. */
  readonly amplitudeMAE: number | null;
}

/** 建议质量指标 (审议输出准不准). */
export interface EvalSuggestionQuality {
  /** 是否可算 (没有督导真值时为 false). */
  readonly available: boolean;
  /** 不可算的原因 (可算时为 null). */
  readonly unavailableReason: string | null;
  /** 六维各自的 macro F1 (不可算时为 null). */
  readonly directionAccuracy: Record<EvalDimension, number | null>;
  /** 六维 macro F1 的平均 (不可算时为 null). */
  readonly macroAverage: number | null;
  /** 六维明细 (accuracy / F1 / 幅度 MAE). */
  readonly perDimension: Record<EvalDimension, EvalDirectionScore | null>;
  /** 幅度 MAE (方向对的那些轮次的平均绝对误差). */
  readonly amplitudeMAE: number | null;
  /** 参与比较的轮次数. */
  readonly comparedTurns: number;
}

/** 基线对比 (纯规则 vs 规则+审议). */
export interface EvalBaselineComparison {
  /** 是否可算. */
  readonly available: boolean;
  /** 不可算的原因. */
  readonly unavailableReason: string | null;
  /** 基线 (纯规则) 的方向 macro F1. */
  readonly baselineDirectionAccuracy: number | null;
  /** 被测对象 (规则+审议) 的方向 macro F1. */
  readonly subjectDirectionAccuracy: number | null;
  /** 被测对象 - 基线 (正数 = 审议带来提升). */
  readonly directionAccuracyDelta: number | null;
  /** 基线的幅度 MAE. */
  readonly baselineAmplitudeMAE: number | null;
  /** 被测对象的幅度 MAE. */
  readonly subjectAmplitudeMAE: number | null;
  /** 被测对象 - 基线 (负数 = 审议让幅度更准). */
  readonly amplitudeMAEDelta: number | null;
}

/** 单次运行的指标快照 (用于算均值 / 标准差). */
export interface EvalRunSnapshot {
  /** 触发 F1. */
  readonly triggerF1: number;
  /** 触发精确率. */
  readonly precision: number;
  /** 触发召回率. */
  readonly recall: number;
  /** 建议质量 macro F1 (不可算时为 null). */
  readonly directionAccuracy: number | null;
  /** 幅度 MAE (不可算时为 null). */
  readonly amplitudeMAE: number | null;
}

/** 多次运行的均值 / 标准差. */
export interface EvalRunsSummary {
  /** 运行次数. */
  readonly count: number;
  /** 均值. */
  readonly mean: EvalRunSnapshot;
  /** 标准差 (单次运行 = 0). */
  readonly stdDev: EvalRunSnapshot;
}

/** 成本统计. */
export interface EvalCost {
  /** 总 token 消耗. */
  readonly totalTokens: number;
  /** 估算成本 (元). */
  readonly estimatedCostCny: number;
}

/** 报告的运行配置快照 (跟指标一起存档, 半年后才知道这组数是哪套参数跑的). */
export interface EvalReportConfig {
  /** 模型标识. */
  readonly model: string;
  /** prompt 版本. */
  readonly promptVersion: string;
  /** 闸门阈值 (实际用于判定的那一套). */
  readonly gateThresholds: {
    /** 同盟三维阈值. */
    readonly alliance: number;
    /** 阻抗三维阈值. */
    readonly resistance: number;
    /** 全平静阈值. */
    readonly calm: number;
    /** 冷却轮数. */
    readonly cooldown: number;
  };
  /** 数据集版本. */
  readonly datasetVersion: string;
  /** 评测模式. */
  readonly mode: EvalMode;
  /** 运行次数. */
  readonly runs: number;
  /** 数据集切分. */
  readonly split: EvalSplit;
  /** 真值来源 (督导标注 / 规则差异). */
  readonly groundTruthKind: 'supervisor' | 'rule_diff';
  /** 是否合成数据. */
  readonly synthetic: boolean;
}

/** 一份评测报告 (结构对齐任务单 §4.4). */
export interface EvalReport {
  /** 报告 id (全局唯一 —— 人工抽检口子就靠它). */
  readonly reportId: string;
  /** 生成时刻 (ISO). */
  readonly createdAt: string;
  /** 运行配置快照. */
  readonly config: EvalReportConfig;
  /** 数据质量统计. */
  readonly dataQuality: EvalDataQuality;
  /** 触发质量. */
  readonly triggerQuality: EvalTriggerQuality;
  /** 建议质量. */
  readonly suggestionQuality: EvalSuggestionQuality;
  /** 基线对比. */
  readonly baselineComparison: EvalBaselineComparison;
  /** 多次运行的均值 / 标准差. */
  readonly runs: EvalRunsSummary;
  /** 成本. */
  readonly cost: EvalCost;
  /** 总耗时 (秒). */
  readonly durationSec: number;
  /** 告警 (例如"基线跌了 > 0.03, 代码可能改坏了"). */
  readonly warnings: readonly string[];
  /** 样本 id (会话 id + 轮次, 供人工抽检导出). */
  readonly sampleIds: readonly string[];
  /** 报告状态. */
  readonly status: 'ok' | 'degraded' | 'failed';
}

/** 报告摘要 (列表页用). */
export interface EvalReportSummary {
  /** 报告 id. */
  readonly reportId: string;
  /** 生成时刻. */
  readonly createdAt: string;
  /** 数据集版本. */
  readonly datasetVersion: string;
  /** 评测模式. */
  readonly mode: EvalMode;
  /** 触发 F1 (历史行缺这个字段时为 null). */
  readonly triggerF1: number | null;
  /** 建议质量 macro F1 (不可算时为 null). */
  readonly directionAccuracy: number | null;
}
