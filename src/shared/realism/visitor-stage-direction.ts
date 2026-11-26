// V2026-11-22 建立 (AF-281 · 来访者台词投影 · 去舞台说明):
//   职责: 把模型偶发写出的括号/星号舞台说明从流式或聚合产物里确定性剥离，
//         保证 TTS 拿到的是可出声台词，而不是“（叹气）”这种旁白。
//   边界: 纯函数；不读 env、不调模型、不依赖 NestJS。
//
// 为什么放在渲染边界而不是只靠 prompt:
//   V5 已经把“不写括号动作”写进约束，实测 12 轮仍会漏 1 次。输出格式是硬契约，
//   硬契约不能依赖采样概率；prompt 负责“尽量不写”，投影层负责“写了也不会出声”。
//
// V2026-11-27 修正 (AF-559): 2026-11-26 最近 9 场 284 轮里 105 轮的
//   visitor_display_text / visitor_tts_text 出现「（停顿）」「（声音很轻）」
//   「（攥着衣角）」。原实现只在 seed-v5 开关下生效，默认 shared 原样透传，
//   等于硬契约没有上线。改为按语义判定舞台说明，并默认在所有变体生效。

const FULLWIDTH_PAIR = /（([^（）]{0,120})）/gu;
const ASCII_PAIR = /\(([^()]{0,120})\)/gu;
const SQUARE_PAIR = /【([^【】]{0,120})】/gu;
const STAR_PAIR = /\*([^*\n]{0,120})\*/gu;

/**
 * 舞台说明线索：动作、神态、语气、停顿、呼吸、哭腔、视线、身体部位等。
 *
 * 只命中这些线索或位于句首/句末标点的括号才剥离，避免把「我（真的）没想」
 * 这类台词内的补充语义误删。
 */
const STAGE_DIRECTION_CUES = new RegExp(
  [
    '停顿',
    '沉默',
    '顿住',
    '顿了顿',
    '顿了两秒',
    '停了一会儿',
    '停一下',
    '停',
    '语速',
    '语气',
    '声音',
    '呼吸',
    '吸了口气',
    '吸了吸',
    '深吸',
    '呼了口气',
    '呼出',
    '咳',
    '哽咽',
    '哭',
    '笑',
    '摇头',
    '点头',
    '皱眉',
    '攥',
    '手',
    '肩膀',
    '喉咙',
    '胸口',
    '眼',
    '低头',
    '抬头',
    '垂眼',
    '移开',
    '别过',
    '背过',
    '愣',
    '怔',
    '发呆',
    '出神',
    '慌',
    '憋',
    '不出声',
    '卡壳',
    '发颤',
    '发抖',
    '喘',
    '轻',
    '快',
    '慢',
    '哑',
    '缓',
    '猛',
    '好一会',
    '好一会儿',
    '一会儿',
    '几秒',
    '半晌',
    '半天',
    '过了一会儿',
    '片刻',
    '良久',
    '好一阵',
    '清了清',
    '抿',
    '咬',
    '抖',
    '颤',
    '缩',
    '退',
    '僵',
    'sigh',
    'breath',
    'pause',
    'silence',
    'softly',
    'whisper',
    'laugh',
    'cry',
    'sob',
    'gasp',
  ].join('|'),
  'i',
);

/** 纯编号（如「（1）」）不是舞台说明. */
const PURE_ENUM = /^[\d\s.、,，:：;；…-]+$/;

/** MiniMax 合法语气词（半角括号形态）不能当舞台说明删掉，它是给 TTS 的标记. */
const VOICE_MARKER = new RegExp(
  `^(${[
    'laughs',
    'chuckle',
    'coughs',
    'clear-throat',
    'groans',
    'breath',
    'pant',
    'inhale',
    'exhale',
    'gasps',
    'sniffs',
    'sigh',
    'sighs',
    'snorts',
    'burps',
    'lip-smacking',
    'humming',
    'hissing',
  ].join('|')})$`,
  'i',
);

/**
 * 判断括号内容是不是舞台说明.
 *
 * @param inner 括号内文本
 * @param before 左括号之前的文本
 * @returns true = 应剥离
 */
function isStageDirection(inner: string, before: string): boolean {
  const content = inner.trim();
  if (content.length === 0 || PURE_ENUM.test(content)) return false;
  if (VOICE_MARKER.test(content)) return false;
  if (STAGE_DIRECTION_CUES.test(content)) return true;
  // 句首或句末标点后的括号通常是旁白，即使没命中线索词.
  const left = before.trimEnd();
  return left.length === 0 || /[。！？!?…；;\n]$/.test(left);
}

/**
 * 剥离台词里的舞台说明，保留可出声内容。
 *
 * - 全角/半角圆括号、方头括号、星号片段按语义判定后删除，不转换成旁白；
 * - 删除后为空时退回沉默占位，避免返回空串触发调用方降级；
 * - 连续空白折叠，句首残留标点清掉。
 *
 * @param text 模型原始台词
 * @returns 可直接交给 TTS 的台词
 */
export function stripVisitorStageDirections(text: string): string {
  let removed = false;
  let current = text;
  for (let round = 0; round < 3; round += 1) {
    const next = current
      // 中文全角括号一律视为舞台说明：prompt 已禁止来访者写括号，display/tts
      // 契约也不允许任何标记；这里不再做线索判断，保证不再漏单字旁白.
      .replaceAll(FULLWIDTH_PAIR, () => {
        removed = true;
        return '';
      })
      .replaceAll(ASCII_PAIR, (whole, inner: string, offset: number, full: string) => {
        if (!isStageDirection(inner, full.slice(0, offset))) return whole;
        removed = true;
        return ' ';
      })
      .replaceAll(SQUARE_PAIR, () => {
        removed = true;
        return '';
      })
      .replaceAll(STAR_PAIR, () => {
        removed = true;
        return ' ';
      });
    if (next === current) break;
    current = next;
  }

  if (!removed) return text;
  const normalized = current
    .replaceAll(/[ \t]+/gu, ' ')
    .replace(/^[\s，,。.、；;：:]+/u, '')
    .trim();
  return normalized.length > 0 ? normalized : '……';
}
