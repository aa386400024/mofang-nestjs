// AF-421 · 在场 delta 幅度扫描（只读）
//   目的：AF-420 把在场幅度接进了 env，本脚本回答「改到多大才有可观测增益、多大开始撞夹取」。
//         做法是同一份种子幅度按倍数缩放后逐轮重放，输出「倍数 → 末态增益 → 触顶场次」。
//   红线：不打印任何逐字稿原文；不修改内核 delta 表 / env 默认值 / 分类器 / prompt；不写仓库数据文件。
//   用法：node scripts/ops/quality/af421-presence-amplitude-sweep.mjs --dir data/debug-sessions

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { classifyNarrow } from './af409-presence-narrowing.mjs';
import {
  TRACKED_KEYS,
  addClamped,
  applyPresenceDelta,
  diffTracked,
  pickTracked,
  scaledPresenceDelta,
} from './af418-presence-replay-calibration.mjs';

/** 扫描档位（1 = 内核种子幅度；AF-420 的两个 env 键就是改这个比例）。 */
export const SWEEP_MULTIPLIERS = Object.freeze([0, 0.25, 0.5, 1, 2, 4, 8]);

/**
 * 按倍数重放单场：真实相邻快照差 + 当轮 scaled presence delta，每步夹取。
 *
 * @param {readonly {turnIndex:number,bdiSnapshot?:object}[]} traces 按轮次排序的 trace
 * @param {ReadonlyMap<number, string>} labelsByTurn 轮次 → A′ 标签
 * @param {number} multiplier 幅度倍数
 * @returns {{final:Record<string,number>, labels:string[]}} 末态与标签序列
 */
export function replayAtMultiplier(traces, labelsByTurn, multiplier) {
  const labels = [];
  let state = pickTracked(traces[0]?.bdiSnapshot);
  for (let index = 0; index < traces.length; index += 1) {
    if (index > 0) state = addClamped(state, diffTracked(traces[index - 1]?.bdiSnapshot, traces[index]?.bdiSnapshot));
    const label = labelsByTurn.get(Number(traces[index]?.turnIndex));
    if (!label) continue;
    labels.push(label);
    state = applyPresenceDelta(state, label, multiplier);
  }
  return { final: state, labels };
}

/**
 * 单场在单档下的指标。
 *
 * @param {{id:string,traces:object[],labelsByTurn:Map<number,string>}} session 单场输入
 * @param {number} multiplier 幅度倍数
 * @returns {object} 单场指标（只数值）
 */
export function sweepSession(session, multiplier) {
  const { final, labels } = replayAtMultiplier(session.traces, session.labelsByTurn, multiplier);
  const last = pickTracked(session.traces.at(-1)?.bdiSnapshot);
  // 谁真正把该维推到边界：按 presence delta 的方向判定（负向 delta 才把维度压到 0，
  // 正向 delta 才把维度顶到 1）。只看"当前值等于边界"会把基线本来就贴边的维算成饱和。
  const pushed = {};
  for (const key of TRACKED_KEYS) pushed[key] = 0;
  for (const label of labels) {
    const scaled = scaledPresenceDelta(label, multiplier);
    for (const key of TRACKED_KEYS) pushed[key] += Number(scaled[key] ?? 0);
  }
  const clamped = TRACKED_KEYS.filter((key) => {
    const value = Number(final[key] ?? 0);
    const bias = Number(pushed[key] ?? 0);
    if (Math.abs(bias) < 1e-12) return false;
    if (key === 'valence') return bias > 0 ? value >= 1 - 1e-9 : value <= -1 + 1e-9;
    return bias > 0 ? value >= 1 - 1e-9 : value <= 1e-9;
  });
  // cap 触发：本轮真实 delta + scaled presence delta 超过单维 cap 预算（缺省 safety 上向 0.20）。
  //   注意这是**近似**：用 trace 记录的 delta 当真实增量，不含 timing 折损；只为判断"从哪档开始撞 cap"。
  const capBiteTurns = countCapBites(session.traces, session.labelsByTurn, multiplier);
  return {
    id: session.id,
    safetyGain: round6(final.safety - last.safety),
    bondGain: round6(final.bond - last.bond),
    clampedDims: clamped,
    capBiteTurns,
  };
}

/** 内核缺省 cap（safety 上向）——与 DEFAULT_DELTA_CAP_CONFIG 对齐。 */
const SAFETY_CAP_UP = 0.2;

/**
 * 统计「真实 delta + scaled presence delta 超过 safety 上向 cap」的轮次。
 *
 * @param {readonly {turnIndex:number,delta?:object}[]} traces 按轮次排序的 trace
 * @param {ReadonlyMap<number, string>} labelsByTurn 轮次 → A′ 标签
 * @param {number} multiplier 幅度倍数
 * @returns {number} 触发轮次
 */
export function countCapBites(traces, labelsByTurn, multiplier) {
  let bites = 0;
  for (const trace of traces) {
    const label = labelsByTurn.get(Number(trace?.turnIndex));
    if (!label) continue;
    const realSafety = Number(trace?.delta?.safety ?? 0);
    const scaledSafety = Number(scaledPresenceDelta(label, multiplier).safety ?? 0);
    if (realSafety + scaledSafety > SAFETY_CAP_UP) bites += 1;
  }
  return bites;
}

/**
 * 批次在单档下的汇总。
 *
 * @param {readonly ReturnType<typeof sweepSession>[]} rows 单场指标
 * @param {number} multiplier 幅度倍数
 * @returns {object} 批次指标
 */
export function summarizeMultiplier(rows, multiplier) {
  const totalSafetyGain = round6(rows.reduce((sum, row) => sum + row.safetyGain, 0));
  const totalBondGain = round6(rows.reduce((sum, row) => sum + row.bondGain, 0));
  return {
    multiplier,
    sessions: rows.length,
    totalSafetyGain,
    totalBondGain,
    meanSafetyGain: round6(totalSafetyGain / Math.max(1, rows.length)),
    meanBondGain: round6(totalBondGain / Math.max(1, rows.length)),
    clampedSessions: rows.filter((row) => row.clampedDims.length > 0).length,
    capBiteTurns: rows.reduce((sum, row) => sum + Number(row.capBiteTurns ?? 0), 0),
  };
}

/**
 * 跑完整扫描。
 *
 * @param {readonly {id:string,traces:object[],labelsByTurn:Map<number,string>}[]} sessions 逐场输入
 * @param {readonly number[]} [multipliers] 档位
 * @returns {object[]} 每档汇总
 */
export function sweepAmplitudes(sessions, multipliers = SWEEP_MULTIPLIERS) {
  return multipliers.map((multiplier) =>
    summarizeMultiplier(
      sessions.map((session) => sweepSession(session, multiplier)),
      multiplier,
    ),
  );
}

/**
 * 达到目标平均末态增益所需的最低档位。
 *
 * @param {readonly ReturnType<typeof summarizeMultiplier>[]} sweep 扫描结果
 * @param {number} target 目标平均增益（safety 维）
 * @returns {number|null} 最低倍数；null = 扫描区间内不可达
 */
export function requiredMultiplierForTarget(sweep, target) {
  for (const row of sweep) {
    if (row.meanSafetyGain >= target - 1e-9) return row.multiplier;
  }
  return null;
}

/**
 * 读取 trace 目录并构造逐场输入（只保留数值与标签）。
 *
 * 与 AF-418 的 loadReplayRows 同口径（neutral / 缺标签轮都纳入口径），差别只在本函数保留
 * traces 与 labelsByTurn，供多档重放复用。
 *
 * @param {string} dir trace 目录
 * @returns {object[]} 逐场输入
 */
export function loadSweepSessions(dir) {
  const names = fs
    .readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .sort();
  const sessions = [];
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
    sessions.push({ id: raw.id ?? name.replace(/\.json$/, ''), traces, labelsByTurn });
  }
  return sessions;
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
  const sweep = sweepAmplitudes(sessions);
  console.log('=== AF-421 在场 delta 幅度扫描（只数值，无原文） ===');
  console.log(`场次 ${sessions.length} | 档位 ${SWEEP_MULTIPLIERS.map((m) => `${m}×`).join(' / ')}`);
  console.log('倍数 | 平均 safety 增益 | 平均 bond 增益 | 触顶场次 | cap 触发轮次');
  for (const row of sweep) {
    console.log(
      `${String(row.multiplier).padStart(4)}× | ${row.meanSafetyGain.toFixed(4).padStart(8)} | ${row.meanBondGain
        .toFixed(4)
        .padStart(8)} | ${row.clampedSessions}/${row.sessions} | ${row.capBiteTurns}`,
    );
  }
  for (const target of [0.05, 0.1]) {
    const required = requiredMultiplierForTarget(sweep, target);
    console.log(
      required === null
        ? `达到平均 safety 增益 +${target.toFixed(2)}：扫描区间内不可达`
        : `达到平均 safety 增益 +${target.toFixed(2)}：最低 ${required}×（对应批次总增益 +${sweep
            .find((row) => row.multiplier === required)
            ?.totalSafetyGain.toFixed(4)}）`,
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
