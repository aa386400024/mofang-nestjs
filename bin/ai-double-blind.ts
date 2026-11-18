#!/usr/bin/env node
// V2026-11-19 Phase2.5 AF-116 (AI 代理双盲 + 仲裁 CLI):
//   run 读取 AF-111 的 blind pack 目录, 用同一套 9 锚点跑 R1/R2, 对分歧跑 R3,
//       输出两份独立评分、仲裁表、最终分、一致性与可复现 provenance.
//
//   边界:
//     · 不是真人督导; 输出一律带 ai_proxy_candidate / humanSupervision=false;
//     · 不写 quality_annotation 人工表, 不接 batch-report / CI 硬门;
//     · 只读既有 data/debug-sessions, 不新跑练习批次;
//     · 真实运行产物默认写 --out, 不自动入库.
//
//   用法:
//     pnpm exec tsx bin/ai-double-blind.ts run \
//       --pack-dir data/phase25-exit/long-session-blind/q_35... \
//       --out data/phase25-exit/ai-double-blind/q_35...
//   可选:
//     --rater1-model / --rater2-model / --arbiter-model
//     --rater1-temperature 0.1 / --rater2-temperature 0.7
//     --max-packets 8 / --max-parse-retries 1 / --timeout-ms 600000 / --max-completion-tokens 8192 / --concurrency 3
//     --dry-run 只校验 pack 并打印 prompt 统计, 不调用模型.

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  AI_DOUBLE_BLIND_DISCLAIMER,
  AI_DOUBLE_BLIND_LIMITATIONS,
  AI_DOUBLE_BLIND_VERSION,
  buildArbiterPrompt,
  buildRaterPrompt,
  findAiDisputes,
  mergeFinalRating,
  parseAiArbitrationOutput,
  parseAiRaterOutput,
  summarizeAiAgreement,
  type AiArbitrationDecision,
  type AiCallProvenance,
  type AiDispute,
  type AiEvidence,
  type AiFinalRating,
  type AiRaterId,
  type AiRaterOutput,
  type AiScoreVector,
} from '../src/auto-practice/metrics/ai-double-blind.js';
import {
  LONG_SESSION_DIMENSIONS,
  buildBlindPacket,
  type BlindPacket,
  type LongSessionDimension,
  type TranscriptLike,
} from '../src/auto-practice/metrics/long-session-acceptance.js';
import { MinimaxChatProvider } from '../src/llm/providers/minimax.provider.js';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

interface BlindMapEntry {
  packetId: string;
  debugSessionId: string;
  characterSlug: string;
  counselorModeId: string;
  turnCount: number;
}

interface BlindMap {
  batchId: string;
  packets: BlindMapEntry[];
}

interface RaterConfig {
  raterId: 'R1' | 'R2';
  model: string;
  temperature: number;
  promptVersion: string;
}

interface ArbitrationResult {
  packetId: string;
  decisions: readonly AiArbitrationDecision[];
  model: string;
  confidence: number;
}

interface PacketResult {
  packetId: string;
  rater1: AiRaterOutput;
  rater2: AiRaterOutput;
  disputes: AiDispute[];
  arbitration: ArbitrationResult | null;
  final: AiFinalRating;
}

function arg(name: string, fallback: string | null = null): string | null {
  const index = process.argv.indexOf(name);
  if (index === -1 || index + 1 >= process.argv.length) return fallback;
  return process.argv[index + 1];
}

function has(name: string): boolean {
  return process.argv.includes(name);
}

function fail(message: string): never {
  console.error(`[FAIL] ${message}`);
  process.exit(1);
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function loadDotEnv(): void {
  const path = join(REPO_ROOT, '.env');
  if (!existsSync(path)) return;
  const lines = readFileSync(path, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line.trim());
    if (!match) continue;
    const key = match[1];
    if (process.env[key] !== undefined) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

function csvCell(value: string | number): string {
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function csvRow(values: readonly (string | number)[]): string {
  return values.map(csvCell).join(',');
}

type CsvRow = Readonly<Record<string, string>>;

/** 最小 CSV 解析器；支持引号包裹、引号内逗号与双引号转义。 */
function parseCsv(text: string): CsvRow[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
      continue;
    }
    switch (char) {
      case '"': {
        quoted = true;

        break;
      }
      case ',': {
        row.push(field);
        field = '';

        break;
      }
      case '\n': {
        row.push(field);
        rows.push(row);
        row = [];
        field = '';

        break;
      }
      default:
        if (char !== '\r') {
          field += char;
        }
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  const header = rows.shift();
  if (!header) return [];
  return rows
    .filter((cells) => cells.some((cell) => cell.length > 0))
    .map((cells) => Object.fromEntries(header.map((name, index) => [name, cells[index] ?? ''])));
}

function numberCell(row: CsvRow, name: string): number {
  const value = Number(row[name]);
  if (!Number.isInteger(value) || value < 1 || value > 5) fail(`CSV 字段 ${name} 非法：${row[name]}`);
  return value;
}

function scoresFromRow(row: CsvRow): AiScoreVector {
  return {
    trust: numberCell(row, 'trust'),
    safety: numberCell(row, 'safety'),
    bond: numberCell(row, 'bond'),
    depth: numberCell(row, 'depth'),
    verbal: numberCell(row, 'verbal'),
    style: numberCell(row, 'style'),
    overall: numberCell(row, 'overall'),
  };
}

function outputFromRow(row: CsvRow, raterId: AiRaterId): AiRaterOutput {
  return {
    packetId: row['packet_id'],
    raterId,
    scores: scoresFromRow(row),
    evidence: [],
    confidence: 3,
    concerns: [],
  };
}

function agreementTable(agreement: ReturnType<typeof summarizeAiAgreement>): string {
  const lines = ['| 维度 | n | exact | within±1 | 线性加权 κ |', '| --- | --- | --- | --- | --- |'];
  for (const dimension of LONG_SESSION_DIMENSIONS) {
    const summary = agreement.rawByDimension[dimension];
    lines.push(
      `| ${dimension} | ${summary.n} | ${summary.exactAgreement} | ${summary.withinOneAgreement} | ${summary.linearWeightedKappa ?? 'null'} |`,
    );
  }
  lines.push(
    `| overall | ${agreement.rawOverall.n} | ${agreement.rawOverall.exactAgreement} | ${agreement.rawOverall.withinOneAgreement} | ${agreement.rawOverall.linearWeightedKappa ?? 'null'} |`,
  );
  return lines.join('\n');
}

function readBlindMap(packDir: string): BlindMap {
  const path = join(packDir, 'blind-map.json');
  if (!existsSync(path)) fail(`blind-map.json 不存在：${path}`);
  const map = readJson<BlindMap>(path);
  if (!Array.isArray(map.packets) || map.packets.length === 0) fail('blind-map.json 没有 packet');
  return map;
}

function loadPacket(entry: BlindMapEntry): BlindPacket {
  const path = join(REPO_ROOT, 'data', 'debug-sessions', `${entry.debugSessionId}.json`);
  if (!existsSync(path)) fail(`逐字稿不存在：${path}`);
  const transcript = readJson<TranscriptLike>(path);
  const packet = buildBlindPacket(transcript, entry.packetId);
  if (packet.turns.length === 0) fail(`packet 无有效对话：${entry.packetId}`);
  return packet;
}

function parseRetryCount(): number {
  const raw = Number(arg('--max-parse-retries', '1'));
  if (!Number.isInteger(raw) || raw < 0 || raw > 3) fail('--max-parse-retries 必须是 0–3 的整数');
  return raw;
}

function modelArg(flag: string): string {
  const value = arg(flag) ?? process.env.MINIMAX_LLM_MODEL;
  if (!value) fail(`缺少 ${flag} 或 MINIMAX_LLM_MODEL`);
  return value;
}

function apiKey(): string {
  const key = process.env.MINIMAX_API_KEY;
  if (!key) fail('缺少 MINIMAX_API_KEY（不会打印密钥）');
  return key;
}

async function callModel(input: {
  provider: MinimaxChatProvider;
  apiKey: string;
  model: string;
  temperature: number;
  system: string;
  user: string;
  timeoutMs: number;
  maxCompletionTokens: number;
}): Promise<{ content: string; usage: { promptTokens: number; completionTokens: number; totalTokens: number }; finishReason: string }> {
  const response = await input.provider.chat(
    {
      model: input.model,
      messages: [
        { role: 'system', content: input.system },
        { role: 'user', content: input.user },
      ],
      temperature: input.temperature,
      maxCompletionTokens: input.maxCompletionTokens,
      reasoningEffort: 'low',
    },
    input.apiKey,
    AbortSignal.timeout(input.timeoutMs),
  );
  return { content: response.content, usage: response.usage, finishReason: response.finishReason };
}

async function callModelWithRetry(input: Parameters<typeof callModel>[0], attempts = 2): Promise<Awaited<ReturnType<typeof callModel>>> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await callModel(input);
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, 5000));
    }
  }
  throw lastError;
}

async function rateOnce(input: {
  provider: MinimaxChatProvider;
  apiKey: string;
  packet: BlindPacket;
  raterId: 'R1' | 'R2';
  model: string;
  temperature: number;
  timeoutMs: number;
  maxCompletionTokens: number;
  maxParseRetries: number;
}): Promise<{ output: AiRaterOutput; provenance: AiCallProvenance }> {
  const prompt = buildRaterPrompt({ raterId: input.raterId, packet: input.packet });
  let lastContent = '';
  for (let attempt = 0; attempt <= input.maxParseRetries; attempt += 1) {
    const user =
      attempt === 0
        ? prompt.user
        : `${prompt.user}\n\n你上一次的输出无法解析。请只输出一个合法 JSON 对象，不要 markdown 代码块、不要解释。`;
    const response = await callModelWithRetry({
      provider: input.provider,
      apiKey: input.apiKey,
      model: input.model,
      temperature: input.temperature,
      system: prompt.system,
      user,
      timeoutMs: input.timeoutMs,
      maxCompletionTokens: input.maxCompletionTokens,
    });
    lastContent = response.content;
    const parsed = parseAiRaterOutput(response.content, input.packet.packetId, input.raterId);
    if (parsed) {
      return {
        output: parsed,
        provenance: {
          role: input.raterId,
          model: input.model,
          temperature: input.temperature,
          promptVersion: AI_DOUBLE_BLIND_VERSION,
          promptSha256: sha256(`${prompt.system}\n\n${user}`),
          packetId: input.packet.packetId,
          promptTokens: response.usage.promptTokens,
          completionTokens: response.usage.completionTokens,
          totalTokens: response.usage.totalTokens,
          finishReason: response.finishReason,
        },
      };
    }
  }
  fail(`${input.raterId} 输出无法解析（packet=${input.packet.packetId}）：${lastContent.slice(0, 200)}`);
}

async function arbitrateOnce(input: {
  provider: MinimaxChatProvider;
  apiKey: string;
  packet: BlindPacket;
  rater1: AiRaterOutput;
  rater2: AiRaterOutput;
  disputes: readonly AiDispute[];
  model: string;
  temperature: number;
  timeoutMs: number;
  maxCompletionTokens: number;
  maxParseRetries: number;
}): Promise<{ output: ReturnType<typeof parseAiArbitrationOutput>; provenance: AiCallProvenance }> {
  const prompt = buildArbiterPrompt({
    packet: input.packet,
    rater1: input.rater1,
    rater2: input.rater2,
    disputes: input.disputes,
  });
  let lastContent = '';
  for (let attempt = 0; attempt <= input.maxParseRetries; attempt += 1) {
    const user =
      attempt === 0 ? prompt.user : `${prompt.user}\n\n你上一次的输出无法解析。请只输出一个合法 JSON 对象，必须覆盖全部争议维度。`;
    const response = await callModelWithRetry({
      provider: input.provider,
      apiKey: input.apiKey,
      model: input.model,
      temperature: input.temperature,
      system: prompt.system,
      user,
      timeoutMs: input.timeoutMs,
      maxCompletionTokens: input.maxCompletionTokens,
    });
    lastContent = response.content;
    const parsed = parseAiArbitrationOutput(response.content, input.packet.packetId, input.disputes);
    if (parsed) {
      return {
        output: parsed,
        provenance: {
          role: 'R3',
          model: input.model,
          temperature: input.temperature,
          promptVersion: AI_DOUBLE_BLIND_VERSION,
          promptSha256: sha256(`${prompt.system}\n\n${user}`),
          packetId: input.packet.packetId,
          promptTokens: response.usage.promptTokens,
          completionTokens: response.usage.completionTokens,
          totalTokens: response.usage.totalTokens,
          finishReason: response.finishReason,
        },
      };
    }
  }
  fail(`R3 输出无法解析（packet=${input.packet.packetId}）：${lastContent.slice(0, 200)}`);
}

function notesOf(output: AiRaterOutput): string {
  return output.concerns.join('；').slice(0, 240);
}

function evidenceLine(evidence: readonly AiEvidence[]): string {
  if (evidence.length === 0) return '无';
  return evidence
    .slice(0, 6)
    .map((item) => `${item.dimension}@${item.turnIndex ?? '?'}「${item.quote}」`)
    .join('；');
}

function writeRatingsCsv(path: string, packetResults: readonly PacketResult[], rater: 'R1' | 'R2'): void {
  const header = ['packet_id', 'rater_id', ...LONG_SESSION_DIMENSIONS, 'overall', 'adjudicate', 'notes'];
  const rows = [header.join(',')];
  for (const result of packetResults) {
    const output = rater === 'R1' ? result.rater1 : result.rater2;
    rows.push(
      csvRow([
        output.packetId,
        rater,
        ...LONG_SESSION_DIMENSIONS.map((dimension) => output.scores[dimension]),
        output.scores.overall,
        result.disputes.length > 0 ? 'yes' : 'no',
        notesOf(output),
      ]),
    );
  }
  writeFileSync(path, `${rows.join('\n')}\n`, 'utf8');
}

function writeFinalCsv(path: string, packetResults: readonly PacketResult[]): void {
  const header = ['packet_id', ...LONG_SESSION_DIMENSIONS, 'overall', 'disputed_dimensions'];
  const rows = [header.join(',')];
  for (const result of packetResults) {
    rows.push(
      csvRow([
        result.final.packetId,
        ...LONG_SESSION_DIMENSIONS.map((dimension) => result.final.scores[dimension]),
        result.final.scores.overall,
        result.final.disputedDimensions.join('|'),
      ]),
    );
  }
  writeFileSync(path, `${rows.join('\n')}\n`, 'utf8');
}

function writeArbitrationCsv(path: string, packetResults: readonly PacketResult[]): void {
  const header = ['packet_id', 'dimension', 'rater1', 'rater2', 'final', 'reason'];
  const rows = [header.join(',')];
  for (const result of packetResults) {
    for (const decision of result.arbitration?.decisions ?? []) {
      rows.push(csvRow([decision.packetId, decision.dimension, decision.rater1, decision.rater2, decision.final, decision.reason]));
    }
  }
  writeFileSync(path, `${rows.join('\n')}\n`, 'utf8');
}

function buildReport(input: {
  batchId: string;
  packetResults: readonly PacketResult[];
  agreement: ReturnType<typeof summarizeAiAgreement>;
  raterConfigs: readonly RaterConfig[];
  arbiterModel: string;
}): string {
  const lines: string[] = [
    '# AI 代理双盲评分与仲裁报告',
    '',
    `> ${AI_DOUBLE_BLIND_DISCLAIMER}`,
    '',
    `- 版本：${AI_DOUBLE_BLIND_VERSION}`,
    `- 批次：${input.batchId}`,
    `- packet 数：${input.packetResults.length}`,
    `- R1：${input.raterConfigs[0].model} / temperature=${input.raterConfigs[0].temperature}`,
    `- R2：${input.raterConfigs[1].model} / temperature=${input.raterConfigs[1].temperature}`,
    `- R3：${input.arbiterModel}`,
    `- 状态：ai_proxy_candidate；humanSupervision=false；clinicalAcceptanceEligible=false`,
    '',
    '## R1 / R2 原始一致性',
    '',
    '| 维度 | n | exact | within±1 | 线性加权 κ |',
    '| --- | --- | --- | --- | --- |',
  ];
  for (const dimension of LONG_SESSION_DIMENSIONS) {
    const summary = input.agreement.rawByDimension[dimension];
    lines.push(
      `| ${dimension} | ${summary.n} | ${summary.exactAgreement} | ${summary.withinOneAgreement} | ${summary.linearWeightedKappa ?? 'null'} |`,
    );
  }
  lines.push(
    `| overall | ${input.agreement.rawOverall.n} | ${input.agreement.rawOverall.exactAgreement} | ${input.agreement.rawOverall.withinOneAgreement} | ${input.agreement.rawOverall.linearWeightedKappa ?? 'null'} |`,
    '',
    '## 逐 packet 结果',
    '',
    '| packet | trust | safety | bond | depth | verbal | style | overall | 仲裁维度 | R1 证据 | R2 证据 |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
  );
  for (const result of input.packetResults) {
    const f = result.final.scores;
    lines.push(
      `| ${result.packetId} | ${f.trust} | ${f.safety} | ${f.bond} | ${f.depth} | ${f.verbal} | ${f.style} | ${f.overall} | ${result.final.disputedDimensions.join('|') || '无'} | ${evidenceLine(result.rater1.evidence)} | ${evidenceLine(result.rater2.evidence)} |`,
    );
  }
  const low = input.packetResults.filter((result) => result.final.scores.overall <= 2);
  lines.push('', '## 需要优先复核的 packet', '');
  if (low.length === 0) {
    lines.push('- 无 overall ≤ 2 的 packet；仍需真人复核，AI 分不代表合格。');
  } else {
    for (const result of low) {
      lines.push(
        `- ${result.packetId}：overall=${result.final.scores.overall}，仲裁维度=${result.final.disputedDimensions.join('|') || '无'}`,
      );
    }
  }
  lines.push('', '## 已知限制', '');
  for (const limitation of AI_DOUBLE_BLIND_LIMITATIONS) lines.push(`- ${limitation}`);
  lines.push(
    '',
    '## 结论口径',
    '',
    '这不是临床验收结论。它只用于在真人督导到位前暴露评分口径、分歧结构与需要优先复核的 packet；',
    '不得据此写“质量达标”，也不得把 AI 分回写 `quality_annotation` 人工表。',
    '',
  );
  return lines.join('\n');
}

async function commandRebuild(): Promise<void> {
  const outDir = arg('--out');
  if (!outDir) fail('用法：ai-double-blind rebuild --out <dir>');
  const resolved = resolve(outDir);
  if (!existsSync(resolved)) fail(`输出目录不存在：${resolved}`);
  const r1Rows = parseCsv(readFileSync(join(resolved, 'ratings-rater-1.csv'), 'utf8'));
  const r2Rows = parseCsv(readFileSync(join(resolved, 'ratings-rater-2.csv'), 'utf8'));
  const finalRows = parseCsv(readFileSync(join(resolved, 'ai-final-ratings.csv'), 'utf8'));
  if (r1Rows.length === 0 || r2Rows.length === 0 || finalRows.length === 0) fail('CSV 为空，无法重建');
  const items = finalRows.map((finalRow, index) => {
    const r1Row = r1Rows[index];
    const r2Row = r2Rows[index];
    if (!r1Row || !r2Row) fail(`CSV 行数不齐：${index}`);
    return {
      rater1: outputFromRow(r1Row, 'R1'),
      rater2: outputFromRow(r2Row, 'R2'),
      final: {
        packetId: finalRow['packet_id'],
        scores: scoresFromRow(finalRow),
        disputedDimensions: (finalRow['disputed_dimensions'] ?? '')
          .split('|')
          .filter((item): item is LongSessionDimension => (LONG_SESSION_DIMENSIONS as readonly string[]).includes(item)),
      } satisfies AiFinalRating,
    };
  });
  const agreement = summarizeAiAgreement(items);
  writeJson(join(resolved, 'ai-agreement.json'), {
    version: AI_DOUBLE_BLIND_VERSION,
    disclaimer: AI_DOUBLE_BLIND_DISCLAIMER,
    packetCount: items.length,
    ratingPairCount: agreement.rawOverall.n,
    rawByDimension: agreement.rawByDimension,
    rawOverall: agreement.rawOverall,
    finalVsRater1: agreement.finalVsRater1,
    finalVsRater2: agreement.finalVsRater2,
  });
  const reportPath = join(resolved, 'ai-report.md');
  if (existsSync(reportPath)) {
    const report = readFileSync(reportPath, 'utf8');
    const start = '## R1 / R2 原始一致性';
    const end = '## 逐 packet 结果';
    const startIndex = report.indexOf(start);
    const endIndex = report.indexOf(end);
    if (startIndex !== -1 && endIndex !== -1 && endIndex > startIndex) {
      const next = `${report.slice(0, startIndex)}${start}\n\n${agreementTable(agreement)}\n\n${report.slice(endIndex)}`;
      writeFileSync(reportPath, next, 'utf8');
    }
  }
  console.log(`[OK] 重建一致性：packets=${items.length} overallN=${agreement.rawOverall.n} → ${resolved}`);
}

async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results: R[] = [];
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const index = next;
      next += 1;
      if (index >= items.length) return;
      results[index] = await fn(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

async function commandRun(): Promise<void> {
  loadDotEnv();
  const packDir = arg('--pack-dir');
  if (!packDir) fail('用法：ai-double-blind run --pack-dir <dir> [--out <dir>] [--max-packets 8]');
  const resolvedPackDir = resolve(packDir);
  if (!existsSync(resolvedPackDir)) fail(`pack 目录不存在：${resolvedPackDir}`);
  const map = readBlindMap(resolvedPackDir);
  const outDir = resolve(arg('--out', join(REPO_ROOT, 'data', 'phase25-exit', 'ai-double-blind', map.batchId))!);
  const maxPacketsRaw = Number(arg('--max-packets', String(map.packets.length)));
  if (!Number.isInteger(maxPacketsRaw) || maxPacketsRaw < 2) fail('--max-packets 必须是 >=2 的整数');
  const entries = map.packets.slice(0, maxPacketsRaw);
  const dryRun = has('--dry-run');
  const timeoutMs = Number(arg('--timeout-ms', '600000'));
  if (!Number.isFinite(timeoutMs) || timeoutMs < 10_000) fail('--timeout-ms 必须是 >=10000 的毫秒数');
  const maxCompletionTokens = Number(arg('--max-completion-tokens', '8192'));
  if (!Number.isInteger(maxCompletionTokens) || maxCompletionTokens < 512) fail('--max-completion-tokens 必须是 >=512 的整数');
  const maxParseRetries = parseRetryCount();
  const concurrency = Number(arg('--concurrency', '3'));
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 8) fail('--concurrency 必须是 1–8 的整数');

  const rater1Temperature = Number(arg('--rater1-temperature', '0.1'));
  const rater2Temperature = Number(arg('--rater2-temperature', '0.7'));
  const arbiterTemperature = Number(arg('--arbiter-temperature', '0.2'));
  for (const [name, value] of [
    ['--rater1-temperature', rater1Temperature],
    ['--rater2-temperature', rater2Temperature],
    ['--arbiter-temperature', arbiterTemperature],
  ] as const) {
    if (!Number.isFinite(value) || value < 0 || value > 2) fail(`${name} 必须在 0–2`);
  }

  const rater1Model = modelArg('--rater1-model');
  const rater2Model = modelArg('--rater2-model');
  const arbiterModel = arg('--arbiter-model') ?? rater1Model;
  const raterConfigs: RaterConfig[] = [
    { raterId: 'R1', model: rater1Model, temperature: rater1Temperature, promptVersion: AI_DOUBLE_BLIND_VERSION },
    { raterId: 'R2', model: rater2Model, temperature: rater2Temperature, promptVersion: AI_DOUBLE_BLIND_VERSION },
  ];

  if (dryRun) {
    const sample = loadPacket(entries[0]);
    const is50 = sample.turns.length >= 80;
    console.log(`[dry-run] batch=${map.batchId} packets=${entries.length} turns(sample)=${sample.turns.length} isLong=${is50}`);
    console.log(`[dry-run] R1=${rater1Model} temp=${rater1Temperature} / R2=${rater2Model} temp=${rater2Temperature} / R3=${arbiterModel}`);
    console.log(`[dry-run] ${AI_DOUBLE_BLIND_DISCLAIMER}`);
    return;
  }

  const key = apiKey();
  const provider = new MinimaxChatProvider({
    baseUrl: process.env.MINIMAX_BASE_URL,
    defaultChatModel: process.env.MINIMAX_LLM_MODEL,
    requestTimeoutMs: timeoutMs,
    maxRetries: 1,
  });
  mkdirSync(outDir, { recursive: true });

  const runOne = async (entry: BlindMapEntry): Promise<{ result: PacketResult; provenance: AiCallProvenance[] }> => {
    const packet = loadPacket(entry);
    console.log(`[R1/R2] ${entry.packetId} turns=${packet.turns.length}`);
    const [r1, r2] = await Promise.all([
      rateOnce({
        provider,
        apiKey: key,
        packet,
        raterId: 'R1',
        model: rater1Model,
        temperature: rater1Temperature,
        timeoutMs,
        maxCompletionTokens,
        maxParseRetries,
      }),
      rateOnce({
        provider,
        apiKey: key,
        packet,
        raterId: 'R2',
        model: rater2Model,
        temperature: rater2Temperature,
        timeoutMs,
        maxCompletionTokens,
        maxParseRetries,
      }),
    ]);
    const provenanceItems = [r1.provenance, r2.provenance];
    const disputes = findAiDisputes(r1.output, r2.output);
    let arbitration: ArbitrationResult | null = null;
    if (disputes.length > 0) {
      console.log(`[R3] ${entry.packetId} disputes=${disputes.map((item) => item.dimension).join('|')}`);
      const result = await arbitrateOnce({
        provider,
        apiKey: key,
        packet,
        rater1: r1.output,
        rater2: r2.output,
        disputes,
        model: arbiterModel,
        temperature: arbiterTemperature,
        timeoutMs,
        maxCompletionTokens,
        maxParseRetries,
      });
      provenanceItems.push(result.provenance);
      if (!result.output) fail(`R3 解析结果为空：${entry.packetId}`);
      arbitration = {
        packetId: entry.packetId,
        decisions: result.output.decisions,
        model: arbiterModel,
        confidence: result.output.confidence,
      };
    }
    return {
      result: {
        packetId: entry.packetId,
        rater1: r1.output,
        rater2: r2.output,
        disputes,
        arbitration,
        final: mergeFinalRating(r1.output, r2.output, arbitration?.decisions ?? []),
      },
      provenance: provenanceItems,
    };
  };

  const outcomes = await mapLimit(entries, concurrency, runOne);
  const packetResults = outcomes.map((item) => item.result);
  const provenance = outcomes.flatMap((item) => item.provenance);

  const agreement = summarizeAiAgreement(packetResults);
  writeRatingsCsv(join(outDir, 'ratings-rater-1.csv'), packetResults, 'R1');
  writeRatingsCsv(join(outDir, 'ratings-rater-2.csv'), packetResults, 'R2');
  writeFinalCsv(join(outDir, 'ai-final-ratings.csv'), packetResults);
  writeArbitrationCsv(join(outDir, 'ai-arbitration.csv'), packetResults);
  writeJson(join(outDir, 'ai-agreement.json'), {
    version: AI_DOUBLE_BLIND_VERSION,
    disclaimer: AI_DOUBLE_BLIND_DISCLAIMER,
    packetCount: packetResults.length,
    ratingPairCount: agreement.rawOverall.n,
    rawByDimension: agreement.rawByDimension,
    rawOverall: agreement.rawOverall,
    finalVsRater1: agreement.finalVsRater1,
    finalVsRater2: agreement.finalVsRater2,
  });
  writeJson(join(outDir, 'ai-provenance.json'), {
    version: AI_DOUBLE_BLIND_VERSION,
    status: 'ai_proxy_candidate',
    humanSupervision: false,
    clinicalAcceptanceEligible: false,
    batchId: map.batchId,
    packetCount: packetResults.length,
    sameModelForBothRaters: rater1Model === rater2Model,
    raterConfigs,
    arbiterModel,
    limitations: AI_DOUBLE_BLIND_LIMITATIONS,
    calls: provenance,
    generatedAt: new Date().toISOString(),
  });
  writeFileSync(
    join(outDir, 'ai-report.md'),
    buildReport({ batchId: map.batchId, packetResults, agreement, raterConfigs, arbiterModel }),
    'utf8',
  );

  const disputed = packetResults.filter((result) => result.disputes.length > 0).length;
  console.log(`[OK] ${packetResults.length} packet → ${outDir}`);
  console.log(`[OK] R1/R2 原始 overall κ=${agreement.rawOverall.linearWeightedKappa ?? 'null'}`);
  console.log(`[OK] 进入仲裁 packet=${disputed}`);
  console.log(`[提示] ${AI_DOUBLE_BLIND_DISCLAIMER}`);
}

async function main(): Promise<void> {
  const sub = process.argv[2] ?? 'run';
  if (sub === 'run') {
    await commandRun();
    return;
  }
  if (sub === 'rebuild') {
    await commandRebuild();
    return;
  }
  fail('用法：ai-double-blind <run|rebuild> --pack-dir <dir> | --out <dir>');
}

main().catch((error: unknown) => {
  const detail = error instanceof Error ? error.message : String(error);
  console.error(`[FAIL] ${detail}`);
  process.exit(1);
});
