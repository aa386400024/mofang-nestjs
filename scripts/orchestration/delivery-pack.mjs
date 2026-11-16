/**
 * 夜间交付包生成器（框架 2.0.0 `delivery-package` 1.0.0 口径）。
 *
 * 对齐框架 `docs/autonomous-loop.md` §7 与 `schemas/delivery-package.schema.json`：
 * 交付包是工件，只存指针与汇总，不复制工件正文。结构为
 * `packageId / cycle / counts / tasks / deadLetters / leftovers / pendingApprovals / queueSnapshot`。
 *
 * 适配层取值约定：
 *   - `cycle.mode`：自治开关关闭时 `human-in-the-loop`，开启时 `human-on-the-loop`；
 *   - `cycle.stopReason`：手工 `run-once` 生成的包记 `human-stop`；自治循环队列为空记 `queue-empty`；
 *   - `tasks[]` 只列**工件指针齐全**（taskSheet + deliveryRecord）的终态任务；指针不全的终态任务
 *     不虚构路径，其结论只体现在 `counts`，缺口由 `meta.pointerGaps` 显式登记；
 *   - `pendingApprovals[].node` 统一记为 `sensitive-action`（冻结动作即敏感操作，细分见 escalation）。
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { PATHS, loadConfig, loadIndex, loadRuntimeState, nowIso, writeJsonAtomic } from './state-store.mjs';
import { buildSnapshot } from './scheduler.mjs';
import { loadImprovementLog, summarizeLog } from './improvement-log.mjs';
import { TASK_STATUSES, TERMINAL_STATUSES } from './contract-enums.mjs';
import { validateDeliveryPackage } from './validator.mjs';

function timestamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

/** 汇总遗留项：人工复核清单 / 未决问题 / 返修建议（来自快照）。 */
function collectLeftovers(snapshot) {
  const manualReviewList = [];
  const openQuestions = [];
  for (const task of snapshot.tasks) {
    for (const review of task.manualReview ?? []) manualReviewList.push(`${task.taskId}：${review}`);
    if (task.verdict === 'conditional-pass') {
      manualReviewList.push(`${task.taskId}：附条件通过，遗留已登记（${task.verdictRationale ?? '未写理由'}）`);
    }
    if (!TASK_STATUSES.includes(task.status)) {
      manualReviewList.push(`${task.taskId}：状态值 ${task.status} 不在框架 10 值枚举内（tolerant 透传，需人工复核）`);
    }
  }
  for (const proposal of snapshot.reworkProposals) {
    openQuestions.push(`${proposal.originalTaskId}：${proposal.rationale}`);
  }
  return { backlogItems: [], openQuestions, manualReviewList };
}

/** 由终态任务汇总计数（passed / conditionalPass / rejected / failed 互斥，deadLettered 单列）。 */
function countVerdicts(tasks) {
  const counts = { passed: 0, conditionalPass: 0, rejected: 0, failed: 0, deadLettered: 0 };
  for (const task of tasks) {
    if (task.status === 'failed') counts.failed += 1;
    else if (task.status === 'rejected' || task.verdict === 'rejected') counts.rejected += 1;
    else if (task.verdict === 'passed') counts.passed += 1;
    else if (task.verdict === 'conditional-pass') counts.conditionalPass += 1;
  }
  return counts;
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
  const startedAt = nowIso();

  const improvementSummary = summarizeLog(loadImprovementLog());
  const terminalTasks = snapshot.tasks.filter((t) => TERMINAL_STATUSES.includes(t.status));
  const activeTasks = snapshot.tasks.filter((t) => !TERMINAL_STATUSES.includes(t.status));
  const counts = countVerdicts(terminalTasks);
  counts.deadLettered = snapshot.deadLetters.length;

  const pointerGaps = [];
  const packTasks = [];
  for (const t of terminalTasks) {
    const taskSheet = t.artifacts?.taskSheet ?? null;
    const deliveryRecord = t.artifacts?.deliveryRecord ?? null;
    if (!taskSheet || !deliveryRecord) {
      pointerGaps.push(t.taskId);
      continue;
    }
    packTasks.push({
      taskId: t.taskId,
      contextId: t.contextId ?? 'unknown-context',
      type: t.type ?? 'implementation',
      finalStatus: t.status,
      reviewVerdict: t.verdict ?? null,
      artifactRefs: { taskSheet, deliveryRecord, reply: t.artifacts?.reply ?? null },
      repairCount: Number.isInteger(t.attemptCount) ? Math.max(0, t.attemptCount - 1) : 0,
      reworkOf: t.reworkOf ?? null,
      verdictRationale: t.verdictRationale ?? null,
    });
  }

  const deadLetters = snapshot.deadLetters.map((d) => ({
    taskId: d.taskId,
    failureEvidence: d.escalation?.evidence?.length ? d.escalation.evidence : ['未登记失败证据（见任务索引运行态）'],
    attemptedPaths: d.escalation?.attemptedPaths?.length ? d.escalation.attemptedPaths : ['按任务单直接执行，未登记分层尝试路径'],
    decisionPoint: d.escalation?.waiting ?? '待人工裁决',
  }));

  const pendingApprovals = snapshot.pendingApprovals.map((p) => ({
    taskId: p.taskId,
    node: 'sensitive-action',
    action: p.reason ?? '冻结待批',
  }));

  const queueSnapshot = activeTasks.map((t) => ({
    taskId: t.taskId,
    status: t.status,
    pointer: t.artifacts?.taskSheet ?? `docs/team/agent-orchestration/task-state-index.json#${t.taskId}`,
  }));

  const autoLoopEnabled = config.autoLoop.enabled;
  const queueSize = Object.values(snapshot.counts ?? {}).reduce((sum, n) => sum + (Number(n) || 0), 0);

  const pack = {
    packageId: `PACK-${timestamp()}`,
    cycle: {
      startedAt,
      endedAt: nowIso(),
      mode: autoLoopEnabled ? 'human-on-the-loop' : 'human-in-the-loop',
      queueSize,
      stopReason: autoLoopEnabled ? 'queue-empty' : 'human-stop',
    },
    counts,
    tasks: packTasks,
    deadLetters,
    leftovers: collectLeftovers(snapshot),
    pendingApprovals,
    queueSnapshot,
    meta: {
      mode: snapshot.mode,
      queueCounts: snapshot.counts,
      archivedCount: snapshot.archivedCount,
      improvementSummary,
      pointerGaps,
      note: pointerGaps.length
        ? `以下终态任务缺 deliveryRecord 指针，未写入 tasks[]（见 meta.pointerGaps）：${pointerGaps.join('、')}`
        : '全部终态任务的工件指针齐全。',
    },
    snapshotRef: PATHS.snapshot,
  };

  let jsonPath = null;
  let mdPath = null;
  if (opts.write !== false) {
    const stamp = timestamp();
    jsonPath = join(PATHS.deliveryPackDir, `pack-${stamp}.json`);
    mdPath = join(PATHS.deliveryPackDir, `pack-${stamp}.md`);
    writeJsonAtomic(jsonPath, pack);
    mkdirSync(dirname(mdPath), { recursive: true });
    writeFileSync(mdPath, `${renderMarkdown(pack)}\n`, { encoding: 'utf8' });
  }
  return { pack, jsonPath, mdPath };
}

/** 生成前先按框架 delivery-package schema 自检；失败抛错，不产出不合规工件。 */
export async function assertPackSchema(pack) {
  const res = await validateDeliveryPackage(pack);
  if (res.skipped) return;
  if (!res.ok) {
    throw new Error(`交付包不符合 delivery-package schema：${res.errors.map((e) => `${e.instancePath} ${e.message}`).join('；')}`);
  }
}

function renderMarkdown(pack) {
  const lines = [];
  lines.push('# 夜间交付包');
  lines.push('');
  lines.push(`- 包标识：${pack.packageId}`);
  lines.push(`- 循环：${pack.cycle.startedAt} → ${pack.cycle.endedAt}（模式 ${pack.cycle.mode}，终止原因 ${pack.cycle.stopReason}）`);
  lines.push(
    `- 队列规模：${pack.cycle.queueSize}；自治模式：${pack.meta.mode.autoLoopEnabled ? '开启' : '关闭'}；返修上限：${pack.meta.mode.reworkLimit}`,
  );
  lines.push(
    `- 结论计数：通过=${pack.counts.passed} 附条件=${pack.counts.conditionalPass} 打回=${pack.counts.rejected} 失败=${pack.counts.failed} 死信=${pack.counts.deadLettered}`,
  );
  lines.push('');
  lines.push('## 任务结论清单');
  lines.push('');
  if (pack.tasks.length === 0) {
    lines.push('- 无（本循环无工件指针齐全的终态任务）');
  } else {
    lines.push('| taskId | contextId | 类型 | 终态 | 结论 | 返修次数 | 工件指针 |');
    lines.push('| --- | --- | --- | --- | --- | --- | --- |');
    for (const t of pack.tasks) {
      const refs = Object.entries(t.artifactRefs ?? {})
        .filter(([, v]) => v)
        .map(([k, v]) => `${k}: ${v}`)
        .join('；');
      lines.push(
        `| ${t.taskId} | ${t.contextId} | ${t.type} | ${t.finalStatus} | ${t.reviewVerdict ?? '—'} | ${t.repairCount} | ${refs || '—'} |`,
      );
    }
  }
  lines.push('');
  lines.push('## 死信清单');
  lines.push('');
  if (pack.deadLetters.length === 0) {
    lines.push('- 无');
  } else {
    for (const d of pack.deadLetters) {
      lines.push(`- ${d.taskId}：${d.decisionPoint}`);
      lines.push(`  - 失败证据：${d.failureEvidence.join('；')}`);
      lines.push(`  - 已尝试路径：${d.attemptedPaths.join('；')}`);
    }
  }
  lines.push('');
  lines.push('## 遗留项');
  lines.push('');
  const { backlogItems, openQuestions, manualReviewList } = pack.leftovers;
  if (backlogItems.length + openQuestions.length + manualReviewList.length === 0) {
    lines.push('- 无');
  } else {
    for (const item of backlogItems) lines.push(`- [既有债] ${item}`);
    for (const item of openQuestions) lines.push(`- [未决问题] ${item}`);
    for (const item of manualReviewList) lines.push(`- [人工复核] ${item}`);
  }
  lines.push('');
  lines.push('## 待批动作');
  lines.push('');
  if (pack.pendingApprovals.length === 0) {
    lines.push('- 无');
  } else {
    for (const p of pack.pendingApprovals) lines.push(`- ${p.taskId}（${p.node}）：${p.action}`);
  }
  lines.push('');
  lines.push('## 队列快照');
  lines.push('');
  if (pack.queueSnapshot.length === 0) {
    lines.push('- 无在途任务');
  } else {
    for (const q of pack.queueSnapshot) lines.push(`- ${q.taskId}：${q.status}（${q.pointer}）`);
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
