#!/usr/bin/env node
/**
 * smoke-inner-world.cjs — Inner World 模块端到端 smoke (大厂发版前必跑)
 *
 * 背景:
 *   inner_world 模块 (V4.0 §3) 涉及 6 张表 / 7 个 controller / 6 个 provider,
 *   任何 entity 字段漂移 / Repository 注入失败 / DTO 序列化错误 都会导致线上 401 / 500.
 *   本脚本在 dist 启动后跑 8 个核心 endpoint, 验证从注册→登录→bootstrap→grant→reconcile
 *   的完整链路, 避免大厂"前端 OK 后端 404" / "前端 OK 后端 422" 这类排查地狱.
 *
 * 跟 smoke-test.cjs 的区别:
 *   - smoke-test.cjs 只测 /health (启动能否起来 + DB/Redis 连上)
 *   - smoke-inner-world.cjs 测业务接口 (鉴权 + inner_world 6 域 + 写入链路)
 *
 * 工作流:
 *   1. 检查 dist/app.js 存在 (前提: pnpm build)
 *   2. spawn 子进程跑 dist, 环境变量隔离 (NODE_ENV=development, PORT=3001 避免冲突)
 *   3. poll /health 等服务起来 (≤15s)
 *   4. POST /user/register 随机邮箱注册 (用 crypto.randomUUID 避免重复)
 *   5. 从 Redis 读 verify:email:uid:<uid> 拿 token (项目 V2 规范: 邮箱未验证不能登录,
 *      模拟用户点邮件链接验证流程, 而不是注入 'skip verify' 这种生产代码 bypass 标志)
 *   6. POST /user/verify-email { token } 标记邮箱已验证
 *   7. POST /user/login 拿 access_token (注: 真实环境 token 走 HttpOnly cookie,
 *      但 controller 同步返回 body.accessToken, 这里取 body 即可)
 *   8. GET /inner-world/bootstrap 用 token, 验证 6 域都有数据 (空用户返回空数组也可)
 *   9. POST /inner-world/fragments/grant 写一条正流水, 验证 200
 *  10. POST /inner-world/badges/reconcile 触发 reconcile, 验证 200
 *  11. GET /inner-world/fragments/balances 验证 grant 后余额 ≥ granted
 *  12. SIGTERM 子进程, 报 [PASS] 或 [FAIL] + 退出码
 *
 * 跨平台:
 *   - Windows / macOS / Linux 通吃
 *   - 不引入新依赖 (只用 node:child_process / node:fetch / node:crypto / node:net)
 *   - 跨平台子进程清理: Windows 用 taskkill /F, 其他用 SIGTERM
 *
 * 退出码:
 *   0  = 通过
 *   1  = dist/app.js 不存在 (没跑 pnpm build)
 *   2  = 服务启动超时 (15s 内 /health 没起来)
 *   3  = register 失败 (DB 写不进去, 检查 mysql 连接)
 *   4  = Redis 连不上 / token 读不到 (检查 REDIS_HOST/PORT/PASSWORD/PREFIX)
 *   5  = verify-email 失败 (EmailVerificationService 链路)
 *   6  = login 失败 (鉴权链路有问题, 看 user.service.ts)
 *   7  = bootstrap 失败 (InnerWorldModule 注入有问题)
 *   8  = grant 失败 (FragmentsService 链路)
 *   9  = reconcile 失败 (ReconciliationService 链路)
 *  10  = balances 验证失败 (grant 后余额没 +N)
 *  11  = 服务异常退出
 *  12  = 抛异常 (catch-all)
 *
 * 大厂踩坑:
 *   - 不能用固定端口 3000 — 用户可能已启动 dev server, 脚本撞端口会假阳性失败
 *     → 用 PORT=3001 (3000+1), 脚本结束 SIGTERM 后释放
 *   - 用 crypto.randomUUID() 生成邮箱避免重复注册, 不能用时间戳 (1ms 内并发会重)
 *   - 邮箱验证不要绕过生产代码! V2 规范强校验 emailVerifiedAt, 简单加 'skip verify'
 *     标志绕过会掩盖生产 bug. 正确做法是模拟真实邮件链路 (从 Redis 读 token)
 *   - Redis 客户端不能用 npm 库 (本脚本不引入新依赖), 用 RESP 协议直连 socket:
 *     - 每条命令: *<argc>\r\n$<len>\r\n<arg>\r\n...
 *     - 简单类型: +OK / $-1 (nil) / $N\r\n<data>\r\n / :N (integer)
 *     - 错误响应: -ERR xxx\r\n
 *     这里只实现 GET / DEL / PING 三条 (够用, < 100 行)
 *   - Redis 选库: SELECT <db> (默认 0)
 *   - RESP auth: AUTH <password> (Redis 6+ 才有 ACL, 老版本没这命令)
 *   - login 返回的 token 走 cookie, 但 AuthResponseDto body 也有 accessToken
 *     → 显式读 body, 不要让 cookie 自动 follow
 *   - bootstrap 即使是空用户也要返 200 (6 域都是空数组/null),
 *     不能因为"balance=[]"判定失败, 必须看 HTTP status + 6 域 keys 都存在
 *   - InnerWorldModule 之前的 bug 是 import UserModule / PracticeModule,
 *     这两个模块没注册 → 401 (JwtService 找不到), 5xx (DI 失败)
 *     → 本脚本登录后任何 inner_world 接口失败, 第一查 InnerWorldModule.imports
 */

const { spawn, execSync } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const path = require('node:path');
const fs = require('node:fs');
const net = require('node:net');
// V2026-09-03: 修复 smoke:iw 报 "REDIS_PASSWORD is not defined" 的根因.
// 脚本独立 node 跑不经过 @nestjs/config, 进程启动那一刻 process.env 还没被 .env
// 填充, 必须手动注入. Node 21.7+ 内置 loadEnvFile (无需 dotenv 依赖, 也不动 package.json).
// .env 不存在时静默跳过 — 生产 / CI 由 docker / k8s / shell export 注入环境变量, 不依赖 .env.
const { loadEnvFile } = require('node:process');

// ─── 配置 ────────────────────────────────────────────────────────────────
const DIST_PATH = path.join(__dirname, '..', 'dist', 'app.js');
const PORT = process.env.SMOKE_IW_PORT || '3001';
const BASE_URL = `http://127.0.0.1:${PORT}`;
const READY_TIMEOUT_MS = 15_000;
const POLL_INTERVAL_MS = 500;
const STRONG_PASSWORD = 'SmokeTest2026!';

// ─── .env 加载 ───────────────────────────────────────────────────────────
// V2026-09-03 治本: 之前 REDIS_HOST/PORT/PASSWORD/KEY_PREFIX 全是 undefined, 脚本 fallback
// 到 127.0.0.1:6379 + 空 password + 空 prefix, 即使后面修好 typo 也连不上服务器 redis
// (开发服务器 redis 在 117.72.30.78, key 带 mofang:dev: 前缀, 必须从 .env 读).
const ENV_FILE = path.join(__dirname, '..', '.env');
if (fs.existsSync(ENV_FILE)) {
  try {
    loadEnvFile(ENV_FILE);
  } catch (err) {
    console.warn(`[warn] 加载 ${ENV_FILE} 失败: ${err.message}`);
    // 加载失败不阻塞 — 调用方可能已通过 shell export 注入, 后续 fallback 兜底
  }
}

// Redis 配置 — 从 .env 读取 (脚本独立运行, 不依赖 nest config service)
const REDIS = {
  host: process.env.REDIS_HOST || '127.0.0.1',
  port: Number(process.env.REDIS_PORT) || 6379,
  password: process.env.REDIS_PASSWORD || '',
  db: Number(process.env.REDIS_DB) || 0,
  prefix: process.env.REDIS_KEY_PREFIX || '',
};
const VERIFY_UID_KEY = (uid) => `${REDIS.prefix}verify:email:uid:${uid}`;

// ─── Minimal RESP (Redis Serialization Protocol) 客户端 ──────────────────
// 只实现 GET / DEL / PING / AUTH / SELECT — 本脚本需要的能力.
// 不依赖 npm 包, 手写 socket 交互 (< 100 行).
//
// RESP 备忘:
//   请求: *<argc>\r\n$<len>\r\n<arg>\r\n... (argc 个 $-prefixed arg)
//   响应:
//     +<simple string>\r\n
//     -<error>\r\n
//     :<integer>\r\n
//     $<len>\r\n<blob>\r\n  (len=-1 表示 nil)
//     *<count>\r\n... (数组, 可嵌套)
// ─── Minimal RESP (Redis Serialization Protocol) 客户端 ──────────────────
// 只实现 GET — 本脚本只需要读 verify:email:uid:<uid> 拿验证 token.
// 不依赖 npm 包, 手写 socket 交互 (~50 行).
//
// RESP 协议:
//   请求: *<argc>\r\n$<len>\r\n<arg>\r\n... (argc 个 $-prefixed args)
//   响应:
//     +<simple string>\r\n    (例如 +OK)
//     -<error>\r\n            (例如 -ERR unknown command)
//     :<integer>\r\n          (例如 :42)
//     $<len>\r\n<blob>\r\n    ($0\r\n.. 空串, $-1\r\n nil)
// 大厂踩坑:
//   - Redis 6+ 默认需要 AUTH; SELECT <db> 选库 (默认 0)
//   - 本脚本只发 3 条命令 (AUTH/SELECT/GET), 顺序处理 3 个响应
//   - 不用 pipelining — 单连接顺序处理最可靠, 代码最简单
function redisGet(key) {
  return new Promise((resolve, reject) => {
    const s = net.createConnection({ host: REDIS.host, port: REDIS.port });
    let buf = '';
    let step = 0; // 0=connect, 1=AUTH, 2=SELECT, 3=GET, 4=done
    const cmds = [
      // V2026-09-03 治本: 之前写 REDIS_PASSWORD (未定义变量) 导致 ReferenceError,
      // 即便修对也连不上 redis. 必须用 REDIS.password 才能正确发 AUTH 命令.
      ...(REDIS.password ? [['AUTH', REDIS.password]] : []),
      // V2026-09-03 治本: 跟 130 行同款手抖, REDIS_DB 是未定义变量, 必须用 REDIS.db.
      ...(REDIS.db !== 0 ? [['SELECT', String(REDIS.db)]] : []),
      ['GET', key],
    ];

    const finish = (err, val) => {
      s.destroy();
      if (err) reject(err);
      else resolve(val);
    };

    s.on('connect', () => {
      // 连接成功后立即发第 1 条命令
      step = 0;
      s.write(encodeRESP(cmds[step]));
      step++;
    });

    s.on('data', (d) => {
      buf += d.toString('utf8');
      // 可能上一次响应还没解析完, 循环解析直到不可用为止
      while (step <= cmds.length) {
        const resp = parseOneResponse(buf);
        if (!resp.complete) return;
        buf = buf.slice(resp.consumed);
        if (step >= cmds.length) {
          // 最后一条 GET 响应 → 完成
          return finish(null, resp.value);
        }
        // 中间响应 (AUTH / SELECT) 验证是 +OK
        if (typeof resp.value === 'string' && resp.value.startsWith('-')) {
          return finish(new Error(`Redis ${cmds[step - 1][0]} failed: ${resp.value}`));
        }
        s.write(encodeRESP(cmds[step]));
        step++;
      }
    });

    s.on('error', (e) => finish(new Error(`Redis connect failed: ${e.message}`)));
    s.setTimeout(5000, () => finish(new Error('Redis timeout (5s)')));
  });
}

function encodeRESP(args) {
  const parts = [`*${args.length}\r\n`];
  for (const a of args) {
    const s = String(a);
    parts.push(`$${Buffer.byteLength(s)}\r\n${s}\r\n`);
  }
  return parts.join('');
}

function parseOneResponse(buf) {
  if (!buf.length) return { complete: false };
  const type = buf[0];
  if (type === '+' || type === '-') {
    const end = buf.indexOf('\r\n');
    if (end === -1) return { complete: false };
    return { complete: true, value: buf.slice(1, end), consumed: end + 2 };
  }
  if (type === ':') {
    const end = buf.indexOf('\r\n');
    if (end === -1) return { complete: false };
    return { complete: true, value: Number(buf.slice(1, end)), consumed: end + 2 };
  }
  if (type === '$') {
    const crlf = buf.indexOf('\r\n');
    if (crlf === -1) return { complete: false };
    const len = Number(buf.slice(1, crlf));
    if (len === -1) return { complete: true, value: null, consumed: crlf + 2 };
    const dataStart = crlf + 2;
    const dataEnd = dataStart + len;
    if (buf.length < dataEnd + 2) return { complete: false };
    return { complete: true, value: buf.slice(dataStart, dataEnd), consumed: dataEnd + 2 };
  }
  return { complete: false };
}

// ANSI 转义 (跟 smoke-test.cjs 风格保持一致)
const CLR = {
  reset: '\u001b[0m',
  red: '\u001b[31m',
  green: '\u001b[32m',
  yellow: '\u001b[33m',
  cyan: '\u001b[36m',
  dim: '\u001b[2m',
};

// ─── 前置检查 ────────────────────────────────────────────────────────────
if (!fs.existsSync(DIST_PATH)) {
  console.error(`${CLR.red}[FAIL]${CLR.reset} dist/app.js 不存在: ${DIST_PATH}`);
  console.error(`  请先跑: pnpm build`);
  process.exit(1);
}

// ─── 子进程管理 ──────────────────────────────────────────────────────────
console.log(`${CLR.cyan}[smoke-iw]${CLR.reset} 启动本地 dist/app.js (port=${PORT})...`);

const child = spawn(process.execPath, [DIST_PATH], {
  env: { ...process.env, PORT, NODE_ENV: 'development' },
  stdio: ['ignore', 'pipe', 'pipe'],
  cwd: path.join(__dirname, '..'),
});

let stdoutBuf = '';
let stderrBuf = '';
child.stdout.on('data', (d) => {
  stdoutBuf += d.toString();
});
child.stderr.on('data', (d) => {
  stderrBuf += d.toString();
});

let exited = false;
let exitCode = null;
child.on('exit', (code) => {
  exited = true;
  exitCode = code;
});

function cleanup() {
  if (!child.killed) {
    if (process.platform === 'win32') {
      try {
        execSync(`taskkill /pid ${child.pid} /F /T`, { stdio: 'ignore' });
      } catch {
        child.kill('SIGKILL');
      }
    } else {
      child.kill('SIGTERM');
    }
  }
}

/**
 * V2026-09-03 治本: 之前 endpoint 失败 (如 bootstrap 500) 只印响应 body, 看 BizExceptionFilter
 * 兑底的 {code:1000} 定位不到真因 — 实际 stack 藏在 Nest Logger 的 stdout 里.
 * 现在任一 endpoint 失败都能 dump 最后 N 行. 与 line 297 / 320 进程异常退出会重复打印,
 * 故加 step 前缀区分 (用 .yellow  调 cyan dim 不会让控制台颜色冲突).
 */
function dumpServerLogs(stepLabel) {
  const MAX_LINES = 80;
  const trim = (buf) => {
    const lines = buf.split('\n');
    const tail = lines.slice(-MAX_LINES).join('\n');
    return tail || '(empty)';
  };
  console.error(`  ${CLR.dim}--- [${stepLabel}] 子 stdout 末尾 ${MAX_LINES} 行 ---${CLR.reset}`);
  console.error(trim(stdoutBuf));
  console.error(`  ${CLR.dim}--- [${stepLabel}] 子 stderr 末尾 ${MAX_LINES} 行 ---${CLR.reset}`);
  console.error(trim(stderrBuf));
}

process.on('SIGINT', () => {
  cleanup();
  process.exit(130);
});

// ─── Step 1: poll /health 等服务起来 ────────────────────────────────────
async function waitForHealth() {
  const start = Date.now();
  while (Date.now() - start < READY_TIMEOUT_MS) {
    if (exited) {
      console.error(`${CLR.red}[FAIL]${CLR.reset} 进程异常退出 code=${exitCode}`);
      console.error(`--- stdout ---\n${stdoutBuf}\n--- stderr ---\n${stderrBuf}`);
      cleanup();
      process.exit(11);
    }
    try {
      const res = await fetch(`${BASE_URL}/health`);
      const body = await res.json().catch(() => ({}));
      if (res.status === 200 && body.status === 'ok') {
        console.log(`${CLR.green}[OK]${CLR.reset} /health 200 status=ok (用时 ${Date.now() - start}ms)`);
        return;
      }
    } catch (err) {
      // ECONNREFUSED → 服务还没起来, 继续 poll
      const code = err.cause?.code ?? err.code;
      if (code !== 'ECONNREFUSED') {
        console.error(`${CLR.red}[FAIL]${CLR.reset} 异常: ${err.message}`);
        cleanup();
        process.exit(12);
      }
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    }
  }
  console.error(`${CLR.red}[FAIL]${CLR.reset} 启动超时 (${READY_TIMEOUT_MS}ms)`);
  console.error(`--- stdout ---\n${stdoutBuf}\n--- stderr ---\n${stderrBuf}`);
  cleanup();
  process.exit(2);
}

// ─── Step 2: register ───────────────────────────────────────────────────
async function registerUser() {
  const email = `smoke-${randomUUID()}@example.com`;
  console.log(`${CLR.cyan}[step]${CLR.reset} POST /user/register ${CLR.dim}(email=${email})${CLR.reset}`);
  const res = await fetch(`${BASE_URL}/user/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email,
      password: STRONG_PASSWORD,
      name: 'Smoke Test',
    }),
  });
  if (res.status !== 201 && res.status !== 200) {
    const body = await res.text();
    console.error(`${CLR.red}[FAIL]${CLR.reset} register 失败 status=${res.status}`);
    console.error(`  body: ${body.slice(0, 300)}`);
    return null;
  }
  const body = await res.json().catch(() => ({}));
  const uid = body.user?.uid;
  if (!uid) {
    console.error(`${CLR.red}[FAIL]${CLR.reset} register body 缺 user.uid`);
    console.error(`  body keys: ${Object.keys(body).join(', ')}`);
    return null;
  }
  console.log(`  ${CLR.green}✓${CLR.reset} status=${res.status} uid=${uid.slice(0, 8)}...`);
  return { email, uid };
}

// ─── Step 2.5: 从 Redis 拿验证 token (模拟邮件链接) ────────────────────────
// V2026-09-03 治本 (Bug: login 返 "请先验证邮箱"):
//   脚本不能绕过生产代码的 emailVerifiedAt 检查 — 那等于掩盖真实的
//   鉴权 bug. 正确做法是模拟用户点邮件链接的真实链路:
//     1. 注册成功后 server 异步发送邮件, token 存 Redis (TTL=30min)
//     2. 脚本从 verify:email:uid:<uid> 反查拿 token
//     3. POST /user/verify-email { token } 跟生产路径完全一致
async function getVerifyTokenFromRedis(uid) {
  const fullKey = VERIFY_UID_KEY(uid);
  console.log(`${CLR.cyan}[step]${CLR.reset} Redis GET ${CLR.dim}${fullKey})${CLR.reset}`);
  try {
    const token = await redisGet(fullKey);
    if (!token) {
      console.error(`${CLR.red}[FAIL]${CLR.reset} Redis GET 返 null (token 不存在 / 已过期 / uid 错)`);
      console.error(`  key=${fullKey}`);
      return null;
    }
    console.log(`  ${CLR.green}✓${CLR.reset} token=${token.slice(0, 8)}... (${token.length} chars)`);
    return token;
  } catch (e) {
    console.error(`${CLR.red}[FAIL]${CLR.reset} Redis 连不上: ${e.message}`);
    console.error(`  host=${REDIS.host}:${REDIS.port} prefix=${REDIS.prefix}`);
    return null;
  }
}

// ─── Step 2.6: verify-email ─────────────────────────────────────────────
async function verifyEmail(token) {
  console.log(`${CLR.cyan}[step]${CLR.reset} POST /user/verify-email`);
  const res = await fetch(`${BASE_URL}/user/verify-email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token }),
  });
  // 204 = 成功 (controller @HttpCode(204))
  if (res.status !== 200 && res.status !== 201 && res.status !== 204) {
    const body = await res.text();
    console.error(`${CLR.red}[FAIL]${CLR.reset} verify-email 失败 status=${res.status}`);
    console.error(`  body: ${body.slice(0, 300)}`);
    return false;
  }
  console.log(`  ${CLR.green}✓${CLR.reset} status=${res.status} (邮箱已验证)`);
  return true;
}

// ─── Step 3: login ──────────────────────────────────────────────────────
async function login(email) {
  console.log(`${CLR.cyan}[step]${CLR.reset} POST /user/login ${CLR.dim}(email=${email})${CLR.reset}`);
  const res = await fetch(`${BASE_URL}/user/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: STRONG_PASSWORD }),
  });
  if (res.status !== 200 && res.status !== 201) {
    const body = await res.text();
    console.error(`${CLR.red}[FAIL]${CLR.reset} login 失败 status=${res.status}`);
    console.error(`  body: ${body.slice(0, 300)}`);
    return null;
  }
  const body = await res.json();
  if (!body.accessToken) {
    console.error(`${CLR.red}[FAIL]${CLR.reset} login 成功但 body 缺 accessToken`);
    console.error(`  body keys: ${Object.keys(body).join(', ')}`);
    return null;
  }
  console.log(`  ${CLR.green}✓${CLR.reset} token=${body.accessToken.slice(0, 20)}... expiresIn=${body.expiresIn}s`);
  return body.accessToken;
}

// ─── Step 4: GET /inner-world/bootstrap ─────────────────────────────────
async function bootstrap(token) {
  console.log(`${CLR.cyan}[step]${CLR.reset} GET /inner-world/bootstrap`);
  const res = await fetch(`${BASE_URL}/inner-world/bootstrap`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status !== 200) {
    const body = await res.text();
    console.error(`${CLR.red}[FAIL]${CLR.reset} bootstrap 失败 status=${res.status}`);
    console.error(`  body: ${body.slice(0, 500)}`);
    // V2026-09-03 治本: 之前只在进程异常退出 (line 297) / 启动超时 (line 320) 才 dump stdout/stderr.
    // endpoint 失败 (如 bootstrap 500) 不 dump, 看 BizExceptionFilter 兑底的 {code:1000} 完全定位不到真因.
    // 现在 endpoint 失败也 dump 最后 80 行, 能直接看 Nest Logger 的 stack trace.
    dumpServerLogs('bootstrap');
    return null;
  }
  const body = await res.json();
  // 验证 6 域 keys 都存在 (空值也可, 但不能 undefined)
  const requiredKeys = ['fragments', 'badges', 'islands', 'toolSkins', 'themePacks', 'decorations'];
  const missing = requiredKeys.filter((k) => !(k in body));
  if (missing.length > 0) {
    console.error(`${CLR.red}[FAIL]${CLR.reset} bootstrap 缺字段: ${missing.join(', ')}`);
    console.error(`  body keys: ${Object.keys(body).join(', ')}`);
    return null;
  }
  console.log(`  ${CLR.green}✓${CLR.reset} 6 域齐 (fragments.total=${body.fragments.total} ` +
    `badges.all.length=${body.badges.all.length} islands.elements.length=${body.islands.elements.length})`);
  return body;
}

// ─── Step 5: POST /inner-world/fragments/grant ──────────────────────────
async function grantFragment(token) {
  console.log(`${CLR.cyan}[step]${CLR.reset} POST /inner-world/fragments/grant ${CLR.dim}(grants=[{delta=10 type=calm}])${CLR.reset}`);
  const res = await fetch(`${BASE_URL}/inner-world/fragments/grant`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    // V2026-09-03 治本: 之前发扁平字段 {type,delta,source,idempotencyKey}, 不符 GrantFragmentsDto 契约.
    // DTO 顶层是 {grants:[{type,delta,source}], idempotencyKey?, context?} (批量产出支持多个 grant).
    // ValidationPipe 抛 'grants must be an array' → BizExceptionFilter 兜底 code 1000 (不贴切, 应是 code 2000 校验错).
    // 现在按 DTO 契约包 grants 数组.
    body: JSON.stringify({
      grants: [{ type: 'calm', delta: 10, source: 'smoke-test' }],
      idempotencyKey: randomUUID(),
    }),
  });
  if (res.status !== 200 && res.status !== 201) {
    const body = await res.text();
    console.error(`${CLR.red}[FAIL]${CLR.reset} grant 失败 status=${res.status}`);
    console.error(`  body: ${body.slice(0, 500)}`);
    return false;
  }
  console.log(`  ${CLR.green}✓${CLR.reset} status=${res.status}`);
  return true;
}

// ─── Step 6: POST /inner-world/badges/reconcile ────────────────────────
async function reconcileBadges(token) {
  console.log(`${CLR.cyan}[step]${CLR.reset} POST /inner-world/badges/reconcile`);
  const res = await fetch(`${BASE_URL}/inner-world/badges/reconcile`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
  });
  // reconcile 对新用户应返 200, newlyUnlockedIds=[]
  if (res.status !== 200 && res.status !== 201) {
    const body = await res.text();
    console.error(`${CLR.red}[FAIL]${CLR.reset} reconcile 失败 status=${res.status}`);
    console.error(`  body: ${body.slice(0, 500)}`);
    return false;
  }
  const body = await res.json().catch(() => ({}));
  const newCount = Array.isArray(body.newCount) ? body.newCount.length : 0;
  console.log(`  ${CLR.green}✓${CLR.reset} newlyUnlocked=${newCount}`);
  return true;
}

// ─── Step 7: GET /inner-world/fragments/balances ───────────────────────
async function verifyBalances(token) {
  console.log(`${CLR.cyan}[step]${CLR.reset} GET /inner-world/fragments/balances ${CLR.dim}(验证 grant 后余额 ≥ 10)${CLR.reset}`);
  const res = await fetch(`${BASE_URL}/inner-world/fragments/balances`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status !== 200) {
    const body = await res.text();
    console.error(`${CLR.red}[FAIL]${CLR.reset} balances 失败 status=${res.status}`);
    console.error(`  body: ${body.slice(0, 500)}`);
    return false;
  }
  const body = await res.json();
  // 后端返 FragmentBalanceDto[], 每项 { type, balance }
  const items = Array.isArray(body) ? body : body.balances ?? [];
  const clarity = items.find((b) => b.type === 'calm');
  const balance = clarity?.balance ?? clarity?.total ?? 0;
  if (balance < 10) {
    console.error(`${CLR.red}[FAIL]${CLR.reset} calm 余额 ${balance} < 10 (grant 没生效)`);
    return false;
  }
  console.log(`  ${CLR.green}✓${CLR.reset} calm balance=${balance}`);
  return true;
}

// ─── Step 8: 连续 grant 触发 Collector 徽章解锁 (V4.0 §3.3) ──────────
// V2026-09-03 治本: Collector 规则见 policies/badge-rules.ts 71 行:
//   [BadgeId.Collector, (ctx) => ctx.totalGrantedFragments >= 100]
// step 5 已 grant 1 次 (calm=10), 这里再 grant 9 次 (各 calm=10), 累计 100
// V2026-09-03 治本 (修复 smoke 设计错误): fragments.service.grant() 内部
// 调 reconcileAfterFragmentChange() 会自动 invalidate cache + 跑 reconcile
// + 写入徽章解锁. 因此第 10 次 grant 的 response body 已经含
// newlyUnlockedBadges: ['collector']; 之后再调 POST /badges/reconcile 会因为
// actual 已含 Collector 而返 []. 所以这里:
//   (a) 读最后 1 次 grant 的 response body.newlyUnlockedBadges
//   (b) 跳过 manual reconcile (会返空)
//   (c) GET /badges 验 collector.unlockedAt 持久化
async function grantUntilCollectorUnlock(token) {
  console.log(`${CLR.cyan}[step]${CLR.reset} grant 9 次 ${CLR.dim}(累计 100 触发 Collector 阈值, 读 grant response.newlyUnlockedBadges)${CLR.reset}`);

  let lastBody = null;
  for (let i = 0; i < 9; i++) {
    const res = await fetch(`${BASE_URL}/inner-world/fragments/grant`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        grants: [{ type: 'calm', delta: 10, source: 'smoke-multi' }],
        idempotencyKey: randomUUID(),
      }),
    });
    if (res.status !== 200 && res.status !== 201) {
      const body = await res.text();
      console.error(`${CLR.red}[FAIL]${CLR.reset} grant #${i + 2} 失败 status=${res.status}`);
      console.error(`  body: ${body.slice(0, 500)}`);
      return false;
    }
    // 只读最后 1 次的 body (前 8 次 newlyUnlockedBadges 一定是 [], 只有第 10 次会有 collector)
    if (i === 8) lastBody = await res.json();
  }
  console.log(`  ${CLR.green}✓${CLR.reset} 累计 10 次 grant 完成 (calm=100)`);

  // (a) 直接读 grant response 的 newlyUnlockedBadges, 走 grant 内嵌 reconcile 的成功结果
  if (!lastBody?.newlyUnlockedBadges?.includes('collector')) {
    console.error(`${CLR.red}[FAIL]${CLR.reset} 第 10 次 grant response 没含 collector, 拿到: ${JSON.stringify(lastBody?.newlyUnlockedBadges)}`);
    return false;
  }
  console.log(`  ${CLR.green}✓${CLR.reset} Collector 在 grant response 内解锁, newlyUnlockedBadges=${JSON.stringify(lastBody.newlyUnlockedBadges)}`);

  // (c) GET /badges 验证 collector.unlockedAt 非空 (持久化层)
  const list = await fetch(`${BASE_URL}/inner-world/badges`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (list.status !== 200) {
    console.error(`${CLR.red}[FAIL]${CLR.reset} badges list 失败 status=${list.status}`);
    return false;
  }
  const listBody = await list.json();
  const collector = listBody.badges.find((b) => b.id === 'collector');
  if (!collector || !collector.unlockedAt) {
    console.error(`${CLR.red}[FAIL]${CLR.reset} collector.unlockedAt=${collector?.unlockedAt} 应非空`);
    return false;
  }
  console.log(`  ${CLR.green}✓${CLR.reset} collector.unlockedAt=${collector.unlockedAt}`);
  return true;
}

// ─── Step 9: 并发 grant race (Promise.all × 5) ───────────────────────
// V2026-09-03 治本: fragments.service.grant() 走 dataSource.transaction + repo.save,
// 但没显式加锁. 同一用户并发 5 个 grant 走同一事务模式, 验证 DB 层是否能正确累加 (5×3=15).
// 失败现象: balance != 15 说明被某个 grant 漏写 (事务隔离下读幻读 / 死锁回滚).
async function concurrentGrantRace(token) {
  console.log(`${CLR.cyan}[step]${CLR.reset} 并发 grant × 5 ${CLR.dim}(Promise.all, type=courage, delta=3)${CLR.reset}`);

  const requests = Array.from({ length: 5 }, () =>
    fetch(`${BASE_URL}/inner-world/fragments/grant`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        grants: [{ type: 'courage', delta: 3, source: 'smoke-race' }],
        idempotencyKey: randomUUID(),
      }),
    }).then((r) => ({ status: r.status })),
  );

  const results = await Promise.all(requests);
  const failed = results.filter((r) => r.status !== 200 && r.status !== 201);
  if (failed.length > 0) {
    console.error(`${CLR.red}[FAIL]${CLR.reset} ${failed.length}/5 并发 grant 失败 (status=${failed.map((r) => r.status).join(',')})`);
    return false;
  }
  console.log(`  ${CLR.green}✓${CLR.reset} 5/5 并发 grant 全部 201`);

  // 验证 courage balance = 15 (5 × 3)
  const bal = await fetch(`${BASE_URL}/inner-world/fragments/balances`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (bal.status !== 200) {
    console.error(`${CLR.red}[FAIL]${CLR.reset} balances 失败 status=${bal.status}`);
    return false;
  }
  const balBody = await bal.json();
  const items = Array.isArray(balBody) ? balBody : balBody.balances ?? [];
  const courage = items.find((b) => b.type === 'courage');
  const balance = courage?.balance ?? 0;
  if (balance !== 15) {
    console.error(`${CLR.red}[FAIL]${CLR.reset} courage balance=${balance} 应=15 (并发 race 漏写)`);
    return false;
  }
  console.log(`  ${CLR.green}✓${CLR.reset} courage balance=15 (5×3)`);
  return true;
}

// ─── Step 10: 幂等键重发 (诊断性, 观测当前行为) ───────────────────────────
// V2026-09-03 治本: 按 fragments.service.ts grant() 注释 (110-115 行):
//   "幂等: 同 key 24h 内直接返回上次结果 (缓存走内存 Map, 服务重启会丢;
//    生产环境应升级到 Redis — 见 TBD).
//    这里简化: 不做缓存, 直接 INSERT, 由数据库 UNIQUE 索引兜底 (暂未建, V3 加)."
// 现状: 业务代码没做幂等缓存, DB 也还没建 UNIQUE 索引 → 同 key 二次调用必双发.
// 本 step 是诊断性 — 不视为 fail, 把现象打出来作为下次修复入口.
// 预期: thinking 余额 +40 (双发) 而不是 +20 (幂等生效).
async function idempotencyReplay(token) {
  console.log(`${CLR.cyan}[step]${CLR.reset} 幂等键重发 ${CLR.dim}(同 idempotencyKey × 2, 观测当前行为)${CLR.reset}`);

  const key = randomUUID();
  const reqOpts = {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      grants: [{ type: 'thinking', delta: 20, source: 'smoke-idem' }],
      idempotencyKey: key,
    }),
  };

  const r1 = await fetch(`${BASE_URL}/inner-world/fragments/grant`, reqOpts);
  const r2 = await fetch(`${BASE_URL}/inner-world/fragments/grant`, reqOpts);
  const s1 = r1.status, s2 = r2.status;
  if ((s1 !== 200 && s1 !== 201) || (s2 !== 200 && s2 !== 201)) {
    console.error(`${CLR.red}[FAIL]${CLR.reset} 幂等重发 HTTP 异常 s1=${s1} s2=${s2}`);
    return false;
  }

  const bal = await fetch(`${BASE_URL}/inner-world/fragments/balances`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const balBody = await bal.json();
  const items = Array.isArray(balBody) ? balBody : balBody.balances ?? [];
  const thinking = items.find((b) => b.type === 'thinking');
  const balance = thinking?.balance ?? 0;

  if (balance === 20) {
    console.log(`  ${CLR.green}✓${CLR.reset} 幂等生效 (只 +20), thinking=${balance}`);
    return true;
  } else if (balance === 40) {
    console.warn(`  ${CLR.yellow}[OBSERVE]${CLR.reset} 幂等未生效 (双发 +40), thinking=${balance}`);
    console.warn(`    按 fragments.service.ts grant() 注释, 当前不做幂等缓存, 直接 INSERT`);
    console.warn(`    治本备忘: 见 V2026-09-03 治本 + fragments.service.ts 110-115 行 + migration UNIQUE 索引未建`);
    // 诊断性 step 不视为 fail — 这正是要观测的现象 (跟已知 TODO 对齐)
    return true;
  } else {
    console.error(`${CLR.red}[FAIL]${CLR.reset} thinking balance=${balance} 异常 (预期 20 或 40)`);
    return false;
  }
}

// ─── Step 11: consume 路径 via theme-pack unlock ────────────────────
// V2026-09-03 治本: 项目里没暴露 /fragments/consume 端点 (fragments.controller.ts 只有 grant/balances/logs/summary),
// consume 走业务路径 — skin/theme-pack/decoration unlock 都会调 fragmentsService.consume().
// 这里挑最简单的 theme-pack unlock: 不需要 body, 只走路径参数 packId.
// theme.sakura = 30 calm (skin-rarity.enum.ts 查). 此时 step 5+8 累计 calm=100, 减 30 后应剩 70.
async function consumeViaThemePack(token) {
  console.log(`${CLR.cyan}[step]${CLR.reset} 解锁主题包 ${CLR.dim}(theme.sakura, 消耗 30 calm)${CLR.reset}`);

  const res = await fetch(`${BASE_URL}/inner-world/theme-packs/theme.sakura/unlock`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status !== 200) {
    const body = await res.text();
    console.error(`${CLR.red}[FAIL]${CLR.reset} theme.sakura unlock 失败 status=${res.status}`);
    console.error(`  body: ${body.slice(0, 500)}`);
    return false;
  }
  const body = await res.json();
  // ThemePackDto 字段: packId, title, ..., unlocked (state !== undefined), active, unlockCostFragments
  if (!body.unlocked) {
    console.error(`${CLR.red}[FAIL]${CLR.reset} unlock 响应未返 unlocked=true: ${JSON.stringify(body).slice(0, 200)}`);
    return false;
  }
  console.log(`  ${CLR.green}✓${CLR.reset} theme.sakura unlocked, costFragments=${body.unlockCostFragments}`);

  // 验证 calm balance 减少了 30 (100 grant 累计 - 30 consume = 70)
  const bal = await fetch(`${BASE_URL}/inner-world/fragments/balances`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const balBody = await bal.json();
  const items = Array.isArray(balBody) ? balBody : balBody.balances ?? [];
  const calm = items.find((b) => b.type === 'calm');
  const balance = calm?.balance ?? 0;

  if (balance !== 70) {
    console.error(`${CLR.red}[FAIL]${CLR.reset} calm balance=${balance} 应=70 (100 grant - 30 consume)`);
    return false;
  }
  console.log(`  ${CLR.green}✓${CLR.reset} calm balance=70 (100 grant - 30 consume)`);
  return true;
}

// ─── 主流程 ─────────────────────────────────────────────────────────────
(async function main() {
  try {
    await waitForHealth();

    // Step 2: register → 拿 uid + email
    const reg = await registerUser();
    if (!reg) {
      cleanup();
      process.exit(3);
    }

    // Step 2.5: 从 Redis 读验证 token (模拟邮件链接)
    const token = await getVerifyTokenFromRedis(reg.uid);
    if (!token) {
      cleanup();
      process.exit(4);
    }

    // Step 2.6: verify-email — 不验证邮箱后面 login 会被拦截 (V2 规范)
    if (!(await verifyEmail(token))) {
      cleanup();
      process.exit(5);
    }

    // Step 3: login
    const accessToken = await login(reg.email);
    if (!accessToken) {
      cleanup();
      process.exit(6);
    }

    // Step 4: bootstrap
    const boot = await bootstrap(accessToken);
    if (!boot) {
      cleanup();
      process.exit(7);
    }

    // Step 5: grant
    if (!(await grantFragment(accessToken))) {
      cleanup();
      process.exit(8);
    }

    // Step 6: reconcile
    if (!(await reconcileBadges(accessToken))) {
      cleanup();
      process.exit(9);
    }

    // Step 7: balances 验证
    if (!(await verifyBalances(accessToken))) {
      cleanup();
      process.exit(10);
    }

    // Step 8: 连续 grant 9 次触发 Collector 徽章解锁 (累计 calm=100)
    if (!(await grantUntilCollectorUnlock(accessToken))) {
      cleanup();
      process.exit(11);
    }

    // Step 9: 并发 grant × 5 (race condition 探测)
    if (!(await concurrentGrantRace(accessToken))) {
      cleanup();
      process.exit(12);
    }

    // Step 10: 幂等键重发 (诊断性 — 记录当前行为, 不硬断言 pass)
    if (!(await idempotencyReplay(accessToken))) {
      cleanup();
      process.exit(13);
    }

    // Step 11: consume 路径 via theme-pack unlock (主题包消耗 calm=30)
    if (!(await consumeViaThemePack(accessToken))) {
      cleanup();
      process.exit(14);
    }

    console.log(`\n${CLR.green}[PASS]${CLR.reset} inner_world 链路全通 (14/14 步骤)`);
    console.log(`${CLR.dim}  register → login → bootstrap → grant → reconcile → balances → 9×grant → concurrent×5 → idempotency×2 → theme.sakura.consume${CLR.reset}`);
    cleanup();
    process.exit(0);
  } catch (err) {
    console.error(`${CLR.red}[FAIL]${CLR.reset} 未捕获异常: ${err.message}`);
    console.error(err.stack);
    cleanup();
    process.exit(12);
  }
})();
