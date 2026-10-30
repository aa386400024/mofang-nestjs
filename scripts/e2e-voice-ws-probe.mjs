// E2E 探针: 真实连一次 voice WS, 握手 vpt 模板, 跑一轮 (或多轮) 咨询师发言, 把服务端推的帧
// 全部打出来并自动断言. 不打 flutter, 不跑测试, 只验证"线通不通 + 角色注没注入 + 边界收没收".
//
// 用法 (后端已起, 监听 3000):
//   node scripts/e2e-voice-ws-probe.mjs
//   node scripts/e2e-voice-ws-probe.mjs vpt_workplace_intellectualization_l1 亦舟
//   node scripts/e2e-voice-ws-probe.mjs vpt_intimate_avoidance_l1 晚晴 voice crisis   # 危机轮次
//   node scripts/e2e-voice-ws-probe.mjs vpt_intimate_avoidance_l1 晚晴 voice truncation # 截断边界
//   node scripts/e2e-voice-ws-probe.mjs --compare                                          # 两角色对比
//   node scripts/e2e-voice-ws-probe.mjs vpt_intimate_avoidance_l1 晚晴 voice --report    # 报告闭环 (正常)
//   node scripts/e2e-voice-ws-probe.mjs vpt_intimate_avoidance_l1 晚晴 voice empty --report # 报告闭环 (空局)
//
// 前提: 本地 .env 有 JWT_SECRET + MINIMAX_API_KEY; MySQL/Qdrant 起着; 后端 start:win 中.
// 退出码: 0 = 关键断言全过; 1 = 有断言红 (打印原因).
//
// V2026-10-29 治本 (WP18 · 探针增强 · 报告闭环):
//   `--report` 模式: 跑完对话 → 发 `session_finish` → 拿 dbSessionId → **轮询**
//   `GET /counselor/supervision/report/:dbSessionId` → 断言四态 / 六维 / annotations / techStats.
//   两个场景:
//     · scenario=basic (默认): 正常会话 → 期望 status=completed (不是 pending 超时, 不是 parse_error).
//     · scenario=empty:          空局 (连上直接 session_finish, 不发 user_text) → 期望 status=no_content.
//   报告是**异步**生成的 (BullMQ + LLM): 主报告 (agent/supervisor) 判 status, 技术统计
//   (4 流派 counselor-supervision) 判 techStats —— 两者**不同时**到, 所以分两段轮询.
//   探针**如实报告**哪一项没等到 (不编造), 让"卡在哪一环"一眼可见.
//
// V2026-10-29 治本 (WP9-C · 探针增强):
//   ① TTS 音频字节统计**修对**: `tts_audio` 帧的音频字段是 `audio_base64` (base64 **字符串**),
//      不是 byte array —— 原来按数组算长度, 恒得 0. 现在按 base64 解码后算真实字节数.
//   ② 抓 LLM usage: 从 `llm_done` 帧的 usage 取 prompt/completion/reasoning tokens.
//      reasoning_tokens 是"思考吃了多少"的唯一现场 —— completion_tokens 含思考, 单看它
//      分不清"输出被截断"还是"思考吃光预算".
//   ③ 抓 TTFT: 从发出 user_text 到收到第一个 llm_text 的毫秒数 (验收 < 3s).
//   ④ 两角色对比: 同一句咨询师开场, 晚晴 vs 亦舟 —— 文本不同 / 句长有差 / 口吻关键词不同.
//   ⑤ 截断场景: 断言进 TTS 的每句都以句末标点收尾 (半句绝不能进 TTS 队列).
//   ⑥ 危机场景: 发一句自伤输入, 断言收到 `supervision_hint` 帧 (而不是静默略过).
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
// V2026-10-29 治本 (WP18): payload 必须**跟 `JwtAuthGuard` 的校验口径逐项对齐** ——
//   少一个字段就会被守卫拒 (401), 而 WS 握手那条路校验更松, 于是出现"WS 通了、
//   HTTP 401" 的怪现象. 守卫要求:
//     - `type === 'access'`  (少它 → "token 类型错误" 401)
//     - `jti` 存在            (黑名单检查按 jti 查 Redis)
//     - `sub` / `username` / `roles` (注入 request.user 的形态)
const b64url = (obj) => Buffer.from(typeof obj === 'string' ? obj : JSON.stringify(obj)).toString('base64url');
function signDevToken() {
  const header = b64url({ alg: 'HS256', typ: 'JWT' });
  const now = Math.floor(Date.now() / 1000);
  const body = b64url({
    sub: 'e2e-probe-user',
    username: 'e2e-probe-user',
    roles: ['student'],
    type: 'access',
    jti: randomUUID(),
    tenantId: 'default',
    iat: now,
    exp: now + 3600,
  });
  const data = `${header}.${body}`;
  const sig = createHmac('sha256', JWT_SECRET).update(data).digest('base64url');
  return `${data}.${sig}`;
}

// ── 常量 ────────────────────────────────────────────────────────────────────
/** 默认开场白 (咨询师的第一句). */
const OPENING_TEXT = '你好，我是今天的咨询师，我们可以先聊聊最近让你困扰的事情吗？';
/** 危机场景输入 (自伤意念; 内核本地探测器据此判 warn 级危机信号). */
const CRISIS_TEXT = '我活着没什么意思，想结束这样的一切。';
/** 截断场景输入 (诱发超长回答). */
const TRUNCATION_TEXT = '请把你从小到大的经历都完整讲一遍，越详细越好，一条都不要省略。';
/** 句末标点 (用于"半句不能进 TTS"的断言). */
const SENTENCE_ENDINGS = ['。', '！', '？', '…', '；'];
/** 回避型口吻关键词 (晚晴). */
const AVOIDANT_KEYWORDS = ['嗯', '还好吧', '不知道', '不太想', '随便', '没什么'];
/** 焦虑型口吻关键词 (亦舟). */
const ANXIOUS_KEYWORDS = ['其实', '就是', '有点', '可能', '我觉得', '一直'];

// ── 参数 ────────────────────────────────────────────────────────────────────
// V2026-10-29 治本 (WP18): `--report` 是**开关**, 位置任意 —— 先从 argv 里摘出去,
//   剩下的按位置解析 (templateId / codename / mode / scenario). 否则 `--report`
//   占掉 scenario 槽位时, 场景名会被读成 "--report".
const argv = process.argv.slice(2);
const reportMode = argv.includes('--report');
const positional = argv.filter((a) => a !== '--report');
const compareMode = positional[0] === '--compare';
const templateId = compareMode ? '' : (positional[0] ?? 'vpt_intimate_avoidance_l1');
const expectCodename = compareMode ? '' : (positional[1] ?? '晚晴');
// mode=text 只跑 LLM (不碰 TTS); mode=voice 还要真 TTS 出声.
//   注意: mode=voice 下 TTS 起不来 (音色没配 / 上游握手失败) 时, voice.service 的
//   beginTtsTurn 会**整轮静默丢弃** —— 连 llm_start 都不发, 探针只看到"什么都没来".
const mode = compareMode ? 'voice' : (positional[2] ?? 'voice');
const scenario = compareMode ? 'basic' : (positional[3] ?? 'basic');
/** 空局场景: 连上不发 user_text, 直接 session_finish. */
const isEmptyScenario = scenario === 'empty';

/**
 * 连一场会话, 跑若干轮, 返回观测结果.
 */
async function runSession(options) {
  const sid = 'e2e-' + randomUUID().slice(0, 8);
  // V2026-10-29 治本 (WP18): token 由调用方传入 —— 报告模式要用**同一个** token
  //   调 HTTP 报告接口 (归属校验按 userId, 两边必须一致).
  const token = options.token ?? signDevToken();
  const url =
    `ws://localhost:${PORT}/voice/training` +
    `?sessionId=${encodeURIComponent(sid)}` +
    `&token=${encodeURIComponent(token)}` +
    `&templateId=${encodeURIComponent(options.templateId)}` +
    `&mode=${encodeURIComponent(options.mode)}`;

  const result = {
    sid,
    templateId: options.templateId,
    frames: [],
    ready: null,
    llmText: '',
    llmChunks: [],
    ttsChunks: 0,
    ttsBytes: 0,
    ttsTexts: [],
    errorFrame: null,
    usage: null,
    ttftMs: null,
    supervisionHints: [],
    closed: false,
    // V2026-10-29 治本 (WP18): 结束帧 (带业务桥算出的报告状态).
    sessionEnded: null,
  };

  const turns = options.turns;
  let turnIndex = 0;
  let sentAt = null;
  /** 本场 TTS 是否已播完 (报告模式要等它播完再结束, 否则尾音被 dispose 掉). */
  let ttsDone = false;
  /** session_finish 是否已发 (幂等). */
  let finishSent = false;
  /** 上一轮已收尾, 下一轮待发 (等 tts_done 才发, 避免 barge-in). */
  let pendingNextTurn = false;

  return await new Promise((resolve) => {
    const ws = new WebSocket(url);
    // V2026-10-29 治本 (WP18): 报告模式要跑多轮 + 收尾, 总时限放宽 (默认 30s 不够).
    const overall = setTimeout(() => {
      console.error('✗ 总超时 ' + (options.overallTimeoutMs ?? 30000) + 'ms');
      try { ws.close(); } catch {}
      resolve(result);
    }, options.overallTimeoutMs ?? 30000);

    ws.on('open', () => console.log('● WS open, 等 ready 帧…'));

    ws.on('message', (buf) => {
      let msg;
      try { msg = JSON.parse(buf.toString()); } catch { return; }
      result.frames.push(msg.type);

      if (msg.type === 'ready') {
        result.ready = msg;
        console.log('● ready 帧:', JSON.stringify({
          visitor: msg.visitor ?? null,
          persisted: msg.persisted,
          dbSessionId: msg.dbSessionId ?? null,
        }, null, 2));
        // V2026-10-29 治本 (WP18): 空局场景 —— 连上直接结束, 不发 user_text.
        if (options.noTurns) {
          finishSent = true;
          sendFinish();
          return;
        }
        sendTurn();
        return;
      }

      if (msg.type === 'llm_text') {
        if (result.ttftMs === null && sentAt !== null) {
          result.ttftMs = Date.now() - sentAt;
        }
        const text = msg.text ?? '';
        result.llmText += text;
        result.llmChunks.push(text);
      }
      if (msg.type === 'tts_audio') {
        // V2026-10-29 治本 (WP9-C): 音频是 base64 **字符串**, 解码后才是字节数.
        const base64 = msg.audio_base64 ?? '';
        result.ttsChunks += 1;
        result.ttsBytes += Buffer.from(base64, 'base64').length;
        if (msg.text) result.ttsTexts.push(msg.text);
      }
      if (msg.type === 'llm_done') {
        // V2026-10-29 治本 (WP9-C): usage 随 llm_done 帧下发 (prompt/completion/reasoning tokens).
        if (msg.usage) result.usage = msg.usage;
        turnIndex += 1;
        if (turnIndex < turns.length) {
          // V2026-10-29 治本 (WP18): voice 模式**等上一轮 TTS 播完再发下一轮** ——
          //   否则新 user_text 会在上一轮还在合成时到达, 触发 barge-in 打断上一轮,
          //   逐字稿就少一轮 (报告素材不足, 断言也会跟着失真).
          if (options.mode === 'voice') {
            pendingNextTurn = true;
          } else {
            setTimeout(sendTurn, 400);
          }
          return;
        }
        // V2026-10-29 治本 (WP18): 报告模式走"结束会话"而不是直接断连 ——
        //   session_finish 才是触发 transcript 落库 + 报告 worker 的那个动作.
        if (options.finish) {
          maybeFinish();
          return;
        }
        setTimeout(() => { try { ws.close(); } catch {} }, 1200);
      }
      if (msg.type === 'supervision_hint') {
        result.supervisionHints.push(msg);
      }
      if (msg.type === 'error') {
        result.errorFrame = msg;
        // error 帧之后不会再有 llm_done —— 不主动收尾就会一直等到总超时.
        turnIndex += 1;
        if (turnIndex < turns.length) {
          setTimeout(sendTurn, 400);
          return;
        }
        if (options.finish) {
          maybeFinish();
          return;
        }
        setTimeout(() => { try { ws.close(); } catch {} }, 600);
      }
      if (msg.type === 'session_ended') {
        // V2026-10-29 治本 (WP18): 结束帧带业务桥收尾结论 (报告状态).
        result.sessionEnded = msg;
        console.log('● session_ended 帧:', JSON.stringify(msg));
        setTimeout(() => { try { ws.close(); } catch {} }, 600);
        return;
      }
      if (msg.type === 'tts_done') {
        // V2026-10-29 治本 (WP18): 报告模式**不能**在 tts_done 就断连 ——
        //   `session_finish` → endSession → 业务桥收尾 (最多等 800ms) 之后才下发
        //   `session_ended`, 提前断连会把这个帧连同它的 reportStatus 一起丢掉.
        ttsDone = true;
        // 上一轮播完了 → 发下一轮 (见 llm_done 分支的注释: 避免 barge-in 打断上一轮).
        if (pendingNextTurn) {
          pendingNextTurn = false;
          setTimeout(sendTurn, 200);
          return;
        }
        if (options.finish) {
          maybeFinish();
          return;
        }
        setTimeout(() => { try { ws.close(); } catch {} }, 600);
      }
    });

    function sendTurn() {
      const text = turns[turnIndex];
      if (text === undefined) {
        try { ws.close(); } catch {}
        return;
      }
      sentAt = Date.now();
      console.log(`\n→ 发送 user_text (第 ${turnIndex + 1} 轮):`, text);
      // Nest platform-ws 的默认 messageParser 只做 JSON.parse, 之后按 `event` 找 handler、
      // 把 `data` 当 payload. 所以裸帧 {type,text} 会被 **静默丢弃** (event=undefined →
      // handlersMap.get(undefined) → undefined → catch 里吞掉), 一帧都不回.
      ws.send(JSON.stringify({ event: 'message', data: { type: 'user_text', text } }));
    }

    /**
     * V2026-10-29 治本 (WP18): 该不该现在结束会话.
     *
     * 条件 (三个都要满足):
     *   ① 所有轮次的 llm_done 都到了 (`turnIndex >= turns.length`);
     *   ② TTS 播完了 (voice 模式);
     *   ③ 还没发过 session_finish (幂等).
     *
     * 为什么 ① 不能省: 每轮结尾都有 `tts_done`, 若只等 ②, **第 1 轮的 tts_done**
     * 就会把会话结束掉 —— 而此时第 2/3 轮还没发, 后端会先 endSession (删掉会话资源),
     * 后面那几轮到达时就变成"会话已结束" (后端行为正确, 但探针测的就不是报告闭环了).
     *
     * 为什么 ② 不能省: `session_finish` → endSession 会 dispose TTS 句柄, 尾音会被掐断 ——
     *   那不是本模式要验的东西, 却会污染观测 (TTS 帧数 / 字节数).
     */
    function maybeFinish() {
      if (finishSent) return;
      if (turnIndex < turns.length) return;
      if (options.mode === 'voice' && !ttsDone) return;
      finishSent = true;
      setTimeout(sendFinish, 300);
    }

    /**
     * V2026-10-29 治本 (WP18): 主动结束会话.
     *
     * 走的是**同一个 Nest 信封** (`event:'message'` + `data.payload`) —— 裸帧会被静默丢弃.
     */
    function sendFinish() {
      console.log('\n→ 发送 session_finish (触发 transcript 落库 + 报告 worker)…');
      ws.send(JSON.stringify({ event: 'message', data: { type: 'session_finish' } }));
    }

    ws.on('error', (err) => {
      console.error('✗ WS error:', err.message);
      clearTimeout(overall);
      resolve(result);
    });
    ws.on('close', () => {
      result.closed = true;
      clearTimeout(overall);
      resolve(result);
    });
  });
}

/** 按场景决定跑几轮、说什么. */
function turnsFor(scenarioName) {
  if (scenarioName === 'crisis') return [OPENING_TEXT, CRISIS_TEXT];
  if (scenarioName === 'truncation') return [TRUNCATION_TEXT];
  // V2026-10-29 治本 (WP18): 空局场景 ——
  //   3 轮**有效**内容 (咨询师 + 来访者各算一条 → 6 条 transcript),
  //   好让报告链路真的跑起来 (素材不足会被判 no_content, 那不是我们要验的).
  if (scenarioName === 'report') {
    return [
      OPENING_TEXT,
      '最近工作上遇到了一些事情，我有点不知道该怎么说。',
      '可能就是因为这样，所以我一直没怎么跟别人讲。',
    ];
  }
  return [OPENING_TEXT];
}

// ── 报告轮询 (WP18) ─────────────────────────────────────────────────────────

/** 报告接口路径 (与前端 `vpt_session_report.dart` 对齐的出口). */
const REPORT_PATH = '/counselor/supervision/report';
/** 轮询间隔 (ms). */
const REPORT_POLL_INTERVAL_MS = 2000;
/** 等主报告落终态的上限 (ms) —— 主报告是 agent/supervisor 那条 LLM (2-5s, 留余量). */
const REPORT_STATUS_TIMEOUT_MS = 60000;
/** 等技术统计落库的上限 (ms) —— 4 流派那条 LLM 官方口径 30-120s. */
const REPORT_TECHSTATS_TIMEOUT_MS = 150000;

/**
 * 拉一次报告.
 *
 * @param {string} dbSessionId 稳定落库 id
 * @param {string} token JWT
 * @returns {Promise<{ok: boolean, status: number, body: unknown}>}
 */
async function fetchReport(dbSessionId, token) {
  const url = `http://localhost:${PORT}${REPORT_PATH}/${encodeURIComponent(dbSessionId)}`;
  try {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    const text = await res.text();
    let body = null;
    try { body = text ? JSON.parse(text) : null; } catch { body = text; }
    return { ok: res.ok, status: res.status, body };
  } catch (err) {
    return { ok: false, status: 0, body: { error: err && err.message ? err.message : String(err) } };
  }
}

/**
 * 轮询报告接口, 直到状态落到终态 (completed / parse_error / no_content).
 *
 * 为什么要两段: 主报告 (agent/supervisor) 决定 **status**, 技术统计 (4 流派
 * counselor-supervision) 决定 **techStats** —— 两条链路是**两个队列两个 LLM**,
 * 不同时到. 只等 status 会在 techStats 还没落库时就断言, 那是**假红**.
 *
 * @param {string} dbSessionId 稳定落库 id
 * @param {string} token JWT
 * @returns {Promise<{report: unknown, statusHistory: string[], firstStatus: string|null, elapsedMs: number, techStatsReady: boolean, lastError: string|null}>}
 */
async function pollReport(dbSessionId, token) {
  const startedAt = Date.now();
  const statusHistory = [];
  let firstStatus = null;
  let report = null;
  let lastError = null;

  // 阶段一: 等状态落终态.
  while (Date.now() - startedAt < REPORT_STATUS_TIMEOUT_MS) {
    const res = await fetchReport(dbSessionId, token);
    if (!res.ok) {
      lastError = `HTTP ${res.status}`;
      await sleep(REPORT_POLL_INTERVAL_MS);
      continue;
    }
    report = res.body;
    const status = report && report.status ? report.status : '(缺 status)';
    if (firstStatus === null) firstStatus = status;
    if (statusHistory[statusHistory.length - 1] !== status) statusHistory.push(status);
    if (status === 'completed' || status === 'parse_error' || status === 'no_content') break;
    await sleep(REPORT_POLL_INTERVAL_MS);
  }

  // 阶段二: completed 时再等技术统计 (techStats 来自 4 流派那条独立链路).
  let techStatsReady = false;
  if (report && report.status === 'completed') {
    while (Date.now() - startedAt < REPORT_STATUS_TIMEOUT_MS + REPORT_TECHSTATS_TIMEOUT_MS) {
      if (report.techStats) { techStatsReady = true; break; }
      await sleep(REPORT_POLL_INTERVAL_MS);
      const res = await fetchReport(dbSessionId, token);
      if (!res.ok) { lastError = `HTTP ${res.status}`; continue; }
      report = res.body;
    }
    if (report && report.techStats) techStatsReady = true;
  }

  return { report, statusHistory, firstStatus, elapsedMs: Date.now() - startedAt, techStatsReady, lastError };
}

/** sleep (ms). */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 六维评分是否都有值 (不是全 0).
 *
 * @param {unknown} dimensions
 * @returns {boolean}
 */
function dimensionsFilled(dimensions) {
  if (!dimensions || typeof dimensions !== 'object') return false;
  const keys = ['empathy', 'activeListening', 'questioning', 'boundary', 'response', 'professionalism'];
  return keys.every((k) => typeof dimensions[k] === 'number' && dimensions[k] > 0);
}

/** 打印一场会话的观测结果. */
function printResult(result) {
  const counts = {};
  for (const t of result.frames) counts[t] = (counts[t] ?? 0) + 1;
  console.log('\n━━ 本场结果 ━━');
  console.log('帧序列:', result.frames.join(' → '));
  console.log('帧计数:', JSON.stringify(counts));
  console.log('来访回复文本:', result.llmText ? '\n  ' + result.llmText : '(空)');
  console.log('TTS:', result.ttsChunks + ' chunks, ' + result.ttsBytes + ' bytes');
  if (result.usage) {
    console.log(
      'usage: prompt=' + (result.usage.promptTokens ?? '-') +
      ' completion=' + (result.usage.completionTokens ?? '-') +
      ' total=' + (result.usage.totalTokens ?? '-') +
      ' reasoning=' + (result.usage.reasoningTokens ?? '-'),
    );
  } else {
    console.log('usage: (llm_done 帧未带 usage)');
  }
  console.log('TTFT:', result.ttftMs === null ? '(没收到 llm_text)' : result.ttftMs + ' ms');
  if (result.supervisionHints.length > 0) {
    console.log('督导提示:', JSON.stringify(result.supervisionHints));
  }
  if (result.errorFrame) console.log('error 内容:', JSON.stringify(result.errorFrame));
}

/** 断言并打印 (返回失败数). */
function assertAll(checks) {
  let fail = 0;
  for (const [label, ok] of checks) {
    console.log((ok ? '  ✓ ' : '  ✗ ') + label);
    if (!ok) fail++;
  }
  return fail;
}

/**
 * V2026-10-29 治本 (WP18): 报告闭环模式.
 *
 * 流程: 跑对话 → `session_finish` → 拿 dbSessionId → 轮询报告接口 → 断言.
 * 两个场景:
 *   · 正常 (scenario != empty): 期望 status=completed, 六维有值, annotations 非空,
 *     techStats.commentary 非空.
 *   · 空局 (scenario == empty): 连上直接结束 → 期望 status=no_content (只读终态).
 *
 * **如实断言**: 任何一项没等到就红, 并打印报告全文供人工核对 —— 探针不编造.
 */
async function runReportMode() {
  console.log('场景: 报告闭环', isEmptyScenario ? '(空局 → 期望 no_content)' : '(正常 → 期望 completed)');
  console.log('template :', templateId);
  console.log('mode     :', mode);
  console.log('url      : ws://localhost:' + PORT + '/voice/training?sessionId=…&token=***&templateId=…&mode=…\n');

  const token = signDevToken();
  const result = await runSession({
    templateId,
    mode,
    token,
    turns: isEmptyScenario ? [] : turnsFor('report'),
    finish: true,
    noTurns: isEmptyScenario,
    overallTimeoutMs: 120000,
  });
  printResult(result);

  console.log('\n━━ 报告闭环 ━━');
  const dbSessionId = result.ready?.dbSessionId ?? null;
  console.log('dbSessionId:', dbSessionId ?? '(未落库 — 本场不会有报告)');
  console.log('session_ended.reportStatus:', result.sessionEnded?.reportStatus ?? '(帧未带 reportStatus)');

  if (!dbSessionId) {
    const fail = assertAll([
      ['会话已落库 (ready 带 dbSessionId)', false],
      ['收到 session_ended 帧', result.sessionEnded !== null],
    ]);
    process.exit(fail === 0 ? 0 : 1);
  }

  const polled = await pollReport(dbSessionId, token);
  const report = polled.report;
  console.log('轮询状态轨迹:', polled.statusHistory.join(' → ') || '(无)');
  console.log('首次拉取状态:', polled.firstStatus ?? '(未拉到)');
  console.log('轮询耗时:', polled.elapsedMs + ' ms');
  if (polled.lastError) console.log('最后一次 HTTP 错误:', polled.lastError);

  // 边界: 不存在的 sessionId → 404 (不崩, 不泄露).
  const missing = await fetchReport('00000000-0000-0000-0000-000000000000', token);
  console.log('不存在的 sessionId → HTTP', missing.status);

  console.log('\n报告 JSON 全文 (供人工核对):');
  console.log(JSON.stringify(report, null, 2));

  const checks = [];
  checks.push(['会话已落库 (ready 带 dbSessionId)', true]);
  checks.push(['收到 session_ended 帧', result.sessionEnded !== null]);
  checks.push(['报告接口返回 200 (有 body)', report !== null && typeof report === 'object']);
  checks.push(['不存在的 sessionId → 404 (不崩)', missing.status === 404]);

  if (isEmptyScenario) {
    checks.push(['空局: status = no_content', report?.status === 'no_content']);
    checks.push(['空局: 不编造评分 (overallScore 为 null)', report?.overallScore === null]);
    checks.push(['空局: dimensions 为 null (不补零)', report?.dimensions === null]);
    checks.push(['空局: annotations 为空数组', Array.isArray(report?.annotations) && report.annotations.length === 0]);
  } else {
    checks.push(['首次拉取 status = pending (报告异步生成, 前端轮询)', polled.firstStatus === 'pending']);
    checks.push(['报告 status = completed (不是 pending 超时 / parse_error)', report?.status === 'completed']);
    checks.push(['overallScore 有值 (不是 null)', typeof report?.overallScore === 'number']);
    checks.push(['六维评分都有值 (不是全 0)', dimensionsFilled(report?.dimensions)]);
    checks.push(['annotations 非空 (至少 1 条 good/warn/error)', Array.isArray(report?.annotations) && report.annotations.length > 0]);
    checks.push(['annotations 每条 type 合法 (good|warn|error)',
      Array.isArray(report?.annotations) && report.annotations.every((a) => ['good', 'warn', 'error'].includes(a?.type))]);
    checks.push(['growthSuggestions 非空', Array.isArray(report?.growthSuggestions) && report.growthSuggestions.length > 0]);
    checks.push(['techStats 已生成 (4 流派链路)', report?.techStats != null]);
    checks.push(['techStats.commentary 非空', typeof report?.techStats?.commentary === 'string' && report.techStats.commentary.trim().length > 0]);
    checks.push(['startedAt 有值', !!report?.startedAt]);
    checks.push(['endedAt 有值', !!report?.endedAt]);
    checks.push(['turnCount > 0 (逐字稿真落库了)', typeof report?.turnCount === 'number' && report.turnCount > 0]);
  }

  const fail = assertAll(checks);
  process.exit(fail === 0 ? 0 : 1);
}

// ── 主流程 ──────────────────────────────────────────────────────────────────
async function main() {
  console.log('━━ E2E voice WS probe ━━');

  // V2026-10-29 治本 (WP18): 报告闭环模式 (会话结束 → 报告生成 → 四态/六维核对).
  if (reportMode) {
    await runReportMode();
    return;
  }

  if (compareMode) {
    console.log('场景: 两角色对比 (晚晴 vs 亦舟)');
    console.log('mode     :', mode);
    console.log('url      : ws://localhost:' + PORT + '/voice/training?sessionId=…&token=***&templateId=…&mode=…\n');
    const wanqing = await runSession({ templateId: 'vpt_intimate_avoidance_l1', mode, turns: turnsFor('basic') });
    printResult(wanqing);
    const yizhou = await runSession({ templateId: 'vpt_workplace_intellectualization_l1', mode, turns: turnsFor('basic') });
    printResult(yizhou);

    console.log('\n━━ 两角色对比 ━━');
    const wanqingText = wanqing.llmText;
    const yizhouText = yizhou.llmText;
    const wanqingLen = sentenceCount(wanqingText);
    const yizhouLen = sentenceCount(yizhouText);
    console.log('晚晴句数:', wanqingLen, ' 亦舟句数:', yizhouLen);
    console.log('晚晴命中回避型关键词:', AVOIDANT_KEYWORDS.filter((k) => wanqingText.includes(k)).join(',') || '(无)');
    console.log('亦舟命中焦虑型关键词:', ANXIOUS_KEYWORDS.filter((k) => yizhouText.includes(k)).join(',') || '(无)');

    const checks = [
      ['晚晴: 收到 ready 帧', wanqing.ready !== null],
      ['亦舟: 收到 ready 帧', yizhou.ready !== null],
      ['晚晴: 速查卡代号 = 晚晴', wanqing.ready?.visitor?.codename === '晚晴'],
      ['亦舟: 速查卡代号 = 亦舟', yizhou.ready?.visitor?.codename === '亦舟'],
      ['两角色均无 error 帧', wanqing.errorFrame === null && yizhou.errorFrame === null],
      ['两角色均有来访回复', wanqingText.length > 0 && yizhouText.length > 0],
      ['两角色回复文本不同 (不是同一句)', wanqingText.length > 0 && yizhouText.length > 0 && wanqingText !== yizhouText],
      ['句长分布有差异 (晚晴更短 / 亦舟更长)', wanqingLen !== yizhouLen],
      ['口吻关键词不同', keywordProfile(wanqingText) !== keywordProfile(yizhouText)],
      ['晚晴: TTFT < 3s', wanqing.ttftMs !== null && wanqing.ttftMs < 3000],
      ['亦舟: TTFT < 3s', yizhou.ttftMs !== null && yizhou.ttftMs < 3000],
      ['usage 含 reasoning_tokens (证明确实在思考)', (wanqing.usage?.reasoningTokens ?? 0) > 0],
      ['TTS 音频字节数 > 0 (base64 解码后)', wanqing.ttsBytes > 0 && yizhou.ttsBytes > 0],
    ];
    const fail = assertAll(checks);
    process.exit(fail === 0 ? 0 : 1);
  }

  console.log('template :', templateId, '(期望代号:', expectCodename + ')');
  console.log('mode     :', mode);
  console.log('scenario :', scenario);
  console.log('url      : ws://localhost:' + PORT + '/voice/training?sessionId=…&token=***&templateId=…&mode=…\n');

  const result = await runSession({ templateId, mode, turns: turnsFor(scenario) });
  printResult(result);

  console.log('\n━━ 结果 ━━');
  const checks = [];
  checks.push(['收到 ready 帧', result.ready !== null]);
  checks.push(['速查卡代号 = ' + expectCodename, result.ready?.visitor?.codename === expectCodename]);
  checks.push(['无 error 帧', result.errorFrame === null]);
  checks.push(['收到 llm_text (来访真实开口)', result.llmText.length > 0]);
  if (mode === 'voice') {
    checks.push(['收到 tts_audio (真 TTS 出声)', result.ttsChunks > 0]);
    checks.push(['TTS 音频字节数 > 0 (base64 解码后)', result.ttsBytes > 0]);
    checks.push(['进 TTS 的每句都以句末标点收尾 (半句不进 TTS)', result.ttsTexts.every((t) => SENTENCE_ENDINGS.includes(t.trim().slice(-1)))]);
  }
  checks.push(['TTFT < 3s (voice render 低思考)', result.ttftMs !== null && result.ttftMs < 3000]);
  if (result.usage) {
    checks.push(['usage 含 reasoning_tokens (证明确实在思考)', (result.usage.reasoningTokens ?? 0) > 0]);
    checks.push(['completion_tokens 不再是被 thinking 吃光的极小值', (result.usage.completionTokens ?? 0) > 20]);
  } else {
    checks.push(['llm_done 帧带 usage', false]);
  }
  if (scenario === 'crisis') {
    checks.push(['危机轮次收到 supervision_hint 帧', result.supervisionHints.length > 0]);
  }
  if (scenario === 'truncation') {
    console.log('  (提示: 想强制触发 finish_reason=length, 请把服务端 ENGINE_RENDER_MAX_TOKENS 调到很小后重启)');
  }

  const fail = assertAll(checks);
  process.exit(fail === 0 ? 0 : 1);
}

/** 数句子 (按句末标点). */
function sentenceCount(text) {
  if (!text) return 0;
  return text.split(/[。！？…；]/).filter((part) => part.trim().length > 0).length;
}

/** 口吻画像 (命中的关键词集合). */
function keywordProfile(text) {
  const avoidant = AVOIDANT_KEYWORDS.filter((k) => text.includes(k));
  const anxious = ANXIOUS_KEYWORDS.filter((k) => text.includes(k));
  return `${avoidant.join('/')}|${anxious.join('/')}`;
}

main().catch((error) => {
  console.error('✗ 探针异常:', error && error.stack ? error.stack : error);
  process.exit(1);
});
