// V2026-11-11 (P1e Phase3 · visitor prompt 语义标记迁移 · 离线灰度对比脚本):
//   目的: 在**切在线之前**, 用**同一批真实离线逐字稿**对比三种形态的解析结果 ——
//     · 「实测旧形态」: 真实旧 prompt 产出的原文, 零加工直接 parse (真实基线);
//     · 「旧形态模板」: 同一批文本套**厂商标记** (旧 prompt 教的形态);
//     · 「新形态模板」: 同一批文本套**语义标记** (迁移后的形态: 句首语气 + 句中停顿 + 句末情绪).
//   三个口径分别回答三个问题:
//     ① 实测旧形态 → 旧 prompt 到底产出没产出标记? (决定迁移是"换壳"还是"从 0 到 1");
//     ② 旧形态模板 → 旧形态若被模型遵守, 解析层会怎么认领它? (降级成本);
//     ③ 新形态模板 → 新形态被模型遵守时, 解析层是否无损? (降级率 / [pause] 命中率 / 情绪命中率).
//
//   ⚠️ 口径声明 (别过度解读):
//     本脚本比的是"**同一批真实输出在两套模板下的解析结果**".
//     它能回答"新形态的解析链路是否有损", 但**不能**回答"新 prompt 真跑一批 LLM 会怎样"
//     —— 后者要真实调用 LLM (新 prompt 会改变模型的输出习惯), 那一步走仓库既有离线批次入口
//     (POST /admin/api/auto-practice/batch), 需要 DB + Redis, 由用户执行 (见交付记录 §五).
//     本脚本是**无 DB 依赖**的那一半: 它验证解析链路本身, 且喂的是**真实语料**.
//
//   隐私: 输出只含**码与计数** —— 心理对话原文一律不进输出.
//
//   用法:
//     pnpm exec tsx scripts/ops/semantic-tag-migration/compare-parse-degradation.ts --input <逐字稿目录或文件>
//
//   逐字稿格式 (仓库真实格式, 见 src/admin-debug/debug-session-store.ts):
//     { "id": "...", "messages": [ { "role": "visitor", "text": "..." }, ... ], ... }
//   ⚠️ 只取**顶层 `messages`** 数组 —— `kernelState.memories` 里还有同一批消息的副本
//     (role + content 形态), 递归扫会把每轮算两遍.
//
//   验证: pnpm exec tsx scripts/ops/semantic-tag-migration/compare-parse-degradation.ts --help

import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

import { parseSemanticTags } from '../../../src/auto-practice/utils/semantic-tag-parser.js';

/** 解析降级级别 (0 干净 / 1 轻度 / 2 重度). */
type Level = 0 | 1 | 2;

/** 一轮的解析观测 (只出计数, 不出原文). */
interface TurnObservation {
  readonly level: Level;
  readonly hasPause: boolean;
  readonly hasEmotion: boolean;
  readonly hasPreSpeech: boolean;
  readonly pauseTags: number;
  readonly emotionTags: number;
  readonly preSpeechTags: number;
  readonly convertedVendorTags: number;
  readonly droppedVendorMarkers: number;
  readonly unknownTags: number;
  readonly diagnosticCodes: readonly string[];
}

/** 一种形态的观测汇总. */
interface FormObservation {
  readonly turns: number;
  readonly levels: readonly [number, number, number];
  readonly turnsWithPause: number;
  readonly turnsWithEmotion: number;
  readonly turnsWithPreSpeech: number;
  readonly pauseTags: number;
  readonly emotionTags: number;
  readonly preSpeechTags: number;
  readonly convertedVendorTags: number;
  readonly droppedVendorMarkers: number;
  readonly unknownTags: number;
  readonly diagnosticCodes: ReadonlyMap<string, number>;
}

/**
 * 旧 prompt 教的厂商标记全集 (取自迁移前 HEAD 版 `DIFFICULTY_TAG_FREQ` 三档并集).
 *
 * 为什么按轮轮换而不是固定一个:
 *   旧 prompt 教的是**一个集合** (L1 五词 / L2 三词 / L3 两词), 模型具体挑哪个是不确定的.
 *   固定单一标记会低估旧形态的降级成本 (比如只测 `(sighs)` —— 它能转换, 没有丢弃成本).
 *   轮换能覆盖"能转换"与"语义层表达不了 → 丢弃"两条路径.
 */
const OLD_VENDOR_MARKERS: readonly string[] = ['(sighs)', '(breath)', '(laughs)', '(sniffs)', '(humming)', '(chuckle)', '(emm)'];

/** 句首语气 / 句中停顿 / 句末情绪 —— 新形态模板的三个组成部分. */
const NEW_PRE_SPEECH = '[sigh]';
const NEW_PAUSE = '[pause:0.5]';
const NEW_EMOTION = '[emotion:sad]';

/**
 * 把停顿插到**句中**.
 *
 * 为什么不能放句尾: 句尾停顿会被解析层按 `PAUSE_TRAILING_DROPPED` 丢弃 (后面没有可发音文本),
 *   那测出来的是"模板摆错位置", 不是"新形态的解析表现" —— 测出来必然假失败.
 * 插点: 优先取前半段最后一个句读 (。！？，、…); 没有句读就取中点.
 */
function insertPauseMidText(text: string): { readonly text: string; readonly placed: boolean } {
  const puncts = new Set(['。', '！', '？', '，', '、', '…', '.', '!', '?', ',']);
  const limit = Math.max(1, Math.floor(text.length * 0.7));
  let cut = -1;
  for (let i = 0; i < limit; i += 1) {
    if (puncts.has(text[i] ?? '')) cut = i + 1;
  }
  if (cut <= 0) cut = Math.floor(text.length / 2);
  if (cut <= 0 || cut >= text.length) return { text, placed: false };
  return { text: text.slice(0, cut) + NEW_PAUSE + text.slice(cut), placed: true };
}

/** 套旧形态模板: 句首一个厂商标记 (旧 prompt 的最低频档形态). */
function applyOldTemplate(text: string, index: number): string {
  const marker = OLD_VENDOR_MARKERS[index % OLD_VENDOR_MARKERS.length] ?? '(sighs)';
  return marker + text;
}

/** 套新形态模板: 句首语气 + 句中停顿 + 句末情绪. */
function applyNewTemplate(text: string): string {
  const withPause = insertPauseMidText(text);
  return NEW_PRE_SPEECH + withPause.text + NEW_EMOTION;
}

/** 观测一轮. */
function observe(text: string): TurnObservation {
  const parsed = parseSemanticTags(text);
  return {
    level: parsed.level as Level,
    hasPause: parsed.stats.pauseTags > 0,
    hasEmotion: parsed.stats.emotionTags > 0,
    hasPreSpeech: parsed.stats.preSpeechTags > 0,
    pauseTags: parsed.stats.pauseTags,
    emotionTags: parsed.stats.emotionTags,
    preSpeechTags: parsed.stats.preSpeechTags,
    convertedVendorTags: parsed.stats.convertedVendorTags,
    droppedVendorMarkers: parsed.stats.droppedVendorMarkers,
    unknownTags: parsed.stats.unknownTags,
    diagnosticCodes: [...parsed.warnings, ...parsed.errors].map((d) => d.code),
  };
}

/** 汇总一种形态. */
function summarize(observations: readonly TurnObservation[]): FormObservation {
  const levels: [number, number, number] = [0, 0, 0];
  const codes = new Map<string, number>();
  let turnsWithPause = 0;
  let turnsWithEmotion = 0;
  let turnsWithPreSpeech = 0;
  let pauseTags = 0;
  let emotionTags = 0;
  let preSpeechTags = 0;
  let convertedVendorTags = 0;
  let droppedVendorMarkers = 0;
  let unknownTags = 0;

  for (const o of observations) {
    levels[o.level] += 1;
    if (o.hasPause) turnsWithPause += 1;
    if (o.hasEmotion) turnsWithEmotion += 1;
    if (o.hasPreSpeech) turnsWithPreSpeech += 1;
    pauseTags += o.pauseTags;
    emotionTags += o.emotionTags;
    preSpeechTags += o.preSpeechTags;
    convertedVendorTags += o.convertedVendorTags;
    droppedVendorMarkers += o.droppedVendorMarkers;
    unknownTags += o.unknownTags;
    for (const code of o.diagnosticCodes) {
      codes.set(code, (codes.get(code) ?? 0) + 1);
    }
  }

  return {
    turns: observations.length,
    levels,
    turnsWithPause,
    turnsWithEmotion,
    turnsWithPreSpeech,
    pauseTags,
    emotionTags,
    preSpeechTags,
    convertedVendorTags,
    droppedVendorMarkers,
    unknownTags,
    diagnosticCodes: codes,
  };
}

/** 汇总输出 (只出码与计数). */
function report(label: string, form: FormObservation): void {
  const total = Math.max(1, form.turns);
  const pct = (n: number): string => `${((n / total) * 100).toFixed(1)}%`;
  console.log(`\n[${label}] 轮数=${form.turns}`);
  console.log(
    `  降级分布 : L0=${form.levels[0]} (${pct(form.levels[0])})  L1=${form.levels[1]} (${pct(form.levels[1])})  L2=${form.levels[2]} (${pct(form.levels[2])})`,
  );
  console.log(`  降级率   : L1+L2 = ${pct(form.levels[1] + form.levels[2])} (${form.levels[1] + form.levels[2]} 轮)`);
  console.log(`  [pause]  : 命中 ${form.turnsWithPause} 轮 (${pct(form.turnsWithPause)})  标记总数 ${form.pauseTags}`);
  console.log(`  情绪标记 : 命中 ${form.turnsWithEmotion} 轮 (${pct(form.turnsWithEmotion)})  标记总数 ${form.emotionTags}`);
  console.log(`  句首语气 : 命中 ${form.turnsWithPreSpeech} 轮 (${pct(form.turnsWithPreSpeech)})`);
  console.log(`  厂商标记 : 转换=${form.convertedVendorTags}  丢弃=${form.droppedVendorMarkers}  未知标记=${form.unknownTags}`);
  const codes = [...form.diagnosticCodes.entries()].toSorted((a, b) => b[1] - a[1]);
  if (codes.length === 0) {
    console.log('  诊断码   : (无)');
  } else {
    console.log(`  诊断码   : ${codes.map(([code, n]) => `${code}=${n}`).join('  ')}`);
  }
}

/** 一份逐字稿里抽出来的来访者轮. */
interface TranscriptFile {
  readonly path: string;
  readonly fileId: string;
  readonly visitorTexts: readonly string[];
  readonly fromBatch: boolean;
}

/**
 * 从一份逐字稿 JSON 里抽出来访者轮的纯文本.
 *
 * 只认**顶层 `messages`** 数组 (仓库真实格式):
 *   - `kernelState.memories` 里存着同一批消息的副本 (role + content), 递归扫会重复计数;
 *   - `traces` 里是引擎轨迹, 不含来访者原话.
 */
function extractVisitorTexts(payload: unknown): string[] {
  if (!payload || typeof payload !== 'object') return [];
  const record = payload as Record<string, unknown>;
  const messages = record['messages'];
  if (!Array.isArray(messages)) return [];
  const out: string[] = [];
  for (const item of messages) {
    if (!item || typeof item !== 'object') continue;
    const turn = item as Record<string, unknown>;
    if (turn['role'] !== 'visitor') continue;
    const text = typeof turn['text'] === 'string' ? turn['text'] : turn['content'];
    if (typeof text === 'string' && text.trim().length > 0) out.push(text);
  }
  return out;
}

/** 收集输入文件 (目录 → 递归 *.json; 文件 → 自身). */
function collectFiles(target: string): string[] {
  const stats = statSync(target);
  if (!stats.isDirectory()) return [target];
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const full = path.join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (full.endsWith('.json')) out.push(full);
    }
  };
  walk(target);
  return out;
}

/**
 * 收集批次索引里登记过的 debugSessionId —— 用来标出"哪些逐字稿来自离线批次".
 *
 * 批次索引文件在 `_batches/<batchId>.json`, 形如 `{ sessions: [{ debugSessionId, ... }] }`.
 */
function collectBatchSessionIds(files: readonly string[]): Set<string> {
  const ids = new Set<string>();
  for (const file of files) {
    if (!file.includes(`_batches`)) continue;
    let payload: unknown;
    try {
      payload = JSON.parse(readFileSync(file, 'utf8'));
    } catch {
      continue;
    }
    if (!payload || typeof payload !== 'object') continue;
    const sessions = (payload as Record<string, unknown>)['sessions'];
    if (!Array.isArray(sessions)) continue;
    for (const item of sessions) {
      if (!item || typeof item !== 'object') continue;
      const id = (item as Record<string, unknown>)['debugSessionId'];
      if (typeof id === 'string') ids.add(id);
    }
  }
  return ids;
}

/** 主流程. */
function main(): void {
  const args = process.argv.slice(2);
  const inputIndex = args.indexOf('--input');
  if (args.includes('--help') || inputIndex === -1) {
    console.log('用法: pnpm exec tsx scripts/ops/semantic-tag-migration/compare-parse-degradation.ts --input <逐字稿目录或文件>');
    console.log('');
    console.log('三种形态对比 (实测旧形态 / 旧形态模板 / 新形态模板): 降级率 · [pause] 命中率 · 情绪命中率.');
    console.log('输出只含码与计数 —— 心理对话原文不进输出.');
    // 用 exitCode 而不是 process.exit() —— 与 bin/ 及 ops 脚本同款，让事件循环自然收尾。
    process.exitCode = inputIndex === -1 && !args.includes('--help') ? 1 : 0;
    return;
  }
  const input = args[inputIndex + 1];
  if (!input) {
    console.error('缺 --input 的路径');
    process.exitCode = 1;
    return;
  }

  const files = collectFiles(input);
  if (files.length === 0) {
    console.error(`输入目录里没有 *.json: ${input}`);
    process.exitCode = 1;
    return;
  }

  const batchSessionIds = collectBatchSessionIds(files);
  const transcripts: TranscriptFile[] = [];
  for (const file of files) {
    let payload: unknown;
    try {
      payload = JSON.parse(readFileSync(file, 'utf8'));
    } catch {
      continue; // 不是逐字稿 JSON (比如索引文件) —— 跳过, 不报错.
    }
    const visitorTexts = extractVisitorTexts(payload);
    if (visitorTexts.length === 0) continue;
    const fileId =
      file
        .replaceAll('\\', '/')
        .split('/')
        .pop()
        ?.replace(/\.json$/, '') ?? file;
    transcripts.push({ path: file, fileId, visitorTexts, fromBatch: batchSessionIds.has(fileId) });
  }

  const measured: TurnObservation[] = [];
  const oldForm: TurnObservation[] = [];
  const newForm: TurnObservation[] = [];
  let turnCount = 0;
  let pausePlaced = 0;
  let batchTurns = 0;

  for (const file of transcripts) {
    for (const text of file.visitorTexts) {
      turnCount += 1;
      if (file.fromBatch) batchTurns += 1;
      measured.push(observe(text));
      oldForm.push(observe(applyOldTemplate(text, turnCount - 1)));
      const applied = applyNewTemplate(text);
      if (insertPauseMidText(text).placed) pausePlaced += 1;
      newForm.push(observe(applied));
    }
  }

  console.log(`\n输入: ${files.length} 个 JSON 文件 → ${transcripts.length} 份逐字稿, 来访者轮 ${turnCount}`);
  console.log(`其中来自离线批次的逐字稿: ${transcripts.filter((t) => t.fromBatch).length} 份 / ${batchTurns} 轮`);
  console.log(`新形态停顿成功插入句中: ${pausePlaced} 轮 (其余因文本过短无处安放)`);

  const measuredForm = summarize(measured);
  const oldFormSummary = summarize(oldForm);
  const newFormSummary = summarize(newForm);

  report('形态 A · 实测旧形态 (真实旧 prompt 输出, 零加工)', measuredForm);
  report('形态 B · 旧形态模板 (句首厂商标记)', oldFormSummary);
  report('形态 C · 新形态模板 (句首语义标记 + 句中停顿 + 句末情绪)', newFormSummary);

  // 判定 1: 新形态解析无损 (新形态降级率不得高于旧形态模板).
  const oldDegraded = oldFormSummary.levels[1] + oldFormSummary.levels[2];
  const newDegraded = newFormSummary.levels[1] + newFormSummary.levels[2];
  console.log(`\n[判定 1 · 解析链路无损] 旧形态模板降级轮=${oldDegraded}  新形态降级轮=${newDegraded}`);
  console.log(`[判定 1] ${newDegraded <= oldDegraded ? 'PASS — 新形态解析链路无损' : 'FAIL — 新形态降级更多, 需排查'}`);

  // 判定 2: 新形态必须真的带来停顿/情绪能力 (旧形态体系里根本没有).
  const newPauseRate = newFormSummary.turnsWithPause / Math.max(1, newFormSummary.turns);
  const newEmotionRate = newFormSummary.turnsWithEmotion / Math.max(1, newFormSummary.turns);
  console.log(
    `\n[判定 2 · 能力增量] 新形态 [pause] 命中率=${(newPauseRate * 100).toFixed(1)}%  情绪命中率=${(newEmotionRate * 100).toFixed(1)}%`,
  );
  console.log(`[判定 2] ${newPauseRate > 0 && newEmotionRate > 0 ? 'PASS — 新形态能承载停顿与情绪' : 'FAIL — 新形态没有解析出停顿或情绪'}`);

  // 判定 3: 实测旧形态的标记产出率 (迁移是"换壳"还是"从 0 到 1").
  const measuredPreSpeech = measuredForm.turnsWithPreSpeech;
  console.log(`\n[判定 3 · 旧 prompt 实测产出率] 带标记轮=${measuredPreSpeech}/${measuredForm.turns}`);
  console.log(
    `[判定 3] ${measuredPreSpeech === 0 ? '旧 prompt 在这批真实语料里零标记产出 — 迁移是"从 0 到 1", 不是"换壳"' : '旧 prompt 有标记产出 — 迁移是"换壳 + 加能力"'}`,
  );
}

main();
