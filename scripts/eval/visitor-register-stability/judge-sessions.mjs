// AF-465 · 读取本地会话，做双 AI 盲评并计算机制门槛。
// 盲评只喂角色语域摘要 + 甲/乙匿名台词；不传 mode、roleKey、base/active 标签。

import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { RATING_TURNS } from './counselor-script.mjs';
import { buildBlindPrompt, buildRoleSummary, evaluateGates, mapPreference, mean, parseBlindRating, round } from './metrics.mjs';

const ROOT = path.resolve(import.meta.dirname, '../../..');
const OUT_ROOT = path.join(ROOT, 'data', 'eval-reports', 'visitor-register-stability');
const JUDGE_TIMEOUT_MS = 120_000;

const rating = await import(pathToFileURL(path.join(ROOT, 'dist', 'auto-practice', 'metrics', 'visitor-register-rating.js')));
const calibration = await import(pathToFileURL(path.join(ROOT, 'dist', 'shared', 'speech-register', 'speech-register.calibration.js')));

function parseArgs(argv) {
  const options = { runId: '', judges: 'doubao,minimax', reuse: false };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--run-id') {
      options.runId = argv[index + 1];
      index += 1;
    } else if (argv[index] === '--judges') {
      options.judges = argv[index + 1];
      index += 1;
    } else if (argv[index] === '--reuse') {
      options.reuse = true;
    }
  }
  return options;
}

function loadEnv() {
  const values = {};
  const raw = readFileSync(path.join(ROOT, '.env'), 'utf8');
  for (const line of raw.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }
  return values;
}

function normalizeOpenAiBase(raw, defaultBase, addV1) {
  let base = String(raw || defaultBase).trim();
  while (base.endsWith('/')) base = base.slice(0, -1);
  if (base.toLowerCase().endsWith('/chat/completions')) base = base.slice(0, -'/chat/completions'.length);
  if (addV1 && !base.endsWith('/v1')) base = `${base}/v1`;
  return base;
}

function resolveJudges(env, selectedText) {
  const all = {
    doubao: {
      id: 'doubao',
      label: 'Doubao Seed 2.1 Pro',
      model: env.LLM_DOUBAO_MODEL || 'doubao-seed-2-1-pro-260915',
      baseUrl: normalizeOpenAiBase(env.LLM_DOUBAO_BASE_URL, 'https://ark.cn-beijing.volces.com/api/v3', false),
      apiKey: env.LLM_DOUBAO_API_KEY || '',
      family: 'doubao',
    },
    minimax: {
      id: 'minimax',
      label: 'MiniMax M3',
      model: env.MINIMAX_LLM_MODEL || 'MiniMax-M3',
      baseUrl: normalizeOpenAiBase(env.MINIMAX_BASE_URL, 'https://api.minimax.cn', true),
      apiKey: env.MINIMAX_API_KEY || '',
      family: 'minimax',
    },
  };
  const selected = String(selectedText || 'doubao,minimax')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  return selected.map((id) => {
    const judge = all[id];
    if (!judge) throw new Error(`未知评委: ${id}`);
    if (!judge.apiKey) throw new Error(`评委 ${id} 缺少 API key`);
    return judge;
  });
}

function seedFrom(text) {
  return createHash('sha256').update(text).digest().readUInt32BE(0);
}

function mulberry32(seed) {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function callChat(judge, prompt) {
  const body = {
    model: judge.model,
    messages: [
      {
        role: 'system',
        content: '你是严格的语域盲评员。只评语言是否贴合给定社会语域，不做诊断、不评疗效、不评咨询技术。直接输出 JSON，不要输出思考过程。',
      },
      { role: 'user', content: prompt },
    ],
    temperature: 0.2,
    stream: false,
  };
  if (judge.family === 'minimax') {
    body.max_completion_tokens = 3000;
    // MiniMax-M3 的 reasoning_effort 不调深度；thinking.disabled 才真正跳过思维链。
    body.thinking = { type: 'disabled' };
  } else {
    body.max_tokens = 1600;
  }
  const response = await fetch(`${judge.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${judge.apiKey}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(JUDGE_TIMEOUT_MS),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${judge.id} HTTP ${response.status}: ${text.slice(0, 300)}`);
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`${judge.id} 返回非 JSON: ${text.slice(0, 200)}`);
  }
  const content = parsed?.choices?.[0]?.message?.content;
  if (typeof content === 'string' && content.trim().length > 0) return content;
  if (Array.isArray(content)) {
    const joined = content.map((part) => (typeof part === 'string' ? part : (part?.text ?? ''))).join('');
    if (joined.trim().length > 0) return joined;
  }
  throw new Error(`${judge.id} 返回空内容`);
}

function closeTruncatedJson(text) {
  const start = text.indexOf('{');
  if (start < 0) return text;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === '{') depth += 1;
    else if (char === '}') depth -= 1;
  }
  if (inString || depth <= 0) return text;
  return `${text}${'}'.repeat(depth)}`;
}

async function askJudge(judge, prompt, dimensions, debugBasePath, retries = 3) {
  let lastError = '';
  let currentPrompt = prompt;
  for (let attempt = 0; attempt < retries; attempt += 1) {
    try {
      const raw = await callChat(judge, currentPrompt);
      const parsed = parseBlindRating(closeTruncatedJson(raw), dimensions);
      if (parsed) return { parsed, raw };
      lastError = '输出无法解析或四维/证据不完整';
      await writeFile(`${debugBasePath}.failed-${attempt + 1}.txt`, raw, 'utf8');
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await sleep(2_000 * (attempt + 1));
    currentPrompt = `${prompt}\n\n上一次输出未通过校验（${lastError}）。请只输出 JSON，不要解释或代码块。`;
  }
  throw new Error(`${judge.id} 盲评连续失败: ${lastError}`);
}

function stableJson(value) {
  return JSON.stringify(value ?? null);
}

function countDiff(baseRows, activeRows, field) {
  let count = 0;
  const length = Math.min(baseRows.length, activeRows.length);
  for (let index = 0; index < length; index += 1) {
    if (stableJson(baseRows[index][field]) !== stableJson(activeRows[index][field])) count += 1;
  }
  return count;
}

function per100(hits, chars) {
  return chars <= 0 ? 0 : round((Number(hits) / chars) * 100, 3);
}

function averageDimension(entries, side, dimension) {
  return round(
    mean(
      entries.map((entry) => Number(entry.scores[side][dimension])),
      2,
    ),
    2,
  );
}

function preferenceAgreement(entries) {
  if (entries.length < 2) return null;
  const values = entries.map((entry) => entry.preferenceMapped);
  return values.every((value) => value === values[0]);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (!options.runId) throw new Error('缺少 --run-id');
  const runDir = path.join(OUT_ROOT, options.runId);
  const manifest = JSON.parse(readFileSync(path.join(runDir, 'manifest.json'), 'utf8'));
  const metrics = JSON.parse(readFileSync(path.join(runDir, 'metrics.json'), 'utf8'));
  const env = loadEnv();
  const judges = resolveJudges(env, options.judges);
  const dimensions = rating.REGISTER_DIMENSIONS;
  const labels = rating.REGISTER_DIMENSION_LABELS;
  const anchors = rating.REGISTER_ANCHORS;
  const ratingsDir = path.join(runDir, 'judge-raw');
  await mkdir(ratingsDir, { recursive: true });

  let ratings = {
    runId: options.runId,
    protocol: `${rating.REGISTER_RATING_VERSION}-paired`,
    status: rating.REGISTER_RATING_STATUS,
    disclaimer: rating.REGISTER_RATING_DISCLAIMER,
    createdAt: new Date().toISOString(),
    judges: judges.map((judge) => ({ id: judge.id, label: judge.label, model: judge.model, family: judge.family })),
    roles: {},
  };

  const ratingsPath = path.join(runDir, 'ratings.json');
  if (options.reuse) {
    if (!existsSync(ratingsPath)) throw new Error('--reuse 需要已有 ratings.json');
    ratings = JSON.parse(readFileSync(ratingsPath, 'utf8'));
  }

  for (const role of manifest.roles) {
    if (options.reuse && ratings.roles[role]) continue;
    const register = calibration.getVisitorSpeechRegister(role);
    if (!register) throw new Error(`角色 ${role} 缺少语域标定`);
    const roleDir = path.join(runDir, 'sessions', role);
    const baseSession = JSON.parse(readFileSync(path.join(roleDir, 'base.json'), 'utf8'));
    const activeSession = JSON.parse(readFileSync(path.join(roleDir, 'active.json'), 'utf8'));
    if (!baseSession.complete || !activeSession.complete) throw new Error(`${role} 存在未完成会话`);

    const baseTurns = RATING_TURNS.map((turn) => baseSession.rows[turn - 1]?.reply ?? '');
    const activeTurns = RATING_TURNS.map((turn) => activeSession.rows[turn - 1]?.reply ?? '');
    if (baseTurns.some((text) => !text) || activeTurns.some((text) => !text)) throw new Error(`${role} 抽样轮次缺台词`);

    const roleSummary = buildRoleSummary(register);
    const entries = [];
    for (const judge of judges) {
      const random = mulberry32(seedFrom(`${options.runId}:${role}:${judge.id}`));
      const leftMode = random() < 0.5 ? 'base' : 'active';
      const rightMode = leftMode === 'base' ? 'active' : 'base';
      const prompt = buildBlindPrompt({
        roleSummary,
        leftTurns: leftMode === 'base' ? baseTurns : activeTurns,
        rightTurns: rightMode === 'base' ? baseTurns : activeTurns,
        dimensions,
        labels,
        anchors,
        turnNumbers: RATING_TURNS,
      });
      const { parsed, raw } = await askJudge(judge, prompt, dimensions, path.join(ratingsDir, `${role}.${judge.id}`));
      const scores = {
        [leftMode]: parsed.sides.left.scores,
        [rightMode]: parsed.sides.right.scores,
      };
      const evidence = {
        [leftMode]: parsed.sides.left.evidence,
        [rightMode]: parsed.sides.right.evidence,
      };
      await writeFile(path.join(ratingsDir, `${role}.${judge.id}.txt`), raw, 'utf8');
      entries.push({
        judgeId: judge.id,
        leftMode,
        rightMode,
        scores,
        evidence,
        preferenceRaw: parsed.preference,
        preferenceMapped: mapPreference(parsed.preference, leftMode),
        confidence: parsed.confidence,
      });
      process.stdout.write(`[AF-465] 盲评 ${role} ${judge.id} → ${entries[entries.length - 1].preferenceMapped}\n`);
    }

    const blind = { base: {}, active: {} };
    for (const dimension of dimensions) {
      blind.base[dimension] = { mean: averageDimension(entries, 'base', dimension) };
      blind.active[dimension] = { mean: averageDimension(entries, 'active', dimension) };
    }
    const preferenceVotes = {
      base: entries.filter((entry) => entry.preferenceMapped === 'base').length,
      active: entries.filter((entry) => entry.preferenceMapped === 'active').length,
      tie: entries.filter((entry) => entry.preferenceMapped === 'tie').length,
    };
    const direction =
      preferenceVotes.active > preferenceVotes.base ? 'active' : preferenceVotes.base > preferenceVotes.active ? 'base' : 'tie';
    ratings.roles[role] = { blind, preferenceVotes, direction, entries };
  }

  await writeFile(path.join(runDir, 'ratings.json'), `${JSON.stringify(ratings, null, 2)}\n`, 'utf8');

  const analysisRoles = [];
  for (const role of manifest.roles) {
    const sessionDir = path.join(runDir, 'sessions', role);
    const baseSession = JSON.parse(readFileSync(path.join(sessionDir, 'base.json'), 'utf8'));
    const activeSession = JSON.parse(readFileSync(path.join(sessionDir, 'active.json'), 'utf8'));
    const baseMetrics = metrics.roles[role].base;
    const activeMetrics = metrics.roles[role].active;
    const baseChars = baseMetrics.summary.extras.charCount * baseMetrics.summary.turns;
    const activeChars = activeMetrics.summary.extras.charCount * activeMetrics.summary.turns;
    const harm = {
      base: {
        assistantTonePer100: per100(baseMetrics.summary.extras.assistantToneHits, baseChars),
        advicePer100: per100(baseMetrics.summary.extras.adviceHits, baseChars),
        labelPer100: per100(baseMetrics.summary.extras.labelHits, baseChars),
        abstractTermRate: baseMetrics.summary.metrics.abstractTermRate,
        jargonRate: baseMetrics.summary.metrics.jargonRate,
      },
      active: {
        assistantTonePer100: per100(activeMetrics.summary.extras.assistantToneHits, activeChars),
        advicePer100: per100(activeMetrics.summary.extras.adviceHits, activeChars),
        labelPer100: per100(activeMetrics.summary.extras.labelHits, activeChars),
        abstractTermRate: activeMetrics.summary.metrics.abstractTermRate,
        jargonRate: activeMetrics.summary.metrics.jargonRate,
      },
    };
    const bdiMismatchTurns = countDiff(baseSession.rows, activeSession.rows, 'bdiSnapshot');
    const guardrail = {
      bdiMismatchTurns,
      deltaMismatchTurns: countDiff(baseSession.rows, activeSession.rows, 'delta'),
      crisisMismatchTurns: countDiff(baseSession.rows, activeSession.rows, 'crisis'),
      eventMismatchTurns: countDiff(baseSession.rows, activeSession.rows, 'eventTags'),
      baseCrisisDetected: baseMetrics.summary.crisisDetected,
      activeCrisisDetected: activeMetrics.summary.crisisDetected,
      baseDegraded: baseMetrics.summary.degraded,
      activeDegraded: activeMetrics.summary.degraded,
    };
    analysisRoles.push({
      roleKey: role,
      blind: ratings.roles[role].blind,
      preferenceVotes: ratings.roles[role].preferenceVotes,
      direction: ratings.roles[role].direction,
      interJudge: {
        preferenceAgree: preferenceAgreement(ratings.roles[role].entries),
        dimensionDiff: Object.fromEntries(
          rating.REGISTER_DIMENSIONS.map((dimension) => {
            const values = ratings.roles[role].entries.map((entry) => Number(entry.scores.base[dimension]));
            return [dimension, values.length < 2 ? null : round(Math.abs(values[0] - values[1]), 2)];
          }),
        ),
      },
      metrics: {
        base: { ...baseMetrics.summary, first10: baseMetrics.first10, last10: baseMetrics.last10 },
        active: { ...activeMetrics.summary, first10: activeMetrics.first10, last10: activeMetrics.last10 },
      },
      harm,
      guardrail,
    });
  }

  const injectedRoles = analysisRoles.filter((role) => role.metrics.active.prompt.registerTurnCount === role.metrics.active.turns);
  const uninjectedRoles = analysisRoles
    .filter((role) => role.metrics.active.prompt.registerTurnCount < role.metrics.active.turns)
    .map((role) => role.roleKey);
  const injectedActiveDirections = injectedRoles.filter((role) => role.direction === 'active').length;
  const injectedActiveRate = injectedRoles.length === 0 ? 0 : injectedActiveDirections / injectedRoles.length;
  const gateResult = evaluateGates(analysisRoles);
  const gatePass = Object.values(gateResult.gates).every((gate) => gate.pass === true);
  const coverageFull = manifest.roles.length >= calibration.VISITOR_SPEECH_REGISTER_ROLE_KEYS.length;
  const conclusion = gatePass
    ? coverageFull
      ? 'mechanism_stable_ai_proxy'
      : 'mechanism_stable_ai_proxy_partial_coverage'
    : injectedRoles.length > 0 && uninjectedRoles.length > 0 && injectedActiveRate >= 0.8
      ? 'injection_coverage_blocked'
      : gateResult.gates.direction.pass
        ? 'direction_consistent_but_limited'
        : 'not_stable';
  const expectedRoles = calibration.VISITOR_SPEECH_REGISTER_ROLE_KEYS;
  const missingRoles = expectedRoles.filter((role) => !manifest.roles.includes(role));
  const analysis = {
    runId: options.runId,
    taskId: 'AF-465',
    protocol: `${rating.REGISTER_RATING_VERSION}-paired`,
    status: rating.REGISTER_RATING_STATUS,
    conclusion,
    judges: ratings.judges,
    roles: analysisRoles,
    coverage: {
      expected: expectedRoles.length,
      measured: manifest.roles.length,
      missingRoles,
      injectedRoles: injectedRoles.map((role) => role.roleKey),
      uninjectedRoles,
      injectedActiveDirections,
      injectedActiveRate: round(injectedActiveRate, 2),
    },
    ...gateResult,
    generatedAt: new Date().toISOString(),
    limitations: [
      '只做 AI 盲评，未做真人语言学/督导师验收；status=ai_proxy_candidate。',
      `评委中的 MiniMax 与来访者渲染模型同族，存在自偏好风险；主判为不同厂商的 Doubao。`,
      `库内只有 ${manifest.roles.length} 个 approved character_profiles 可开调试会话；未覆盖角色：${missingRoles.length ? missingRoles.join('、') : '无'}。`,
      uninjectedRoles.length
        ? `active 注入未覆盖：${uninjectedRoles.join('、')}（这些角色的 character_profiles 没有 speech_register，active 必然等同 base）。`
        : 'active 注入覆盖全部参评角色。',
      '每个角色每个模式只跑 1 场，跨角色方向可看，重复性方差未测。',
      '只覆盖已标定角色，不外推到未标定角色。',
      '只测文本，不测 TTS/ASR 听感。',
    ],
  };
  await writeFile(path.join(runDir, 'analysis.json'), `${JSON.stringify(analysis, null, 2)}\n`, 'utf8');
  process.stdout.write(`\n[AF-465] 结论=${conclusion} 门槛=${gatePass ? 'PASS' : 'FAIL'} → ${path.join(runDir, 'analysis.json')}\n`);
}

main().catch((error) => {
  process.stderr.write(`\n[AF-465] 盲评失败: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
