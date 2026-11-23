// AF-427 · 行为算子 delta 幅度台账（只读）
//   目的：内核 DELTA_TABLE 是 13 算子 × 11 维的硬编码系数表，注释里写着「单事件达上向 cap 的 X%」，
//         但没有一处把「13 个算子的 cap 占用 / 语料覆盖 / 覆盖缺口」汇总成一张可复算的表。
//         本脚本从内核源码**解析**这张表（不手抄第四份拷贝），算逐维 cap 占用，再叠语料实测覆盖。
//   红线：不打印任何对话原文；不改内核 delta 表 / cap 配置 / env / 分类器 / prompt；不写数据文件。
//   用法：node scripts/ops/quality/af427-operator-delta-ledger.mjs --dir data/debug-sessions
//         node scripts/ops/quality/af427-operator-delta-ledger.mjs --json

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** 内核 DELTA_TABLE 所在文件（解析用；只读）。 */
export const DELTA_TABLE_SOURCE = 'src/engine-core/cognition/state-transition.ts';

/** 11 维 delta 键，顺序固定（渲染稳定）。 */
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

/** 13 个算子，顺序与内核声明一致。 */
export const OPERATOR_ORDER = Object.freeze([
  'empathy',
  'acceptance',
  'normalization',
  'open_probe',
  'affirmation',
  'judgment',
  'preaching',
  'minimizing',
  'boundary_cross',
  'sensitive_touch',
  'neutral',
  'holding_present',
  'cold_absent',
]);

/**
 * 单轮 cap 边界（内核 DEFAULT_DELTA_CAP_CONFIG 的镜像）。
 *
 * ⚠️ 与 af422-presence-cap-aware-replay.mjs 的 CAP_BOUNDS 同口径；脚本跑在 node 下不能 import TS，
 *   漂移由 vitest 侧对内核常量逐维断言兜住。
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

/** deltaDetail 里实际被记录的维度（positive / negative / dependency 只在 delta 里出现）。 */
export const REALIZED_DIMS = Object.freeze(['trust', 'safety', 'bond', 'valence', 'arousal', 'verbal', 'depth', 'style']);

/**
 * 从内核源码文本解析 DELTA_TABLE。
 *
 * @param {string} sourceText 源码全文
 * @returns {Record<string, Record<string, number>>} 13 × 11 系数矩阵
 */
export function parseDeltaTable(sourceText) {
  if (typeof sourceText !== 'string' || sourceText.length === 0) {
    throw new Error('parseDeltaTable: 源码文本为空');
  }

  const anchor = sourceText.indexOf('const DELTA_TABLE');
  if (anchor < 0) {
    throw new Error('parseDeltaTable: 未找到 const DELTA_TABLE');
  }

  const openBrace = sourceText.indexOf('{', anchor);
  if (openBrace < 0) {
    throw new Error('parseDeltaTable: DELTA_TABLE 缺少对象起始花括号');
  }

  let depth = 0;
  let endIndex = -1;
  for (let i = openBrace; i < sourceText.length; i += 1) {
    const ch = sourceText[i];
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        endIndex = i;
        break;
      }
    }
  }
  if (endIndex < 0) {
    throw new Error('parseDeltaTable: DELTA_TABLE 对象未闭合');
  }

  const body = sourceText.slice(openBrace + 1, endIndex);
  const table = {};

  // 算子块：`  kind: {` ... `  },` ；别名块：`  kind: ZERO,`
  const blockPattern = /^ {2}([a-z_]+): (?:ZERO|\{),?\s*$/gm;
  const starts = [];
  for (const match of body.matchAll(blockPattern)) {
    starts.push({ kind: match[1], isZeroAlias: match[0].includes('ZERO'), index: match.index });
  }
  if (starts.length === 0) {
    throw new Error('parseDeltaTable: 未解析到任何算子块');
  }

  for (let i = 0; i < starts.length; i += 1) {
    const current = starts[i];
    const next = starts[i + 1];
    const sliceEnd = next ? next.index : body.length;
    const blockText = body.slice(current.index, sliceEnd);

    if (current.isZeroAlias) {
      table[current.kind] = Object.fromEntries(DELTA_DIMS.map((dim) => [dim, 0]));
      continue;
    }

    const vector = {};
    const dimPattern = /^ {4}([a-z_]+): (-?\d+(?:\.\d+)?),/gm;
    for (const match of blockText.matchAll(dimPattern)) {
      const dim = match[1];
      if (!DELTA_DIMS.includes(dim)) {
        throw new Error(`parseDeltaTable: 算子 ${current.kind} 出现未知维度 ${dim}`);
      }
      vector[dim] = Number(match[2]);
    }

    const missing = DELTA_DIMS.filter((dim) => !(dim in vector));
    if (missing.length > 0) {
      throw new Error(`parseDeltaTable: 算子 ${current.kind} 缺维度 ${missing.join(', ')}`);
    }
    table[current.kind] = vector;
  }

  const missingKinds = OPERATOR_ORDER.filter((kind) => !(kind in table));
  if (missingKinds.length > 0) {
    throw new Error(`parseDeltaTable: 缺算子 ${missingKinds.join(', ')}`);
  }
  const extraKinds = Object.keys(table).filter((kind) => !OPERATOR_ORDER.includes(kind));
  if (extraKinds.length > 0) {
    throw new Error(`parseDeltaTable: 出现未经登记的算子 ${extraKinds.join(', ')}`);
  }

  return table;
}

/**
 * 逐维 cap 占用比与算子最大值。
 *
 * @param {Record<string, Record<string, number>>} table 系数矩阵
 * @returns {Record<string, { max: number, maxDim: string, byDim: Record<string, number> }>}
 */
export function operatorCapUsage(table) {
  const usage = {};
  for (const kind of OPERATOR_ORDER) {
    const vector = table[kind];
    if (!vector) throw new Error(`operatorCapUsage: 缺算子 ${kind}`);
    const byDim = {};
    let max = 0;
    let maxDim = null;
    for (const dim of DELTA_DIMS) {
      const value = vector[dim] ?? 0;
      const bound = CAP_BOUNDS[dim];
      if (!bound) throw new Error(`operatorCapUsage: 维度 ${dim} 无 cap 边界`);
      const cap = value >= 0 ? bound.up : Math.abs(bound.down);
      const ratio = cap === 0 ? 0 : Math.abs(value) / cap;
      byDim[dim] = Number(ratio.toFixed(4));
      if (ratio > max) {
        max = ratio;
        maxDim = dim;
      }
    }
    usage[kind] = { max: Number(max.toFixed(4)), maxDim, byDim };
  }
  return usage;
}

/**
 * 扫语料，统计每个算子的命中轮次与实现 delta 均值。
 *
 * @param {{ dir?: string }} [options]
 * @returns {{ sessions: number, turns: number, byOperator: Record<string, object>, uncovered: string[] }}
 */
export function loadOperatorCorpusStats(options = {}) {
  const dir = options.dir ?? 'data/debug-sessions';
  if (!fs.existsSync(dir)) {
    throw new Error(`loadOperatorCorpusStats: 目录不存在 ${dir}`);
  }

  const files = fs
    .readdirSync(dir)
    .filter((name) => name.startsWith('debug_') && name.endsWith('.json'))
    .sort();

  const byOperator = Object.fromEntries(
    OPERATOR_ORDER.map((kind) => [
      kind,
      {
        turns: 0,
        turnsWithDetail: 0,
        multiEventTurns: 0,
        singleEventTurns: 0,
        realizedMean: Object.fromEntries(REALIZED_DIMS.map((dim) => [dim, 0])),
        realizedAbsMean: Object.fromEntries(REALIZED_DIMS.map((dim) => [dim, 0])),
        realizedSingleMean: Object.fromEntries(REALIZED_DIMS.map((dim) => [dim, 0])),
      },
    ]),
  );

  let turns = 0;
  for (const file of files) {
    const raw = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
    for (const trace of raw.traces ?? []) {
      turns += 1;
      const events = trace.deltaDetail?.events ?? [];
      if (events.length > 1) {
        for (const kind of events) {
          if (byOperator[kind]) byOperator[kind].multiEventTurns += 1;
        }
      }
      for (const kind of events) {
        const entry = byOperator[kind];
        if (!entry) continue;
        entry.turns += 1;
        if (!trace.deltaDetail) continue;
        entry.turnsWithDetail += 1;
        // 多算子同轮时 deltaDetail 是合并向量，分别计给每个算子会把幅度放大，只计入单算子轮
        const isSingleEvent = events.length === 1;
        if (isSingleEvent) entry.singleEventTurns += 1;
        for (const dim of REALIZED_DIMS) {
          const value = trace.deltaDetail[dim] ?? 0;
          entry.realizedMean[dim] += value;
          entry.realizedAbsMean[dim] += Math.abs(value);
          if (isSingleEvent) entry.realizedSingleMean[dim] += Math.abs(value);
        }
      }
    }
  }

  for (const kind of OPERATOR_ORDER) {
    const entry = byOperator[kind];
    const divisor = entry.turnsWithDetail || 1;
    const singleDivisor = entry.singleEventTurns || 1;
    for (const dim of REALIZED_DIMS) {
      entry.realizedMean[dim] = Number((entry.realizedMean[dim] / divisor).toFixed(6));
      entry.realizedAbsMean[dim] = Number((entry.realizedAbsMean[dim] / divisor).toFixed(6));
      entry.realizedSingleMean[dim] = Number((entry.realizedSingleMean[dim] / (entry.singleEventTurns ? singleDivisor : 1)).toFixed(6));
    }
  }

  const uncovered = OPERATOR_ORDER.filter((kind) => byOperator[kind].turns === 0);

  return { sessions: files.length, turns, byOperator, uncovered };
}

/**
 * 汇总台账数据结构。
 *
 * @param {{ rootDir?: string, dir?: string }} [options]
 * @returns {object}
 */
export function buildLedger(options = {}) {
  const rootDir = options.rootDir ?? '.';
  const sourcePath = path.join(rootDir, DELTA_TABLE_SOURCE);
  const sourceText = fs.readFileSync(sourcePath, 'utf8');
  const table = parseDeltaTable(sourceText);
  const usage = operatorCapUsage(table);
  const corpus = loadOperatorCorpusStats({ dir: path.join(rootDir, options.dir ?? 'data/debug-sessions') });

  return {
    generatedFor: 'AF-427',
    source: DELTA_TABLE_SOURCE,
    operators: OPERATOR_ORDER,
    dims: DELTA_DIMS,
    table,
    usage,
    corpus,
  };
}

/** 渲染 Markdown 台账（三段表）。 */
export function renderLedgerMarkdown(ledger) {
  const lines = [];
  lines.push('### 表一 · 13 算子 × 11 维系数（解析自内核 DELTA_TABLE）');
  lines.push('');
  lines.push(`| 算子 | ${ledger.dims.join(' | ')} |`);
  lines.push(`| --- | ${ledger.dims.map(() => '---').join(' | ')} |`);
  for (const kind of ledger.operators) {
    const row = ledger.dims.map((dim) => {
      const value = ledger.table[kind][dim];
      return value === 0 ? '0' : value.toFixed(3);
    });
    lines.push(`| ${kind} | ${row.join(' | ')} |`);
  }
  lines.push('');

  lines.push('### 表二 · 单事件 cap 占用（最大维 + 全部维度）');
  lines.push('');
  lines.push('| 算子 | 最大占用 | 所在维度 | 逐维占用 |');
  lines.push('| --- | --- | --- | --- |');
  for (const kind of ledger.operators) {
    const entry = ledger.usage[kind];
    const detail = ledger.dims.map((dim) => `${dim}=${(entry.byDim[dim] * 100).toFixed(1)}%`).join(' / ');
    lines.push(`| ${kind} | ${(entry.max * 100).toFixed(1)}% | ${entry.maxDim ?? '-'} | ${detail} |`);
  }
  lines.push('');

  lines.push('### 表三 · 语料覆盖（13 场 debug 会话）');
  lines.push('');
  lines.push('| 算子 | 命中轮次 | 单算子轮 | 多算子同轮 | 实现幅度绝对值和（8 维，单算子轮） | 实测/系数比 |');
  lines.push('| --- | --- | --- | --- | --- | --- |');
  for (const kind of ledger.operators) {
    const entry = ledger.corpus.byOperator[kind];
    const absSum = REALIZED_DIMS.reduce((sum, dim) => sum + entry.realizedSingleMean[dim], 0);
    const coefSum = REALIZED_DIMS.reduce((sum, dim) => sum + Math.abs(ledger.table[kind][dim] ?? 0), 0);
    const ratio = coefSum === 0 ? null : absSum / coefSum;
    lines.push(
      `| ${kind} | ${entry.turns} | ${entry.singleEventTurns} | ${entry.multiEventTurns} | ${entry.singleEventTurns ? absSum.toFixed(4) : '-'} | ${entry.singleEventTurns && ratio !== null ? `${(ratio * 100).toFixed(1)}%` : '-'} |`,
    );
  }
  lines.push('');
  lines.push(`会话数=${ledger.corpus.sessions}，轮次=${ledger.corpus.turns}，零语料算子=${ledger.corpus.uncovered.join(', ') || '无'}`);
  return lines.join('\n');
}

/** 判断是否以 CLI 方式直接运行（被 import 时不执行渲染）。 */
const invokedDirectly = Boolean(process.argv[1]) && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  const args = process.argv.slice(2);
  const dirArgIndex = args.indexOf('--dir');
  const dir = dirArgIndex >= 0 ? args[dirArgIndex + 1] : 'data/debug-sessions';
  const ledger = buildLedger({ rootDir: process.cwd(), dir });
  if (args.includes('--json')) {
    process.stdout.write(`${JSON.stringify(ledger, null, 2)}\n`);
  } else {
    process.stdout.write(`${renderLedgerMarkdown(ledger)}\n`);
  }
}
