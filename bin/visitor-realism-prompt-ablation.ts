/**
 * AF-330 来访者文字真人度 prompt 分层消融 A/B。
 *
 * 两个合成人设 × 五个分支（off / full / quota / event / context）× 固定 6 个咨询师轮次，
 * 每个分支重复 N 次，真实调用豆包 Seed Character；输出只含数字，不写库、不启服务、不输出台词。
 *
 * 用法：
 *   pnpm exec tsx bin/visitor-realism-prompt-ablation.ts
 *   pnpm exec tsx bin/visitor-realism-prompt-ablation.ts --reps 2 --out data/phase25-exit/af330-realism-ablation/report.json
 */
import 'reflect-metadata';

import type { ConfigService } from '@nestjs/config';
import { config as loadEnvFile } from 'dotenv';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { LlmService } from '../src/agent/llm/llm.service.js';
import type { LlmMessage } from '../src/agent/llm/llm.types.js';
import { DEFAULT_VISITOR_DOUBAO_MODEL } from '../src/agent/visitor/visitor.runtime.js';
import { analyzeDisfluency, aggregateDisfluency } from '../src/auto-practice/metrics/disfluency-analyzer.js';
import {
  buildHumanizationMetrics,
  evaluateHumanization,
  type HumanizationEvaluation,
} from '../src/auto-practice/metrics/humanization-acceptance.js';
import { buildCounselorMessage, REALISM_AB_COUNSELOR_TURNS, stripEmotionTags } from '../src/shared/realism/realism-prompt-ab.js';
import {
  ABLATION_ARMS,
  ABLATION_PERSONAS,
  buildAblationSystemPrompt,
  getAblationPersona,
  type AblationArm,
  type AblationPersonaId,
} from '../src/shared/realism/realism-prompt-ablation.js';

const METRIC_IDS = [
  'text.disfluency.events_per_turn',
  'text.disfluency.event_turn_rate',
  'text.disfluency.density_per100',
  'text.disfluency.repair_per_turn',
] as const;

interface Options {
  readonly model: string;
  readonly temperature: number;
  readonly maxTokens: number;
  readonly timeoutMs: number;
  readonly turns: number;
  readonly reps: number;
  readonly personas: readonly AblationPersonaId[];
  readonly arms: readonly AblationArm[];
  readonly json: boolean;
  readonly out: string | null;
}

type Generate = (messages: readonly LlmMessage[]) => Promise<string>;

interface TypeCounts {
  readonly filler: number;
  readonly pause: number;
  readonly repetition: number;
  readonly repair: number;
  readonly trailoff: number;
  readonly elongation: number;
}

interface RepResult {
  readonly completedTurns: number;
  readonly failedTurns: number;
  readonly failure: string | null;
  readonly metrics: Readonly<Record<string, number | null>>;
  readonly typeCounts: TypeCounts;
  readonly humanization: HumanizationEvaluation | null;
}

interface CellResult {
  readonly persona: AblationPersonaId;
  readonly personaLabel: string;
  readonly arm: AblationArm;
  readonly reps: number;
  readonly completedTurns: number;
  readonly failedTurns: number;
  readonly failures: number;
  readonly meanMetrics: Readonly<Record<string, number | null>>;
  readonly meanTypeCounts: TypeCounts;
  readonly humanizationStatuses: readonly string[];
  readonly deltaVsOff: Readonly<Record<string, number | null>> | null;
}

interface Report {
  readonly model: string;
  readonly temperature: number;
  readonly maxTokens: number;
  readonly timeoutMs: number;
  readonly turns: number;
  readonly reps: number;
  readonly personas: readonly AblationPersonaId[];
  readonly arms: readonly AblationArm[];
  readonly calls: number;
  readonly failures: number;
  readonly cells: readonly CellResult[];
}

function arg(name: string, fallback: string | null = null): string | null {
  const index = process.argv.indexOf(name);
  if (index === -1 || index + 1 >= process.argv.length) return fallback;
  return process.argv[index + 1];
}

function numberArg(name: string, fallback: number): number {
  const value = arg(name);
  if (value === null) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`${name} 必须是正数`);
  return parsed;
}

function listArg<T extends string>(name: string, fallback: readonly T[], allowed: readonly T[]): readonly T[] {
  const raw = arg(name);
  if (raw === null) return fallback;
  const values = raw
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0) as T[];
  if (values.length === 0) return fallback;
  const invalid = values.filter((entry) => !allowed.includes(entry));
  if (invalid.length > 0) throw new Error(`${name} 含未知值 ${invalid.join(',')}; 可选 ${allowed.join(' / ')}`);
  return values;
}

function parseOptions(argv: readonly string[]): Options {
  const model = arg('--model') ?? process.env['VISITOR_DOUBAO_MODEL']?.trim() ?? DEFAULT_VISITOR_DOUBAO_MODEL;
  const maxTurns = REALISM_AB_COUNSELOR_TURNS.length;
  const reps = Math.floor(numberArg('--reps', 2));
  const outArg = arg('--out');
  return {
    model,
    temperature: numberArg('--temperature', 0.6),
    maxTokens: numberArg('--max-tokens', 160),
    timeoutMs: numberArg('--timeout-ms', 45_000),
    turns: Math.min(maxTurns, Math.max(1, numberArg('--turns', 6))),
    reps: Math.min(5, Math.max(1, reps)),
    personas: listArg('--personas', ABLATION_PERSONAS, ABLATION_PERSONAS),
    arms: listArg('--arms', ABLATION_ARMS, ABLATION_ARMS),
    json: argv.includes('--json'),
    out: outArg ? resolve(process.cwd(), outArg) : null,
  };
}

function loadEnvOnce(): void {
  if (!existsSync('.env')) return;
  const result = loadEnvFile({ path: '.env' });
  if (result.error) throw new Error(`加载 .env 失败: ${result.error.message}`);
}

function requireEnv(key: string): void {
  const value = process.env[key]?.trim() ?? '';
  if (value.length === 0) throw new Error(`缺少 ${key}（不会打印密钥）`);
}

function buildLlm(): LlmService {
  const config = {
    get: <T>(key: string): T | undefined => process.env[key] as T | undefined,
  } as unknown as ConfigService;
  return new LlmService(config);
}

async function runArm(
  personaId: AblationPersonaId,
  arm: AblationArm,
  generate: Generate,
  maxTurns: number,
): Promise<{ reps: RepResult[]; calls: number }> {
  const persona = getAblationPersona(personaId);
  const systemPrompt = buildAblationSystemPrompt(persona, arm);
  const messages: LlmMessage[] = [{ role: 'system', content: systemPrompt }];
  const texts: string[] = [];
  let failed = false;
  let failure: string | null = null;

  for (let index = 0; index < maxTurns; index += 1) {
    messages.push({ role: 'user', content: buildCounselorMessage(REALISM_AB_COUNSELOR_TURNS[index]) });
    try {
      const raw = await generate([...messages]);
      const text = stripEmotionTags(raw);
      if (text.length === 0) throw new Error('模型返回空正文');
      texts.push(text);
      messages.push({ role: 'assistant', content: text });
    } catch (error) {
      failed = true;
      failure = error instanceof Error ? error.message : String(error);
      break;
    }
  }

  const turns = texts.map((text) => analyzeDisfluency(text)).filter((metrics) => metrics.normalizedLength > 0);
  const aggregate = aggregateDisfluency(turns);
  const events = turns.reduce((sum, turn) => sum + turn.events, 0);
  const eventTurns = turns.filter((turn) => turn.hasEvent).length;
  const chars = turns.reduce((sum, turn) => sum + turn.normalizedLength, 0);
  const metrics = buildHumanizationMetrics(turns.length, events, eventTurns, chars, aggregate.typeCounts);
  const humanization = arm === 'off' ? null : evaluateHumanization(metrics, { realismMode: 'active', turns: turns.length });

  return {
    calls: maxTurns,
    reps: [
      {
        completedTurns: turns.length,
        failedTurns: failed ? 1 : 0,
        failure,
        metrics,
        typeCounts: aggregate.typeCounts,
        humanization,
      },
    ],
  };
}

async function runCell(
  personaId: AblationPersonaId,
  arm: AblationArm,
  options: Options,
  generate: Generate,
): Promise<{ cell: CellResult; calls: number; failures: number }> {
  const reps: RepResult[] = [];
  let calls = 0;
  let failures = 0;
  for (let index = 0; index < options.reps; index += 1) {
    const run = await runArm(personaId, arm, generate, options.turns);
    calls += run.calls;
    const rep = run.reps[0];
    reps.push(rep);
    failures += rep.failedTurns;
  }

  const meanMetrics = meanMetricsOf(reps);
  const meanTypeCounts = meanTypeCountsOf(reps);
  const persona = getAblationPersona(personaId);
  return {
    calls,
    failures,
    cell: {
      persona: personaId,
      personaLabel: persona.label,
      arm,
      reps: options.reps,
      completedTurns: reps.reduce((sum, rep) => sum + rep.completedTurns, 0),
      failedTurns: reps.reduce((sum, rep) => sum + rep.failedTurns, 0),
      failures,
      meanMetrics,
      meanTypeCounts,
      humanizationStatuses: reps.map((rep) => rep.humanization?.status ?? 'n/a'),
      deltaVsOff: null,
    },
  };
}

function meanMetricsOf(reps: readonly RepResult[]): Readonly<Record<string, number | null>> {
  const output: Record<string, number | null> = {};
  for (const id of METRIC_IDS) {
    const values = reps
      .map((rep) => rep.metrics[id])
      .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
    output[id] = values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length;
  }
  return output;
}

function meanTypeCountsOf(reps: readonly RepResult[]): TypeCounts {
  return {
    filler: mean(reps.map((rep) => rep.typeCounts.filler)),
    pause: mean(reps.map((rep) => rep.typeCounts.pause)),
    repetition: mean(reps.map((rep) => rep.typeCounts.repetition)),
    repair: mean(reps.map((rep) => rep.typeCounts.repair)),
    trailoff: mean(reps.map((rep) => rep.typeCounts.trailoff)),
    elongation: mean(reps.map((rep) => rep.typeCounts.elongation)),
  };
}

function mean(values: readonly number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function attachDeltas(cells: readonly CellResult[]): readonly CellResult[] {
  return cells.map((cell) => {
    if (cell.arm === 'off') return cell;
    const off = cells.find((entry) => entry.persona === cell.persona && entry.arm === 'off');
    if (off === undefined) return cell;
    const delta: Record<string, number | null> = {};
    for (const id of METRIC_IDS) {
      const left = off.meanMetrics[id];
      const right = cell.meanMetrics[id];
      delta[id] = left === null || right === null ? null : right - left;
    }
    return { ...cell, deltaVsOff: delta };
  });
}

function formatNumber(value: number | null): string {
  return value === null ? 'n/a' : value.toFixed(6);
}

function formatCounts(counts: TypeCounts): string {
  return `filler ${counts.filler.toFixed(2)} / pause ${counts.pause.toFixed(2)} / repetition ${counts.repetition.toFixed(2)} / repair ${counts.repair.toFixed(2)} / trailoff ${counts.trailoff.toFixed(2)} / elongation ${counts.elongation.toFixed(2)}`;
}

function printHuman(report: Report): void {
  console.log('来访者真人度 prompt 分层消融 A/B');
  console.log(
    `模型 ${report.model} | 温度 ${report.temperature} | ${report.personas.length} 人设 | ${report.arms.length} 分支 | ` +
      `${report.turns} 轮/分支 | ${report.reps} 重复 | 调用 ${report.calls} | 失败 ${report.failures}`,
  );
  for (const persona of report.personas) {
    const cells = report.cells.filter((cell) => cell.persona === persona);
    console.log(`\n人设 ${persona}（${cells[0]?.personaLabel ?? '未知'}）`);
    console.log('arm       turns fail  events/turn rate      density   repair    status');
    for (const cell of cells) {
      console.log(
        `${cell.arm.padEnd(9)} ${String(cell.completedTurns).padStart(5)} ${String(cell.failedTurns).padStart(4)}  ` +
          `${formatNumber(cell.meanMetrics['text.disfluency.events_per_turn']).padStart(11)} ` +
          `${formatNumber(cell.meanMetrics['text.disfluency.event_turn_rate']).padStart(9)} ` +
          `${formatNumber(cell.meanMetrics['text.disfluency.density_per100']).padStart(9)} ` +
          `${formatNumber(cell.meanMetrics['text.disfluency.repair_per_turn']).padStart(8)}  ` +
          `${cell.humanizationStatuses.join(',')}`,
      );
      console.log(`          ${formatCounts(cell.meanTypeCounts)}`);
    }
    console.log('delta vs off: events/turn rate density repair');
    for (const cell of cells.filter((entry) => entry.arm !== 'off')) {
      const delta = cell.deltaVsOff;
      if (delta === null) continue;
      console.log(
        `${cell.arm.padEnd(9)} ${formatNumber(delta['text.disfluency.events_per_turn'])} ` +
          `${formatNumber(delta['text.disfluency.event_turn_rate'])} ` +
          `${formatNumber(delta['text.disfluency.density_per100'])} ` +
          `${formatNumber(delta['text.disfluency.repair_per_turn'])}`,
      );
    }
  }
}

async function main(): Promise<void> {
  loadEnvOnce();
  requireEnv('LLM_DOUBAO_API_KEY');
  requireEnv('MINIMAX_API_KEY');
  requireEnv('MINIMAX_BASE_URL');
  requireEnv('MINIMAX_LLM_MODEL');

  const options = parseOptions(process.argv.slice(2));
  const llm = buildLlm();
  const generate = createGenerator(llm, options);

  const cells: CellResult[] = [];
  let calls = 0;
  let failures = 0;
  for (const persona of options.personas) {
    for (const arm of options.arms) {
      const result = await runCell(persona, arm, options, generate);
      cells.push(result.cell);
      calls += result.calls;
      failures += result.failures;
    }
  }

  const report: Report = {
    model: options.model,
    temperature: options.temperature,
    maxTokens: options.maxTokens,
    timeoutMs: options.timeoutMs,
    turns: options.turns,
    reps: options.reps,
    personas: options.personas,
    arms: options.arms,
    calls,
    failures,
    cells: attachDeltas(cells),
  };

  if (options.out) {
    mkdirSync(dirname(options.out), { recursive: true });
    writeFileSync(options.out, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  }
  if (options.json) console.log(JSON.stringify(report, null, 2));
  else printHuman(report);

  if (failures > 0) process.exitCode = 2;
}

function createGenerator(llm: LlmService, options: Options): Generate {
  return async (messages) => {
    let text = '';
    let errorCode: string | undefined;
    let errorMessage: string | undefined;
    const stream = llm.streamChat(messages, {
      provider: 'doubao',
      model: options.model,
      temperature: options.temperature,
      maxTokens: options.maxTokens,
      timeoutMs: options.timeoutMs,
      tenantId: 'af330-realism-ablation',
      userId: 'af330-realism-ablation',
      traceId: `af330-${Date.now()}`,
    });
    for await (const chunk of stream) {
      if (chunk.type === 'content') text += chunk.content;
      if (chunk.type === 'error') {
        errorCode = chunk.error.code;
        errorMessage = chunk.error.message;
      }
    }
    if (errorCode !== undefined) {
      throw new Error(`模型返回 error chunk code=${errorCode} http=${String(errorMessage ?? '').slice(0, 160)}`);
    }
    return text;
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[FAIL] ${message}`);
    process.exitCode = 1;
  });
}
