#!/usr/bin/env node
// V2026-11-22 建立 (AF-232 · 来访者模拟器 Seed Character 2×2 影子对照 CLI):
//   职责: 生成 12 场固定脚本会话 -> 去身份盲评 -> 客观指标 + 预登记门槛 -> 报告.
//   边界: 离线运行；不启动服务、不写库、不接生产；报告不含台词原文.

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { createRaterEndpoint, ratePacketWithRater, type RaterEndpoint } from './realism-rater-runtime.js';
import {
  analyzeArmObjective,
  analyzeArmScores,
  evaluateGates,
  projectVisitorSpeech,
  type SimArmObjective,
  type SimArmScores,
  type SimDifficulty,
  type SimPromptVariant,
  type SimScoredSession,
  type SimTurnRecord,
  type SimVerdict,
  type SimRaterScore,
} from './visitor-sim-analysis.js';
import { COUNSELOR_SCRIPT } from './visitor-sim-prompts.js';
import { generateSession, SHADOW_ARMS, writeGeneratedSession, type GeneratedSession, type ShadowArm } from './visitor-sim-runtime.js';
import { buildRealismBlindPackets } from '../src/auto-practice/metrics/visitor-realism-blind-pack.js';
import {
  deriveRealismPacketId,
  REALISM_DIMENSION_LABELS,
  REALISM_DIMENSIONS,
  type RealismBlindPacket,
} from '../src/auto-practice/metrics/visitor-realism-rating.js';
import { VISITOR_POOL_TEMPLATE_SEEDS } from '../src/counselor/config/visitor-pool-seed.js';

const DEFAULT_OUT = join('data', 'phase25-exit', 'af232-seed-character-visitor');
const DEFAULT_PERSONAS = [
  'vpt_self_worth_intellectualization_l1',
  'vpt_intimate_avoidance_l1',
  'vpt_parenting_projection_l1',
  'vpt_grief_avoidance_l1',
] as const;
const DEFAULT_DIFFICULTIES: readonly SimDifficulty[] = ['L1', 'L2', 'L3'];

function arg(name: string, fallback: string | null = null): string | null {
  const index = process.argv.indexOf(name);
  if (index === -1 || index + 1 >= process.argv.length) return fallback;
  return process.argv[index + 1];
}

function hasFlag(name: string): boolean {
  return process.argv.includes(name);
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

function splitCsv(name: string, fallback: readonly string[]): readonly string[] {
  const value = arg(name);
  if (value === null || value.trim().length === 0) return fallback;
  return value
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function readJson<T>(file: string): T {
  return JSON.parse(readFileSync(file, 'utf8')) as T;
}

function writeJson(file: string, value: unknown): void {
  mkdirSync(join(file, '..'), { recursive: true });
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function mapLimit<T, R>(items: readonly T[], limit: number, task: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results: R[] = Array.from({ length: items.length }, () => null as unknown as R);
  let next = 0;
  async function worker(): Promise<void> {
    while (true) {
      const index = next;
      next += 1;
      if (index >= items.length) return;
      results[index] = await task(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, () => worker()));
  return results;
}

function envRequired(key: string): string {
  const value = process.env[key]?.trim() ?? '';
  if (value.length === 0) fail(`缺少 ${key}（不会打印密钥）`);
  return value;
}

function resolveArm(key: string): ShadowArm {
  const arm = SHADOW_ARMS.find((item) => item.key === key);
  if (arm === undefined) fail(`未知 arm：${key}`);
  return arm;
}

function resolveDifficulty(value: string): SimDifficulty {
  if (value === 'L1' || value === 'L2' || value === 'L3') return value;
  fail(`未知难度：${value}`);
}

const PROMPT_VARIANTS: readonly SimPromptVariant[] = ['shared', 'seed-v1', 'seed-v2', 'seed-v3', 'seed-v4', 'seed-v5'];

function resolvePromptVariant(value: unknown): SimPromptVariant {
  if (typeof value === 'string' && (PROMPT_VARIANTS as readonly string[]).includes(value)) {
    return value as SimPromptVariant;
  }
  return 'shared';
}

function providerConfig(arm: ShadowArm): { baseUrl: string; apiKey: string } {
  if (arm.provider === 'doubao') {
    const baseUrl = process.env['LLM_DOUBAO_BASE_URL']?.trim();
    return {
      baseUrl: baseUrl === undefined || baseUrl.length === 0 ? 'https://ark.cn-beijing.volces.com/api/v3' : baseUrl,
      apiKey: envRequired('LLM_DOUBAO_API_KEY'),
    };
  }
  const baseUrl = process.env.MINIMAX_BASE_URL?.trim();
  return {
    baseUrl: baseUrl === undefined || baseUrl.length === 0 ? 'https://api.minimax.cn' : baseUrl,
    apiKey: envRequired('MINIMAX_API_KEY'),
  };
}

function loadGeneratedSessions(dir: string): readonly GeneratedSession[] {
  if (!existsSync(dir)) return [];
  const files = readdirSync(dir).filter((file) => file.endsWith('.json'));
  const sessions: GeneratedSession[] = [];
  for (const file of files) {
    const parsed = readJson<Record<string, unknown>>(join(dir, file));
    const meta = (parsed['meta'] ?? {}) as Record<string, unknown>;
    const messagesRaw = Array.isArray(parsed['messages']) ? parsed['messages'] : [];
    const messages = messagesRaw
      .filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null)
      .map((item, index) => {
        const role = item['role'] === 'visitor' ? ('visitor' as const) : ('counselor' as const);
        const text = typeof item['text'] === 'string' ? item['text'] : '';
        return {
          role,
          text: role === 'visitor' ? projectVisitorSpeech(text) : text,
          turnIndex: typeof item['turnIndex'] === 'number' ? item['turnIndex'] : Math.floor(index / 2) + 1,
        };
      })
      .filter((item) => item.text.trim().length > 0);
    const turnsRaw = Array.isArray(parsed['turns']) ? parsed['turns'] : [];
    const turns: SimTurnRecord[] = turnsRaw
      .filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null)
      .map((item, index) => {
        const raw =
          typeof item['visitorRaw'] === 'string' ? item['visitorRaw'] : typeof item['visitor'] === 'string' ? item['visitor'] : '';
        return {
          turnIndex: typeof item['turnIndex'] === 'number' ? item['turnIndex'] : index + 1,
          counselor: typeof item['counselor'] === 'string' ? item['counselor'] : '',
          visitor: projectVisitorSpeech(raw),
          visitorRaw: raw,
          firstTokenMs: typeof item['firstTokenMs'] === 'number' ? item['firstTokenMs'] : 0,
          totalMs: typeof item['totalMs'] === 'number' ? item['totalMs'] : 0,
          promptTokens: typeof item['promptTokens'] === 'number' ? item['promptTokens'] : 0,
          completionTokens: typeof item['completionTokens'] === 'number' ? item['completionTokens'] : 0,
          reasoningTokens: typeof item['reasoningTokens'] === 'number' ? item['reasoningTokens'] : 0,
          finishReason: typeof item['finishReason'] === 'string' ? item['finishReason'] : '',
        };
      });
    sessions.push({
      sessionId: String(parsed['id'] ?? file.replace(/\.json$/u, '')),
      arm: String(meta['arm'] ?? '?'),
      provider: meta['provider'] === 'doubao' ? 'doubao' : 'minimax',
      model: String(meta['model'] ?? '?'),
      promptVariant: resolvePromptVariant(meta['promptVariant']),
      personaId: String(parsed['characterSlug'] ?? '?'),
      personaLabel: String(parsed['characterLabel'] ?? '?'),
      difficulty: meta['difficulty'] === 'L1' || meta['difficulty'] === 'L2' || meta['difficulty'] === 'L3' ? meta['difficulty'] : 'L1',
      scene: parsed['scene'] === 'online_voice' || parsed['scene'] === 'online_text' ? parsed['scene'] : 'in_person',
      ageRange: String(meta['ageRange'] ?? '18-60'),
      turns,
      messages,
    });
  }
  return sessions.sort((left, right) => left.sessionId.localeCompare(right.sessionId));
}

function expectedSessionIds(
  arms: readonly ShadowArm[],
  personas: readonly string[],
  difficulties: readonly SimDifficulty[],
): readonly string[] {
  return arms.flatMap((arm) =>
    personas.flatMap((persona) => difficulties.map((difficulty) => `af232_${arm.key}_${persona}_${difficulty}`)),
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function generateAll(input: {
  readonly outDir: string;
  readonly arms: readonly ShadowArm[];
  readonly personas: readonly string[];
  readonly difficulties: readonly SimDifficulty[];
  readonly temperature: number;
  readonly maxOutputTokens: number;
  readonly timeoutMs: number;
  readonly thinking: 'auto' | 'disabled' | 'enabled';
  readonly concurrency: number;
  readonly resume: boolean;
}): Promise<void> {
  const sessionsDir = join(input.outDir, 'sessions');
  mkdirSync(sessionsDir, { recursive: true });
  const tasks = input.arms.flatMap((arm) =>
    input.personas.flatMap((personaId) => input.difficulties.map((difficulty) => ({ arm, personaId, difficulty }))),
  );
  const expected = expectedSessionIds(input.arms, input.personas, input.difficulties);
  const existing = loadGeneratedSessions(sessionsDir);
  const existingIds = new Set(existing.map((session) => session.sessionId));
  const pending = tasks.filter((task) => !input.resume || !existingIds.has(`af232_${task.arm.key}_${task.personaId}_${task.difficulty}`));
  console.log(
    `[PLAN] sessions=${expected.length} existing=${existing.length} pending=${pending.length} arms=${input.arms.map((arm) => arm.key).join(',')}`,
  );
  if (pending.length === 0) {
    console.log('[GEN] 无待生成会话，跳过');
    return;
  }

  await mapLimit(pending, input.concurrency, async (task) => {
    const seed = VISITOR_POOL_TEMPLATE_SEEDS.find((item) => item.id === task.personaId);
    if (seed === undefined) fail(`缺少 persona：${task.personaId}`);
    const config = providerConfig(task.arm);
    let lastError: unknown;
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      try {
        const session = await generateSession({
          arm: task.arm,
          seed,
          difficulty: task.difficulty,
          baseUrl: config.baseUrl,
          apiKey: config.apiKey,
          temperature: input.temperature,
          maxOutputTokens: input.maxOutputTokens,
          timeoutMs: input.timeoutMs,
          thinking: input.thinking,
          script: COUNSELOR_SCRIPT,
        });
        const file = writeGeneratedSession(sessionsDir, session);
        console.log(`[SESSION] ${session.sessionId} -> ${file}`);
        return session;
      } catch (error) {
        lastError = error;
        console.warn(
          `[RETRY] ${task.arm.key}/${task.personaId}/${task.difficulty} 第 ${attempt}/2 次失败：${error instanceof Error ? error.message : String(error)}`,
        );
        if (attempt < 2) await sleep(task.arm.provider === 'minimax' ? 30_000 : 3000);
      }
    }
    throw lastError;
  });

  const after = loadGeneratedSessions(sessionsDir);
  const missing = expected.filter((id) => !after.some((session) => session.sessionId === id));
  if (missing.length > 0) {
    fail(`生成后仍缺会话：${missing.join(',')}`);
  }
  writeJson(join(input.outDir, 'generation-manifest.json'), {
    generatedAt: new Date().toISOString(),
    arms: input.arms,
    personas: input.personas,
    difficulties: input.difficulties,
    scriptTurns: COUNSELOR_SCRIPT.length,
    sessions: after.map((session) => ({
      sessionId: session.sessionId,
      arm: session.arm,
      personaId: session.personaId,
      difficulty: session.difficulty,
      scene: session.scene,
    })),
  });
}

type ScoreCache = Record<
  string,
  | {
      readonly r1: SimRaterScore;
      readonly r2: SimRaterScore;
    }
  | undefined
>;

function scoreFromAttempt(
  attempt: Awaited<ReturnType<typeof ratePacketWithRater>>,
  raterId: 'R1' | 'R2',
  provider: 'minimax' | 'doubao',
  model: string,
): SimRaterScore {
  const dimensions = Object.fromEntries(
    REALISM_DIMENSIONS.map((dimension) => [dimension, attempt.rating.dimensions[dimension].score]),
  ) as Record<(typeof REALISM_DIMENSIONS)[number], number>;
  return {
    raterId,
    provider,
    model,
    dimensions,
    overall: attempt.rating.overall,
    parseRetries: attempt.parseRetries,
    promptTokens: attempt.calls.reduce((sum, call) => sum + call.promptTokens, 0),
    completionTokens: attempt.calls.reduce((sum, call) => sum + call.completionTokens, 0),
    reasoningTokens: attempt.calls.reduce((sum, call) => sum + call.reasoningTokens, 0),
  };
}

async function ratePacketPair(input: {
  readonly packet: RealismBlindPacket;
  readonly r1: RaterEndpoint;
  readonly r2: RaterEndpoint;
}): Promise<{ readonly r1: SimRaterScore; readonly r2: SimRaterScore }> {
  const [r1Attempt, r2Attempt] = await Promise.all([
    ratePacketWithRater({
      endpoint: input.r1,
      packet: input.packet,
      raterId: 'R1',
      timeoutMs: 60_000,
      maxParseRetries: 2,
      maxOutputTokens: 2048,
    }),
    ratePacketWithRater({
      endpoint: input.r2,
      packet: input.packet,
      raterId: 'R2',
      timeoutMs: 60_000,
      maxParseRetries: 2,
      maxOutputTokens: 2048,
    }),
  ]);
  return {
    r1: scoreFromAttempt(r1Attempt, 'R1', 'minimax', 'MiniMax-M3.1-Flash'),
    r2: scoreFromAttempt(r2Attempt, 'R2', 'doubao', 'doubao-seed-2-1-lite-260915'),
  };
}

function annotateCounselorSilence(packet: RealismBlindPacket): RealismBlindPacket {
  const kept = packet.turns.filter((turn) => {
    if (turn.role !== 'counselor') return true;
    const trimmed = turn.text.trim();
    return trimmed !== '……' && trimmed !== '...';
  });
  return kept.length === packet.turns.length ? packet : { ...packet, turns: kept };
}

async function scoreAll(input: {
  readonly outDir: string;
  readonly seed: number;
  readonly maxPackets: number;
  readonly concurrency: number;
  readonly resume: boolean;
  readonly scoreLimit: number | null;
}): Promise<{
  readonly sessions: readonly GeneratedSession[];
  readonly blind: ReturnType<typeof buildRealismBlindPackets>;
  readonly scores: readonly SimScoredSession[];
  readonly failures: Readonly<Record<string, string>>;
}> {
  const sessions = loadGeneratedSessions(join(input.outDir, 'sessions'));
  if (sessions.length === 0) fail('sessions 为空，先跑 generate');
  const blind = buildRealismBlindPackets(sessions, { maxPackets: input.maxPackets, minVisitorTurns: 8, seed: input.seed, maxMessages: 24 });
  console.log(`[BLIND] candidates=${blind.candidateSessions} packets=${blind.packets.length} excluded=${JSON.stringify(blind.excluded)}`);
  if (blind.packets.length !== sessions.length) {
    console.warn(`[WARN] 生成的 ${sessions.length} 场只入选 ${blind.packets.length} 个盲评包；报告会记录剔除计数`);
  }

  const blindMap: Record<string, { sessionId: string; arm: string; difficulty: SimDifficulty; personaId: string; promptVariant: string }> =
    {};
  for (const session of sessions) {
    const packetId = deriveRealismPacketId(session.sessionId, input.seed);
    blindMap[packetId] = {
      sessionId: session.sessionId,
      arm: session.arm,
      difficulty: session.difficulty,
      personaId: session.personaId,
      promptVariant: session.promptVariant,
    };
  }
  writeJson(join(input.outDir, 'blind-map.json'), { seed: input.seed, map: blindMap });

  const cacheFile = join(input.outDir, 'ratings-cache.json');
  const cache = input.resume && existsSync(cacheFile) ? readJson<ScoreCache>(cacheFile) : {};
  const pending = blind.packets
    .slice(0, input.scoreLimit === null ? undefined : Math.max(0, input.scoreLimit))
    .filter((packet) => cache[packet.packetId] === undefined);
  console.log(`[SCORE] packets=${blind.packets.length} cached=${Object.keys(cache).length} pending=${pending.length}`);

  const r1: RaterEndpoint = createRaterEndpoint(
    { provider: 'minimax', model: 'MiniMax-M3.1-Flash', temperature: 0.1, thinking: 'auto', reasoningEffort: 'low' },
    { timeoutMs: 60_000, env: process.env },
  );
  const r2: RaterEndpoint = createRaterEndpoint(
    { provider: 'doubao', model: 'doubao-seed-2-1-lite-260915', temperature: 0.1, thinking: 'disabled' },
    { timeoutMs: 60_000, env: process.env },
  );

  const failuresFile = join(input.outDir, 'score-failures.json');
  const failures: Record<string, string> = {};
  await mapLimit(pending, input.concurrency, async (packet) => {
    try {
      let scored: { readonly r1: SimRaterScore; readonly r2: SimRaterScore };
      try {
        scored = await ratePacketPair({ packet, r1, r2 });
      } catch (error) {
        const repaired = annotateCounselorSilence(packet);
        if (repaired === packet) throw error;
        console.warn(`[SCORE-RETRY] ${packet.packetId} 咨询师沉默轮标注后重评`);
        scored = await ratePacketPair({ packet: repaired, r1, r2 });
      }
      cache[packet.packetId] = scored;
      writeJson(cacheFile, cache);
      console.log(`[SCORE] ${packet.packetId} r1=${scored.r1.overall} r2=${scored.r2.overall} cache=${Object.keys(cache).length}`);
    } catch (error) {
      failures[packet.packetId] = error instanceof Error ? error.message : String(error);
      writeJson(failuresFile, failures);
      console.error(`[SCORE-FAIL] ${packet.packetId} ${failures[packet.packetId]}`);
    }
  });
  writeJson(failuresFile, failures);

  const scoredSessions: SimScoredSession[] = [];
  for (const session of sessions) {
    const packetId = deriveRealismPacketId(session.sessionId, input.seed);
    const entry = cache[packetId];
    if (entry === undefined) continue;
    scoredSessions.push({
      sessionId: session.sessionId,
      arm: session.arm,
      difficulty: session.difficulty,
      scores: [entry.r1, entry.r2],
    });
  }
  writeJson(join(input.outDir, 'scores.json'), {
    packetId: 'derived-from-session-id',
    sessions: scoredSessions,
    cacheEntries: Object.keys(cache).length,
    blindPackets: blind.packets.length,
    excluded: blind.excluded,
    failures,
  });
  return { sessions, blind, scores: scoredSessions, failures };
}

function tableObjective(rows: readonly SimArmObjective[]): string[] {
  const lines = [
    '| arm | provider | model | prompt | 场次 | 轮次 | AI暴露 | 建议 | 总结 | 剧情 | 投影后括号 | 原始括号 | 超长率 | 提问率 | L3短答率 | P95首token | 标记错误率 | 过度配合 |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
  ];
  for (const row of rows) {
    const l3 = row.byDifficulty.find((item) => item.difficulty === 'L3');
    lines.push(
      `| ${row.arm} | ${row.provider} | ${row.model} | ${row.promptVariant} | ${row.overall.sessions} | ${row.overall.turns} | ${row.overall.aiRevealCount} | ${row.overall.adviceCount} | ${row.overall.summaryCount} | ${row.overall.plotCount} | ${row.overall.stageDirectionCount} | ${row.overall.rawStageDirectionCount} | ${row.overall.longTurnRate} | ${row.overall.questionRate} | ${l3?.shortTurnRate ?? 0} | ${row.overall.firstTokenP95Ms}ms | ${row.overall.tagErrorRate} | ${row.overall.cooperationIndex} |`,
    );
  }
  return lines;
}

function tableScores(rows: readonly SimArmScores[]): string[] {
  const lines = [
    '| arm | 场次 | 均分 | std | 4分占比 | 跨评分员κ | 绝对差 | 自然度 | 情绪连续 | 话轮形态 | 场景一致 | 关系在场 |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
  ];
  for (const row of rows) {
    lines.push(
      `| ${row.arm} | ${row.sessions} | ${row.meanOverall} | ${row.scoreStd} | ${row.fourRate} | ${row.agreement.linearWeightedKappa ?? 'null'} | ${row.meanAbsOverallDelta} | ${row.meanDimensions.naturalness} | ${row.meanDimensions.emotional_continuity} | ${row.meanDimensions.turn_shape} | ${row.meanDimensions.scene_congruence} | ${row.meanDimensions.relational_presence} |`,
    );
  }
  return lines;
}

function tableGates(
  gates: readonly { id: string; kind: string; arm: string; passed: boolean; observed: string; threshold: string }[],
): string[] {
  const lines = ['| arm | 类型 | 判据 | 观测 | 门槛 | 结果 |', '| --- | --- | --- | --- | --- | --- |'];
  for (const gate of gates) {
    lines.push(`| ${gate.arm} | ${gate.kind} | ${gate.id} | ${gate.observed} | ${gate.threshold} | ${gate.passed ? 'PASS' : 'FAIL'} |`);
  }
  return lines;
}

function renderSummary(input: {
  readonly objectives: readonly SimArmObjective[];
  readonly scores: readonly SimArmScores[];
  readonly gates: readonly { id: string; kind: string; arm: string; passed: boolean; observed: string; threshold: string }[];
  readonly verdicts: readonly SimVerdict[];
  readonly config: Record<string, unknown>;
  readonly blindCounts: Record<string, unknown>;
}): string {
  const lines = [
    '# 来访者模拟器 Seed Character 影子对照',
    '',
    '> AI 影子对照，不是真人督导双标，不声称临床达标。本任务只验证来访者生成方向，不接生产。',
    '',
    '## 结论',
    '',
  ];
  for (const verdict of input.verdicts) {
    lines.push(
      `- arm ${verdict.arm}: **${verdict.recommendation}**；硬门槛${verdict.hardPassed ? '全过' : `未过 ${verdict.hardFailures.join(',')}`}；软门槛${verdict.softPassed ? '全过' : `未过 ${verdict.softFailures.join(',')}`}。`,
    );
  }
  lines.push(
    '',
    '## 客观指标',
    '',
    ...tableObjective(input.objectives),
    '',
    '## 盲评分数',
    '',
    ...tableScores(input.scores),
    '',
    '## 预登记门槛',
    '',
    ...tableGates(input.gates),
    '',
    '## 运行配置',
    '',
    '```json',
    JSON.stringify(input.config, null, 2),
    '```',
    '',
    '## 盲评包',
    '',
    '```json',
    JSON.stringify(input.blindCounts, null, 2),
    '```',
    '',
    '## 限制',
    '',
    '- 12 场、4 个官方 persona、每场 12 轮，只够判断方向，不足以做稳定性结论。',
    '- 评分员是 MiniMax-M3.1-Flash 与豆包 Seed 2.1 Lite，不是真人督导师；不能替代临床验收。',
    '- Seed Character 原始输出会出现 screenplay 风格括号动作；本运行统一做语音投影后再评分，硬门槛按投影后可朗读台词判定，原始括号动作计数保留在“原始括号”列。',
    '- 盲评包去掉结构化身份，但台词中的职业/关系线索仍可能被识别。',
    '- 本任务不接生产；即使 pass，也只表示值得进入 feature-flag 灰度，不表示可以替换现网来访者链路。',
  );
  return `${lines.join('\n')}\n`;
}

function summarizeByArm(sessions: readonly GeneratedSession[]): readonly SimArmObjective[] {
  const arms = [...new Set(sessions.map((session) => session.arm))].sort();
  return arms.map((arm) => analyzeArmObjective(sessions.filter((session) => session.arm === arm)));
}

async function main(): Promise<void> {
  const mode = arg('--mode', 'all');
  if (mode !== 'generate' && mode !== 'score' && mode !== 'all') fail('--mode 只能是 generate|score|all');
  const outDir = arg('--out', DEFAULT_OUT) ?? DEFAULT_OUT;
  const armKeys = splitCsv(
    '--arms',
    SHADOW_ARMS.map((arm) => arm.key),
  );
  const arms = armKeys.map(resolveArm);
  const personas = splitCsv('--persona-ids', DEFAULT_PERSONAS);
  const difficulties = splitCsv('--difficulties', DEFAULT_DIFFICULTIES).map(resolveDifficulty);
  const concurrency = Math.max(1, Math.floor(numberArg('--concurrency', 4)));
  const temperature = numberArg('--temperature', 0.8);
  const maxOutputTokens = Math.floor(numberArg('--max-output-tokens', 200));
  const timeoutMs = Math.floor(numberArg('--timeout-ms', 60_000));
  const thinkingRaw = arg('--thinking', 'disabled');
  if (thinkingRaw !== 'auto' && thinkingRaw !== 'disabled' && thinkingRaw !== 'enabled') fail('--thinking 只能是 auto|disabled|enabled');
  const scoreSeed = Math.floor(numberArg('--score-seed', 20_261_122));
  const maxPackets = Math.floor(numberArg('--max-packets', 48));
  const scoreLimitRaw = arg('--score-limit');
  const scoreLimit = scoreLimitRaw === null ? null : Number(scoreLimitRaw);
  if (scoreLimit !== null && !Number.isFinite(scoreLimit)) fail('--score-limit 必须是数字');
  const resume = hasFlag('--resume');

  mkdirSync(outDir, { recursive: true });
  const config = {
    mode,
    outDir,
    arms: arms.map((arm) => ({ key: arm.key, provider: arm.provider, model: arm.model, promptVariant: arm.promptVariant })),
    personas,
    difficulties,
    concurrency,
    temperature,
    maxOutputTokens,
    timeoutMs,
    thinking: thinkingRaw,
    scoreSeed,
    maxPackets,
    scoreLimit,
    scriptTurns: COUNSELOR_SCRIPT.length,
    speechProjection: 'projectVisitorSpeech: 剥括号/星号动作，纯动作轮补 …… 或 [pause:0.5]',
    scoreModels: { r1: 'MiniMax-M3.1-Flash', r2: 'doubao-seed-2-1-lite-260915' },
  };
  writeJson(join(outDir, 'run-config.json'), config);

  if (mode === 'generate' || mode === 'all') {
    await generateAll({
      outDir,
      arms,
      personas,
      difficulties,
      temperature,
      maxOutputTokens,
      timeoutMs,
      thinking: thinkingRaw,
      concurrency,
      resume,
    });
  }
  if (mode === 'generate') {
    console.log('[DONE] 生成完成；未评分');
    return;
  }

  const { sessions, blind, scores, failures } = await scoreAll({ outDir, seed: scoreSeed, maxPackets, concurrency, resume, scoreLimit });
  const objectives = summarizeByArm(sessions);
  const scoresByArm = [...new Set(scores.map((score) => score.arm))]
    .sort()
    .map((arm) => analyzeArmScores(scores.filter((score) => score.arm === arm)));
  const seedArms = arms.filter((arm) => arm.provider === 'doubao').map((arm) => arm.key);
  const { gates, verdicts } = evaluateGates({
    objectives,
    scores: scoresByArm,
    baselineArm: 'A',
    seedArms,
    thinkingDisabled: thinkingRaw === 'disabled',
  });
  const report = {
    protocolVersion: 'af232-visitor-shadow-v1',
    disclaimer: 'AI 影子对照，不是真人督导双标，不声称临床达标；本任务不接生产。',
    config,
    blind: {
      packets: blind.packets.length,
      candidateSessions: blind.candidateSessions,
      excluded: blind.excluded,
      eligibleByScene: blind.eligibleByScene,
    },
    objectives,
    scores: scoresByArm,
    gates,
    verdicts,
    scoreFailures: failures,
    dimensionLabels: REALISM_DIMENSION_LABELS,
    dimensions: REALISM_DIMENSIONS,
    generatedAt: new Date().toISOString(),
  };
  writeJson(join(outDir, 'report.json'), report);
  writeFileSync(
    join(outDir, 'summary.md'),
    renderSummary({
      objectives,
      scores: scoresByArm,
      gates,
      verdicts,
      config,
      blindCounts: report.blind,
    }),
    'utf8',
  );
  console.log(`[DONE] report=${join(outDir, 'report.json')} summary=${join(outDir, 'summary.md')}`);
  for (const verdict of verdicts)
    console.log(`[VERDICT] ${verdict.arm} ${verdict.recommendation} hard=${verdict.hardPassed} soft=${verdict.softPassed}`);
  console.log(`[STATS] sessions=${sessions.length} scored=${scores.length} gates=${gates.length}`);
}

main().catch((error: unknown) => {
  console.error(`[FAIL] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
