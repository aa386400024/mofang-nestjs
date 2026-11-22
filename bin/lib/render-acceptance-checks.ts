import { spawnSync } from 'node:child_process';

/** 渲染 smoke 的 JSON 报告：只声明验收器真正消费的字段，其余原样保留。 */
export interface SmokeJsonReport {
  readonly ok?: boolean;
  readonly wallElapsedMs?: number;
  readonly renderMetrics?: readonly RenderMetricSample[];
}

export interface RenderMetricSample {
  readonly name: string;
  readonly values: readonly {
    readonly labels: Record<string, string | number>;
    readonly value: number;
  }[];
}

export interface MetricProbe {
  /** 指标在该标签集合下的取值之和；指标不存在时返回 0。 */
  sum(name: string, labels?: Record<string, string | number>): number;
  /** 指标是否出现过（含 0 值样本）。 */
  present(name: string, labels?: Record<string, string | number>): boolean;
  /** 该标签集合下的样本条数。 */
  samples(name: string, labels?: Record<string, string | number>): number;
}

export interface MetricExpectation {
  readonly metric: string;
  readonly labels?: Record<string, string | number>;
  readonly equals?: number;
  readonly atLeast?: number;
  readonly atMost?: number;
  readonly description: string;
}

export interface ExpectationResult {
  readonly passed: boolean;
  readonly failures: readonly string[];
}

function labelsMatch(actual: Record<string, string | number>, expected: Record<string, string | number> | undefined): boolean {
  if (expected === undefined) return true;
  return Object.entries(expected).every(([key, value]) => String(actual[key] ?? '') === String(value));
}

/** 用指标样本构造只读探针；不依赖 prom-client，纯数据，便于单测。 */
export function buildMetricProbe(samples: readonly RenderMetricSample[]): MetricProbe {
  const rows = samples.flatMap((sample) => sample.values.map((value) => ({ name: sample.name, ...value })));
  return {
    sum(name, labels) {
      return rows.filter((row) => row.name === name && labelsMatch(row.labels, labels)).reduce((total, row) => total + row.value, 0);
    },
    present(name, labels) {
      return rows.some((row) => row.name === name && labelsMatch(row.labels, labels));
    },
    samples(name, labels) {
      return rows.filter((row) => row.name === name && labelsMatch(row.labels, labels)).length;
    },
  };
}

function describeLabels(labels: Record<string, string | number> | undefined): string {
  if (labels === undefined) return '';
  return `{${Object.entries(labels)
    .map(([key, value]) => `${key}=${String(value)}`)
    .join(',')}}`;
}

/** 逐条比对期望；任何一条不符都返回具体期望值与真实值。 */
export function checkExpectations(probe: MetricProbe, expectations: readonly MetricExpectation[]): ExpectationResult {
  const failures: string[] = [];
  for (const expectation of expectations) {
    const actual = probe.sum(expectation.metric, expectation.labels);
    const label = `${expectation.metric}${describeLabels(expectation.labels)}`;
    if (expectation.equals !== undefined && actual !== expectation.equals) {
      failures.push(`${expectation.description}：期望 ${label}=${String(expectation.equals)}，实际 ${String(actual)}`);
      continue;
    }
    if (expectation.atLeast !== undefined && actual < expectation.atLeast) {
      failures.push(`${expectation.description}：期望 ${label}>=${String(expectation.atLeast)}，实际 ${String(actual)}`);
      continue;
    }
    if (expectation.atMost !== undefined && actual > expectation.atMost) {
      failures.push(`${expectation.description}：期望 ${label}<=${String(expectation.atMost)}，实际 ${String(actual)}`);
    }
  }
  return { passed: failures.length === 0, failures };
}

/** smoke 先打印若干诊断行，最后一段是缩进 2 的 JSON 报告；从首个顶格 `{` 行开始截取。 */
export function extractJsonReport(stdout: string): SmokeJsonReport {
  const lines = stdout.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trimEnd() === '{');
  if (start === -1) throw new Error('smoke 输出里没有 JSON 报告起始行');
  const body = lines.slice(start).join('\n').trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch (error: unknown) {
    throw new Error(`smoke JSON 报告解析失败：${error instanceof Error ? error.message : String(error)}`);
  }
  if (parsed === null || typeof parsed !== 'object') throw new Error('smoke JSON 报告不是对象');
  return parsed;
}

export interface SmokeRunResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly report: SmokeJsonReport | null;
  readonly parseError: string | null;
}

/** 真正启动一次 smoke；命令与参数由调用方拼装，便于只跑子集或注入环境。 */
export function runSmoke(args: readonly string[], options: { timeoutMs?: number } = {}): SmokeRunResult {
  // eslint-disable-next-line sonarjs/no-os-command-from-path -- 本仓约定统一走 pnpm 工具链，与其它 bin 脚本一致
  const result = spawnSync('pnpm', ['exec', 'tsx', 'bin/visitor-render-smoke.ts', ...args], {
    encoding: 'utf8',
    shell: true,
    timeout: options.timeoutMs ?? 180_000,
    maxBuffer: 16 * 1024 * 1024,
  });
  const stdout = result.stdout ?? '';
  const stderr = result.stderr ?? '';
  try {
    return { exitCode: result.status ?? -1, stdout, stderr, report: extractJsonReport(stdout), parseError: null };
  } catch (error: unknown) {
    return {
      exitCode: result.status ?? -1,
      stdout,
      stderr,
      report: null,
      parseError: error instanceof Error ? error.message : String(error),
    };
  }
}
