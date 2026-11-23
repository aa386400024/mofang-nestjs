// AF-415 · A′ 在场判定精确率评估器与分层抽样（只读）
//   目的：把「人工标注 → 精确率 / 召回率」做成可复现链路，回答 AF-409/412 留下的问题：
//         117 个 holding 命中里，到底有多少是真在场。
//   红线：不打印咨询师对话原文；抽样 CSV 只含 sessionId / turnIndex / predicted / humanLabel；
//         不写生产数据；不碰 engine-core；不改变 AF-408/409/412 既有脚本行为。

import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { classifyNarrow } from './af409-presence-narrowing.mjs';

/** 有人工标签的三种取值. */
export const HUMAN_LABELS = ['holding', 'cold', 'neutral'];

/** 抽样 CSV 表头（顺序固定，前端/人工标注按列名读）. */
export const SAMPLE_CSV_HEADER = ['sessionId', 'turnIndex', 'predicted', 'humanLabel'];

/**
 * 分层抽样：每场最多 N 条 holding + M 条非 holding，总量封顶.
 *
 * 确定性：按输入顺序取前 N / M 条，不随机；同一批数据每次得到同一张表。
 *
 * @param {readonly {sessionId:string,turnIndex:number,predicted:string}[]} rows 预测行
 * @param {{maxHoldingPerSession?:number,maxNonHoldingPerSession?:number,maxTotal?:number}} [options] 配额
 * @returns {{sessionId:string,turnIndex:number,predicted:string,humanLabel:string}[]} 待标注样本
 */
export function buildPrecisionSample(rows, options = {}) {
  const maxHolding = Math.max(0, Math.trunc(options.maxHoldingPerSession ?? 3));
  const maxNonHolding = Math.max(0, Math.trunc(options.maxNonHoldingPerSession ?? 2));
  const maxTotal = Math.max(0, Math.trunc(options.maxTotal ?? 40));
  const bySession = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!row || typeof row.sessionId !== 'string' || !Number.isInteger(row.turnIndex)) continue;
    const bucket = bySession.get(row.sessionId) ?? { holding: [], nonHolding: [] };
    if (row.predicted === 'holding_present') bucket.holding.push(row);
    else bucket.nonHolding.push(row);
    bySession.set(row.sessionId, bucket);
  }
  const sample = [];
  for (const sessionId of [...bySession.keys()].sort()) {
    const bucket = bySession.get(sessionId);
    for (const row of bucket.holding.slice(0, maxHolding)) sample.push(toSampleRow(row));
    for (const row of bucket.nonHolding.slice(0, maxNonHolding)) sample.push(toSampleRow(row));
    if (sample.length >= maxTotal) break;
  }
  return sample.slice(0, maxTotal);
}

/**
 * 预测行转样本行（人工标签留空）.
 *
 * @param {{sessionId:string,turnIndex:number,predicted:string}} row 预测行
 * @returns {{sessionId:string,turnIndex:number,predicted:string,humanLabel:string}} 样本行
 */
function toSampleRow(row) {
  return { sessionId: row.sessionId, turnIndex: row.turnIndex, predicted: row.predicted, humanLabel: '' };
}

/**
 * CSV 单元格转义（含逗号 / 引号 / 换行时加引号）.
 *
 * @param {unknown} value 原值
 * @returns {string} 转义结果
 */
function csvCell(value) {
  const text = String(value ?? '');
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

/**
 * 样本行序列化为 CSV（固定表头 + LF 行尾）.
 *
 * @param {readonly {sessionId:string,turnIndex:number,predicted:string,humanLabel:string}[]} sample 样本
 * @returns {string} CSV 文本
 */
export function toSampleCsv(sample) {
  const lines = [SAMPLE_CSV_HEADER.join(',')];
  for (const row of sample) {
    lines.push([row.sessionId, row.turnIndex, row.predicted, row.humanLabel].map((value) => csvCell(value)).join(','));
  }
  return `${lines.join('\n')}\n`;
}

/**
 * 解析人工标签 CSV.
 *
 * 只接受 holding / cold / neutral；空 humanLabel 行跳过（未标注）；
 * 未知标签直接抛错，避免把拼错的标签算进精确率。
 *
 * @param {string} text CSV 文本
 * @returns {{sessionId:string,turnIndex:number,humanLabel:string}[]} 已标注行
 */
export function parseLabelsCsv(text) {
  const lines = String(text ?? '')
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0);
  if (lines.length === 0) throw new Error('标签 CSV 为空');
  const header = splitCsvLine(lines[0]);
  for (const column of SAMPLE_CSV_HEADER) {
    if (!header.includes(column)) throw new Error(`标签 CSV 缺列：${column}`);
  }
  const index = Object.fromEntries(SAMPLE_CSV_HEADER.map((column) => [column, header.indexOf(column)]));
  const labeled = [];
  for (let i = 1; i < lines.length; i += 1) {
    const cells = splitCsvLine(lines[i]);
    const label = String(cells[index.humanLabel] ?? '')
      .trim()
      .toLowerCase();
    if (label.length === 0) continue;
    if (!HUMAN_LABELS.includes(label)) throw new Error(`第 ${i + 1} 行人工标签非法：${label}（只接受 ${HUMAN_LABELS.join(' / ')}）`);
    const turnIndex = Number(cells[index.turnIndex]);
    if (!Number.isInteger(turnIndex)) throw new Error(`第 ${i + 1} 行 turnIndex 非整数`);
    labeled.push({ sessionId: String(cells[index.sessionId] ?? ''), turnIndex, humanLabel: label });
  }
  return labeled;
}

/**
 * 极简 CSV 行解析：支持双引号包裹与 "" 转义.
 *
 * @param {string} line 一行 CSV
 * @returns {string[]} 单元格
 */
function splitCsvLine(line) {
  const cells = [];
  let current = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (quoted) {
      if (char === '"' && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        current += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      cells.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  cells.push(current);
  return cells;
}

/**
 * 计算二分类指标（holding 为正类）.
 *
 * @param {number} tp 真正例
 * @param {number} fp 假正例
 * @param {number} fn 假负例
 * @param {number} tn 真负例
 * @returns {{precision:number,recall:number,f1:number,accuracy:number,coldRecall:number}} 指标
 */
export function computeBinaryMetrics(tp, fp, fn, tn) {
  const precision = tp + fp === 0 ? 0 : tp / (tp + fp);
  const recall = tp + fn === 0 ? 0 : tp / (tp + fn);
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
  const total = tp + fp + fn + tn;
  return {
    precision,
    recall,
    f1,
    accuracy: total === 0 ? 0 : (tp + tn) / total,
    coldRecall: tn + fn === 0 ? 0 : tn / (tn + fn),
  };
}

/**
 * 用人工标签评估 A′ 预测.
 *
 * @param {readonly {sessionId:string,turnIndex:number,predicted:string}[]} predictions 预测行
 * @param {readonly {sessionId:string,turnIndex:number,humanLabel:string}[]} labels 人工标签行
 * @returns {{labeled:number,unmatched:number,tp:number,fp:number,fn:number,tn:number,precision:number,recall:number,f1:number,accuracy:number,coldRecall:number,perSession:object[]}} 评估报告
 */
export function evaluatePrecision(predictions, labels) {
  const index = new Map();
  for (const row of predictions) index.set(`${row.sessionId}:${row.turnIndex}`, row);
  const stats = new Map();
  let unmatched = 0;
  for (const label of labels) {
    const key = `${label.sessionId}:${label.turnIndex}`;
    const prediction = index.get(key);
    if (!prediction) {
      unmatched += 1;
      continue;
    }
    const bucket = stats.get(label.sessionId) ?? { tp: 0, fp: 0, fn: 0, tn: 0 };
    const predictedHolding = prediction.predicted === 'holding_present';
    const humanHolding = label.humanLabel === 'holding';
    if (predictedHolding && humanHolding) bucket.tp += 1;
    else if (predictedHolding) bucket.fp += 1;
    else if (humanHolding) bucket.fn += 1;
    else bucket.tn += 1;
    stats.set(label.sessionId, bucket);
  }
  const total = { tp: 0, fp: 0, fn: 0, tn: 0 };
  const perSession = [];
  for (const sessionId of [...stats.keys()].sort()) {
    const bucket = stats.get(sessionId);
    for (const key of Object.keys(total)) total[key] += bucket[key];
    perSession.push({ sessionId, ...bucket, ...computeBinaryMetrics(bucket.tp, bucket.fp, bucket.fn, bucket.tn) });
  }
  return {
    labeled: total.tp + total.fp + total.fn + total.tn,
    unmatched,
    ...total,
    ...computeBinaryMetrics(total.tp, total.fp, total.fn, total.tn),
    perSession,
  };
}

/**
 * 读取落盘 trace，产出带轮次的 A′ 预测行（不返回原文）.
 *
 * @param {string} dir trace 目录
 * @returns {{sessionId:string,turnIndex:number,predicted:string}[]} 预测行
 */
export function loadPredictionRows(dir) {
  const files = readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .sort();
  const rows = [];
  for (const name of files) {
    const raw = JSON.parse(readFileSync(join(dir, name), 'utf8'));
    const sessionId = typeof raw.id === 'string' ? raw.id : name.replace(/\.json$/, '');
    const traces = Array.isArray(raw.traces) ? raw.traces : [];
    const neutralTurns = new Set(
      traces
        .filter((trace) => {
          const tags = Array.isArray(trace?.eventTags) ? trace.eventTags : [];
          return tags.length === 0 || (tags.length === 1 && tags[0] === 'neutral');
        })
        .map((trace) => Number(trace?.turnIndex)),
    );
    const counselor = (raw.messages ?? []).filter((message) => message?.role === 'counselor' && String(message.text ?? '').trim());
    for (const message of counselor) {
      if (!neutralTurns.has(Number(message.turnIndex))) continue;
      rows.push({ sessionId, turnIndex: Number(message.turnIndex), predicted: classifyNarrow(message.text) });
    }
  }
  return rows;
}

/**
 * 主流程.
 *
 * @param {string[]} argv 命令行参数
 */
function main(argv = []) {
  const rows = loadPredictionRows('data/debug-sessions');
  const option = (flag) => {
    const at = argv.indexOf(flag);
    return at >= 0 ? argv[at + 1] : null;
  };
  const sampleOut = option('--sample-out');
  const labelsPath = option('--labels');
  console.log('=== AF-415 A′ 精确率评估（无原文） ===');
  console.log(`场次 ${new Set(rows.map((row) => row.sessionId)).size} | neutral 轮 ${rows.length}`);
  const holding = rows.filter((row) => row.predicted === 'holding_present').length;
  console.log(`A′ holding=${holding} 非 holding=${rows.length - holding}`);
  if (sampleOut) {
    const sample = buildPrecisionSample(rows);
    mkdirSync(dirname(sampleOut), { recursive: true });
    writeFileSync(sampleOut, toSampleCsv(sample), 'utf8');
    console.log(`抽样 ${sample.length} 行 → ${sampleOut}（列：sessionId,turnIndex,predicted,humanLabel）`);
  }
  if (labelsPath) {
    const labels = parseLabelsCsv(readFileSync(labelsPath, 'utf8'));
    const report = evaluatePrecision(rows, labels);
    console.log(`已标注 ${report.labeled} | 未匹配 ${report.unmatched} | TP=${report.tp} FP=${report.fp} FN=${report.fn} TN=${report.tn}`);
    console.log(
      `precision=${report.precision.toFixed(4)} recall=${report.recall.toFixed(4)} f1=${report.f1.toFixed(4)} accuracy=${report.accuracy.toFixed(4)} coldRecall=${report.coldRecall.toFixed(4)}`,
    );
    for (const item of report.perSession) {
      console.log(
        `${item.sessionId}: labeled=${item.tp + item.fp + item.fn + item.tn} precision=${item.precision.toFixed(4)} recall=${item.recall.toFixed(4)}`,
      );
    }
  }
}

if (process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('/af415-presence-precision-eval.mjs')) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(`评估失败：${error.message}`);
    process.exit(1);
  }
}
