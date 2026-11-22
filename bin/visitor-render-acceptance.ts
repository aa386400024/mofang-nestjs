/**
 * AF-302 渲染故障矩阵一键自证：逐条跑真实 smoke，按声明式期望比对指标。
 *
 * 用法：
 *   pnpm exec tsx bin/visitor-render-acceptance.ts
 *   pnpm exec tsx bin/visitor-render-acceptance.ts --only double-server --keep-going
 *
 * 判定：每条场景要求 smoke 退出码 0、报告 ok=true、指标逐条命中；任一失败退出码 1。
 */
import { checkExpectations, buildMetricProbe, runSmoke } from './lib/render-acceptance-checks.js';
import type { MetricExpectation } from './lib/render-acceptance-checks.js';

interface Scenario {
  readonly id: string;
  readonly title: string;
  readonly args: readonly string[];
  readonly expectations: readonly MetricExpectation[];
}

const BASE_ARGS = ['--provider', 'doubao', '--caller', 'router', '--turns', '1', '--dump-render-metrics'] as const;

const SCENARIOS: readonly Scenario[] = [
  {
    id: 'double-server',
    title: '双候选 5xx 全损',
    args: [...BASE_ARGS, '--fail-primary', '--fail-backup', '--fail-primary-mode', 'server-error', '--expect-exhausted'],
    expectations: [
      { metric: 'visitor_render_rounds_total', labels: { outcome: 'exhausted' }, equals: 1, description: '轮次结局恰好一次全损' },
      { metric: 'visitor_render_degraded_total', labels: { cause: 'exhausted' }, equals: 1, description: '降级原因归 exhausted' },
      { metric: 'visitor_render_attempts_total', labels: { outcome: 'retry' }, equals: 2, description: '两候选各计一次重试' },
      { metric: 'visitor_render_failure_total', labels: { cause: 'server' }, equals: 2, description: '两候选各记一次 server 失败' },
      { metric: 'visitor_render_fallback_total', labels: { cause: 'server' }, equals: 1, description: '主备切换一次且归因 server' },
      { metric: 'visitor_render_fallback_total', equals: 1, description: '全损轮不产生额外回退' },
      { metric: 'visitor_render_cooldown_served_total', equals: 0, description: '首次全损不产生冷却期服务' },
    ],
  },
  {
    id: 'double-timeout',
    title: '双候选首包超时',
    args: [...BASE_ARGS, '--fail-primary', '--fail-backup', '--fail-primary-mode', 'timeout', '--expect-exhausted'],
    expectations: [
      { metric: 'visitor_render_rounds_total', labels: { outcome: 'exhausted' }, equals: 1, description: '轮次结局恰好一次全损' },
      { metric: 'visitor_render_degraded_total', labels: { cause: 'exhausted' }, equals: 1, description: '降级原因归 exhausted' },
      {
        metric: 'visitor_render_stream_timeout_total',
        labels: { phase: 'first-delta' },
        equals: 2,
        description: '两候选各记一次首包超时',
      },
      { metric: 'visitor_render_failure_total', labels: { cause: 'first-delta' }, equals: 2, description: '流式超时按 first-delta 归因' },
      { metric: 'visitor_render_failure_total', labels: { cause: 'timeout' }, equals: 0, description: '流式路径不落 timeout 文案' },
      { metric: 'visitor_render_fallback_total', labels: { cause: 'first-delta' }, equals: 1, description: '主备切换归因 first-delta' },
    ],
  },
  {
    id: 'double-auth',
    title: '双候选 401',
    args: [...BASE_ARGS, '--fail-primary', '--fail-backup', '--fail-primary-mode', 'auth', '--expect-exhausted'],
    expectations: [
      { metric: 'visitor_render_rounds_total', labels: { outcome: 'exhausted' }, equals: 1, description: '轮次结局恰好一次全损' },
      { metric: 'visitor_render_degraded_total', labels: { cause: 'exhausted' }, equals: 1, description: '降级原因归 exhausted' },
      { metric: 'visitor_render_auth_failure_total', equals: 2, description: '两候选各记一次鉴权失败' },
      { metric: 'visitor_render_failure_total', labels: { cause: 'auth' }, equals: 2, description: '两候选各记一次 auth 失败' },
      { metric: 'visitor_render_fallback_total', labels: { cause: 'auth' }, equals: 1, description: '主备切换归因 auth' },
    ],
  },
  {
    id: 'double-network',
    title: '双候选连接失败',
    args: [...BASE_ARGS, '--fail-primary', '--fail-backup', '--fail-primary-mode', 'network', '--expect-exhausted'],
    expectations: [
      { metric: 'visitor_render_rounds_total', labels: { outcome: 'exhausted' }, equals: 1, description: '轮次结局恰好一次全损' },
      { metric: 'visitor_render_degraded_total', labels: { cause: 'exhausted' }, equals: 1, description: '降级原因归 exhausted' },
      { metric: 'visitor_render_failure_total', labels: { cause: 'network' }, equals: 2, description: '连接类失败独立归因 network' },
      { metric: 'visitor_render_failure_total', labels: { cause: 'other' }, equals: 0, description: '不再落 other 混合桶' },
      { metric: 'visitor_render_fallback_total', labels: { cause: 'network' }, equals: 1, description: '主备切换归因 network' },
      { metric: 'visitor_render_stream_timeout_total', equals: 0, description: '连接失败不应被记成流式超时' },
    ],
  },
  {
    id: 'single-midstream',
    title: '单候选首包后停摆',
    args: [...BASE_ARGS, '--fail-primary', '--fail-primary-mode', 'midstream-stall', '--expect-degraded'],
    expectations: [
      { metric: 'visitor_render_rounds_total', labels: { outcome: 'degrade' }, equals: 1, description: '轮次结局为降级' },
      { metric: 'visitor_render_degraded_total', labels: { cause: 'idle' }, equals: 1, description: '降级原因归 idle' },
      { metric: 'visitor_render_stream_timeout_total', labels: { phase: 'idle' }, equals: 1, description: '块间停摆记 idle 超时' },
      { metric: 'visitor_render_failure_total', labels: { cause: 'idle' }, equals: 1, description: '失败归因 idle' },
      { metric: 'visitor_render_attempts_total', labels: { outcome: 'degrade' }, equals: 1, description: '降级轮记一次 attempts' },
      { metric: 'visitor_render_fallback_total', equals: 0, description: '降级路径不产生主备切换' },
    ],
  },
];

interface ScenarioOutcome {
  readonly id: string;
  readonly title: string;
  readonly passed: boolean;
  readonly failures: readonly string[];
  readonly wallElapsedMs: number | null;
  readonly smokeExitCode: number | null;
}

function parseArgs(argv: readonly string[]): { only: string[]; keepGoing: boolean } {
  const onlyIndex = argv.indexOf('--only');
  const keepGoing = argv.includes('--keep-going');
  if (onlyIndex === -1) return { only: [], keepGoing };
  const value = argv.at(onlyIndex + 1);
  if (value === undefined) throw new Error('--only 需要场景 id，逗号分隔');
  return { only: value.split(',').map((item) => item.trim()), keepGoing };
}

function runScenario(scenario: Scenario): ScenarioOutcome {
  const result = runSmoke(scenario.args);
  const failures: string[] = [];
  if (result.exitCode !== 0) failures.push(`smoke 退出码 ${String(result.exitCode)}（期望 0）`);
  if (result.report === null) failures.push(result.parseError ?? 'smoke 未产出可解析报告');
  if (result.report !== null && result.report.ok !== true) failures.push('smoke 报告 ok 不为 true');
  const samples = result.report?.renderMetrics ?? [];
  if (result.report !== null && samples.length === 0) failures.push('报告没有 renderMetrics（--dump-render-metrics 未生效）');
  const probeResult = checkExpectations(buildMetricProbe(samples), scenario.expectations);
  failures.push(...probeResult.failures);
  return {
    id: scenario.id,
    title: scenario.title,
    passed: failures.length === 0,
    failures,
    wallElapsedMs: result.report?.wallElapsedMs ?? null,
    smokeExitCode: result.exitCode,
  };
}

function printOutcome(outcome: ScenarioOutcome): void {
  const status = outcome.passed ? 'PASS' : 'FAIL';
  const wall = outcome.wallElapsedMs === null ? '-' : `${String(Math.round(outcome.wallElapsedMs / 1000))}s`;
  console.log(`[${status}] ${outcome.id} · ${outcome.title} · 墙钟 ${wall} · exit=${String(outcome.smokeExitCode ?? '-')}`);
  for (const failure of outcome.failures) console.log(`   - ${failure}`);
}

function main(): void {
  const { only, keepGoing } = parseArgs(process.argv.slice(2));
  if (only.length > 0) {
    const unknown = only.filter((id) => !SCENARIOS.some((scenario) => scenario.id === id));
    if (unknown.length > 0) throw new Error(`未知场景：${unknown.join(',')}`);
  }
  const selected = only.length === 0 ? SCENARIOS : SCENARIOS.filter((scenario) => only.includes(scenario.id));
  if (selected.length === 0) throw new Error(`没有匹配的场景：${only.join(',')}`);

  console.log(`渲染故障矩阵自证：${String(selected.length)} 条场景（进程内指标，非线上累计值）`);
  const outcomes: ScenarioOutcome[] = [];
  for (const scenario of selected) {
    const outcome = runScenario(scenario);
    printOutcome(outcome);
    outcomes.push(outcome);
    if (!outcome.passed && !keepGoing) break;
  }

  const passed = outcomes.filter((outcome) => outcome.passed).length;
  const failed = outcomes.filter((outcome) => !outcome.passed).length;
  const skipped = selected.length - outcomes.length;
  console.log(`汇总：PASS ${String(passed)} / FAIL ${String(failed)} / 未执行 ${String(skipped)}`);
  if (failed > 0 || skipped > 0) process.exitCode = 1;
}

main();
