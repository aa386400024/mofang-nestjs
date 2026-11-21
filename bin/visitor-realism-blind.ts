#!/usr/bin/env node
// V2026-11-21 建立 (AF-214 · R5 AI 双盲真人度评测 CLI):
//   职责: 离线读取 debug-sessions，构造去身份盲评包，调用两个 AI 评分员与仲裁，
//         产出可复算的一致性与场景切片报告。
//
//   边界:
//     · 不启动/重启任何服务，不写数据库，不跑新对练；
//     · 报告与日志不输出台词原文，只输出 packetId / 分数 / 计数；
//     · 没有 API key 时只能 dry-run，显式报错，不伪造分数；
//     · 明确标注 AI 代理，不是真人督导，不写临床达标。

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { buildRealismBlindPackets } from '../src/auto-practice/metrics/visitor-realism-blind-pack.js';
import { filterPacketsByIds } from '../src/auto-practice/metrics/visitor-realism-packet-filter.js';
import {
  AI_REALISM_DISCLAIMER,
  AI_REALISM_LIMITATIONS,
  AI_REALISM_STATUS,
  AI_REALISM_VERSION,
  REALISM_DIMENSION_LABELS,
  REALISM_DIMENSIONS,
  buildRealismArbiterPrompt,
  buildRealismRaterCompactPrompt,
  buildRealismRaterPrompt,
  findRealismDisputes,
  mergeRealismRating,
  parseRealismArbitration,
  parseRealismRating,
  summarizeRealismAgreement,
  type RealismArbitrationDecision,
  type RealismBlindPacket,
  type RealismDimension,
  type RealismRating,
} from '../src/auto-practice/metrics/visitor-realism-rating.js';
import { MinimaxChatProvider } from '../src/llm/providers/minimax.provider.js';
import type { RealismScene } from '../src/shared/realism/turn-shape-selector.js';

const DEFAULT_SOURCE = join('data', 'debug-sessions');
const DEFAULT_OUT = join('data', 'phase25-exit', 'af214-realism-ai-double-blind');

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

function round(value: number, digits = 6): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function average(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  return round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

interface LoadedSession {
  readonly sessionId: string;
  readonly scene?: RealismScene;
  readonly prompt?: string | null;
  readonly messages: readonly { readonly role: 'counselor' | 'visitor'; readonly text: string }[];
}

function normalizeRole(raw: unknown): 'counselor' | 'visitor' | null {
  if (typeof raw !== 'string') return null;
  if (['visitor', 'client', '来访者', '来访'].includes(raw)) return 'visitor';
  if (['counselor', 'therapist', '咨询师', '咨询者'].includes(raw)) return 'counselor';
  return null;
}

function loadSessions(dir: string): readonly LoadedSession[] {
  if (!existsSync(dir)) fail(`源目录不存在：${dir}`);
  const files = readdirSync(dir).filter((file) => file.endsWith('.json'));
  const sessions: LoadedSession[] = [];
  for (const file of files) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(join(dir, file), 'utf8'));
    } catch {
      continue;
    }
    if (typeof parsed !== 'object' || parsed === null) continue;
    const root = parsed as Record<string, unknown>;
    const messagesRaw = root['messages'];
    if (!Array.isArray(messagesRaw)) continue;
    const messages: { role: 'counselor' | 'visitor'; text: string }[] = [];
    for (const item of messagesRaw) {
      if (typeof item !== 'object' || item === null) continue;
      const record = item as Record<string, unknown>;
      const role = normalizeRole(record['role']);
      const text = typeof record['text'] === 'string' ? record['text'] : '';
      if (role === null || text.trim().length === 0) continue;
      messages.push({ role, text });
    }
    const sceneRaw = root['scene'] ?? root['realismScene'];
    const scene = sceneRaw === 'in_person' || sceneRaw === 'online_voice' || sceneRaw === 'online_text' ? sceneRaw : undefined;
    const sessionId = String(root['id'] ?? file.replace(/\.json$/, ''));
    sessions.push({
      sessionId,
      scene,
      prompt: typeof root['prompt'] === 'string' ? root['prompt'] : null,
      messages,
    });
  }
  return sessions;
}

function modelArg(): string {
  const value = arg('--model') ?? process.env.MINIMAX_LLM_MODEL;
  if (!value) fail('缺少 --model 或 MINIMAX_LLM_MODEL');
  return value;
}

function apiKey(): string {
  const key = process.env.MINIMAX_API_KEY;
  if (!key) fail('缺少 MINIMAX_API_KEY（不会打印密钥）');
  return key;
}

interface CallResult {
  readonly content: string;
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly finishReason: string;
}

async function callModel(input: {
  readonly provider: MinimaxChatProvider;
  readonly apiKey: string;
  readonly model: string;
  readonly temperature: number;
  readonly system: string;
  readonly user: string;
  readonly timeoutMs: number;
  readonly maxOutputTokens: number;
}): Promise<CallResult> {
  const response = await input.provider.chat(
    {
      model: input.model,
      messages: [
        { role: 'system', content: input.system },
        { role: 'user', content: input.user },
      ],
      temperature: input.temperature,
      maxCompletionTokens: input.maxOutputTokens,
      reasoningEffort: 'low',
    },
    input.apiKey,
    AbortSignal.timeout(input.timeoutMs),
  );
  const content = response.content;
  const tags = [...content.matchAll(/<([a-zA-Z\u4E00-\u9FA5][a-zA-Z0-9_:.\u4E00-\u9FA5-]{0,20})>/g)].map((match) => match[1]).slice(0, 6);
  console.log(
    `[CALL] finish=${response.finishReason} chars=${content.length} promptTokens=${response.usage.promptTokens} completionTokens=${response.usage.completionTokens} tags=${JSON.stringify(tags)}`,
  );
  return {
    content,
    promptTokens: response.usage.promptTokens,
    completionTokens: response.usage.completionTokens,
    finishReason: response.finishReason,
  };
}

async function callWithRetry(input: Parameters<typeof callModel>[0], attempts = 2): Promise<CallResult> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await callModel(input);
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, 4000));
    }
  }
  throw lastError;
}

interface PacketOutcome {
  readonly packetId: string;
  readonly scene: RealismScene;
  readonly rater1: RealismRating;
  readonly rater2: RealismRating;
  readonly disputes: readonly RealismDimension[];
  readonly decisions: readonly RealismArbitrationDecision[];
  readonly final: ReturnType<typeof mergeRealismRating>;
}

async function ratePacket(input: {
  readonly provider: MinimaxChatProvider;
  readonly apiKey: string;
  readonly model: string;
  readonly packet: RealismBlindPacket;
  readonly timeoutMs: number;
  readonly maxParseRetries: number;
  readonly maxOutputTokens: number;
}): Promise<PacketOutcome> {
  const rate = async (raterId: 'R1' | 'R2', temperature: number): Promise<RealismRating> => {
    const prompt = buildRealismRaterPrompt(input.packet, raterId);
    let lastError = '';
    for (let attempt = 0; attempt <= input.maxParseRetries; attempt += 1) {
      // 首次保持 R5 主协议；后续切 compact 行协议，明确禁止思考块与 JSON，
      // 避免重试继续把 3000+ 预算耗在推理上却没有一行维度。
      const activePrompt = attempt === 0 ? prompt : buildRealismRaterCompactPrompt(input.packet, raterId, lastError);
      if (attempt > 0) {
        console.warn(`[PROTOCOL] ${input.packet.packetId} ${raterId} 第 ${attempt + 1} 次切 compact 行协议，原因=${lastError}`);
      }
      const retrySuffix =
        attempt === 0
          ? ''
          : '\n\n上一次输出不可用。现在直接从 naturalness= 开始按行输出，五维齐全，不要思考、不要解释、不要 JSON、不要 markdown。';
      const result = await callWithRetry({
        provider: input.provider,
        apiKey: input.apiKey,
        model: input.model,
        temperature: attempt === 0 ? temperature : 0.2,
        system: activePrompt.system,
        user: `${activePrompt.user}${retrySuffix}`,
        timeoutMs: input.timeoutMs,
        maxOutputTokens: input.maxOutputTokens,
      });
      const parsed = parseRealismRating(result.content, input.packet);
      if (!parsed.ok && attempt === 0) {
        const trimmed = result.content.trim();
        console.warn(
          `[SHAPE] ${input.packet.packetId} len=${trimmed.length} start=${JSON.stringify(trimmed.slice(0, 1))} end=${JSON.stringify(trimmed.slice(-1))} think=${trimmed.includes('<think>')} dimLines=${(trimmed.match(/^(naturalness|emotional_continuity|turn_shape|scene_congruence|relational_presence)\s*=/gm) ?? []).length}`,
        );
      }
      if (parsed.ok) return parsed.rating;
      lastError = result.finishReason === 'length' ? `truncated:${parsed.error}` : parsed.error;
      console.warn(`[WARN] ${input.packet.packetId} ${raterId} 解析失败：${lastError}（第 ${attempt + 1} 次）`);
    }
    throw new Error(`${raterId}_parse_failed:${lastError}`);
  };

  const [rater1, rater2] = await Promise.all([rate('R1', 0.1), rate('R2', 0.5)]);
  const disputes = findRealismDisputes(rater1, rater2, 2);
  let decisions: readonly RealismArbitrationDecision[] = [];
  if (disputes.length > 0) {
    const prompt = buildRealismArbiterPrompt(input.packet, rater1, rater2, disputes);
    let arbitrated: readonly RealismArbitrationDecision[] | null = null;
    for (let attempt = 0; attempt <= input.maxParseRetries; attempt += 1) {
      const retrySuffix =
        attempt === 0 ? '' : '\n\n上一次输出不可解析。现在只输出一个 JSON 对象，第一个字符必须是 {，不要任何解释、不要 markdown 代码块。';
      const result = await callWithRetry({
        provider: input.provider,
        apiKey: input.apiKey,
        model: input.model,
        temperature: 0.3,
        system: prompt.system,
        user: `${prompt.user}${retrySuffix}`,
        timeoutMs: input.timeoutMs,
        maxOutputTokens: input.maxOutputTokens,
      });
      const parsed = parseRealismArbitration(result.content, disputes);
      if (parsed.ok) {
        arbitrated = parsed.decisions;
        break;
      }
      console.warn(`[WARN] ${input.packet.packetId} R3 解析失败：${parsed.error}（第 ${attempt + 1} 次）`);
    }
    decisions = arbitrated ?? [];
  }
  return {
    packetId: input.packet.packetId,
    scene: input.packet.scene,
    rater1,
    rater2,
    disputes,
    decisions,
    final: mergeRealismRating(rater1, rater2, decisions),
  };
}

function writeReport(outDir: string, report: unknown, markdown: string): void {
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  writeFileSync(join(outDir, 'summary.md'), markdown, 'utf8');
}

function renderDistributionRows(distribution: {
  readonly overallMean: number | null;
  readonly dimensions: Readonly<Record<string, number | null>>;
}): string[] {
  const rows = [`| 总体 | ${distribution.overallMean ?? '—'} |`];
  for (const dimension of REALISM_DIMENSIONS) {
    rows.push(`| ${REALISM_DIMENSION_LABELS[dimension]} | ${distribution.dimensions[dimension] ?? '—'} |`);
  }
  return rows;
}

function renderAgreementRows(agreement: {
  readonly overall: ReturnType<typeof summarizeRealismAgreement>;
  readonly dimensions: Readonly<Record<string, ReturnType<typeof summarizeRealismAgreement>>>;
}): string[] {
  const rows = [
    `| 总体 | ${agreement.overall.n} | ${agreement.overall.linearWeightedKappa ?? 'null'} | ${agreement.overall.exactAgreement} | ${agreement.overall.withinOneAgreement} |`,
  ];
  for (const dimension of REALISM_DIMENSIONS) {
    const item = agreement.dimensions[dimension];
    rows.push(
      `| ${REALISM_DIMENSION_LABELS[dimension]} | ${item.n} | ${item.linearWeightedKappa ?? 'null'} | ${item.exactAgreement} | ${item.withinOneAgreement} |`,
    );
  }
  return rows;
}

function renderSceneRows(sceneSlices: Readonly<Record<string, { readonly n: number; readonly overallMean: number | null }>>): string[] {
  return Object.entries(sceneSlices).map(([scene, slice]) => `| ${scene} | ${slice.n} | ${slice.overallMean ?? '—'} |`);
}

function renderAgreementCaveats(caveats: readonly string[]): string[] {
  return caveats.length > 0 ? ['## 一致性解读', '', ...caveats.map((item) => `- ${item}`), ''] : [];
}

function buildMarkdown(
  report: {
    readonly packetCount: number;
    readonly ratedPackets: number;
    readonly failedPackets: number;
    readonly exclusions: Readonly<Record<string, number>>;
    readonly eligibleByScene: Readonly<Record<string, number>>;
    readonly distribution: { readonly overallMean: number | null; readonly dimensions: Readonly<Record<string, number | null>> };
    readonly agreement: {
      readonly overall: ReturnType<typeof summarizeRealismAgreement>;
      readonly dimensions: Readonly<Record<string, ReturnType<typeof summarizeRealismAgreement>>>;
      readonly caveats: readonly string[];
    };
    readonly sceneSlices: Readonly<Record<string, { readonly n: number; readonly overallMean: number | null }>>;
  },
  title: string,
): string {
  const lines = [
    `# ${title}`,
    '',
    `- 协议版本：${AI_REALISM_VERSION}`,
    `- 状态：${AI_REALISM_STATUS}`,
    `- 声明：${AI_REALISM_DISCLAIMER}`,
    `- packet：${report.packetCount}；完成 ${report.ratedPackets}；失败 ${report.failedPackets}`,
    `- 剔除：${
      Object.entries(report.exclusions)
        .map(([reason, count]) => `${reason}=${count}`)
        .join('；') || '无'
    }`,
    `- 场景分布：${Object.entries(report.eligibleByScene)
      .map(([scene, count]) => `${scene}=${count}`)
      .join('；')}`,
    '',
    '## 分布',
    '',
    '| 维度 | 均值 |',
    '| --- | --- |',
    ...renderDistributionRows(report.distribution),
    '',
    '## 双评分员一致性（线性加权 κ / 完全一致 / ±1 一致）',
    '',
    '| 维度 | n | κ | exact | within±1 |',
    '| --- | --- | --- | --- | --- |',
    ...renderAgreementRows(report.agreement),
    '',
    ...renderAgreementCaveats(report.agreement.caveats),
    '## 场景切片',
    '',
    '| 场景 | n | 总体均值 |',
    '| --- | --- | --- |',
    ...renderSceneRows(report.sceneSlices),
    '',
    '## 已知限制',
    '',
    ...AI_REALISM_LIMITATIONS.map((item) => `- ${item}`),
    '',
    '> 本报告是 AI 代理预评审，不是真人督导结论；在真人双人盲标 + 仲裁完成前，不得作为临床质量达标的证据。',
  ];
  return `${lines.join('\n')}\n`;
}

// eslint-disable-next-line sonarjs/cognitive-complexity -- CLI 顺序流程（抽样→评分→聚合→落盘），拆开会丢失失败语义
async function main(): Promise<void> {
  const sourceDir = resolve(arg('--source', DEFAULT_SOURCE)!);
  const outDir = resolve(arg('--out', DEFAULT_OUT)!);
  const targetScored = Math.max(2, Math.floor(numberArg('--target-scored', 8)));
  const maxPackets = Math.max(targetScored, Math.floor(numberArg('--max-packets', targetScored * 2)));
  const maxMessages = Math.max(4, Math.floor(numberArg('--max-messages', 32)));
  const seed = Math.floor(numberArg('--seed', 20_261_121));
  const timeoutMs = Math.floor(numberArg('--timeout-ms', 180_000));
  const maxParseRetries = Math.max(0, Math.floor(numberArg('--max-parse-retries', 1)));
  const maxOutputTokens = Math.max(1000, Math.floor(numberArg('--max-output-tokens', 5000)));
  const reportTitle = arg('--report-title', 'AF-214 · AI 双盲真人度基线')!;
  const packetIdsRaw = arg('--packet-ids');
  const packetIds =
    packetIdsRaw === null
      ? null
      : packetIdsRaw
          .split(',')
          .map((id) => id.trim())
          .filter((id) => id.length > 0);
  const dryRun = process.argv.includes('--dry-run');

  const sessions = loadSessions(sourceDir);
  const built = buildRealismBlindPackets(sessions, { maxPackets, seed, maxMessages });
  const selected = packetIds === null ? built.packets : filterPacketsByIds(built.packets, packetIds);
  if (packetIds !== null && selected.missing.length > 0) {
    fail(`以下 packetId 未被本次盲评包收录：${selected.missing.join(',')}`);
  }
  console.log(
    `[PACK] candidates=${built.candidateSessions} packets=${built.packets.length} selected=${selected.selected.length} excluded=${JSON.stringify(built.excluded)} scenes=${JSON.stringify(built.eligibleByScene)}`,
  );

  if (dryRun) {
    const sizes = selected.selected.map((packet) => ({
      packetId: packet.packetId,
      scene: packet.scene,
      turns: packet.turns.length,
      chars: packet.turns.reduce((sum, turn) => sum + turn.text.length, 0),
    }));
    console.log(`[DRY] ${JSON.stringify(sizes)}`);
    return;
  }

  const model = modelArg();
  const key = apiKey();
  const provider = new MinimaxChatProvider({
    baseUrl: process.env.MINIMAX_BASE_URL,
    defaultChatModel: process.env.MINIMAX_LLM_MODEL,
    requestTimeoutMs: timeoutMs,
    maxRetries: 1,
  });

  const outcomes: PacketOutcome[] = [];
  const failed: { packetId: string; stage: string; error: string }[] = [];
  let attempted = 0;
  for (const packet of selected.selected) {
    if (outcomes.length >= targetScored) break;
    attempted += 1;
    console.log(`[R1/R2] ${packet.packetId} scene=${packet.scene} turns=${packet.turns.length}`);
    try {
      const outcome = await ratePacket({
        provider,
        apiKey: key,
        model,
        packet,
        timeoutMs,
        maxParseRetries,
        maxOutputTokens,
      });
      outcomes.push(outcome);
      console.log(
        `[OK] ${packet.packetId} overall=${outcome.final.overall} disputes=${outcome.disputes.length} unresolved=${outcome.final.unresolved.length}`,
      );
    } catch (error) {
      const failure = {
        packetId: packet.packetId,
        stage: 'rate',
        error: error instanceof Error ? error.message.slice(0, 160) : 'unknown',
      };
      failed.push(failure);
      console.error(`[FAIL] ${packet.packetId} 评分失败：${failure.error}`);
    }
  }

  const scoredOutcomes = outcomes;
  const dimensionValues = {} as Record<RealismDimension, number[]>;
  for (const dimension of REALISM_DIMENSIONS) dimensionValues[dimension] = [];
  const overallValues: number[] = [];
  for (const outcome of scoredOutcomes) {
    overallValues.push(outcome.final.overall);
    for (const dimension of REALISM_DIMENSIONS) {
      dimensionValues[dimension].push(outcome.final.dimensions[dimension]);
    }
  }

  const r1Scores = {} as Record<RealismDimension, number[]>;
  const r2Scores = {} as Record<RealismDimension, number[]>;
  for (const dimension of REALISM_DIMENSIONS) {
    r1Scores[dimension] = [];
    r2Scores[dimension] = [];
  }
  const r1Overall: number[] = [];
  const r2Overall: number[] = [];
  for (const outcome of outcomes) {
    r1Overall.push(outcome.rater1.overall);
    r2Overall.push(outcome.rater2.overall);
    for (const dimension of REALISM_DIMENSIONS) {
      r1Scores[dimension].push(outcome.rater1.dimensions[dimension].score);
      r2Scores[dimension].push(outcome.rater2.dimensions[dimension].score);
    }
  }

  const dimensionsDistribution = {} as Record<RealismDimension, number | null>;
  const dimensionsAgreement = {} as Record<RealismDimension, ReturnType<typeof summarizeRealismAgreement>>;
  for (const dimension of REALISM_DIMENSIONS) {
    dimensionsDistribution[dimension] = average(dimensionValues[dimension]);
    dimensionsAgreement[dimension] = summarizeRealismAgreement(r1Scores[dimension], r2Scores[dimension]);
  }

  const sceneSlices: Record<string, { n: number; overallMean: number | null }> = {};
  for (const scene of ['in_person', 'online_voice', 'online_text'] as const) {
    const values = scoredOutcomes.filter((outcome) => outcome.scene === scene).map((outcome) => outcome.final.overall);
    sceneSlices[scene] = { n: values.length, overallMean: average(values) };
  }

  const agreementCaveats: string[] = [];
  const overallAgreement = summarizeRealismAgreement(r1Overall, r2Overall);
  if (overallAgreement.exactAgreement >= 0.8 && (overallAgreement.linearWeightedKappa ?? 1) < 0.4) {
    agreementCaveats.push('总体：完全一致高但 κ 低，属于分布偏斜下的 kappa paradox，应以 exact / ±1 为主，κ 只作参考。');
  }
  for (const dimension of REALISM_DIMENSIONS) {
    const item = summarizeRealismAgreement(r1Scores[dimension], r2Scores[dimension]);
    if (item.exactAgreement >= 0.8 && (item.linearWeightedKappa ?? 1) < 0.4) {
      agreementCaveats.push(
        `${REALISM_DIMENSION_LABELS[dimension]}：exact=${item.exactAgreement} 但 κ=${item.linearWeightedKappa ?? 'null'}，样本分布过于集中，κ 不可单独解读。`,
      );
    }
  }

  const report = {
    version: AI_REALISM_VERSION,
    status: AI_REALISM_STATUS,
    disclaimer: AI_REALISM_DISCLAIMER,
    limitations: AI_REALISM_LIMITATIONS,
    generatedAt: new Date().toISOString(),
    humanSupervision: false,
    clinicalAcceptanceEligible: false,
    source: 'data/debug-sessions',
    seed,
    models: { rater: model, arbiter: model },
    temperatures: { rater1: 0.1, rater2: 0.5, arbiter: 0.3 },
    targetScored,
    targetMet: outcomes.length >= targetScored,
    candidatePackets: built.packets.length,
    selectedPackets: selected.selected.length,
    packetFilter: packetIds,
    maxOutputTokens,
    packetCount: attempted,
    ratedPackets: outcomes.length,
    scoredPackets: scoredOutcomes.length,
    failedPackets: failed.length,
    candidateSessions: built.candidateSessions,
    exclusions: built.excluded,
    eligibleByScene: built.eligibleByScene,
    distribution: {
      overallMean: average(overallValues),
      dimensions: dimensionsDistribution,
    },
    agreement: {
      overall: overallAgreement,
      dimensions: dimensionsAgreement,
      caveats: agreementCaveats,
    },
    arbitration: {
      packetsWithDispute: outcomes.filter((outcome) => outcome.disputes.length > 0).length,
      decisions: outcomes.reduce((sum, outcome) => sum + outcome.decisions.length, 0),
      unresolved: outcomes.reduce((sum, outcome) => sum + outcome.final.unresolved.length, 0),
    },
    sceneSlices,
    failed,
  };

  writeReport(outDir, report, buildMarkdown(report, reportTitle));
  console.log(`[DONE] ${outDir}`);
  if (failed.length > 0) console.log(`[WARN] ${failed.length} 个 packet 评分失败，已计入失败表`);
}

void main().catch((error: unknown) => {
  console.error(`[FAIL] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
