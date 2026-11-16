// V2026-11-13 建立 (G-4 · 规则轨词表子串重叠量级离线取证 · CLI 编排):
//   职责: 静态穷举规则轨词表的跨规则 / 同规则子串包含对 → 归档逐轮投影
//         → 重叠对轮 / 其他多事件轮 / 单事件轮 分组频次 → 增量群体量级对照
//         → 打印取证表 (stdout) + 可选写同构 Markdown 报告.
//
//   ⚠️ **边界** (任务单 §1.2.1 / §1.2.5):
//     只出**证据与量级对照** —— 不实现消歧 (词表改词 / 分类器互斥 / 最长匹配均不做),
//     不改词表, 不改分类器, 不动 D-1 基线快照 spec (§2.4 护栏).
//
//   ⚠️ **真相源**:
//     词表: src/engine-core/domain/events/event-lexicon.ts (EVENT_LEXICON)
//       —— 本脚本**内置一份静态声明** (任务单 §3.1 允许) 并在运行期**读真相源文件逐条比对**,
//          漂移即报错退出, 不静默用旧副本.
//     delta 种子: src/engine-core/cognition/state-transition.ts DELTA_TABLE
//       (empathy :199-214 / acceptance :215-230 / open_probe :247-262)
//       —— **仅作静态参照打印** (§3.4), **绝不参与任何归档数据的计算**.
//
//   ⚠️ **隐私红线** (AGENTS.md §5.4):
//     · 不读 messages[].text (归档含来访者台词原文) / kernelState / renderSpec / deliberationTrace;
//     · 不输出单场会话 id, 不回放归档侧命中词;
//     · 只出角色 slug·label、批次目录名、轮次、事件 kind、计数、比率与向量分量数值.
//     · 静态词表词条本身属公开种子常量 (表 0 需要), 与归档侧命中回放无关.
//
//   ⚠️ **口径纪律** (任务单 §3.3):
//     做**群体分布对照**, **不做逐事件精确分量分解** —— 归档 delta 经角色倍率 / 人格调制 /
//     capTurnDelta 折损 / 时序权重处理, 脚本不反推单事件分量, 也不把种子向量乘进归档数据.
//
//   用法 (pnpm, 禁裸 npx):
//     pnpm exec tsx scripts/ops/quality/g4-lexicon-substring-overlap-evidence.ts
//     pnpm exec tsx scripts/ops/quality/g4-lexicon-substring-overlap-evidence.ts --dir data/archives
//     pnpm exec tsx scripts/ops/quality/g4-lexicon-substring-overlap-evidence.ts --out data/quality/g4-lexicon-substring-overlap-evidence.md
//     pnpm exec tsx scripts/ops/quality/g4-lexicon-substring-overlap-evidence.ts --lineage data/batch-reports/xxx.json
//     pnpm exec tsx scripts/ops/quality/g4-lexicon-substring-overlap-evidence.ts --min-samples 20

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** 一条规则 (与 core EventRule 同构, 仅取 kind + terms). */
interface StaticRule {
  readonly kind: string;
  readonly terms: readonly string[];
}

/** 归档 trace 的最小投影 (只取本单要用的字段). */
interface ArchiveTrace {
  readonly turnIndex?: number;
  readonly characterSlug?: string;
  readonly eventTags?: readonly string[];
  readonly eventTagLabels?: readonly string[];
  readonly delta?: DeltaVector | null;
  readonly deltaDetail?: { readonly events?: readonly string[] } | null;
  readonly degraded?: boolean;
}

/** 归档会话顶层 (最小投影). */
interface ArchiveSession {
  readonly id?: string;
  readonly characterSlug?: string;
  readonly characterLabel?: string;
  readonly turnCount?: number;
  readonly traces?: readonly ArchiveTrace[];
}

/** delta 向量 (11 维, 真相源 state-transition.ts DeltaVector). */
interface DeltaVector {
  readonly trust?: number;
  readonly safety?: number;
  readonly bond?: number;
  readonly valence?: number;
  readonly arousal?: number;
  readonly verbal?: number;
  readonly depth?: number;
  readonly style?: number;
  readonly positive?: number;
  readonly negative?: number;
  readonly dependency?: number;
}

/** 归因分组 (互斥). */
type GroupKey =
  'overlap_pair' | 'other_multi' | 'single_empathy' | 'single_open_probe' | 'single_acceptance' | 'single_other' | 'neutral' | 'no_tag';

/** 一组样本的分布描述. */
interface Stats {
  readonly n: number;
  readonly min: number;
  readonly p25: number;
  readonly median: number;
  readonly p75: number;
  readonly max: number;
  readonly sum: number;
}

/** 逐轮投影后的一条归档事实 (不含任何原文). */
interface ProjectedTurn {
  readonly dir: string;
  readonly slug: string;
  readonly label: string;
  readonly turnIndex: number;
  readonly tags: readonly string[];
  readonly group: GroupKey;
  readonly degraded: boolean;
  readonly modeId: string;
  readonly delta: DeltaVector | null;
}

/** 命令行参数. */
interface Options {
  readonly dir: string;
  readonly out: string | null;
  readonly lineage: string | null;
  readonly minSamples: number;
}

/** 规则轨词表静态声明 (真相源: src/engine-core/domain/events/event-lexicon.ts EVENT_LEXICON).
 *  运行期会读真相源文件逐条比对 (§3.1); 漂移即报错退出. */
const LEXICON: readonly StaticRule[] = [
  {
    kind: 'empathy',
    terms: ['听起来你', '你觉得', '这种感受', '你现在一定', '我能理解你', '是不是觉得', '你当时感到', '这种情绪', '我理解你的'],
  },
  {
    kind: 'acceptance',
    terms: ['没关系', '我不评判', '不会评判你', '你愿意说出来', '不怪你', '我接纳', '在这里是安全的'],
  },
  {
    kind: 'normalization',
    terms: ['很多人都会', '这很正常', '这不奇怪', '换作别人', '通常都会', '一般人也会', '这种情况很常见'],
  },
  {
    kind: 'open_probe',
    terms: ['能多说一点', '当时发生了什么', '你怎么看', '能详细说说', '再讲讲', '你觉得呢', '举个例子', '能具体说说'],
  },
  {
    kind: 'affirmation',
    terms: ['你做得已经很好', '你很勇敢', '这是你的进步', '你已经很努力', '做得不错', '你很棒', '这很不容易'],
  },
  {
    kind: 'judgment',
    terms: ['你不该', '你就是太敏感', '这是你自己想多了', '你根本不', '太矫情', '你这是错', '你就是想不开'],
  },
  {
    kind: 'preaching',
    terms: ['你应该', '听我的建议', '你要学会', '我建议你', '你必须', '照我说的做', '你得', '你需要改变'],
  },
  {
    kind: 'minimizing',
    terms: ['别想太多', '没什么大不了', '至于吗', '这不算什么', '小题大做', '没那么严重', '别放在心上'],
  },
  {
    kind: 'boundary_cross',
    terms: ['私下联系', '加我微信', '我们私下', '我也有类似', '下班后找我', '跟你做朋友', '留个联系方式'],
  },
];

/** 静态种子参照 (真相源: state-transition.ts DELTA_TABLE).
 *  ⚠️ **仅作静态参照打印** (§3.4): 不含角色倍率 / 人格调制 / cap 折损 / 时序权重.
 *  ⚠️ **绝不参与归档数据计算** —— 归档侧一切数值都取自 trace.delta 原值. */
const SEED_REFERENCE: Readonly<Record<string, DeltaVector>> = {
  empathy: {
    trust: 0.1,
    safety: 0.02,
    bond: 0.01,
    verbal: -0.03,
    depth: -0.02,
    style: -0.01,
    valence: 0.03,
    arousal: -0.02,
    positive: 0.03,
    negative: 0,
    dependency: 0,
  },
  acceptance: {
    trust: 0.08,
    safety: 0.02,
    bond: 0.01,
    verbal: -0.02,
    depth: -0.02,
    style: -0.01,
    valence: 0.03,
    arousal: -0.02,
    positive: 0.02,
    negative: 0,
    dependency: 0,
  },
  open_probe: {
    trust: 0.05,
    safety: 0.01,
    bond: 0,
    verbal: -0.02,
    depth: -0.03,
    style: -0.015,
    valence: 0.02,
    arousal: 0.02,
    positive: 0,
    negative: 0,
    dependency: 0,
  },
};

/** delta 的 11 个维度 (展示顺序 = 核心 DeltaVector 顺序). */
const DELTA_DIMS = [
  'trust',
  'safety',
  'bond',
  'valence',
  'arousal',
  'verbal',
  'depth',
  'style',
  'positive',
  'negative',
  'dependency',
] as const;
type DeltaDim = (typeof DELTA_DIMS)[number];

/** 同盟三维 + 阻抗维 (本单主看量级). */
const CORE_DIMS: readonly DeltaDim[] = ['trust', 'safety', 'bond', 'verbal', 'depth', 'style'];
/** 其余维度 (并列展示). */
const OTHER_DIMS: readonly DeltaDim[] = ['valence', 'arousal', 'positive', 'negative', 'dependency'];

/** 分组展示名. */
const GROUP_LABEL: Readonly<Record<GroupKey, string>> = {
  overlap_pair: '重叠对轮 (empathy+open_probe)',
  other_multi: '其他多事件轮 (非重叠所致)',
  single_empathy: '单事件轮 · empathy',
  single_open_probe: '单事件轮 · open_probe',
  single_acceptance: '单事件轮 · acceptance',
  single_other: '单事件轮 · 其他 kind',
  neutral: 'neutral 单事件轮',
  no_tag: '无 eventTags 轮',
};

/** 分组展示顺序. */
const GROUP_ORDER: readonly GroupKey[] = [
  'overlap_pair',
  'other_multi',
  'single_empathy',
  'single_open_probe',
  'single_acceptance',
  'single_other',
  'neutral',
  'no_tag',
];
/** 词表真相源文件路径 (只读比对用, 不 import). **按脚本自身位置解析**, 与 cwd 无关. */
const LEXICON_SOURCE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../src/engine-core/domain/events/event-lexicon.ts',
);

/** 目录树哈希结果. */
interface TreeHash {
  readonly files: number;
  readonly bytes: number;
  readonly sha256: string;
}

/** 扫描结果. */
interface ScanResult {
  readonly turns: readonly ProjectedTurn[];
  readonly files: number;
  readonly sessions: number;
  readonly skippedNonJson: number;
  readonly skippedParseFailed: number;
  readonly skippedNoRole: number;
  readonly skippedNoTraces: number;
  readonly looseRootFiles: number;
  readonly deltaMissing: number;
}

/** 命令行参数解析. */
function parseOptions(argv: readonly string[]): Options {
  const read = (flag: string, fallback: string): string => {
    const index = argv.indexOf(flag);
    return index === -1 ? fallback : (argv[index + 1] ?? fallback);
  };
  const size = Number(read('--min-samples', '20'));
  const out = argv.includes('--out') ? read('--out', '') : null;
  const lineage = argv.includes('--lineage') ? read('--lineage', '') : null;
  return {
    dir: read('--dir', 'data/archives'),
    out: out === null || out === '' ? null : out,
    lineage: lineage === null || lineage === '' ? null : lineage,
    minSamples: Number.isFinite(size) && size > 0 ? size : 20,
  };
}

/** 读真相源词表文件并解析成 kind + terms (纯文本解析, 不 import src/**). */
function readSourceLexicon(filePath: string): StaticRule[] {
  const text = fs.readFileSync(filePath, 'utf8');
  const out: StaticRule[] = [];
  const ruleRe = /kind:\s*'([a-z_]+)'\s*,\s*terms:\s*\[([^\]]*)\]/g;
  let match: RegExpExecArray | null = ruleRe.exec(text);
  while (match !== null) {
    const terms: string[] = [];
    const termRe = /'([^']*)'/g;
    let termMatch: RegExpExecArray | null = termRe.exec(match[2] ?? '');
    while (termMatch !== null) {
      terms.push(termMatch[1] ?? '');
      termMatch = termRe.exec(match[2] ?? '');
    }
    out.push({ kind: match[1] ?? '', terms });
    match = ruleRe.exec(text);
  }
  return out;
}

/** 内置静态词表 vs 真相源逐条比对 (漂移清单; 空 = 一致). */
function diffLexicon(builtin: readonly StaticRule[], source: readonly StaticRule[]): string[] {
  const issues: string[] = [];
  if (builtin.length !== source.length) {
    issues.push(`规则条数不一致: 内置 ${builtin.length} / 真相源 ${source.length}`);
  }
  const sourceByKind = new Map(source.map((rule) => [rule.kind, rule]));
  for (const rule of builtin) {
    const found = sourceByKind.get(rule.kind);
    if (!found) {
      issues.push(`内置多出规则: ${rule.kind}`);
      continue;
    }
    const missing = rule.terms.filter((term) => !found.terms.includes(term));
    const extra = found.terms.filter((term) => !rule.terms.includes(term));
    if (missing.length > 0) issues.push(`${rule.kind} 内置缺词条: ${missing.join(' / ')}`);
    if (extra.length > 0) issues.push(`${rule.kind} 内置多词条: ${extra.join(' / ')}`);
  }
  return issues;
}

/** 子串包含对 (外层 = 较长词条, 内层 = 子串). */
interface SubstringPair {
  readonly scope: 'cross_rule' | 'same_rule';
  readonly outerKind: string;
  readonly outerTerm: string;
  readonly innerKind: string;
  readonly innerTerm: string;
}

/** 穷举全部子串包含对 (跨规则 + 同规则). */
function enumerateSubstringPairs(lexicon: readonly StaticRule[]): SubstringPair[] {
  const pairs: SubstringPair[] = [];
  for (const outer of lexicon) {
    for (const outerTerm of outer.terms) {
      for (const inner of lexicon) {
        for (const innerTerm of inner.terms) {
          if (innerTerm.length >= outerTerm.length) continue;
          if (!outerTerm.includes(innerTerm)) continue;
          pairs.push({
            scope: outer.kind === inner.kind ? 'same_rule' : 'cross_rule',
            outerKind: outer.kind,
            outerTerm,
            innerKind: inner.kind,
            innerTerm,
          });
        }
      }
    }
  }
  return pairs;
}

/** 分位数 (线性插值). */
function quantile(sorted: readonly number[], q: number): number {
  if (sorted.length === 0) return Number.NaN;
  if (sorted.length === 1) return sorted[0]!;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  const a = sorted[lo]!;
  const b = sorted[hi]!;
  return a + (b - a) * (pos - lo);
}

/** 分布描述. */
function describe(values: readonly number[]): Stats {
  const sorted = [...values].toSorted((left, right) => left - right);
  const sum = sorted.reduce((acc, value) => acc + value, 0);
  return {
    n: sorted.length,
    min: sorted[0] ?? Number.NaN,
    p25: quantile(sorted, 0.25),
    median: quantile(sorted, 0.5),
    p75: quantile(sorted, 0.75),
    max: sorted[sorted.length - 1] ?? Number.NaN,
    sum,
  };
}

/** 归因分组 (互斥). */
function classifyGroup(tags: readonly string[]): GroupKey {
  if (tags.length === 0) return 'no_tag';
  if (tags.length === 1) {
    const only = tags[0]!;
    if (only === 'empathy') return 'single_empathy';
    if (only === 'open_probe') return 'single_open_probe';
    if (only === 'acceptance') return 'single_acceptance';
    if (only === 'neutral') return 'neutral';
    return 'single_other';
  }
  if (tags.includes('empathy') && tags.includes('open_probe')) return 'overlap_pair';
  return 'other_multi';
}

/** 读血缘文件 (批次报告 / 批次快照两种形状都认) → debugSessionId → counselorModeId. */
function loadLineage(filePath: string): Map<string, string> {
  const map = new Map<string, string>();
  if (!fs.existsSync(filePath)) return map;
  const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8')) as {
    readonly lineage?: readonly { readonly debugSessionId?: string; readonly counselorModeId?: string }[];
    readonly sessions?: readonly { readonly debugSessionId?: string; readonly counselorModeId?: string }[];
  };
  for (const row of parsed.lineage ?? []) {
    if (row.debugSessionId && row.counselorModeId) map.set(row.debugSessionId, row.counselorModeId);
  }
  for (const row of parsed.sessions ?? []) {
    if (row.debugSessionId && row.counselorModeId) map.set(row.debugSessionId, row.counselorModeId);
  }
  return map;
}

/** 目录树全清单哈希 (文件数 / 字节数 / SHA256). */
function hashTree(root: string): TreeHash {
  const files: string[] = [];
  const walk = (dir: string): void => {
    for (const name of fs.readdirSync(dir).toSorted()) {
      const full = path.join(dir, name);
      if (fs.statSync(full).isDirectory()) walk(full);
      else files.push(full);
    }
  };
  walk(root);
  let bytes = 0;
  const parts: string[] = [];
  for (const full of files.toSorted()) {
    const rel = path.relative(root, full).split(path.sep).join('/');
    const buffer = fs.readFileSync(full);
    bytes += buffer.length;
    parts.push(rel + ':' + buffer.length + ':' + crypto.createHash('sha256').update(buffer).digest('hex'));
  }
  return {
    files: files.length,
    bytes,
    sha256: crypto.createHash('sha256').update(parts.join('\n'), 'utf8').digest('hex'),
  };
}

/** 扫归档 (只读). */
function scanArchives(root: string, lineage: Map<string, string>): ScanResult {
  const turns: ProjectedTurn[] = [];
  let files = 0;
  let sessions = 0;
  let skippedNonJson = 0;
  let skippedParseFailed = 0;
  let skippedNoRole = 0;
  let skippedNoTraces = 0;
  let looseRootFiles = 0;
  let deltaMissing = 0;

  const scanFile = (dirLabel: string, filePath: string): void => {
    files += 1;
    let parsed: ArchiveSession;
    try {
      parsed = JSON.parse(fs.readFileSync(filePath, 'utf8')) as ArchiveSession;
    } catch {
      skippedParseFailed += 1;
      return;
    }
    const slug = typeof parsed.characterSlug === 'string' ? parsed.characterSlug : '';
    const label = typeof parsed.characterLabel === 'string' ? parsed.characterLabel : '';
    if (slug === '' || label === '') {
      skippedNoRole += 1;
      return;
    }
    const traces = parsed.traces;
    if (!Array.isArray(traces) || traces.length === 0) {
      skippedNoTraces += 1;
      return;
    }
    sessions += 1;
    const stem = path.basename(filePath, '.json');
    const sessionId = typeof parsed.id === 'string' ? parsed.id : '';
    const modeId = lineage.get(stem) ?? lineage.get(sessionId) ?? '';
    for (const trace of traces) {
      const tags = Array.isArray(trace.eventTags) ? trace.eventTags : [];
      const delta = trace.delta ?? null;
      if (delta === null) deltaMissing += 1;
      turns.push({
        dir: dirLabel,
        slug,
        label,
        turnIndex: typeof trace.turnIndex === 'number' ? trace.turnIndex : -1,
        tags: [...tags],
        group: classifyGroup(tags),
        degraded: trace.degraded === true,
        modeId,
        delta,
      });
    }
  };

  const entries = fs.readdirSync(root, { withFileTypes: true });
  const subDirs = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .toSorted();
  if (subDirs.length === 0) {
    const batchLabel = path.basename(root);
    for (const name of fs.readdirSync(root).toSorted()) {
      if (!name.endsWith('.json')) {
        skippedNonJson += 1;
        continue;
      }
      scanFile(batchLabel, path.join(root, name));
    }
  } else {
    for (const dir of subDirs) {
      const full = path.join(root, dir);
      for (const name of fs.readdirSync(full).toSorted()) {
        if (!name.endsWith('.json')) {
          skippedNonJson += 1;
          continue;
        }
        scanFile(dir, path.join(full, name));
      }
    }
    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith('.json')) looseRootFiles += 1;
    }
  }

  return { turns, files, sessions, skippedNonJson, skippedParseFailed, skippedNoRole, skippedNoTraces, looseRootFiles, deltaMissing };
}
/** 数值格式化 (4 位小数). */
function formatNumber(value: number): string {
  return Number.isFinite(value) ? value.toFixed(4) : 'n/a';
}

/** 百分比格式化. */
function formatPercent(part: number, total: number): string {
  if (total === 0) return 'n/a';
  return ((part / total) * 100).toFixed(4) + '%';
}

/** 分布单元格: 中位 [P25~P75]. */
function formatCell(stats: Stats | undefined): string {
  if (!stats || stats.n === 0) return 'n/a';
  return formatNumber(stats.median) + ' [' + formatNumber(stats.p25) + '~' + formatNumber(stats.p75) + ']';
}

/** 任意轮次集合的逐维分布. */
function computeStats(turns: readonly ProjectedTurn[]): ReadonlyMap<DeltaDim, Stats> {
  const dims = new Map<DeltaDim, Stats>();
  for (const dim of DELTA_DIMS) {
    const values: number[] = [];
    for (const turn of turns) {
      const value = turn.delta?.[dim];
      if (typeof value === 'number' && Number.isFinite(value)) values.push(value);
    }
    dims.set(dim, describe(values));
  }
  return dims;
}

/** 事件标签组合键 (排序后拼接). */
function comboKey(tags: readonly string[]): string {
  return tags.length === 0 ? '(无标签)' : [...tags].toSorted().join(' + ');
}

/** 报告渲染上下文. */
interface ReportInput {
  readonly options: Options;
  readonly sourceRuleCount: number;
  readonly pairs: readonly SubstringPair[];
  readonly scan: ScanResult;
  readonly hashBefore: TreeHash;
  readonly hashAfter: TreeHash;
  readonly lineageProvided: boolean;
  readonly lineageRows: number;
  readonly lineageHits: number;
}

/** 渲染取证报告 (stdout 与 --out 文件同构). */
function renderReport(input: ReportInput): string {
  const { options, scan, pairs } = input;
  const out: string[] = [];
  const total = scan.turns.length;
  const crossPairs = pairs.filter((pair) => pair.scope === 'cross_rule');
  const samePairs = pairs.filter((pair) => pair.scope === 'same_rule');

  const groupTurns = new Map<GroupKey, ProjectedTurn[]>();
  for (const key of GROUP_ORDER) groupTurns.set(key, []);
  for (const turn of scan.turns) groupTurns.get(turn.group)?.push(turn);
  const overlapTurns = groupTurns.get('overlap_pair') ?? [];
  const otherMultiTurns = groupTurns.get('other_multi') ?? [];
  const groupStats = new Map<GroupKey, ReadonlyMap<DeltaDim, Stats>>();
  for (const key of GROUP_ORDER) groupStats.set(key, computeStats(groupTurns.get(key) ?? []));
  const acceptanceEmpathyTurns = scan.turns.filter((turn) => turn.tags.includes('acceptance') && turn.tags.includes('empathy'));
  const acceptanceEmpathyStats = computeStats(acceptanceEmpathyTurns);

  out.push('# G-4 · 规则轨词表子串重叠量级离线取证（归档实测）');
  out.push('');
  out.push('> 脚本：`scripts/ops/quality/g4-lexicon-substring-overlap-evidence.ts`（只读复算 · 纯离线）');
  out.push('> 真相源：词表 `src/engine-core/domain/events/event-lexicon.ts` · delta 种子 `src/engine-core/cognition/state-transition.ts`');
  out.push('> 结论边界：**只出证据与量级对照**，不实现消歧、不改词表 / 分类器 / D-1 基线快照 spec（任务单 §1.2.1 / §1.2.5）。');
  out.push('');
  out.push('## 表 0 · 静态子串包含对穷举（§3.1）');
  out.push('');
  out.push(
    `- 真相源规则条数：**${input.sourceRuleCount}** · 内置静态声明条数：**${LEXICON.length}** · 运行期逐条比对：**一致**（漂移即报错退出）`,
  );
  out.push(`- 跨规则子串包含对：**${crossPairs.length}** 对 · 同规则子串包含对：**${samePairs.length}** 对`);
  out.push('');
  out.push('| 范围 | 外层词条（长） | 内层词条（子串） | 说明 |');
  out.push('| --- | --- | --- | --- |');
  for (const pair of pairs) {
    out.push(
      `| ${pair.scope} | ${pair.outerKind} · ${pair.outerTerm} | ${pair.innerKind} · ${pair.innerTerm} | 内层命中即自动命中外层 → 单轮双 kind 叠加 |`,
    );
  }
  if (pairs.length === 0) out.push('| — | — | — | 未穷举到任何子串包含对 |');
  out.push('');
  out.push('## 表 1 · 归档事件标签组合频次（全库）');
  out.push('');
  out.push('| 事件标签组合 | 轮数 | 占有效轮 |');
  out.push('| --- | --- | --- |');
  const comboCounts = new Map<string, number>();
  for (const turn of scan.turns) {
    const key = comboKey(turn.tags);
    comboCounts.set(key, (comboCounts.get(key) ?? 0) + 1);
  }
  for (const [key, count] of [...comboCounts.entries()].toSorted((left, right) => right[1] - left[1])) {
    out.push(`| ${key} | ${count} | ${formatPercent(count, total)} |`);
  }
  out.push('');
  out.push(`> 有效轮合计 **${total}**（场次 ${scan.sessions} · 文件 ${scan.files}）。`);
  out.push('');
  out.push('## 表 2 · 分组计数总览（互斥分组）');
  out.push('');
  out.push('| 分组 | 轮数 | 占有效轮 | 备注 |');
  out.push('| --- | --- | --- | --- |');
  const groupNotes: Readonly<Record<GroupKey, string>> = {
    overlap_pair: '**与子串重叠对口径一致的双命中轮**（empathy + open_probe 同时出现）',
    other_multi: '命中多个**互不构成子串**的规则 —— 属真实双事件，不计入重叠归因',
    single_empathy: '主对照组（重叠对比照基准）',
    single_open_probe: '次对照组（样本偏少）',
    single_acceptance: '频率最高的单事件 kind',
    single_other: '其余单 kind 轮',
    neutral: 'neutral 轮（delta 为 ZERO）',
    no_tag: 'eventTags 缺失轮',
  };
  for (const key of GROUP_ORDER) {
    const count = groupTurns.get(key)?.length ?? 0;
    out.push(`| ${GROUP_LABEL[key]} | ${count} | ${formatPercent(count, total)} | ${groupNotes[key]} |`);
  }
  out.push('');
  out.push('## 表 3 · 重叠对轮明细与分层（§3.2-1）');
  out.push('');
  out.push('| 批次目录 | 角色 | 轮次 | degraded | trust | safety | bond | valence |');
  out.push('| --- | --- | --- | --- | --- | --- | --- | --- |');
  const sortedOverlap = overlapTurns.toSorted((left, right) => left.dir.localeCompare(right.dir) || left.turnIndex - right.turnIndex);
  for (const turn of sortedOverlap) {
    const delta = turn.delta ?? {};
    out.push(
      `| ${turn.dir} | ${turn.label} | ${String(turn.turnIndex)} | ${turn.degraded ? '是' : '否'} | ${formatNumber(delta.trust ?? Number.NaN)} | ${formatNumber(delta.safety ?? Number.NaN)} | ${formatNumber(delta.bond ?? Number.NaN)} | ${formatNumber(delta.valence ?? Number.NaN)} |`,
    );
  }
  if (overlapTurns.length === 0) out.push('| — | — | — | — | — | — | — | — |');
  out.push('');
  out.push('**分层计数**');
  out.push('');
  out.push('| 分层维度 | 取值 | 轮数 | 占有效轮 |');
  out.push('| --- | --- | --- | --- |');
  const byDir = new Map<string, number>();
  const byRole = new Map<string, number>();
  const byDegraded = new Map<string, number>();
  for (const turn of overlapTurns) {
    byDir.set(turn.dir, (byDir.get(turn.dir) ?? 0) + 1);
    byRole.set(turn.label, (byRole.get(turn.label) ?? 0) + 1);
    const degradedKey = turn.degraded ? 'degraded' : '非 degraded';
    byDegraded.set(degradedKey, (byDegraded.get(degradedKey) ?? 0) + 1);
  }
  for (const [key, count] of byDir) out.push(`| 批次目录 | ${key} | ${count} | ${formatPercent(count, total)} |`);
  for (const [key, count] of byRole) out.push(`| 角色 | ${key} | ${count} | ${formatPercent(count, total)} |`);
  for (const [key, count] of byDegraded) out.push(`| 退化分层 | ${key} | ${count} | ${formatPercent(count, total)} |`);
  if (overlapTurns.length === 0) out.push('| — | — | 0 | 0.0000% |');
  out.push('');
  out.push('**其他多事件轮组合构成（§3.2-2，不混入重叠归因）**');
  out.push('');
  out.push('| 组合 | 轮数 | 占有效轮 |');
  out.push('| --- | --- | --- |');
  const otherCombos = new Map<string, number>();
  for (const turn of otherMultiTurns) {
    const key = comboKey(turn.tags);
    otherCombos.set(key, (otherCombos.get(key) ?? 0) + 1);
  }
  for (const [key, count] of [...otherCombos.entries()].toSorted((left, right) => right[1] - left[1])) {
    out.push(`| ${key} | ${count} | ${formatPercent(count, total)} |`);
  }
  out.push('');
  out.push('## 表 4 · 增量群体对照（§3.3 · 群体分布口径，不做逐事件分量分解）');
  out.push('');
  out.push(`单元格 = 中位 [P25~P75]；n = 有 delta 的轮数。**样本不足（n < ${options.minSamples}）的分组标「样本不足 · 不出结论」**。`);
  out.push('');
  out.push(`| 分组 | n | ${CORE_DIMS.join(' | ')} |`);
  out.push(`| --- | --- | ${CORE_DIMS.map(() => '---').join(' | ')} |`);
  const tableGroups: readonly { key: GroupKey; label: string }[] = [
    { key: 'overlap_pair', label: '重叠对轮（empathy+open_probe）' },
    { key: 'single_empathy', label: '单事件 · empathy（主对照）' },
    { key: 'single_open_probe', label: '单事件 · open_probe' },
    { key: 'single_acceptance', label: '单事件 · acceptance' },
    { key: 'other_multi', label: '其他多事件轮（真实双事件）' },
  ];
  for (const entry of tableGroups) {
    const stats = groupStats.get(entry.key);
    const n = stats?.get('trust')?.n ?? 0;
    const mark = n < options.minSamples ? '（样本不足 · 不出结论）' : '';
    out.push(`| ${entry.label}${mark} | ${n} | ${CORE_DIMS.map((dim) => formatCell(stats?.get(dim))).join(' | ')} |`);
  }
  const accEmpN = acceptanceEmpathyStats.get('trust')?.n ?? 0;
  const accEmpMark = accEmpN < options.minSamples ? '（样本不足 · 不出结论）' : '';
  out.push(
    `| 参照组：acceptance+empathy 真实双事件${accEmpMark} | ${accEmpN} | ${CORE_DIMS.map((dim) => formatCell(acceptanceEmpathyStats.get(dim))).join(' | ')} |`,
  );
  out.push('');
  out.push(`| 分组 | n | ${OTHER_DIMS.join(' | ')} |`);
  out.push(`| --- | --- | ${OTHER_DIMS.map(() => '---').join(' | ')} |`);
  for (const entry of tableGroups) {
    const stats = groupStats.get(entry.key);
    const n = stats?.get('valence')?.n ?? 0;
    const mark = n < options.minSamples ? '（样本不足 · 不出结论）' : '';
    out.push(`| ${entry.label}${mark} | ${n} | ${OTHER_DIMS.map((dim) => formatCell(stats?.get(dim))).join(' | ')} |`);
  }
  out.push('');
  out.push('**群体对照判定（仅样本充足组给结论）**');
  out.push('');
  out.push('| 对照 | 样本充足性 | 判定 |');
  out.push('| --- | --- | --- |');
  const overlapN = groupStats.get('overlap_pair')?.get('trust')?.n ?? 0;
  const empathyN = groupStats.get('single_empathy')?.get('trust')?.n ?? 0;
  const openProbeN = groupStats.get('single_open_probe')?.get('trust')?.n ?? 0;
  out.push(
    `| 重叠对轮 vs empathy 单命中（trust 中位差） | 重叠对 n=${overlapN} / empathy n=${empathyN} | ${overlapN < options.minSamples ? '**样本不足 · 不出结论**（不强行给点值）' : '可给结论'} |`,
  );
  out.push(
    `| 重叠对轮 vs open_probe 单命中（trust 中位差） | 重叠对 n=${overlapN} / open_probe n=${openProbeN} | ${overlapN < options.minSamples || openProbeN < options.minSamples ? '**样本不足 · 不出结论**' : '可给结论'} |`,
  );
  out.push(
    `| 参照：acceptance+empathy 真实双事件 vs empathy 单命中 | n=${accEmpN} / n=${empathyN} | ${accEmpN < options.minSamples || empathyN < options.minSamples ? '**样本不足 · 不出结论**' : '可给结论（作为「真实双事件叠加」的量级参照）'} |`,
  );
  out.push('');
  out.push('## 表 5 · 静态种子参照（§3.4 · 仅量级参照，非实测结论）');
  out.push('');
  out.push(
    '> 真相源 `state-transition.ts` DELTA_TABLE；**未含角色倍率 / 人格调制 / capTurnDelta 折损 / 时序权重**。归档侧一切数值均取自 `trace.delta` 原值，**种子向量不参与任何归档计算**。',
  );
  out.push('');
  out.push(`| 事件 | ${DELTA_DIMS.join(' | ')} |`);
  out.push(`| --- | ${DELTA_DIMS.map(() => '---').join(' | ')} |`);
  const seedRows: readonly { label: string; vector: DeltaVector }[] = [
    { label: 'empathy（种子）', vector: SEED_REFERENCE.empathy! },
    { label: 'open_probe（种子）', vector: SEED_REFERENCE.open_probe! },
    { label: 'acceptance（种子）', vector: SEED_REFERENCE.acceptance! },
    {
      label: '**empathy + open_probe 理论相加（参照）**',
      vector: {
        trust: (SEED_REFERENCE.empathy?.trust ?? 0) + (SEED_REFERENCE.open_probe?.trust ?? 0),
        safety: (SEED_REFERENCE.empathy?.safety ?? 0) + (SEED_REFERENCE.open_probe?.safety ?? 0),
        bond: (SEED_REFERENCE.empathy?.bond ?? 0) + (SEED_REFERENCE.open_probe?.bond ?? 0),
        verbal: (SEED_REFERENCE.empathy?.verbal ?? 0) + (SEED_REFERENCE.open_probe?.verbal ?? 0),
        depth: (SEED_REFERENCE.empathy?.depth ?? 0) + (SEED_REFERENCE.open_probe?.depth ?? 0),
        style: (SEED_REFERENCE.empathy?.style ?? 0) + (SEED_REFERENCE.open_probe?.style ?? 0),
        valence: (SEED_REFERENCE.empathy?.valence ?? 0) + (SEED_REFERENCE.open_probe?.valence ?? 0),
        arousal: (SEED_REFERENCE.empathy?.arousal ?? 0) + (SEED_REFERENCE.open_probe?.arousal ?? 0),
        positive: (SEED_REFERENCE.empathy?.positive ?? 0) + (SEED_REFERENCE.open_probe?.positive ?? 0),
        negative: 0,
        dependency: 0,
      },
    },
  ];
  for (const row of seedRows) {
    out.push(`| ${row.label} | ${DELTA_DIMS.map((dim) => formatNumber(row.vector[dim] ?? Number.NaN)).join(' | ')} |`);
  }
  out.push('');
  const positiveTrustTotal = scan.turns.reduce((acc, turn) => {
    const value = turn.delta?.trust;
    return typeof value === 'number' && value > 0 ? acc + value : acc;
  }, 0);
  const overlapTrustSum = overlapTurns.reduce((acc, turn) => {
    const value = turn.delta?.trust;
    return typeof value === 'number' ? acc + value : acc;
  }, 0);
  out.push('## 表 6 · 量级小结（事实陈述，不作临床结论）');
  out.push('');
  out.push(
    `- 归档有效轮 **${total}**；与子串重叠对口径一致的双命中轮 **${overlapTurns.length}** 轮，占有效轮 **${formatPercent(overlapTurns.length, total)}**。`,
  );
  out.push(
    `- 其他多事件轮（真实双事件，**不含**重叠归因）**${otherMultiTurns.length}** 轮，占有效轮 **${formatPercent(otherMultiTurns.length, total)}**。`,
  );
  out.push(
    `- 重叠对轮 trust 增量合计 **${formatNumber(overlapTrustSum)}**；全库正向 trust 增量合计 **${formatNumber(positiveTrustTotal)}** → 重叠对轮占全库正向 trust 累计的 **${formatPercent(overlapTrustSum, positiveTrustTotal)}**（**上界**：归档不存命中词，无法逐轮证明命中机制，见表 7）。`,
  );
  out.push(
    `- 群体对照结论：重叠对组 n=${overlapN} ${overlapN < options.minSamples ? '**样本不足 · 不出结论**' : '可给结论'}；主对照 empathy 单命中组 n=${empathyN}（充足）；参照组 acceptance+empathy 真实双事件 n=${accEmpN}。`,
  );
  out.push('');
  out.push('## 表 7 · 口径、限制与披露');
  out.push('');
  out.push('**口径限制**');
  out.push('');
  out.push(
    '1. **归档不存命中词（matchedTerms）** → `empathy + open_probe` 双标签轮只能确定「两类同时出现」，**不能逐轮证明是子串重叠所致**（文本同时含「你觉得」与另一个 open_probe 词条也会产出同样双标签）→ 重叠对贡献按**上界**报告。',
  );
  out.push(
    '2. **不做逐事件分量分解**：归档 delta 经角色倍率 / 人格调制 / capTurnDelta 折损 / 时序权重处理，脚本不反推单事件分量，只做群体分布对照（任务单 §3.3）。',
  );
  out.push('3. **样本不足规则**：分组轮数 < `--min-samples`（本次 ' + options.minSamples + '）即标「样本不足 · 不出结论」，不强行给点值。');
  out.push(
    '4. **退化轮不做特殊剔除**：归档「degraded」= 渲染降级，规则事件仍推进状态（与 I-11 单结论一致），故退化轮**保留**在分组内并单列退化分层计数。',
  );
  out.push('5. **模式分层**：未传 `--lineage` → **不按 counselorModeId 分层**，只按角色 / 批次目录 / 退化分层。');
  out.push(
    '6. **归档时点**：归档快照早于 S-1 / D-2 落地，事件 kind 集合与词表口径与当前版本存在时点差；本单只用归档里已落库的 kind 标签，不反推当前分类器行为。',
  );
  out.push('');
  out.push('**跳过披露（不静默丢场）**');
  out.push('');
  out.push('| 项 | 数量 |');
  out.push('| --- | --- |');
  out.push(`| 扫描文件 | ${scan.files} |`);
  out.push(`| 有效场次 | ${scan.sessions} |`);
  out.push(`| 有效轮次 | ${total} |`);
  out.push(`| 非 JSON 文件跳过 | ${scan.skippedNonJson} |`);
  out.push(`| 解析失败跳过 | ${scan.skippedParseFailed} |`);
  out.push(`| 无角色跳过 | ${scan.skippedNoRole} |`);
  out.push(`| 无 traces 跳过 | ${scan.skippedNoTraces} |`);
  out.push(`| 根目录散落 JSON（非场次） | ${scan.looseRootFiles} |`);
  out.push(`| delta 缺失轮（trace.delta 为 null） | ${scan.deltaMissing} |`);
  out.push('');
  out.push('**归档完整性（运行前后全清单哈希）**');
  out.push('');
  out.push('| 时点 | 文件数 | 字节数 | SHA256 |');
  out.push('| --- | --- | --- | --- |');
  out.push(`| 运行前 | ${input.hashBefore.files} | ${input.hashBefore.bytes} | ${input.hashBefore.sha256} |`);
  out.push(`| 运行后 | ${input.hashAfter.files} | ${input.hashAfter.bytes} | ${input.hashAfter.sha256} |`);
  out.push(`| 结论 | ${input.hashBefore.sha256 === input.hashAfter.sha256 ? '**逐字一致 · 归档零修改**' : '**不一致 · 见偏差节**'} | | |`);
  out.push('');
  out.push('**血缘（模式分层）**');
  out.push('');
  out.push(
    input.lineageProvided
      ? `- 已提供血缘文件：命中 ${input.lineageHits} 轮 / 关联 ${input.lineageRows} 个 mode`
      : '- 未提供 `--lineage` → **不按 counselorModeId 分层**（任务单 §3.3）',
  );
  out.push('');
  return out.join('\n');
}

/** 主流程. */
async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  if (!fs.existsSync(options.dir)) {
    console.error('目录不存在: ' + options.dir);
    process.exitCode = 1;
    return;
  }
  if (!fs.existsSync(LEXICON_SOURCE)) {
    console.error('词表真相源不存在: ' + LEXICON_SOURCE + ' (请在仓库根目录运行)');
    process.exitCode = 1;
    return;
  }
  const source = readSourceLexicon(LEXICON_SOURCE);
  const issues = diffLexicon(LEXICON, source);
  if (issues.length > 0) {
    console.error('词表真相源漂移 (内置静态声明与 event-lexicon.ts 不一致):');
    for (const issue of issues) console.error('  - ' + issue);
    process.exitCode = 1;
    return;
  }
  const pairs = enumerateSubstringPairs(LEXICON);
  const hashBefore = hashTree(options.dir);
  const lineage = options.lineage === null ? new Map<string, string>() : loadLineage(options.lineage);
  const scan = scanArchives(options.dir, lineage);
  const hashAfter = hashTree(options.dir);
  const lineageTurns = scan.turns.filter((turn) => turn.modeId !== '');
  const lineageRows = new Set(lineageTurns.map((turn) => turn.modeId)).size;
  const report = renderReport({
    options,
    sourceRuleCount: source.length,
    pairs,
    scan,
    hashBefore,
    hashAfter,
    lineageProvided: options.lineage !== null,
    lineageRows,
    lineageHits: lineageTurns.length,
  });
  console.log(report);
  if (options.out !== null) {
    fs.mkdirSync(path.dirname(options.out), { recursive: true });
    fs.writeFileSync(options.out, report + '\n', 'utf8');
    console.log('\n[报告已写入] ' + options.out);
  }
}

/** 直接运行时才跑批 (import 本文件不触发). */
const entry = process.argv[1];
if (entry !== undefined && import.meta.url === pathToFileURL(entry).href) {
  await main();
}
