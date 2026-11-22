/**
 * AF-329 来访者文字真人度 active / off prompt A/B smoke。
 *
 * 同一合成人设、同一组 6 个咨询师轮次，分别用 active 与 off system prompt 真实调用
 * 豆包 Seed Character；输出只含数字，不写库、不启服务、不输出完整台词。
 *
 * 用法：
 *   pnpm exec tsx bin/visitor-realism-prompt-ab.ts
 *   pnpm exec tsx bin/visitor-realism-prompt-ab.ts --json --out data/phase25-exit/af329/report.json
 *
 * 退出码：0 = 两分支都至少完成 1 轮；2 = 模型调用失败；1 = 参数或环境错误。
 */
import 'reflect-metadata';

import type { ConfigService } from '@nestjs/config';
import { config as loadEnvFile } from 'dotenv';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { auditSession } from './visitor-text-humanization-audit.js';
import { LlmService } from '../src/agent/llm/llm.service.js';
import type { LlmMessage } from '../src/agent/llm/llm.types.js';
import { DEFAULT_VISITOR_DOUBAO_MODEL } from '../src/agent/visitor/visitor.runtime.js';
import { analyzeDisfluency, aggregateDisfluency } from '../src/auto-practice/metrics/disfluency-analyzer.js';
import type { DisfluencyMetrics } from '../src/auto-practice/metrics/disfluency-lexicon.js';
import {
  buildHumanizationMetrics,
  evaluateHumanization,
  type HumanizationEvaluation,
} from '../src/auto-practice/metrics/humanization-acceptance.js';
import {
  buildRealismAbSystemPrompt,
  buildCounselorMessage,
  REALISM_AB_BASE_SYSTEM,
  REALISM_AB_COUNSELOR_TURNS,
  stripEmotionTags,
} from '../src/shared/realism/realism-prompt-ab.js';

interface AbOptions {
  readonly model: string;
  readonly temperature: number;
  readonly maxTokens: number;
  readonly timeoutMs: number;
  readonly turns: number;
  readonly json: boolean;
  readonly out: string | null;
}

export interface BranchResult {
  readonly mode: 'off' | 'active';
  readonly completedTurns: number;
  readonly failedTurns: number;
  readonly failure: string | null;
  readonly turns: readonly DisfluencyMetrics[];
  readonly metrics: Readonly<Record<string, number | null>>;
  readonly typeCounts: {
    readonly filler: number;
    readonly pause: number;
    readonly repetition: number;
    readonly repair: number;
    readonly trailoff: number;
    readonly elongation: number;
  };
  readonly auditEvaluation: HumanizationEvaluation;
  readonly activeHypothetical: HumanizationEvaluation | null;
}

interface AbReport {
  readonly model: string;
  readonly temperature: number;
  readonly turnsPerBranch: number;
  readonly calls: number;
  readonly failures: number;
  readonly promptBlockChars: number;
  readonly activePromptHasBlock: boolean;
  readonly offPromptHasBlock: boolean;
  readonly off: BranchResult;
  readonly active: BranchResult;
  readonly delta: Readonly<Record<string, number | null>>;
}

type Generate = (messages: readonly LlmMessage[]) => Promise<string>;

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

function parseOptions(argv: readonly string[]): AbOptions {
  const model = arg('--model') ?? process.env['VISITOR_DOUBAO_MODEL']?.trim() ?? DEFAULT_VISITOR_DOUBAO_MODEL;
  const turns = Math.min(REALISM_AB_COUNSELOR_TURNS.length, Math.max(1, numberArg('--turns', 6)));
  const outArg = arg('--out');
  return {
    model,
    temperature: numberArg('--temperature', 0.6),
    maxTokens: numberArg('--max-tokens', 160),
    timeoutMs: numberArg('--timeout-ms', 45_000),
    turns,
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

/**
 * 跑一个分支：同一 system prompt，逐步追加咨询师与来访者消息。
 *
 * 失败即停，不把缺轮的上下文继续喂给模型；失败数如实上报。
 *
 * @param mode off / active
 * @param generate 单次生成函数
 * @param maxTurns 最多轮次
 * @returns 分支原始文本与失败信息
 */
export async function runBranch(
  mode: 'off' | 'active',
  generate: Generate,
  maxTurns: number,
): Promise<{ texts: string[]; failedTurns: number; failure: string | null }> {
  const messages: LlmMessage[] = [{ role: 'system', content: buildRealismAbSystemPrompt(mode) }];
  const texts: string[] = [];
  for (let index = 0; index < maxTurns; index += 1) {
    messages.push({ role: 'user', content: buildCounselorMessage(REALISM_AB_COUNSELOR_TURNS[index]) });
    try {
      const raw = await generate([...messages]);
      const text = stripEmotionTags(raw);
      if (text.length === 0) throw new Error('模型返回空正文');
      texts.push(text);
      messages.push({ role: 'assistant', content: text });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { texts, failedTurns: 1, failure: message };
    }
  }
  return { texts, failedTurns: 0, failure: null };
}

export function buildBranchResult(
  mode: 'off' | 'active',
  texts: readonly string[],
  failedTurns: number,
  failure: string | null,
): BranchResult {
  const turns = texts.map((text) => analyzeDisfluency(text)).filter((metrics) => metrics.normalizedLength > 0);
  const aggregate = aggregateDisfluency(turns);
  const events = turns.reduce((sum, turn) => sum + turn.events, 0);
  const eventTurns = turns.filter((turn) => turn.hasEvent).length;
  const chars = turns.reduce((sum, turn) => sum + turn.normalizedLength, 0);
  const metrics = buildHumanizationMetrics(turns.length, events, eventTurns, chars, aggregate.typeCounts);
  return {
    mode,
    completedTurns: turns.length,
    failedTurns,
    failure: failure === null ? null : failure.slice(0, 160),
    turns,
    metrics,
    typeCounts: aggregate.typeCounts,
    auditEvaluation: auditSession(`${mode}-branch`, turns, 'audit').evaluation,
    activeHypothetical: mode === 'active' ? evaluateHumanization(metrics, { realismMode: 'active', turns: turns.length }) : null,
  };
}

export function buildDelta(off: BranchResult, active: BranchResult): Readonly<Record<string, number | null>> {
  const keys = [
    'text.disfluency.events_per_turn',
    'text.disfluency.event_turn_rate',
    'text.disfluency.density_per100',
    'text.disfluency.repair_per_turn',
  ];
  const delta: Record<string, number | null> = {};
  for (const key of keys) {
    const left = off.metrics[key];
    const right = active.metrics[key];
    delta[key] = left === null || right === null ? null : right - left;
  }
  return delta;
}

function createGenerator(llm: LlmService, options: AbOptions): Generate {
  return async (messages) => {
    let text = '';
    let errorCode: string | undefined;
    let errorMessage: string | undefined;
    for await (const chunk of llm.streamChat(messages, {
      provider: 'doubao',
      model: options.model,
      temperature: options.temperature,
      maxTokens: options.maxTokens,
      timeoutMs: options.timeoutMs,
      tenantId: 'af329-realism-ab',
      userId: 'af329-realism-ab',
      traceId: `af329-${Date.now()}`,
    })) {
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

function formatNumber(value: number | null | undefined): string {
  return value === null || value === undefined ? 'n/a' : value.toFixed(6);
}

function printHuman(report: AbReport): void {
  console.log('来访者真人度 prompt A/B');
  console.log(
    `模型 ${report.model} | 温度 ${report.temperature} | 每分支 ${report.turnsPerBranch} 轮 | 调用 ${report.calls} | 失败 ${report.failures}`,
  );
  console.log(
    `prompt: active 含真人度块 ${report.activePromptHasBlock}（${report.promptBlockChars} 字）；off 含块 ${report.offPromptHasBlock}`,
  );
  for (const branch of [report.off, report.active]) {
    const counts = branch.typeCounts;
    console.log(
      `${branch.mode}: ${branch.completedTurns} 轮（失败 ${branch.failedTurns}）| ` +
        `事件/轮 ${formatNumber(branch.metrics['text.disfluency.events_per_turn'])} | ` +
        `轮次率 ${formatNumber(branch.metrics['text.disfluency.event_turn_rate'])} | ` +
        `密度 ${formatNumber(branch.metrics['text.disfluency.density_per100'])} | ` +
        `修正/轮 ${formatNumber(branch.metrics['text.disfluency.repair_per_turn'])} | ` +
        `filler ${counts.filler} / pause ${counts.pause} / repetition ${counts.repetition} / repair ${counts.repair}`,
    );
    if (branch.failure !== null) console.log(`  failure: ${branch.failure}`);
  }
  console.log(
    `delta active-off: 事件/轮 ${formatNumber(report.delta['text.disfluency.events_per_turn'])} | ` +
      `轮次率 ${formatNumber(report.delta['text.disfluency.event_turn_rate'])} | ` +
      `密度 ${formatNumber(report.delta['text.disfluency.density_per100'])} | ` +
      `修正/轮 ${formatNumber(report.delta['text.disfluency.repair_per_turn'])}`,
  );
  if (report.active.activeHypothetical) {
    console.log(`active 假设性判据: ${report.active.activeHypothetical.status}（${report.active.activeHypothetical.reason}）`);
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

  const offRaw = await runBranch('off', generate, options.turns);
  const activeRaw = await runBranch('active', generate, options.turns);
  const off = buildBranchResult('off', offRaw.texts, offRaw.failedTurns, offRaw.failure);
  const active = buildBranchResult('active', activeRaw.texts, activeRaw.failedTurns, activeRaw.failure);

  const activePrompt = buildRealismAbSystemPrompt('active');
  const offPrompt = buildRealismAbSystemPrompt('off');
  const report: AbReport = {
    model: options.model,
    temperature: options.temperature,
    turnsPerBranch: options.turns,
    calls: options.turns * 2,
    failures: off.failedTurns + active.failedTurns,
    promptBlockChars: activePrompt.length - offPrompt.length,
    activePromptHasBlock: activePrompt !== offPrompt,
    offPromptHasBlock: offPrompt !== REALISM_AB_BASE_SYSTEM,
    off,
    active,
    delta: buildDelta(off, active),
  };

  if (options.out) {
    mkdirSync(dirname(options.out), { recursive: true });
    writeFileSync(options.out, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  }
  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    printHuman(report);
  }

  if (report.failures > 0) process.exitCode = 2;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[FAIL] ${message}`);
    process.exitCode = 1;
  });
}
