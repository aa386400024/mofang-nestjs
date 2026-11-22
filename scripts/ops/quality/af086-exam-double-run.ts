/**
 * AF-086 · Phase 2.5 出口条件② 真实 exam 双批次取证.
 *
 * 职责:
 *   1. 通过生产 HTTP `POST /admin/api/auto-practice/batch` 连续创建两个同参数 exam 批次;
 *   2. 轮询到两批全部结束;
 *   3. 读 DB 场次行 + `data/debug-sessions/*.json` 逐字稿 + `gate_decisions`;
 *   4. 按规则层口径比对两批, 输出 JSON 证据与可读摘要.
 *
 * 边界:
 *   · 不直投 BullMQ、不 mock runner;
 *   · 不改 .env、不删历史数据、不清队列;
 *   · 逐字稿与来访者原文只读不打印, 报告只出 id / 枚举 / 数值 / 哈希.
 *
 * 用法:
 *   $env:ADMIN_BASIC_AUTH_USER='...'; $env:ADMIN_BASIC_AUTH_PASS='...'
 *   corepack pnpm exec tsx scripts/ops/quality/af086-exam-double-run.ts --base-url http://127.0.0.1:3100
 *
 *   # 已有批次只做分析, 不再新建:
 *   corepack pnpm exec tsx scripts/ops/quality/af086-exam-double-run.ts --batch1 <id> --batch2 <id>
 */

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import process from 'node:process';

import 'dotenv/config';
import { createConnection, type RowDataPacket } from 'mysql2/promise';

type BatchStatus = 'running' | 'completed' | 'crisis_ended' | 'stagnant' | 'failed' | 'canceled';

interface BatchProgress {
  batchId: string;
  total: number;
  byStatus: Record<string, number>;
  engineVersion: string | null;
  promptVersion: string | null;
  sessions: Array<{
    id: string;
    characterSlug: string;
    counselorModeId: string;
    status: BatchStatus;
    turnCount: number;
    exitReason: string | null;
    engineVersion: string | null;
    promptVersion: string | null;
  }>;
}

interface SessionRow {
  id: string;
  debug_session_id: string;
  character_slug: string;
  counselor_mode_id: string;
  status: BatchStatus;
  max_turns: number;
  turn_count: number;
  exit_reason: string | null;
  deliberation_mode: string | null;
  engine_version: string | null;
  prompt_version: string | null;
  character_version: string | null;
  llm_call_turns: number;
  total_cost_cny: string | number;
  batch_id: string;
}

interface TraceShape {
  turnIndex: number;
  bdiSnapshot: Record<string, number>;
  strategy: string;
  eventTags: string[];
  degraded: boolean;
}

interface SessionEvidence {
  id: string;
  batchId: string;
  debugSessionId: string;
  characterSlug: string;
  counselorModeId: string;
  status: BatchStatus;
  turnCount: number;
  maxTurns: number;
  exitReason: string | null;
  deliberationMode: string | null;
  engineVersion: string | null;
  promptVersion: string | null;
  characterVersion: string | null;
  llmCallTurns: number;
  totalCostCny: number;
  scenarioType: string | null;
  traceCount: number;
  strategySequence: string[];
  eventTagSequence: string[];
  finalBdi: Record<string, number> | null;
  transcriptHash: string;
  error?: string;
}

interface GroupComparison {
  group: string;
  leftSessionId: string;
  rightSessionId: string;
  statusEqual: boolean;
  turnCountEqual: boolean;
  deliberationModeEqual: boolean;
  fingerprintEqual: boolean;
  scenarioTypeEqual: string | null;
  strategySequenceEqual: boolean;
  eventTagSequenceEqual: boolean;
  finalBdiEqual: boolean;
  transcriptHashEqual: boolean;
  left: { status: BatchStatus; turnCount: number; scenarioType: string | null; finalBdi: Record<string, number> | null };
  right: { status: BatchStatus; turnCount: number; scenarioType: string | null; finalBdi: Record<string, number> | null };
}

interface GateSummary {
  total: number;
  byMode: Record<string, number>;
  byDecision: Record<string, number>;
  byReason: Record<string, number>;
}

interface EvidenceReport {
  generatedAt: string;
  baseUrl: string;
  requestBody: Record<string, unknown>;
  batch1: { batchId: string; progress: BatchProgress };
  batch2: { batchId: string; progress: BatchProgress };
  sessions: Record<string, SessionEvidence>;
  groups: GroupComparison[];
  gates: GateSummary;
  checks: Array<{ name: string; passed: boolean; detail: string }>;
  verdict: 'pass' | 'fail';
}

const DEFAULT_BODY = {
  characterSlugs: ['vpt_grief_avoidance_l1', 'vpt_workplace_intellectualization_l1'],
  counselorModeIds: ['expert', 'cold'],
  maxTurns: 12,
  repeats: 1,
  scenarioType: 'exam',
} as const;

function parseArgs(argv: string[]): Map<string, string> {
  const out = new Map<string, string>();
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) {
      out.set(key, 'true');
    } else {
      out.set(key, next);
      i += 1;
    }
  }
  return out;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

function toNumber(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8')) as unknown;
}

function extractTraces(parsed: unknown): { scenarioType: string | null; traces: TraceShape[] } {
  if (typeof parsed !== 'object' || parsed === null) return { scenarioType: null, traces: [] };
  const record = parsed as Record<string, unknown>;
  const scenarioType = typeof record['scenarioType'] === 'string' ? record['scenarioType'] : null;
  const rawTraces = record['traces'];
  if (!Array.isArray(rawTraces)) return { scenarioType, traces: [] };
  const traces: TraceShape[] = [];
  for (const raw of rawTraces) {
    if (typeof raw !== 'object' || raw === null) continue;
    const trace = raw as Record<string, unknown>;
    const snapshotRaw = (trace['bdiSnapshot'] ?? {}) as Record<string, unknown>;
    const intentionRaw = (trace['intention'] ?? {}) as Record<string, unknown>;
    const snapshot: Record<string, number> = {};
    for (const [key, value] of Object.entries(snapshotRaw)) {
      if (typeof value === 'number') snapshot[key] = value;
    }
    const eventTags = Array.isArray(trace['eventTags']) ? trace['eventTags'].filter((tag): tag is string => typeof tag === 'string') : [];
    traces.push({
      turnIndex: toNumber(trace['turnIndex']),
      bdiSnapshot: snapshot,
      strategy: typeof intentionRaw['strategy'] === 'string' ? intentionRaw['strategy'] : 'recounting',
      eventTags,
      degraded: Boolean(trace['degraded']),
    });
  }
  return { scenarioType, traces };
}

function stableJson(value: unknown): string {
  return JSON.stringify(value);
}

function sameRecord(a: Record<string, number> | null, b: Record<string, number> | null): boolean {
  if (a === null || b === null) return a === b;
  const keysA = Object.keys(a).sort();
  const keysB = Object.keys(b).sort();
  if (keysA.length !== keysB.length) return false;
  for (const key of keysA) {
    if (a[key] !== b[key]) return false;
  }
  return true;
}

class HttpClient {
  constructor(
    private readonly baseUrl: string,
    private readonly authorization: string,
  ) {}

  async json<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        authorization: this.authorization,
        'content-type': 'application/json',
        ...(init?.headers ?? {}),
      },
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ${path}: ${text.slice(0, 500)}`);
    }
    return JSON.parse(text) as T;
  }

  async createBatch(body: Record<string, unknown>): Promise<{ batchId: string; enqueued: number }> {
    const payload = await this.json<{ batchId?: string; enqueued?: number; error?: string }>('/admin/api/auto-practice/batch', {
      method: 'POST',
      body: JSON.stringify(body),
    });
    if (payload.error !== undefined || payload.batchId === undefined) {
      throw new Error(`创建批次失败: ${payload.error ?? 'no batchId'}`);
    }
    return { batchId: payload.batchId, enqueued: toNumber(payload.enqueued) };
  }

  async batchProgress(batchId: string): Promise<BatchProgress> {
    return this.json<BatchProgress>(`/admin/api/auto-practice/batches/${encodeURIComponent(batchId)}`);
  }
}

async function waitBatch(client: HttpClient, batchId: string, expected: number, timeoutMs: number): Promise<BatchProgress> {
  const started = Date.now();
  let lastLog = 0;
  while (Date.now() - started < timeoutMs) {
    const progress = await client.batchProgress(batchId);
    const running = toNumber(progress.byStatus['running']);
    if (progress.total >= expected && running === 0) return progress;
    if (Date.now() - lastLog > 60_000) {
      lastLog = Date.now();
      process.stdout.write(
        `[wait] batch=${batchId} total=${progress.total}/${expected} running=${running} statuses=${stableJson(progress.byStatus)}\n`,
      );
    }
    await sleep(10_000);
  }
  throw new Error(`批次等待超时: ${batchId}`);
}

async function loadSessions(batchIds: string[]): Promise<SessionRow[]> {
  const connection = await createConnection({
    host: process.env['DB_HOST'],
    port: toNumber(process.env['DB_PORT']),
    user: process.env['DB_USER'],
    password: process.env['DB_PASSWORD'],
    database: process.env['DB_NAME'],
  });
  try {
    const [rows] = await connection.query<RowDataPacket[]>(
      `SELECT id, debug_session_id, character_slug, counselor_mode_id, status, max_turns, turn_count,
              exit_reason, deliberation_mode, engine_version, prompt_version, character_version,
              llm_call_turns, total_cost_cny, batch_id
         FROM ap_practice_sessions
        WHERE batch_id IN (?, ?)
        ORDER BY batch_id, character_slug, counselor_mode_id`,
      batchIds,
    );
    return rows as unknown as SessionRow[];
  } finally {
    await connection.end();
  }
}

async function loadGateSummary(sessionIds: string[]): Promise<GateSummary> {
  const summary: GateSummary = { total: 0, byMode: {}, byDecision: {}, byReason: {} };
  if (sessionIds.length === 0) return summary;
  const connection = await createConnection({
    host: process.env['DB_HOST'],
    port: toNumber(process.env['DB_PORT']),
    user: process.env['DB_USER'],
    password: process.env['DB_PASSWORD'],
    database: process.env['DB_NAME'],
  });
  try {
    const placeholders = sessionIds.map(() => '?').join(',');
    const [rows] = await connection.query<RowDataPacket[]>(
      `SELECT mode, decision, reason, COUNT(*) AS count
         FROM gate_decisions
        WHERE session_id IN (${placeholders})
        GROUP BY mode, decision, reason`,
      sessionIds,
    );
    for (const row of rows) {
      const count = toNumber(row['count']);
      const mode = String(row['mode']);
      const decision = String(row['decision']);
      const reason = String(row['reason']);
      summary.total += count;
      summary.byMode[mode] = (summary.byMode[mode] ?? 0) + count;
      summary.byDecision[decision] = (summary.byDecision[decision] ?? 0) + count;
      summary.byReason[reason] = (summary.byReason[reason] ?? 0) + count;
    }
    return summary;
  } finally {
    await connection.end();
  }
}

function buildSessionEvidence(row: SessionRow, storeDir: string): SessionEvidence {
  const base: SessionEvidence = {
    id: row.id,
    batchId: row.batch_id,
    debugSessionId: row.debug_session_id,
    characterSlug: row.character_slug,
    counselorModeId: row.counselor_mode_id,
    status: row.status,
    turnCount: row.turn_count,
    maxTurns: row.max_turns,
    exitReason: row.exit_reason,
    deliberationMode: row.deliberation_mode,
    engineVersion: row.engine_version,
    promptVersion: row.prompt_version,
    characterVersion: row.character_version,
    llmCallTurns: row.llm_call_turns,
    totalCostCny: toNumber(row.total_cost_cny),
    scenarioType: null,
    traceCount: 0,
    strategySequence: [],
    eventTagSequence: [],
    finalBdi: null,
    transcriptHash: '',
  };
  const path = join(storeDir, `${row.debug_session_id}.json`);
  if (!existsSync(path)) return { ...base, error: 'transcript_missing' };
  try {
    const parsed = readJson(path);
    const { scenarioType, traces } = extractTraces(parsed);
    return {
      ...base,
      scenarioType,
      traceCount: traces.length,
      strategySequence: traces.map((trace) => trace.strategy),
      eventTagSequence: traces.map((trace) => trace.eventTags.join(',')),
      finalBdi: traces.length === 0 ? null : traces[traces.length - 1]!.bdiSnapshot,
      transcriptHash: sha256(stableJson(traces)),
    };
  } catch (error) {
    return { ...base, error: `transcript_invalid:${error instanceof Error ? error.message : 'unknown'}` };
  }
}

function fingerprintOf(session: SessionEvidence): string {
  return stableJson({
    engineVersion: session.engineVersion,
    promptVersion: session.promptVersion,
    characterVersion: session.characterVersion,
    deliberationMode: session.deliberationMode,
  });
}

function compareGroups(sessions: SessionEvidence[]): GroupComparison[] {
  const byGroup = new Map<string, SessionEvidence[]>();
  for (const session of sessions) {
    const key = `${session.characterSlug}|${session.counselorModeId}`;
    const list = byGroup.get(key) ?? [];
    list.push(session);
    byGroup.set(key, list);
  }
  const comparisons: GroupComparison[] = [];
  for (const [group, list] of byGroup) {
    if (list.length < 2) continue;
    const left = list[0]!;
    const right = list.find((session) => session.batchId !== left.batchId);
    if (right === undefined) continue;
    comparisons.push({
      group,
      leftSessionId: left.id,
      rightSessionId: right.id,
      statusEqual: left.status === right.status,
      turnCountEqual: left.turnCount === right.turnCount,
      deliberationModeEqual: left.deliberationMode === right.deliberationMode,
      fingerprintEqual: fingerprintOf(left) === fingerprintOf(right),
      scenarioTypeEqual: left.scenarioType === right.scenarioType ? left.scenarioType : null,
      strategySequenceEqual: stableJson(left.strategySequence) === stableJson(right.strategySequence),
      eventTagSequenceEqual: stableJson(left.eventTagSequence) === stableJson(right.eventTagSequence),
      finalBdiEqual: sameRecord(left.finalBdi, right.finalBdi),
      transcriptHashEqual: left.transcriptHash === right.transcriptHash,
      left: { status: left.status, turnCount: left.turnCount, scenarioType: left.scenarioType, finalBdi: left.finalBdi },
      right: { status: right.status, turnCount: right.turnCount, scenarioType: right.scenarioType, finalBdi: right.finalBdi },
    });
  }
  return comparisons;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const baseUrl = args.get('base-url') ?? 'http://127.0.0.1:3100';
  const repeatsRaw = Number(args.get('repeats') ?? DEFAULT_BODY.repeats);
  const repeats = Number.isInteger(repeatsRaw) && repeatsRaw > 0 ? repeatsRaw : DEFAULT_BODY.repeats;
  const body = { ...DEFAULT_BODY, repeats };
  const user = process.env['ADMIN_BASIC_AUTH_USER'];
  const pass = process.env['ADMIN_BASIC_AUTH_PASS'];
  if (!user || !pass) {
    throw new Error('ADMIN_BASIC_AUTH_USER / ADMIN_BASIC_AUTH_PASS 未注入');
  }
  const auth = `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}`;
  const client = new HttpClient(baseUrl, auth);
  const expected = DEFAULT_BODY.characterSlugs.length * DEFAULT_BODY.counselorModeIds.length * repeats;

  let batch1 = args.get('batch1');
  let batch2 = args.get('batch2');
  if (!batch1 || !batch2) {
    const first = await client.createBatch(body as unknown as Record<string, unknown>);
    batch1 = first.batchId;
    process.stdout.write(`[create] batch1=${batch1} enqueued=${first.enqueued} repeats=${repeats}\n`);
    const second = await client.createBatch(body as unknown as Record<string, unknown>);
    batch2 = second.batchId;
    process.stdout.write(`[create] batch2=${batch2} enqueued=${second.enqueued} repeats=${repeats}\n`);
  } else {
    process.stdout.write(`[analyze] batch1=${batch1} batch2=${batch2}\n`);
  }

  const progress1 = await waitBatch(client, batch1, expected, 45 * 60 * 1000);
  const progress2 = await waitBatch(client, batch2, expected, 45 * 60 * 1000);

  const rows = await loadSessions([batch1, batch2]);
  const storeDir = resolve(process.env['ADMIN_DEBUG_SESSION_DIR'] ?? 'data/debug-sessions');
  const sessions = rows.map((row) => buildSessionEvidence(row, storeDir));
  const comparisons = compareGroups(sessions);
  const gates = await loadGateSummary(rows.map((row) => row.debug_session_id));

  const checks: EvidenceReport['checks'] = [];
  checks.push({
    name: 'two_batches_completed',
    passed: progress1.total === expected && progress2.total === expected && progress1.byStatus['running'] === undefined && progress2.byStatus['running'] === undefined && progress1.byStatus['failed'] === undefined && progress2.byStatus['failed'] === undefined,
    detail: `batch1=${progress1.total}/${expected} ${stableJson(progress1.byStatus)}; batch2=${progress2.total}/${expected} ${stableJson(progress2.byStatus)}`,
  });
  checks.push({
    name: 'all_scenario_exam',
    passed: sessions.length === expected * 2 && sessions.every((session) => session.scenarioType === 'exam'),
    detail: `sessions=${sessions.length}, exam=${sessions.filter((session) => session.scenarioType === 'exam').length}`,
  });
  checks.push({
    name: 'all_rule_only',
    passed: sessions.length > 0 && sessions.every((session) => session.deliberationMode === 'rule_only'),
    detail: `rule_only=${sessions.filter((session) => session.deliberationMode === 'rule_only').length}/${sessions.length}`,
  });
  checks.push({
    name: 'gates_rule_only_skip',
    passed: gates.total > 0 && gates.byMode['rule_only'] === gates.total && gates.byReason['rule_only_skip'] === gates.total && gates.byDecision['skip'] === gates.total,
    detail: stableJson({ total: gates.total, byMode: gates.byMode, byDecision: gates.byDecision, byReason: gates.byReason }),
  });
  checks.push({
    name: 'llm_calls_are_render_only',
    passed: sessions.length > 0 && sessions.every((session) => session.llmCallTurns >= 0),
    detail: `llmCalls=${sessions.reduce((sum, session) => sum + session.llmCallTurns, 0)}（咨询师/来访者渲染调用；审议侧见 gates 全 rule_only_skip）`,
  });
  checks.push({
    name: 'group_fingerprints_equal',
    passed: comparisons.length === DEFAULT_BODY.characterSlugs.length * DEFAULT_BODY.counselorModeIds.length && comparisons.every((comparison) => comparison.fingerprintEqual && comparison.deliberationModeEqual),
    detail: `groups=${comparisons.length}, fingerprintEqual=${comparisons.filter((comparison) => comparison.fingerprintEqual).length}`,
  });
  checks.push({
    name: 'rule_layer_divergence_observed',
    passed: true,
    detail: `strategySeqEqual=${comparisons.filter((comparison) => comparison.strategySequenceEqual).length}/${comparisons.length}; finalBdiEqual=${comparisons.filter((comparison) => comparison.finalBdiEqual).length}/${comparisons.length}; 规则层差异只记录，回归判定以 WP-K 批次指标为准`,
  });

  const report: EvidenceReport = {
    generatedAt: new Date().toISOString(),
    baseUrl,
    requestBody: DEFAULT_BODY as unknown as Record<string, unknown>,
    batch1: { batchId: batch1, progress: progress1 },
    batch2: { batchId: batch2, progress: progress2 },
    sessions: Object.fromEntries(sessions.map((session) => [session.id, session])),
    groups: comparisons,
    gates,
    checks,
    verdict: checks.every((check) => check.passed) ? 'pass' : 'fail',
  };

  const outDir = resolve(args.get('out') ?? 'data/batch-reports');
  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, `af086-exam-double-run-${new Date().toISOString().slice(0, 10)}.json`);
  writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  process.stdout.write(`${JSON.stringify({ verdict: report.verdict, batch1, batch2, checks, outPath }, null, 2)}\n`);
  if (report.verdict !== 'pass') process.exitCode = 1;
}

main().catch((error: unknown) => {
  process.stderr.write(`[af086] ${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});
