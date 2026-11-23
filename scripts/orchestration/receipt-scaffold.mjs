/**
 * AF-365 · 回执脚手架：从任务单生成六组骨架，减少 249 行手写成本。
 *
 * 只生成「结构 + 事实字段」，不填伪造值：
 *   - gateResults / scopeCheck / contractChecks / backlogItems / deviationTable / reviewVerdict
 *     全部给空数组或 null，必须由执行方填真实命令、退出码与数字；
 *   - 缺项交给 receipt-lint / acceptance-runner 拦截，不在这里伪造 passed。
 */
import { existsSync, readFileSync } from 'node:fs';

export const REQUIRED_RECEIPT_GROUPS = ['gateResults', 'scopeCheck', 'contractChecks', 'backlogItems', 'deviationTable', 'reviewVerdict'];

function scalar(text, key) {
  const match = new RegExp(`^${key}:\\s*(.*)$`, 'm').exec(text);
  if (!match) return null;
  const raw = match[1].trim();
  if (raw === 'null' || raw === '') return null;
  if (raw.startsWith('"')) {
    try {
      return JSON.parse(raw);
    } catch {
      return raw.replace(/^"|"$/g, '');
    }
  }
  return raw;
}

function list(text, key) {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((line) => line === `${key}:` || line.startsWith(`${key}:`));
  if (start < 0) return [];
  const inline = lines[start].slice(key.length + 1).trim();
  if (inline.startsWith('[')) {
    try {
      const parsed = JSON.parse(inline);
      return Array.isArray(parsed) ? parsed.map(String) : [];
    } catch {
      return [];
    }
  }
  const values = [];
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line.trim()) continue;
    if (/^\S/.test(line)) break;
    const item = /^\s*-\s*(.+)$/.exec(line);
    if (item) values.push(item[1].trim().replace(/^"|"$/g, ''));
  }
  return values;
}

function artifactPaths(text) {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((line) => line === 'artifacts:' || line.startsWith('artifacts:'));
  if (start < 0) return [];
  const paths = [];
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line.trim()) continue;
    if (/^\S/.test(line)) break;
    const item = /^\s+path:\s*(.+)$/.exec(line);
    if (item) paths.push(item[1].trim().replace(/^"|"$/g, ''));
  }
  return paths;
}

/**
 * @param {{taskId:string, taskSheetText:string, now?:string, receiptId?:string}} input
 */
export function buildReceiptScaffold({ taskId, taskSheetText, now = new Date().toISOString(), receiptId = null }) {
  const text = String(taskSheetText ?? '');
  if (!/^---\r?\n/.test(text)) throw new Error('任务单缺少 YAML frontmatter');
  const recordedTaskId = scalar(text, 'taskId');
  if (recordedTaskId && recordedTaskId !== taskId) throw new Error(`任务单 taskId=${recordedTaskId} 与 ${taskId} 不一致`);
  const artifacts = artifactPaths(text);
  return {
    deliveredAt: now,
    payload: {
      receiptId: receiptId ?? `RC-${taskId}-1`,
      taskId,
      contextId: scalar(text, 'contextId'),
      type: scalar(text, 'type'),
      agentRole: scalar(text, 'agentRole'),
      baselineRef: scalar(text, 'baselineRef'),
      dependsOn: list(text, 'dependsOn'),
      priorTasks: list(text, 'priorTasks'),
      policyRefs: list(text, 'policyRefs'),
      contractRef: 'urn:agent-collaboration-framework:schema:receipt:1.0.0',
      artifactRefs: {
        taskSheet: null,
        deliveryRecord: artifacts[0] ?? null,
        reply: null,
        others: [],
      },
      changedFiles: { commits: [], added: [], modified: [], deleted: [], deletionChecks: [] },
      gateResults: [],
      reproNotes: '',
      scopeCheck: null,
      parallelArtifactsExcluded: null,
      noOutscopeRefactor: null,
      contractChecks: [],
      fieldAlignment: { result: null, note: null },
      backlogItems: [],
      openQuestions: [],
      manualReviewList: [],
      deviationTable: [],
      deviationAbsent: null,
      finalStatus: null,
      reviewVerdict: null,
      verdictRationale: null,
      failureReasonCode: null,
      cancellationReason: null,
      costNote: null,
    },
    scaffold: {
      requiredGroups: REQUIRED_RECEIPT_GROUPS,
      placeholders: ['gateResults 填命令+退出码+数字', 'scopeCheck 填 in-scope 或越界说明', 'reviewVerdict 只能填 passed/conditional-pass/rejected'],
    },
  };
}

/**
 * @param {{taskId:string, taskSheetPath:string, now?:string, receiptId?:string}} input
 */
export function buildReceiptScaffoldFromFile({ taskId, taskSheetPath, now, receiptId }) {
  if (!existsSync(taskSheetPath)) throw new Error(`任务单不存在：${taskSheetPath}`);
  return buildReceiptScaffold({ taskId, taskSheetText: readFileSync(taskSheetPath, 'utf8'), now, receiptId });
}
