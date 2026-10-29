// E2E 探针: 真实连一次 voice WS, 握手 vpt 模板, 跑一轮咨询师发言, 把服务端推的帧
// 全部打出来并自动断言. 不打 flutter, 不跑测试, 只验证"线通不通 + 角色注没注入".
//
// 用法 (后端已起, 监听 3000):
//   node scripts/e2e-voice-ws-probe.mjs
//   node scripts/e2e-voice-ws-probe.mjs vpt_workplace_intellectualization_l1 亦舟
//
// 前提: 本地 .env 有 JWT_SECRET + MINIMAX_API_KEY; MySQL/Qdrant 起着; 后端 start:win 中.
// 退出码: 0 = 关键断言全过; 1 = 有断言红 (打印原因).
import { WebSocket } from 'ws';
import { createHmac, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// ── 读 .env (极简 KEY=VALUE, 不引 dotenv) ──────────────────────────────────
function loadEnv() {
  const out = {};
  let raw;
  try {
    raw = readFileSync(join(root, '.env'), 'utf8');
  } catch {
    console.error('✗ 读不到 .env, 请在仓库根目录');
    process.exit(1);
  }
  for (const line of raw.split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return out;
}

const env = loadEnv();
const PORT = env.PORT ?? '3000';
const JWT_SECRET = env.JWT_SECRET;
if (!JWT_SECRET) {
  console.error('✗ .env 缺 JWT_SECRET');
  process.exit(1);
}

// ── 手签 HS256 JWT (不引 jsonwebtoken) ─────────────────────────────────────
const b64url = (obj) => Buffer.from(typeof obj === 'string' ? obj : JSON.stringify(obj)).toString('base64url');
function signDevToken() {
  const header = b64url({ alg: 'HS256', typ: 'JWT' });
  const now = Math.floor(Date.now() / 1000);
  const body = b64url({ sub: 'e2e-probe-user', tenantId: 'default', iat: now, exp: now + 600 });
  const data = `${header}.${body}`;
  const sig = createHmac('sha256', JWT_SECRET).update(data).digest('base64url');
  return `${data}.${sig}`;
}

// ── 参数 ────────────────────────────────────────────────────────────────────
const templateId = process.argv[2] ?? 'vpt_intimate_avoidance_l1';
const expectCodename = process.argv[3] ?? '晚晴';
// mode=text 只跑 LLM (不碰 TTS); mode=voice 还要真 TTS 出声.
//   注意: mode=voice 下 TTS 起不来 (音色没配 / 上游握手失败) 时, voice.service 的
//   beginTtsTurn 会**整轮静默丢弃** —— 连 llm_start 都不发, 探针只看到"什么都没来".
const mode = process.argv[4] ?? 'voice';
const sid = 'e2e-' + randomUUID().slice(0, 8);
const token = signDevToken();
const url =
  `ws://localhost:${PORT}/voice/training` +
  `?sessionId=${encodeURIComponent(sid)}` +
  `&token=${encodeURIComponent(token)}` +
  `&templateId=${encodeURIComponent(templateId)}` +
  `&mode=${encodeURIComponent(mode)}`;

console.log('━━ E2E voice WS probe ━━');
console.log('template :', templateId, '(期望代号:', expectCodename + ')');
console.log('sid      :', sid);
console.log('mode     :', mode);
console.log('url      : ws://localhost:' + PORT + '/voice/training?sessionId=…&token=***&templateId=…&mode=…\n');

const frames = [];
let ready = null;
let llmText = '';
let ttsBytes = 0;
let ttsChunks = 0;
let errorFrame = null;

const ws = new WebSocket(url);
const overall = setTimeout(() => finish(1, '总超时 30s'), 30000);

ws.on('open', () => console.log('● WS open, 等 ready 帧…'));

ws.on('message', (buf) => {
  let msg;
  try { msg = JSON.parse(buf.toString()); } catch { return; }
  frames.push(msg.type);

  if (msg.type === 'ready') {
    ready = msg;
    console.log('● ready 帧:', JSON.stringify({
      visitor: msg.visitor ?? null,
      persisted: msg.persisted,
      dbSessionId: msg.dbSessionId ?? null,
    }, null, 2));
    // ready 到了才发 user_text
    setTimeout(() => {
      const text = '你好，我是今天的咨询师，我们可以先聊聊最近让你困扰的事情吗？';
      console.log('\n→ 发送 user_text:', text);
      // Nest platform-ws 的默认 messageParser 只做 JSON.parse, 之后按 `event` 找 handler、
      // 把 `data` 当 payload. 所以裸帧 {type,text} 会被 **静默丢弃** (event=undefined →
      // handlersMap.get(undefined) → undefined → catch 里吞掉), 一帧都不回.
      ws.send(JSON.stringify({ event: 'message', data: { type: 'user_text', text } }));
    }, 300);
    return;
  }

  if (msg.type === 'llm_text') {
    llmText += msg.text ?? msg.delta ?? '';
  }
  if (msg.type === 'tts_audio') {
    ttsChunks++;
    ttsBytes += (msg.audio ?? msg.data ?? []).length ?? 0;
  }
  if (msg.type === 'error') {
    errorFrame = msg;
  }
  if (msg.type === 'tts_done' || msg.type === 'session_ended') {
    // 收工
    setTimeout(() => finish(0), 800);
  }
});

ws.on('error', (err) => {
  console.error('✗ WS error:', err.message);
  finish(1);
});
ws.on('close', (code, reason) => {
  console.log('\n● WS close code=' + code + (reason ? ' reason=' + reason : ''));
  finish(0);
});

function finish(code) {
  clearTimeout(overall);
  if (process.exitCode !== undefined && process.exitCode !== 0) return;

  console.log('\n━━ 结果 ━━');
  const counts = {};
  for (const t of frames) counts[t] = (counts[t] ?? 0) + 1;
  console.log('帧序列:', frames.join(' → '));
  console.log('帧计数:', JSON.stringify(counts));
  console.log('来访回复文本:', llmText ? '\n  ' + llmText : '(空)');
  console.log('TTS:', ttsChunks + ' chunks, ' + ttsBytes + ' bytes');

  // ── 断言 ──
  const checks = [];
  checks.push(['收到 ready 帧', ready !== null]);
  checks.push(['速查卡代号 = ' + expectCodename, ready?.visitor?.codename === expectCodename]);
  checks.push(['无 error 帧', errorFrame === null]);
  checks.push(['收到 llm_text (来访真实开口)', llmText.length > 0]);
  checks.push(['收到 tts_audio (真 TTS 出声)', ttsChunks > 0]);

  let fail = 0;
  for (const [label, ok] of checks) {
    console.log((ok ? '  ✓ ' : '  ✗ ') + label);
    if (!ok) fail++;
  }
  if (errorFrame) console.log('  error 内容:', JSON.stringify(errorFrame));

  try { ws.close(); } catch {}
  process.exit(fail === 0 ? 0 : 1);
}
