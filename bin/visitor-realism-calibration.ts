#!/usr/bin/env node
// V2026-11-21 建立 (AF-229 · R6-D2 AI 层面校准与 thinking 对照 CLI):
//   职责: 同一 48 packet 池上，24 个留出锚点拟合 MiniMax↔豆包仿射校准，
//         24 个 R6-D 评测 packet 独立复核；同时成对比较豆包 thinking disabled / auto。
//
//   边界:
//     · 只读 debug-sessions，不启动服务、不写库、不跑新对练；
//     · 报告只含 packetId / 分数 / 计数 / token 统计，不含台词原文；
//     · 不修改 R6-D 阈值、不放宽证据校验、不合并模型分数、不做真人达标声明。

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

import {
  CALIBRATION_THRESHOLDS,
  THINKING_THRESHOLDS,
  bootstrapCalibration,
  compareThinkingArms,
  evaluateCalibration,
  toPacketScoreSet,
  type BootstrapSummary,
  type CalibrationArm,
  type CalibrationEvaluation,
  type CalibrationRow,
  type ThinkingComparison,
} from './realism-calibration-analysis.js';
import { analyzeCrossModel, CROSS_MODEL_THRESHOLDS, scoreSetFromRating, type CrossModelAnalysis } from './realism-cross-model-analysis.js';
import { createRaterEndpoint, ratePacketWithRater, type RaterEndpoint, type RaterThinkingMode } from './realism-rater-runtime.js';
import { loadRealismSessions } from './realism-session-loader.js';
import { buildRealismBlindPackets } from '../src/auto-practice/metrics/visitor-realism-blind-pack.js';
import { filterPacketsByIds, type PacketFilterResult } from '../src/auto-practice/metrics/visitor-realism-packet-filter.js';
import {
  AI_REALISM_DISCLAIMER,
  AI_REALISM_LIMITATIONS,
  AI_REALISM_STATUS,
  REALISM_DIMENSION_LABELS,
  REALISM_DIMENSIONS,
  type RealismBlindPacket,
} from '../src/auto-practice/metrics/visitor-realism-rating.js';

const DEFAULT_SOURCE = join('data', 'debug-sessions');
const DEFAULT_OUT = join('data', 'phase25-exit', 'af229-ai-calibration-thinking');
const DEFAULT_EVAL_IDS = join('data', 'phase25-exit', 'af227-realism-cross-model', 'packet-ids.txt');
const PROTOCOL_VERSION = 'ai-realism-calibration-thinking-v1';
const PACKET_POOL = 48;
const GROUP_SIZE = 24;

type RaterKey = 'minimax_t01' | 'minimax_t05' | 'doubao_disabled_t01' | 'doubao_disabled_t05' | 'doubao_auto_t01' | 'doubao_auto_t05';
const RATER_KEYS: readonly RaterKey[] = [
  'minimax_t01',
  'minimax_t05',
  'doubao_disabled_t01',
  'doubao_disabled_t05',
  'doubao_auto_t01',
  'doubao_auto_t05',
];

function arg(name: string, fallback: string | null = null): string | null {
  const index = process.argv.indexOf(name);
  if (index === -1 || index + 1 >= process.argv.length) return fallback;
  return process.argv[index + 1];
}

function fail(message: string): never {
  console.error(`[FAIL] ${message}`);
  process.exit(1);
}

function numberArg(name: string, fallback: number): number {
  const value = arg(name);
  if (value === null) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) fail(`${name} 必须是数字`);
  return parsed;
}

function raterIdFor(key: RaterKey): 'R1' | 'R2' {
  return key.endsWith('_t01') ? 'R1' : 'R2';
}

interface RuntimeStat {
  readonly provider: 'minimax' | 'doubao';
  readonly model: string;
  readonly thinking: RaterThinkingMode;
  readonly temperature: number;
  calls: number;
  promptTokens: number;
  completionTokens: number;
  reasoningTokens: number;
  truncations: number;
  parseRetries: number;
  packets: number;
}

function emptyRuntimeStat(endpoint: RaterEndpoint): RuntimeStat {
  return {
    provider: endpoint.provider,
    model: endpoint.model,
    thinking: endpoint.thinking,
    temperature: endpoint.temperature,
    calls: 0,
    promptTokens: 0,
    completionTokens: 0,
    reasoningTokens: 0,
    truncations: 0,
    parseRetries: 0,
    packets: 0,
  };
}

function addCallStats(stat: RuntimeStat, attempt: Awaited<ReturnType<typeof ratePacketWithRater>>): void {
  stat.packets += 1;
  stat.parseRetries += attempt.parseRetries;
  for (const call of attempt.calls) {
    stat.calls += 1;
    stat.promptTokens += call.promptTokens;
    stat.completionTokens += call.completionTokens;
    stat.reasoningTokens += call.reasoningTokens;
    if (call.finishReason === 'length') stat.truncations += 1;
  }
}

function readIdFile(path: string): string[] {
  return readFileSync(path, 'utf8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function readEvalIds(path: string, expected: number): string[] {
  const ids = readIdFile(path);
  if (ids.length !== expected) fail(`评测集应为 ${expected} 个 packet，实际 ${ids.length}`);
  return ids;
}

function writeReport(outDir: string, report: unknown, markdown: string, sensitivity: string): void {
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  writeFileSync(join(outDir, 'summary.md'), markdown, 'utf8');
  writeFileSync(join(outDir, 'sensitivity.md'), sensitivity, 'utf8');
}

function tableRow(cells: readonly (string | number | null)[]): string {
  return `| ${cells.map((cell) => cell ?? '—').join(' | ')} |`;
}

function analysisTable(arm: CalibrationArm, evaluation: CalibrationEvaluation): string[] {
  const pre = evaluation.pre;
  const post = evaluation.post;
  const minWithin = (block: CrossModelAnalysis['agreement']['crossPrimary']) =>
    Math.min(...REALISM_DIMENSIONS.map((dimension) => block.dimensions[dimension].withinOneAgreement));
  return [
    tableRow([
      arm,
      'T=0.1',
      pre.absoluteDelta.primaryOverall ?? null,
      post.absoluteDelta.primaryOverall ?? null,
      pre.agreement.crossPrimary.overall.linearWeightedKappa ?? null,
      post.agreement.crossPrimary.overall.linearWeightedKappa ?? null,
      minWithin(post.agreement.crossPrimary),
      evaluation.preOverallStd,
      evaluation.postOverallStd,
      evaluation.discriminationRetention,
      evaluation.loo.overallMae,
      evaluation.judgment.verdict,
    ]),
    tableRow([
      arm,
      'T=0.5',
      pre.absoluteDelta.secondaryOverall ?? null,
      post.absoluteDelta.secondaryOverall ?? null,
      pre.agreement.crossSecondary.overall.linearWeightedKappa ?? null,
      post.agreement.crossSecondary.overall.linearWeightedKappa ?? null,
      minWithin(post.agreement.crossSecondary),
      evaluation.preOverallStd,
      evaluation.postOverallStd,
      evaluation.discriminationRetention,
      evaluation.loo.overallMae,
      evaluation.judgment.verdict,
    ]),
  ];
}

function fitTable(arm: CalibrationArm, evaluation: CalibrationEvaluation): string[] {
  const rows = [
    '| arm | 温度 | 维度 | slope | intercept | R2 | 锚点 MAE | 留一法 MAE |',
    '| --- | --- | --- | --- | --- | --- | --- | --- |',
  ];
  for (const slot of ['t01', 't05'] as const) {
    const fit = evaluation.fit.slots[slot];
    rows.push(
      tableRow([
        arm,
        slot === 't01' ? 'T=0.1' : 'T=0.5',
        '总体',
        fit.overall.slope,
        fit.overall.intercept,
        fit.overall.r2,
        fit.overall.mae,
        evaluation.loo.overallMae,
      ]),
    );
    for (const dimension of REALISM_DIMENSIONS) {
      const item = fit.dimensions[dimension];
      rows.push(
        tableRow([
          arm,
          slot === 't01' ? 'T=0.1' : 'T=0.5',
          REALISM_DIMENSION_LABELS[dimension],
          item.slope,
          item.intercept,
          item.r2,
          item.mae,
          evaluation.loo.dimensionMae[dimension],
        ]),
      );
    }
  }
  return rows;
}

function thinkingTable(thinking: ThinkingComparison): string[] {
  const row = (metrics: ThinkingComparison['disabled']) =>
    tableRow([
      metrics.arm,
      metrics.intraKappa ?? null,
      metrics.crossT01Kappa ?? null,
      metrics.crossT05Kappa ?? null,
      metrics.meanAbsDelta ?? null,
      metrics.crossT01Exact,
      metrics.crossT05Exact,
      metrics.overallMean ?? null,
      metrics.overallStd,
      metrics.overallUniqueValues,
      metrics.averageDimensionStd,
    ]);
  return [
    '| arm | 模型内 κ | 跨模型 κ（T=0.1） | 跨模型 κ（T=0.5） | 总体绝对差 | exact T=0.1 | exact T=0.5 | 总体均值 | 总体分标准差 | 唯一分值数 | 维度平均标准差 |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
    row(thinking.disabled),
    row(thinking.auto),
  ];
}

function bootstrapRows(label: string, arm: CalibrationArm, summary: BootstrapSummary): string[] {
  return [
    tableRow([
      label,
      arm,
      summary.meanAbsDeltaP025,
      summary.meanAbsDeltaP50,
      summary.meanAbsDeltaP975,
      summary.crossKappaP025,
      summary.crossKappaP50,
      summary.crossKappaP975,
    ]),
  ];
}

function sceneRows(arm: CalibrationArm, evaluation: CalibrationEvaluation): string[] {
  return [
    tableRow([
      arm,
      '校准前',
      evaluation.pre.sceneSlices.doubao.in_person.overallMean,
      evaluation.pre.sceneSlices.doubao.online_voice.overallMean,
      evaluation.pre.sceneSlices.doubao.online_text.overallMean,
    ]),
    tableRow([
      arm,
      '校准后',
      evaluation.post.sceneSlices.doubao.in_person.overallMean,
      evaluation.post.sceneSlices.doubao.online_voice.overallMean,
      evaluation.post.sceneSlices.doubao.online_text.overallMean,
    ]),
  ];
}

function buildMarkdown(input: {
  readonly generatedAt: string;
  readonly source: string;
  readonly evalIds: readonly string[];
  readonly anchorIds: readonly string[];
  readonly evalN: number;
  readonly anchorN: number;
  readonly ratedPackets: number;
  readonly failedPackets: number;
  readonly calibration: Readonly<Record<CalibrationArm, CalibrationEvaluation>>;
  readonly raw: Readonly<Record<CalibrationArm, CrossModelAnalysis>>;
  readonly thinking: ThinkingComparison;
  readonly bootstrap: Readonly<Record<CalibrationArm, BootstrapSummary>>;
  readonly aiLevel: {
    readonly status: 'pass' | 'conditional' | 'fail';
    readonly preferredArm: CalibrationArm;
    readonly reasons: readonly string[];
  };
  readonly runtime: Readonly<Record<RaterKey, RuntimeStat>>;
  readonly totalCalls: number;
  readonly truncatedCalls: number;
}): string {
  const lines = [
    '# AF-229 · R6-D2 AI 层面锚点校准与豆包 thinking 对照',
    '',
    `- 协议版本：${PROTOCOL_VERSION}`,
    `- 状态：${AI_REALISM_STATUS}`,
    `- 声明：${AI_REALISM_DISCLAIMER}`,
    `- 生成时间：${input.generatedAt}`,
    `- 源：${input.source}`,
    `- 评分：完成 ${input.ratedPackets} / 48 packet；失败 ${input.failedPackets}；总调用 ${input.totalCalls}；截断 ${input.truncatedCalls}`,
    `- 留出锚点：${input.anchorN} packet（${input.anchorIds.join(', ')}）`,
    `- 评测集：${input.evalN} packet（${input.evalIds.join(', ')}）`,
    `- 校准判据：校准后总体绝对差 ≤ ${CALIBRATION_THRESHOLDS.overallMeanAbsDelta}；跨模型 κ ≥ ${CALIBRATION_THRESHOLDS.overallKappa}；五维 within±1 ≥ ${CALIBRATION_THRESHOLDS.dimensionWithinOne}；锚点留一法 MAE ≤ ${CALIBRATION_THRESHOLDS.looMeanAbsError}；总体校准斜率 ∈ [${CALIBRATION_THRESHOLDS.minOverallSlope}, ${CALIBRATION_THRESHOLDS.maxOverallSlope}]；区分度保留 ≥ ${CALIBRATION_THRESHOLDS.minDiscriminationRetention}；场景方向不得翻转。`,
    `- thinking 建议判据：auto 跨模型 κ 两温度均 ≥ ${THINKING_THRESHOLDS.crossKappa}；总体绝对差 ≤ ${THINKING_THRESHOLDS.maxMeanAbsDelta}；总体分标准差提升 ≥ ${THINKING_THRESHOLDS.discriminationGain} 才建议 auto。`,
    '',
    '## AI 层面结论',
    '',
    `- 状态：**${input.aiLevel.status}**`,
    `- 建议评分档：**${input.aiLevel.preferredArm}**`,
    `- 原因：${input.aiLevel.reasons.length === 0 ? '校准后尺子对齐判据全部通过。' : input.aiLevel.reasons.join('；')}`,
    '',
    '> 这里的 pass 只表示同一批 packet 上 MiniMax 与豆包经过锚点校准后尺子对齐，且 thinking 档位有可复算建议；不代表临床真实度达标。真人督导师双标仍待真实上线阶段补做。',
    '',
    '## 校准前后对照',
    '',
    '| arm | 温度 | 校准前绝对差 | 校准后绝对差 | 校准前 κ | 校准后 κ | 校准后最低 within±1 | 校准前 std | 校准后 std | 区分度保留 | 留一法 MAE | 判定 |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
    ...analysisTable('disabled', input.calibration.disabled),
    ...analysisTable('auto', input.calibration.auto),
    '',
    '## 校准参数与锚点稳定性',
    '',
    ...fitTable('disabled', input.calibration.disabled),
    ...fitTable('auto', input.calibration.auto),
    '',
    '## 豆包 thinking 对照',
    '',
    ...thinkingTable(input.thinking),
    '',
    `- 区分度差值（auto - disabled）：总体分标准差 ${input.thinking.discriminationDelta}`,
    `- 建议：**${input.thinking.recommendation}**`,
    `- 原因：${input.thinking.reasons.join('；') || '未触发建议条件。'}`,
    '',
    '## 校准后场景均值',
    '',
    '| arm | 时点 | 面对面 | 线上语音 | 线上文字 |',
    '| --- | --- | --- | --- | --- |',
    ...sceneRows('disabled', input.calibration.disabled),
    ...sceneRows('auto', input.calibration.auto),
    '',
    '## Bootstrap 95% 区间（固定锚点校准参数，重采样评测 packet）',
    '',
    '| arm | 指标 | 绝对差 P2.5 | 绝对差 P50 | 绝对差 P97.5 | κ P2.5 | κ P50 | κ P97.5 |',
    '| --- | --- | --- | --- | --- | --- | --- | --- |',
    ...bootstrapRows('校准后 disabled', 'disabled', input.bootstrap.disabled),
    ...bootstrapRows('校准后 auto', 'auto', input.bootstrap.auto),
    '',
    '## 评分运行时',
    '',
    '| 评分员 | provider | model | thinking | T | packets | calls | reasoningTokens | truncations | parseRetries |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
    ...RATER_KEYS.map((key) => {
      const stat = input.runtime[key];
      return tableRow([
        key,
        stat.provider,
        stat.model,
        stat.thinking,
        stat.temperature,
        stat.packets,
        stat.calls,
        stat.reasoningTokens,
        stat.truncations,
        stat.parseRetries,
      ]);
    }),
    '',
    '## 已知限制',
    '',
    ...[
      ...AI_REALISM_LIMITATIONS,
      '锚点校准只对齐两个 AI 评分尺子的零点与斜率，不提供临床真值锚点；校准后低绝对差不能被解读为临床准确。',
      '24 个留出锚点仍来自同一批 debug-sessions 与同一场景构成，不能代表全部线上人群。',
      '豆包 thinking auto 的推理 token 会增加延迟与截断风险；本报告按实际调用记录 token 与截断数。',
      'MiniMax 解析自愈仍使用固定回退温度 0.2，个别 T=0.5 评分存在槽位偏离。',
      '未做真人督导师双标与仲裁，humanSupervision=false、clinicalAcceptanceEligible=false。',
    ].map((item) => `- ${item}`),
    '',
    '> 本报告是 AI 代理预评审，不是真人督导结论；在真人双人盲标 + 仲裁完成前，不得作为临床质量达标的证据。',
  ];
  return `${lines.join('\n')}\n`;
}

function buildSensitivity(input: {
  readonly calibration: Readonly<Record<CalibrationArm, CalibrationEvaluation>>;
  readonly bootstrap: Readonly<Record<CalibrationArm, BootstrapSummary>>;
}): string {
  const lines = [
    '# AF-229 · 校准与 thinking 对照敏感性',
    '',
    '## 锚点留一法',
    '',
    '| arm | 留一法总体 MAE | RMSE | 最大绝对误差 | slope 范围 | intercept 范围 | 区分度保留 | 五维 MAE |',
    '| --- | --- | --- | --- | --- | --- | --- | --- |',
  ];
  for (const arm of ['disabled', 'auto'] as const) {
    const loo = input.calibration[arm].loo;
    lines.push(
      tableRow([
        arm,
        loo.overallMae,
        loo.overallRmse,
        loo.overallMaxAbsError,
        `${loo.slopeMin} ~ ${loo.slopeMax}`,
        `${loo.interceptMin} ~ ${loo.interceptMax}`,
        input.calibration[arm].discriminationRetention,
        REALISM_DIMENSIONS.map((dimension) => `${dimension}=${loo.dimensionMae[dimension]}`).join('；'),
      ]),
    );
  }
  lines.push(
    '',
    '## Bootstrap',
    '',
    '| arm | 绝对差 P2.5 | 绝对差 P50 | 绝对差 P97.5 | κ P2.5 | κ P50 | κ P97.5 | iterations |',
    '| --- | --- | --- | --- | --- | --- | --- | --- |',
  );
  for (const arm of ['disabled', 'auto'] as const) {
    const item = input.bootstrap[arm];
    lines.push(
      tableRow([
        arm,
        item.meanAbsDeltaP025,
        item.meanAbsDeltaP50,
        item.meanAbsDeltaP975,
        item.crossKappaP025,
        item.crossKappaP50,
        item.crossKappaP975,
        item.iterations,
      ]),
    );
  }
  lines.push(
    '',
    '## 读法',
    '',
    '- 留一法看的是 24 个锚点拟合是否稳定；评测集绝对差看的是校准在独立 packet 上是否真的把零点拉回来了。',
    '- Bootstrap 固定锚点校准参数，只重采样评测 packet，因此衡量的是评测集抽样不确定性，不是锚点不确定性。',
    '- 若校准后绝对差区间上界仍高于 0.3，说明 24 个评测 packet 还不足以支持扩大样本；若区间整体落在 0.3 以下，才具备进入扩样本讨论的条件。',
    '- thinking auto 的区分度提升必须与跨模型一致性同时看；单看标准差变大不等于评分更准。',
  );
  return `${lines.join('\n')}\n`;
}

function aiLevel(
  calibration: Readonly<Record<CalibrationArm, CalibrationEvaluation>>,
  thinking: ThinkingComparison,
): { status: 'pass' | 'conditional' | 'fail'; preferredArm: CalibrationArm; reasons: string[] } {
  const preferredArm: CalibrationArm = thinking.recommendation === 'prefer-auto' ? 'auto' : 'disabled';
  const preferred = calibration[preferredArm];
  const reasons = [...preferred.judgment.reasons];
  if (thinking.recommendation !== 'prefer-auto') {
    reasons.push(`thinking 建议 ${thinking.recommendation}`);
  }
  return { status: preferred.judgment.verdict, preferredArm, reasons };
}

interface RateGroupsInput {
  readonly groups: readonly { readonly split: 'eval' | 'anchor'; readonly packets: readonly RealismBlindPacket[] }[];
  readonly endpoints: Readonly<Record<RaterKey, RaterEndpoint>>;
  readonly timeoutMs: number;
  readonly maxParseRetries: number;
  readonly maxPacketRetries: number;
  readonly maxOutputTokens: number;
}

interface RateFailure {
  readonly packetId: string;
  readonly rater: RaterKey;
  readonly stage: string;
  readonly error: string;
}

interface RateGroupsResult {
  readonly runtime: Record<RaterKey, RuntimeStat>;
  readonly rows: CalibrationRow[];
  readonly failed: RateFailure[];
}

interface PacketRating {
  readonly row: CalibrationRow;
  readonly attempts: Record<RaterKey, Awaited<ReturnType<typeof ratePacketWithRater>>>;
}

async function ratePacketAllArms(input: RateGroupsInput, packet: RealismBlindPacket, split: 'eval' | 'anchor'): Promise<PacketRating> {
  const settled = await Promise.allSettled(
    RATER_KEYS.map(async (key) => {
      try {
        return await ratePacketWithRater({
          endpoint: input.endpoints[key],
          packet,
          raterId: raterIdFor(key),
          timeoutMs: input.timeoutMs,
          maxParseRetries: input.maxParseRetries,
          maxOutputTokens: input.maxOutputTokens,
        });
      } catch (error) {
        throw Object.assign(new Error(error instanceof Error ? error.message : 'unknown'), { raterKey: key });
      }
    }),
  );
  const attempts = {} as Record<RaterKey, Awaited<ReturnType<typeof ratePacketWithRater>>>;
  for (const [index, entry] of settled.entries()) {
    if (entry.status === 'rejected') throw entry.reason;
    attempts[RATER_KEYS[index]] = entry.value;
  }
  return {
    attempts,
    row: {
      packetId: packet.packetId,
      scene: packet.scene,
      split,
      minimax: {
        t01: scoreSetFromRating(attempts.minimax_t01.rating),
        t05: scoreSetFromRating(attempts.minimax_t05.rating),
      },
      doubao: {
        disabled: {
          t01: scoreSetFromRating(attempts.doubao_disabled_t01.rating),
          t05: scoreSetFromRating(attempts.doubao_disabled_t05.rating),
        },
        auto: {
          t01: scoreSetFromRating(attempts.doubao_auto_t01.rating),
          t05: scoreSetFromRating(attempts.doubao_auto_t05.rating),
        },
      },
    },
  };
}

async function ratePacketWithRetries(
  input: RateGroupsInput,
  runtime: Record<RaterKey, RuntimeStat>,
  packet: RealismBlindPacket,
  split: 'eval' | 'anchor',
): Promise<PacketRating | RateFailure> {
  let lastFailure: RateFailure | null = null;
  for (let attempt = 0; attempt <= input.maxPacketRetries; attempt += 1) {
    try {
      const rating = await ratePacketAllArms(input, packet, split);
      for (const key of RATER_KEYS) {
        addCallStats(runtime[key], rating.attempts[key]);
        console.log(
          `[OK] ${packet.packetId} ${split} ${key} overall=${rating.attempts[key].rating.overall} retries=${rating.attempts[key].parseRetries}`,
        );
      }
      return rating;
    } catch (error) {
      const raterKey = (error as { raterKey?: RaterKey }).raterKey ?? RATER_KEYS[0];
      lastFailure = {
        packetId: packet.packetId,
        rater: raterKey,
        stage: 'rate',
        error: error instanceof Error ? error.message.slice(0, 160) : 'unknown',
      };
      if (attempt < input.maxPacketRetries) {
        console.warn(`[WARN] ${packet.packetId} ${split} 第 ${attempt + 1} 次评分失败（${raterKey}: ${lastFailure.error}），重试整包`);
      }
    }
  }
  return lastFailure!;
}

async function rateGroups(input: RateGroupsInput): Promise<RateGroupsResult> {
  const runtime = Object.fromEntries(RATER_KEYS.map((key) => [key, emptyRuntimeStat(input.endpoints[key])])) as Record<
    RaterKey,
    RuntimeStat
  >;
  const rows: CalibrationRow[] = [];
  const failed: RateFailure[] = [];

  for (const group of input.groups) {
    for (const packet of group.packets) {
      console.log(`[PACKET] ${packet.packetId} split=${group.split} scene=${packet.scene} turns=${packet.turns.length}`);
      const result = await ratePacketWithRetries(input, runtime, packet, group.split);
      if ('row' in result) {
        rows.push(result.row);
      } else {
        failed.push(result);
        console.error(`[FAIL] ${packet.packetId} split=${group.split} 评分失败：${result.error}`);
      }
    }
  }

  return { runtime, rows, failed };
}

async function main(): Promise<void> {
  const sourceDir = resolve(arg('--source', DEFAULT_SOURCE)!);
  const outDir = resolve(arg('--out', DEFAULT_OUT)!);
  const evalIdsFile = resolve(arg('--eval-ids-file', DEFAULT_EVAL_IDS)!);
  const seed = Math.floor(numberArg('--seed', 20_261_121));
  const maxMessages = Math.max(4, Math.floor(numberArg('--max-messages', 32)));
  const targetEval = Math.floor(numberArg('--target-eval', GROUP_SIZE));
  const targetAnchor = Math.floor(numberArg('--target-anchor', GROUP_SIZE));
  const timeoutMs = Math.floor(numberArg('--timeout-ms', 180_000));
  const maxParseRetries = Math.max(0, Math.floor(numberArg('--max-parse-retries', 1)));
  const maxPacketRetries = Math.max(0, Math.floor(numberArg('--max-packet-retries', 2)));
  const maxOutputTokens = Math.max(1000, Math.floor(numberArg('--max-output-tokens', 8000)));
  const primaryTemperature = numberArg('--primary-temp', 0.1);
  const secondaryTemperature = numberArg('--secondary-temp', 0.5);
  const minimaxModel = arg('--minimax-model') ?? undefined;
  const doubaoModel = arg('--doubao-model') ?? undefined;
  const dryRun = process.argv.includes('--dry-run');

  const evalIds = readEvalIds(evalIdsFile, targetEval);
  if (targetAnchor !== GROUP_SIZE) fail(`留出锚点固定为 ${GROUP_SIZE} 个，当前参数 ${targetAnchor}`);

  const sessions = loadRealismSessions(sourceDir);
  const built = buildRealismBlindPackets(sessions, { maxPackets: PACKET_POOL, seed, maxMessages });
  const selection: PacketFilterResult = filterPacketsByIds(built.packets, evalIds);
  if (selection.missing.length > 0) fail(`以下评测 packetId 未被 48 池收录：${selection.missing.join(',')}`);
  const evalPackets = selection.selected;
  const anchorPackets = built.packets.filter((packet) => !evalIds.includes(packet.packetId));
  if (anchorPackets.length !== targetAnchor) fail(`留出锚点应为 ${targetAnchor} 个，实际 ${anchorPackets.length}`);

  const sceneCounts = (packets: readonly { readonly scene: string }[]) =>
    packets.reduce<Record<string, number>>((acc, packet) => {
      acc[packet.scene] = (acc[packet.scene] ?? 0) + 1;
      return acc;
    }, {});
  console.log(
    `[PLAN] candidates=${built.candidateSessions} pool=${built.packets.length} eval=${evalPackets.length} anchor=${anchorPackets.length} evalScenes=${JSON.stringify(sceneCounts(evalPackets))} anchorScenes=${JSON.stringify(sceneCounts(anchorPackets))}`,
  );

  if (dryRun) {
    console.log(`[DRY] eval=${JSON.stringify(evalPackets.map((packet) => packet.packetId))}`);
    console.log(`[DRY] anchor=${JSON.stringify(anchorPackets.map((packet) => packet.packetId))}`);
    return;
  }

  const endpoints = {
    minimax_t01: createRaterEndpoint(
      { provider: 'minimax', ...(minimaxModel === undefined ? {} : { model: minimaxModel }), temperature: primaryTemperature },
      { timeoutMs },
    ),
    minimax_t05: createRaterEndpoint(
      { provider: 'minimax', ...(minimaxModel === undefined ? {} : { model: minimaxModel }), temperature: secondaryTemperature },
      { timeoutMs },
    ),
    doubao_disabled_t01: createRaterEndpoint(
      {
        provider: 'doubao',
        ...(doubaoModel === undefined ? {} : { model: doubaoModel }),
        temperature: primaryTemperature,
        thinking: 'disabled',
      },
      { timeoutMs },
    ),
    doubao_disabled_t05: createRaterEndpoint(
      {
        provider: 'doubao',
        ...(doubaoModel === undefined ? {} : { model: doubaoModel }),
        temperature: secondaryTemperature,
        thinking: 'disabled',
      },
      { timeoutMs },
    ),
    doubao_auto_t01: createRaterEndpoint(
      {
        provider: 'doubao',
        ...(doubaoModel === undefined ? {} : { model: doubaoModel }),
        temperature: primaryTemperature,
        thinking: 'auto',
      },
      { timeoutMs },
    ),
    doubao_auto_t05: createRaterEndpoint(
      {
        provider: 'doubao',
        ...(doubaoModel === undefined ? {} : { model: doubaoModel }),
        temperature: secondaryTemperature,
        thinking: 'auto',
      },
      { timeoutMs },
    ),
  } as const;

  const groups = [
    { split: 'eval' as const, packets: evalPackets },
    { split: 'anchor' as const, packets: anchorPackets },
  ];
  const { runtime, rows, failed } = await rateGroups({
    groups,
    endpoints,
    timeoutMs,
    maxParseRetries,
    maxPacketRetries,
    maxOutputTokens,
  });

  const evalRows = rows.filter((row) => row.split === 'eval');
  const anchorRows = rows.filter((row) => row.split === 'anchor');
  if (evalRows.length < 2 || anchorRows.length < 3) fail(`有效行不足：eval=${evalRows.length} anchor=${anchorRows.length}`);

  const raw = {
    disabled: analyzeCrossModel(toPacketScoreSet(evalRows, 'disabled')),
    auto: analyzeCrossModel(toPacketScoreSet(evalRows, 'auto')),
  };
  const calibration = {
    disabled: evaluateCalibration(anchorRows, evalRows, 'disabled'),
    auto: evaluateCalibration(anchorRows, evalRows, 'auto'),
  };
  const bootstrap = {
    disabled: bootstrapCalibration(evalRows, calibration.disabled.fit),
    auto: bootstrapCalibration(evalRows, calibration.auto.fit),
  };
  const thinking = compareThinkingArms(raw.disabled, raw.auto, evalRows);
  const ai = aiLevel(calibration, thinking);

  const totalCalls = RATER_KEYS.reduce((sum, key) => sum + runtime[key].calls, 0);
  const truncatedCalls = RATER_KEYS.reduce((sum, key) => sum + runtime[key].truncations, 0);
  const report = {
    version: PROTOCOL_VERSION,
    status: AI_REALISM_STATUS,
    disclaimer: AI_REALISM_DISCLAIMER,
    humanSupervision: false,
    clinicalAcceptanceEligible: false,
    generatedAt: new Date().toISOString(),
    source: relative(process.cwd(), sourceDir) || sourceDir,
    seed,
    poolPackets: built.packets.length,
    evalIds,
    anchorIds: anchorPackets.map((packet) => packet.packetId),
    packetCount: rows.length,
    ratedPackets: rows.length,
    failedPackets: failed.length,
    models: {
      minimax: { model: endpoints.minimax_t01.model, thinking: 'auto' as const },
      doubao: { model: endpoints.doubao_disabled_t01.model },
    },
    temperatures: { primary: primaryTemperature, secondary: secondaryTemperature },
    maxOutputTokens,
    thresholds: {
      calibration: CALIBRATION_THRESHOLDS,
      thinking: THINKING_THRESHOLDS,
      crossModel: CROSS_MODEL_THRESHOLDS,
    },
    runtime: {
      totalCalls,
      truncatedCalls,
      doubaoDisabledReasoningTokens: runtime.doubao_disabled_t01.reasoningTokens + runtime.doubao_disabled_t05.reasoningTokens,
      doubaoAutoReasoningTokens: runtime.doubao_auto_t01.reasoningTokens + runtime.doubao_auto_t05.reasoningTokens,
      byRater: runtime,
    },
    analysis: {
      raw,
      calibration,
      bootstrap,
      thinking,
      aiLevel: ai,
    },
    ratings: rows,
    failed,
  };

  writeReport(
    outDir,
    report,
    buildMarkdown({
      generatedAt: report.generatedAt,
      source: report.source,
      evalIds: report.evalIds,
      anchorIds: report.anchorIds,
      evalN: evalRows.length,
      anchorN: anchorRows.length,
      ratedPackets: rows.length,
      failedPackets: failed.length,
      calibration,
      raw,
      thinking,
      bootstrap,
      aiLevel: ai,
      runtime,
      totalCalls,
      truncatedCalls,
    }),
    buildSensitivity({ calibration, bootstrap }),
  );
  writeFileSync(join(outDir, 'eval-ids.txt'), `${evalIds.join('\n')}\n`, 'utf8');
  writeFileSync(join(outDir, 'anchor-ids.txt'), `${anchorPackets.map((packet) => packet.packetId).join('\n')}\n`, 'utf8');
  console.log(
    `[DONE] ${outDir} ai=${ai.status} preferred=${ai.preferredArm} eval=${evalRows.length} anchor=${anchorRows.length} calls=${totalCalls} truncated=${truncatedCalls}`,
  );
  if (failed.length > 0 || rows.length < PACKET_POOL) process.exitCode = 1;
}

void main().catch((error: unknown) => {
  fail(error instanceof Error ? error.message : String(error));
});
