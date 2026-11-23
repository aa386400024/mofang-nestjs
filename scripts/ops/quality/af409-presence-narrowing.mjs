// AF-409 · 在场信号收窄版 A′/B′/C′ 离线验证（只读）
//   目的：验证 MiniMax 收窄建议是否比 AF-408 的 A/B/C/D 更有区分度。
//   红线：不打印逐字稿原文；不改生产；不碰 engine-core。

import { isBroadQuestion, projectDimensions, summarizeTurns } from './af408-presence-calibration.mjs';

const ACK_PREFIX = /^(嗯|好|是|对|行|可以|继续|你说|我在|收到|明白|了解)/;
const STRUCTURE_MARKERS =
  /(我们先|咱们先|分[一二三四五1-5]步|分步骤|第一步|第二步|下一步|接下来|最后一步|行动计划|这周|下周|每天|时间线|具体到|先从|再讨论|然后我们)/;
const CONTENT_WORDS =
  /(睡眠|睡觉|工作|开会|加班|关系|家人|朋友|情绪|压力|担心|害怕|期待|需要|希望|计划|行动|时间|地点|频率|身体|疲惫|注意力|低落|持续|困扰|感受|想法|回忆|经历)/;
const CONFRONTATION = /(凭什么|难道|你到底|你总是|你每次|有什么好|为什么每次|你怎么还|你不觉得)/;
const GREETING = /^(你好|您好|早上好|晚上好|在吗|嗨|哈喽)[。！!？?\s]*$/;

/**
 * 是否带结构化过渡/行动规划标记。
 *
 * @param {string} text 咨询师文本
 * @returns {boolean} 是否结构化
 */
export function hasStructureMarker(text) {
  return STRUCTURE_MARKERS.test(String(text ?? ''));
}

/**
 * 是否含内容承载词。
 *
 * @param {string} text 咨询师文本
 * @returns {boolean} 是否内容承载
 */
export function hasContentWord(text) {
  return CONTENT_WORDS.test(String(text ?? ''));
}

/**
 * 是否对峙特征。
 *
 * @param {string} text 咨询师文本
 * @returns {boolean} 是否对峙
 */
export function isConfrontation(text) {
  return CONFRONTATION.test(String(text ?? ''));
}

/**
 * 是否最小应答（≤4 字且承接开头）。
 *
 * @param {string} text 咨询师文本
 * @returns {boolean} 是否最小应答
 */
export function isMinimalAck(text) {
  const value = String(text ?? '').trim();
  return value.length > 0 && value.length <= 4 && ACK_PREFIX.test(value);
}

/**
 * 是否中短承接（5–12 字、承接开头且带内容）。
 *
 * @param {string} text 咨询师文本
 * @returns {boolean} 是否中短承接
 */
export function isMediumAck(text) {
  const value = String(text ?? '').trim();
  return value.length >= 5 && value.length <= 12 && ACK_PREFIX.test(value) && hasContentWord(value);
}

/**
 * 收窄版判定：A′ 结构化；B′ 拆最小应答；C′ 纯短句。
 *
 * @param {string} text 咨询师文本
 * @returns {'holding_present'|'cold_absent'|'neutral'} 标签
 */
export function classifyNarrow(text) {
  const value = String(text ?? '').trim();
  if (!value) return 'neutral';
  if (isConfrontation(value)) return 'neutral';
  if (GREETING.test(value)) return 'neutral';
  if (isMinimalAck(value)) return 'cold_absent';
  if (isMediumAck(value)) return 'holding_present';
  const question = isBroadQuestion(value);
  if (question && (hasStructureMarker(value) || hasContentWord(value))) return 'holding_present';
  if (value.length <= 4 && !question) return 'cold_absent';
  return 'neutral';
}

/**
 * 仅结构化：疑问 ∧ 结构化标记 ∧ 非对峙。
 *
 * @param {string} text 咨询师文本
 * @returns {'holding_present'|'neutral'} 标签
 */
export function classifyStructureOnly(text) {
  const value = String(text ?? '').trim();
  if (!value || isConfrontation(value)) return 'neutral';
  return isBroadQuestion(value) && hasStructureMarker(value) ? 'holding_present' : 'neutral';
}

/**
 * 对 eligible 池做收窄版计数。
 *
 * @param {readonly string[]} texts neutral-only 咨询师轮
 * @returns {{turns:number,holding:number,cold:number,neutral:number,neutralRate:number}} 计数
 */
export function summarizeNarrow(texts) {
  const counts = { turns: 0, holding: 0, cold: 0, neutral: 0, neutralRate: 0 };
  for (const text of texts) {
    counts.turns += 1;
    const label = classifyNarrow(text);
    if (label === 'holding_present') counts.holding += 1;
    else if (label === 'cold_absent') counts.cold += 1;
    else counts.neutral += 1;
  }
  counts.neutralRate = counts.turns === 0 ? 0 : counts.neutral / counts.turns;
  return counts;
}

/**
 * 与 AF-408 原候选对照。
 *
 * @param {readonly string[]} texts neutral-only 咨询师轮
 * @returns {Record<string, ReturnType<typeof summarizeTurns>>} 对照计数
 */
export function compareVariants(texts) {
  const structure = { turns: 0, holding: 0, cold: 0, neutral: 0, neutralRate: 0 };
  for (const text of texts) {
    structure.turns += 1;
    if (classifyStructureOnly(text) === 'holding_present') structure.holding += 1;
    else structure.neutral += 1;
  }
  structure.neutralRate = structure.turns === 0 ? 0 : structure.neutral / structure.turns;
  return {
    A: summarizeTurns(texts, 'A'),
    AS: summarizeTurns(texts, 'AS'),
    ST: structure,
    narrow: summarizeNarrow(texts),
  };
}

/**
 * 主流程。
 */
function main() {
  // 延迟导入，避免纯函数测试触发文件读取。
  import('./af408-presence-calibration.mjs').then(({ loadCounselorTurns }) => {
    const sessions = loadCounselorTurns('data/debug-sessions');
    const neutralTexts = sessions.flatMap((session) => session.neutralTexts);
    console.log('=== AF-409 收窄版 A′/B′/C′ 离线验证（无原文） ===');
    console.log(`场次 ${sessions.length} | 落盘 neutral-only ${neutralTexts.length}`);
    for (const [name, summary] of Object.entries(compareVariants(neutralTexts))) {
      console.log(
        `${name}: holding=${summary.holding} cold=${summary.cold} remaining=${summary.neutral} neutralRate=${summary.neutralRate.toFixed(4)}`,
      );
    }
    const cold = sessions.find((session) => session.sessionId === 'debug_ITUgH5VCcuZ5QXw9SBb-T');
    if (cold) {
      const events = cold.texts.map((text) => classifyNarrow(text));
      const projected = projectDimensions(events, { trust: 0.25, safety: 0.25, bond: 0.2, valence: -0.55, arousal: 0.35 });
      console.log(
        `cold14: holding=${events.filter((item) => item === 'holding_present').length} cold=${events.filter((item) => item === 'cold_absent').length} neutral=${events.filter((item) => item === 'neutral').length} trust=${projected.trust.toFixed(4)} safety=${projected.safety.toFixed(4)} bond=${projected.bond.toFixed(4)}`,
      );
    }
    console.log('\n合成风险样例：');
    for (const text of [
      '你为什么每次都这样？',
      '我们分三步来：先说事实，再说感受，最后定一个行动。',
      '好的。',
      '嗯，我明白你的意思。',
      '最近这种情况大概持续多久了？',
    ]) {
      console.log(`  narrow=${classifyNarrow(text)} len=${text.length}`);
    }
  });
}

if (process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('/af409-presence-narrowing.mjs')) {
  main();
}
