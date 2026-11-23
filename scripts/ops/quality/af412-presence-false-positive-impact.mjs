// AF-412 · 在场误判的系统级影响审计（全会话投影，只读）
//   目的：把 AF-409 的 A′/B′/C′ 命中结果投影到全部场次，量化“若开启，会误翻多少场 zero_motion、
//         整批 safety/bond 被抬高多少”。
//   红线：不打印任何逐字稿原文；不修改生产分类器、delta、prompt；不写仓库数据文件。
//   用法：node scripts/ops/quality/af412-presence-false-positive-impact.mjs --dir data/debug-sessions

import { classifyNarrow } from './af409-presence-narrowing.mjs';
import { PRESENCE_DELTAS } from './af408-presence-calibration.mjs';

/** 与 batch-metrics.compute.ts 的 DIMENSION_SNAPSHOT_KEY 同口径的八维键。 */
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

/**
 * 判定一场是否零变化（首末八维逐字相等）。
 *
 * @param {Readonly<Record<string, number>>} first 首轮快照
 * @param {Readonly<Record<string, number>>} last 末轮快照
 * @returns {boolean} 是否零变化
 */
export function isZeroMotionSnapshot(first, last) {
  return TRACKED_KEYS.every((key) => Number(first?.[key] ?? 0) === Number(last?.[key] ?? 0));
}

/**
 * 把一场的在场事件投影到末轮快照（单次加法，不重跑后续轮）。
 *
 * @param {readonly string[]} labels 每轮 A′ 标签
 * @param {Readonly<Record<string, number>>} last 末轮八维快照
 * @returns {{holding:number,cold:number,safetyGain:number,bondGain:number,safetyAfter:number,bondAfter:number}} 投影
 */
export function projectPresenceOnSnapshot(labels, last) {
  let holding = 0;
  let cold = 0;
  let safetyGain = 0;
  let bondGain = 0;
  for (const label of labels) {
    const delta = PRESENCE_DELTAS[label];
    if (!delta) continue;
    if (label === 'holding_present') holding += 1;
    if (label === 'cold_absent') cold += 1;
    safetyGain += delta.safety;
    bondGain += delta.bond;
  }
  const safetyAfter = clamp01(Number(last?.safety ?? 0) + safetyGain);
  const bondAfter = clamp01(Number(last?.bond ?? 0) + bondGain);
  return { holding, cold, safetyGain: round6(safetyGain), bondGain: round6(bondGain), safetyAfter, bondAfter };
}

/**
 * 汇总单场投影结果。
 *
 * @param {{id:string,labels:string[],first:Record<string,number>,last:Record<string,number>}} session 单场
 * @returns {{id:string,neutralTurns:number,holding:number,cold:number,currentlyZero:boolean,projectedZero:boolean,safetyGain:number,bondGain:number,safetyAfter:number,bondAfter:number}} 单场摘要
 */
export function summarizeSessionImpact(session) {
  const currentlyZero = isZeroMotionSnapshot(session.first, session.last);
  const projected = projectPresenceOnSnapshot(session.labels, session.last);
  const projectedLast = { ...session.last, safety: projected.safetyAfter, bond: projected.bondAfter };
  const projectedZero = isZeroMotionSnapshot(session.first, projectedLast);
  return {
    id: session.id,
    neutralTurns: session.labels.length,
    holding: projected.holding,
    cold: projected.cold,
    currentlyZero,
    projectedZero,
    safetyGain: projected.safetyGain,
    bondGain: projected.bondGain,
    safetyAfter: projected.safetyAfter,
    bondAfter: projected.bondAfter,
  };
}

/**
 * 汇总全部场次。
 *
 * @param {readonly ReturnType<typeof summarizeSessionImpact>[]} rows 单场摘要
 * @returns {{sessions:number,neutralTurns:number,holding:number,cold:number,currentZero:number,projectedZero:number,flipped:number,affected:number,totalSafetyGain:number,totalBondGain:number,maxSafetyGain:number,meanSafetyGainPerAffected:number}} 批次摘要
 */
export function summarizeImpact(rows) {
  const currentZero = rows.filter((row) => row.currentlyZero).length;
  const projectedZero = rows.filter((row) => row.projectedZero).length;
  const affected = rows.filter((row) => row.holding > 0).length;
  const totalSafetyGain = rows.reduce((sum, row) => sum + row.safetyGain, 0);
  const totalBondGain = rows.reduce((sum, row) => sum + row.bondGain, 0);
  const maxSafetyGain = rows.reduce((max, row) => Math.max(max, row.safetyGain), 0);
  return {
    sessions: rows.length,
    neutralTurns: rows.reduce((sum, row) => sum + row.neutralTurns, 0),
    holding: rows.reduce((sum, row) => sum + row.holding, 0),
    cold: rows.reduce((sum, row) => sum + row.cold, 0),
    currentZero,
    projectedZero,
    flipped: currentZero - projectedZero,
    affected,
    totalSafetyGain: round6(totalSafetyGain),
    totalBondGain: round6(totalBondGain),
    maxSafetyGain: round6(maxSafetyGain),
    meanSafetyGainPerAffected: affected === 0 ? 0 : round6(totalSafetyGain / affected),
  };
}

/**
 * 读取 trace 并构造逐场投影输入（不读原文输出）。
 *
 * @param {string} dir trace 目录
 * @returns {ReturnType<typeof summarizeSessionImpact>[]} 单场摘要
 */
export async function loadImpactRows(dir) {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const files = fs
    .readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .sort();
  const rows = [];
  for (const name of files) {
    const raw = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
    const traces = Array.isArray(raw.traces) ? raw.traces : [];
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
    const labels = counselor
      .filter((message) => neutralTurns.has(Number(message.turnIndex)))
      .map((message) => classifyNarrow(message.text));
    const first = traces[0]?.bdiSnapshot ?? {};
    const last = traces.at(-1)?.bdiSnapshot ?? {};
    rows.push(summarizeSessionImpact({ id: raw.id ?? name.replace(/\.json$/, ''), labels, first, last }));
  }
  return rows;
}

/**
 * 按误判比例缩放批次增量（精度未知时的敏感性口径）。
 *
 * @param {ReturnType<typeof summarizeImpact>} summary 批次摘要
 * @param {number} errorRate 0..1 的误判比例
 * @returns {{errorRate:number,safetyGain:number,bondGain:number}} 缩放后的增量
 */
export function scaleImpactByErrorRate(summary, errorRate) {
  const bounded = Math.max(0, Math.min(1, Number(errorRate) || 0));
  return {
    errorRate: bounded,
    safetyGain: round6(summary.totalSafetyGain * bounded),
    bondGain: round6(summary.totalBondGain * bounded),
  };
}

/**
 * 主流程。
 */
async function main() {
  const dirIndex = process.argv.indexOf('--dir');
  const dir = dirIndex === -1 ? 'data/debug-sessions' : (process.argv[dirIndex + 1] ?? 'data/debug-sessions');
  const fs = await import('node:fs');
  if (!fs.existsSync(dir)) {
    console.error(`目录不存在: ${dir}`);
    process.exitCode = 1;
    return;
  }
  const rows = await loadImpactRows(dir);
  const summary = summarizeImpact(rows);
  console.log('=== AF-412 在场误判系统级影响（全会话投影，无原文） ===');
  console.log(`场次 ${summary.sessions} | neutral 轮 ${summary.neutralTurns} | A′ holding ${summary.holding} | cold ${summary.cold}`);
  console.log(`zero_motion: 当前 ${summary.currentZero} → 投影 ${summary.projectedZero}（翻转 ${summary.flipped} 场）`);
  console.log(
    `受影响场次 ${summary.affected}/${summary.sessions} | 总 safety +${summary.totalSafetyGain.toFixed(4)} | 总 bond +${summary.totalBondGain.toFixed(4)} | 单场最大 safety +${summary.maxSafetyGain.toFixed(4)} | 受影响场均 safety +${summary.meanSafetyGainPerAffected.toFixed(4)}`,
  );
  console.log('\n误判比例敏感性（全命中=100%）：');
  for (const rate of [0.25, 0.5, 0.75, 1]) {
    const scaled = scaleImpactByErrorRate(summary, rate);
    console.log(`  ${(rate * 100).toFixed(0)}% → safety +${scaled.safetyGain.toFixed(4)} | bond +${scaled.bondGain.toFixed(4)}`);
  }
  console.log('\n逐场（仅数值）：');
  for (const row of rows) {
    console.log(
      `  ${row.id} neutral=${row.neutralTurns} holding=${row.holding} zero=${row.currentlyZero ? 'Y' : 'N'}→${row.projectedZero ? 'Y' : 'N'} safety=${row.safetyAfter.toFixed(4)} bond=${row.bondAfter.toFixed(4)}`,
    );
  }
}

/**
 * 夹到 [0,1] 并保留 6 位。
 *
 * @param {number} value 原值
 * @returns {number} 夹取结果
 */
function clamp01(value) {
  return Math.max(0, Math.min(1, round6(value)));
}

/**
 * 保留 6 位小数。
 *
 * @param {number} value 原值
 * @returns {number} 结果
 */
function round6(value) {
  return Number(value.toFixed(6));
}

if (process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('/af412-presence-false-positive-impact.mjs')) {
  await main();
}
