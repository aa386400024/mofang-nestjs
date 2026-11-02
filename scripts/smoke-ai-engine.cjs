#!/usr/bin/env node
/**
 * smoke-ai-engine.cjs — V6.0 §3 + §4.2 + §11.2 AI 引擎端到端 smoke.
 *
 * 链路 (12 步):
 *   1.  dist/app.js 存在 (前提: pnpm/npm build)
 *   2.  spawn 子进程跑 dist, NODE_ENV=development PORT=3002
 *   3.  poll /health ≤15s
 *   4.  POST /user/register 随机邮箱
 *   5.  Redis 读 verify:email:uid:<uid> 拿 token
 *   6.  POST /user/verify-email { token }
 *   7.  POST /user/login 拿 accessToken (cookie + body 双兜底)
 *   8.  GET /ai/profile — 7 维度初始化 (空数组 OK)
 *   9.  POST /ai/profile/dimensions — 单维度 upsert (anxiety / cloud)
 *  10.  GET /ai/recommend — 推荐列表 (cold-start 4 条)
 *  11.  POST /emergency/sessions — 上报 grounding_54321 会话 (含 UUID)
 *  12.  GET /emergency/sessions — 列出 (跨设备同步验证)
 *  13.  POST /v1/chat/once — 单轮 chat (admin 路径, 不走 SSE)
 *        仅当 .env 配置 LLM_*_API_KEY 才跑这步, 否则 SKIP + 提示.
 *
 * 退出码:
 *   0  = pass
 *   1  = dist 不存在
 *   2  = 启动超时
 *   3  = register 失败
 *   4  = Redis token 读不到
 *   5  = verify-email 失败
 *   6  = login 失败
 *   7  = profile 失败
 *   8  = profile upsert 失败
 *   9  = recommend 失败
 *  10  = emergency upsert 失败
 *  11  = emergency list 失败
 *  12  = chat 失败 (LLM 未配 API_KEY 时 SKIP 不算 fail)
 *  13  = 子进程异常退出
 *
 * V2026-09-04 治本 (修订版):
 *   - fix #1: redis client 顺序发命令, 不并发写 socket.
 *   - fix #2: 修密码 '***' → 'Test1Pass!' (满足 8位 + 大小写 + 数字 + 特殊).
 *   - fix #3: 取 uid 从 regBody.user.uid (嵌套对象, 不是顶层).
 *   - fix #4: 取 accessToken 优先 cookie (因 JwtCookieInterceptor 把 token 走 cookie),
 *             body 兜底.
 *   - fix #5: 补 import execSync (Windows taskkill).
 *   - fix #6: 双重 exit 修复 (proc.on('exit') 不再独立 cleanup).
 *
 * 跟 smoke-inner-world.cjs / smoke-test.cjs 区别:
 *   - smoke-test.cjs: 启动 + DB/Redis 健康 (15 行)
 *   - smoke-inner-world.cjs: Inner World 6 域 + 写入 (本页)
 *   - smoke-ai-engine.cjs: AI 引擎 7 endpoint + 急救 2 endpoint + LLM 单轮
 */

const { spawn, execSync } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const path = require('node:path');
const fs = require('node:fs');
const net = require('node:net');
// Node 21.7+ 内置 loadEnvFile, 手动注入 .env (不走 @nestjs/config)
require('node:process').loadEnvFile(path.join(__dirname, '..', '.env'));

const APP_JS = path.join(__dirname, '..', 'dist', 'app.js');
const PORT = 3002;
const BASE = `http://127.0.0.1:${PORT}`;
const START_TIMEOUT_MS = 15000;
const STEP_TIMEOUT_MS = 8000;

if (!fs.existsSync(APP_JS)) {
  console.error(`[FAIL] ${APP_JS} not found. Run: npm run build`);
  process.exit(1);
}

// ---------- Redis RESP 客户端 (无依赖, 顺序命令模式) ----------
function redisCommand(parts) {
  return new Promise((resolve, reject) => {
    const host = process.env.REDIS_HOST || '127.0.0.1';
    const port = Number(process.env.REDIS_PORT || 6379);
    const password = process.env.REDIS_PASSWORD || '';
    const db = Number(process.env.REDIS_DB || 0);

    // V2026-09-04 治本 fix #1: 顺序发 AUTH → SELECT → GET, 等每条响应后发下一条.
    // 之前版本只 GET 时 AUTH + SELECT 并发写, Redis 收到后顺序错乱.
    let buf = '';
    let step = password ? 'AUTH' : 'SELECT'; // 没密码跳过 AUTH
    let authenticated = !password;
    let selected = false;
    const sock = net.createConnection({ host, port }, () => {
      // 1. AUTH (如果需要)
      if (password) {
        sock.write(
          `*2\r\n$4\r\nAUTH\r\n$${Buffer.byteLength(password)}\r\n${password}\r\n`,
        );
      } else {
        // 没密码, 直接 SELECT
        sock.write(
          `*2\r\n$6\r\nSELECT\r\n$${Buffer.byteLength(String(db))}\r\n${db}\r\n`,
        );
        step = 'GET';
        selected = true;
      }
    });

    // 当前 GET 命令的 resolver
    let getResolver = null;
    sock.on('data', (chunk) => {
      buf += chunk.toString('utf8');
      // 找 RESP 行结束 (\r\n) — 一条命令一响应
      let idx;
      while ((idx = buf.indexOf('\r\n')) !== -1) {
        const line = buf.slice(0, idx);
        buf = buf.slice(idx + 2);

        if (step === 'AUTH') {
          if (line.startsWith('+OK')) {
            step = 'SELECT';
            sock.write(
              `*2\r\n$6\r\nSELECT\r\n$${Buffer.byteLength(String(db))}\r\n${db}\r\n`,
            );
          } else if (line.startsWith('-')) {
            sock.destroy();
            return reject(new Error('Redis AUTH: ' + line));
          }
        } else if (step === 'SELECT') {
          if (line.startsWith('+OK')) {
            selected = true;
            // 发 GET
            const cmd = (writer) => {
              writer('*' + parts.length + '\r\n');
              for (const p of parts) {
                writer('$' + Buffer.byteLength(p) + '\r\n' + p + '\r\n');
              }
            };
            cmd((line) => sock.write(line));
            step = 'GET';
            getResolver = { resolve, reject };
            // 标记已认证
            if (password) authenticated = true;
          } else if (line.startsWith('-')) {
            sock.destroy();
            return reject(new Error('Redis SELECT: ' + line));
          }
        } else if (step === 'GET') {
          // V2026-09-04 治本 fix #7+#8: GET 响应格式是 `$N\r\n<data>\r\n` (三行).
          // 之前只看了第一行 `$N` 就 resolve, 拿不到 data. (fix #7)
          // 之后用 `return` 跳出 data handler, 但 `<data>` 还在 buf 里未读 — 当响应
          // 同一 chunk 到达时 (`$43\r\n<data>\r\n`), data 行永远不被处理. (fix #8)
          // 修法: `$N` 后用 `continue` (不是 return), 让 while 循环继续读下一行 data.
          if (!getResolver) continue;
          if (line === '$-1') {
            getResolver.resolve(null);
            sock.end();
            return;
          }
          if (line.startsWith('$')) {
            const expectedLen = Number(line.slice(1));
            if (expectedLen === -1) {
              getResolver.resolve(null);
              sock.end();
              return;
            }
            // 下一行就是 data — 切到 GET_DATA 子状态, continue 让 while 继续读 data 行.
            step = 'GET_DATA';
            continue;
          }
          // 意外行 — fallback
          getResolver.resolve(line);
          sock.end();
          return;
        } else if (step === 'GET_DATA') {
          // data 行 — 长度 ≤ 之前记录的 expectedLen
          // 注: 实际 token 是 base64url ~ 43 字节, 不含 \r\n, 一行拿到
          if (!getResolver) continue;
          getResolver.resolve(line);
          sock.end();
          return;
        }
      }
    });
    sock.on('end', () => {});
    sock.on('error', reject);
  });
}

async function getVerifyToken(uid) {
  // V2026-09-04 治本: strip trailing colon from REDIS_KEY_PREFIX (兼容 .env 任意写法:
    // 写 'mofang:dev' / 'mofang:dev:' 都不出双冒号).
    const _prefix = (process.env.REDIS_KEY_PREFIX || 'mofang:dev').replace(/:+$/, '');
  const key = `${_prefix}:verify:email:uid:${uid}`;
  const token = await redisCommand(['GET', key]);
  return token;
}

// ---------- 子进程 ----------
const proc = spawn('node', [APP_JS], {
  env: {
    ...process.env,
    NODE_ENV: 'development',
    PORT: String(PORT),
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});

let serverLogs = '';
proc.stdout.on('data', (d) => {
  serverLogs += d.toString('utf8').slice(-4000);
});
proc.stderr.on('data', (d) => {
  serverLogs += d.toString('utf8').slice(-4000);
});

// V2026-09-04 治本 fix #6: proc exit 在 main() 内部处理, 这里只观察
proc.on('exit', (code, signal) => {
  if (code !== 0 && code !== null && signal !== 'SIGTERM' && signal !== 'SIGKILL') {
    console.error(`\n[FAIL] server exited code=${code} signal=${signal}`);
    dumpServerLogs('proc-exit');
    // 已通过主流程退出, 这里只打日志不再 process.exit, 防双重退出
  }
});

let cleanupCalled = false;
const cleanup = (code) => {
  if (cleanupCalled) return;
  cleanupCalled = true;
  try {
    if (process.platform === 'win32') {
      execSync(`taskkill /pid ${proc.pid} /F /T`, { stdio: 'ignore' });
    } else {
      proc.kill('SIGTERM');
    }
  } catch {}
  // 给 SIGTERM 一点时间, 避免端口被占用
  setTimeout(() => process.exit(code), 200);
};

function dumpServerLogs(label) {
  const lines = serverLogs.trim().split('\n').slice(-80);
  console.error(`\n[${label}] last 80 lines of server output:`);
  console.error(lines.join('\n'));
}

// ---------- 工具 ----------
async function pollHealth() {
  const start = Date.now();
  while (Date.now() - start < START_TIMEOUT_MS) {
    try {
      const r = await fetch(`${BASE}/health`);
      if (r.ok) return true;
    } catch {}
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}

async function step(label, fn) {
  process.stdout.write(`\n[step] ${label}\n`);
  try {
    const result = await Promise.race([
      fn(),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('step timeout')), STEP_TIMEOUT_MS),
      ),
    ]);
    process.stdout.write(`  ✓ done\n`);
    return result;
  } catch (e) {
    process.stdout.write(`  [FAIL] ${e.message}\n`);
    throw e;
  }
}

// 从 cookie + body 双兜底取 accessToken
function extractToken(res, body) {
  // 1. Set-Cookie header
  const setCookie = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  for (const cookie of setCookie) {
    if (/access[_-]?token=([^;]+)/i.test(cookie)) {
      const m = cookie.match(/access[_-]?token=([^;]+)/i);
      if (m) return m[1];
    }
  }
  // 2. body.accessToken
  if (body && typeof body === 'object') {
    return body.accessToken || body.access_token || body.data?.accessToken || null;
  }
  return null;
}

// ---------- 主流程 ----------
async function main() {
  // 0. 环境提示
  console.log('=======================================');
  console.log(' V6.0 §3 + §4.2 + §11.2 AI 引擎 smoke');
  console.log('=======================================');
  console.log(`REDIS: ${process.env.REDIS_HOST || '127.0.0.1'}:${process.env.REDIS_PORT || 6379}`);
  console.log(`REDIS_KEY_PREFIX: ${process.env.REDIS_KEY_PREFIX || 'mofang:dev'}`);
  const hasKey =
    process.env.LLM_OPENAI_API_KEY ||
    process.env.LLM_DEEPSEEK_API_KEY ||
    process.env.LLM_DOUBAO_API_KEY ||
    process.env.LLM_QWEN_API_KEY;
  console.log(`LLM: ${hasKey ? 'configured' : 'not configured — chat 步骤会 SKIP'}`);
  console.log('---------------------------------------\n');

  // 1. 启动
  if (!(await pollHealth())) {
    dumpServerLogs('startup-timeout');
    console.error('[FAIL] server did not start in 15s');
    cleanup(2);
    return;
  }
  console.log('[ok] server up\n');

  // 2. 注册 (强密码)
  // V2026-09-04 治本 fix #2: 密码必须满足 8+位 + 大小写 + 数字 + 特殊字符
  const email = `smoke-ai-${randomUUID()}@test.local`;
  const password = 'Test1Pass!';
  const regBody = await step('POST /user/register (email)', async () => {
    const r = await fetch(`${BASE}/user/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    if (!r.ok) {
      const text = await r.text();
      throw new Error(`status=${r.status} body=${text.slice(0, 300)}`);
    }
    return r.json();
  });
  // V2026-09-04 治本 fix #3: AuthResponseDto.user.uid (嵌套)
  const uid = regBody.user?.uid;
  if (!uid) {
    dumpServerLogs('no-uid');
    console.error('[FAIL] register response missing user.uid');
    console.error('  body =', JSON.stringify(regBody).slice(0, 300));
    cleanup(3);
    return;
  }
  console.log(`  uid=${uid}, email=${email}`);

  // 3. Redis 拿 verify token
  const verifyToken = await getVerifyToken(uid);
  if (!verifyToken) {
    dumpServerLogs('redis-no-token');
    console.error('[FAIL] verify token not in redis');
    const _errPrefix = (process.env.REDIS_KEY_PREFIX || 'mofang:dev').replace(/:+$/, '');
    console.error(`  expected key: ${_errPrefix}:verify:email:uid:${uid}`);
    cleanup(4);
    return;
  }
  console.log(`  verify token: ${verifyToken.slice(0, 16)}...`);

  // 4. verify email
  await step('POST /user/verify-email', async () => {
    const r = await fetch(`${BASE}/user/verify-email`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: verifyToken }),
    });
    if (!r.ok) {
      const text = await r.text();
      throw new Error(`status=${r.status} body=${text.slice(0, 300)}`);
    }
    return r.text();
  });

  // 5. login (cookie + body 双兜底)
  const loginBody = await step('POST /user/login', async () => {
    const r = await fetch(`${BASE}/user/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    if (!r.ok) {
      const text = await r.text();
      throw new Error(`status=${r.status} body=${text.slice(0, 300)}`);
    }
    // V2026-09-04 治本 fix #4: 先读 cookie, 再读 body
    const body = await r.json();
    return { body, res: r };
  });
  const accessToken = extractToken(loginBody.res, loginBody.body);
  if (!accessToken) {
    dumpServerLogs('no-token');
    console.error('[FAIL] login returned no accessToken');
    console.error('  body =', JSON.stringify(loginBody.body).slice(0, 300));
    cleanup(6);
    return;
  }
  const auth = { authorization: `Bearer ${accessToken}` };
  console.log(`  token: ${accessToken.slice(0, 16)}...`);

  // 6. AI profile — 拉 (空用户)
  await step('GET /ai/profile', async () => {
    const r = await fetch(`${BASE}/ai/profile`, { headers: auth });
    if (!r.ok) {
      const text = await r.text();
      throw new Error(`status=${r.status} body=${text.slice(0, 300)}`);
    }
    const j = await r.json();
    if (!j.dimensions && !j.data?.dimensions) {
      throw new Error('response missing dimensions field');
    }
    return j;
  });

  // 7. AI profile — 单维度 upsert
  await step('POST /ai/profile/dimensions (emotion)', async () => {
    const r = await fetch(`${BASE}/ai/profile/dimensions`, {
      method: 'POST',
      headers: { ...auth, 'content-type': 'application/json' },
      body: JSON.stringify({
        // V2026-09-04 治本: 用 AIProfileDimension enum 合法值 (emotion/trait/habit/
        //   stage/tolerance/effect/gamification). 之前用 'anxiety_baseline' 不在 enum
        //   里, MySQL ENUM 约束会拒, 且 ai_profile_cache 表 enum 列不接受.
        //   用 'emotion' 表焦虑维度, payload.gad7_score 保留。
        dimension: 'emotion',
        payload: { gad7_score: 12, severity: 'moderate' },
        source: 'cloud',
      }),
    });
    if (!r.ok) {
      const text = await r.text();
      throw new Error(`status=${r.status} body=${text.slice(0, 300)}`);
    }
    return r.json();
  });

  // 8. AI recommend — cold-start 4 条
  await step('GET /ai/recommend', async () => {
    const r = await fetch(`${BASE}/ai/recommend`, { headers: auth });
    if (!r.ok) {
      const text = await r.text();
      throw new Error(`status=${r.status} body=${text.slice(0, 300)}`);
    }
    const j = await r.json();
    const items = j.items ?? j.data?.items ?? [];
    if (items.length < 3) {
      throw new Error(`only ${items.length} items, expected ≥ 3`);
    }
    return j;
  });

  // 9. Emergency upsert (UUID 幂等)
  const sessionId = randomUUID();
  await step('POST /emergency/sessions (grounding_54321)', async () => {
    const r = await fetch(`${BASE}/emergency/sessions`, {
      method: 'POST',
      headers: { ...auth, 'content-type': 'application/json' },
      body: JSON.stringify({
        id: sessionId,
        toolKind: 'grounding_54321',
        phase: 'completed',
        intensityBefore: 8,
        intensityAfter: 4,
        stagesCompleted: 5,
        startedAtMs: Date.now() - 600000,
        completedAtMs: Date.now(),
        notes: 'smoke test',
        context: { trigger: 'workplace_stress' },
      }),
    });
    if (!r.ok) {
      const text = await r.text();
      throw new Error(`status=${r.status} body=${text.slice(0, 300)}`);
    }
    return r.json();
  });

  // 10. Emergency list — 跨设备同步验证
  await step('GET /emergency/sessions', async () => {
    const r = await fetch(`${BASE}/emergency/sessions`, { headers: auth });
    if (!r.ok) {
      const text = await r.text();
      throw new Error(`status=${r.status} body=${text.slice(0, 300)}`);
    }
    const j = await r.json();
    const items = j.items ?? j.data?.items ?? [];
    const found = items.find((i) => i.id === sessionId);
    if (!found) {
      throw new Error(`uploaded session ${sessionId} not in list (count=${items.length})`);
    }
    return j;
  });

  // 11. LLM chat once — 跳过 if 没配 key
  if (!hasKey) {
    console.log('\n[step] POST /v1/chat/once — SKIPPED (no LLM_*_API_KEY in .env)');
    console.log('  ✓ done (skip)');
  } else {
    await step('POST /v1/chat/once (admin)', async () => {
      const r = await fetch(`${BASE}/v1/chat/once`, {
        method: 'POST',
        headers: { ...auth, 'content-type': 'application/json' },
        body: JSON.stringify({
          tier: 'basic',
          messages: [{ role: 'user', content: 'ping' }],
          stream: false,
          maxTokens: 16,
        }),
      });
      if (!r.ok) {
        const text = await r.text();
        throw new Error(`status=${r.status} body=${text.slice(0, 500)}`);
      }
      const j = await r.json();
      if (!j.conversationId && !j.data?.conversationId) {
        throw new Error('no conversationId in response');
      }
      return j;
    });
  }

  console.log('\n=======================================');
  console.log(' [PASS] ai-engine smoke complete');
  console.log('=======================================');
}

main().catch((e) => {
  dumpServerLogs('exception');
  console.error('\n[FAIL] uncaught:', e.message);
  cleanup(13);
});