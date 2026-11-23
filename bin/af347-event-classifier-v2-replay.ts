// AF-349 · 规则分类器 v2 真实语料回放 (只读, 不输出原文).
//
// 用法:
//   pnpm exec tsx bin/af347-event-classifier-v2-replay.ts \
//     --dir data/debug-sessions \
//     --out data/phase25-exit/af349-event-classifier-replay/report.json
//
// 边界:
//   · 只读 debug 会话 JSON 的 `messages` (role / text / turnIndex);
//   · 报告只输出会话 id、轮次号、事件 kind / strength、统计计数;
//   · **不输出咨询师或来访原文** —— 心理对话原文禁止进普通日志与报告.
//   · 本脚本是「旧 vs v2」同语料对照, 不是临床有效性证明; 差异只说明语义修正命中.

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { RuleBasedClassifier } from '../src/engine-core/cognition/rule-based-classifier.js';
import type { CounselorEventKind, SessionEvent } from '../src/engine-core/domain/events/session-event.js';

interface DebugMessage {
  readonly role?: string;
  readonly text?: string;
  readonly turnIndex?: number;
}

interface DebugSessionDoc {
  readonly id?: string;
  readonly messages?: readonly DebugMessage[];
}

interface EventCount {
  readonly kind: CounselorEventKind;
  readonly count: number;
}

interface StrengthCount {
  readonly strength: number;
  readonly count: number;
}

interface TurnDiff {
  readonly sessionId: string;
  readonly turnIndex: number;
  readonly legacy: readonly string[];
  readonly v2: readonly string[];
  readonly removed: readonly string[];
  readonly added: readonly string[];
  readonly legacyStrength: readonly number[];
  readonly v2Strength: readonly number[];
}

interface ReplayStats {
  readonly sessions: number;
  readonly turns: number;
  readonly neutralTurns: number;
  readonly neutralRate: number;
  readonly changedTurns: number;
  readonly changedRate: number;
  readonly strengthChangedTurns: number;
  readonly legacyEventCounts: readonly EventCount[];
  readonly v2EventCounts: readonly EventCount[];
  readonly legacyStrengthCounts: readonly StrengthCount[];
  readonly v2StrengthCounts: readonly StrengthCount[];
  readonly removedCounts: Readonly<Record<string, number>>;
  readonly addedCounts: Readonly<Record<string, number>>;
  readonly diffSamples: readonly TurnDiff[];
}

interface ClassifierPair {
  readonly legacy: RuleBasedClassifier;
  readonly v2: RuleBasedClassifier;
}

interface ReplayAccumulator {
  turns: number;
  neutralTurns: number;
  changedTurns: number;
  strengthChangedTurns: number;
  readonly legacyCounts: Map<CounselorEventKind, number>;
  readonly v2Counts: Map<CounselorEventKind, number>;
  readonly legacyStrengthCounts: Map<number, number>;
  readonly v2StrengthCounts: Map<number, number>;
  readonly removedCounts: Map<string, number>;
  readonly addedCounts: Map<string, number>;
  readonly diffs: TurnDiff[];
}

const DEFAULT_CLASSIFIERS: ClassifierPair = {
  legacy: new RuleBasedClassifier(),
  v2: new RuleBasedClassifier({ semantics: 'v2' }),
};

/** 对一组 debug 会话做旧 vs v2 回放 (纯函数, 便于单测). */
export function replaySessions(docs: readonly DebugSessionDoc[], classifiers?: ClassifierPair, sampleLimit = 30): ReplayStats {
  const active = classifiers ?? DEFAULT_CLASSIFIERS;
  const acc = createAccumulator();
  for (const doc of docs) {
    for (const message of doc.messages ?? []) {
      if (message.role !== 'counselor' || !message.text?.trim()) continue;
      acc.turns += 1;
      analyzeTurn(doc.id ?? 'unknown', message.text, message.turnIndex ?? acc.turns, active, sampleLimit, acc);
    }
  }
  return finalizeStats(docs.length, acc);
}

function createAccumulator(): ReplayAccumulator {
  return {
    turns: 0,
    neutralTurns: 0,
    changedTurns: 0,
    strengthChangedTurns: 0,
    legacyCounts: new Map(),
    v2Counts: new Map(),
    legacyStrengthCounts: new Map(),
    v2StrengthCounts: new Map(),
    removedCounts: new Map(),
    addedCounts: new Map(),
    diffs: [],
  };
}

function analyzeTurn(
  sessionId: string,
  text: string,
  turnIndex: number,
  classifiers: ClassifierPair,
  sampleLimit: number,
  acc: ReplayAccumulator,
): void {
  const legacy = classifiers.legacy.classify(text);
  const v2 = classifiers.v2.classify(text);
  countEvents(legacy, acc.legacyCounts, acc.legacyStrengthCounts);
  countEvents(v2, acc.v2Counts, acc.v2StrengthCounts);

  const legacyKinds = legacy.map((event) => event.kind).sort();
  const v2Kinds = v2.map((event) => event.kind).sort();
  if (legacyKinds.join('|') === 'neutral' && v2Kinds.join('|') === 'neutral') acc.neutralTurns += 1;

  if (legacyKinds.join('|') !== v2Kinds.join('|')) {
    acc.changedTurns += 1;
    recordChanged(sessionId, turnIndex, legacy, v2, legacyKinds, v2Kinds, sampleLimit, acc);
    return;
  }
  if (JSON.stringify(legacy.map((event) => event.strength)) !== JSON.stringify(v2.map((event) => event.strength))) {
    acc.strengthChangedTurns += 1;
  }
}

function countEvents(events: readonly SessionEvent[], counts: Map<CounselorEventKind, number>, strengthCounts: Map<number, number>): void {
  for (const event of events) {
    counts.set(event.kind, (counts.get(event.kind) ?? 0) + 1);
    strengthCounts.set(event.strength, (strengthCounts.get(event.strength) ?? 0) + 1);
  }
}

function recordChanged(
  sessionId: string,
  turnIndex: number,
  legacy: readonly SessionEvent[],
  v2: readonly SessionEvent[],
  legacyKinds: readonly CounselorEventKind[],
  v2Kinds: readonly CounselorEventKind[],
  sampleLimit: number,
  acc: ReplayAccumulator,
): void {
  for (const kind of legacyKinds) {
    if (!v2Kinds.includes(kind)) acc.removedCounts.set(kind, (acc.removedCounts.get(kind) ?? 0) + 1);
  }
  for (const kind of v2Kinds) {
    if (!legacyKinds.includes(kind)) acc.addedCounts.set(kind, (acc.addedCounts.get(kind) ?? 0) + 1);
  }
  if (acc.diffs.length >= sampleLimit) return;
  acc.diffs.push({
    sessionId,
    turnIndex,
    legacy: legacy.map((event) => `${event.kind}:${event.strength}`),
    v2: v2.map((event) => `${event.kind}:${event.strength}`),
    removed: legacyKinds.filter((kind) => !v2Kinds.includes(kind)),
    added: v2Kinds.filter((kind) => !legacyKinds.includes(kind)),
    legacyStrength: legacy.map((event) => event.strength),
    v2Strength: v2.map((event) => event.strength),
  });
}

function finalizeStats(sessions: number, acc: ReplayAccumulator): ReplayStats {
  return {
    sessions,
    turns: acc.turns,
    neutralTurns: acc.neutralTurns,
    neutralRate: acc.turns > 0 ? acc.neutralTurns / acc.turns : 0,
    changedTurns: acc.changedTurns,
    changedRate: acc.turns > 0 ? acc.changedTurns / acc.turns : 0,
    strengthChangedTurns: acc.strengthChangedTurns,
    legacyEventCounts: sortCounts(acc.legacyCounts),
    v2EventCounts: sortCounts(acc.v2Counts),
    legacyStrengthCounts: sortStrengthCounts(acc.legacyStrengthCounts),
    v2StrengthCounts: sortStrengthCounts(acc.v2StrengthCounts),
    removedCounts: Object.fromEntries(acc.removedCounts),
    addedCounts: Object.fromEntries(acc.addedCounts),
    diffSamples: acc.diffs,
  };
}

function sortCounts(map: Map<CounselorEventKind, number>): readonly EventCount[] {
  return [...map.entries()].map(([kind, count]) => ({ kind, count })).sort((a, b) => b.count - a.count || a.kind.localeCompare(b.kind));
}

function sortStrengthCounts(map: Map<number, number>): readonly StrengthCount[] {
  return [...map.entries()].map(([strength, count]) => ({ strength, count })).sort((a, b) => a.strength - b.strength);
}

function parseArgs(argv: readonly string[]): { dir: string; out: string } {
  let dir = 'data/debug-sessions';
  let out = 'data/phase25-exit/af349-event-classifier-replay/report.json';
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--dir') dir = argv[++i] ?? dir;
    else if (argv[i] === '--out') out = argv[++i] ?? out;
  }
  return { dir, out };
}

function main(): void {
  const { dir, out } = parseArgs(process.argv.slice(2));
  const files = readdirSync(dir).filter((name) => name.endsWith('.json'));
  const docs = files.map((name) => JSON.parse(readFileSync(join(dir, name), 'utf8')) as DebugSessionDoc);
  const stats = replaySessions(docs);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify({ generatedAt: new Date().toISOString(), dir, files, stats }, null, 2), 'utf8');
  const neutral = `${(stats.neutralRate * 100).toFixed(2)}%`;
  process.stdout.write(
    `AF-349 replay: sessions=${stats.sessions} turns=${stats.turns} neutral(legacy)=${stats.neutralTurns}/${stats.turns}(${neutral}) changed=${stats.changedTurns} strengthChanged=${stats.strengthChangedTurns} -> ${out}\n`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
