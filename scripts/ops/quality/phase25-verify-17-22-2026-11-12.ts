// Phase2.5 只读复核脚本 (2026-11-12) —— 覆盖台账 I-17 / I-22 / I-23 遗留 / cold 阈值样本内复核.
//
// 纪律 (与 visitor-quality-audit.ts 同款):
//   · 纯离线只读 + 只读 DB 元数据 (风格 / 模式), 不写库、不调 LLM、不发网络请求;
//   · 输出只含 session id / 计数 / 标签 / 比率, 不出现任何对话原文;
//   · 词表与打标逻辑复用 visitor-quality-lexicon.ts (口径同源, 不另造一套).
//
// 用法:
//   pnpm exec tsx scripts/ops/quality/phase25-verify-17-22-2026-11-12.ts
//
// 输出: data/quality/verify-17-22-slice-2026-11-12.txt

import 'dotenv/config';
import mysql from 'mysql2/promise';
import fs from 'node:fs';
import path from 'node:path';

import { anxiousDimensionsOf, labelOf, type BehaviorLabel } from './visitor-quality-lexicon.js';

const REPO = process.cwd();
const SESSION_DIR = path.join(REPO, 'data', 'debug-sessions');
const REPORT_JSON = path.join(REPO, 'data', 'batch-reports', 'g3ONzlqSGMVJqkFMF9Lwh.json');
const OUT_FILE = path.join(REPO, 'data', 'quality', 'verify-17-22-slice-2026-11-12.txt');
const BATCH_ID = 'g3ONzlqSGMVJqkFMF9Lwh';

type AttachmentStyle = 'secure' | 'anxious' | 'avoidant' | 'disorganized' | 'unknown';

const EXPECTED_LABEL: Readonly<Record<AttachmentStyle, BehaviorLabel>> = {
  secure: 'approach',
  anxious: 'appease',
  avoidant: 'avoid',
  disorganized: 'attack',
  unknown: 'neutral',
};

/** 与 batch-metrics.compute.ts DIMENSION_SNAPSHOT_KEY 同口径的八维. */
const DIM_KEYS = ['trust', 'safety', 'bond', 'valence', 'arousal', 'resistanceVerbal', 'resistanceDepth', 'resistanceStyle'] as const;

/** 现有 appease 词表之外的让步/道歉近义说法 (仅作覆盖缺口统计, 不进产品词表). */
const APPEASE_GAP_WORDS: readonly string[] = [
  '没事',
  '没关系',
  '随便',
  '对不起',
  '抱歉',
  '我错',
  '不好意思',
  '迁就',
  '体谅',
  '随和',
  '无所谓',
  '你决定',
  '不麻烦',
  '别客气',
  '客气',
  '配合你',
  '顺着你',
  '让步',
];

interface TraceRow {
  readonly turnIndex?: number;
  readonly bdiSnapshot?: Record<string, number>;
  readonly eventTags?: readonly string[];
  readonly strategy?: string;
}

interface SessionDoc {
  readonly id?: string;
  readonly characterSlug?: string;
  readonly messages?: readonly { readonly role?: string; readonly text?: string }[];
  readonly traces?: readonly TraceRow[];
}

interface SessionRow {
  readonly debugSessionId: string;
  readonly characterSlug: string;
  readonly mode: string;
  readonly style: AttachmentStyle;
  readonly turns: number;
  readonly labelCounts: Record<BehaviorLabel, number>;
  readonly labeledTurns: number;
  readonly dominantLabel: BehaviorLabel;
  readonly expected: BehaviorLabel;
  readonly match: boolean;
  readonly channel: { seek: number; appease: number; abandon: number };
  readonly channelTurns: number;
  readonly appeaseGapTurns: number;
  readonly zeroMotion: boolean;
  readonly hasNonNeutral: boolean;
  readonly safetyDelta: number;
}

function attachmentFromSlug(slug: string): AttachmentStyle {
  if (slug.includes('avoidant') || slug.includes('avoidance')) return 'avoidant';
  if (slug.includes('anxious')) return 'anxious';
  if (slug.includes('disorganized')) return 'disorganized';
  if (slug.includes('secure')) return 'secure';
  return 'unknown';
}

function dominantLabelOf(counts: Record<BehaviorLabel, number>): BehaviorLabel {
  const order: BehaviorLabel[] = ['avoid', 'attack', 'appease', 'approach'];
  let best: BehaviorLabel = 'neutral';
  let bestCount = 0;
  for (const label of order) {
    if (counts[label] > bestCount) {
      bestCount = counts[label];
      best = label;
    }
  }
  return best;
}

function toNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function isZeroMotion(traces: readonly TraceRow[]): boolean {
  if (traces.length === 0) return false;
  const first = traces[0]?.bdiSnapshot ?? {};
  const last = traces.at(-1)?.bdiSnapshot ?? first;
  return DIM_KEYS.every((dim) => toNumber(first[dim]) === toNumber(last[dim]));
}

function hasNonNeutralEvent(traces: readonly TraceRow[]): boolean {
  return traces.some((trace) => (trace.eventTags ?? []).some((tag) => tag !== 'neutral'));
}

async function loadDbMaps(): Promise<{
  styles: Map<string, AttachmentStyle>;
  modes: Map<string, string>;
  dbOk: boolean;
}> {
  const styles = new Map<string, AttachmentStyle>();
  const modes = new Map<string, string>();
  let dbOk = false;
  let conn: mysql.Connection | null = null;
  try {
    conn = await mysql.createConnection({
      host: process.env['DB_HOST'],
      port: Number(process.env['DB_PORT']),
      user: process.env['DB_USER'],
      password: process.env['DB_PASSWORD'],
      database: process.env['DB_NAME'],
    });
    const [styleRows] = await conn.execute('SELECT template_id, attachment_style FROM character_profiles');
    for (const row of styleRows as { template_id: string; attachment_style: string }[]) {
      styles.set(row.template_id, row.attachment_style as AttachmentStyle);
    }
    const [modeRows] = await conn.execute('SELECT debug_session_id, counselor_mode_id FROM ap_practice_sessions WHERE batch_id = ?', [
      BATCH_ID,
    ]);
    for (const row of modeRows as { debug_session_id: string; counselor_mode_id: string }[]) {
      modes.set(row.debug_session_id, row.counselor_mode_id);
    }
    dbOk = true;
  } catch (error) {
    console.warn(`[warn] DB 读取失败, 风格回退 slug、模式留空: ${String((error as Error).message ?? error)}`);
  } finally {
    await conn?.end();
  }
  return { styles, modes, dbOk };
}

function loadDocs(): Map<string, SessionDoc> {
  const out = new Map<string, SessionDoc>();
  for (const name of fs.readdirSync(SESSION_DIR)) {
    if (!name.endsWith('.json')) continue;
    try {
      const doc = JSON.parse(fs.readFileSync(path.join(SESSION_DIR, name), 'utf8')) as SessionDoc;
      const key = doc.id ?? name.replace(/\.json$/, '');
      out.set(key, doc);
    } catch {
      // 坏文件跳过, 与 audit 脚本一致.
    }
  }
  return out;
}

function auditSession(id: string, doc: SessionDoc, styles: Map<string, AttachmentStyle>, modes: Map<string, string>): SessionRow {
  const slug = doc.characterSlug ?? '';
  const style = styles.get(slug) ?? attachmentFromSlug(slug);
  const mode = modes.get(id) ?? '(db-missing)';
  const visits = (doc.messages ?? []).filter((m) => m.role === 'visitor');
  const texts = visits.map((m) => String(m.text ?? ''));

  const labelCounts: Record<BehaviorLabel, number> = { approach: 0, avoid: 0, attack: 0, appease: 0, neutral: 0 };
  const channel = { seek: 0, appease: 0, abandon: 0 };
  let channelTurns = 0;
  let appeaseGapTurns = 0;

  for (const text of texts) {
    const label = labelOf(text);
    labelCounts[label] += 1;
    const dims = anxiousDimensionsOf(text);
    let hit = false;
    if (dims.seekReassure > 0) {
      channel.seek += 1;
      hit = true;
    }
    if (dims.appease > 0) {
      channel.appease += 1;
      hit = true;
    }
    if (dims.abandonment > 0) {
      channel.abandon += 1;
      hit = true;
    }
    if (hit) channelTurns += 1;
    // 缺口探查: 现有 appease 词表/通道都没命中, 但出现近义让步说法 (只计数, 不引句).
    if (label !== 'appease' && dims.appease === 0 && APPEASE_GAP_WORDS.some((w) => text.includes(w))) {
      appeaseGapTurns += 1;
    }
  }

  const labeledTurns = (['approach', 'avoid', 'attack', 'appease'] as BehaviorLabel[]).reduce((sum, l) => sum + labelCounts[l], 0);
  const dominantLabel = dominantLabelOf(labelCounts);
  const expected = EXPECTED_LABEL[style];
  const traces = doc.traces ?? [];
  const zeroMotion = isZeroMotion(traces);
  const hasNonNeutral = hasNonNeutralEvent(traces);
  const safetyDelta = traces.length > 0 ? toNumber(traces.at(-1)?.bdiSnapshot?.safety) - toNumber(traces[0]?.bdiSnapshot?.safety) : 0;

  return {
    debugSessionId: id,
    characterSlug: slug,
    mode,
    style,
    turns: texts.length,
    labelCounts,
    labeledTurns,
    dominantLabel,
    expected,
    match: dominantLabel === expected,
    channel,
    channelTurns,
    appeaseGapTurns,
    zeroMotion,
    hasNonNeutral,
    safetyDelta,
  };
}

function pct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function mean(values: readonly number[]): number {
  return values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length;
}

function groupBy<T>(rows: readonly T[], pick: (row: T) => string): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const row of rows) {
    const key = pick(row);
    out.set(key, [...(out.get(key) ?? []), row]);
  }
  return out;
}

type LineFn = (text?: string) => void;

function sectionLabels(rows: SessionRow[], line: LineFn): void {
  const labeledTurns = rows.reduce((s, r) => s + r.labeledTurns, 0);
  const totalTurns = rows.reduce((s, r) => s + r.turns, 0);
  const matchCount = rows.filter((r) => r.match).length;
  line('## A. I-17 主导标签 / 讨好通道复核');
  line(`文本标签覆盖轮占比 ${pct(totalTurns ? labeledTurns / totalTurns : 0)}`);
  line(`主导标签命中率 ${matchCount}/${rows.length}  ${pct(rows.length ? matchCount / rows.length : 0)}  (门禁 ≥70%)`);
  line('');
  line('### A.1 分角色');
  line(
    '角色 | 风格 | 模式(expert/cold 场次数) | 场次 | 轮数 | approach | avoid | attack | appease | neutral | 主导 | 期望 | 命中 | 讨好命中轮 | 讨好缺口轮',
  );
  for (const [slug, list] of [...groupBy(rows, (r) => r.characterSlug)].toSorted()) {
    const style = list[0].style;
    const modeCount = groupBy(list, (r) => r.mode);
    const modeStr = [...modeCount].map(([m, l]) => `${m}:${l.length}`).join(' ');
    const turns = list.reduce((s, r) => s + r.turns, 0);
    const lc = list.reduce(
      (acc, r) => {
        for (const k of Object.keys(r.labelCounts) as BehaviorLabel[]) acc[k] += r.labelCounts[k];
        return acc;
      },
      { approach: 0, avoid: 0, attack: 0, appease: 0, neutral: 0 } as Record<BehaviorLabel, number>,
    );
    const appease = list.reduce((s, r) => s + r.channel.appease, 0);
    const gap = list.reduce((s, r) => s + r.appeaseGapTurns, 0);
    const hits = list.filter((r) => r.match).length;
    line(
      `${slug} | ${style} | ${modeStr} | ${list.length} | ${turns} | ${lc.approach} | ${lc.avoid} | ${lc.attack} | ${lc.appease} | ${lc.neutral} | ${list[0].dominantLabel} | ${list[0].expected} | ${hits}/${list.length} | ${appease} | ${gap}`,
    );
  }
  line('');
  const groups: readonly [string, SessionRow[]][] = [
    ['anxious 角色', rows.filter((r) => r.style === 'anxious')],
    ['其余角色', rows.filter((r) => r.style !== 'anxious')],
  ];
  for (const [groupName, list] of groups) {
    const turns = list.reduce((s, r) => s + r.turns, 0);
    const seek = list.reduce((s, r) => s + r.channel.seek, 0);
    const appease = list.reduce((s, r) => s + r.channel.appease, 0);
    const abandon = list.reduce((s, r) => s + r.channel.abandon, 0);
    const hitTurns = list.reduce((s, r) => s + r.channelTurns, 0);
    const withHit = list.filter((r) => r.channelTurns > 0).length;
    const gap = list.reduce((s, r) => s + r.appeaseGapTurns, 0);
    line(
      `${groupName}: 场次 ${list.length} 轮数 ${turns} 求证 ${pct(turns ? seek / turns : 0)} 讨好 ${pct(turns ? appease / turns : 0)} 怕被抛弃 ${pct(turns ? abandon / turns : 0)} 任一命中轮 ${pct(turns ? hitTurns / turns : 0)} 有命中场次 ${withHit}/${list.length} 讨好近义缺口轮 ${gap}`,
    );
  }
  line('');
}

function sectionZeroMotion(rows: SessionRow[], line: LineFn): void {
  const zero = rows.filter((r) => r.zeroMotion);
  const closure = zero.filter((r) => r.hasNonNeutral);
  const idle = zero.filter((r) => !r.hasNonNeutral);
  line('## B. I-22 zero_motion 语义复核 (首末八维全等 = 零变化)');
  line(`零变化场次 total ${zero.length}  closure(事件层含非 neutral) ${closure.length}  idle(纯 neutral) ${idle.length}`);
  for (const [mode, list] of groupBy(zero, (r) => r.mode)) {
    const c = list.filter((r) => r.hasNonNeutral).length;
    line(`  ${mode}: total ${list.length}  closure ${c}  idle ${list.length - c}`);
  }
  const nonZeroWithEvent = rows.filter((r) => !r.zeroMotion && r.hasNonNeutral).length;
  line(`非零变化且事件层含非 neutral 的场次 ${nonZeroWithEvent} (背景参照)`);
  line('零变化场次明细 (id | 模式 | 角色 | 含非 neutral 事件):');
  for (const r of zero) line(`  ${r.debugSessionId} | ${r.mode} | ${r.characterSlug} | ${r.hasNonNeutral ? 'yes' : 'no'}`);
  line('');
}

function sectionSafety(rows: SessionRow[], line: LineFn): void {
  line('## C. safety 增量 · 模式 × 角色交叉切片 (safetyDelta = 末轮 - 首轮 bdiSnapshot.safety)');
  for (const [mode, modeRows] of [...groupBy(rows, (r) => r.mode)].toSorted()) {
    line(`### C.${mode}`);
    line('角色 | 场次 | 轮数 | safetyDelta 均值 | 零变化场次');
    for (const [slug, list] of [...groupBy(modeRows, (r) => r.characterSlug)].toSorted()) {
      const zeroCount = list.filter((r) => r.zeroMotion).length;
      line(
        `${slug} | ${list.length} | ${list.reduce((s, r) => s + r.turns, 0)} | ${mean(list.map((r) => r.safetyDelta)).toFixed(4)} | ${zeroCount}`,
      );
    }
    line(`切片整体 safetyDelta 均值 ${mean(modeRows.map((r) => r.safetyDelta)).toFixed(4)}`);
    line('');
  }
}

function sectionColdThresholds(rows: SessionRow[], line: LineFn): void {
  line('## D. cold 候选阈值样本内复核 (数值取自批次报告 JSON byMode.cold)');
  if (!fs.existsSync(REPORT_JSON)) {
    line('报告 JSON 不存在, 跳过.');
    return;
  }
  const report = JSON.parse(fs.readFileSync(REPORT_JSON, 'utf8'));
  const cold = report.byMode?.cold?.metrics ?? {};
  const expert = report.byMode?.expert?.metrics ?? {};
  const expectationsCold: { id: string; min?: number; max?: number }[] = [
    { id: 'dim.trust.delta_avg', min: 0.01, max: 0.08 },
    { id: 'dim.safety.delta_avg', min: 0, max: 0.03 },
    { id: 'dim.bond.delta_avg', min: -0.03, max: 0.03 },
    { id: 'dim.depth.delta_avg', min: -0.05, max: 0.05 },
    { id: 'dim.style.delta_avg', min: -0.05, max: 0.05 },
    { id: 'dim.verbal.delta_avg', min: -0.05, max: 0.05 },
    { id: 'dim.arousal.delta_avg', min: -0.05 },
  ];
  line('指标 | cold 实测 | expert 实测 | cold 候选区间 | cold 是否在区间');
  for (const e of expectationsCold) {
    const v = cold[e.id];
    const ev = expert[e.id];
    const inRange = typeof v === 'number' && (e.min === undefined || v >= e.min) && (e.max === undefined || v <= e.max);
    const range = `${e.min ?? '-∞'} ~ ${e.max ?? '+∞'}`;
    line(
      `${e.id} | ${typeof v === 'number' ? v.toFixed(4) : 'n/a'} | ${typeof ev === 'number' ? ev.toFixed(4) : 'n/a'} | ${range} | ${inRange ? '是' : '否'}`,
    );
  }
  const coldRows = rows.filter((r) => r.mode === 'cold');
  const zmTotal = coldRows.filter((r) => r.zeroMotion).length;
  const zmIdle = coldRows.filter((r) => r.zeroMotion && !r.hasNonNeutral).length;
  const zmRatio = zmTotal > 0 ? zmIdle / coldRows.length : 0;
  line(
    `session.zero_motion(idle 口径) | idle ${zmIdle}/${coldRows.length} (zero_motion ${zmTotal}/${coldRows.length}) | 候选上限 0.70 | ${pct(zmRatio)}`,
  );
}

async function main(): Promise<void> {
  const docs = loadDocs();
  const { styles, modes, dbOk } = await loadDbMaps();
  const rows = [...docs.entries()].map(([id, doc]) => auditSession(id, doc, styles, modes));
  const sb: string[] = [];
  const line: LineFn = (text = '') => sb.push(text);
  line(`# Phase2.5 只读复核输出 · 批次 ${BATCH_ID} · ${new Date().toISOString()}`);
  line(`DB 元数据(风格/模式)可达: ${dbOk ? '是' : '否(风格回退 slug, 模式缺失)'}`);
  line(`场次 ${rows.length} / 总轮数 ${rows.reduce((s, r) => s + r.turns, 0)}`);
  line('');
  sectionLabels(rows, line);
  sectionZeroMotion(rows, line);
  sectionSafety(rows, line);
  sectionColdThresholds(rows, line);

  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  fs.writeFileSync(OUT_FILE, sb.join('\n') + '\n', 'utf8');
  console.log(`written: ${OUT_FILE} (${sb.length} 行)`);
}

void main();
