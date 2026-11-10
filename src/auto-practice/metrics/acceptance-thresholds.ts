// V2026-11-11 WP-K (验收判据代码化 · 12 轮 intake 档):
//   职责: 把"一批 12 轮左右的首次会谈数据合不合格"的口径从 md 文档搬进代码,
//         机器自动判, 不靠人眼看、不凭记忆.
//   边界: 纯常量 + 纯函数, 零 IO / 零框架.
//
//   这个文件本身就是配置指纹 acceptance 段的哈希对象 (见 config-fingerprint):
//   改任何一条判据 → acceptance 段变 → 跨批判 PASS/FAIL 自动判 incomparable.
//
//   临床依据 (首次会谈 ≈ 前 12 轮, 20-25 分钟):
//     · trust 温和上升 (焦虑型快速理想化, Horvath & Symonds 1991);
//     · safety 只小幅涨 (试探性安全);
//     · bond 几乎不动 (3-5 次会谈后才成形);
//     · depth/style 防御保持稳定 (保护性, 不该被几次共情打穿);
//     · arousal 结束仍可能高于基线 (谈痛苦被激活);
//     · 首次会谈不要求探索 (探索是 40 轮档的事).

/** 判据类型. */
export type ExpectationKind = 'range' | 'max_delta' | 'min_value' | 'must_be_zero';

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
  /** 容差 (边界判定的缓冲, 避免浮点贴边). */
  readonly tol: number;
  /** 一句临床/工程依据. */
  readonly rationale: string;
}

/**
 * 判据版本标识.
 *
 * 改判据时手动递增; 同时 acceptance 文件指纹也会变, 双保险.
 */
export const INTAKE_ACCEPTANCE_VERSION = 'intake-v1';

/** 12 轮 intake 档判据表. */
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

/** 单条判据的验收结果. */
export interface AcceptanceResult {
  readonly metricId: string;
  readonly passed: boolean;
  readonly actual: number | null;
  readonly reason: string;
}

/**
 * 验收一批快照 (单批; 纯函数).
 *
 * @param metrics 快照的指标 map
 * @returns 逐条结果 + 总判定
 */
export function evaluateIntakeAcceptance(metrics: Readonly<Record<string, number | null>>): {
  readonly results: readonly AcceptanceResult[];
  readonly passed: boolean;
} {
  const results: AcceptanceResult[] = [];
  for (const expectation of INTAKE_EXPECTATIONS) {
    const actual = metrics[expectation.metricId] ?? null;
    let passed = false;
    if (actual !== null) {
      switch (expectation.kind) {
        case 'range': {
          const aboveMin = expectation.min === undefined || actual >= expectation.min - expectation.tol;
          const belowMax = expectation.max === undefined || actual <= expectation.max + expectation.tol;
          passed = aboveMin && belowMax;

          break;
        }
        case 'max_delta': {
          passed = Math.abs(actual) <= (expectation.absLimit ?? 0) + expectation.tol;

          break;
        }
        case 'min_value': {
          passed = actual >= (expectation.min ?? 0) - expectation.tol;

          break;
        }
        case 'must_be_zero': {
          passed = actual === 0;

          break;
        }
        // No default
      }
    }
    results.push({ metricId: expectation.metricId, passed, actual, reason: expectation.rationale });
  }
  return { results, passed: results.every((result) => result.passed) };
}
