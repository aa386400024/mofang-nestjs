// AF-465 · 跑 10 角色 × base/active × 30 轮，落盘逐轮 trace 与确定性指标。
// 原始台词只落本地 data/eval-reports（gitignored），仓库只提交聚合报告。
// 前置：pnpm build；本机 3010=off、3011=active 两个进程已起。

import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { COUNSELOR_SCRIPT, COUNSELOR_SCRIPT_HASH, TURN_COUNT } from './counselor-script.mjs';
import { summarizeSession } from './metrics.mjs';
import { pairedTurnOrder } from './paired-order.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../..');
const OUT_ROOT = path.join(ROOT, 'data', 'eval-reports', 'visitor-register-stability');
const BASE_PORT = 3010;
const ACTIVE_PORT = 3011;
const REQUEST_TIMEOUT_MS = 180_000;

const audit = await import(pathToFileURL(path.join(ROOT, 'dist', 'shared', 'speech-register', 'speech-register.audit.js')));
const calibration = await import(pathToFileURL(path.join(ROOT, 'dist', 'shared', 'speech-register', 'speech-register.calibration.js')));

function parseArgs(argv) {
  const options = { runId: '', roles: '', turns: TURN_COUNT, taskId: 'AF-465', paired: false, port: BASE_PORT };
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (key === '--paired') {
      options.paired = true;
      continue;
    }
    const value = argv[index + 1];
    if (key === '--run-id') {
      options.runId = value;
      index += 1;
    } else if (key === '--roles') {
      options.roles = value;
      index += 1;
    } else if (key === '--turns') {
      options.turns = Number(value);
      index += 1;
    } else if (key === '--task-id') {
      options.taskId = value;
      index += 1;
    } else if (key === '--port') {
      options.port = Number(value);
      index += 1;
    }
  }
  return options;
}

function readEnv() {
  const envPath = path.join(ROOT, '.env');
  const values = {};
  try {
    const raw = readFileSync(envPath, 'utf8');
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
  } catch {
    // .env 不存在时留给调用方按缺省处理；这里不打印内容.
  }
  return { envPath, values };
}

function seedFrom(text) {
  const digest = createHash('sha256').update(text).digest();
  return digest.readUInt32BE(0);
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

function shuffled(items, seed) {
  const output = [...items];
  const random = mulberry32(seed);
  for (let index = output.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    [output[index], output[swap]] = [output[swap], output[index]];
  }
  return output;
}

async function fetchJson(url, options = {}, attempt = 0) {
  let response;
  try {
    response = await fetch(url, { ...options, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  } catch (error) {
    if (attempt < 2) {
      await sleep(2_000 * (attempt + 1));
      return fetchJson(url, options, attempt + 1);
    }
    throw new Error(`请求失败 ${url}: ${error instanceof Error ? error.message : String(error)}`);
  }
  const text = await response.text();
  let body;
  try {
    body = text.length === 0 ? null : JSON.parse(text);
  } catch {
    body = text;
  }
  if (!response.ok) {
    if (attempt < 2 && response.status >= 500) {
      await sleep(2_000 * (attempt + 1));
      return fetchJson(url, options, attempt + 1);
    }
    throw new Error(`HTTP ${response.status} ${url}: ${typeof body === 'string' ? body.slice(0, 300) : JSON.stringify(body)}`);
  }
  return body;
}

async function createSession(port, roleKey, registerMode) {
  return fetchJson(`http://127.0.0.1:${port}/admin/api/debug/session`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ characterSlug: roleKey, ...(registerMode === undefined ? {} : { registerMode }) }),
  });
}

async function runTurn(port, sessionId, text) {
  return fetchJson(`http://127.0.0.1:${port}/admin/api/debug/session/${encodeURIComponent(sessionId)}/turn`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ counselorText: text }),
  });
}

/** 把一轮响应摊成落盘 row（单进程与双进程路径共用同一口径）。 */
function buildTurnRow(turnIndex, counselorText, response, wallMs) {
  const trace = response?.trace ?? {};
  return {
    turnIndex: turnIndex + 1,
    counselorText,
    reply: String(response?.reply ?? ''),
    promptFull: String(trace.renderSpec?.promptFull ?? ''),
    bdiSnapshot: trace.bdiSnapshot ?? null,
    delta: trace.delta ?? null,
    eventTags: trace.eventTags ?? [],
    crisis: trace.crisis ?? null,
    intention: trace.intention ?? null,
    llmUsage: trace.llmUsage ?? null,
    degraded: trace.degraded === true,
    ts: trace.ts ?? null,
    wallMs,
  };
}

async function closeSession(port, sessionId) {
  try {
    await fetchJson(`http://127.0.0.1:${port}/admin/api/debug/session/${encodeURIComponent(sessionId)}`, { method: 'DELETE' });
  } catch {
    // 关闭失败不影响已落盘数据；下一步由进程内会话表清理.
  }
}

async function health(port) {
  return fetchJson(`http://127.0.0.1:${port}/health`);
}

async function writeJson(file, value) {
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const runId = options.runId || `${new Date().toISOString().replaceAll(/[:.]/gu, '-')}-${randomUUID().slice(0, 8)}`;
  const runDir = path.join(OUT_ROOT, runId);
  const sessionsDir = path.join(runDir, 'sessions');
  await mkdir(sessionsDir, { recursive: true });

  const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();
  const env = readEnv();
  const allRoles = calibration.VISITOR_SPEECH_REGISTER_ROLE_KEYS;
  const roles = options.roles
    ? options.roles
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean)
    : allRoles;
  const turns = COUNSELOR_SCRIPT.slice(0, Math.max(1, Math.min(options.turns, TURN_COUNT)));
  const missing = roles.filter((role) => !allRoles.includes(role));
  if (missing.length > 0) throw new Error(`未知角色: ${missing.join(', ')}`);
  if (turns.length !== TURN_COUNT) throw new Error(`本任务按 30 轮预注册，不能改轮数为 ${turns.length}`);

  if (options.paired) {
    await health(options.port);
  } else {
    await health(BASE_PORT);
    await health(ACTIVE_PORT);
  }

  const manifest = {
    runId,
    taskId: options.taskId,
    startedAt: new Date().toISOString(),
    gitHead: head,
    counselorScriptHash: COUNSELOR_SCRIPT_HASH,
    turnCount: turns.length,
    roles,
    modes: ['base', 'active'],
    paired: options.paired,
    ports: options.paired ? { paired: options.port } : { base: BASE_PORT, active: ACTIVE_PORT },
    model: {
      renderProvider: env.values.ENGINE_RENDER_PRIMARY_PROVIDER ?? '',
      renderModel: env.values.MINIMAX_LLM_MODEL ?? '',
      defaultChatProvider: env.values.LLM_DEFAULT_CHAT_PROVIDER ?? '',
    },
    envFile: path.relative(ROOT, env.envPath).replaceAll('\\', '/'),
    privacy: '原始台词只落本地 data/eval-reports；仓库只提交聚合指标与评分。',
  };
  await writeJson(path.join(runDir, 'manifest.json'), manifest);

  const metrics = { runId, scriptHash: COUNSELOR_SCRIPT_HASH, roles: {}, generatedAt: '' };
  const order = [];
  for (let index = 0; index < roles.length; index += 1) {
    const role = roles[index];
    const modes = shuffled(['base', 'active'], seedFrom(`${runId}:${role}`));
    order.push({ role, modes });
  }
  manifest.order = order;
  await writeJson(path.join(runDir, 'manifest.json'), manifest);

  if (options.paired) {
    // AF-475: 同一进程逐轮配对 —— base/active 两场会话在同一端口、同一进程内，
    // 每个 turn 紧邻执行并翻转先后顺序，抵消整场串行与双进程差异。
    const port = options.port;
    for (const item of order) {
      const register = calibration.getVisitorSpeechRegister(item.role);
      if (!register) throw new Error(`角色 ${item.role} 缺少语域标定`);
      const roleDir = path.join(sessionsDir, item.role);
      await mkdir(roleDir, { recursive: true });
      metrics.roles[item.role] = {};

      const sessions = {
        base: await createSession(port, item.role, 'off'),
        active: await createSession(port, item.role, 'active'),
      };
      const startedAt = new Date().toISOString();
      const runs = {
        base: { rows: [], failed: false },
        active: { rows: [], failed: false },
      };

      for (let turnIndex = 0; turnIndex < turns.length; turnIndex += 1) {
        const counselorText = turns[turnIndex];
        // 奇偶轮翻转先后，避免固定“base 先发”带来的一致偏置。
        const modes = pairedTurnOrder(turnIndex);
        for (const mode of modes) {
          const started = Date.now();
          try {
            const response = await runTurn(port, sessions[mode].sessionId, counselorText);
            runs[mode].rows.push(buildTurnRow(turnIndex, counselorText, response, Date.now() - started));
          } catch (error) {
            runs[mode].failed = true;
            runs[mode].rows.push({
              turnIndex: turnIndex + 1,
              counselorText,
              error: error instanceof Error ? error.message : String(error),
              wallMs: Date.now() - started,
            });
            break;
          }
          await writeJson(path.join(roleDir, `${mode}.json`), {
            roleKey: item.role,
            mode,
            port,
            registerMode: mode === 'active' ? 'active' : 'off',
            sessionId: sessions[mode].sessionId,
            startedAt,
            scriptHash: COUNSELOR_SCRIPT_HASH,
            rows: runs[mode].rows,
            complete: false,
          });
        }
        if (runs.base.failed || runs.active.failed) break;
        process.stdout.write(`[${options.taskId}] ${item.role} paired ${turnIndex + 1}/${turns.length}\r`);
      }

      const endedAt = new Date().toISOString();
      let failure = null;
      for (const mode of ['base', 'active']) {
        const run = runs[mode];
        const record = {
          roleKey: item.role,
          mode,
          port,
          registerMode: mode === 'active' ? 'active' : 'off',
          sessionId: sessions[mode].sessionId,
          startedAt,
          endedAt,
          scriptHash: COUNSELOR_SCRIPT_HASH,
          rows: run.rows,
          complete: !run.failed && run.rows.length === turns.length,
        };
        await writeJson(path.join(roleDir, `${mode}.json`), record);
        await closeSession(port, sessions[mode].sessionId);
        if (run.failed) {
          failure = `${item.role}/${mode} 存在失败轮；已落盘 ${path.relative(ROOT, path.join(roleDir, `${mode}.json`))}`;
          continue;
        }
        const summary = summarizeSession(run.rows, register, audit.measureSpeechRegisterFit, audit.aggregateSpeechRegisterMetrics);
        const last10 = summarizeSession(
          run.rows.slice(-10),
          register,
          audit.measureSpeechRegisterFit,
          audit.aggregateSpeechRegisterMetrics,
        );
        const first10 = summarizeSession(
          run.rows.slice(0, 10),
          register,
          audit.measureSpeechRegisterFit,
          audit.aggregateSpeechRegisterMetrics,
        );
        metrics.roles[item.role][mode] = {
          sessionId: sessions[mode].sessionId,
          startedAt,
          endedAt,
          registerMode: mode === 'active' ? 'active' : 'off',
          summary,
          first10: first10.metrics,
          last10: last10.metrics,
        };
      }
      metrics.generatedAt = new Date().toISOString();
      await writeJson(path.join(runDir, 'metrics.json'), metrics);
      process.stdout.write('\n');
      if (failure) throw new Error(failure);
    }

    manifest.finishedAt = new Date().toISOString();
    await writeJson(path.join(runDir, 'manifest.json'), manifest);
    process.stdout.write(`\n[${options.taskId}] paired 完成 ${roles.length * 2} 场 → ${path.relative(ROOT, runDir)}\n`);
    return;
  }

  for (const item of order) {
    const register = calibration.getVisitorSpeechRegister(item.role);
    if (!register) throw new Error(`角色 ${item.role} 缺少语域标定`);
    const roleDir = path.join(sessionsDir, item.role);
    await mkdir(roleDir, { recursive: true });
    metrics.roles[item.role] = {};

    for (const mode of item.modes) {
      const port = mode === 'active' ? ACTIVE_PORT : BASE_PORT;
      const session = await createSession(port, item.role);
      const sessionId = session.sessionId;
      const startedAt = new Date().toISOString();
      const rows = [];
      let failed = false;

      for (let turnIndex = 0; turnIndex < turns.length; turnIndex += 1) {
        const counselorText = turns[turnIndex];
        const started = Date.now();
        let response;
        try {
          response = await runTurn(port, sessionId, counselorText);
        } catch (error) {
          failed = true;
          rows.push({
            turnIndex: turnIndex + 1,
            counselorText,
            error: error instanceof Error ? error.message : String(error),
            wallMs: Date.now() - started,
          });
          break;
        }
        const trace = response.trace ?? {};
        rows.push({
          turnIndex: turnIndex + 1,
          counselorText,
          reply: String(response.reply ?? ''),
          promptFull: String(trace.renderSpec?.promptFull ?? ''),
          bdiSnapshot: trace.bdiSnapshot ?? null,
          delta: trace.delta ?? null,
          eventTags: trace.eventTags ?? [],
          crisis: trace.crisis ?? null,
          intention: trace.intention ?? null,
          llmUsage: trace.llmUsage ?? null,
          degraded: trace.degraded === true,
          ts: trace.ts ?? null,
          wallMs: Date.now() - started,
        });
        await writeJson(path.join(roleDir, `${mode}.json`), {
          roleKey: item.role,
          mode,
          port,
          sessionId,
          startedAt,
          scriptHash: COUNSELOR_SCRIPT_HASH,
          rows,
          complete: false,
        });
        process.stdout.write(`[${options.taskId}] ${item.role} ${mode} ${turnIndex + 1}/${turns.length}\r`);
      }

      const endedAt = new Date().toISOString();
      const record = {
        roleKey: item.role,
        mode,
        port,
        sessionId,
        startedAt,
        endedAt,
        scriptHash: COUNSELOR_SCRIPT_HASH,
        rows,
        complete: !failed && rows.length === turns.length,
      };
      await writeJson(path.join(roleDir, `${mode}.json`), record);
      await closeSession(port, sessionId);
      process.stdout.write('\n');

      if (failed) {
        throw new Error(`${item.role}/${mode} 存在失败轮；已落盘 ${path.relative(ROOT, path.join(roleDir, `${mode}.json`))}`);
      }

      const summary = summarizeSession(rows, register, audit.measureSpeechRegisterFit, audit.aggregateSpeechRegisterMetrics);
      const last10 = summarizeSession(rows.slice(-10), register, audit.measureSpeechRegisterFit, audit.aggregateSpeechRegisterMetrics);
      const first10 = summarizeSession(rows.slice(0, 10), register, audit.measureSpeechRegisterFit, audit.aggregateSpeechRegisterMetrics);
      metrics.roles[item.role][mode] = {
        sessionId,
        startedAt,
        endedAt,
        summary,
        first10: first10.metrics,
        last10: last10.metrics,
      };
      metrics.generatedAt = new Date().toISOString();
      await writeJson(path.join(runDir, 'metrics.json'), metrics);
    }
  }

  manifest.finishedAt = new Date().toISOString();
  await writeJson(path.join(runDir, 'manifest.json'), manifest);
  process.stdout.write(`\n[${options.taskId}] 完成 ${roles.length * 2} 场 → ${path.relative(ROOT, runDir)}\n`);
}

main().catch((error) => {
  process.stderr.write(`\n[visitor-register-stability] 运行失败: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
