// V2026-11-20 治本 (AF-187 · 输出完整性闸门):
//   职责: 判定一段**已经生成**的台词是否混入了不该出现在逐字稿里的东西:
//         提示词复述、推理过程、模板规则、异常外语、乱码残句。
//
// ── 为什么需要它 (真实故障现场) ────────────────────────────────────────────
//   · 来访者导出第 99 条是一整段渲染 prompt（含"硬规则/这一轮怎么说/你心里坚信"）；
//   · 咨询师导出第 100 条以 `We need respond in Chinese...` 开头，是未加标签的推理；
//   · 第 44 条混入韩文/英文/`passation`，第 6/96/98 条出现 `mild` / `staying safe` / `NAC?`。
//   这些坏输出被直接写进 transcript, 又作为后续轮次上下文继续污染模型。
//
// ── 本模块的口径 ───────────────────────────────────────────────────────────
//   · 只做判定 + 给出干净文本（剥已闭合的推理块），不做改写/润色；
//   · 命中任一硬标记 → invalid；业务层负责重试一次，仍 invalid 则安全兜底并标降级；
//   · 纯函数, 零 IO / 零 env / 零 NestJS。
//
// ── AF-204 扩充的拦截面 ────────────────────────────────────────────────────
//   · JSON 对象 / 数组摘要（模型交上来的是结构, 不是台词）；
//   · 字段化结构输出（`情绪：焦虑` 这种成片的键值行）；
//   · 未闭合推理（`让我想想……`：思考说出口了, 而且没说完）；
//   · 无标签英文推理残片（出现在台词中间, 既没有推理标签也没有开头标记）。
//
// 反双胞胎:
//   - 不替代安全判定（自伤/自杀风险仍走 assessSafety 那条链）；
//   - 不拦正常的中文口语，也不拦已经约定允许的英文缩写（CBT/PTSD/OK 等）。

import { detectEncounterDrift, type EncounterInput } from '../encounter/encounter-scene.js';
import { stripReasoningBlocks } from '../llm/reasoning-text.js';
import { PROMPT_ECHO_MARKERS } from '../realism/visitor-register-audit.js';

/** 台词所属角色。 */
export type OutputRole = 'visitor' | 'counselor';

/** 输出完整性判定结果。 */
export interface OutputIntegrityResult {
  /** 剥掉已闭合推理块后的文本（未命中时可直接落库）。 */
  readonly clean: string;
  /** 是否判定为非法（不得写入逐字稿）。 */
  readonly invalid: boolean;
  /** 命中的原因（供观测定位，不含原文）。 */
  readonly reasons: readonly string[];
  /** 与场景冲突的媒介词（无场景时不检测）。 */
  readonly sceneDrift: readonly string[];
}

/** 提示词/模板标记：出现即说明模型在复述指令，而不是在说话。 */
const PROMPT_MARKERS: readonly string[] = [
  '硬规则',
  '这一轮怎么说',
  '上一轮咨询师说',
  '你心里坚信',
  '系统提示',
  'system prompt',
  '作为 AI',
  '作为AI',
  '语言模型',
  '输出格式',
  '严格按以下',
  '以下是你的角色设定',
  '你是一个 AI',
  '你是一个AI',
  '<system',
  '</system>',
  '<instructions',
  '### 指令',
  '## 硬规则',
  // AF-213：R3 模板标记并入常开闸门，避免 realism 关闭时 prompt 回显漏过。
  ...PROMPT_ECHO_MARKERS,
];

/** 无标签推理的开头（英文居多；中文只认不会被正常台词使用的强标记）。 */
const REASONING_PREFIXES: readonly RegExp[] = [
  /^\s*(?:we|i|let me|let's|the user|the visitor|the counselor)\b/i,
  /^\s*(?:okay|first|now),\s*(?:we|i|let)\b/i,
  /^\s*(我需要先|让我先想|先分析一下|我需要判断|现在我需要)\b/,
];

/** 角色标签泄漏：模型把对话记录格式本身复述出来。 */
const ROLE_LABEL_LEAK = /^\s*(?:咨询师|来访者|系统|assistant|user)\s*[：:]/i;

/**
 * AF-204 · JSON 摘要 / 结构化输出 / 未闭合推理 / 无标签英文残片.
 *
 * 真实故障形态 (比 prompt 复述更隐蔽): 模型不"说话"了, 直接交一份**结构**——
 *   · `{"emotion": "焦虑", "summary": "来访者提到工作压力"}` → JSON 对象摘要;
 *   · `["焦虑", "疲惫"]`                                  → JSON 数组摘要;
 *   · `情绪：焦虑\n原因：工作压力`                        → 字段化结构输出;
 *   · `让我想想……`                                        → 推理说出口且没说完;
 *   · `我有点紧张。We should respond with empathy.`        → 无标签英文推理残片.
 *
 * 判定口径: 只**拦截**, 不改写 —— 业务层负责重试一次, 仍非法则换安全兜底句.
 */

/** JSON 对象: 带引号键的 `{...}` (被长度截断的未闭合对象同样命中). */
const JSON_OBJECT_PATTERN = /\{[^{}]*"(?:[^"\\]|\\.)*"\s*:/;

/** JSON 对象 (键没加引号): `{emotion: 焦虑}` —— 结构化输出的退化形态. */
const JSON_OBJECT_LOOSE_PATTERN = /\{\s*[A-Za-z_]\w*\s*:/;

/** JSON 数组: 元素是对象 / 字符串 / 布尔 / null. */
const JSON_ARRAY_PATTERN = /\[\s*(?:\{|"|true\b|false\b|null\b)/;

/** JSON 数字数组: `[1, 2]` (至少两个元素, 避免误伤脚注式的 `[1]`). */
const JSON_NUMBER_ARRAY_PATTERN = /\[\s*-?\d+(?:\s*,\s*-?\d+)+\s*\]/;

/** 结构化字段行: `情绪：焦虑` / `- emotion: anxiety` (行首标签 + 冒号 + 值). */
const STRUCTURED_FIELD_LINE = /^(?:[-*•]\s*)?([^\s:：]{1,10})\s*[:：]\s*(\S.*)$/;

/** 字段标签必须「像字段名」才计入 (2-6 个汉字或一个英文标识符), 避免误伤正常口语. */
const STRUCTURED_FIELD_LABEL = /^(?:[\u4E00-\u9FFF]{2,6}|[A-Za-z]\w{1,19})$/;

/** 摘要型标签: 单行出现即判结构化输出 (模型把内部状态当摘要交上来了). */
const SUMMARY_FIELD_LABELS: ReadonlySet<string> = new Set([
  '情绪',
  '状态',
  '摘要',
  '总结',
  '概要',
  '要点',
  '风险',
  '建议',
  '原因',
  '结论',
  '诊断',
  '评估',
  '主题',
  '意图',
  '关键词',
  'emotion',
  'emotions',
  'emotional',
  'state',
  'summary',
  'risk',
  'suggestion',
  'note',
  'notes',
  'reason',
  'topic',
  'intent',
  'mood',
]);

/**
 * 推理开头 (把思考说出口) 的词干 —— 用于判定「推理没说完」.
 *
 * 只收「说话人不可能对来访者说出口」的思考动词; 「我想想」这种纯口语犹豫词不在此列
 * (它在不流利词表里是合法填充词).
 */
const REASONING_OPENER_STEMS: readonly string[] = [
  '让我想想',
  '让我再想想',
  '让我先想想',
  '让我想一下',
  '让我想一想',
  '让我琢磨一下',
  '让我分析一下',
  '我先想想',
  '我先想想看',
  '我先分析一下',
  '我先琢磨一下',
  '我得想想',
  '我需要想想',
  '我需要分析一下',
  '先分析一下',
  '先考虑一下',
];

/** 句尾的悬空标点字符 (推理没说完时留下的尾巴). */
const DANGLING_PUNCTUATION_CHARS: ReadonlySet<string> = new Set([
  ' ',
  '\t',
  '\n',
  '\r',
  '…',
  '。',
  '，',
  '、',
  '；',
  '：',
  '!',
  '！',
  '?',
  '？',
  ',',
  '.',
  ';',
  ':',
]);

/**
 * 英文推理功能词: 正常中文口语里不会出现, 出现即说明模型在说英文推理.
 *
 * 只收「推理/指令」语义的词, 不收可以自然出现在中文里的普通英文名词.
 */
const ENGLISH_REASONING_WORDS: ReadonlySet<string> = new Set([
  'i',
  'we',
  'you',
  'they',
  'the',
  'a',
  'an',
  'and',
  'but',
  'so',
  'because',
  'that',
  'this',
  'these',
  'those',
  'should',
  'must',
  'need',
  'needs',
  'ought',
  'have',
  'has',
  'was',
  'were',
  'is',
  'are',
  'be',
  'to',
  'of',
  'for',
  'with',
  'as',
  'in',
  'will',
  'would',
  'can',
  'could',
  'let',
  'lets',
  'think',
  'thought',
  'respond',
  'response',
  'reply',
  'answer',
  'ask',
  'said',
  'say',
  'says',
  'visitor',
  'counselor',
  'client',
  'patient',
  'user',
  'character',
  'role',
  'emotion',
  'emotional',
  'feel',
  'feeling',
  'feelings',
  'mood',
  'tone',
  'scenario',
  'prompt',
  'instruction',
  'instructions',
  'system',
  'model',
  'llm',
  'empathy',
  'validation',
]);

/** 异常文字系统。 */
const FOREIGN_SCRIPT_PATTERNS: readonly { readonly reason: string; readonly pattern: RegExp }[] = [
  { reason: 'hangul', pattern: /[\uAC00-\uD7AF\u1100-\u11FF\u3130-\u318F]/ },
  { reason: 'kana', pattern: /[\u3040-\u30FF]/ },
  { reason: 'cyrillic', pattern: /[\u0400-\u04FF]/ },
  { reason: 'arabic', pattern: /[\u0600-\u06FF]/ },
];

/** 允许出现的拉丁缩写（正常口语/专业词，不当作外语泄漏）。 */
const ALLOWED_LATIN: ReadonlySet<string> = new Set([
  'ok',
  'okay',
  'mm',
  'mmm',
  'hmm',
  'cbt',
  'dbt',
  'act',
  'ptsd',
  'emdr',
  'hiv',
  'adhd',
  'asd',
  'iq',
  'hr',
  'bpm',
  'ml',
  'kg',
  'cm',
  'ai',
  'app',
  'dvd',
  'cd',
  'sos',
  // 常用评估量表/专业缩写：中文咨询语境里会正常出现，不能当外语泄漏。
  'gad',
  'phq',
  'sds',
  'bdi',
  'bai',
  'pss',
  'isi',
  'mmse',
  'moca',
]);

/** 稀疏拉丁词：一句里超过 2 个非白名单英文词才算泄漏（避免误伤单个缩写）。 */
const LATIN_TOKEN = /[A-Za-z]{2,}/g;
const LATIN_TOKEN_LIMIT = 2;

/** 语义标记 / 控制标记：`[sigh]`、`[[STATE:END]]` 是协议的合法组成，不参与文本判定。 */
const CONTROL_TAG = /\[\[[A-Z_]+:[A-Z_]*\]\]/g;
const SEMANTIC_TAG = /\[[a-z][a-z0-9_-]{0,30}\]/gi;

/**
 * 判定一段文本是不是「结构化输出」(字段行 / 摘要行), 而不是一句人话.
 *
 * 口径: 摘要型标签 (情绪 / 状态 / …) 单行即判; 一般标签要**成片**出现 (≥2 行) 才判,
 * 避免把正常口语里的「他说：……」误杀.
 *
 * @param text 判定用文本 (已剥掉语义标记)
 * @returns 是结构化输出即 true
 */
function isStructuredOutput(text: string): boolean {
  let fieldLines = 0;
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (line === '') continue;
    const match = STRUCTURED_FIELD_LINE.exec(line);
    if (!match) continue;
    const label = match[1];
    if (!STRUCTURED_FIELD_LABEL.test(label)) continue;
    if (SUMMARY_FIELD_LABELS.has(label.toLowerCase())) return true;
    fieldLines += 1;
  }
  return fieldLines >= 2;
}

/**
 * 去掉句尾的悬空标点 (线性扫描, 不用回溯正则).
 *
 * @param text 原始文本
 * @returns 去掉悬空标点后的文本
 */
function stripTrailingDanglingPunctuation(text: string): string {
  let end = text.length;
  while (end > 0 && DANGLING_PUNCTUATION_CHARS.has(text[end - 1])) end -= 1;
  return text.slice(0, end);
}

/**
 * 判定有没有「未闭合推理」: 推理开头之后没给出结论.
 *
 * 例: 「让我想想……」「让我想想,」「我先想想…」.
 *
 * @param scan 判定用文本
 * @returns 有未闭合推理即 true
 */
function hasUnclosedReasoning(scan: string): boolean {
  const trimmed = stripTrailingDanglingPunctuation(scan);
  if (trimmed.length === 0) return false;
  return REASONING_OPENER_STEMS.some((stem) => trimmed.endsWith(stem));
}

/**
 * 是否是拉丁字母 (ASCII).
 *
 * @param char 单字符
 * @returns 是拉丁字母即 true
 */
function isLatinLetter(char: string): boolean {
  const code = char.codePointAt(0) ?? 0;
  return (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
}

/**
 * 找出文本里的「英文词组」: 只隔空白的两个以上英文单词.
 *
 * 手工线性扫描而不是嵌套量词正则 —— 嵌套量词会触发正则回溯风险,
 * 而且这里只需要「相邻英文词」这一件事.
 *
 * @param scan 判定用文本
 * @returns 词组数组 (每组是按出现顺序的单词)
 */
function findEnglishWordRuns(scan: string): string[][] {
  const runs: string[][] = [];
  let current: string[] = [];
  const flush = (): void => {
    if (current.length >= 2) runs.push(current);
    current = [];
  };
  let index = 0;
  while (index < scan.length) {
    const char = scan[index];
    if (isLatinLetter(char)) {
      let word = '';
      while (index < scan.length && isLatinLetter(scan[index])) {
        word += scan[index];
        index += 1;
      }
      current.push(word);
      continue;
    }
    // 只有空白能延续词组; 其它字符 (中文 / 标点) 断开.
    if (char !== ' ' && char !== '\t') flush();
    index += 1;
  }
  flush();
  return runs;
}

/**
 * 判定文本里有没有「无标签英文推理残片」.
 *
 * 口径: 连续两个以上英文词, 且含推理/指令类功能词; 全是约定缩写 (CBT / PHQ / OK) 时放行.
 *
 * @param scan 判定用文本 (已剥掉语义标记)
 * @returns 有英文推理残片即 true
 */
function hasEnglishReasoningFragment(scan: string): boolean {
  for (const run of findEnglishWordRuns(scan)) {
    const tokens = run.map((token) => token.toLowerCase());
    // 全是约定缩写 → 正常专业词, 不是推理残片.
    if (tokens.every((token) => ALLOWED_LATIN.has(token))) continue;
    if (tokens.some((token) => ENGLISH_REASONING_WORDS.has(token))) return true;
  }
  return false;
}

/**
 * 拉丁字母层的泄漏判定 (外语残片 + 无标签英文推理残片).
 *
 * @param scan 判定用文本
 * @returns 命中的原因列表
 */
function collectLatinReasons(scan: string): string[] {
  const reasons: string[] = [];
  const latinTokens = scan.match(LATIN_TOKEN) ?? [];
  const suspiciousLatin = latinTokens.filter((token) => !ALLOWED_LATIN.has(token.toLowerCase()));
  if (suspiciousLatin.length > LATIN_TOKEN_LIMIT) reasons.push('foreign_latin');
  // 单个异常长英文词（>= 4 字母且不在白名单）也判泄漏：mild / passation / staying
  // 这类典型是模型从英文推理串到中文台词里，正常中文口语不会出现。
  if (suspiciousLatin.some((token) => token.length >= 4)) reasons.push('foreign_word');
  // 全大写疑问缩写：`NAC?` 这类是模型自问自答的推理残片，正常台词不会这样写。
  for (const match of scan.matchAll(/\b([A-Z]{2,6})\s*\?/g)) {
    if (!ALLOWED_LATIN.has(match[1].toLowerCase())) reasons.push('foreign_word');
  }
  // AF-204: 无标签英文推理残片（出现在台词中间, 没有推理标签也没有开头标记）.
  if (hasEnglishReasoningFragment(scan)) reasons.push('english_reasoning');
  return reasons;
}

/**
 * 判定一段生成文本能否写入逐字稿。
 *
 * @param text 模型原始输出
 * @param role 台词所属角色（来访者 / 咨询师）
 * @param encounter 本场场景；undefined = 不做场景漂移检测
 * @returns 判定结果
 */
export function inspectGeneratedOutput(text: string, role: OutputRole, encounter?: EncounterInput | null): OutputIntegrityResult {
  // 角色位留给后续按角色分级（当前检测项对两角色同构）。
  void role;
  const clean = stripReasoningBlocks(text ?? '').trim();
  // 判定用文本：剥掉语义标记，避免 `[sigh]` / `[[STATE:MORE]]` 被当成外语泄漏。
  const scan = clean.replaceAll(CONTROL_TAG, ' ').replaceAll(SEMANTIC_TAG, ' ');
  const reasons: string[] = [];

  if (clean.length === 0) {
    return { clean, invalid: true, reasons: ['empty'], sceneDrift: [] };
  }

  const lower = scan.toLowerCase();
  if (PROMPT_MARKERS.some((marker) => lower.includes(marker.toLowerCase()))) reasons.push('prompt_marker');
  if (REASONING_PREFIXES.some((pattern) => pattern.test(scan))) reasons.push('reasoning_prefix');
  if (hasUnclosedReasoning(scan)) reasons.push('unclosed_reasoning');
  if (ROLE_LABEL_LEAK.test(scan)) reasons.push('role_label');

  // AF-204: JSON 摘要 / 结构化输出 —— 模型交上来的是结构, 不是台词.
  if (JSON_OBJECT_PATTERN.test(scan) || JSON_OBJECT_LOOSE_PATTERN.test(scan)) reasons.push('json_object');
  if (JSON_ARRAY_PATTERN.test(scan) || JSON_NUMBER_ARRAY_PATTERN.test(scan)) reasons.push('json_array');
  if (isStructuredOutput(scan)) reasons.push('structured_output');

  for (const { reason, pattern } of FOREIGN_SCRIPT_PATTERNS) {
    if (pattern.test(scan)) reasons.push(reason);
  }

  reasons.push(...collectLatinReasons(scan));

  const sceneDrift = detectEncounterDrift(clean, encounter);
  if (sceneDrift.length > 0) reasons.push('scene_drift');

  return { clean, invalid: reasons.length > 0, reasons, sceneDrift };
}

/**
 * 非法输出时的安全兜底台词。
 *
 * ⚠️ 兜底句本身必须满足场景契约：面对面不用线上媒介词，文字通道不写现场动作。
 *
 * ⚠️ AF-204 · 场景中立: 兜底句**不预设线上 / 线下** —— 它不知道自己会被写进哪种
 *   接触方式的会话, 所以不许出现任何媒介词（打字 / 消息 / 屏幕 / 面对面 …）,
 *   也不许出现只属于某一侧的动作描写. 回归见 test/auto-practice/af204-output-integrity-shape.spec.ts
 *   （逐个场景档案断言零漂移）.
 *
 * @param role 台词所属角色
 * @returns 安全短句
 */
export function safeOutputFallback(role: OutputRole): string {
  return role === 'counselor' ? '我们先慢一点。你愿意说说，刚才那一刻你心里发生了什么吗？' : '……嗯。';
}
