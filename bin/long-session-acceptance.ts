#!/usr/bin/env node
/* eslint-disable unicorn/no-exports-in-scripts -- AF-177: pack 分层取样纯函数需被单测直接导入；主流程已用 isDirectRun 守卫 */
// V2026-11-19 Phase2.5 AF-111 (long 50 轮候选口径 + 双人盲标 pack/ingest CLI):
//   pack   从批次里按角色×咨询师模式均衡取样, 生成匿名 packet / 评分表 / 解盲映射;
//   ingest 回收两位评分人的 CSV, 算逐维一致性 (线性加权 kappa / ±1 一致率) 与仲裁清单;
//   summarize 把单场 trace 的三段观测汇总打印出来 (内部用, 不产生 PASS/FAIL).
//
// 边界:
//   · 不新跑 LLM 批次; 只读既有 data/debug-sessions;
//   · 不接硬门; 输出一律带 candidate 免责声明;
//   · 不写仓库状态; 输出只落 data/phase25-exit 或 --out 指定目录.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  LONG_SESSION_ACCEPTANCE_DISCLAIMER,
  LONG_SESSION_ACCEPTANCE_VERSION,
  LONG_SESSION_DIMENSIONS,
  LONG_SESSION_REVIEW_ANCHORS,
  buildBlindPacket,
  evaluateLongSessionCandidate,
  findAdjudicationCases,
  summarizeAgreement,
  type LongSessionBdiSnapshot,
  type LongSessionDimension,
  type LongSessionTracePoint,
  type RatingPair,
} from '../src/auto-practice/metrics/long-session-acceptance.js';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

function arg(name: string, fallback: string | null = null): string | null {
  const index = process.argv.indexOf(name);
  if (index === -1 || index + 1 >= process.argv.length) return fallback;
  return process.argv[index + 1];
}

function has(name: string): boolean {
  return process.argv.includes(name);
}

function fail(message: string): never {
  console.error(`[FAIL] ${message}`);
  process.exit(1);
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state += 1_832_959_989;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function shuffle<T>(items: readonly T[], random: () => number): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

interface BatchIndex {
  batchId: string;
  createdAt?: string;
  sessions: {
    debugSessionId: string;
    characterSlug: string;
    counselorModeId: string;
    status: string;
    turnCount: number;
  }[];
}

interface Transcript {
  id?: string;
  title?: string;
  characterSlug?: string;
  characterLabel?: string;
  counselorModeId?: string;
  messages?: { role?: string; text?: string; turnIndex?: number }[];
  traces?: { turnIndex: number; bdiSnapshot?: Partial<LongSessionBdiSnapshot> }[];
}

function loadBatch(batchId: string): BatchIndex {
  const path = join(REPO_ROOT, 'data', 'debug-sessions', '_batches', `${batchId}.json`);
  if (!readFileSyncSafe(path)) fail(`批次索引不存在：${path}`);
  return readJson<BatchIndex>(path);
}

function readFileSyncSafe(path: string): boolean {
  try {
    readFileSync(path);
    return true;
  } catch {
    return false;
  }
}

function loadTranscript(debugSessionId: string): Transcript {
  const path = join(REPO_ROOT, 'data', 'debug-sessions', `${debugSessionId}.json`);
  if (!readFileSyncSafe(path)) fail(`逐字稿不存在：${path}`);
  return readJson<Transcript>(path);
}

/** 解析 --modes；AF-177 起支持 cold/expert/intermediate 三档。 */
export function parseModes(raw: string | null): string[] {
  const value = (raw ?? 'expert,cold').trim();
  if (value === '') throw new Error('--modes 不能为空');
  const modes = [
    ...new Set(
      value
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ];
  const allowed = new Set(['expert', 'cold', 'intermediate']);
  const unknown = modes.filter((mode) => !allowed.has(mode));
  if (unknown.length > 0) throw new Error(`--modes 含未支持模式：${unknown.join(',')}`);
  if (modes.length === 0) throw new Error('--modes 至少一档');
  return modes;
}

/**
 * 均衡取样：按 characterSlug×counselorModeId 分层，cell 排序后逐轮轮转。
 *
 * AF-177: 48 packet 时 24 个 character-mode cell 各取 2 场；不再只按模式分两档，
 * 避免某角色被同档其他角色挤掉。
 */
export function selectBalancedSessions(
  batch: BatchIndex,
  limit: number,
  seed: number,
  modes: readonly string[] = ['expert', 'cold'],
): BatchIndex['sessions'] {
  const random = mulberry32(seed);
  const allowedModes = new Set(modes);
  const byCell = new Map<string, BatchIndex['sessions']>();
  for (const session of batch.sessions) {
    if (session.status !== 'completed' && session.status !== 'crisis_ended') continue;
    if (!allowedModes.has(session.counselorModeId)) continue;
    const cell = `${session.characterSlug}::${session.counselorModeId}`;
    const list = byCell.get(cell) ?? [];
    list.push(session);
    byCell.set(cell, list);
  }
  const queues = [...byCell.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([cell, sessions]) => ({ cell, sessions: shuffle(sessions, random) }));
  const picked: BatchIndex['sessions'] = [];
  while (picked.length < limit && queues.some((queue) => queue.sessions.length > 0)) {
    for (const queue of queues) {
      if (picked.length >= limit) break;
      const session = queue.sessions.shift();
      if (session) picked.push(session);
    }
  }
  return picked;
}

function packetMarkdown(packetId: string, turns: readonly { turnIndex: number; role: string; text: string }[]): string {
  const lines = [`# ${packetId}`, '', `> ${LONG_SESSION_ACCEPTANCE_DISCLAIMER}`, '', '## 会谈记录', ''];
  let currentTurn = -1;
  for (const turn of turns) {
    if (turn.turnIndex !== currentTurn) {
      currentTurn = turn.turnIndex;
      lines.push(`### 第 ${currentTurn} 轮`, '');
    }
    lines.push(`**${turn.role === 'visitor' ? '来访者' : '咨询师'}**：${turn.text}`, '');
  }
  return `${lines.join('\n')}\n`;
}

function scoreSheetCsv(packetIds: readonly string[], raterId: string): string {
  const header = ['packet_id', 'rater_id', ...LONG_SESSION_DIMENSIONS, 'overall', 'adjudicate', 'notes'];
  const rows = [header.join(',')];
  for (const packetId of packetIds) {
    rows.push([packetId, raterId, ...LONG_SESSION_DIMENSIONS.map(() => ''), '', '', ''].join(','));
  }
  return `${rows.join('\n')}\n`;
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        cell += char;
      }
      continue;
    }
    switch (char) {
      case '"': {
        quoted = true;

        break;
      }
      case ',': {
        row.push(cell);
        cell = '';

        break;
      }
      case '\n':
      case '\r': {
        if (char === '\r' && text[i + 1] === '\n') i += 1;
        row.push(cell);
        cell = '';
        if (row.some((value) => value.trim() !== '')) rows.push(row);
        row = [];

        break;
      }
      default: {
        cell += char;
      }
    }
  }
  if (cell !== '' || row.length > 0) {
    row.push(cell);
    if (row.some((value) => value.trim() !== '')) rows.push(row);
  }
  return rows;
}

function readRatingsCsv(path: string): Record<string, Record<string, string>> {
  if (!readFileSyncSafe(path)) fail(`评分表不存在：${path}`);
  const rows = parseCsv(readFileSync(path, 'utf8'));
  if (rows.length < 2) fail(`评分表为空：${path}`);
  const header = rows[0].map((value) => value.trim());
  const out: Record<string, Record<string, string>> = {};
  for (const row of rows.slice(1)) {
    const record: Record<string, string> = {};
    for (let i = 0; i < header.length; i += 1) record[header[i]] = (row[i] ?? '').trim();
    const packetId = record['packet_id'];
    if (!packetId) fail(`评分表缺 packet_id：${path}`);
    out[packetId] = record;
  }
  return out;
}

function parseScore(value: string, packetId: string, dimension: string): number | null {
  if (value === '') return null;
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1 || number > 5) {
    fail(`评分必须是 1–5 的整数：${packetId} / ${dimension} = ${value}`);
  }
  return number;
}

function commandPack(): void {
  const batchId = arg('--batch');
  if (!batchId)
    fail(
      '用法：long-session-acceptance pack --batch <batchId> [--limit 8] [--modes expert,cold] [--seed 20261119] [--out <dir>] [--force]',
    );
  const limit = Number(arg('--limit', '8'));
  const seed = Number(arg('--seed', '20261119'));
  let modes: string[];
  try {
    modes = parseModes(arg('--modes'));
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
  if (!Number.isInteger(limit) || limit < 2 || limit > 48) fail('--limit 必须是 2–48 的整数');
  const outDir = arg('--out', join(REPO_ROOT, 'data', 'phase25-exit', 'long-session-blind', String(batchId)))!;
  if (readFileSyncSafe(join(outDir, 'README.md')) && !has('--force')) {
    fail(`输出目录已存在：${outDir}；确认覆盖请加 --force`);
  }
  mkdirSync(outDir, { recursive: true });
  mkdirSync(join(outDir, 'packets'), { recursive: true });

  const batch = loadBatch(batchId);
  const selected = selectBalancedSessions(batch, limit, seed, modes);
  if (selected.length < 2) fail(`可取样 completed/crisis_ended 会话不足：${selected.length}`);

  const packets: { packetId: string; debugSessionId: string; characterSlug: string; counselorModeId: string; turnCount: number }[] = [];
  for (const [index, session] of selected.entries()) {
    const packetId = `packet-${String(index + 1).padStart(2, '0')}`;
    const transcript = loadTranscript(session.debugSessionId);
    const packet = buildBlindPacket(transcript, packetId);
    if (packet.turns.length === 0) fail(`packet 无有效对话：${session.debugSessionId}`);
    writeFileSync(join(outDir, 'packets', `${packetId}.md`), packetMarkdown(packetId, packet.turns), 'utf8');
    packets.push({
      packetId,
      debugSessionId: session.debugSessionId,
      characterSlug: session.characterSlug,
      counselorModeId: session.counselorModeId,
      turnCount: session.turnCount,
    });
  }

  writeFileSync(
    join(outDir, 'ratings-rater-1.csv'),
    scoreSheetCsv(
      packets.map((packet) => packet.packetId),
      'R1',
    ),
    'utf8',
  );
  writeFileSync(
    join(outDir, 'ratings-rater-2.csv'),
    scoreSheetCsv(
      packets.map((packet) => packet.packetId),
      'R2',
    ),
    'utf8',
  );
  writeJson(join(outDir, 'blind-map.json'), {
    warning: '解盲映射：只给 PI / 仲裁人；不得发给两位评分人，评分完成并回传前不要打开。',
    batchId,
    version: LONG_SESSION_ACCEPTANCE_VERSION,
    generatedAt: new Date().toISOString(),
    packets,
  });
  writeFileSync(join(outDir, 'README.md'), buildPackReadme(batchId, packets.length), 'utf8');
  console.log(`[OK] pack 完成：${packets.length} 个 packet → ${outDir}`);
  console.log(`[OK] 评分表：ratings-rater-1.csv / ratings-rater-2.csv；解盲映射：blind-map.json（不要发给评分人）`);
  console.log(`[提示] ${LONG_SESSION_ACCEPTANCE_DISCLAIMER}`);
}

function buildPackReadme(batchId: string, packetCount: number): string {
  const anchors = LONG_SESSION_REVIEW_ANCHORS.map(
    (anchor, index) =>
      `${index + 1}. **${anchor.id}**（${anchor.phase} · ${anchor.dimension}）\n   - 观察：${anchor.prompt}\n   - 正例：${anchor.positive}\n   - 反例：${anchor.negative}`,
  ).join('\n\n');
  return [
    '# 长会谈双人盲标 pack（候选口径）',
    '',
    `> ${LONG_SESSION_ACCEPTANCE_DISCLAIMER}`,
    '',
    `- 批次：${batchId}`,
    `- packet 数：${packetCount}`,
    `- 口径版本：${LONG_SESSION_ACCEPTANCE_VERSION}`,
    '',
    '## 评分流程',
    '',
    '1. 评分人 R1 / R2 **各自独立**阅读 `packets/`，不交流、不看 `blind-map.json`。',
    '2. 每人只填自己的 CSV：`ratings-rater-1.csv` / `ratings-rater-2.csv`。',
    '3. 六维各给 1–5 分（1=明显差，3=可接受，5=明显好）；`overall` 为整体印象。',
    '4. 任一 packet 认为需要第三方仲裁，在 `adjudicate` 填 `yes`，`notes` 写一句理由（不要写人名/角色名）。',
    '5. 两份 CSV 回传后由 PI 执行 `ingest`，先看逐维一致性，再开仲裁会。',
    '',
    '## 一致性与仲裁（试点判读参考，不是硬门）',
    '',
    '- 逐维线性加权 kappa：`<0.6` 说明评分口径未对齐，先校准再扩样本；`0.6–0.8` 对分歧 packet 做仲裁；`>=0.8` 才可讨论是否值得升级为硬门。',
    '- 任一维分差 `>1` 或评分人标记 `adjudicate=yes` 的 packet，进入仲裁清单。',
    '- 仲裁只解决"这个 packet 该几分"，不反过来改锚点；锚点要改须另立任务。',
    '',
    '## 9 条观察锚点',
    '',
    anchors,
    '',
  ].join('\n');
}

function commandIngest(): void {
  const rater1Path = arg('--rater1');
  const rater2Path = arg('--rater2');
  if (!rater1Path || !rater2Path) fail('用法：long-session-acceptance ingest --rater1 <csv> --rater2 <csv> [--out <dir>]');
  const outDir = arg('--out', join(dirname(rater1Path), 'ingest'))!;
  mkdirSync(outDir, { recursive: true });

  const rater1 = readRatingsCsv(rater1Path);
  const rater2 = readRatingsCsv(rater2Path);
  const packetIds = [...new Set([...Object.keys(rater1), ...Object.keys(rater2)])].sort();
  if (packetIds.length === 0) fail('两份评分表没有共同 packet');

  const pairs: RatingPair[] = [];
  const flagged: string[] = [];
  for (const packetId of packetIds) {
    const a = rater1[packetId];
    const b = rater2[packetId];
    if (!a || !b) fail(`packet 缺一位评分人：${packetId}`);
    if ((a['adjudicate'] ?? '').toLowerCase() === 'yes' || (b['adjudicate'] ?? '').toLowerCase() === 'yes') flagged.push(packetId);
    for (const dimension of LONG_SESSION_DIMENSIONS) {
      const score1 = parseScore(a[dimension] ?? '', packetId, dimension);
      const score2 = parseScore(b[dimension] ?? '', packetId, dimension);
      if (score1 === null || score2 === null) continue;
      pairs.push({ packetId, dimension, rater1: score1, rater2: score2 });
    }
  }
  if (pairs.length === 0) fail('没有可计算的评分对；请先填 CSV 的六维分数');

  const dimensions = Object.fromEntries(
    LONG_SESSION_DIMENSIONS.map((dimension) => [dimension, summarizeAgreement(pairs.filter((pair) => pair.dimension === dimension))]),
  ) as Record<LongSessionDimension, ReturnType<typeof summarizeAgreement>>;
  const overall = summarizeAgreement(pairs);
  const adjudication = findAdjudicationCases(pairs, { flaggedPacketIds: flagged });

  writeJson(join(outDir, 'agreement.json'), {
    version: LONG_SESSION_ACCEPTANCE_VERSION,
    disclaimer: LONG_SESSION_ACCEPTANCE_DISCLAIMER,
    packetCount: packetIds.length,
    ratingPairCount: pairs.length,
    dimensions,
    overall,
    flaggedPacketIds: flagged,
    adjudication,
  });
  const header = ['packet_id', 'dimensions', 'max_gap', 'reason'];
  const rows = [header.join(',')];
  for (const item of adjudication) {
    rows.push([item.packetId, item.dimensions.join('|'), String(item.maxGap), item.reason].join(','));
  }
  writeFileSync(join(outDir, 'adjudication.csv'), `${rows.join('\n')}\n`, 'utf8');

  console.log(`[OK] ingest 完成：${packetIds.length} packet / ${pairs.length} 评分对 → ${outDir}`);
  for (const dimension of LONG_SESSION_DIMENSIONS) {
    const summary = dimensions[dimension];
    console.log(
      `  ${dimension}: n=${summary.n} exact=${summary.exactAgreement} within1=${summary.withinOneAgreement} kappa=${summary.linearWeightedKappa ?? 'null'}`,
    );
  }
  console.log(`[仲裁] ${adjudication.length} 个 packet 进入清单（分差 >1 或评分人标记）`);
  console.log(`[提示] ${LONG_SESSION_ACCEPTANCE_DISCLAIMER}`);
}

function commandSummarize(): void {
  const transcriptPath = arg('--transcript');
  if (!transcriptPath) fail('用法：long-session-acceptance summarize --transcript <path> [--out <json>]');
  const transcript = readJson<Transcript>(transcriptPath);
  const traces = transcript.traces ?? [];
  const points: LongSessionTracePoint[] = traces
    .filter((trace) => trace.bdiSnapshot && Number.isFinite(trace.turnIndex))
    .map((trace) => {
      const snapshot = trace.bdiSnapshot!;
      return {
        turnIndex: trace.turnIndex,
        bdiSnapshot: {
          trust: Number(snapshot.trust ?? 0),
          safety: Number(snapshot.safety ?? 0),
          bond: Number(snapshot.bond ?? 0),
          resistanceVerbal: Number(snapshot.resistanceVerbal ?? 0),
          resistanceDepth: Number(snapshot.resistanceDepth ?? 0),
          resistanceStyle: Number(snapshot.resistanceStyle ?? 0),
          arousal: Number(snapshot.arousal ?? 0),
        },
      };
    });
  const evaluation = evaluateLongSessionCandidate(points);
  const out = arg('--out');
  if (out) writeJson(out, evaluation);
  console.log(JSON.stringify(evaluation, null, 2));
}

const isDirectRun = process.argv[1] !== undefined && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isDirectRun) {
  const sub = process.argv[2];
  switch (sub) {
    case 'pack': {
      commandPack();
      break;
    }
    case 'ingest': {
      commandIngest();
      break;
    }
    case 'summarize': {
      commandSummarize();
      break;
    }
    default: {
      console.error('用法：long-session-acceptance <pack|ingest|summarize> [参数]');
      process.exit(2);
    }
  }
}
