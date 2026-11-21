#!/usr/bin/env node
// V2026-11-21 建立 (AF-227 · R6-D 跨模型真人度评分 CLI):
//   职责: 同一批 packet 上跑 MiniMax 与豆包各两位评分员（T=0.1 / T=0.5），
//         输出模型内一致性、跨模型一致性、偏移与场景方向判定。
//
//   边界:
//     · 只读 debug-sessions，不启动服务、不写库、不跑新对练；
//     · 报告只含 packetId / 分数 / 计数 / token 统计，不含台词原文；
//     · 不把两个模型分数合并成单一临床总分；不做真人达标声明。

import { mkdirSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

import {
  analyzeCrossModel,
  CROSS_MODEL_THRESHOLDS,
  scoreSetFromRating,
  type CrossModelAnalysis,
  type PacketScoreSet,
} from './realism-cross-model-analysis.js';
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
} from '../src/auto-practice/metrics/visitor-realism-rating.js';

const DEFAULT_SOURCE = join('data', 'debug-sessions');
const DEFAULT_OUT = join('data', 'phase25-exit', 'af227-realism-cross-model');
const PROTOCOL_VERSION = 'ai-realism-cross-model-v1';

type RaterKey = 'minimax_t01' | 'minimax_t05' | 'doubao_t01' | 'doubao_t05';
const RATER_KEYS: readonly RaterKey[] = ['minimax_t01', 'doubao_t01', 'minimax_t05', 'doubao_t05'];

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
  provider: 'minimax' | 'doubao';
  model: string;
  thinking: RaterThinkingMode;
  temperature: number;
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

function writeReport(outDir: string, report: unknown, markdown: string): void {
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  writeFileSync(join(outDir, 'summary.md'), markdown, 'utf8');
}

function tableAgreementRows(analysis: CrossModelAnalysis): string[] {
  const rows = [
    '| 维度 |  MiniMax 模型内 κ | exact | ±1 | 豆包模型内 κ | exact | ±1 | 同温跨模型 κ（T=0.1） | exact | ±1 | 同温跨模型 κ（T=0.5） | exact | ±1 |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
  ];
  const cell = (item: { linearWeightedKappa: number | null; exactAgreement: number; withinOneAgreement: number }) =>
    `${item.linearWeightedKappa ?? 'null'} | ${item.exactAgreement} | ${item.withinOneAgreement}`;
  rows.push(
    `| 总体 | ${cell(analysis.agreement.intraMinimax.overall)} | ${cell(analysis.agreement.intraDoubao.overall)} | ${cell(analysis.agreement.crossPrimary.overall)} | ${cell(analysis.agreement.crossSecondary.overall)} |`,
  );
  for (const dimension of REALISM_DIMENSIONS) {
    rows.push(
      `| ${REALISM_DIMENSION_LABELS[dimension]} | ${cell(analysis.agreement.intraMinimax.dimensions[dimension])} | ${cell(analysis.agreement.intraDoubao.dimensions[dimension])} | ${cell(analysis.agreement.crossPrimary.dimensions[dimension])} | ${cell(analysis.agreement.crossSecondary.dimensions[dimension])} |`,
    );
  }
  return rows;
}

function tableDistributionRows(analysis: CrossModelAnalysis): string[] {
  const rows = ['| 维度 | MiniMax 均值 | 豆包均值 | 绝对差 |', '| --- | --- | --- | --- |'];
  rows.push(
    `| 总体 | ${analysis.distribution.minimax.overallMean ?? '—'} | ${analysis.distribution.doubao.overallMean ?? '—'} | ${analysis.absoluteDelta.meanOverall ?? '—'} |`,
  );
  for (const dimension of REALISM_DIMENSIONS) {
    rows.push(
      `| ${REALISM_DIMENSION_LABELS[dimension]} | ${analysis.distribution.minimax.dimensions[dimension] ?? '—'} | ${analysis.distribution.doubao.dimensions[dimension] ?? '—'} | ${analysis.absoluteDelta.meanDimensions[dimension] ?? '—'} |`,
    );
  }
  return rows;
}

function tableSceneRows(analysis: CrossModelAnalysis): string[] {
  const dims = REALISM_DIMENSIONS.map((dimension) => `${REALISM_DIMENSION_LABELS[dimension]} |`).join(' ');
  const rows = [`| 模型 | 场景 | n | 总体 | ${dims}`, '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |'];
  for (const model of ['minimax', 'doubao'] as const) {
    for (const scene of ['in_person', 'online_voice', 'online_text'] as const) {
      const slice = analysis.sceneSlices[model][scene];
      const cells = REALISM_DIMENSIONS.map((dimension) => `${slice.dimensions[dimension] ?? '—'} |`).join(' ');
      rows.push(`| ${model} | ${scene} | ${slice.n} | ${slice.overallMean ?? '—'} | ${cells}`);
    }
  }
  return rows;
}

function tablePacketRows(analysis: CrossModelAnalysis): string[] {
  const rows = [
    '| packetId | 场景 | MiniMax T=0.1 | MiniMax T=0.5 | 豆包 T=0.1 | 豆包 T=0.5 | 平均绝对差 |',
    '| --- | --- | --- | --- | --- | --- | --- |',
  ];
  for (const row of analysis.packetRows) {
    rows.push(
      `| ${row.packetId} | ${row.scene} | ${row.minimax.t01} | ${row.minimax.t05} | ${row.doubao.t01} | ${row.doubao.t05} | ${row.meanAbsDelta} |`,
    );
  }
  return rows;
}

function buildMarkdown(input: {
  readonly report: {
    readonly generatedAt: string;
    readonly source: string;
    readonly packetCount: number;
    readonly selectedPackets: number;
    readonly ratedPackets: number;
    readonly failedPackets: number;
    readonly analysis: CrossModelAnalysis;
    readonly models: Readonly<Record<'minimax' | 'doubao', { readonly model: string; readonly thinking: RaterThinkingMode }>>;
    readonly runtime: Readonly<Record<RaterKey, RuntimeStat>>;
  };
  readonly title: string;
}): string {
  const analysis = input.report.analysis;
  const limitations = [
    ...AI_REALISM_LIMITATIONS,
    '跨模型一致只证明评分尺子在两个模型上稳定，不等于评分结论符合临床真实。',
    '每个模型内的两位评分员共享同一模型权重；模型内一致性衡量提示词/温度噪声，不是独立真人双盲。',
    '豆包关闭 thinking 降低推理噪声与截断风险，但也可能压低复杂判断的区分度。',
    `本轮 n=${analysis.packetCount}，κ 的抽样误差较大；不据此扩样本或做临床达标声明。`,
  ];
  const runtimeRows = RATER_KEYS.map((key) => {
    const stat = input.report.runtime[key];
    return `| ${key} | ${stat.provider} | ${stat.model} | ${stat.thinking} | ${stat.temperature} | ${stat.packets} | ${stat.calls} | ${stat.reasoningTokens} | ${stat.truncations} | ${stat.parseRetries} |`;
  });
  const lines = [
    `# ${input.title}`,
    '',
    `- 协议版本：${PROTOCOL_VERSION}`,
    `- 状态：${AI_REALISM_STATUS}`,
    `- 声明：${AI_REALISM_DISCLAIMER}`,
    `- 生成时间：${input.report.generatedAt}`,
    `- 源：${input.report.source}`,
    `- packet：选中 ${input.report.selectedPackets}；完成 ${input.report.ratedPackets}；失败 ${input.report.failedPackets}`,
    `- 模型：MiniMax=${input.report.models.minimax.model}；豆包=${input.report.models.doubao.model}（thinking=${input.report.models.doubao.thinking}）`,
    `- 预登记阈值：跨模型总体 κ ≥ ${CROSS_MODEL_THRESHOLDS.overallKappa}；五维 within±1 ≥ ${CROSS_MODEL_THRESHOLDS.dimensionWithinOne}；总体绝对差均值 ≤ ${CROSS_MODEL_THRESHOLDS.overallMeanAbsDelta}；总体场景方向不得翻转。`,
    '',
    '## 判定',
    '',
    `- 结论：**${analysis.judgment.verdict}**`,
    `- 原因：${analysis.judgment.reasons.length === 0 ? '全部预登记阈值通过。' : analysis.judgment.reasons.join('；')}`,
    '',
    '## 一致性',
    '',
    ...tableAgreementRows(analysis),
    '',
    '## 分布与偏移',
    '',
    ...tableDistributionRows(analysis),
    '',
    '## 场景切片与方向',
    '',
    ...tableSceneRows(analysis),
    '',
    `- MiniMax 场景方向：online_voice - in_person = ${analysis.sceneDirection.minimax.onlineVoiceMinusInPerson ?? '—'}；online_text - in_person = ${analysis.sceneDirection.minimax.onlineTextMinusInPerson ?? '—'}`,
    `- 豆包场景方向：online_voice - in_person = ${analysis.sceneDirection.doubao.onlineVoiceMinusInPerson ?? '—'}；online_text - in_person = ${analysis.sceneDirection.doubao.onlineTextMinusInPerson ?? '—'}`,
    `- 翻转项：${analysis.sceneDirectionFlipped.length === 0 ? '无' : analysis.sceneDirectionFlipped.join('；')}`,
    '',
    '## 评分运行时',
    '',
    '| 评分员 | provider | model | thinking | T | packets | calls | reasoningTokens | truncations | parseRetries |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
    ...runtimeRows,
    '',
    '## 逐 packet 分数',
    '',
    ...tablePacketRows(analysis),
    '',
    '## 已知限制',
    '',
    ...limitations.map((item) => `- ${item}`),
    '',
    '> 本报告是 AI 代理预评审，不是真人督导结论；在真人双人盲标 + 仲裁完成前，不得作为临床质量达标的证据。',
  ];
  return `${lines.join('\n')}\n`;
}

async function main(): Promise<void> {
  const sourceDir = resolve(arg('--source', DEFAULT_SOURCE)!);
  const outDir = resolve(arg('--out', DEFAULT_OUT)!);
  const targetScored = Math.max(2, Math.floor(numberArg('--target-scored', 24)));
  const maxPackets = Math.max(targetScored, Math.floor(numberArg('--max-packets', targetScored * 2)));
  const maxMessages = Math.max(4, Math.floor(numberArg('--max-messages', 32)));
  const seed = Math.floor(numberArg('--seed', 20_261_121));
  const timeoutMs = Math.floor(numberArg('--timeout-ms', 180_000));
  const maxParseRetries = Math.max(0, Math.floor(numberArg('--max-parse-retries', 1)));
  const maxOutputTokens = Math.max(1000, Math.floor(numberArg('--max-output-tokens', 5000)));
  const primaryTemperature = numberArg('--primary-temp', 0.1);
  const secondaryTemperature = numberArg('--secondary-temp', 0.5);
  const doubaoThinkingRaw = arg('--doubao-thinking', 'disabled');
  if (doubaoThinkingRaw !== 'auto' && doubaoThinkingRaw !== 'disabled' && doubaoThinkingRaw !== 'enabled') {
    fail('--doubao-thinking 只能是 auto / disabled / enabled');
  }
  const doubaoThinking = doubaoThinkingRaw;
  const minimaxModel = arg('--minimax-model') ?? undefined;
  const doubaoModel = arg('--doubao-model') ?? undefined;
  const packetIdsRaw = arg('--packet-ids');
  const packetIds =
    packetIdsRaw === null
      ? null
      : packetIdsRaw
          .split(',')
          .map((id) => id.trim())
          .filter((id) => id.length > 0);
  const dryRun = process.argv.includes('--dry-run');

  const sessions = loadRealismSessions(sourceDir);
  const built = buildRealismBlindPackets(sessions, { maxPackets, seed, maxMessages });
  const selection: PacketFilterResult =
    packetIds === null ? { selected: built.packets, missing: [] } : filterPacketsByIds(built.packets, packetIds);
  const selectedPackets = selection.selected;
  if (selection.missing.length > 0) fail(`以下 packetId 未被本次盲评包收录：${selection.missing.join(',')}`);
  const sceneCounts = selectedPackets.reduce<Record<string, number>>((acc, packet) => {
    acc[packet.scene] = (acc[packet.scene] ?? 0) + 1;
    return acc;
  }, {});
  console.log(
    `[PACK] candidates=${built.candidateSessions} packets=${built.packets.length} selected=${selectedPackets.length} scenes=${JSON.stringify(sceneCounts)} excluded=${JSON.stringify(built.excluded)}`,
  );

  if (dryRun) {
    const sizes = selectedPackets.map((packet) => ({
      packetId: packet.packetId,
      scene: packet.scene,
      turns: packet.turns.length,
      chars: packet.turns.reduce((sum, turn) => sum + turn.text.length, 0),
    }));
    console.log(`[DRY] ${JSON.stringify(sizes)}`);
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
    doubao_t01: createRaterEndpoint(
      {
        provider: 'doubao',
        ...(doubaoModel === undefined ? {} : { model: doubaoModel }),
        temperature: primaryTemperature,
        thinking: doubaoThinking,
      },
      { timeoutMs },
    ),
    doubao_t05: createRaterEndpoint(
      {
        provider: 'doubao',
        ...(doubaoModel === undefined ? {} : { model: doubaoModel }),
        temperature: secondaryTemperature,
        thinking: doubaoThinking,
      },
      { timeoutMs },
    ),
  } as const;

  const runtime = Object.fromEntries(RATER_KEYS.map((key) => [key, emptyRuntimeStat(endpoints[key])])) as Record<RaterKey, RuntimeStat>;

  const rows: PacketScoreSet[] = [];
  const failed: { packetId: string; rater: RaterKey; stage: string; error: string }[] = [];
  let attempted = 0;
  for (const packet of selectedPackets) {
    if (rows.length >= targetScored) break;
    attempted += 1;
    console.log(`[PACKET] ${packet.packetId} scene=${packet.scene} turns=${packet.turns.length}`);
    let currentRater: RaterKey = RATER_KEYS[0];
    try {
      const attempts = {} as Record<RaterKey, Awaited<ReturnType<typeof ratePacketWithRater>>>;
      for (const key of RATER_KEYS) {
        currentRater = key;
        const result = await ratePacketWithRater({
          endpoint: endpoints[key],
          packet,
          raterId: raterIdFor(key),
          timeoutMs,
          maxParseRetries,
          maxOutputTokens,
        });
        attempts[key] = result;
        addCallStats(runtime[key], result);
        console.log(`[OK] ${packet.packetId} ${key} overall=${result.rating.overall} retries=${result.parseRetries}`);
      }
      rows.push({
        packetId: packet.packetId,
        scene: packet.scene,
        minimax: {
          t01: scoreSetFromRating(attempts.minimax_t01.rating),
          t05: scoreSetFromRating(attempts.minimax_t05.rating),
        },
        doubao: {
          t01: scoreSetFromRating(attempts.doubao_t01.rating),
          t05: scoreSetFromRating(attempts.doubao_t05.rating),
        },
      });
    } catch (error) {
      const failure = {
        packetId: packet.packetId,
        rater: currentRater,
        stage: 'rate',
        error: error instanceof Error ? error.message.slice(0, 160) : 'unknown',
      };
      failed.push(failure);
      console.error(`[FAIL] ${packet.packetId} 跨模型评分失败：${failure.error}`);
    }
  }

  const analysis = analyzeCrossModel(rows);
  const totalCalls = RATER_KEYS.reduce((sum, key) => sum + runtime[key].calls, 0);
  const truncatedCalls = RATER_KEYS.reduce((sum, key) => sum + runtime[key].truncations, 0);
  const doubaoReasoningTokens = runtime.doubao_t01.reasoningTokens + runtime.doubao_t05.reasoningTokens;
  const report = {
    version: PROTOCOL_VERSION,
    status: AI_REALISM_STATUS,
    disclaimer: AI_REALISM_DISCLAIMER,
    humanSupervision: false,
    clinicalAcceptanceEligible: false,
    generatedAt: new Date().toISOString(),
    source: relative(process.cwd(), sourceDir) || sourceDir,
    seed,
    packetIds: selectedPackets.map((packet) => packet.packetId),
    targetScored,
    targetMet: rows.length >= targetScored,
    candidatePackets: built.packets.length,
    selectedPackets: selectedPackets.length,
    packetCount: attempted,
    ratedPackets: rows.length,
    failedPackets: failed.length,
    models: {
      minimax: { model: endpoints.minimax_t01.model, thinking: 'auto' as const },
      doubao: { model: endpoints.doubao_t01.model, thinking: endpoints.doubao_t01.thinking },
    },
    temperatures: { primary: primaryTemperature, secondary: secondaryTemperature },
    maxOutputTokens,
    runtime: {
      totalCalls,
      truncatedCalls,
      doubaoReasoningTokens,
      byRater: runtime,
    },
    analysis,
    failed,
  };

  writeReport(
    outDir,
    report,
    buildMarkdown({
      report: {
        generatedAt: report.generatedAt,
        source: report.source,
        packetCount: report.packetCount,
        selectedPackets: report.selectedPackets,
        ratedPackets: report.ratedPackets,
        failedPackets: report.failedPackets,
        analysis,
        models: report.models,
        runtime,
      },
      title: 'AF-227 · R6-D MiniMax × 豆包跨模型真人度评分校验',
    }),
  );
  console.log(
    `[DONE] ${outDir} verdict=${analysis.judgment.verdict} packets=${rows.length} calls=${totalCalls} truncated=${truncatedCalls}`,
  );
  if (failed.length > 0 || rows.length < targetScored) process.exitCode = 1;
}

void main().catch((error: unknown) => {
  fail(error instanceof Error ? error.message : String(error));
});
