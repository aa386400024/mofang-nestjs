// AF-418 · 在场投影同源校准（只读）
//   目的：把 AF-412 的「末轮快照 + Σdelta」单次加法，与内核真实的「逐轮 transitionState（含 clamp）」
//         口径对齐，量化两者差值，避免把末轮投影直接当内核结论。
//   红线：不打印任何逐字稿原文；不修改生产分类器、delta、prompt；不写仓库数据文件。
//   用法：node scripts/ops/quality/af418-presence-replay-calibration.mjs --dir data/debug-sessions

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { PRESENCE_DELTAS } from './af408-presence-calibration.mjs';
import { classifyNarrow } from './af409-presence-narrowing.mjs';

/** 与 batch-metrics.compute.ts 同口径的八维快照键。 */
export const TRACKED_KEYS = Object.freeze([
  'trust',
  'safety',
  'bond',
  'valence',
  'arousal',
  'resistanceVerbal',
  'resistanceDepth',
  'resistanceStyle',
]);

/** 11 维 delta 键 → 8 维快照键（verbal/depth/style 即阻抗三分量）。 */
const DELTA_TO_SNAPSHOT = Object.freeze({
  trust: 'trust',
  safety: 'safety',
  bond: 'bond',
  valence: 'valence',
  arousal: 'arousal',
  verbal: 'resistanceVerbal',
  depth: 'resistanceDepth',
  style: 'resistanceStyle',
});

/**
 * 取八维数值快照（缺失按 0）。
 *
 * @param {Readonly<Record<string, unknown>> | null | undefined} snapshot 原始快照
 * @returns {Record<string, number>} 八维快照
 */
export function pickTracked(snapshot) {
  const out = {};
  for (const key of TRACKED_KEYS) out[key] = Number(snapshot?.[key] ?? 0);
  return out;
}

/**
 * 相邻快照差（真实内核每轮位移）。
 *
 * @param {Readonly<Record<string, unknown>>} prev 前一轮快照
 * @param {Readonly<Record<string, unknown>>} next 本轮快照
 * @returns {Record<string, number>} 八维差
 */
export function diffTracked(prev, next) {
  const a = pickTracked(prev);
  const b = pickTracked(next);
  const out = {};
  for (const key of TRACKED_KEYS) out[key] = b[key] - a[key];
  return out;
}

/**
 * 叠加一个增量并逐维夹取到 [0,1]。
 *
 * @param {Record<string, number>} state 当前八维状态
 * @param {Readonly<Record<string, number>>} delta 八维增量
 * @returns {Record<string, number>} 新状态
 */
export function addClamped(state, delta) {
  const out = { ...state };
  for (const key of TRACKED_KEYS) out[key] = clampDim(key, Number(out[key] ?? 0) + Number(delta?.[key] ?? 0));
  return out;
}

/**
 * 把 11 维 presence delta 映射到八维并按倍数缩放（不夹取，交给 addClamped）。
 *
 * AF-421: 幅度扫描要把同一份种子幅度按倍数放大/缩小，映射与缩放只在这里做一次，
 * 避免脚本侧再抄第三份 delta 表。
 *
 * @param {'holding_present'|'cold_absent'} label 在场标签
 * @param {number} multiplier 倍数（1 = 内核种子幅度）
 * @returns {Record<string, number>} 八维增量
 */
export function scaledPresenceDelta(label, multiplier = 1) {
  const delta = PRESENCE_DELTAS[label];
  const mapped = {};
  for (const key of TRACKED_KEYS) mapped[key] = 0;
  if (!delta) return mapped;
  for (const [deltaKey, snapshotKey] of Object.entries(DELTA_TO_SNAPSHOT)) {
    mapped[snapshotKey] = Number(delta[deltaKey] ?? 0) * Number(multiplier);
  }
  return mapped;
}

/**
 * 把 11 维 presence delta 映射到八维并逐维夹取。
 *
 * @param {Record<string, number>} state 当前八维状态
 * @param {'holding_present'|'cold_absent'} label 在场标签
 * @param {number} [multiplier] 幅度倍数（缺省 1 = 内核种子幅度）
 * @returns {Record<string, number>} 新状态
 */
export function applyPresenceDelta(state, label, multiplier = 1) {
  return addClamped(state, scaledPresenceDelta(label, multiplier));
}

/**
 * AF-412 口径：末轮快照 + 全部 presence delta 一次相加。
 *
 * @param {readonly string[]} labels A′ 标签序列
 * @param {Readonly<Record<string, unknown>>} last 末轮快照
 * @returns {Record<string, number>} 投影末态
 */
export function flatProjection(labels, last) {
  const total = {};
  for (const key of TRACKED_KEYS) total[key] = 0;
  for (const label of labels) {
    const delta = PRESENCE_DELTAS[label];
    if (!delta) continue;
    for (const [deltaKey, snapshotKey] of Object.entries(DELTA_TO_SNAPSHOT)) {
      total[snapshotKey] += Number(delta[deltaKey] ?? 0);
    }
  }
  return addClamped(pickTracked(last), total);
}

/**
 * 逐轮重放：真实相邻快照差 + 当轮 presence delta，每步夹取。
 *
 * @param {readonly {turnIndex:number,bdiSnapshot?:object}[]} traces 按轮次排序的 trace
 * @param {ReadonlyMap<number, string>} labelsByTurn 轮次 → A′ 标签
 * @returns {{replayFinal:Record<string,number>,flatFinal:Record<string,number>,labels:string[],baseEqual:boolean}} 重放结果
 */
export function replaySession(traces, labelsByTurn) {
  const labels = [];
  const first = traces[0]?.bdiSnapshot ?? {};
  let replay = pickTracked(first);
  for (let index = 0; index < traces.length; index += 1) {
    if (index > 0) replay = addClamped(replay, diffTracked(traces[index - 1]?.bdiSnapshot, traces[index]?.bdiSnapshot));
    const label = labelsByTurn.get(Number(traces[index]?.turnIndex));
    if (label) {
      labels.push(label);
      replay = applyPresenceDelta(replay, label);
    }
  }
  const last = traces.at(-1)?.bdiSnapshot ?? {};
  // 不含任何 presence 标签时，重放必须逐字还原末轮快照（验证快照差重放本身无漂移）。
  const base = pickTracked(first);
  let baseReplay = { ...base };
  for (let index = 1; index < traces.length; index += 1) {
    baseReplay = addClamped(baseReplay, diffTracked(traces[index - 1]?.bdiSnapshot, traces[index]?.bdiSnapshot));
  }
  const baseEqual = TRACKED_KEYS.every((key) => Math.abs(baseReplay[key] - pickTracked(last)[key]) < 1e-6);
  return { replayFinal: replay, flatFinal: flatProjection(labels, last), labels, baseEqual };
}

/**
 * 单场对比摘要（只出数值）。
 *
 * @param {{id:string,traces:object[],labelsByTurn:Map<number,string>}} session 单场输入
 * @returns {object} 摘要
 */
export function summarizeReplaySession(session) {
  const result = replaySession(session.traces, session.labelsByTurn);
  const first = pickTracked(session.traces[0]?.bdiSnapshot);
  const last = pickTracked(session.traces.at(-1)?.bdiSnapshot);
  const flatZero = isZeroMotion(first, result.flatFinal);
  const replayZero = isZeroMotion(first, result.replayFinal);
  return {
    id: session.id,
    neutralTurns: result.labels.length,
    holding: result.labels.filter((label) => label === 'holding_present').length,
    cold: result.labels.filter((label) => label === 'cold_absent').length,
    baseEqual: result.baseEqual,
    lastSafety: last.safety,
    lastBond: last.bond,
    flatSafety: result.flatFinal.safety,
    replaySafety: result.replayFinal.safety,
    flatBond: result.flatFinal.bond,
    replayBond: result.replayFinal.bond,
    safetyDiff: round6(result.flatFinal.safety - result.replayFinal.safety),
    bondDiff: round6(result.flatFinal.bond - result.replayFinal.bond),
    flatZero,
    replayZero,
    saturated:
      Math.abs(result.flatFinal.safety - result.replayFinal.safety) > 1e-9 ||
      Math.abs(result.flatFinal.bond - result.replayFinal.bond) > 1e-9,
  };
}

/**
 * 批次汇总。
 *
 * @param {readonly ReturnType<typeof summarizeReplaySession>[]} rows 单场摘要
 * @returns {object} 批次摘要
 */
export function summarizeReplay(rows) {
  const total = (key) => round6(rows.reduce((sum, row) => sum + Number(row[key] ?? 0), 0));
  return {
    sessions: rows.length,
    neutralTurns: rows.reduce((sum, row) => sum + row.neutralTurns, 0),
    holding: rows.reduce((sum, row) => sum + row.holding, 0),
    cold: rows.reduce((sum, row) => sum + row.cold, 0),
    baseDriftSessions: rows.filter((row) => !row.baseEqual).length,
    flatZero: rows.filter((row) => row.flatZero).length,
    replayZero: rows.filter((row) => row.replayZero).length,
    saturatedSessions: rows.filter((row) => row.saturated).length,
    maxSafetyDiff: round6(Math.max(0, ...rows.map((row) => Math.abs(row.safetyDiff)))),
    maxBondDiff: round6(Math.max(0, ...rows.map((row) => Math.abs(row.bondDiff)))),
    totalFlatSafetyGain: round6(rows.reduce((sum, row) => sum + (row.flatSafety - row.lastSafety), 0)),
    totalReplaySafetyGain: round6(rows.reduce((sum, row) => sum + (row.replaySafety - row.lastSafety), 0)),
    totalFlatBondGain: round6(rows.reduce((sum, row) => sum + (row.flatBond - row.lastBond), 0)),
    totalReplayBondGain: round6(rows.reduce((sum, row) => sum + (row.replayBond - row.lastBond), 0)),
    totalFlatSafety: total('flatSafety'),
    totalReplaySafety: total('replaySafety'),
    totalFlatBond: total('flatBond'),
    totalReplayBond: total('replayBond'),
  };
}

/**
 * 读取 trace 目录并构造逐场输入（只保留数值与标签）。
 *
 * @param {string} dir trace 目录
 * @returns {object[]} 单场摘要
 */
export function loadReplayRows(dir) {
  const names = fs
    .readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .sort();
  const rows = [];
  for (const name of names) {
    const raw = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
    const traces = (Array.isArray(raw.traces) ? raw.traces : [])
      .filter((trace) => trace?.bdiSnapshot)
      .toSorted((a, b) => Number(a.turnIndex) - Number(b.turnIndex));
    if (traces.length === 0) continue;
    const neutralTurns = new Set(
      traces
        .filter((trace) => {
          const tags = Array.isArray(trace?.eventTags) ? trace.eventTags : [];
          return tags.length === 0 || (tags.length === 1 && tags[0] === 'neutral');
        })
        .map((trace) => Number(trace?.turnIndex)),
    );
    const counselor = (raw.messages ?? []).filter((message) => message?.role === 'counselor' && String(message.text ?? '').trim());
    const labelsByTurn = new Map();
    for (const message of counselor) {
      const turnIndex = Number(message.turnIndex);
      if (!neutralTurns.has(turnIndex)) continue;
      labelsByTurn.set(turnIndex, classifyNarrow(message.text));
    }
    rows.push(summarizeReplaySession({ id: raw.id ?? name.replace(/\.json$/, ''), traces, labelsByTurn }));
  }
  return rows;
}

/**
 * 主流程。
 */
function main() {
  const dirIndex = process.argv.indexOf('--dir');
  const dir = dirIndex === -1 ? 'data/debug-sessions' : (process.argv[dirIndex + 1] ?? 'data/debug-sessions');
  if (!fs.existsSync(dir)) {
    console.error(`目录不存在: ${dir}`);
    process.exitCode = 1;
    return;
  }
  const rows = loadReplayRows(dir);
  const summary = summarizeReplay(rows);
  console.log('=== AF-418 在场投影同源校准（末轮单次加法 vs 逐轮重放，无原文） ===');
  console.log(`场次 ${summary.sessions} | neutral 轮 ${summary.neutralTurns} | A′ holding ${summary.holding} | cold ${summary.cold}`);
  console.log(`重放基线漂移场次 ${summary.baseDriftSessions}（应为 0）`);
  console.log(`zero_motion: 末轮加法 ${summary.flatZero} 场 → 逐轮重放 ${summary.replayZero} 场；饱和场次 ${summary.saturatedSessions}`);
  console.log(
    `总增量 safety: 末轮加法 +${summary.totalFlatSafetyGain.toFixed(4)} vs 重放 +${summary.totalReplaySafetyGain.toFixed(4)}；总增量 bond: +${summary.totalFlatBondGain.toFixed(4)} vs +${summary.totalReplayBondGain.toFixed(4)}`,
  );
  console.log(
    `末态和 safety: ${summary.totalFlatSafety.toFixed(4)} vs ${summary.totalReplaySafety.toFixed(4)}；bond: ${summary.totalFlatBond.toFixed(4)} vs ${summary.totalReplayBond.toFixed(4)}`,
  );
  console.log(`最大单场差：safety ${summary.maxSafetyDiff.toFixed(6)} | bond ${summary.maxBondDiff.toFixed(6)}`);
  if (summary.saturatedSessions > 0) {
    console.log('\n逐场差值（仅数值，|diff|>0 的场次）：');
    for (const row of rows) {
      if (!row.saturated) continue;
      console.log(
        `  ${row.id} holding=${row.holding} cold=${row.cold} safety ${row.flatSafety.toFixed(4)}→${row.replaySafety.toFixed(4)} diff=${row.safetyDiff.toFixed(6)} | bond diff=${row.bondDiff.toFixed(6)}`,
      );
    }
  }
}

/**
 * 首末八维是否逐字相等。
 *
 * @param {Record<string, number>} first 首轮
 * @param {Record<string, number>} last 末轮
 * @returns {boolean} 是否零变化
 */
function isZeroMotion(first, last) {
  return TRACKED_KEYS.every((key) => Math.abs(Number(first[key] ?? 0) - Number(last[key] ?? 0)) < 1e-9);
}

/**
 * 按维度夹取：valence ∈ [-1,1]，其余 ∈ [0,1]。
 *
 * @param {string} key 维度
 * @param {number} value 原值
 * @returns {number} 夹取结果
 */
function clampDim(key, value) {
  const numeric = Number(value);
  if (key === 'valence') return Math.max(-1, Math.min(1, numeric));
  return Math.max(0, Math.min(1, numeric));
}

/**
 * 保留 6 位小数。
 *
 * @param {number} value 原值
 * @returns {number} 结果
 */
function round6(value) {
  return Number(Number(value).toFixed(6));
}

// 只在直接执行时跑主流程（vitest 导入本文件不应触发 IO）。
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  main();
}
