// E2E 探针: 真实连一次 voice WS, 握手 vpt 模板, 跑一轮 (或多轮) 咨询师发言, 把服务端推的帧
// 全部打出来并自动断言. 不打 flutter, 不跑测试, 只验证"线通不通 + 角色注没注入 + 边界收没收".
//
// 用法 (后端已起, 监听 3000):
//   node scripts/e2e-voice-ws-probe.mjs
//   node scripts/e2e-voice-ws-probe.mjs vpt_workplace_intellectualization_l1 亦舟
//   node scripts/e2e-voice-ws-probe.mjs vpt_intimate_avoidance_l1 晚晴 voice crisis   # 危机轮次
//   node scripts/e2e-voice-ws-probe.mjs vpt_intimate_avoidance_l1 晚晴 voice truncation # 截断边界
//   node scripts/e2e-voice-ws-probe.mjs --compare                                          # 两角色对比
//
// 前提: 本地 .env 有 JWT_SECRET + MINIMAX_API_KEY; MySQL/Qdrant 起着; 后端 start:win 中.
// 退出码: 0 = 关键断言全过; 1 = 有断言红 (打印原因).
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
const b64url = (obj) => Buffer.from(typeof obj === 'string' ? obj : JSON.stringify(obj)).toString('base64url');
function signDevToken() {
  const header = b64url({ alg: 'HS256', typ: 'JWT' });
  const now = Math.floor(Date.now() / 1000);
  const body = b64url({ sub: 'e2e-probe-user', tenantId: 'default', iat: now, exp: now + 600 });
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
const argv = process.argv.slice(2);
const compareMode = argv[0] === '--compare';
const templateId = compareMode ? '' : (argv[0] ?? 'vpt_intimate_avoidance_l1');
const expectCodename = compareMode ? '' : (argv[1] ?? '晚晴');
// mode=text 只跑 LLM (不碰 TTS); mode=voice 还要真 TTS 出声.
//   注意: mode=voice 下 TTS 起不来 (音色没配 / 上游握手失败) 时, voice.service 的
//   beginTtsTurn 会**整轮静默丢弃** —— 连 llm_start 都不发, 探针只看到"什么都没来".
const mode = compareMode ? 'voice' : (argv[2] ?? 'voice');
const scenario = compareMode ? 'basic' : (argv[3] ?? 'basic');

/**
 * 连一场会话, 跑若干轮, 返回观测结果.
 */
async function runSession(options) {
  const sid = 'e2e-' + randomUUID().slice(0, 8);
  const token = signDevToken();
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
  };

  const turns = options.turns;
  let turnIndex = 0;
  let sentAt = null;

  return await new Promise((resolve) => {
    const ws = new WebSocket(url);
    const overall = setTimeout(() => {
      console.error('✗ 总超时 30s');
      try { ws.close(); } catch {}
      resolve(result);
    }, 30000);

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
          setTimeout(sendTurn, 400);
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
        setTimeout(() => { try { ws.close(); } catch {} }, 600);
      }
      if (msg.type === 'tts_done' || msg.type === 'session_ended') {
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
  return [OPENING_TEXT];
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

// ── 主流程 ──────────────────────────────────────────────────────────────────
async function main() {
  console.log('━━ E2E voice WS probe ━━');
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
