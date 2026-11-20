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
// 反双胞胎:
//   - 不替代安全判定（自伤/自杀风险仍走 assessSafety 那条链）；
//   - 不拦正常的中文口语，也不拦已经约定允许的英文缩写（CBT/PTSD/OK 等）。

import { detectEncounterDrift, type EncounterInput } from '../encounter/encounter-scene.js';
import { stripReasoningBlocks } from '../llm/reasoning-text.js';

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
];

/** 无标签推理的开头（英文居多；中文只认不会被正常台词使用的强标记）。 */
const REASONING_PREFIXES: readonly RegExp[] = [
  /^\s*(?:we|i|let me|let's|the user|the visitor|the counselor)\b/i,
  /^\s*(?:okay|first|now),\s*(?:we|i|let)\b/i,
  /^\s*(我需要先|让我先想|先分析一下|我需要判断|现在我需要)\b/,
];

/** 角色标签泄漏：模型把对话记录格式本身复述出来。 */
const ROLE_LABEL_LEAK = /^\s*(?:咨询师|来访者|系统|assistant|user)\s*[：:]/i;

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
  if (ROLE_LABEL_LEAK.test(scan)) reasons.push('role_label');

  for (const { reason, pattern } of FOREIGN_SCRIPT_PATTERNS) {
    if (pattern.test(scan)) reasons.push(reason);
  }

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

  const sceneDrift = detectEncounterDrift(clean, encounter);
  if (sceneDrift.length > 0) reasons.push('scene_drift');

  return { clean, invalid: reasons.length > 0, reasons, sceneDrift };
}

/**
 * 非法输出时的安全兜底台词。
 *
 * ⚠️ 兜底句本身必须满足场景契约：面对面不用线上媒介词，文字通道不写现场动作。
 *
 * @param role 台词所属角色
 * @returns 安全短句
 */
export function safeOutputFallback(role: OutputRole): string {
  return role === 'counselor' ? '我们先慢一点。你愿意说说，刚才那一刻你心里发生了什么吗？' : '……嗯。';
}
