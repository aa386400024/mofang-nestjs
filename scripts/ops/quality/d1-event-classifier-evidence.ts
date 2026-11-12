// V2026-11-12 建立 (D-1 取证 · 规则轨漏判率离线取证 · CLI 编排):
//   职责: 读逐字稿目录 (+ 可选的批次血缘) → 投影 → 统计 → 落三个离线 CSV → 打印比率表.
//
//   为什么只留编排 (逻辑全在纯模块):
//     口径与实现必须同源 —— 脚本与 spec 各写一套计算 = 反双胞胎.
//     纯模块: scripts/ops/quality/d1-event-classifier-evidence.lexicon.ts
//
//   用法 (pnpm, 禁裸 npx):
//     pnpm exec tsx scripts/ops/quality/d1-event-classifier-evidence.ts
//     pnpm exec tsx scripts/ops/quality/d1-event-classifier-evidence.ts --dir data/debug-sessions
//     pnpm exec tsx scripts/ops/quality/d1-event-classifier-evidence.ts --labels data/quality/d1-annotation-skeleton-2026-11-12.csv
//
//   ⚠️ 隐私红线 (AGENTS.md §5.4):
//     · 控制台与 CSV 只出 id / 计数 / 比率 / 标签 / 归一化字符数桶;
//     · **不打印任何对话原文**, 不读 renderSpec / kernelState / title / characterLabel;
//     · 咨询师文本只在内存里用来算长度, 算完只留桶.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import {
  buildAnnotationCsv,
  buildProjectionCsv,
  buildSampleCsv,
  computeLabelAgreement,
  computeRuleTrackBaseline,
  parseAnnotationLabels,
  projectTranscript,
  stratifiedSample,
  type LabelAgreement,
  type ProjectedTurn,
  type RawTranscript,
  type TurnBucket,
} from './d1-event-classifier-evidence.lexicon.js';

/** 批次血缘里的一条 (离线拿模式列的来源). */
interface LineageRow {
  readonly debugSessionId?: string;
  readonly characterSlug?: string;
  readonly counselorModeId?: string;
  readonly turns?: number;
  readonly fileSha256?: string;
}

/** 批次血缘文件 (WP-K 快照). */
interface LineageFile {
  readonly batchId?: string;
  readonly computedAt?: string;
  readonly lineage?: readonly LineageRow[];
}

/** 命令行参数. */
interface Options {
  readonly dir: string;
  readonly lineage: string;
  readonly out: string;
  readonly sampleSize: number;
  readonly stamp: string;
  readonly labels: string | null;
}

/**
 * 解析命令行参数.
 *
 * @param argv 参数数组
 * @returns 选项
 */
function parseOptions(argv: readonly string[]): Options {
  const read = (flag: string, fallback: string): string => {
    const index = argv.indexOf(flag);
    return index === -1 ? fallback : (argv[index + 1] ?? fallback);
  };
  const size = Number(read('--sample-size', '60'));
  return {
    dir: read('--dir', 'data/debug-sessions'),
    lineage: read('--lineage', 'data/batch-reports/g3ONzlqSGMVJqkFMF9Lwh.json'),
    out: read('--out', 'data/quality'),
    sampleSize: Number.isFinite(size) && size > 0 ? size : 60,
    stamp: read('--stamp', '2026-11-12'),
    labels: argv.includes('--labels') ? read('--labels', '') : null,
  };
}

/**
 * 读批次血缘 (离线补模式列; 没有就留空并在报告注明缺口).
 *
 * @param filePath 血缘文件路径
 * @returns 场次 id → 血缘
 */
function loadLineage(filePath: string): Map<string, LineageRow> {
  const rows = new Map<string, LineageRow>();
  if (!fs.existsSync(filePath)) return rows;
  const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8')) as LineageFile;
  for (const row of parsed.lineage ?? []) {
    if (!row.debugSessionId) continue;
    rows.set(row.debugSessionId, row);
  }
  return rows;
}

/**
 * 打印一个比率 (固定 4 位小数).
 *
 * @param label 标签
 * @param value 值
 */
function printRatio(label: string, value: number | null): void {
  console.log(`  ${label.padEnd(28)} ${value === null ? 'n/a' : value.toFixed(4)}`);
}

/**
 * 打印一个分组的统计.
 *
 * @param title 标题
 * @param buckets 分组
 */
function printBuckets(title: string, buckets: ReadonlyMap<string, TurnBucket>): void {
  console.log(`\n[${title}]`);
  for (const bucket of [...buckets.values()].toSorted((left, right) => left.key.localeCompare(right.key))) {
    console.log(
      `  ${bucket.key.padEnd(42)} 轮 ${String(bucket.turns).padStart(4)} | 有效 ${String(bucket.eligibleTurns).padStart(4)} | neutral ${String(bucket.neutralTurns).padStart(4)} (${(bucket.neutralRate * 100).toFixed(2)}%)`,
    );
  }
}

/**
 * 打印人工标注对照.
 *
 * @param agreement 对照结果
 */
function printAgreement(agreement: LabelAgreement): void {
  console.log('\n=== 人工标注对照 (precision / recall / 两向漏判) ===');
  console.log(`已标注轮数 ${agreement.labeledTurns} / 未标注 ${agreement.unlabeledTurns}`);
  console.log('\n-- 逐类一致度 (分母为 0 时 n/a) --');
  for (const kind of agreement.perKind) {
    if (kind.support === 0 && kind.ruleCount === 0) continue;
    console.log(
      `  ${kind.kind.padEnd(20)} support ${String(kind.support).padStart(4)} | rule ${String(kind.ruleCount).padStart(4)} | tp ${String(kind.truePositive).padStart(4)} | fp ${String(kind.falsePositive).padStart(4)} | fn ${String(kind.falseNegative).padStart(4)}`,
    );
    printRatio('    precision', kind.precision);
    printRatio('    recall', kind.recall);
  }
  console.log('\n-- 两向漏判 (neutral 误吞) --');
  for (const [name, stat] of [
    ['漏正向 holding_present', agreement.swallow.holdingPresent],
    ['漏负向 cold_absent', agreement.swallow.coldAbsent],
  ] as const) {
    console.log(
      `  ${name.padEnd(28)} 标注 ${String(stat.labeled).padStart(4)} | 被吞 ${String(stat.swallowed).padStart(4)} | 率 ${stat.rate === null ? 'n/a' : stat.rate.toFixed(4)} | 区间 [${stat.interval ? stat.interval.lower.toFixed(4) : 'n/a'}, ${stat.interval ? stat.interval.upper.toFixed(4) : 'n/a'}]`,
    );
  }
  console.log('\n-- 规则轨判 neutral 的已标注轮, 人工判成了什么 (误吞分解) --');
  for (const [label, count] of [...agreement.neutralRuleBreakdown.entries()].toSorted((left, right) => left[0].localeCompare(right[0]))) {
    console.log(`  ${label.padEnd(20)} ${count}`);
  }
}

/**
 * 主流程.
 */
async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  console.log('=== D-1 取证 · 规则轨漏判率离线取证 ===');
  console.log(`逐字稿目录 ${options.dir}`);
  console.log(`血缘文件   ${options.lineage}`);
  console.log(`输出目录   ${options.out}`);
  console.log(`抽样条数   ${options.sampleSize}`);

  if (!fs.existsSync(options.dir)) {
    console.error(`目录不存在: ${options.dir}`);
    process.exitCode = 1;
    return;
  }

  const lineage = loadLineage(options.lineage);
  const files = fs
    .readdirSync(options.dir)
    .filter((name) => name.endsWith('.json'))
    .toSorted();
  const turns: ProjectedTurn[] = [];
  let hashMatched = 0;
  let hashMismatched = 0;
  let hashUnknown = 0;
  let parseFailed = 0;

  for (const name of files) {
    const fullPath = path.join(options.dir, name);
    const debugSessionId = name.replace(/\.json$/, '');
    const raw = fs.readFileSync(fullPath);
    const row = lineage.get(debugSessionId);
    if (row?.fileSha256) {
      // 口径与 WP-K 批次快照**逐字一致**: UTF-8 字符串的 sha256 **前 16 位**
      // (batch-metrics.service.ts:222) —— 不一致就说明文件被改过 (口径漂移).
      const digest = crypto.createHash('sha256').update(raw.toString('utf8'), 'utf8').digest('hex').slice(0, 16);
      if (digest === row.fileSha256) hashMatched += 1;
      else hashMismatched += 1;
    } else {
      hashUnknown += 1;
    }
    let parsed: RawTranscript;
    try {
      parsed = JSON.parse(raw.toString('utf8')) as RawTranscript;
    } catch {
      parseFailed += 1;
      continue;
    }
    turns.push(
      ...projectTranscript({
        transcript: parsed,
        debugSessionId,
        counselorModeId: row?.counselorModeId ?? '',
      }),
    );
  }

  const baseline = computeRuleTrackBaseline(turns);
  console.log('\n=== 规则轨基线 (全量, 不依赖人工标注) ===');
  console.log(`逐字稿 ${files.length} 份 (解析失败 ${parseFailed}) | 场次 ${baseline.sessions} | 轮次 ${baseline.totalTurns}`);
  console.log(`降级轮(来访者侧渲染降级) ${baseline.degradedTurns} | 有效轮 ${baseline.eligibleTurns}`);
  console.log(`血缘 sha256 校验: 一致 ${hashMatched} / 不一致 ${hashMismatched} / 无血缘 ${hashUnknown}`);
  console.log('\n-- 事件标签实例计数 (占有效轮) --');
  for (const [kind, count] of [...baseline.tagCounts.entries()].toSorted((left, right) => right[1] - left[1])) {
    console.log(
      `  ${kind.padEnd(20)} ${String(count).padStart(5)}  (${((count / Math.max(1, baseline.eligibleTurns)) * 100).toFixed(2)}%)`,
    );
  }
  console.log('\n-- 头号指标 --');
  printRatio('neutral 误吞上界 (比率)', baseline.neutralRate);
  console.log(
    `  ${'neutral 误吞上界 (95% 区间)'.padEnd(28)} [${baseline.neutralInterval.lower.toFixed(4)}, ${baseline.neutralInterval.upper.toFixed(4)}]`,
  );
  printRatio('正向事件率', baseline.positiveEventRate);
  printRatio('负向词事件率 (4 类)', baseline.negativeEventRate);
  console.log(`  ${'多标签轮 / 零标签轮'.padEnd(28)} ${baseline.multiTagTurns} / ${baseline.zeroTagTurns}`);

  printBuckets('按咨询师模式', baseline.byMode);
  printBuckets('按角色', baseline.byCharacter);
  printBuckets('按轮次段', baseline.bySegment);

  const items = stratifiedSample(turns, options.sampleSize);
  const projectionCsv = buildProjectionCsv(turns);
  const sampleCsv = buildSampleCsv(items);
  const annotationCsv = buildAnnotationCsv(items);
  fs.mkdirSync(options.out, { recursive: true });
  const projectionPath = path.join(options.out, `d1-turn-projection-${options.stamp}.csv`);
  const samplePath = path.join(options.out, `d1-sample-list-${options.stamp}.csv`);
  const annotationPath = path.join(options.out, `d1-annotation-skeleton-${options.stamp}.csv`);
  fs.writeFileSync(projectionPath, projectionCsv, 'utf8');
  fs.writeFileSync(samplePath, sampleCsv, 'utf8');
  fs.writeFileSync(annotationPath, annotationCsv, 'utf8');
  console.log('\n=== 离线文件 ===');
  console.log(`逐轮投影   ${projectionPath} (${turns.length} 行)`);
  console.log(`抽样清单   ${samplePath} (${items.length} 行)`);
  console.log(`标注骨架   ${annotationPath} (${items.length} 行, human_label 留空待人工填)`);

  if (options.labels) {
    if (!fs.existsSync(options.labels)) {
      console.error(`标注文件不存在: ${options.labels}`);
      process.exitCode = 1;
      return;
    }
    const labels = parseAnnotationLabels(fs.readFileSync(options.labels, 'utf8'));
    console.log(`\n读入人工标注 ${labels.size} 条 (来自 ${options.labels})`);
    printAgreement(computeLabelAgreement(turns, labels));
  } else {
    console.log('\n(未传 --labels: precision / recall 与两向漏判率待人工标注填入后重跑本脚本)');
  }
}

await main();
