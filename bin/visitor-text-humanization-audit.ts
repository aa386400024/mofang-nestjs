/**
 * AF-328 文字真人度离线审计 CLI：扫描 debug session 的 visitor 台词，输出六类不流利数字
 * 与 humanization-v1 判据结果。
 *
 * 用法：
 *   pnpm exec tsx bin/visitor-text-humanization-audit.ts
 *   pnpm exec tsx bin/visitor-text-humanization-audit.ts --mode audit --ids debug_a,debug_b
 *   pnpm exec tsx bin/visitor-text-humanization-audit.ts --mode active --fail-on-violation
 *
 * 隐私：报告只含 session id、数字与判据状态，不含任何台词原文。
 * 退出码：默认 0（审计报告）；仅 --fail-on-violation 且总体 failed 时退出 1。
 */
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { analyzeDisfluency, aggregateDisfluency } from '../src/auto-practice/metrics/disfluency-analyzer.js';
import type { DisfluencyMetrics } from '../src/auto-practice/metrics/disfluency-lexicon.js';
import {
  HUMANIZATION_ACCEPTANCE_VERSION,
  buildHumanizationMetrics,
  evaluateHumanization,
  type HumanizationEvaluation,
  type HumanizationRealismMode,
} from '../src/auto-practice/metrics/humanization-acceptance.js';

interface DebugMessage {
  readonly role?: string;
  readonly text?: string;
}

interface DebugSessionFile {
  readonly id?: string;
  readonly messages?: readonly DebugMessage[];
}

interface CliOptions {
  readonly dir: string;
  readonly ids: readonly string[];
  readonly mode: HumanizationRealismMode;
  readonly json: boolean;
  readonly out: string | null;
  readonly failOnViolation: boolean;
  readonly minTurns: number;
}

interface SessionAudit {
  readonly sessionId: string;
  readonly turns: number;
  readonly events: number;
  readonly eventTurns: number;
  readonly normalizedChars: number;
  readonly metrics: Readonly<Record<string, number | null>>;
  readonly typeCounts: {
    readonly filler: number;
    readonly pause: number;
    readonly repetition: number;
    readonly repair: number;
    readonly trailoff: number;
    readonly elongation: number;
  };
  readonly evaluation: HumanizationEvaluation;
}

interface AuditReport {
  readonly acceptanceVersion: string;
  readonly mode: HumanizationRealismMode;
  readonly sessionCount: number;
  readonly totalTurns: number;
  readonly totals: {
    readonly metrics: Readonly<Record<string, number | null>>;
    readonly typeCounts: SessionAudit['typeCounts'];
  };
  readonly evaluation: HumanizationEvaluation;
  readonly sessions: readonly SessionAudit[];
  readonly missingIds: readonly string[];
}

function parseMode(raw: string): HumanizationRealismMode {
  if (raw === 'off' || raw === 'audit' || raw === 'active') return raw;
  throw new Error(`--mode 只接受 off|audit|active，收到: ${raw}`);
}

/**
 * 解析 CLI 参数。
 *
 * @param argv 参数列表
 * @returns 选项
 */
export function parseArgs(argv: readonly string[]): CliOptions {
  let dir = resolve(process.cwd(), 'data/debug-sessions');
  let ids: readonly string[] = [];
  let mode: HumanizationRealismMode = 'audit';
  let json = false;
  let out: string | null = null;
  let failOnViolation = false;
  let minTurns = 5;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    switch (arg) {
      case '--dir': {
        if (!next) throw new Error('--dir 缺少值');
        dir = resolve(process.cwd(), next);
        index += 1;

        break;
      }
      case '--ids': {
        if (!next) throw new Error('--ids 缺少值');
        ids = next
          .split(',')
          .map((id) => id.trim())
          .filter((id) => id.length > 0);
        index += 1;

        break;
      }
      case '--mode': {
        if (!next) throw new Error('--mode 缺少值');
        mode = parseMode(next);
        index += 1;

        break;
      }
      case '--out': {
        if (!next) throw new Error('--out 缺少值');
        out = resolve(process.cwd(), next);
        index += 1;

        break;
      }
      case '--min-turns': {
        if (!next) throw new Error('--min-turns 缺少值');
        const parsed = Number.parseInt(next, 10);
        if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`--min-turns 非法: ${next}`);
        minTurns = parsed;
        index += 1;

        break;
      }
      case '--json': {
        json = true;

        break;
      }
      case '--fail-on-violation': {
        failOnViolation = true;

        break;
      }
      case '--help':
      case '-h': {
        throw new Error('用量: --dir <dir> --ids a,b --mode off|audit|active --json --out <file> --min-turns n --fail-on-violation');
      }
      default: {
        throw new Error(`未知参数: ${arg}`);
      }
    }
  }

  return { dir, ids, mode, json, out, failOnViolation, minTurns };
}

/**
 * 对一场的 visitor 轮次做审计（纯函数，便于单测）。
 *
 * @param sessionId 场次 id
 * @param turns 每轮不流利度量
 * @param mode 真人度模式
 * @param minTurns 最低样本轮次
 * @returns 场次审计结果
 */
export function auditSession(
  sessionId: string,
  turns: readonly DisfluencyMetrics[],
  mode: HumanizationRealismMode,
  minTurns = 5,
): SessionAudit {
  const aggregate = aggregateDisfluency(turns);
  const events = turns.reduce((sum, turn) => sum + turn.events, 0);
  const eventTurns = turns.filter((turn) => turn.hasEvent).length;
  const normalizedChars = turns.reduce((sum, turn) => sum + turn.normalizedLength, 0);
  const metrics = buildHumanizationMetrics(turns.length, events, eventTurns, normalizedChars, aggregate.typeCounts);
  return {
    sessionId,
    turns: turns.length,
    events,
    eventTurns,
    normalizedChars,
    metrics,
    typeCounts: aggregate.typeCounts,
    evaluation: evaluateHumanization(metrics, { realismMode: mode, turns: turns.length, minTurns }),
  };
}

/**
 * 汇总多场审计（纯函数）。
 *
 * @param sessions 场次审计
 * @param mode 真人度模式
 * @param minTurns 最低样本轮次
 * @param missingIds 未找到的 id
 * @returns 审计报告
 */
export function buildReport(
  sessions: readonly SessionAudit[],
  mode: HumanizationRealismMode,
  minTurns = 5,
  missingIds: readonly string[] = [],
): AuditReport {
  const totalTurns = sessions.reduce((sum, session) => sum + session.turns, 0);
  const totalEvents = sessions.reduce((sum, session) => sum + session.events, 0);
  const totalEventTurns = sessions.reduce((sum, session) => sum + session.eventTurns, 0);
  const totalChars = sessions.reduce((sum, session) => sum + session.normalizedChars, 0);
  const typeCounts = sessions.reduce(
    (sum, session) => ({
      filler: sum.filler + session.typeCounts.filler,
      pause: sum.pause + session.typeCounts.pause,
      repetition: sum.repetition + session.typeCounts.repetition,
      repair: sum.repair + session.typeCounts.repair,
      trailoff: sum.trailoff + session.typeCounts.trailoff,
      elongation: sum.elongation + session.typeCounts.elongation,
    }),
    { filler: 0, pause: 0, repetition: 0, repair: 0, trailoff: 0, elongation: 0 },
  );
  const metrics = buildHumanizationMetrics(totalTurns, totalEvents, totalEventTurns, totalChars, typeCounts);
  return {
    acceptanceVersion: HUMANIZATION_ACCEPTANCE_VERSION,
    mode,
    sessionCount: sessions.length,
    totalTurns,
    totals: { metrics, typeCounts },
    evaluation: evaluateHumanization(metrics, { realismMode: mode, turns: totalTurns, minTurns }),
    sessions,
    missingIds,
  };
}

function readSession(filePath: string): { id: string; turns: DisfluencyMetrics[] } {
  const raw = JSON.parse(readFileSync(filePath, 'utf8')) as DebugSessionFile;
  const id =
    (raw.id ?? filePath)
      .split(/[\\/]/)
      .pop()
      ?.replace(/\.json$/i, '') ?? filePath;
  const turns = (raw.messages ?? [])
    .filter((message) => message.role === 'visitor' && typeof message.text === 'string')
    .map((message) => analyzeDisfluency(message.text ?? ''))
    .filter((metrics) => metrics.normalizedLength > 0);
  return { id, turns };
}

function formatNumber(value: number | null | undefined): string {
  return value === null || value === undefined ? 'n/a' : value.toFixed(6);
}

function printHuman(report: AuditReport): void {
  console.log(`文字真人度审计 ${report.acceptanceVersion}`);
  console.log(`模式: ${report.mode}${report.mode === 'active' ? '' : '（判据不参与，只测量）'}`);
  console.log(`总体: ${report.sessionCount} 场 / ${report.totalTurns} 轮`);
  const totals = report.totals.metrics;
  console.log(
    `事件/轮 ${formatNumber(totals['text.disfluency.events_per_turn'])} | ` +
      `事件轮次率 ${formatNumber(totals['text.disfluency.event_turn_rate'])} | ` +
      `密度/百字 ${formatNumber(totals['text.disfluency.density_per100'])} | ` +
      `修正/轮 ${formatNumber(totals['text.disfluency.repair_per_turn'])}`,
  );
  const counts = report.totals.typeCounts;
  console.log(
    `六类: filler ${counts.filler} / pause ${counts.pause} / repetition ${counts.repetition} / ` +
      `repair ${counts.repair} / trailoff ${counts.trailoff} / elongation ${counts.elongation}`,
  );
  console.log('逐场:');
  for (const session of report.sessions) {
    console.log(
      `- ${session.sessionId}: ${session.turns} 轮, 事件/轮 ${formatNumber(session.metrics['text.disfluency.events_per_turn'])}, ` +
        `轮次率 ${formatNumber(session.metrics['text.disfluency.event_turn_rate'])}, ` +
        `密度 ${formatNumber(session.metrics['text.disfluency.density_per100'])}, ` +
        `判据 ${session.evaluation.status}`,
    );
  }
  if (report.missingIds.length > 0) console.log(`未找到: ${report.missingIds.join(', ')}`);
  console.log(`判据: ${report.evaluation.status}（${report.evaluation.reason}）`);
  for (const result of report.evaluation.results) {
    console.log(`  ${result.metricId}: ${result.status} actual=${formatNumber(result.actual)} expected ${result.expected}`);
  }
}

function main(): void {
  const options = parseArgs(process.argv.slice(2));
  const files = readdirSync(options.dir).filter((name) => name.toLowerCase().endsWith('.json'));
  const wanted = new Set(options.ids);
  const sessions: SessionAudit[] = [];
  const found = new Set<string>();

  for (const name of files) {
    if (wanted.size > 0 && !wanted.has(name.replace(/\.json$/i, ''))) continue;
    const path = resolve(options.dir, name);
    const { id, turns } = readSession(path);
    if (turns.length === 0) continue;
    found.add(id);
    sessions.push(auditSession(id, turns, options.mode, options.minTurns));
  }

  const missingIds = options.ids.filter((id) => !found.has(id));
  sessions.sort((left, right) => left.sessionId.localeCompare(right.sessionId));
  const report = buildReport(sessions, options.mode, options.minTurns, missingIds);

  if (options.out) {
    mkdirSync(dirname(options.out), { recursive: true });
    writeFileSync(options.out, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  }
  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    printHuman(report);
  }

  if (options.failOnViolation && report.evaluation.status === 'failed') {
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
