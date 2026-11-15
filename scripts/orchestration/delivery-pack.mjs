/**
 * 夜间交付包生成器。
 *
 * 对齐框架 docs/autonomous-loop.md §7：交付包是工件，只存指针与汇总，不复制
 * 工件正文。结构：汇总元信息、任务结论清单、死信清单、遗留项、待批动作、队列快照。
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { PATHS, loadConfig, loadIndex, loadRuntimeState, nowIso, writeJsonAtomic } from './state-store.mjs';
import { buildSnapshot } from './scheduler.mjs';
import { loadImprovementLog, summarizeLog } from './improvement-log.mjs';

function timestamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

/** 汇总遗留项：人工复核清单 + 未决问题（当前来自快照 manualReview 线索）。 */
function collectOpenItems(snapshot) {
  const items = [];
  for (const task of snapshot.tasks) {
    for (const review of task.manualReview ?? []) items.push({ taskId: task.taskId, kind: 'manual-review', text: review });
    if (task.verdict === 'conditional-pass') {
      items.push({ taskId: task.taskId, kind: 'conditional-pass', text: task.verdictRationale ?? '附条件通过，遗留已登记' });
    }
  }
  for (const proposal of snapshot.reworkProposals) {
    items.push({ taskId: proposal.originalTaskId, kind: 'rework-proposal', text: proposal.rationale });
  }
  return items;
}

/**
 * 生成交付包。
 * @param {{write?: boolean}} opts write=true 时落盘 JSON 与 MD 副本。
 * @returns {{pack: object, jsonPath: string|null, mdPath: string|null}}
 */
export function generateDeliveryPack(opts = {}) {
  const config = loadConfig();
  const index = loadIndex();
  const runtimeState = loadRuntimeState();
  const snapshot = buildSnapshot(index, runtimeState, config);

  const improvementSummary = summarizeLog(loadImprovementLog());
  const pack = {
    schemaVersion: '1.0.0',
    generatedAt: nowIso(),
    meta: {
      mode: snapshot.mode,
      queueCounts: snapshot.counts,
      archivedCount: snapshot.archivedCount,
      improvementSummary,
    },
    taskResults: snapshot.tasks.map((t) => ({
      taskId: t.taskId,
      contextId: t.contextId,
      type: t.type,
      status: t.status,
      verdict: t.verdict,
      verdictRationale: t.verdictRationale,
      attemptCount: t.attemptCount,
      reworkOf: t.reworkOf,
      artifactRefs: t.artifacts,
    })),
    deadLetters: snapshot.deadLetters,
    openItems: collectOpenItems(snapshot),
    pendingApprovals: snapshot.pendingApprovals,
    snapshotRef: PATHS.snapshot,
  };

  let jsonPath = null;
  let mdPath = null;
  if (opts.write !== false) {
    const stamp = timestamp();
    jsonPath = join(PATHS.deliveryPackDir, `pack-${stamp}.json`);
    mdPath = join(PATHS.deliveryPackDir, `pack-${stamp}.md`);
    writeJsonAtomic(jsonPath, pack);
    writeJsonAtomic(mdPath, renderMarkdown(pack));
  }
  return { pack, jsonPath, mdPath };
}

function renderMarkdown(pack) {
  const lines = [];
  lines.push('# 夜间交付包');
  lines.push('');
  lines.push(`- 生成时间：${pack.generatedAt}`);
  lines.push(`- 自治模式：${pack.meta.mode.autoLoopEnabled ? '开启' : '关闭'}；返修上限：${pack.meta.mode.reworkLimit}`);
  lines.push(
    `- 队列计数：${Object.entries(pack.meta.queueCounts)
      .map(([k, v]) => `${k}=${v}`)
      .join('，')}`,
  );
  lines.push('');
  lines.push('## 任务结论清单');
  lines.push('');
  lines.push('| taskId | contextId | 类型 | 状态 | 结论 | 返修次数 | 工件指针 |');
  lines.push('| --- | --- | --- | --- | --- | --- | --- |');
  for (const t of pack.taskResults) {
    const refs = Object.entries(t.artifactRefs ?? {})
      .filter(([, v]) => v)
      .map(([k, v]) => `${k}: ${v}`)
      .join('；');
    lines.push(`| ${t.taskId} | ${t.contextId} | ${t.type} | ${t.status} | ${t.verdict ?? '—'} | ${t.attemptCount} | ${refs || '—'} |`);
  }
  lines.push('');
  lines.push('## 死信清单');
  lines.push('');
  if (pack.deadLetters.length === 0) {
    lines.push('- 无');
  } else {
    for (const d of pack.deadLetters) {
      lines.push(`- ${d.taskId}：${d.escalation?.waiting ?? '待人工裁决'}`);
      if (d.escalation?.evidence?.length) lines.push(`  - 失败证据：${d.escalation.evidence.join('；')}`);
    }
  }
  lines.push('');
  lines.push('## 遗留项');
  lines.push('');
  if (pack.openItems.length === 0) {
    lines.push('- 无');
  } else {
    for (const item of pack.openItems) lines.push(`- [${item.kind}] ${item.taskId}：${item.text}`);
  }
  lines.push('');
  lines.push('## 待批动作');
  lines.push('');
  if (pack.pendingApprovals.length === 0) {
    lines.push('- 无');
  } else {
    for (const p of pack.pendingApprovals) lines.push(`- ${p.taskId}：${p.reason}`);
  }
  lines.push('');
  lines.push('## 改进台账');
  lines.push('');
  const imp = pack.meta.improvementSummary;
  if (!imp || imp.total === 0) {
    lines.push('- 无候选改进');
  } else {
    lines.push(
      `- 活跃=${imp.activeCount} / 总=${imp.total}；候选=${imp.byStatus.candidate} 排队=${imp.byStatus.queued} 实现中=${imp.byStatus.accepted} 已完成=${imp.byStatus.done} 不采纳=${imp.byStatus.wontfix}`,
    );
  }
  lines.push('');
  return lines.join('\n');
}

/** 供 CLI 判断快照是否已落盘。 */
export function snapshotExists() {
  return existsSync(PATHS.snapshot);
}
