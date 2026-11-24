// AF-471 · 逐轮延迟归因 CLI：只读 af466 已落盘产物，输出聚合 JSON 与终端摘要。
// 不新增模型调用、不落原文、不写业务库；所有数字可由 sessions/*.json 复算。

import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  bootstrapMedian,
  bootstrapQuantile,
  describeDistribution,
  extractSpeechRegisterBlock,
  linearRegression,
  mean,
  median,
  oddEvenP95RelativeDiff,
  pairedTurnDeltas,
  pearson,
  percentile,
  round,
  summarizeMode,
  summarizeRolePair,
  tailConcentration,
} from './latency-attribution.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../..');
const EVAL_ROOT = path.join(ROOT, 'data', 'eval-reports', 'visitor-register-stability');
const DEFAULT_RUN_ID = 'af466-2026-11-24-10roles';

function parseArgs(argv) {
  const options = { runId: DEFAULT_RUN_ID, compareRunId: '', out: '' };
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    const value = argv[index + 1];
    if (key === '--run-id') {
      options.runId = value;
      index += 1;
    } else if (key === '--compare-run-id') {
      options.compareRunId = value;
      index += 1;
    } else if (key === '--out') {
      options.out = value;
      index += 1;
    }
  }
  return options;
}

function readJson(file) {
  return JSON.parse(readFileSync(file, 'utf8'));
}

function loadRun(runId) {
  const runDir = path.join(EVAL_ROOT, runId);
  const manifest = readJson(path.join(runDir, 'manifest.json'));
  const sessionsDir = path.join(runDir, 'sessions');
  const roles = readdirSync(sessionsDir).filter((name) => name.startsWith('vpt_'));
  const order = new Map((manifest.order ?? []).map((item) => [item.role, item.modes]));
  const runStartedAt = Date.parse(manifest.startedAt ?? '');
  const turns = { base: [], active: [] };

  for (const role of roles) {
    for (const mode of ['base', 'active']) {
      const session = readJson(path.join(sessionsDir, role, `${mode}.json`));
      if (session.complete !== true || session.rows.length !== manifest.turnCount) {
        throw new Error(`${role}/${mode} 不完整：complete=${session.complete} rows=${session.rows.length}`);
      }
      for (const row of session.rows) {
        const usage = row.llmUsage ?? {};
        const wallMs = Number(row.wallMs ?? 0);
        const ttftMs = Number(usage.ttftMs ?? 0);
        const promptChars = String(row.promptFull ?? '').length;
        const cachedTokens = typeof usage.cachedTokens === 'number' && Number.isFinite(usage.cachedTokens) ? usage.cachedTokens : null;
        const block = extractSpeechRegisterBlock(row.promptFull);
        const ts = Date.parse(row.ts ?? session.startedAt ?? '');
        turns[mode].push({
          role,
          mode,
          turn: Number(row.turnIndex ?? 0),
          wallMs,
          ttftMs,
          postMs: Math.max(0, wallMs - ttftMs),
          promptTokens: Number(usage.promptTokens ?? 0),
          completionTokens: Number(usage.completionTokens ?? 0),
          cachedTokens,
          reasoningTokens: Number(usage.reasoningTokens ?? 0),
          promptChars,
          block,
          elapsedSec: Number.isFinite(ts) && Number.isFinite(runStartedAt) ? round((ts - runStartedAt) / 1000, 1) : 0,
        });
      }
    }
  }

  return { runId, runDir, manifest, roles: [...roles].sort(), order, turns };
}

function buildTurnBuckets(turns, rolePairs) {
  return [
    [1, 5],
    [6, 10],
    [11, 20],
    [21, 30],
  ].map(([from, to]) => {
    const bucket = (mode) => turns[mode].filter((turn) => turn.turn >= from && turn.turn <= to);
    const base = bucket('base');
    const active = bucket('active');
    const baseSummary = describeDistribution(base.map((turn) => turn.wallMs));
    const activeSummary = describeDistribution(active.map((turn) => turn.wallMs));
    const paired = rolePairs
      .flatMap((pair) => {
        const baseTurns = turns.base.filter((turn) => turn.role === pair.role && turn.turn >= from && turn.turn <= to);
        const activeTurns = turns.active.filter((turn) => turn.role === pair.role && turn.turn >= from && turn.turn <= to);
        return pairedTurnDeltas(baseTurns, activeTurns);
      })
      .map((item) => item.deltaMs);
    return {
      turns: `${from}-${to}`,
      base: { mean: baseSummary.mean, p50: baseSummary.p50, p95: baseSummary.p95 },
      active: { mean: activeSummary.mean, p50: activeSummary.p50, p95: activeSummary.p95 },
      p95Ratio: round(activeSummary.p95 / Math.max(1, baseSummary.p95), 3),
      pairedMedianDeltaMs: round(median(paired), 0),
      pairedActiveSlower: paired.filter((value) => value > 0).length,
      pairedN: paired.length,
    };
  });
}

function buildCorrelations(turns) {
  const out = {};
  for (const mode of ['base', 'active']) {
    const rows = turns[mode];
    out[mode] = {
      wallPromptTokens: round(
        pearson(
          rows.map((turn) => turn.promptTokens),
          rows.map((turn) => turn.wallMs),
        ),
        3,
      ),
      wallPromptChars: round(
        pearson(
          rows.map((turn) => turn.promptChars),
          rows.map((turn) => turn.wallMs),
        ),
        3,
      ),
      wallCompletionTokens: round(
        pearson(
          rows.map((turn) => turn.completionTokens),
          rows.map((turn) => turn.wallMs),
        ),
        3,
      ),
      wallTurn: round(
        pearson(
          rows.map((turn) => turn.turn),
          rows.map((turn) => turn.wallMs),
        ),
        3,
      ),
      wallElapsed: round(
        pearson(
          rows.map((turn) => turn.elapsedSec),
          rows.map((turn) => turn.wallMs),
        ),
        3,
      ),
      wallTtft: round(
        pearson(
          rows.map((turn) => turn.ttftMs),
          rows.map((turn) => turn.wallMs),
        ),
        3,
      ),
      postPromptTokens: round(
        pearson(
          rows.map((turn) => turn.promptTokens),
          rows.map((turn) => turn.postMs),
        ),
        3,
      ),
      postCompletionTokens: round(
        pearson(
          rows.map((turn) => turn.completionTokens),
          rows.map((turn) => turn.postMs),
        ),
        3,
      ),
      postElapsed: round(
        pearson(
          rows.map((turn) => turn.elapsedSec),
          rows.map((turn) => turn.postMs),
        ),
        3,
      ),
    };
  }
  return out;
}

function buildRegressions(turns) {
  const names = ['promptTokens', 'completionTokens', 'turn', 'elapsedSec'];
  const columns = (rows) => rows.map((turn) => [turn.promptTokens, turn.completionTokens, turn.turn, turn.elapsedSec]);
  const pooled = [...turns.base, ...turns.active];
  const pooledMainColumns = pooled.map((turn) => [
    turn.promptTokens,
    turn.completionTokens,
    turn.turn,
    turn.elapsedSec,
    turn.mode === 'active' ? 1 : 0,
  ]);
  const pooledInteractionColumns = pooled.map((turn) => [
    turn.promptTokens,
    turn.completionTokens,
    turn.turn,
    turn.elapsedSec,
    turn.mode === 'active' ? 1 : 0,
    turn.mode === 'active' ? turn.turn : 0,
  ]);
  return {
    base: linearRegression(
      columns(turns.base),
      turns.base.map((turn) => turn.wallMs),
      names,
    ),
    active: linearRegression(
      columns(turns.active),
      turns.active.map((turn) => turn.wallMs),
      names,
    ),
    pooledMain: linearRegression(
      pooledMainColumns,
      pooled.map((turn) => turn.wallMs),
      [...names, 'active'],
    ),
    pooledInteraction: linearRegression(
      pooledInteractionColumns,
      pooled.map((turn) => turn.wallMs),
      [...names, 'active', 'activeTurn'],
    ),
    basePost: linearRegression(
      columns(turns.base),
      turns.base.map((turn) => turn.postMs),
      names,
    ),
    activePost: linearRegression(
      columns(turns.active),
      turns.active.map((turn) => turn.postMs),
      names,
    ),
  };
}

function buildVariance(run, rolePairs) {
  const perSession = [];
  for (const role of run.roles) {
    for (const mode of ['base', 'active']) {
      const values = run.turns[mode].filter((turn) => turn.role === role).map((turn) => turn.wallMs);
      perSession.push({
        role,
        mode,
        p95: round(percentile(values, 0.95), 1),
        bootstrap: bootstrapQuantile(values, 0.95, { reps: 2000, seed: role.length + (mode === 'active' ? 11 : 1) }),
        oddEvenP95RelativeDiff: round(oddEvenP95RelativeDiff(values), 3),
      });
    }
  }
  const ratios = rolePairs.map((pair) => pair.ratios.p95);
  const ratioMedian = median(ratios);
  const ratioBootstrap = bootstrapMedian(ratios, { reps: 5000, seed: 471 });
  const leaveOneOut = rolePairs.map((pair) => {
    const remaining = rolePairs.filter((item) => item.role !== pair.role).map((item) => item.ratios.p95);
    return { dropped: pair.role, median: round(median(remaining), 3) };
  });
  const baseCv = mean(perSession.filter((item) => item.mode === 'base').map((item) => item.bootstrap.cv));
  const activeCv = mean(perSession.filter((item) => item.mode === 'active').map((item) => item.bootstrap.cv));
  const ratioCv = Math.sqrt(baseCv ** 2 + activeCv ** 2);
  const seOneRepeat = ratioCv / Math.sqrt(rolePairs.length);
  const repeatsForFivePct = Math.max(1, Math.ceil((ratioCv / 0.05) ** 2 / rolePairs.length));
  return {
    perSession,
    baseP95Cv: round(baseCv, 3),
    activeP95Cv: round(activeCv, 3),
    ratioCv: round(ratioCv, 3),
    ratioMedian: round(ratioMedian, 3),
    ratioMedianBootstrap: ratioBootstrap,
    leaveOneOutMedianRange: [
      round(Math.min(...leaveOneOut.map((item) => item.median)), 3),
      round(Math.max(...leaveOneOut.map((item) => item.median)), 3),
    ],
    seOneRepeat: round(seOneRepeat, 3),
    repeatsForFivePctSe: repeatsForFivePct,
    leaveOneOut,
  };
}

function buildCompareBase(runId, compareRunId) {
  if (!compareRunId) return null;
  const compareDir = path.join(EVAL_ROOT, compareRunId, 'sessions');
  const currentDir = path.join(EVAL_ROOT, runId, 'sessions');
  const currentRoles = readdirSync(currentDir).filter((name) => name.startsWith('vpt_'));
  const results = [];
  for (const role of currentRoles) {
    const compareFile = path.join(compareDir, role, 'base.json');
    try {
      const compare = readJson(compareFile);
      const current = readJson(path.join(currentDir, role, 'base.json'));
      if (compare.complete !== true || current.complete !== true) continue;
      const compareP95 = percentile(
        compare.rows.map((row) => Number(row.wallMs)),
        0.95,
      );
      const currentP95 = percentile(
        current.rows.map((row) => Number(row.wallMs)),
        0.95,
      );
      const compareTokens = mean(compare.rows.map((row) => Number(row.llmUsage?.promptTokens ?? 0)));
      const currentTokens = mean(current.rows.map((row) => Number(row.llmUsage?.promptTokens ?? 0)));
      results.push({
        role,
        compareP95: round(compareP95, 0),
        currentP95: round(currentP95, 0),
        ratio: round(currentP95 / Math.max(1, compareP95), 3),
        promptTokensRatio: round(currentTokens / Math.max(1, compareTokens), 3),
      });
    } catch {
      // 对比 run 没有该角色时跳过；不保证跨 run 覆盖完全一致。
    }
  }
  return results.length === 0
    ? null
    : {
        compareRunId,
        roles: results.length,
        medianP95Ratio: round(median(results.map((item) => item.ratio)), 3),
        minP95Ratio: round(Math.min(...results.map((item) => item.ratio)), 3),
        maxP95Ratio: round(Math.max(...results.map((item) => item.ratio)), 3),
        medianPromptTokensRatio: round(median(results.map((item) => item.promptTokensRatio)), 3),
        perRole: results,
      };
}

function buildVerdict(pooled, rolePairs, buckets, variance, regressions, compareBase) {
  const promptOverheadMedian = round(median(rolePairs.map((pair) => pair.active.promptChars / Math.max(1, pair.base.promptChars) - 1)), 3);
  const promptTokenDelta = mean(rolePairs.map((pair) => pair.active.promptTokens.mean - pair.base.promptTokens.mean));
  const promptDeltaMs = regressions.pooledMain.coefficients.promptTokens * promptTokenDelta;
  const p95GapMs = pooled.active.wall.p95 - pooled.base.wall.p95;
  const promptShareOfP95Gap = p95GapMs > 0 ? promptDeltaMs / p95GapMs : 0;
  const promptProportionalMs = pooled.base.wall.p95 * promptOverheadMedian;
  const promptProportionalShare = p95GapMs > 0 ? promptProportionalMs / p95GapMs : 0;
  const lateBucket = buckets[buckets.length - 1];
  const earlyBucket = buckets[0];
  const directionRoles = rolePairs.filter((pair) => pair.ratios.p95 > 1).length;
  const activeMedianRatio = median(rolePairs.map((pair) => pair.ratios.p95));
  return {
    promptOverheadMedian,
    promptTokenDeltaMean: round(promptTokenDelta, 0),
    promptDeltaMs: round(promptDeltaMs, 0),
    p95GapMs: round(p95GapMs, 0),
    promptShareOfP95Gap: round(promptShareOfP95Gap, 3),
    promptProportionalMs: round(promptProportionalMs, 0),
    promptProportionalShare: round(promptProportionalShare, 3),
    promptExplainsP95: promptProportionalShare >= 0.5,
    promptInsufficientForP95: promptProportionalShare < 0.5 && promptShareOfP95Gap < 0.25,
    ttftP95Ratio: round(pooled.active.ttft.p95 / Math.max(1, pooled.base.ttft.p95), 3),
    postP95Ratio: round(pooled.active.post.p95 / Math.max(1, pooled.base.post.p95), 3),
    postDominatesTtft:
      pooled.active.post.p95 / Math.max(1, pooled.base.post.p95) > pooled.active.ttft.p95 / Math.max(1, pooled.base.ttft.p95),
    earlyPairedMedianDeltaMs: earlyBucket.pairedMedianDeltaMs,
    latePairedMedianDeltaMs: lateBucket.pairedMedianDeltaMs,
    lateTurnConcentration: lateBucket.pairedMedianDeltaMs > earlyBucket.pairedMedianDeltaMs * 10,
    directionRoles,
    roleCount: rolePairs.length,
    activeMedianP95Ratio: round(activeMedianRatio, 3),
    p95BootstrapLow: variance.ratioMedianBootstrap.low,
    p95BootstrapHigh: variance.ratioMedianBootstrap.high,
    baseP95Cv: variance.baseP95Cv,
    activeP95Cv: variance.activeP95Cv,
    compareBaseMedianP95Ratio: compareBase?.medianP95Ratio ?? null,
    conclusion:
      promptShareOfP95Gap < 0.25 && lateBucket.pairedMedianDeltaMs > earlyBucket.pairedMedianDeltaMs * 10
        ? 'prompt_length_insufficient__late_turn_decode_or_run_condition'
        : 'prompt_length_partially_explains_or_insufficient_evidence',
  };
}

function buildReport(run, options) {
  const rolePairs = run.roles.map((role) => {
    const baseTurns = run.turns.base.filter((turn) => turn.role === role);
    const activeTurns = run.turns.active.filter((turn) => turn.role === role);
    return summarizeRolePair(role, baseTurns, activeTurns, (run.order.get(role) ?? []).join('>'));
  });
  const pooled = {
    base: summarizeMode(run.turns.base),
    active: summarizeMode(run.turns.active),
  };
  const baseP95 = pooled.base.wall.p95;
  const activeValues = run.turns.active.map((turn) => turn.wallMs);
  const baseValues = run.turns.base.map((turn) => turn.wallMs);
  const paired = rolePairs.flatMap((pair) => {
    const baseTurns = run.turns.base.filter((turn) => turn.role === pair.role);
    const activeTurns = run.turns.active.filter((turn) => turn.role === pair.role);
    return pairedTurnDeltas(baseTurns, activeTurns);
  });
  const variance = buildVariance(run, rolePairs);
  const regressions = buildRegressions(run.turns);
  const buckets = buildTurnBuckets(run.turns, rolePairs);
  const compareBase = buildCompareBase(options.runId, options.compareRunId);
  const verdict = buildVerdict(pooled, rolePairs, buckets, variance, regressions, compareBase);
  return {
    runId: run.runId,
    generatedAt: new Date().toISOString(),
    source: {
      runDir: path.relative(ROOT, run.runDir).replaceAll('\\', '/'),
      manifestGitHead: run.manifest.gitHead,
      model: run.manifest.model,
      scriptHash: run.manifest.counselorScriptHash,
      roles: run.roles.length,
      totalTurns: run.turns.base.length + run.turns.active.length,
    },
    pooled,
    rolePairs,
    turnBuckets: buckets,
    tail: {
      baseP95Ms: baseP95,
      activeAboveBaseP95: activeValues.filter((value) => value > baseP95).length,
      activeAboveBaseP95Share: round(activeValues.filter((value) => value > baseP95).length / activeValues.length, 3),
      baseTop5pctShare: tailConcentration(baseValues, pooled.base.wall.p50, 0.05).topShare,
      activeTop5pctShare: tailConcentration(activeValues, pooled.base.wall.p50, 0.05).topShare,
      baseTop10pctShare: tailConcentration(baseValues, pooled.base.wall.p50, 0.1).topShare,
      activeTop10pctShare: tailConcentration(activeValues, pooled.base.wall.p50, 0.1).topShare,
      pairedMedianDeltaMs: round(median(paired.map((item) => item.deltaMs)), 0),
      pairedP90DeltaMs: round(
        percentile(
          paired.map((item) => item.deltaMs),
          0.9,
        ),
        0,
      ),
      pairedActiveSlower: paired.filter((item) => item.deltaMs > 0).length,
      pairedN: paired.length,
    },
    correlations: buildCorrelations(run.turns),
    regressions,
    variance,
    compareBase,
    verdict,
    limits: [
      '只有一场每个角色/模式；p95 是 30 轮样本的高分位，单个 8s 慢轮即可显著抬高。',
      '产物没有服务端逐 chunk 时间戳、队列等待和 prompt cache 命中率，无法把 post-TTFT 拆成模型解码、流式传输和服务端后处理。',
      'base/active 顺序按 seed 随机但仍在同一时间窗内串行，绝对延迟会随时间漂移；本报告只用同期 base 作相对对照。',
      '未做新模型调用、未改生产 prompt、未放宽 cost/noHarm 门槛。',
    ],
  };
}

function printSummary(report) {
  const { pooled, verdict } = report;
  process.stdout.write(
    [
      `run=${report.runId} roles=${report.source.roles} turns=${report.source.totalTurns}`,
      `base wall p50/p95=${pooled.base.wall.p50}/${pooled.base.wall.p95}ms; active=${pooled.active.wall.p50}/${pooled.active.wall.p95}ms`,
      `pooled p95 ratio=${round(pooled.active.wall.p95 / pooled.base.wall.p95, 3)}; role median=${verdict.activeMedianP95Ratio}; bootstrap=${verdict.p95BootstrapLow}-${verdict.p95BootstrapHigh}`,
      `prompt chars median overhead=${round(verdict.promptOverheadMedian * 100, 2)}%; prompt tokens Δ=${verdict.promptTokenDeltaMean}; p95 gap explained by prompt: marginal=${round(verdict.promptShareOfP95Gap * 100, 1)}% / proportional=${round(verdict.promptProportionalShare * 100, 1)}%`,
      `ttft p95 ratio=${verdict.ttftP95Ratio}; post p95 ratio=${verdict.postP95Ratio}；first5 paired Δ=${verdict.earlyPairedMedianDeltaMs}ms；last10=${verdict.latePairedMedianDeltaMs}ms`,
      `roles active p95 higher=${verdict.directionRoles}/${verdict.roleCount}；p95 CV base/active=${verdict.baseP95Cv}/${verdict.activeP95Cv}`,
      `compare base median p95 ratio=${verdict.compareBaseMedianP95Ratio ?? 'n/a'}`,
      `verdict=${verdict.conclusion}`,
    ].join('\n') + '\n',
  );
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const run = loadRun(options.runId);
  const report = buildReport(run, options);
  const out = options.out || path.join(run.runDir, 'latency-attribution.json');
  mkdirSync(path.dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  printSummary(report);
  process.stdout.write(`report=${path.relative(ROOT, out).replaceAll('\\', '/')}\n`);
}

main();
