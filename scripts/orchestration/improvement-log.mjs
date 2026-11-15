/**
 * 候选改进台账（经验沉淀闭环 · adapter 层扩展）。
 *
 * 职责：把实现 / 验收 / 返修 / 死信复盘 / 评审中发现的缺口与架构提升点，
 * 结构化为可追踪、可定级、可闭环的候选条目；对齐框架 `docs/context-and-memory.md`
 * §2 共享记忆口径——受控写入、带来源与写入者、状态撤回留痕、不直接删除条目。
 *
 * 闭环环节：发现 → 登记（candidate）→ 评审立项（queued）→ 实现（accepted）
 * → 落地归档（done）或不采纳（wontfix）；同类问题二次出现时升级为护栏 / 测试基线。
 *
 * 人工闸门边界：
 *   - 抽取通道与 CLI 登记只产生 `candidate`；
 *   - `queued`（立项）、`accepted`、终态 `done` / `wontfix` 必须由编排者 / 人工显式流转；
 *   - `framework` 层条目只作通用层候选标记，不自动改动框架仓，待人工评审后回写。
 *
 * 本文件为适配层扩展，不进通用层 schema；字段可扩展、既有字段只增不删。
 */
import { existsSync, readFileSync } from 'node:fs';
import { PATHS, nowIso, writeJsonAtomic } from './state-store.mjs';

/** 发现来源枚举。 */
export const SOURCES = ['implementation', 'acceptance', 'rework', 'dead-letter', 'review'];
/** 改进分类枚举。 */
export const TYPES = ['gap', 'guardrail', 'tool', 'standard', 'performance', 'tech-debt'];
/** 归属层枚举：adapter 为本仓取值；framework 为通用层候选（须人工评审回写）。 */
export const LAYERS = ['adapter', 'framework'];
/** 台账状态枚举；done / wontfix 为终态。 */
export const STATUSES = ['candidate', 'queued', 'accepted', 'done', 'wontfix'];

/** 台账状态迁移表（终态不可变）。 */
const TRANSITIONS = {
  candidate: ['queued', 'wontfix'],
  queued: ['accepted', 'candidate', 'wontfix'],
  accepted: ['done', 'queued'],
  done: [],
  wontfix: [],
};

const TERMINAL = new Set(['done', 'wontfix']);

/** 空台账骨架。 */
function emptyLog() {
  return { schemaVersion: '1.0.0', updatedAt: null, improvements: [] };
}

function readJson(file) {
  if (!existsSync(file)) return null;
  return JSON.parse(readFileSync(file, 'utf8'));
}

/** 加载台账；缺省返回空骨架并归一化 improvements 数组。 */
export function loadImprovementLog() {
  const raw = readJson(PATHS.improvementLog) ?? emptyLog();
  if (!Array.isArray(raw.improvements)) raw.improvements = [];
  raw.schemaVersion = raw.schemaVersion ?? '1.0.0';
  return raw;
}

/** 保存台账（原子写）。 */
export function saveImprovementLog(log) {
  log.updatedAt = nowIso();
  writeJsonAtomic(PATHS.improvementLog, log);
  return log;
}

/** 标题归一化去重键：小写、去标点与多余空白。 */
function titleKey(text) {
  return String(text ?? '')
    .toLowerCase()
    .replace(/[\s，。、；：,.，。;:'"“”‘’()（）/\-_]+/g, '')
    .trim();
}

/** 同来源 + 关联任务 + 标题的签名（跨标题措辞差异的二次去重）。 */
function signature(entry) {
  return [entry.source, entry.relatedTaskId ?? '', titleKey(entry.title)].join('|');
}

function nonEmptyString(value, field, errors) {
  if (typeof value !== 'string' || value.trim() === '') errors.push(`${field} 须为非空字符串`);
}

/**
 * 校验并归一化新增候选条目。
 * @param {object} raw 原始字段
 * @param {{existing?: object[]}} opts existing 为台账既有条目（去重判重）
 * @returns {object} 归一化条目草稿（未分配 ID）
 */
export function validateImprovementEntry(raw = {}, opts = {}) {
  const errors = [];
  nonEmptyString(raw.title, 'title', errors);
  if (!SOURCES.includes(raw.source)) errors.push(`source 非法：${String(raw.source)}（允许 ${SOURCES.join('/')}）`);
  if (!TYPES.includes(raw.type)) errors.push(`type 非法：${String(raw.type)}（允许 ${TYPES.join('/')}）`);
  if (!LAYERS.includes(raw.layer)) errors.push(`layer 非法：${String(raw.layer)}（允许 ${LAYERS.join('/')}）`);

  const evidence = Array.isArray(raw.evidence) ? raw.evidence.filter((e) => typeof e === 'string' && e.trim() !== '') : [];
  const relatedTaskId = raw.relatedTaskId ? String(raw.relatedTaskId) : null;

  const draft = {
    title: String(raw.title ?? '').trim(),
    source: raw.source,
    type: raw.type,
    layer: raw.layer,
    relatedTaskId,
    evidence,
    impact: raw.impact ? String(raw.impact) : null,
    suggestion: raw.suggestion ? String(raw.suggestion) : null,
    createdBy: raw.createdBy ? String(raw.createdBy) : 'orchestrator-cli',
  };

  const existing = opts.existing ?? [];
  const seenTitle = new Set(existing.map((e) => titleKey(e.title)));
  const seenSig = new Set(existing.map((e) => signature(e)));
  if (draft.title && seenTitle.has(titleKey(draft.title))) errors.push(`标题已存在：${draft.title}`);
  if (signature(draft) && seenSig.has(signature(draft))) errors.push('同来源 / 关联任务 / 标题的候选已登记');

  if (errors.length > 0) throw new Error(`改进条目非法：${errors.join('；')}`);
  return draft;
}

/** 下一候选编号：IM-001 起，按既有最大序号递增。 */
function nextImprovementId(improvements) {
  let max = 0;
  for (const entry of improvements) {
    const match = /^IM-(\d+)$/.exec(entry.improvementId ?? '');
    if (match) max = Math.max(max, Number(match[1]));
  }
  return `IM-${String(max + 1).padStart(3, '0')}`;
}

/**
 * 登记一条候选（状态固定 candidate，不做立项）。
 * @returns {object} 落库后的完整条目
 */
export function addCandidate(log, raw, opts = {}) {
  const draft = validateImprovementEntry(raw, { existing: log.improvements });
  const now = nowIso();
  const entry = {
    improvementId: nextImprovementId(log.improvements),
    status: 'candidate',
    ...draft,
    createdAt: now,
    updatedAt: now,
    history: [{ at: now, from: null, to: 'candidate', by: draft.createdBy, note: opts.note ?? '登记候选改进' }],
  };
  log.improvements.push(entry);
  log.updatedAt = now;
  return entry;
}

/** 台账状态迁移是否合法。 */
export function canTransitionImprovement(from, to) {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

/**
 * 显式流转台账条目状态（人工 / 编排者闸门动作）。
 * @param {object} log 台账
 * @param {string} improvementId 条目编号
 * @param {string} to 目标状态
 * @param {{by?: string, note?: string, linkedTaskId?: string}} opts
 * @returns {object} 流转后的条目
 */
export function transitionImprovement(log, improvementId, to, opts = {}) {
  const entry = log.improvements.find((e) => e.improvementId === improvementId);
  if (!entry) throw new Error(`台账条目不存在：${improvementId}`);
  if (!STATUSES.includes(to)) throw new Error(`目标状态非法：${to}（允许 ${STATUSES.join('/')}）`);
  if (entry.status === to) return entry;
  if (!canTransitionImprovement(entry.status, to)) {
    throw new Error(`状态迁移非法：${entry.status} → ${to}`);
  }
  const now = nowIso();
  entry.history.push({ at: now, from: entry.status, to, by: opts.by ?? 'orchestrator-cli', note: opts.note ?? null });
  entry.status = to;
  entry.updatedAt = now;
  if (TERMINAL.has(to)) {
    entry.resolution = {
      resolvedAt: now,
      resolutionNote: opts.note ?? null,
      linkedTaskId: opts.linkedTaskId ?? entry.resolution?.linkedTaskId ?? null,
    };
  }
  log.updatedAt = now;
  return entry;
}

/** 是否终态。 */
export function isTerminalStatus(status) {
  return TERMINAL.has(status);
}

/**
 * 从队列快照抽取候选改进（只产 candidate，不自动立项）。
 * 来源映射：人工复核项 / 附条件通过 → acceptance；返修提案 → rework；死信 → dead-letter。
 * @param {object} snapshot 调度器快照
 * @param {object[]} existing 既有台账条目（去重）
 * @returns {object[]} 待登记草稿数组
 */
export function extractFromSnapshot(snapshot, existing = []) {
  const candidates = [];
  const seenTitle = new Set(existing.map((e) => titleKey(e.title)));
  const seenSig = new Set(existing.map((e) => signature(e)));

  const push = (raw) => {
    const draft = {
      title: raw.title,
      source: raw.source,
      type: raw.type ?? 'gap',
      layer: raw.layer ?? 'adapter',
      relatedTaskId: raw.relatedTaskId ?? null,
      evidence: raw.evidence ?? [],
      impact: raw.impact ?? null,
      suggestion: raw.suggestion ?? null,
      createdBy: 'receipt-extract',
    };
    if (seenTitle.has(titleKey(draft.title))) return;
    if (seenSig.has(signature(draft))) return;
    seenTitle.add(titleKey(draft.title));
    seenSig.add(signature(draft));
    candidates.push(draft);
  };

  for (const task of snapshot.tasks ?? []) {
    for (const review of task.manualReview ?? []) {
      push({
        title: review,
        source: 'acceptance',
        type: 'gap',
        relatedTaskId: task.taskId,
        evidence: [`task:${task.taskId}`],
      });
    }
    if (task.verdict === 'conditional-pass') {
      push({
        title: `附条件通过遗留：${task.title}`,
        source: 'acceptance',
        type: 'standard',
        relatedTaskId: task.taskId,
        evidence: [`task:${task.taskId}`],
        suggestion: task.verdictRationale ?? null,
      });
    }
  }

  for (const proposal of snapshot.reworkProposals ?? []) {
    push({
      title: `返修根因：${proposal.title ?? proposal.rationale}`,
      source: 'rework',
      type: 'gap',
      relatedTaskId: proposal.originalTaskId,
      evidence: [`proposal:${proposal.proposalId}`, ...(proposal.priorTasks ?? []).map((t) => `task:${t}`)],
      suggestion: proposal.rationale ?? null,
    });
  }

  for (const deadLetter of snapshot.deadLetters ?? []) {
    push({
      title: `死信复盘：${deadLetter.title ?? deadLetter.taskId}`,
      source: 'dead-letter',
      type: 'guardrail',
      relatedTaskId: deadLetter.taskId,
      evidence: [...(deadLetter.escalation?.evidence ?? []).map((e) => `evidence:${e}`)],
      impact: deadLetter.escalation?.waiting ?? null,
    });
  }

  return candidates;
}

/** taskId 标识模式（与交接契约 taskId 模式一致；局部常量保持 adapter 内聚）。 */
const RECEIPT_TASK_ID_PATTERN = /^[A-Z0-9]+-[0-9]+$/;

/** 回执遗留组标签 → 台账证据标签（manualReviewList 归快照通道，正文通道不抽取以免双源重复）。 */
const RECEIPT_SECTION_TAG = {
  backlogItems: 'backlogItem',
  openQuestions: 'openQuestion',
};

/** 从回执正文解析关联 taskId：优先 frontmatter `taskId:`，其次正文 `任务标识：` 行；取不到返回 null。 */
function parseReceiptTaskId(markdown) {
  const text = String(markdown ?? '');
  const frontmatter = /(?:^|\n)taskId:\s*([A-Z0-9]+-[0-9]+)/.exec(text);
  if (frontmatter) return frontmatter[1];
  const inline = /任务标识[：:]\s*`?([A-Z0-9]+-[0-9]+)`?/.exec(text);
  if (inline && RECEIPT_TASK_ID_PATTERN.test(inline[1])) return inline[1];
  return null;
}

/** 列表项文本清洗：去行内反引号、链接保留文本、折叠空白。 */
function cleanReceiptItem(raw) {
  return String(raw ?? '')
    .replace(/`/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * 从回执交接件正文（markdown）抽取候选改进（双通道之一；只产 candidate，不自动立项）。
 *
 * 解析遗留组 `**backlogItems**` / `**openQuestions**` 下的列表项；`manualReviewList`
 * 由快照通道抽取，本通道不重复采集。表格行、空行与段内叙述句不入台账。
 * 与 extractFromSnapshot 结果按标题键 + 签名去重，existing 命中跳过。
 *
 * @param {string} markdown 回执正文
 * @param {object[]} existing 既有台账条目（去重）
 * @param {{docRef?: string}} opts docRef 为回执文件名（写入 evidence 指针）
 * @returns {object[]} 待登记草稿数组
 */
export function extractFromReceiptDoc(markdown, existing = [], opts = {}) {
  const candidates = [];
  const seenTitle = new Set(existing.map((e) => titleKey(e.title)));
  const seenSig = new Set(existing.map((e) => signature(e)));
  const docRef = opts.docRef ? String(opts.docRef) : null;
  const relatedTaskId = parseReceiptTaskId(markdown);

  const listRe = /^\s*(?:[-*]|\d+[.)])\s+(.*)$/;
  const headingRe = /^\s#{1,6}\s/;
  const labelRe = /^\s*\*\*(backlogItems|openQuestions|manualReviewList)\*\*\s*[:：]?\s*$/;

  let section = null;
  for (const line of String(markdown ?? '').split(/\r?\n/)) {
    const label = labelRe.exec(line);
    if (label) {
      section = label[1];
      continue;
    }
    if (headingRe.test(line)) {
      section = null;
      continue;
    }
    if (!section || section === 'manualReviewList') continue;
    if (line.includes('|')) continue; // 表格行
    const item = listRe.exec(line);
    if (!item) continue;

    const title = cleanReceiptItem(item[1]);
    if (!title) continue;
    const evidenceTag = RECEIPT_SECTION_TAG[section] ?? 'backlogItem';
    const draft = {
      title,
      source: 'acceptance',
      type: 'gap',
      layer: 'adapter',
      relatedTaskId,
      evidence: [docRef ? `receipt:${docRef}` : 'receipt', evidenceTag],
      impact: null,
      suggestion: null,
      createdBy: 'receipt-extract',
    };
    if (seenTitle.has(titleKey(draft.title))) continue;
    if (seenSig.has(signature(draft))) continue;
    seenTitle.add(titleKey(draft.title));
    seenSig.add(signature(draft));
    candidates.push(draft);
  }

  return candidates;
}

/**
 * 台账汇总计数 + 只读条目投影（供快照 / CLI / 交付包 / 网页视图读取）。
 * items 只保留展示所需的登记字段与末次流转记录，不复制会话正文；明细口径与汇总同源。
 */
export function summarizeLog(log) {
  const byStatus = Object.fromEntries(STATUSES.map((s) => [s, 0]));
  const byType = Object.fromEntries(TYPES.map((t) => [t, 0]));
  const bySource = Object.fromEntries(SOURCES.map((s) => [s, 0]));
  let activeCount = 0;
  for (const entry of log.improvements) {
    byStatus[entry.status] = (byStatus[entry.status] ?? 0) + 1;
    byType[entry.type] = (byType[entry.type] ?? 0) + 1;
    bySource[entry.source] = (bySource[entry.source] ?? 0) + 1;
    if (!isTerminalStatus(entry.status)) activeCount += 1;
  }
  const items = log.improvements.map((entry) => {
    const history = Array.isArray(entry.history) ? entry.history : [];
    const last = history.length > 0 ? history[history.length - 1] : null;
    return {
      improvementId: entry.improvementId,
      title: entry.title,
      status: entry.status,
      source: entry.source,
      type: entry.type,
      layer: entry.layer,
      relatedTaskId: entry.relatedTaskId ?? null,
      evidence: Array.isArray(entry.evidence) ? entry.evidence : [],
      impact: entry.impact ?? null,
      suggestion: entry.suggestion ?? null,
      historyCount: history.length,
      lastTransition: last ? { at: last.at ?? null, by: last.by ?? null, to: last.to ?? null, note: last.note ?? null } : null,
    };
  });
  return { total: log.improvements.length, activeCount, byStatus, byType, bySource, items };
}

/** 非终态条目（立项 / 实现跟踪用）。 */
export function listOpen(log) {
  return log.improvements.filter((e) => !isTerminalStatus(e.status));
}
