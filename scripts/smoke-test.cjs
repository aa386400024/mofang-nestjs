#!/usr/bin/env node
/**
 * smoke-test.cjs — 本地 dist 启动 + 健康检查 (大厂发版前必跑)
 *
 * 目标: 在大炮跑 deploy 之前, 验证本地 dist 能正常启动 + /health 通.
 * 不验证业务接口 (那是 jest e2e 的活, 跟这个脚本无关).
 *
 * 工作流:
 *   1. 启动 node dist/app.js (后台, child_process spawn)
 *   2. 等待 5 秒让 Nest 初始化完成
 *   3. curl http://127.0.0.1:3000/health
 *   4. 200 + JSON {status:"ok"} → 通过
 *   5. SIGTERM 子进程, 清理
 *
 * 跨平台:
 *   - Windows / macOS / Linux 通吃
 *   - 不依赖 Docker / Redis / MySQL (本脚本单独跑, .env 用本地)
 *   - 也不连远程 db / Redis — 只看 Nest 自身能不能启动
 *
 * 退出码:
 *   0 = 通过
 *   1 = 启动超时
 *   2 = /health 返 404 (源码 bug, 多半是路由没注册)
 *   3 = /health 返 5xx (服务内部错误, 看日志)
 *   4 = 启动后子进程异常退出
 *
 * 大厂踩坑:
 *   - 必须 spawn 子进程而非 fork, 否则 setDefaultEncoding 不会传过去
 *   - child.kill() 在 Windows 上要 taskkill /F, 普通 SIGTERM 不够 (Node 不会立刻退出)
 *   - 5 秒启动时间是大炮实测的 117.72.30.78 启动时间平均值 (2 核 2G, MySQL 在隔壁)
 *   - dist/app.js 必须存在, 否则这脚本无效 — 调用前请先 pnpm build
 */

const { spawn, execSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');

const DIST_PATH = path.join(__dirname, '..', 'dist', 'app.js');
const PORT = process.env.SMOKE_PORT || '3000';
const READY_TIMEOUT_MS = 15000;
const POLL_INTERVAL_MS = 500;

if (!fs.existsSync(DIST_PATH)) {
  console.error(`\u001b[31m[FAIL]\u001b[0m dist/app.js 不存在: ${DIST_PATH}`);
  console.error('  请先跑: pnpm build');
  process.exit(1);
}

console.log(`\u001b[36m[smoke]\u001b[0m 启动本地 dist/app.js (port=${PORT})...`);

// 启动子进程
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
      // Windows: Node 收到 SIGTERM 不会立刻退, taskkill /F 强杀
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

process.on('SIGINT', () => {
  cleanup();
  process.exit(130);
});

(async function pollHealth() {
  const start = Date.now();
  while (Date.now() - start < READY_TIMEOUT_MS) {
    if (exited) {
      console.error(`\u001b[31m[FAIL]\u001b[0m 进程异常退出 code=${exitCode}`);
      console.error('--- stdout ---');
      console.error(stdoutBuf);
      console.error('--- stderr ---');
      console.error(stderrBuf);
      cleanup();
      process.exit(4);
    }
    try {
      // node 18+ 内置 fetch, 不要再装 node-fetch
      const res = await fetch(`http://127.0.0.1:${PORT}/health`);
      const body = await res.json().catch(() => ({}));
      if (res.status === 200 && body.status === 'ok') {
        console.log(`\u001b[32m[OK]\u001b[0m /health 200 status=ok`);
        console.log(`  body: ${JSON.stringify(body)}`);
        cleanup();
        process.exit(0);
      }
      if (res.status === 404) {
        console.error(`\u001b[31m[FAIL]\u001b[0m /health 返 404 (源码 bug: 路由未注册)`);
        cleanup();
        process.exit(2);
      }
      if (res.status >= 500) {
        console.error(`\u001b[31m[FAIL]\u001b[0m /health 返 ${res.status} (服务内部错误)`);
        console.error('  body:', JSON.stringify(body));
        cleanup();
        process.exit(3);
      }
    } catch (err) {
      // 连不上, 还没启动好, 继续 poll
      if (err.cause?.code === 'ECONNREFUSED' || err.code === 'ECONNREFUSED') {
        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
        continue;
      }
      console.error(`\u001b[31m[FAIL]\u001b[0m 异常: ${err.message}`);
      cleanup();
      process.exit(4);
    }
  }

  console.error(`\u001b[31m[FAIL]\u001b[0m 启动超时 (${READY_TIMEOUT_MS}ms)`);
  console.error('--- stdout ---');
  console.error(stdoutBuf);
  console.error('--- stderr ---');
  console.error(stderrBuf);
  cleanup();
  process.exit(1);
})();