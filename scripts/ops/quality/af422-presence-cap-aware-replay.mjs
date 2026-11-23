// AF-422 · cap 感知的在场增益重放（只读）
//   目的：AF-421 只算夹取，cap 只用近似判据统计。真实内核是 capTurnDelta 砍单轮 delta ——
//         被砍掉的那部分就是**在场增益被吞掉**。本脚本直接算
//         「cap(real + presence) − cap(real)」作为在场在 cap 下的有效贡献，逐轮累加。
//   红线：不打印任何逐字稿原文；不改内核 delta 表 / cap 配置 / env / 分类器 / prompt；不写数据文件。
//   用法：node scripts/ops/quality/af422-presence-cap-aware-replay.mjs --dir data/debug-sessions

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { PRESENCE_DELTAS } from './af408-presence-calibration.mjs';
import { loadSweepSessions } from './af421-presence-amplitude-sweep.mjs';
import { TRACKED_KEYS, addClamped, diffTracked, pickTracked } from './af418-presence-replay-calibration.mjs';

/** 扫描档位（1 = 内核种子幅度）。 */
export const CAP_SWEEP_MULTIPLIERS = Object.freeze([0, 1, 2, 4, 8]);

/** 11 维 delta 键（cap 的作用空间）。 */
export const DELTA_DIMS = Object.freeze([
  'trust',
  'safety',
  'bond',
  'valence',
  'arousal',
  'verbal',
  'depth',
  'style',
  'positive',
  'negative',
  'dependency',
]);

/**
 * 单轮 cap 边界（内核 DEFAULT_DELTA_CAP_CONFIG 的镜像）。
 *
 * ⚠️ 这是第三份拷贝，靠单测对内核常量逐维断言兜住（漂移即红）——
 *   脚本跑在 `node` 下不能直接 import TS，断言只能放在 vitest 里做。
 */
export const CAP_BOUNDS = Object.freeze({
  trust: { up: 0.2, down: -0.3 },
  safety: { up: 0.2, down: -0.3 },
  bond: { up: 0.2, down: -0.3 },
  valence: { up: 0.2, down: -0.3 },
  arousal: { up: 0.2, down: -0.2 },
  verbal: { up: 0.2, down: -0.2 },
  depth: { up: 0.2, down: -0.2 },
  style: { up: 0.2, down: -0.2 },
  positive: { up: 0.15, down: -0.15 },
  negative: { up: 0.15, down: -0.15 },
  dependency: { up: 0.15, down: -0.15 },
});

/** 11 维 delta 键 → 8 维快照键（阻抗三分量按既有口径）。 */
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
 * 按单轮 cap 砍一个 11 维 delta。
 *
 * @param {Readonly<Record<string, number>>} delta 11 维增量
 * @returns {Record<string, number>} 砍后增量
 */
export function capDelta(delta) {
  const out = {};
  for (const key of DELTA_DIMS) {
    const value = Number(delta?.[key] ?? 0);
    const bounds = CAP_BOUNDS[key];
    out[key] = Math.max(bounds.down, Math.min(bounds.up, value));
  }
  return out;
}

/**
 * 在场在 cap 下的**有效贡献**：cap(real + presence) − cap(real)。
 *
 * 三项性质（单测钉住）：
 *   · 真实 delta 离 cap 还有余量时，等于 presence 全额；
 *   · 真实 delta 已经顶到 cap 时，等于 0（全被吃掉）；
 *   · 介于两者之间时，等于「cap 余量」与 presence 的较小值。
 *
 * @param {Readonly<Record<string, number>>} realDelta 当轮真实 11 维增量
 * @param {'holding_present'|'cold_absent'} label 在场标签
 * @param {number} multiplier 幅度倍数
 * @returns {{extra:Record<string,number>,full:Record<string,number>}} 有效贡献与未砍贡献
 */
export function presenceExtraUnderCap(realDelta, label, multiplier = 1) {
  const seed = PRESENCE_DELTAS[label];
  const full = {};
  const combined = {};
  for (const key of DELTA_DIMS) {
    const real = Number(realDelta?.[key] ?? 0);
    const presence = Number(seed?.[key] ?? 0) * Number(multiplier);
    full[key] = presence;
    combined[key] = real + presence;
  }
  const cappedCombined = capDelta(combined);
  const cappedReal = capDelta(Object.fromEntries(DELTA_DIMS.map((key) => [key, Number(realDelta?.[key] ?? 0)])));
  const extra = {};
  for (const key of DELTA_DIMS) extra[key] = cappedCombined[key] - cappedReal[key];
  return { extra, full };
}

/**
 * 按倍数做 cap 感知重放：轨迹差分 + cap 下的有效在场贡献。
 *
 * @param {{id:string,traces:object[],labelsByTurn:Map<number,string>}} session 单场输入
 * @param {number} multiplier 幅度倍数
 * @returns {object} 末态与损失指标（只数值）
 */
export function replayCapAware(session, multiplier) {
  let state = pickTracked(session.traces[0]?.bdiSnapshot);
  let cappedTurns = 0;
  let lost = 0;
  for (let index = 0; index < session.traces.length; index += 1) {
    const trace = session.traces[index];
    if (index > 0) state = addClamped(state, diffTracked(session.traces[index - 1]?.bdiSnapshot, trace?.bdiSnapshot));
    const label = session.labelsByTurn.get(Number(trace?.turnIndex));
    if (!label) continue;
    if (!PRESENCE_DELTAS[label]) continue;
    const { extra, full } = presenceExtraUnderCap(trace?.delta ?? {}, label, multiplier);
    let turnLost = 0;
    const mappedExtra = {};
    for (const key of TRACKED_KEYS) mappedExtra[key] = 0;
    for (const [deltaKey, snapshotKey] of Object.entries(DELTA_TO_SNAPSHOT)) {
      mappedExtra[snapshotKey] += Number(extra[deltaKey] ?? 0);
      turnLost += Math.abs(Number(full[deltaKey] ?? 0) - Number(extra[deltaKey] ?? 0));
    }
    if (turnLost > 1e-12) cappedTurns += 1;
    lost += turnLost;
    state = addClamped(state, mappedExtra);
  }
  const last = pickTracked(session.traces.at(-1)?.bdiSnapshot);
  return {
    id: session.id,
    safetyGain: round6(state.safety - last.safety),
    bondGain: round6(state.bond - last.bond),
    cappedTurns,
    lostDelta: round6(lost),
  };
}

/**
 * 批次汇总。
 *
 * @param {readonly ReturnType<typeof replayCapAware>[]} rows 单场指标
 * @param {number} multiplier 幅度倍数
 * @returns {object} 批次指标
 */
export function summarizeCapAware(rows, multiplier) {
  const totalSafety = round6(rows.reduce((sum, row) => sum + row.safetyGain, 0));
  const totalBond = round6(rows.reduce((sum, row) => sum + row.bondGain, 0));
  return {
    multiplier,
    sessions: rows.length,
    totalSafetyGain: totalSafety,
    totalBondGain: totalBond,
    meanSafetyGain: round6(totalSafety / Math.max(1, rows.length)),
    meanBondGain: round6(totalBond / Math.max(1, rows.length)),
    cappedTurns: rows.reduce((sum, row) => sum + row.cappedTurns, 0),
    lostDelta: rows.reduce((sum, row) => sum + row.lostDelta, 0),
  };
}

/**
 * 跑完整扫描。
 *
 * @param {readonly object[]} sessions 逐场输入
 * @param {readonly number[]} [multipliers] 档位
 * @returns {object[]} 每档汇总
 */
export function sweepCapAware(sessions, multipliers = CAP_SWEEP_MULTIPLIERS) {
  return multipliers.map((multiplier) =>
    summarizeCapAware(
      sessions.map((session) => replayCapAware(session, multiplier)),
      multiplier,
    ),
  );
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
  const sessions = loadSweepSessions(dir);
  const sweep = sweepCapAware(sessions);
  console.log('=== AF-422 cap 感知在场增益重放（只数值，无原文） ===');
  console.log(`场次 ${sessions.length} | 档位 ${CAP_SWEEP_MULTIPLIERS.map((m) => `${m}×`).join(' / ')}`);
  console.log('倍数 | 平均 safety 增益 | 平均 bond 增益 | 被 cap 吃掉轮次 | 被吃掉增量合计');
  for (const row of sweep) {
    console.log(
      `${String(row.multiplier).padStart(4)}× | ${row.meanSafetyGain.toFixed(4).padStart(8)} | ${row.meanBondGain
        .toFixed(4)
        .padStart(8)} | ${row.cappedTurns} | ${row.lostDelta.toFixed(6)}`,
    );
  }
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
