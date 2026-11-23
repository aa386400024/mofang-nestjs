/**
 * AF-023 · 回执摄取（adapter 层；文件 Transport → 状态索引的桥）。
 *
 * 现状缺口：`watch` 监听 `transport/receipts/`，但调度器只读任务索引里预填的
 * `artifacts.deliveryRecord`；执行代理回交的机读回执从未被消费。本模块补齐：
 *   - 扫描 receipts 目录，兼容 `{deliveredAt,payload}` 包装与裸回执；
 *   - 按 taskId 取最新一份，校验七组字段与工件指针；
 *   - 把 `artifactRefs` 投影到任务运行态 artifacts，供 acceptance runner 的 V1–V7 使用；
 *   - 以回执指纹幂等，同一回执重复落盘不重复验收。
 *
 * 边界：只读写 transport 目录与运行态条目；不迁移状态、不归档、不改交付记录正文。
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, relative, resolve } from 'node:path';
import { PATHS, REPO_ROOT, nowIso } from './state-store.mjs';
import { validateReceiptHandover } from './handover-contract.mjs';
import { findBundledReceipt, copyReceiptToBundle, ensureTaskRecordBundle } from './worklog.mjs';

/**
 * 回执指纹：整份回执文件的 sha256（含包装层），用于「内容有没有被改」的审计。
 * 只进运行态与动作日志，不进状态索引（框架 1.1.0 索引契约没有这个字段位）。
 */
export function receiptDigest(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

/**
 * 发布者标识：优先回执自报的 publisher，其次 agentRole，认不出来记 unspecified。
 * 本机信任模型下不验签，只保证「谁写的」这一事实被留痕，可审计、可追责。
 */
export function receiptPublisher(receipt) {
  const raw = receipt?.publisher ?? receipt?.agentRole ?? receipt?.agentRef;
  const value = typeof raw === 'string' ? raw.trim() : '';
  return value.length > 0 ? value : 'unspecified';
}

/** 回执终态：completed 进入验收；其余终态由 scheduler 走失败/取消/拒绝闭合。 */
const RECEIPT_TERMINAL = ['completed', 'failed', 'rejected', 'canceled'];

function readReceiptFile(file) {
  const record = JSON.parse(readFileSync(file, 'utf8'));
  const receipt = record?.payload ?? record;
  const deliveredAt = record?.deliveredAt ?? null;
  return { receipt, deliveredAt, file };
}

function receiptIdentity(receipt, file) {
  return receipt?.receiptId ?? `${receipt?.taskId ?? 'unknown'}|${receipt?.artifactRefs?.deliveryRecord ?? ''}|${file}`;
}

function receiptFingerprint(receipt) {
  return [
    receiptIdentity(receipt, ''),
    receipt?.finalStatus ?? '',
    receipt?.artifactRefs?.deliveryRecord ?? '',
    receipt?.artifactRefs?.reply ?? '',
  ].join('|');
}

function receiptArtifacts(receipt) {
  const refs = receipt?.artifactRefs ?? {};
  const artifacts = {};
  for (const key of ['taskSheet', 'deliveryRecord', 'reply']) {
    if (typeof refs[key] === 'string' && refs[key].length > 0) artifacts[key] = refs[key];
  }
  if (Array.isArray(refs.others) && refs.others.length > 0) artifacts.others = refs.others;
  return artifacts;
}

/** 把已摄入回执复制到 `docs/worklog/pending/archive/`，transport 只作收件箱。 */
function archiveReceiptFile(file, receipt, taskId, archiveDir) {
  if (!archiveDir) return null;
  mkdirSync(archiveDir, { recursive: true });
  const safeId = String(receipt.receiptId ?? `${taskId}-${Date.now()}`).replace(/[^A-Za-z0-9_.-]/g, '-');
  const dest = join(archiveDir, `${taskId}-receipt-${safeId}.json`);
  if (!existsSync(dest)) copyFileSync(file, dest);
  return relative(REPO_ROOT, dest).split('\\').join('/');
}

/**
 * transport 里的任务单是运行态收件箱（默认 gitignore），归档前复制一份到
 * `docs/worklog/records/<context>/<taskId>/task-sheet.md`，并把索引指针切到规范路径。
 * 已经是记录包的任务只补 manifest，不重复搬运。
 * @param {object} task 索引任务条目（就地改写 artifacts.taskSheet）
 * @returns {string|null} 归档后的任务单指针
 */
export function archiveTaskSheetFile(task) {
  const ref = task?.artifacts?.taskSheet;
  if (typeof ref !== 'string' || ref.length === 0) return ref ?? null;
  const abs = resolve(REPO_ROOT, ref);
  if (ref.startsWith('docs/worklog/records/')) {
    // 已入包即不可变：归档阶段只允许确认存在，绝不再写 manifest / 任务单。
    if (existsSync(abs)) return ref;
  }
  if (!existsSync(abs)) return ref;
  const lifecycle =
    ref.startsWith('docs/team/agent-orchestration/transport/') ||
    ref.startsWith('docs/worklog/inbox/') ||
    ref.startsWith('docs/worklog/pending/');
  if (!lifecycle) return ref;
  try {
    const bundle = ensureTaskRecordBundle(task, { sourceSheetPath: abs, status: task.status });
    task.artifacts = { ...(task.artifacts ?? {}), taskSheet: bundle.taskSheetPath };
    return bundle.taskSheetPath;
  } catch {
    return ref;
  }
}

/**
 * 扫描并摄取回执。每个 taskId 只取最新一份；返回按 taskId 的摄取结果。
 * @param {object} index 状态索引（就地写 task.artifacts / task.receipt）
 * @param {object} runtimeState 运行态（就地写 entry.receipt*）
 * @param {{dir?:string, actions?:object[]}} opts
 * @returns {{ingested:number, invalid:number, results:object[]}}
 */
export function ingestReceipts(index, runtimeState, opts = {}) {
  const dir = opts.dir ?? join(PATHS.transportDir, 'receipts');
  const actions = opts.actions ?? [];
  if (!existsSync(dir)) return { ingested: 0, invalid: 0, results: [] };

  const files = readdirSync(dir).filter((f) => f.endsWith('.json'));
  const latestByTask = new Map();
  for (const name of files) {
    const file = join(dir, name);
    let parsed;
    try {
      parsed = readReceiptFile(file);
    } catch (err) {
      actions.push({ type: 'receipt-invalid', file: name, errors: [`JSON 解析失败：${err.message}`] });
      continue;
    }
    const taskId = parsed.receipt?.taskId;
    if (!taskId) {
      actions.push({ type: 'receipt-invalid', file: name, errors: ['回执缺 taskId'] });
      continue;
    }
    const stamp = Date.parse(parsed.deliveredAt ?? '') || statSync(file).mtimeMs;
    const previous = latestByTask.get(taskId);
    if (!previous || stamp > previous.stamp) latestByTask.set(taskId, { ...parsed, stamp, file });
  }

  let ingested = 0;
  let invalid = 0;
  const results = [];
  for (const task of index.tasks ?? []) {
    const heldReady = task.status === 'ready' && runtimeState.tasks?.[task.taskId]?.heldForHuman === true;
    if (task.status !== 'submitted' && task.status !== 'working' && !heldReady) continue;
    const candidate = latestByTask.get(task.taskId);
    if (!candidate) continue;
    const { receipt, file } = candidate;
    const entry = runtimeState.tasks?.[task.taskId];
    if (!entry) continue;

    const fingerprint = receiptFingerprint(receipt);
    if (entry.ingestedReceiptFingerprint === fingerprint) continue;

    const validation = validateReceiptHandover(receipt);
    if (!validation.valid) {
      invalid += 1;
      entry.receiptErrors = validation.errors;
      actions.push({ type: 'receipt-invalid', taskId: task.taskId, file, errors: validation.errors });
      continue;
    }
    if (!RECEIPT_TERMINAL.includes(receipt.finalStatus)) {
      invalid += 1;
      entry.receiptErrors = [`finalStatus 非法：${String(receipt.finalStatus)}`];
      actions.push({ type: 'receipt-invalid', taskId: task.taskId, file, errors: entry.receiptErrors });
      continue;
    }

    // 机读回执与交付记录成对：索引只存指针，正文留在 worklog。
    const artifacts = receiptArtifacts(receipt);
    // AF-373：回执必须先随实现提交进记录包；摄入阶段不再补写，避免提交后产生脏文件。
    const bundled = opts.requireBundled ? findBundledReceipt(task, file, receipt) : null;
    if (opts.requireBundled && !bundled) {
      invalid += 1;
      entry.receiptErrors = [
        `回执未冻结：${task.taskId} → transport 回执未以同一内容哈希进入 docs/worklog/records；先运行 receipt freeze --taskId ${task.taskId} --apply 并提交`,
      ];
      actions.push({ type: 'receipt-not-frozen', taskId: task.taskId, file });
      continue;
    }
    task.artifacts = { ...(task.artifacts ?? {}), ...artifacts };
    // 长期审计：兼容显式 archiveDir 的旧路径；正常路径只认已冻结副本。
    const archiveRef = opts.archiveDir
      ? archiveReceiptFile(file, receipt, task.taskId, opts.archiveDir)
      : (bundled?.path ?? copyReceiptToBundle(task, file, receipt).ref);
    task.receipt = {
      receiptId: receipt.receiptId ?? null,
      finalStatus: receipt.finalStatus,
      reviewVerdict: receipt.reviewVerdict ?? null,
      changedFiles: receipt.changedFiles ?? null,
      parallelArtifactsExcluded: receipt.parallelArtifactsExcluded === true,
      sourceRef: file,
      archiveRef,
      ingestedAt: nowIso(),
    };
    entry.ingestedReceiptFingerprint = fingerprint;
    entry.receiptRef = file;
    if (archiveRef) {
      // 回执副本指针只留在 task.receipt 与运行态：索引 artifacts 在框架
      // task-state-index 1.1.0 里只允许 taskSheet / deliveryRecord / reply / others，
      // 往里塞 receipt 会让索引 schema 校验失败。
      entry.receiptArchiveRef = archiveRef;
    }
    entry.receiptStatus = receipt.finalStatus;
    entry.receiptIngestedAt = task.receipt.ingestedAt;
    // 可信度留痕：内容指纹 + 发布者，写入运行态与动作日志（索引契约无此字段位）。
    entry.receiptDigest = receiptDigest(file);
    entry.receiptPublisher = receiptPublisher(receipt);
    delete entry.receiptErrors;
    ingested += 1;
    results.push({ taskId: task.taskId, receipt, file, artifacts });
    actions.push({
      type: 'receipt-ingested',
      taskId: task.taskId,
      finalStatus: receipt.finalStatus,
      publisher: entry.receiptPublisher,
      digest: entry.receiptDigest,
      file,
    });
  }
  return { ingested, invalid, results };
}

export { receiptFingerprint as ingestReceiptFingerprint, receiptArtifacts };
