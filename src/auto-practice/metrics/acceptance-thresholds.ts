// V2026-11-12 Phase2.5 I-21/I-22 (intake-v2 · 判据按咨询师模式分档):
//   职责: 把"一批 12 轮左右的首次会谈数据合不合格"的判据, 从"一张全局单表"
//         升级为"按 AI 咨询师模式 (counselorModeId) 分档"; 并给 session.zero_motion
//         补上 cold 档的语义 (合理封闭 vs 检测器失效).
//   边界: 纯常量 + 纯函数, 零 IO / 零框架.
//
//   v1 (2026-11-11) 的 8 条阈值原样保留在 INTAKE_EXPECTATIONS (现为**基线档**),
//   作为历史口径可读; **不回溯重算历史快照** (历史批次仍按当时的 intake-v1 判读).
//
//   被验收对象始终是 **AI 来访者的状态轨迹** (trust / safety / bond / depth /
//   style / verbal / arousal / zero_motion); counselorModeId 只是**切片维度**
//   —— 用来观察同一个来访者在不同风格咨询师输入下的反应.
//   本文件**不给 AI 咨询师台词定任何 KPI**, 也不碰咨询师模式本身.
//
//   这个文件本身就是配置指纹 acceptance 段的哈希对象 (见 config-fingerprint):
//   改任何一条判据 → acceptance 段变 → 跨批判 PASS/FAIL 自动判 incomparable.
//
//   临床依据 (首次会谈 ≈ 前 12 轮, 20-25 分钟) —— 以下为**基线档** (v1) 口径:
//     · trust 温和上升 (焦虑型快速理想化, Horvath & Symonds 1991);
//     · safety 只小幅涨 (试探性安全);
//     · bond 几乎不动 (3-5 次会谈后才成形);
//     · depth/style 防御保持稳定 (保护性, 不该被几次共情打穿);
//     · arousal 结束仍可能高于基线 (谈痛苦被激活);
//     · 首次会谈不要求探索 (探索是 40 轮档的事).
//
//   cold 档 (新增): 冷漠型 AI 咨询师是**负向极端模式**, 来访者面对冷漠输入时
//   联盟建立慢、低 trust/safety 是**合理反应**; 用基线档阈值套 cold 切片会把
//   "合理封闭"误判成来访者质量不合格 (I-21). cold 档阈值是**候选值**, 逐条附
//   rationale, 标注「待主控复核」, **不是已定稿的验收硬门槛**.

import { round6 } from './round.js';

/** 判据类型. */
export type ExpectationKind = 'range' | 'max_delta' | 'min_value' | 'must_be_zero' | 'max_ratio';

/**
 * max_ratio 判据的分子口径.
 *
 * · raw  = 指标原值 (例如 session.zero_motion 的**全量**零变化场次数);
 * · idle = I-22 的"纯 neutral 空转"计数 (来自 ZeroMotionBreakdown.idle);
 *          即"零变化且事件层无非 neutral 事件"的场次数 (计入失效的那部分).
 */
export type ExpectationNumerator = 'raw' | 'idle';

/** 一条指标判据. */
export interface MetricExpectation {
  readonly metricId: string;
  readonly kind: ExpectationKind;
  /** range 的下界 (可负; max_delta 不用). */
  readonly min?: number;
  /** range 的上界 (undefined = 无界). */
  readonly max?: number;
  /** max_delta 的绝对值上限. */
  readonly absLimit?: number;
  /** max_ratio 的上限 (比例); 分子口径缺省 raw. */
  readonly numerator?: ExpectationNumerator;
  /** 容差 (边界判定的缓冲, 避免浮点贴边). */
  readonly tol: number;
  /** 一句临床/工程依据. */
  readonly rationale: string;
}

/**
 * 判据版本标识.
 *
 * 改判据时手动递增; 同时 acceptance 文件指纹也会变, 双保险.
 *
 * · intake-v1 (2026-11-11): 全局单表 8 条 (现为基线档口径, 保留可读);
 * · intake-v2 (2026-11-12): 按 counselorModeId 分档 + zero_motion 的 I-22 语义.
 */
export const INTAKE_ACCEPTANCE_VERSION = 'intake-v2';

/** 判据版本历史 (新→旧); 随 catalog 下发, 便于审计追溯. */
export const INTAKE_ACCEPTANCE_VERSION_HISTORY: readonly string[] = ['intake-v2', 'intake-v1'];

/** 12 轮 intake 档判据表 (intake-v1 原表, 现为**基线档**口径, 数值一个不改). */
export const INTAKE_EXPECTATIONS: readonly MetricExpectation[] = [
  {
    metricId: 'dim.trust.delta_avg',
    kind: 'range',
    min: 0.05,
    max: 0.2,
    tol: 0.005,
    rationale: '首次会谈信任温和上升; 焦虑型快速理想化',
  },
  {
    metricId: 'dim.safety.delta_avg',
    kind: 'range',
    min: 0.02,
    max: 0.06,
    tol: 0.005,
    rationale: '试探性安全, 只小幅涨',
  },
  {
    metricId: 'dim.bond.delta_avg',
    kind: 'range',
    min: -0.03,
    max: 0.03,
    tol: 0.005,
    rationale: '纽带 3-5 次会谈后才成形, 首次几乎不动',
  },
  {
    metricId: 'dim.depth.delta_avg',
    kind: 'max_delta',
    absLimit: 0.1,
    tol: 0.005,
    rationale: '深度防御是保护性的, 不该被几次共情打穿 (现状 -0.27~-0.32 严重超标)',
  },
  {
    metricId: 'dim.style.delta_avg',
    kind: 'max_delta',
    absLimit: 0.05,
    tol: 0.005,
    rationale: '人格级表达风格防御稳定',
  },
  {
    metricId: 'dim.verbal.delta_avg',
    kind: 'max_delta',
    absLimit: 0.15,
    tol: 0.005,
    rationale: '愿说一点, 但不是倾倒',
  },
  {
    metricId: 'dim.arousal.delta_avg',
    kind: 'range',
    min: -0.05,
    tol: 0.005,
    rationale: '结束时唤醒仍可能高于基线 (谈痛苦被激活), 不要求下降',
  },
  {
    metricId: 'session.zero_motion',
    kind: 'must_be_zero',
    tol: 0,
    rationale: '零变化场次应为 0; 否则说明冷漠被静默成中性、检测失效',
  },
  // exploration.rate 刻意不验 (属 40 轮档).
];

/** intake-v1 判据表的历史别名 (与基线档同源, 不复制第二份阈值). */
export const INTAKE_EXPECTATIONS_V1: readonly MetricExpectation[] = INTAKE_EXPECTATIONS;

/**
 * cold 档候选判据表 (I-21; **候选值 · 待主控复核**).
 *
 * 阈值依据: 96 场批次 g3ONzlqSGMVJqkFMF9Lwh 的 cold 切片实测 (8 角色 × 6 重复
 * = 48 场 / 551 轮) + intake 临床口径文档 §3 的方向性依据.
 *   cold 实测: trust 0.029667 / safety 0.003479 / bond 0.002917 / depth -0.000857
 *               style 0.002384 / verbal -0.004880 / arousal 0.004167
 *               zero_motion 31/48 (事件层全 neutral 的纯空转 31 场)
 *
 * 纪律: 每条都标【候选 · 待主控复核】; 主控复核前不当硬门槛用.
 */
export const INTAKE_EXPECTATIONS_COLD: readonly MetricExpectation[] = [
  {
    metricId: 'dim.trust.delta_avg',
    kind: 'range',
    min: 0.01,
    max: 0.08,
    tol: 0.005,
    rationale:
      '【候选 · 待主控复核】cold 冷漠输入下信任建立显著慢 (实测 0.0297, expert 0.1386); 下限 0.01 保住"完全无响应即不合格"的底线, 上限 0.08 允许明显建立',
  },
  {
    metricId: 'dim.safety.delta_avg',
    kind: 'range',
    min: 0,
    max: 0.03,
    tol: 0.005,
    rationale:
      '【候选 · 待主控复核】cold 切片 safety 实测 0.0035 (几乎不涨), 属试探性安全缺失的合理反应; 下限 0 允许零增长, 上限 0.03 防"无节制依赖"滑向另一端',
  },
  {
    metricId: 'dim.bond.delta_avg',
    kind: 'range',
    min: -0.03,
    max: 0.03,
    tol: 0.005,
    rationale: '【候选 · 待主控复核】沿用 v1: 纽带 3-5 次会谈后才成形, 首次会谈本就不该动 (实测 0.0029)',
  },
  {
    metricId: 'dim.depth.delta_avg',
    kind: 'max_delta',
    absLimit: 0.05,
    tol: 0.005,
    rationale:
      '【候选 · 待主控复核】cold 实测 -0.0009 (深度防御基本稳); 收窄到 ±0.05 比基线更紧, 专门捕捉"冷漠输入反而把深度防御撬开/塌陷"这类异常',
  },
  {
    metricId: 'dim.style.delta_avg',
    kind: 'max_delta',
    absLimit: 0.05,
    tol: 0.005,
    rationale: '【候选 · 待主控复核】沿用 v1: 人格级表达风格防御稳定 (实测 0.0024)',
  },
  {
    metricId: 'dim.verbal.delta_avg',
    kind: 'max_delta',
    absLimit: 0.05,
    tol: 0.005,
    rationale: '【候选 · 待主控复核】cold 切片话量阻抗实测 -0.0049 (几乎不动); 收窄到 ±0.05, 捕捉"冷漠输入下话量阻抗被压垮或泄洪"这类异常',
  },
  {
    metricId: 'dim.arousal.delta_avg',
    kind: 'range',
    min: -0.05,
    tol: 0.005,
    rationale: '【候选 · 待主控复核】沿用 v1: 结束时唤醒仍可能高于基线 (实测 +0.0042), 不要求下降',
  },
  {
    metricId: 'session.zero_motion',
    kind: 'max_ratio',
    max: 0.7,
    numerator: 'idle',
    tol: 0.01,
    rationale:
      '【候选 · 待主控复核】I-22: 只计"纯 neutral 空转"的零变化场次 (事件层无任何非 neutral 事件); 该档不要求为 0, 但空转率过高说明"冷漠被静默成中性"的失效面过大 (cold 实测 31/48 = 0.6458)',
  },
];

/**
 * 零变化场次细分 (I-22 的数据来源; 由批次指标计算层逐场判定).
 *
 * 判定规则 (逐场, 基于 traces 的 eventTags —— 不含对话原文):
 *   ① 零变化 = 八个追踪维度的首末快照**全部相等** (与 session.zero_motion 同口径);
 *   ② 事件层存在**非 neutral** 事件 → 记为 closure (**合理封闭**, 按任务单口径豁免,
 *      不计入失效);
 *   ③ 事件层只有 neutral (或无事件) → 记为 idle (**纯 neutral 空转**, 计入失效).
 */
export interface ZeroMotionBreakdown {
  /** 零变化场次总数. */
  readonly total: number;
  /** 其中"合理封闭"场次数 (事件层存在非 neutral 事件 → 豁免). */
  readonly closure: number;
  /** 其中"纯 neutral 空转"场次数 (计入失效). */
  readonly idle: number;
}

/** 一档判据 (按 counselorModeId 划分). */
export interface IntakeTier {
  readonly id: string;
  readonly label: string;
  /** 适用 counselorModeId; 空数组 = **兜底档** (未单列的模式都落这里). */
  readonly counselorModeIds: readonly string[];
  /** true = 候选阈值 (待主控复核), 不是已定稿硬门槛. */
  readonly provisional: boolean;
  readonly expectations: readonly MetricExpectation[];
  /** 一句说明 (下发给 catalog). */
  readonly note: string;
}

/** 基线档 id (expert 及所有未单列模式的兜底档). */
export const INTAKE_TIER_BASELINE_ID = 'baseline';

/** cold 档 id. */
export const INTAKE_TIER_COLD_ID = 'cold';

/** 基线档: v1 阈值原样承继, 兜底所有未单列的 counselorModeId. */
const BASELINE_TIER: IntakeTier = {
  id: INTAKE_TIER_BASELINE_ID,
  label: '基线档 (intake-v1 阈值)',
  counselorModeIds: [],
  provisional: false,
  expectations: INTAKE_EXPECTATIONS,
  note: '兜底档: expert 及所有未单列的 counselorModeId 落此; 阈值与 intake-v1 逐条相同, 数值一个不改',
};

/** cold 档: 负向极端模式专属候选阈值 (待主控复核). */
const COLD_TIER: IntakeTier = {
  id: INTAKE_TIER_COLD_ID,
  label: 'cold 负向极端档 (候选阈值 · 待主控复核)',
  counselorModeIds: ['cold'],
  provisional: true,
  expectations: INTAKE_EXPECTATIONS_COLD,
  note: 'cold = 冷漠型 AI 咨询师: 来访者面对冷漠输入时联盟建立慢属合理反应; 阈值按 96 场切片实测 + intake 临床口径提出候选值, 待主控复核',
};

/** 全部判据档 (顺序即 catalog 下发顺序: 基线在前). */
export const INTAKE_TIERS: readonly IntakeTier[] = [BASELINE_TIER, COLD_TIER];

/**
 * 取某一档 (按 id); 找不到返回基线档.
 *
 * @param tierId 档位 id
 * @returns 判据档
 */
export function getIntakeTier(tierId: string): IntakeTier {
  return INTAKE_TIERS.find((tier) => tier.id === tierId) ?? BASELINE_TIER;
}

/**
 * 按 counselorModeId 解析判据档.
 *
 * 回落规则 (I-21): 单列了模式的走专属档; **未单列的模式一律回落基线档**
 * (expert / novice / chatty / preachy / nonsense / 空值皆然).
 *
 * @param counselorModeId AI 咨询师模式 id (切片维度)
 * @returns 命中的判据档
 */
export function resolveIntakeTier(counselorModeId?: string | null): IntakeTier {
  const normalized = (counselorModeId ?? '').trim();
  if (normalized.length > 0) {
    const matched = INTAKE_TIERS.find((tier) => tier.counselorModeIds.includes(normalized));
    if (matched) return matched;
  }
  return BASELINE_TIER;
}

/** 单条判据的验收结果. */
export interface AcceptanceResult {
  readonly metricId: string;
  readonly passed: boolean;
  readonly actual: number | null;
  readonly reason: string;
  /** max_ratio 判据的分子 (计数口径); 其他判据缺省. */
  readonly numerator?: number;
  /** max_ratio 判据的分母 (切片场次数); 其他判据缺省. */
  readonly denominator?: number;
}

/** 判分输入选项 (按切片判分时给出). */
export interface IntakeAcceptanceOptions {
  /** 切片维度: AI 咨询师模式 id (决定用哪一档判据); 缺省 = 兜底基线档. */
  readonly counselorModeId?: string | null;
  /** 切片场次数 (max_ratio 的分母). */
  readonly sessions?: number | null;
  /** 零变化场次细分 (I-22; max_ratio + numerator=idle 时必填). */
  readonly zeroMotion?: ZeroMotionBreakdown | null;
}

/** 判分结果 (v1 结构向后兼容, 新字段以增量方式加入). */
export interface IntakeAcceptanceResult {
  readonly results: readonly AcceptanceResult[];
  readonly passed: boolean;
  /** 判据版本 (审计用). */
  readonly acceptanceVersion: string;
  /** 命中的判据档 id. */
  readonly tierId: string;
  /** 切片模式 id (null = 全局 / 未指定). */
  readonly counselorModeId: string | null;
}

/**
 * 解析 max_ratio 判据的分子 (计数口径).
 *
 * @param expectation 判据
 * @param raw 指标原值
 * @param options 判分选项
 * @returns 分子值; 取不到返回 null (fail-closed)
 */
function resolveNumerator(expectation: MetricExpectation, raw: number | null, options: IntakeAcceptanceOptions): number | null {
  if (expectation.numerator === 'idle') {
    return options.zeroMotion ? options.zeroMotion.idle : null;
  }
  return raw;
}

/**
 * 判单条 (纯函数).
 *
 * fail-closed 方向: 指标缺失 / 分子分母缺失 → **不通过** (actual = null),
 * 绝不"缺数据即通过".
 *
 * @param expectation 判据
 * @param metrics 指标 map
 * @param options 判分选项
 * @returns 单条结果
 */
function evaluateExpectation(
  expectation: MetricExpectation,
  metrics: Readonly<Record<string, number | null>>,
  options: IntakeAcceptanceOptions,
): AcceptanceResult {
  const raw = metrics[expectation.metricId] ?? null;

  if (expectation.kind === 'max_ratio') {
    const numerator = resolveNumerator(expectation, raw, options);
    const denominator = options.sessions ?? null;
    if (numerator === null || denominator === null || denominator <= 0) {
      return { metricId: expectation.metricId, passed: false, actual: null, reason: expectation.rationale };
    }
    const ratio = numerator / denominator;
    const limit = expectation.max ?? 0;
    return {
      metricId: expectation.metricId,
      passed: ratio <= limit + expectation.tol,
      actual: round6(ratio),
      reason: expectation.rationale,
      numerator,
      denominator,
    };
  }

  let passed = false;
  if (raw !== null) {
    switch (expectation.kind) {
      case 'range': {
        const aboveMin = expectation.min === undefined || raw >= expectation.min - expectation.tol;
        const belowMax = expectation.max === undefined || raw <= expectation.max + expectation.tol;
        passed = aboveMin && belowMax;

        break;
      }
      case 'max_delta': {
        passed = Math.abs(raw) <= (expectation.absLimit ?? 0) + expectation.tol;

        break;
      }
      case 'min_value': {
        passed = raw >= (expectation.min ?? 0) - expectation.tol;

        break;
      }
      case 'must_be_zero': {
        passed = raw === 0;

        break;
      }
      // No default (max_ratio 已在上面单独处理)
    }
  }
  return { metricId: expectation.metricId, passed, actual: raw, reason: expectation.rationale };
}

/**
 * 验收一批快照 / 一个切片 (纯函数).
 *
 * 不传 counselorModeId → 走**基线档** (与 v1 口径逐条相同).
 * 传 counselorModeId → 走该模式的档 (未单列则回落基线档).
 *
 * @param metrics 指标 map (全局 metrics 或某切片的 metrics)
 * @param options 判分选项 (切片维度 / 场次数 / 零变化细分)
 * @returns 逐条结果 + 总判定 (+ v2 新增的版本/档位字段)
 */
export function evaluateIntakeAcceptance(
  metrics: Readonly<Record<string, number | null>>,
  options: IntakeAcceptanceOptions = {},
): IntakeAcceptanceResult {
  const tier = resolveIntakeTier(options.counselorModeId);
  const results: AcceptanceResult[] = tier.expectations.map((expectation) => evaluateExpectation(expectation, metrics, options));
  return {
    results,
    passed: results.every((result) => result.passed),
    acceptanceVersion: INTAKE_ACCEPTANCE_VERSION,
    tierId: tier.id,
    counselorModeId: options.counselorModeId ?? null,
  };
}
