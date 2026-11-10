// 来访者质量评测 v1 (Phase2.5 WP-J · 改动 C)
//
// 目标: 给"来访者 AI 演得像不像"建立**第一版可复算的度量**.
//   此前这个产品一条来访者质量指标都没有 —— 396 场分析的都是咨询师侧与话术重复,
//   而产品真正训练的是"真人咨询师 × AI 来访者", 来访者才是被测对象.
//
// 设计原则 (为什么这样设计, 而不是凭印象打分):
//   1. 优先用**内核信号**(traces.strategy / crisis / kernelState), 其次才用文本词表.
//      内科信号是引擎算出来的确定量, 文本词表是我拍的关键词 —— 后者只能当交叉验证.
//   2. 不报"分数", 只报**可复算的比率与分布**. 分数无法被证伪, 比率可以.
//   3. 先测**随机基线**, 再谈目标值. 没有基线的"可分辨度"是自欺.
//   4. 隐私红线: 输出里**不出现任何对话文本**, 只有 id / 数字 / 标签.
//      (唯一例外是 --anchor 导出的标注清单, 它只含 session id, 不含台词)
//
// 用法:
//   npx tsx scripts/ops/quality/visitor-quality-audit.ts
//   npx tsx scripts/ops/quality/visitor-quality-audit.ts --dir data/archives/debug-sessions-baseline-20261109
//   npx tsx scripts/ops/quality/visitor-quality-audit.ts --anchor 30

import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';

import mysql from 'mysql2/promise';

/** 逐字稿消息. */
interface TranscriptMessage {
  readonly role?: string;
  readonly text?: string;
  readonly turnIndex?: number;
}

/** 内核单轮 trace (只取本脚本要用的字段). */
interface TranscriptTrace {
  readonly turnIndex?: number;
  readonly intention?: { readonly strategy?: string };
  readonly crisis?: { readonly detected?: boolean; readonly category?: string | null };
  readonly degraded?: boolean;
  readonly renderSpec?: { readonly taskKind?: string };
  readonly kernelSnapshot?: unknown;
  readonly bdiSnapshot?: { readonly total?: number };
}

/** 逐字稿文件. */
interface TranscriptFile {
  readonly characterSlug?: string;
  readonly characterLabel?: string;
  readonly messages?: readonly TranscriptMessage[];
  readonly traces?: readonly TranscriptTrace[];
  readonly kernelState?: { readonly snapshot?: KernelSnapshot };
}

/** 内核状态快照中本脚本消费的字段. */
interface KernelSnapshot {
  readonly trust?: number;
  readonly safety?: number;
  readonly bond?: number;
  readonly resistance?: { readonly verbal?: number; readonly depth?: number; readonly style?: number };
  readonly emotion?: { readonly label?: string };
}

/** 依恋风格 (与内核 AttachmentStyle 对齐). */
type AttachmentStyle = 'secure' | 'anxious' | 'avoidant' | 'disorganized' | 'unknown';

/** 来访者台词的行为标签 (词表推断, 仅作交叉验证). */
type BehaviorLabel = 'approach' | 'avoid' | 'attack' | 'appease' | 'neutral';

/** 单场审计结果. */
interface SessionAudit {
  readonly debugSessionId: string;
  readonly characterSlug: string;
  readonly attachmentStyle: AttachmentStyle;
  readonly turns: number;
  /** 渲染降级的轮数 —— >0 的场次不能进质量统计 (数据本身不可信). */
  readonly degradedTurns: number;
  /** 内核策略分布. */
  readonly strategyCounts: Readonly<Record<string, number>>;
  /** 首次进入探索 (affective / cognitive) 的轮次; 从未进入为 null. */
  readonly firstExplorationTurn: number | null;
  /** 末 3 轮是否全部停留在 recounting / resistance (深度不动). */
  readonly tailStuck: boolean;
  /** 进场是否过早披露: 前 2 轮就出现 affective 探索. */
  readonly earlyDisclosure: boolean;
  /** 文本行为标签分布. */
  readonly labelCounts: Readonly<Record<BehaviorLabel, number>>;
  /** 能打上非中性标签的轮数 (词表覆盖率分子). */
  readonly labeledTurns: number;
  /** 主导行为标签 (只在**有标签**的轮次上算; 一轮都没打上时记 neutral). */
  readonly dominantLabel: BehaviorLabel;
  /** 终局内核状态 (逐字稿只有末轮快照). */
  readonly endTrust: number;
  readonly endSafety: number;
  readonly endBond: number;
  readonly resistanceDepth: number;
  readonly resistanceVerbal: number;
  /** 台词重复率 (唯一句占比的补数). */
  readonly repeatRate: number;
  /** 字符 3-gram 重复率. */
  readonly trigramRepeatRate: number;
  /** 首句模板率 (开头 4 字重复率). */
  readonly headTemplateRate: number;
  /** 填充词频 (每轮). */
  readonly fillerPerTurn: number;
  /** 危机轮数 / 首现轮次 / 最高档位. */
  readonly crisisTurns: number;
  readonly crisisFirstTurn: number | null;
  readonly crisisPeakLevel: number;
}

/** 行为标签词表 —— ⚠️ 工程种子值, 非临床标定. 只用于交叉验证内核信号. */
const LABEL_LEXICON: Readonly<Record<Exclude<BehaviorLabel, 'neutral'>, readonly string[]>> = {
  approach: ['我想说', '我想告诉', '我其实', '我一直', '我在意', '我在乎', '我想让你', '我怕你', '能不能多', '我希望'],
  avoid: ['不想说', '不愿意说', '算了', '不聊', '跳过', '没什么好说', '说不上来', '不知道说什么', '别问了', '换个话题', '不太好说'],
  attack: ['你根本', '没用', '你懂什么', '凭什么', '烦死', '你到底', '有什么用', '都是你', '你不懂', '你也就'],
  appease: ['对不起', '是我不好', '我是不是', '麻烦你', '你别生气', '我尽量', '都可以', '听你的', '不好意思', '我是不是太'],
};

/** 填充词. */
const FILLERS: readonly string[] = ['嗯', '呃', '那个', '然后', '其实', '就是'];

/** 探索类策略 (内核口径). */
const EXPLORATION_STRATEGIES: readonly string[] = ['affective_exploration', 'cognitive_exploration'];

/** 表层策略 (停在这里 = 深度不动). */
const SURFACE_STRATEGIES: readonly string[] = ['recounting', 'resistance', 'simple_response'];

/** 危机档位 (与 practice-runner 的 CRISIS_LEVEL_BY_CATEGORY 同口径, 只取本脚本需要的). */
const CRISIS_LEVEL: Readonly<Record<string, number>> = {
  suicide_exploration: 0,
  passive_ideation: 1,
  active_ideation: 2,
  self_harm_ideation: 2,
  suicide_plan: 3,
  suicide_preparation: 3,
  suicide_attempt: 3,
  self_harm_behavior: 3,
  aggression_others: 3,
  aggression_self: 3,
};

/**
 * 依恋风格 → 期望的**主导行为标签**.
 *
 * ⚠️ 这是 v1 的工程假设, 需临床复核. 依据是依恋理论里各风格在会谈中的典型行为:
 *   secure        —— 能直接表达需求与感受 (approach)
 *   anxious       —— 反复求证、怕被抛弃, 倾向讨好与争取 (appease)
 *   avoidant      —— 拉开距离、回避情感细节 (avoid)
 *   disorganized  —— 接近与攻击交替, 主导标签取 attack (v1 简化, 真正的特征是**振荡**, 见 oscillating 指标)
 */
const EXPECTED_LABEL: Readonly<Record<AttachmentStyle, BehaviorLabel>> = {
  secure: 'approach',
  anxious: 'appease',
  avoidant: 'avoid',
  disorganized: 'attack',
  unknown: 'neutral',
};

/**
 * 读逐字稿目录.
 *
 * @param dir 目录
 * @returns 文件名 → 内容
 */
function loadTranscripts(dir: string): Map<string, TranscriptFile> {
  const out = new Map<string, TranscriptFile>();
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith('.json')) continue;
    try {
      out.set(name.replace(/\.json$/, ''), JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8')) as TranscriptFile);
    } catch {
      // 单个坏文件不影响整体 (归档里有历史残缺件).
    }
  }
  return out;
}

/**
 * 从 DB 取角色依恋风格.
 *
 * @returns slug → attachmentStyle (取不到时返回空表, 由 slug 兜底推断)
 */
async function loadAttachmentStyles(): Promise<Map<string, AttachmentStyle>> {
  const out = new Map<string, AttachmentStyle>();
  let conn: mysql.Connection | null = null;
  try {
    conn = await mysql.createConnection({
      host: process.env['DB_HOST'],
      port: Number(process.env['DB_PORT']),
      user: process.env['DB_USER'],
      password: process.env['DB_PASSWORD'],
      database: process.env['DB_NAME'],
    });
    const [rows] = await conn.execute('SELECT template_id, attachment_style FROM character_profiles');
    for (const row of rows as Array<{ template_id: string; attachment_style: string }>) {
      out.set(row.template_id, row.attachment_style as AttachmentStyle);
    }
  } catch (error) {
    console.warn(`[warn] 取角色依恋风格失败, 退回 slug 推断: ${String((error as Error).message ?? error)}`);
  } finally {
    await conn?.end();
  }
  return out;
}

/** slug 兜底推断依恋风格 (措辞里带风格时用, 否则 unknown). */
function attachmentFromSlug(slug: string): AttachmentStyle {
  if (slug.includes('avoidant') || slug.includes('avoidance')) return 'avoidant';
  if (slug.includes('anxious')) return 'anxious';
  if (slug.includes('disorganized')) return 'disorganized';
  if (slug.includes('secure')) return 'secure';
  return 'unknown';
}

/** 去空白与标点, 便于做字符 n-gram 与唯一性统计. */
function normalize(text: string): string {
  return text.replaceAll(/\s+/g, '').replaceAll(/[，。！？、,.!?；;：:"“”'‘’()（）…—-]/g, '');
}

/** 取字符 n-gram 集合. */
function gramSet(text: string, n: number): Set<string> {
  const compact = normalize(text);
  const grams = new Set<string>();
  if (compact.length === 0) return grams;
  if (compact.length < n) {
    grams.add(compact);
    return grams;
  }
  for (let i = 0; i + n <= compact.length; i += 1) grams.add(compact.slice(i, i + n));
  return grams;
}

/** 两个集合的 Jaccard. */
function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const item of a) if (b.has(item)) shared += 1;
  return shared / (a.size + b.size - shared);
}

/** 给一句台词打行为标签. */
function labelOf(text: string): BehaviorLabel {
  let best: BehaviorLabel = 'neutral';
  let bestScore = 0;
  for (const [label, keywords] of Object.entries(LABEL_LEXICON)) {
    let hits = 0;
    for (const keyword of keywords) if (text.includes(keyword)) hits += 1;
    if (hits > bestScore) {
      bestScore = hits;
      best = label as BehaviorLabel;
    }
  }
  return best;
}

/** 统计主导标签 —— 只在**有标签**的轮次上算.
 *
 * 为什么不能直接取"票数最多的标签": 绝大多数台词不带任何行为标记词,
 * 中性会以压倒性票数胜出, 于是每个角色都变成 neutral —— 那不是角色没特征,
 * 是分母错了. 一轮都打不上标签时返回 neutral 并在输出里标明覆盖率.
 *
 * @param counts 标签分布
 * @returns 主导标签
 */
function dominantLabelOf(counts: Record<BehaviorLabel, number>): BehaviorLabel {
  const order: BehaviorLabel[] = ['avoid', 'attack', 'appease', 'approach'];
  let best: BehaviorLabel = 'neutral';
  let bestCount = 0;
  for (const label of order) {
    if (counts[label] > bestCount) {
      bestCount = counts[label];
      best = label;
    }
  }
  return best;
}

/** 审一场. */
function auditSession(debugSessionId: string, doc: TranscriptFile, style: AttachmentStyle): SessionAudit | null {
  const messages = doc.messages ?? [];
  const traces = doc.traces ?? [];
  const visits = messages.filter((m) => m.role === 'visitor');
  if (visits.length === 0) return null;

  const strategyByTurn = new Map<number, string>();
  let degradedTurns = 0;
  let crisisTurns = 0;
  let crisisFirstTurn: number | null = null;
  let crisisPeakLevel = 0;
  for (const trace of traces) {
    if (!trace) continue;
    const turnIndex = trace.turnIndex ?? 0;
    if (trace.intention?.strategy) strategyByTurn.set(turnIndex, trace.intention.strategy);
    if (trace.degraded) degradedTurns += 1;
    if (trace.crisis?.detected) {
      crisisTurns += 1;
      if (crisisFirstTurn === null) crisisFirstTurn = turnIndex;
      crisisPeakLevel = Math.max(crisisPeakLevel, CRISIS_LEVEL[trace.crisis.category ?? ''] ?? 1);
    }
  }

  const strategies: string[] = [];
  for (let i = 1; i <= visits.length; i += 1) {
    strategies.push(strategyByTurn.get(i) ?? 'unknown');
  }
  const strategyCounts: Record<string, number> = {};
  for (const s of strategies) strategyCounts[s] = (strategyCounts[s] ?? 0) + 1;

  const firstExplorationTurn = strategies.findIndex((s) => EXPLORATION_STRATEGIES.includes(s));
  const tail = strategies.slice(-3);
  const tailStuck = tail.length > 0 && tail.every((s) => SURFACE_STRATEGIES.includes(s));
  // 前 2 轮就进入**情感**探索 = 提前泄露 (叙事节奏应有铺垫).
  const earlyDisclosure = strategies.slice(0, 2).includes('affective_exploration');

  const labelCounts: Record<BehaviorLabel, number> = { approach: 0, avoid: 0, attack: 0, appease: 0, neutral: 0 };
  let fillerHits = 0;
  const texts = visits.map((m) => String(m.text ?? ''));
  for (const text of texts) {
    labelCounts[labelOf(text)] += 1;
    for (const filler of FILLERS) fillerHits += text.split(filler).length - 1;
  }

  const uniqueTexts = new Set(texts.map((t) => normalize(t))).size;
  const repeatRate = 1 - uniqueTexts / texts.length;

  const heads = new Set<string>();
  for (const text of texts) heads.add(normalize(text).slice(0, 4));
  // 句间相似度: 本场不同句子两两的 3-gram Jaccard 均值 ——
  //   直接衡量"这些话是不是同一个模子倒出来的".
  const textGrams = texts.map((t) => gramSet(t, 3));
  let pairSum = 0;
  let pairCount = 0;
  for (let i = 0; i < textGrams.length; i += 1) {
    for (let j = i + 1; j < textGrams.length; j += 1) {
      pairSum += jaccard(textGrams[i], textGrams[j]);
      pairCount += 1;
    }
  }
  const trigramRepeatRate = pairCount > 0 ? pairSum / pairCount : 0;

  const snapshot = doc.kernelState?.snapshot;
  const labeledTurns = (['approach', 'avoid', 'attack', 'appease'] as BehaviorLabel[]).reduce(
    (sum, label) => sum + labelCounts[label],
    0,
  );

  return {
    debugSessionId,
    characterSlug: doc.characterSlug ?? '',
    attachmentStyle: style,
    turns: visits.length,
    degradedTurns,
    strategyCounts,
    firstExplorationTurn: firstExplorationTurn >= 0 ? firstExplorationTurn + 1 : null,
    tailStuck,
    earlyDisclosure,
    labelCounts,
    labeledTurns,
    dominantLabel: dominantLabelOf(labelCounts),
    endTrust: snapshot?.trust ?? 0,
    endSafety: snapshot?.safety ?? 0,
    endBond: snapshot?.bond ?? 0,
    resistanceDepth: snapshot?.resistance?.depth ?? 0,
    resistanceVerbal: snapshot?.resistance?.verbal ?? 0,
    repeatRate,
    trigramRepeatRate,
    headTemplateRate: texts.length > 0 ? 1 - heads.size / texts.length : 0,
    fillerPerTurn: texts.length > 0 ? fillerHits / texts.length : 0,
    crisisTurns,
    crisisFirstTurn,
    crisisPeakLevel,
  };
}

/** 打印表格用的定宽. */
function pct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const dirIndex = argv.indexOf('--dir');
  const dir = dirIndex >= 0 ? argv[dirIndex + 1] : 'data/debug-sessions';
  const anchorIndex = argv.indexOf('--anchor');

  if (!fs.existsSync(dir)) {
    console.error(`目录不存在: ${dir}`);
    process.exitCode = 1;
    return;
  }

  const styles = await loadAttachmentStyles();
  const transcripts = loadTranscripts(dir);
  const audits: SessionAudit[] = [];
  for (const [id, doc] of transcripts) {
    const slug = doc.characterSlug ?? '';
    const style = styles.get(slug) ?? attachmentFromSlug(slug);
    const audit = auditSession(id, doc, style);
    if (audit) audits.push(audit);
  }

  console.log('\n=== 来访者质量评测 v1 ===');
  console.log(`目录 ${dir}`);
  console.log(`逐字稿 ${transcripts.size} 份 / 可审 ${audits.length} 场`);

  // ── 数据有效性门禁: 渲染降级的场次不能进质量统计 ─────────────────────────
  const valid = audits.filter((a) => a.degradedTurns === 0);
  console.log(`有效场次(无渲染降级) ${valid.length} / 降级场次 ${audits.length - valid.length}`);

  // ── D1 深度推进 ─────────────────────────────────────────────────────────
  const explored = valid.filter((a) => a.firstExplorationTurn !== null);
  const firstTurns = explored.map((a) => a.firstExplorationTurn as number);
  const tailStuckCount = valid.filter((a) => a.tailStuck).length;
  const strategyTotals: Record<string, number> = {};
  for (const a of valid) for (const [s, c] of Object.entries(a.strategyCounts)) strategyTotals[s] = (strategyTotals[s] ?? 0) + c;
  const strategyTurnTotal = Object.values(strategyTotals).reduce((x, y) => x + y, 0);
  console.log('\n[D1] 披露轨迹 / 深度推进');
  console.log(`  进入过探索的场次      ${explored.length}/${valid.length}  ${pct(valid.length ? explored.length / valid.length : 0)}`);
  console.log(`  首次探索轮次 中位/均值 ${median(firstTurns)} / ${mean(firstTurns).toFixed(1)}`);
  console.log(`  末 3 轮仍停在表层的场次 ${tailStuckCount}/${valid.length}  ${pct(valid.length ? tailStuckCount / valid.length : 0)}`);
  console.log(`  前 2 轮即情感探索(提前泄露) ${valid.filter((a) => a.earlyDisclosure).length} 场`);
  console.log('  内核策略占比:');
  for (const [s, c] of Object.entries(strategyTotals).sort((x, y) => y[1] - x[1])) {
    console.log(`    ${s.padEnd(22)} ${String(c).padStart(4)}  ${pct(strategyTurnTotal ? c / strategyTurnTotal : 0)}`);
  }

  // ── D2 依恋一致性 ────────────────────────────────────────────────────────
  console.log('\n[D2] 依恋一致性 (角色没有"演成另一种人", 有两条独立证据)');
  console.log('  (a) 内核侧: 各角色的阻抗 / 探索 / 终局信任, 风格之间应该拉得开');
  const byCharacter = new Map<string, SessionAudit[]>();
  for (const a of valid) {
    const list = byCharacter.get(a.characterSlug) ?? [];
    list.push(a);
    byCharacter.set(a.characterSlug, list);
  }
  for (const [slug, list] of [...byCharacter].sort((x, y) => y[1].length - x[1].length)) {
    const style = list[0].attachmentStyle;
    const turns = list.reduce((sum, a) => sum + a.turns, 0);
    const resistance = list.reduce((sum, a) => sum + (a.strategyCounts['resistance'] ?? 0), 0);
    const exploration = list.reduce(
      (sum, a) => sum + (a.strategyCounts['affective_exploration'] ?? 0) + (a.strategyCounts['cognitive_exploration'] ?? 0),
      0,
    );
    console.log(
      `  ${slug.padEnd(44)} ${style.padEnd(12)} 场次 ${String(list.length).padStart(2)}` +
        `  阻抗 ${pct(turns ? resistance / turns : 0)}  探索 ${pct(turns ? exploration / turns : 0)}` +
        `  trust ${mean(list.map((a) => a.endTrust)).toFixed(2)}` +
        `  depth ${mean(list.map((a) => a.resistanceDepth)).toFixed(2)}`,
    );
  }

  // (b) 文本侧: 词表能不能把行为打出来 —— 先报覆盖率, 覆盖率低就是词表不可用, 不是角色没特征.
  const labeledRate = valid.length > 0 ? valid.reduce((s, a) => s + a.labeledTurns, 0) / valid.reduce((s, a) => s + a.turns, 0) : 0;
  console.log(`  (b) 文本侧: 能打上行为标签的轮次占比 ${pct(labeledRate)}  (词表是工程种子值, 覆盖率低就该重做词表)`);
  if (labeledRate >= 0.3) {
    let matchSessions = 0;
    for (const [, list] of byCharacter) {
      const expected = EXPECTED_LABEL[list[0].attachmentStyle];
      matchSessions += list.filter((a) => a.dominantLabel === expected).length;
    }
    console.log(`      主导标签命中率 ${matchSessions}/${valid.length}  ${pct(valid.length ? matchSessions / valid.length : 0)}  (门禁 ≥70%)`);
  } else {
    console.log('      → 覆盖率不足 30%, 命中率**不计算**(算出来也是噪声), 需先扩词表或改用内核信号定判据');
  }

  // ── D3 角色可分辨度 (先报随机基线, 且必须是真留一法) ──────────────────────
  console.log('\n[D3] 角色可分辨度 (文本 3-gram 最近质心分类)');
  const characterCount = byCharacter.size;
  console.log(`  参与角色 ${characterCount} 个 → 随机基线 ${pct(characterCount ? 1 / characterCount : 0)}`);
  if (characterCount >= 2) {
    // 每场先算自己的 3-gram 集合, 再给每个角色算"去掉该场之后"的质心 —— 真留一法.
    //   不排除自身样本的话, 质心必然包含被测场, Jaccard 偏高, 结果虚高到 100%.
    const ownGrams = new Map<string, Set<string>>();
    for (const a of valid) {
      const doc = transcripts.get(a.debugSessionId);
      const set = new Set<string>();
      for (const m of doc?.messages ?? []) {
        if (m.role === 'visitor') for (const gram of gramSet(String(m.text ?? ''), 3)) set.add(gram);
      }
      ownGrams.set(a.debugSessionId, set);
    }
    let correct = 0;
    let total = 0;
    for (const [slug, list] of byCharacter) {
      for (const a of list) {
        let bestSlug = '';
        let bestScore = -1;
        for (const [candidate, candidateList] of byCharacter) {
          const centroid = new Set<string>();
          for (const other of candidateList) {
            if (other.debugSessionId === a.debugSessionId) continue; // ← 留一
            for (const gram of ownGrams.get(other.debugSessionId) ?? []) centroid.add(gram);
          }
          const score = jaccard(ownGrams.get(a.debugSessionId) ?? new Set(), centroid);
          if (score > bestScore) {
            bestScore = score;
            bestSlug = candidate;
          }
        }
        if (bestSlug === slug) correct += 1;
        total += 1;
      }
    }
    console.log(`  分类命中 ${correct}/${total}  ${pct(total ? correct / total : 0)}  (随机基线 ${pct(characterCount ? 1 / characterCount : 0)})`);
  }

  // ── D4 口癖与句式重复 ────────────────────────────────────────────────────
  console.log('\n[D4] 口癖与句式重复');
  console.log(`  台词重复率 (与全场均值)    ${pct(mean(valid.map((a) => a.repeatRate)))}`);
  console.log(`  句间 3-gram 相似 均值     ${pct(mean(valid.map((a) => a.trigramRepeatRate)))}   (门禁 <15%)`);
  console.log(`  首句模板率 均值           ${pct(mean(valid.map((a) => a.headTemplateRate)))}`);
  console.log(`  填充词/轮 均值            ${mean(valid.map((a) => a.fillerPerTurn)).toFixed(2)}`);
  const worst = [...valid].sort((x, y) => y.trigramRepeatRate - x.trigramRepeatRate).slice(0, 3);
  for (const a of worst) console.log(`    最像自己的 3 场: ${a.debugSessionId} ${pct(a.trigramRepeatRate)}`);

  // ── D5 危机表达分布 ──────────────────────────────────────────────────────
  const crisisSessions = valid.filter((a) => a.crisisTurns > 0);
  console.log('\n[D5] 危机表达分布');
  console.log(`  出现危机的场次 ${crisisSessions.length}/${valid.length}  ${pct(valid.length ? crisisSessions.length / valid.length : 0)}`);
  if (crisisSessions.length > 0) {
    console.log(`  首现轮次 ${crisisSessions.map((a) => a.crisisFirstTurn).join(', ')}`);
    console.log(`  最高档位 ${crisisSessions.map((a) => a.crisisPeakLevel).join(', ')}`);
    console.log(`  单次披露(只 1 轮就没了) ${crisisSessions.filter((a) => a.crisisTurns === 1).length}/${crisisSessions.length}`);
  }

  // ── D6 人工锚: 导出标注清单 (不含任何台词) ──────────────────────────────
  if (anchorIndex >= 0) {
    const size = Number(argv[anchorIndex + 1] ?? 30);
    const outDir = path.resolve('data/quality');
    fs.mkdirSync(outDir, { recursive: true });
    const sample = [...valid].sort((x, y) => y.turns - x.turns).slice(0, size);
    const csv = ['debug_session_id,character_slug,attachment_style,turns,first_exploration_turn,dominant_label,crisis_peak_level'];
    for (const a of sample) {
      csv.push(
        `${a.debugSessionId},${a.characterSlug},${a.attachmentStyle},${a.turns},${a.firstExplorationTurn ?? ''},${a.dominantLabel},${a.crisisPeakLevel}`,
      );
    }
    const file = path.join(outDir, `anchor-sample-${sample.length}.csv`);
    fs.writeFileSync(file, `${csv.join('\n')}\n`, 'utf8');
    console.log(`\n[D6] 人工锚标注清单已导出: ${file}（只含 id 与维度, 台词请按 id 到逐字稿目录自行调阅）`);
  }
  console.log('');
}

/** 中位数. */
function median(values: number[]): number | string {
  if (values.length === 0) return 'n/a';
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? ((sorted[mid - 1] + sorted[mid]) / 2).toFixed(1) : String(sorted[mid]);
}

/** 均值. */
function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((x, y) => x + y, 0) / values.length;
}

await main();
