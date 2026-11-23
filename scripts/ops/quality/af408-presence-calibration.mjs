// AF-408 · 在場信号离线校准（只读）
//   目的：在本地调试逐字稿上，量化“疑问结构 → holding_present”的覆盖率与风险。
//   红线：不打印任何逐字稿原文；不修改生产分类器、delta、prompt；不写仓库数据文件。
//   用法：pnpm exec tsx scripts/ops/quality/af408-presence-calibration.mjs --dir data/debug-sessions

import fs from 'node:fs';
import path from 'node:path';

/** 与 state-transition.ts 保持同值的工程种子 delta；本文件只做投影，不参与生产。 */
export const PRESENCE_DELTAS = Object.freeze({
  holding_present: Object.freeze({
    trust: 0,
    safety: 0.004,
    bond: 0.002,
    verbal: -0.002,
    depth: 0,
    style: 0,
    valence: 0.004,
    arousal: -0.002,
    positive: 0,
    negative: 0,
    dependency: 0,
  }),
  cold_absent: Object.freeze({
    trust: -0.004,
    safety: -0.002,
    bond: -0.002,
    verbal: 0.004,
    depth: 0.002,
    style: 0.002,
    valence: -0.004,
    arousal: 0,
    positive: 0,
    negative: 0.002,
    dependency: 0,
  }),
});

export const PRESENCE_VARIANTS = Object.freeze({
  A: '宽疑问（含疑问词，≤40 字）→ holding_present',
  AS: '严格疑问（句末问号/吗呢）→ holding_present',
  ABS: '严格疑问或短承接 → holding_present',
  ABCS: '严格疑问/短承接 → holding_present；无问句纯短句 → cold_absent',
});

const ACK_PREFIX = /^(嗯|好|是|对|行|可以|继续|你说|我在|收到|明白|了解)/;
const QUESTION_WORD = /(吗|呢|什么|怎么|为什么|哪|谁|几|多少|多久|多长|是否|有没有)/;
const QUESTION_END = /([?？]|吗|呢)[。！!?？\s]*$/;

/**
 * 严格疑问：句末问号，或句末“吗/呢”。
 *
 * @param {string} text 咨询师本轮文本
 * @returns {boolean} 是否严格疑问
 */
export function isQuestion(text) {
  const value = String(text ?? '').trim();
  if (!value) return false;
  return QUESTION_END.test(value);
}

/**
 * 宽疑问：严格疑问，或句中含疑问词。
 *
 * @param {string} text 咨询师本轮文本
 * @returns {boolean} 是否宽疑问
 */
export function isBroadQuestion(text) {
  const value = String(text ?? '').trim();
  if (!value) return false;
  return isQuestion(value) || QUESTION_WORD.test(value);
}

/**
 * 是否是短承接。
 *
 * @param {string} text 咨询师本轮文本
 * @returns {boolean} 是否短承接
 */
export function isShortAck(text) {
  const value = String(text ?? '').trim();
  return value.length > 0 && value.length <= 12 && ACK_PREFIX.test(value);
}

/**
 * 按变体给出在场标签。
 *
 * @param {string} text 咨询师本轮文本
 * @param {'A'|'AS'|'ABS'|'ABCS'} variant 变体
 * @returns {'holding_present'|'cold_absent'|'neutral'} 标签
 */
export function classifyPresence(text, variant = 'ABS') {
  const value = String(text ?? '').trim();
  if (!value) return 'neutral';
  const question = variant === 'A' ? isBroadQuestion(value) && value.length <= 40 : isQuestion(value);
  if (question) return 'holding_present';
  if (variant === 'ABCS' && value.length <= 8) return 'cold_absent';
  if (variant !== 'A' && variant !== 'AS' && isShortAck(value)) return 'holding_present';
  return 'neutral';
}

/**
 * 对一组咨询师轮做计数。
 *
 * @param {readonly string[]} texts 咨询师轮文本
 * @param {'A'|'AS'|'ABS'|'ABCS'} variant 变体
 * @returns {{turns:number,holding:number,cold:number,neutral:number,neutralRate:number}} 计数
 */
export function summarizeTurns(texts, variant = 'ABS') {
  const counts = { turns: 0, holding: 0, cold: 0, neutral: 0, neutralRate: 0 };
  for (const text of texts) {
    counts.turns += 1;
    const label = classifyPresence(text, variant);
    if (label === 'holding_present') counts.holding += 1;
    else if (label === 'cold_absent') counts.cold += 1;
    else counts.neutral += 1;
  }
  counts.neutralRate = counts.turns === 0 ? 0 : counts.neutral / counts.turns;
  return counts;
}

/**
 * 按 delta 做多轮投影；只用于判断方向，不替代内核。
 *
 * @param {readonly ('holding_present'|'cold_absent'|'neutral')[]} events 每轮标签
 * @param {Readonly<Record<string, number>>} initial 初始八维
 * @returns {{trust:number,safety:number,bond:number,valence:number,arousal:number}} 投影终值
 */
export function projectDimensions(events, initial = { trust: 0.25, safety: 0.3, bond: 0.25, valence: 0.5, arousal: 0.5 }) {
  const dims = { ...initial };
  for (const event of events) {
    const delta = PRESENCE_DELTAS[event];
    if (!delta) continue;
    for (const key of Object.keys(dims)) {
      dims[key] = clamp01(dims[key] + (delta[key] ?? 0));
    }
  }
  return dims;
}

/**
 * 把数值夹到 [0,1]。
 *
 * @param {number} value 原值
 * @returns {number} 夹取结果
 */
function clamp01(value) {
  return Math.max(0, Math.min(1, Number(value.toFixed(6))));
}

/**
 * 读取目录下全部 trace，抽出咨询师轮，并按落盘 eventTags 标出 neutral-only 轮。
 *
 * @param {string} dir trace 目录
 * @returns {{sessionId:string,texts:string[],neutralTexts:string[]}[]} 场次与咨询师轮
 */
export function loadCounselorTurns(dir) {
  const files = fs
    .readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .sort();
  return files.map((name) => {
    const raw = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
    const sessionId = typeof raw.id === 'string' ? raw.id : name.replace(/\.json$/, '');
    const traces = Array.isArray(raw.traces) ? raw.traces : [];
    const neutralTurns = new Set(
      traces
        .filter((trace) => {
          const tags = Array.isArray(trace?.eventTags) ? trace.eventTags : [];
          return tags.length === 0 || (tags.length === 1 && tags[0] === 'neutral');
        })
        .map((trace) => Number(trace?.turnIndex)),
    );
    const counselor = (raw.messages ?? []).filter((message) => message?.role === 'counselor' && String(message.text ?? '').trim());
    const texts = counselor.map((message) => String(message.text));
    const neutralTexts = counselor.filter((message) => neutralTurns.has(Number(message.turnIndex))).map((message) => String(message.text));
    return { sessionId, texts, neutralTexts };
  });
}

/**
 * 主流程。
 */
function main() {
  const dirIndex = process.argv.indexOf('--dir');
  const dir = dirIndex === -1 ? 'data/debug-sessions' : (process.argv[dirIndex + 1] ?? 'data/debug-sessions');
  if (!fs.existsSync(dir)) {
    console.error(`目录不存在: ${dir}`);
    process.exitCode = 1;
    return;
  }
  const sessions = loadCounselorTurns(dir);
  const allTexts = sessions.flatMap((session) => session.texts);
  const neutralTexts = sessions.flatMap((session) => session.neutralTexts);
  console.log('=== AF-408 在场信号离线校准（无原文） ===');
  console.log(`场次 ${sessions.length} | 咨询师轮 ${allTexts.length} | 落盘 neutral-only ${neutralTexts.length}`);

  const coldSession = sessions.find((session) => session.sessionId === 'debug_ITUgH5VCcuZ5QXw9SBb-T');
  for (const variant of Object.keys(PRESENCE_VARIANTS)) {
    const allSummary = summarizeTurns(allTexts, variant);
    const neutralSummary = summarizeTurns(neutralTexts, variant);
    console.log(
      `${variant}: all=${allSummary.holding}/${allSummary.turns} holding, neutral=${neutralSummary.holding}/${neutralSummary.turns} holding, remaining neutral=${neutralSummary.neutral}`,
    );
    if (coldSession) {
      const events = coldSession.texts.map((text) => classifyPresence(text, variant));
      const projected = projectDimensions(events, { trust: 0.25, safety: 0.25, bond: 0.2, valence: -0.55, arousal: 0.35 });
      console.log(
        `  cold14: holding=${events.filter((item) => item === 'holding_present').length} cold=${events.filter((item) => item === 'cold_absent').length} trust=${projected.trust.toFixed(4)} safety=${projected.safety.toFixed(4)} bond=${projected.bond.toFixed(4)} valence=${projected.valence.toFixed(4)}`,
      );
    }
  }

  console.log('\n合成风险样例：');
  for (const text of ['你最近睡得怎么样？', '你为什么现在才来？', '嗯。', '行，那我们下次再说。']) {
    console.log(`  label=${classifyPresence(text, 'ABCS')} len=${text.length}`);
  }
}

if (process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('/af408-presence-calibration.mjs')) {
  main();
}
