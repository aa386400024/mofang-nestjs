/**
 * AF-024 · GUI 派发通道的投递协议（adapter 层纯逻辑；不触屏、不开进程、不读写剪贴板）。
 *
 * 分工（对齐设计备忘 §3 与框架 reliability.md §3/§4）：
 *   1. 规则判定 → `dispatch-channel.mjs`（纯规则，无副作用）；
 *   2. 投递件生成 / 投递确认 / 降级回滚 → 本模块（纯函数 + 单文件落盘）；
 *   3. 真实桌面动作（拉起窗口、定位输入会话、粘贴、发送、校验）→ orchestrator 的桌面 relay 执行，
 *      执行完必须经 `channel confirm` 或 `channel fallback` 回写，**不允许**把「已粘贴」当成「已送达」。
 *
 * 投递状态机（派发记录 `delivery.state`）：
 *   pending   投递件已生成（`briefRef` 非空），尚未确认送达
 *   delivered 桌面 relay 已确认送达（有证据 + 会话路径 + 定位层），且原状态必须是 pending
 *   failed    投递失败，已按降级链回退（channel=gui-file-fallback 时文件交接件仍在，任务不丢）
 *
 * 审计口径（AF-024 评审整改）：
 *   - 只有 `channel === 'gui-relay'` 的记录才能被 confirm / fallback，file 通道不得伪装成 GUI 送达；
 *   - 会话路径与定位层必须取自 `dispatch-channel.mjs` 的枚举，不得填形式化字符串；
 *   - 证据指针与交接件指针必须能在仓内解析到真实文件；
 *   - 降级清空上一次的定位痕迹，失败原因与定性进 `history`，不被后续确认覆盖。
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { LOCATE_LAYERS, SESSION_PATHS } from './dispatch-channel.mjs';

/** 投递状态枚举。 */
export const DELIVERY_STATES = ['pending', 'delivered', 'failed'];

/** 投递失败定性（对齐 reliability.md §4.2 三分法）。 */
export const DELIVERY_FAILURE_CLASSES = ['deterministic', 'flaky', 'legacy-debt'];

/** 降级后的通道标识：文件 Transport 仍在，任务不丢，但必须在记录里写明降级事实。 */
export const CHANNEL_GUI_FALLBACK = 'gui-file-fallback';

/** 投递件目录（相对 transport 根）。 */
export const BRIEF_DIR_NAME = 'briefs';

/** 默认 GUI 投递租约（分钟）：桌面投递是分钟级动作，不应复用 30 分钟任务租约占满单任务队列。 */
export const DEFAULT_DELIVERY_LEASE_MINUTES = 5;

function safeName(value) {
  return String(value ?? 'unnamed').replace(/[\\/:*?"<>|\s]+/g, '-');
}

function repoPath(ref, repoRoot) {
  if (!ref) return null;
  return isAbsolute(ref) ? ref : resolve(repoRoot, ref);
}

/** 投递件文件名：`<taskId>.brief.md`。 */
export function briefFileName(taskId) {
  return `${safeName(taskId)}.brief.md`;
}

/** 投递租约截止时间：`preparedAt + dispatch.deliveryLeaseMinutes`（缺省 5 分钟）。 */
export function deliveryDeadline(record, opts = {}) {
  const minutes = Number(opts.deliveryLeaseMinutes ?? DEFAULT_DELIVERY_LEASE_MINUTES);
  const base = record?.delivery?.preparedAt ?? record?.dispatchedAt;
  if (!base) return null;
  return new Date(new Date(base).getTime() + minutes * 60_000).toISOString();
}

/**
 * 生成投递件文案（给执行代理人读的派发简报）。
 * 只含任务契约字段与「怎么回执」，不含编排内部状态、不含对话原文。
 * @param {object} task 索引任务条目
 * @param {object} handover 交接件（transport/tasks/<taskId>.json 的 payload）
 * @param {{receiptPath?:string, reviewPath?:string, extra?:string}} opts
 * @returns {{taskId:string, text:string, sections:string[]}}
 */
export function buildGuiBrief(task, handover, opts = {}) {
  if (!task?.taskId) throw new Error('投递件生成失败：缺 taskId');
  const sections = [];
  const lines = [];
  const deliveryRecord = task.artifacts?.deliveryRecord ?? task.plannedArtifacts?.[0]?.path ?? '(见任务单 plannedArtifacts)';
  lines.push(`# 任务派发：${task.taskId} · ${task.title ?? '(无标题)'}`);
  lines.push('');
  lines.push('## 1. 任务契约');
  lines.push('');
  lines.push(`- 任务单：${task.artifacts?.taskSheet ?? '(缺任务单指针)'}`);
  lines.push(`- 上下文：${task.contextId ?? '-'}`);
  lines.push(`- 类型：${task.type ?? '-'}`);
  lines.push(`- 基线：${task.baselineRef ?? '-'}`);
  lines.push(`- 依赖：${(task.dependsOn ?? []).join('、') || '无'}`);
  lines.push(`- 交付记录落点：${deliveryRecord}`);
  sections.push('任务契约');

  const scope = task.scope?.files ?? [];
  lines.push('');
  lines.push('## 2. 改动范围（越界即判残留）');
  lines.push('');
  for (const item of scope.length > 0 ? scope : ['(任务单未列 scope)']) lines.push(`- ${item}`);
  sections.push('改动范围');

  const gates = handover?.gates ?? task.gates ?? [];
  if (gates.length > 0) {
    lines.push('');
    lines.push('## 3. 闸门（必须自己跑并回填真实数字）');
    lines.push('');
    for (const gate of gates) {
      lines.push(`- \`${gate.command}\` — ${gate.check ?? '通过'}${gate.threshold ? `（${gate.threshold}）` : ''}`);
    }
    sections.push('闸门');
  }

  const criteria = handover?.successCriteria ?? task.successCriteria ?? [];
  if (criteria.length > 0) {
    lines.push('');
    lines.push('## 4. 验收标准');
    lines.push('');
    for (const item of criteria) lines.push(`- ${item}`);
    sections.push('验收标准');
  }

  lines.push('');
  lines.push('## 5. 回执约定');
  lines.push('');
  lines.push(
    `完成后把机读回执写到 \`${opts.receiptPath ?? `docs/team/agent-orchestration/transport/receipts/${safeName(task.taskId)}.json`}\`（` +
      '`receipt 1.0.0` 七组字段：artifactRefs / changedFiles / gateResults / contractChecks / fieldAlignment / backlogItems / openQuestions）。',
  );
  lines.push('不要把「已写代码」当成「已交付」：闸门数字必须是真实执行结果，失败要写报错原因，不要静默跳过。');
  if (opts.reviewPath) {
    lines.push('');
    lines.push(`协商意见请另写 \`${opts.reviewPath}\`（review 1.1.0），与本任务回执分开。`);
  }
  if (opts.extra) {
    lines.push('');
    lines.push(opts.extra);
  }
  sections.push('回执约定');

  return { taskId: task.taskId, text: `${lines.join('\n')}\n`, sections };
}

/**
 * 落盘投递件（薄 IO）。返回绝对路径。
 * @param {{transportDir:string, taskId:string, text:string}} input
 * @returns {string} 投递件绝对路径
 */
export function writeGuiBrief(input) {
  const dir = join(input.transportDir, BRIEF_DIR_NAME);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const path = join(dir, briefFileName(input.taskId));
  writeFileSync(path, input.text, 'utf8');
  return path;
}

/**
 * 投递确认：桌面 relay 已把投递件送进执行代理会话并校验通过。
 * 守卫（AF-024 评审 P0 整改）：
 *   - 通道必须是 gui-relay（file 通道不得凭空变成 delivered）；
 *   - 原状态必须是 pending（failed 不得回退成 delivered）；
 *   - 会话路径 / 定位层必须取自枚举；
 *   - 证据指针必须能在仓内解析到真实文件。
 * @param {object|null} record 派发记录
 * @param {{sessionPath:string, locateLayer:string, evidenceRef:string, at?:string, repoRoot?:string}} evidence
 * @returns {{valid:boolean, errors:string[], record:object|null}}
 */
export function confirmDelivery(record, evidence = {}) {
  const errors = [];
  const repoRoot = evidence.repoRoot ?? process.cwd();
  if (!record || typeof record !== 'object') return { valid: false, errors: ['确认失败：缺派发记录'], record: null };
  if (record.channel !== 'gui-relay') {
    errors.push(`确认失败：通道 ${String(record.channel)} 不是 gui-relay，不得确认 GUI 送达`);
  }
  if (record.delivery?.state !== 'pending') {
    errors.push(`确认失败：投递状态须为 pending，当前 ${String(record.delivery?.state)}`);
  }
  if (!SESSION_PATHS.includes(evidence.sessionPath)) {
    errors.push(`确认失败：会话路径非法（须为 ${SESSION_PATHS.join(' / ')}）：${String(evidence.sessionPath)}`);
  }
  if (!LOCATE_LAYERS.includes(evidence.locateLayer)) {
    errors.push(`确认失败：定位层非法（须为 ${LOCATE_LAYERS.join(' / ')}）：${String(evidence.locateLayer)}`);
  }
  const evidencePath = repoPath(evidence.evidenceRef, repoRoot);
  if (!evidence.evidenceRef || !evidencePath || !existsSync(evidencePath)) {
    errors.push('确认失败：证据指针不可解析（须为仓内真实文件）');
  }
  if (errors.length > 0) return { valid: false, errors, record: null };

  const at = evidence.at ?? new Date().toISOString();
  const history = Array.isArray(record.delivery?.history) ? record.delivery.history : [];
  return {
    valid: true,
    errors: [],
    record: {
      ...record,
      delivery: {
        ...record.delivery,
        state: 'delivered',
        deliveredAt: at,
        verifiedAt: at,
        sessionPath: evidence.sessionPath,
        locateLayer: evidence.locateLayer,
        evidenceRef: evidence.evidenceRef,
        failureReason: null,
        classification: null,
        history,
      },
    },
  };
}

/**
 * 投递失败 / 降级：保持文件交接件可用，把通道标成降级事实并留原因与定性。
 * 守卫（AF-024 评审 P1 整改）：通道须为 gui-relay、交接件须真实存在、失败定性须在枚举内；
 * 降级清空上一次的定位痕迹，旧记录压入 `history` 保留审计。
 * @param {object|null} record 派发记录
 * @param {{reason:string, classification?:string, at?:string, attempted?:Array<object>, repoRoot?:string, facts?:object}} failure
 *   `facts` 是 relay 上报的现场事实（`cause` / `loginGate` / `startRetries` / `sendRetries` /
 *   `sessionAttempted` / `locateAttempted` / `attemptCount` / `processRunning` / `windowReady`），
 *   供 IM-028 运行时决策链（`dispatch-channel.mjs#resolveDispatchDecision`）在回收环节复用。
 * @returns {{valid:boolean, errors:string[], record:object|null}}
 */
export function fallbackDelivery(record, failure = {}) {
  const errors = [];
  const repoRoot = failure.repoRoot ?? process.cwd();
  if (!record || typeof record !== 'object') return { valid: false, errors: ['降级失败：缺派发记录'], record: null };
  if (record.channel !== 'gui-relay') {
    errors.push(`降级失败：通道 ${String(record.channel)} 不是 gui-relay，无从降级`);
  }
  if (!failure.reason) errors.push('降级失败：缺失败原因（不得静默降级）');
  if (failure.classification && !DELIVERY_FAILURE_CLASSES.includes(failure.classification)) {
    errors.push(`降级失败：失败定性非法：${failure.classification}`);
  }
  const handoverPath = repoPath(record.handoverRef, repoRoot);
  if (!record.handoverRef || !handoverPath || !existsSync(handoverPath)) {
    errors.push('降级失败：文件交接件不可解析（降级前提是文件 Transport 仍然在）');
  }
  if (errors.length > 0) return { valid: false, errors, record: null };

  const at = failure.at ?? new Date().toISOString();
  const previous = failure.attempted ?? (record.delivery?.state ? [{ ...record.delivery }] : []);
  const history = [...(Array.isArray(record.delivery?.history) ? record.delivery.history : []), ...previous];
  return {
    valid: true,
    errors: [],
    record: {
      ...record,
      channel: CHANNEL_GUI_FALLBACK,
      delivery: {
        state: 'failed',
        preparedAt: record.delivery?.preparedAt ?? null,
        briefRef: record.delivery?.briefRef ?? null,
        failedAt: at,
        failureReason: failure.reason,
        classification: failure.classification ?? 'deterministic',
        lastAttempt: failure.facts ? { ...failure.facts } : null,
        // IM-017：按通道累计连续失败次数（成功后由 buildDispatchRecord 归零），供熔断判定读取。
        consecutiveFailures: Number(record.delivery?.consecutiveFailures ?? 0) + 1,
        sessionPath: null,
        locateLayer: null,
        evidenceRef: null,
        history,
      },
    },
  };
}

/**
 * 投递是否需要人工处理：pending 且已超过投递租约，或已 failed。
 * @param {object|null} record
 * @param {{now?:string, deliveryLeaseMinutes?:number}} opts
 */
export function isDeliveryStalled(record, opts = {}) {
  if (record?.delivery?.state === 'failed') return true;
  if (record?.delivery?.state !== 'pending') return false;
  const deadline = deliveryDeadline(record, opts);
  if (!deadline) return false;
  const now = opts.now ?? new Date().toISOString();
  return new Date(deadline).getTime() <= new Date(now).getTime();
}
