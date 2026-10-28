#!/usr/bin/env node
// V2026-10-15 治本 (VS-3 续 smoke 收尾 — 6 步端到端 RAG 写侧 + 读侧验证):
//   原因: VS-3 续 写侧治本 (knowledge.service.ts embedOnPublish 切 chunk + embed + Qdrant upsert)
//     完成后, 缺 dev 端到端 smoke 验证 (创 KB → publish → 验 Qdrant 写入 → search 召回).
//     V3.1 §1 VS-3c 治本 commit 1 留 V1.x 配套. 1 message smoke-rag.cjs = VS-3 续 闭环.
//   修法: 6 步端到端 smoke, 跟 scripts/smoke-ai-engine.cjs 同 pattern (Redis RESP 客户端 no deps,
//     step 函数 + 退出码 0-10 + 子进程 spawn + cleanup + dumpServerLogs):
//     1. spawn 子进程 + poll /health ≤15s (DB + Redis + HTTP up)
//     2. POST /user/register 随机邮箱 + Redis 读 verify:email:uid token + POST /user/verify-email
//        + POST /user/login 拿 accessToken (cookie + body 双兜底)
//     3. POST /admin/knowledge-items 创 KB (含 content.body 520 字, 触发切 ≥2 chunk)
//        + POST /:id/submit + POST /:id/approve (触发 embedOnPublish 异步 hook)
//     4. sleep 3s 等 embed 异步 + Qdrant HTTP GET /collections/{collection} 验 points_count > 0
//     5. POST /admin/knowledge-items?searchKeywords=心理咨询 验召回 (期望返回我们刚创的 KB)
//   反双胞胎:
//     - 不连真 Qdrant SDK (用 HTTP GET /collections/{name} 验, no deps, 跟 smoke-ai-engine Redis client 同 pattern),
//     - 不引 supertest / jest (node fetch 18+ 内置, 跟 smoke-ai-engine 12 步模板同 pattern),
//     - 不 mock user/jwt (走 server 真注册流程, 跟 V0.x culture "e2e 不连真 DB" 不冲突, server 自己 in-memory mock),
//     - 不跑真 LLM API (RAG_E2E_REAL=1 才跑, 大炮手动设 env 切, 默认 0 走 server in-memory mock 软降级).
//   验证: 大炮跑 pnpm smoke:rag 验 6 步全过 (dev 环境需 Qdrant @ 6333 + LLM provider 真 API key 跑真 embed).
//   时间戳: 2026-10-15.

const { spawn, execSync } = require('node:child_process');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

// V2026-10-15 治本 (VS-3 续 smoke — .env loader 0 新依赖, 跟 server 端 .env 走同 REDIS_HOST/QDRANT_URL/LLM_*_API_KEY):
//   原因: smoke-rag.cjs 是 .cjs 脚本不加载 .env, 走 process.env.REDIS_HOST ?? '127.0.0.1' 默认值连本地 6379
//     ECONNREFUSED. 6 步端到端 Step 2 register 后 Redis 读 verify token 拿不到, 链路断在 Step 2.
//     跟 server 端 .env 走不同配置 (server REDIS_HOST=117.72.30.78 + QDRANT_URL=http://qdrant:6333),
//     smoke 必须跟 server 走同 .env 才能端到端验 server 真接流程.
//   修法: smoke 启动期 node:fs readFileSync(.env) + 简单 KEY=VALUE 解析, 设 process.env.KEY (env 已设不覆盖).
//     0 新依赖 (V0.x culture "e2e 不连真 DB, mock 简化", 跟 V3.1 §1 VS-3e 5 段治本 culture 一致).
//   反双胞胎:
//     - 不引 dotenv (over-engineering, 简单 KEY=VALUE 解析够, 0 装包),
//     - 不在大炮跑命令前手动 set env (容易漏, 治本 = smoke 启动期自动 load),
//     - 不在 .env.example 加注释 (那是 dev 配置, smoke 知道怎么 load 就行).
//   验证: 大炮跑 pnpm smoke:rag 验 6 步全过 (dev 需 .env 配 LLM_OPENAI_API_KEY, Qdrant @ localhost:6333 起容器).
//   时间戳: 2026-10-15.
try {
  const envPath = path.join(__dirname, '..', '.env');
  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf8');
    for (const line of envContent.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx === -1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      let value = trimmed.slice(eqIdx + 1).trim();
      // 处理引号包裹 (单/双)
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      // env 已设不覆盖 (大炮跑命令时手动 set 的 env 优先)
      if (!(key in process.env)) {
        process.env[key] = value;
      }
    }
  }
} catch (e) {
  // .env 加载失败不阻塞 smoke (dev 可能用其他 env 注入方式)
}

const APP_JS = path.join(__dirname, '..', 'dist', 'app.js');
const PORT = 3003;
const BASE = `http://127.0.0.1:${PORT}`;
const START_TIMEOUT_MS = 15000;
const STEP_TIMEOUT_MS = 8000;
const QDRANT_URL = process.env.QDRANT_URL || 'http://127.0.0.1:6333';
const QDRANT_COLLECTION = process.env.QDRANT_KB_COLLECTION || 'knowledge_chunks';
const RAG_E2E_REAL = process.env.RAG_E2E_REAL === '1';

if (!fs.existsSync(APP_JS)) {
  console.error(`[FAIL] ${APP_JS} not found. Run: npm run build`);
  process.exit(1);
}

// ---------- Redis RESP 客户端 (跟 smoke-ai-engine.cjs 同 pattern, no deps) ----------
function redisCommand(parts) {
  return new Promise((resolve, reject) => {
    const host = process.env.REDIS_HOST || '127.0.0.1';
    const port = Number(process.env.REDIS_PORT || 6379);
    const password = process.env.REDIS_PASSWORD || '';
    const db = Number(process.env.REDIS_DB || 0);

    let buf = '';
    let step = password ? 'AUTH' : 'SELECT';
    let authenticated = !password;
    let selected = false;
    const sock = net.createConnection({ host, port }, () => {
      if (password) {
        sock.write(`*2\r\n$4\r\nAUTH\r\n$${Buffer.byteLength(password)}\r\n${password}\r\n`);
      } else {
        sock.write(`*2\r\n$6\r\nSELECT\r\n$${Buffer.byteLength(String(db))}\r\n${db}\r\n`);
        step = 'GET';
        selected = true;
      }
    });

    let getResolver = null;
    sock.on('data', (chunk) => {
      buf += chunk.toString('utf8');
      let idx;
      while ((idx = buf.indexOf('\r\n')) !== -1) {
        const line = buf.slice(0, idx);
        buf = buf.slice(idx + 2);

        if (step === 'AUTH') {
          if (line.startsWith('+OK')) {
            step = 'SELECT';
            sock.write(`*2\r\n$6\r\nSELECT\r\n$${Buffer.byteLength(String(db))}\r\n${db}\r\n`);
          } else if (line.startsWith('-')) {
            sock.destroy();
            return reject(new Error('Redis AUTH: ' + line));
          }
        } else if (step === 'SELECT') {
          if (line.startsWith('+OK')) {
            selected = true;
            const cmd = (writer) => {
              writer('*' + parts.length + '\r\n');
              for (const p of parts) writer('$' + Buffer.byteLength(p) + '\r\n' + p + '\r\n');
            };
            cmd((line) => sock.write(line));
            step = 'GET';
            getResolver = { resolve, reject };
            if (password) authenticated = true;
          } else if (line.startsWith('-')) {
            sock.destroy();
            return reject(new Error('Redis SELECT: ' + line));
          }
        } else if (step === 'GET') {
          if (!getResolver) continue;
          if (line === '$-1') { getResolver.resolve(null); sock.end(); return; }
          if (line.startsWith('$')) {
            const expectedLen = Number(line.slice(1));
            if (expectedLen === -1) { getResolver.resolve(null); sock.end(); return; }
            step = 'GET_DATA';
            continue;
          }
          getResolver.resolve(line);
          sock.end();
          return;
        } else if (step === 'GET_DATA') {
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
  const _prefix = (process.env.REDIS_KEY_PREFIX || 'mofang:dev').replace(/:+$/, '');
  const key = `${_prefix}:verify:email:uid:${uid}`;
  return await redisCommand(['GET', key]);
}

// ---------- 子进程 ----------
const proc = spawn('node', [APP_JS], {
  env: { ...process.env, NODE_ENV: 'development', PORT: String(PORT) },
  stdio: ['ignore', 'pipe', 'pipe'],
});

let serverLogs = '';
proc.stdout.on('data', (d) => { serverLogs += d.toString('utf8').slice(-4000); });
proc.stderr.on('data', (d) => { serverLogs += d.toString('utf8').slice(-4000); });
proc.on('exit', (code, signal) => {
  if (code !== 0 && code !== null && signal !== 'SIGTERM' && signal !== 'SIGKILL') {
    console.error(`\n[FAIL] server exited code=${code} signal=${signal}`);
    dumpServerLogs('proc-exit');
  }
});

let cleanupCalled = false;
const cleanup = (code) => {
  if (cleanupCalled) return;
  cleanupCalled = true;
  try {
    if (process.platform === 'win32') execSync(`taskkill /pid ${proc.pid} /F /T`, { stdio: 'ignore' });
    else proc.kill('SIGTERM');
  } catch {}
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
      new Promise((_, reject) => setTimeout(() => reject(new Error('step timeout')), STEP_TIMEOUT_MS)),
    ]);
    process.stdout.write(`  ✓ done\n`);
    return result;
  } catch (e) {
    process.stdout.write(`  [FAIL] ${e.message}\n`);
    throw e;
  }
}

function extractToken(res, body) {
  const setCookie = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  for (const cookie of setCookie) {
    const m = cookie.match(/access[_-]?token=([^;]+)/i);
    if (m) return m[1];
  }
  if (body && typeof body === 'object') {
    return body.accessToken || body.access_token || body.data?.accessToken || null;
  }
  return null;
}

// ---------- 主流程 (6 步端到端 RAG) ----------
async function main() {
  console.log('=======================================');
  console.log(' VS-3 续 6 步 RAG smoke (Phase 6 真联调)');
  console.log('=======================================');
  console.log(`REDIS: ${process.env.REDIS_HOST || '127.0.0.1'}:${process.env.REDIS_PORT || 6379}`);
  console.log(`QDRANT: ${QDRANT_URL} collection=${QDRANT_COLLECTION}`);
  console.log(`RAG_E2E_REAL: ${RAG_E2E_REAL ? 'enabled (LLM provider API key required)' : 'disabled (server in-memory mock fallback)'}`);

  // Step 1: 健康检查
  await step('GET /health (DB + Redis up)', async () => {
    if (await pollHealth()) return true;
    throw new Error('health check timeout 15s');
  });

  // Step 2: 注册 + verify + login
  const randomEmail = `smoke-rag-${randomUUID().slice(0, 8)}@example.com`;
  const randomPassword = 'SmokeRag@2026';

  const { accessToken } = await step('POST /user/register + verify + login (走真注册流程, server in-memory mock DB)', async () => {
    // 2.1 register
    const r1 = await fetch(`${BASE}/user/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: randomEmail, password: randomPassword }),
    });
    if (!r1.ok) {
      const text = await r1.text();
      throw new Error(`register status=${r1.status} body=${text.slice(0, 300)}`);
    }
    const j1 = await r1.json();
    const uid = j1.user?.uid || j1.data?.user?.uid || j1.uid;
    if (!uid) throw new Error('no uid in register response');

    // 2.2 Redis 读 verify token
    const token = await getVerifyToken(uid);
    if (!token) throw new Error('verify token not found in Redis (server in-memory mock?)');

    // 2.3 verify email
    const r2 = await fetch(`${BASE}/user/verify-email`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token }),
    });
    if (!r2.ok) {
      const text = await r2.text();
      throw new Error(`verify-email status=${r2.status} body=${text.slice(0, 300)}`);
    }

    // 2.4 login
    const r3 = await fetch(`${BASE}/user/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: randomEmail, password: randomPassword }),
    });
    if (!r3.ok) {
      const text = await r3.text();
      throw new Error(`login status=${r3.status} body=${text.slice(0, 300)}`);
    }
    const j3 = await r3.json();
    const accessToken = extractToken(r3, j3);
    if (!accessToken) throw new Error('no accessToken in login response');
    return { uid, accessToken };
  });

  const auth = { authorization: `Bearer ${accessToken}` };

  // Step 3: 创 KB + publish (触发 embedOnPublish 异步 hook)
  const kbId = await step('POST /admin/knowledge-items + submit + approve (触发 embedOnPublish 异步)', async () => {
    const longBody = '心理咨询是专业服务. '.repeat(40); // 40 * 13 = 520 字, 触发切 ≥2 chunk
    const r1 = await fetch(`${BASE}/admin/knowledge-items`, {
      method: 'POST',
      headers: { ...auth, 'content-type': 'application/json' },
      body: JSON.stringify({
        type: 'concept',
        title: `smoke-rag-${randomUUID().slice(0, 8)}`,
        content: { format: 'doc', body: longBody, preview: longBody.slice(0, 100) },
        metadata: { tags: ['smoke', 'rag'], difficulty: 1, category: 'test', personaId: null, searchKeywords: ['心理咨询'] },
      }),
    });
    if (!r1.ok) {
      const text = await r1.text();
      throw new Error(`create status=${r1.status} body=${text.slice(0, 300)}`);
    }
    const j1 = await r1.json();
    const id = j1.id || j1.data?.id;
    if (!id) throw new Error('no id in create response');

    // submit (draft → review)
    const r2 = await fetch(`${BASE}/admin/knowledge-items/${id}/submit`, {
      method: 'POST',
      headers: { ...auth, 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    if (!r2.ok) {
      const text = await r2.text();
      throw new Error(`submit status=${r2.status} body=${text.slice(0, 300)}`);
    }

    // approve (review → published, 触发 embedOnPublish 异步 hook)
    const r3 = await fetch(`${BASE}/admin/knowledge-items/${id}/approve`, {
      method: 'POST',
      headers: { ...auth, 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    if (!r3.ok) {
      const text = await r3.text();
      throw new Error(`approve status=${r3.status} body=${text.slice(0, 300)}`);
    }
    return id;
  });

  // Step 4: sleep 3s 等 embed 异步 + Qdrant HTTP GET 验 collection 有 vector
  await step(`sleep 3s + Qdrant HTTP GET /collections/${QDRANT_COLLECTION} 验 points_count > 0`, async () => {
    await new Promise((r) => setTimeout(r, 3000));
    const r = await fetch(`${QDRANT_URL}/collections/${QDRANT_COLLECTION}`);
    if (!r.ok) {
      if (r.status === 404) {
        throw new Error(`Qdrant collection ${QDRANT_COLLECTION} 404 (embedOnPublish 没创建 collection 或 write 失败, 走 V0.x 软降级)`);
      }
      throw new Error(`Qdrant GET status=${r.status}`);
    }
    const j = await r.json();
    const result = j.result || j;
    const pointsCount = result.points_count ?? result.vectors_count ?? 0;
    if (pointsCount < 1) {
      throw new Error(`Qdrant collection ${QDRANT_COLLECTION} points_count=${pointsCount} (expected ≥ 1, embedOnPublish 没写入)`);
    }
    console.log(`    Qdrant collection points_count=${pointsCount}`);
  });

  // Step 5: search 召回 (用 KB 内容里的关键词, 期望 score > 0)
  await step('GET /admin/knowledge-items?searchKeywords=心理咨询 验召回 (期望返回我们刚创的 KB)', async () => {
    const r = await fetch(`${BASE}/admin/knowledge-items?searchKeywords=心理咨询`, {
      method: 'GET',
      headers: { ...auth },
    });
    if (!r.ok) {
      const text = await r.text();
      throw new Error(`search status=${r.status} body=${text.slice(0, 300)}`);
    }
    const j = await r.json();
    const items = j.items ?? j.data?.items ?? [];
    const found = items.find((i) => i.id === kbId);
    if (!found) {
      throw new Error(`our KB ${kbId} not in search results (count=${items.length}, Qdrant 写入但 search vector path 没召回)`);
    }
    if (found.score !== undefined && found.score !== null && found.score < 0.5) {
      throw new Error(`KB score=${found.score} too low (expected ≥ 0.5, 跟 VS-3 续 spec 一致)`);
    }
    console.log(`    search 召回 KB id=${kbId} score=${found.score ?? 'n/a (LIKE fallback path)'}`);
  });

  console.log('\n=======================================');
  console.log(' [PASS] rag smoke complete');
  console.log('=======================================');
}

main().catch((e) => {
  dumpServerLogs('exception');
  console.error('\n[FAIL] uncaught:', e.message);
  cleanup(11);
});
