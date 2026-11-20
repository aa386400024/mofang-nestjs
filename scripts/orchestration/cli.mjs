/**
 * L2 编排工具链 CLI 入口。
 *
 * 子命令：
 *   status                 打印队列概览计数与任务列表（读快照；无快照则按当前索引构建）
 *   run-once               执行一轮状态机推进并落盘索引 / 运行态 / 快照
 *   watch                  监听任务单 / 回执目录，变更防抖后自动执行一轮 run-once
 *   protocol               导出标准协议视图（protocolView 只读映射投影）
 *   snapshot               仅刷新队列快照（不推进验收与返修）
 *   pack                   生成夜间交付包（JSON + MD 副本）
 *   archive <taskId>       显式归档活跃任务到 archivedTasks（补工件指针与终态）
 *   improvements           候选改进台账：list / extract / add / transition
 *   validate [--sheet f]   AF-006 框架 schema 机读校验（索引 / 工具契约目录 / 协议视图 / Agent Card / Review 交接件 / 交付包）
 *   config --enable        开启自治模式（写回 config.json）
 *   config --disable       关闭自治模式
 *
 * 用法（pnpm，禁裸 npx）：`pnpm orchestration:<subcommand>`，入口在 package.json。
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import {
  PATHS,
  REPO_ROOT,
  loadConfig,
  loadIndex,
  loadRuntimeState,
  nowIso,
  saveConfigPatch,
  saveRuntimeState,
  writeJsonAtomic,
} from './state-store.mjs';
import { advanceOnce, buildSnapshot, cancelTask, promoteTask, shouldAdvance } from './scheduler.mjs';
import {
  frameworkDir,
  requireFramework,
  validateAgentCard,
  validateDeliveryPackage,
  validateProtocolView,
  validateReviewHandoverSchema,
  validateReceiptSchema,
  validateTaskIndex,
  validateTaskSheet,
  validateToolDir,
} from './validator.mjs';
import {
  archiveTask as archiveTaskEvent,
  backfillJournalFromIndex,
  commitIndex,
  createTask,
  journalIntegrity,
  loadJournal,
  rebuildIndex,
  rotateJournal,
  loadJournalSegment,
  rechainEvents,
  saveJournalSegment,
  segmentEntryPoint,
  validateJournalSchema,
  verifyProjection,
} from './event-store.mjs';
import { loadRegistry, call as registryCall } from './tool-registry.mjs';
import { loadAuditLog, saveAuditLog } from './audit-log.mjs';
import { createWatcher } from './file-watcher.mjs';
import { generateDeliveryPack } from './delivery-pack.mjs';
import {
  addCandidate,
  extractFromReceiptDoc,
  extractFromSnapshot,
  listOpen,
  loadImprovementLog,
  saveImprovementLog,
  summarizeLog,
  transitionImprovement,
} from './improvement-log.mjs';
import {
  buildBranchName,
  classifyBranches,
  planCleanup,
  verifyBaseline,
  branchAgeDays,
  createGitPort,
  collectChangedFiles,
  finalizeSquashMerge,
  DEFAULT_STALE_DAYS,
} from './branch-workflow.mjs';
import { SESSION_PATHS, LOCATE_LAYERS, MAX_START_RETRIES, MAX_SEND_RETRIES, canDispatch, DELIVERY_CAUSES } from './dispatch-channel.mjs';
import { evaluateRemoteCiGate } from './ci-status.mjs';
import {
  buildGuiBrief,
  writeGuiBrief,
  confirmDelivery,
  fallbackDelivery,
  isDeliveryStalled,
  autoConfirmDelivery,
} from './gui-dispatch.mjs';
import { acquireClusterRunLock, describeRunLock } from './run-lock.mjs';
import { createGitRemoteLock, describeRemoteRunLock } from './remote-lock.mjs';
import { collectOccupiedTaskIds, nextTaskId } from './task-id-occupancy.mjs';
import { createGitTaskIdReservation, pickReservedTaskId, reservationRef } from './task-id-reservation.mjs';
import { planReissue } from './reissue.mjs';
import { lintReceiptFile } from './receipt-lint.mjs';
import { excludeStatePlane } from './task-entry-gate.mjs';
import { inspectTextFile, normalizeTextFile } from './text-normalize.mjs';
import { ensureTaskRecordBundle, migrateWorklog, resolveTaskSheet, statsWorklog, verifyWorklog } from './worklog.mjs';

/**
 * AF-217 归档前置：scope 内是否还有「实现」未进版本库。
 *
 * 状态面生成物（索引 / 事件 / 快照 / 回执 records）由 run-once 本轮自己写入，
 * 把它们算作「未提交实现」会让归档永远被自己阻断，因此必须先剔除。
 */
function uncommittedImplementation(gitPort, task) {
  return excludeStatePlane(gitPort.uncommittedWithin(task.scope?.files ?? []));
}

/** 快照双写：JSON（机读 / 存档）+ data.js（静态网页在 file:// 下读取，规避本地 fetch 限制）。 */
function writeSnapshotArtifacts(snapshot, opts = {}) {
  // 运行态快照是派生视图：空跑 / 仅时间戳变化时不重写，避免每次 watch tick 制造脏 diff。
  if (!opts.force && existsSync(PATHS.snapshot)) {
    try {
      const previous = JSON.parse(readFileSync(PATHS.snapshot, 'utf8'));
      const comparable = (value) => {
        const { generatedAt: _generatedAt, ...rest } = value;
        return JSON.stringify(rest);
      };
      if (comparable(previous) === comparable(snapshot)) return false;
    } catch {
      // 快照损坏时直接覆盖，交给后续校验兜底。
    }
  }
  writeJsonAtomic(PATHS.snapshot, snapshot);
  writeFileSync(PATHS.webDataJs, `// 由 orchestration CLI 生成，勿手改\nwindow.ORCH_SNAPSHOT = ${JSON.stringify(snapshot, null, 2)};\n`, {
    encoding: 'utf8',
  });
  return true;
}

/**
 * 重建快照并双写 JSON + data.js，供变更类命令尾部自动刷新看板数据。
 * 索引缺失等读取异常时跳过刷新并告警，不阻断台账 / 交付包等已落盘产物。
 * @returns {object|null} 快照对象；跳过刷新时为 null。
 */
function refreshSnapshotArtifacts(opts = {}) {
  try {
    const config = loadConfig();
    const snapshot = buildSnapshot(loadIndex(), loadRuntimeState(), config, summarizeLog(loadImprovementLog()));
    writeSnapshotArtifacts(snapshot, opts);
    return snapshot;
  } catch (err) {
    console.warn(`[snapshot] 跳过快照刷新：${err.message}`);
    return null;
  }
}

/** 经注册表登记一次工具调用审计并落盘；返回注册表调用结果。 */
function auditRegistryCall(toolId, ctx) {
  const registry = loadRegistry();
  const auditLog = loadAuditLog();
  const result = registryCall(registry, toolId, ctx, auditLog);
  saveAuditLog(auditLog);
  return result;
}

/** 调度类动作逐条落审计（派发通道 / 交接件指针 / 文件域冲突）；复用队列调度器工具契约。 */
function auditDispatchActions(actions) {
  for (const action of actions ?? []) {
    if (action.type === 'scope-conflict') {
      const conflictTaskIds = (action.conflicts ?? []).map((c) => c.taskId);
      auditRegistryCall('TOOL-QUEUE-SCHEDULER', {
        actor: 'orchestrator',
        correlationId: `scope-conflict:${action.taskId}`,
        taskId: action.taskId,
        resources: conflictTaskIds,
        reason: `文件域与在办任务相交：${conflictTaskIds.join(', ')}`,
      });
      continue;
    }
    if (action.type !== 'dispatch' && action.type !== 'dispatch-rejected') continue;
    auditRegistryCall('TOOL-QUEUE-SCHEDULER', {
      actor: 'orchestrator',
      correlationId: `dispatch:${action.taskId}`,
      taskId: action.taskId,
      resources: action.handoverRef ? [action.handoverRef] : [],
    });
  }
}

function printSnapshot(snapshot) {
  const c = snapshot.counts;
  console.log('=== 队列概览 ===');
  console.log(`生成时间：${snapshot.generatedAt}`);
  console.log(`自治模式：${snapshot.mode.autoLoopEnabled ? '开启' : '关闭'}；返修上限：${snapshot.mode.reworkLimit}`);
  console.log(
    `计数（活跃）：ready=${c.ready} submitted=${c.submitted} working=${c.working} completed=${c.completed} failed=${c.failed} canceled=${c.canceled} rejected=${c.rejected} input-required=${c['input-required']} deadLetter=${c.deadLetter}`,
  );
  console.log(`归档任务：${snapshot.archivedCount ?? 0}`);
  console.log('');
  console.log('=== 任务列表 ===');
  if (snapshot.tasks.length === 0) {
    console.log('（无活跃任务）');
  }
  for (const t of snapshot.tasks) {
    const verdict = t.verdict ?? '—';
    console.log(
      `${t.taskId} [${t.status}] ${t.type}｜${t.title}｜结论=${verdict}｜返修=${t.attemptCount}${t.reworkOf ? `｜返修自=${t.reworkOf}` : ''}`,
    );
  }
  if (snapshot.deadLetters.length > 0) {
    console.log('');
    console.log('=== 死信 ===');
    for (const d of snapshot.deadLetters) console.log(`${d.taskId}：${d.escalation?.waiting ?? '待人工裁决'}`);
  }
  if (snapshot.reworkProposals.length > 0) {
    console.log('');
    console.log('=== 返修提案 ===');
    for (const p of snapshot.reworkProposals) console.log(`${p.proposalId}：自 ${p.originalTaskId}，${p.rationale}`);
  }
}

function readSnapshot() {
  if (!existsSync(PATHS.snapshot)) return null;
  return JSON.parse(readFileSync(PATHS.snapshot, 'utf8'));
}

function cmdStatus() {
  const snapshot = readSnapshot() ?? buildSnapshot(loadIndex(), loadRuntimeState(), loadConfig(), summarizeLog(loadImprovementLog()));
  printSnapshot(snapshot);
  printOperationalHealth();
}

/**
 * 可观测性最小集（只读投影，不参与状态迁移）：
 * 死信、人工持单、租约过期释放、回执校验失败、回执无指纹（旧数据）、单写者锁。
 * 这些计数以前只能翻 json 才看得到，出了事没人叫得醒；现在每次 status 一行带出。
 */
function printOperationalHealth() {
  const index = loadIndex();
  const runtime = loadRuntimeState();
  const entryOf = (id) => runtime.tasks?.[id] ?? {};
  const tasks = index.tasks ?? [];
  const deadLetter = tasks.filter((t) => t.status === 'deadLetter').length;
  const heldForHuman = tasks.filter((t) => entryOf(t.taskId).heldForHuman === true).length;
  const leaseExpired = Object.values(runtime.tasks ?? {}).filter((e) => e.releaseReason === 'lease-expired').length;
  const receiptErrors = Object.entries(runtime.tasks ?? {}).filter(([, e]) => Array.isArray(e.receiptErrors) && e.receiptErrors.length > 0);
  const receiptNoDigest = Object.values(runtime.tasks ?? {}).filter((e) => e.receiptStatus && !e.receiptDigest).length;
  const lock = describeRunLock();

  console.log('=== 运行健康 ===');
  console.log(
    `死信=${deadLetter} 人工持单=${heldForHuman} 租约过期释放=${leaseExpired} 回执校验失败=${receiptErrors.length} 回执无指纹=${receiptNoDigest}`,
  );
  if (receiptErrors.length > 0) {
    for (const [taskId, e] of receiptErrors.slice(0, 5)) console.log(`  ${taskId}：${e.receiptErrors[0]}`);
  }
  console.log(
    lock
      ? `单写者锁：运行中（pid=${lock.pid ?? '?'} host=${lock.host ?? '?'} 已持 ${lock.heldMinutes ?? '?'} 分钟${lock.stale ? '，已超陈旧阈值' : ''}）`
      : '单写者锁：空闲',
  );
  // AF-217：跨机层单独一行。远端不可读不抛错，而是明确写成「不可读」，避免把网络问题伪装成空闲。
  const mode = remoteLockMode();
  if (!mode) {
    console.log('远端单写者锁：未启用（ORCH_REMOTE_LOCK=0）');
    return;
  }
  let remoteLock = null;
  try {
    remoteLock = describeRemoteRunLock({ rootDir: REPO_ROOT });
  } catch (error) {
    remoteLock = { unavailable: true, error: error.message };
  }
  console.log(
    remoteLock === null
      ? '远端单写者锁：空闲'
      : remoteLock.unavailable
        ? `远端单写者锁：不可读（${remoteLock.error ?? '远端不可达，跨机无保护'}）`
        : `远端单写者锁：运行中（host=${remoteLock.host ?? '?'} actor=${remoteLock.actor ?? '?'} 已持 ${remoteLock.heldMinutes ?? '?'} 分钟${remoteLock.stale ? '，已超陈旧阈值' : ''}）`,
  );
}

/** AF-217：远端单写者模式（required / optional / 关闭）。 */
function remoteLockMode() {
  const raw = String(process.env.ORCH_REMOTE_LOCK ?? 'optional')
    .trim()
    .toLowerCase();
  if (raw === '0' || raw === 'off' || raw === 'false') return null;
  return raw === 'required' ? 'required' : 'optional';
}

/**
 * 单写者保护：本机文件锁 + 远端 ref CAS（AF-217）。
 * 远端不可达时的处置由 ORCH_REMOTE_LOCK 决定：required 拒绝执行；optional 降级并打印告警。
 */
function withRunLock(label, fn) {
  const mode = remoteLockMode();
  const remote = mode ? createGitRemoteLock({ rootDir: REPO_ROOT }) : null;
  const lock = acquireClusterRunLock({ actor: label, remote, mode: mode ?? 'optional' });
  if (!lock.acquired) {
    const held = lock.holder ?? lock.remote?.holder ?? {};
    console.log(
      `[lock] 另一轮${held.actor ? `（${held.actor}）` : ''}正在运行，本轮跳过：pid=${held.pid ?? '?'} host=${held.host ?? '?'} 自 ${held.acquiredAt ?? '?'}`,
    );
    if (lock.remote?.required)
      console.error(`[lock] 远端单写者锁不可用且 ORCH_REMOTE_LOCK=required：拒绝执行本轮（${lock.remote.error ?? '-'}）`);
    return null;
  }
  if (lock.remote?.degraded) {
    console.warn(
      `[lock] 远端单写者锁降级：${lock.remote.error ?? lock.remote.reason ?? '未配置'}；` +
        '本轮仅有本机互斥，跨机同时执行 run-once 仍可能覆盖状态面',
    );
  }
  if (lock.stolen)
    console.log(
      `[lock] 已清理本机陈旧锁：pid=${lock.stolen.pid ?? '?'} host=${lock.stolen.host ?? '?'} 自 ${lock.stolen.acquiredAt ?? '?'}`,
    );
  if (lock.remote?.stolen)
    console.log(`[lock] 已清理远端陈旧锁：host=${lock.remote.stolen.host ?? '?'} 自 ${lock.remote.stolen.acquiredAt ?? '?'}`);
  try {
    return fn();
  } finally {
    const released = lock.release();
    if (lock.remote?.acquired && released === false) {
      console.warn(
        '[lock] 远端锁 ref 释放失败；下一轮会在 45 分钟陈旧阈值后自愈，或手动 git push origin --delete refs/orchestration/locks/run-once',
      );
    }
  }
}

function cmdRunOnce() {
  return withRunLock('run-once', () => {
    const config = loadConfig();
    if (!shouldAdvance(config)) {
      console.log('自治模式关闭：本轮仅生成只读快照，不执行领单 / 验收归档 / 返修等状态迁移。');
    }
    auditRegistryCall('TOOL-QUEUE-SCHEDULER', { actor: 'orchestrator', correlationId: 'run-once' });
    // IM-009：采集本次变更文件清单供 V7 文件域残留比对；空清单时 V7 记 skip。
    const gitPort = createGitPort();
    const changedFiles = collectChangedFiles(gitPort);
    // AF-043-I1：回执声明了提交集合时，V7 按 commit 事实比对（不再拿工作树去套单个任务）。
    const resolveCommitFiles = (sha) => gitPort.filesInCommit(sha);
    const { snapshot, actions } = advanceOnce({
      commit: true,
      changedFiles,
      resolveCommitFiles,
      // AF-217：归档前置——scope 内实现还在工作区就不许归档。
      checkUncommitted: (task) => uncommittedImplementation(gitPort, task),
    });
    auditDispatchActions(actions);
    writeSnapshotArtifacts(snapshot);
    for (const action of actions) console.log(`[动作] ${action.type} ${action.taskId ?? ''}${action.reason ? `（${action.reason}）` : ''}`);
    console.log('');
    printSnapshot(snapshot);
  });
}

function cmdWatch() {
  const dirs = [
    join(REPO_ROOT, 'docs', 'worklog', 'pending'),
    join(REPO_ROOT, 'docs', 'worklog', 'completed'),
    join(PATHS.transportDir, 'tasks'),
    join(PATHS.transportDir, 'receipts'),
  ];
  const tick = (label, events = []) =>
    withRunLock('watch', () => {
      console.log(`[watch] ${label} ${events.length > 0 ? `变更 ${events.length} 项，` : ''}执行一轮 run-once`);
      auditRegistryCall('TOOL-QUEUE-SCHEDULER', { actor: 'orchestrator', correlationId: 'watch' });
      const gitPort = createGitPort();
      const changedFiles = collectChangedFiles(gitPort);
      const { snapshot, actions } = advanceOnce({
        commit: true,
        changedFiles,
        resolveCommitFiles: (sha) => gitPort.filesInCommit(sha),
        checkUncommitted: (task) => uncommittedImplementation(gitPort, task),
      });
      auditDispatchActions(actions);
      writeSnapshotArtifacts(snapshot);
      for (const action of actions)
        console.log(`[动作] ${action.type} ${action.taskId ?? ''}${action.reason ? `（${action.reason}）` : ''}`);
      printSnapshot(snapshot);
    });
  const watcher = createWatcher({
    dirs,
    debounceMs: 300,
    onChange(events) {
      tick('检测到', events);
    },
    onError(err) {
      console.error(`[watch] 监听错误：${err.message}`);
    },
  });
  console.log(`[watch] 监听目录：${dirs.join('、')}；启动先跑一轮，Ctrl+C 退出。`);
  tick('启动');
  const stop = () => {
    watcher.stop();
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

function cmdProtocol() {
  const snapshot = buildSnapshot(loadIndex(), loadRuntimeState(), loadConfig(), summarizeLog(loadImprovementLog()));
  console.log(JSON.stringify(snapshot.protocolView, null, 2));
}

function cmdSnapshot() {
  auditRegistryCall('TOOL-STATE-STORE', { actor: 'orchestrator', correlationId: 'snapshot' });
  const snapshot = refreshSnapshotArtifacts({ force: true });
  console.log(`快照已写入：${PATHS.snapshot}`);
  if (snapshot) printSnapshot(snapshot);
}

function cmdPack() {
  const { pack, jsonPath, mdPath } = generateDeliveryPack({ write: true });
  auditRegistryCall('TOOL-DELIVERY-PACK', { actor: 'orchestrator', correlationId: 'pack' });
  refreshSnapshotArtifacts();
  console.log(`交付包 JSON：${jsonPath}`);
  console.log(`交付包 MD ：${mdPath}`);
  console.log(
    `任务结论=${pack.tasks.length} 死信=${pack.deadLetters.length} 遗留项=${
      pack.leftovers.backlogItems.length + pack.leftovers.openQuestions.length + pack.leftovers.manualReviewList.length
    } 待批=${pack.pendingApprovals.length}`,
  );
}

/**
 * 显式归档活跃任务：迁移到 archivedTasks 并补写工件指针与终态（人工 / 编排者闸门动作）。
 * 覆盖事后补登的历史任务；运行态闭环任务的自动归档由 scheduler.processReceipts 负责。
 */
function cmdArchive(args) {
  const taskId = args[0];
  if (!taskId) {
    console.error(
      '用法：cli.mjs archive <taskId> [--status completed|rejected|canceled] [--sheet <file>] [--record <file>] [--reply <file>] [--note <text>]',
    );
    process.exit(2);
  }
  const status = argValue(args, '--status') ?? 'completed';
  const refs = {
    taskSheet: argValue(args, '--sheet'),
    deliveryRecord: argValue(args, '--record'),
    reply: argValue(args, '--reply'),
  };
  const artifacts = {};
  for (const [key, relPath] of Object.entries(refs)) {
    if (!relPath) continue;
    const abs = resolve(REPO_ROOT, relPath);
    if (!existsSync(abs)) throw new Error(`归档失败：工件文件不存在（${key}）：${relPath}`);
    artifacts[key] = relPath;
  }
  const note = argValue(args, '--note');

  const index = loadIndex();
  const current = [...(index.tasks ?? []), ...(index.archivedTasks ?? [])].find((task) => task.taskId === taskId);
  if (current) {
    // 记录包可能已迁移过；以 resolver 为准，避免把失效的旧指针写进归档事件。
    const resolved = resolveTaskSheet(current);
    if (resolved?.path) {
      const bundle = ensureTaskRecordBundle(current, { sourceSheetPath: resolved.path, status });
      artifacts.taskSheet = bundle.taskSheetPath;
    }
  }

  const entry = archiveTaskEvent(taskId, { status, artifacts, note, actor: 'orchestrator-cli' });
  auditRegistryCall('TOOL-QUEUE-SCHEDULER', { actor: 'orchestrator', correlationId: `archive:${taskId}` });
  refreshSnapshotArtifacts();
  console.log(`已归档：${entry.taskId} [${entry.status}]${note ? `｜${note}` : ''}`);
}

function cmdWorklog(args = []) {
  const action = args[0] ?? 'stats';
  const json = args.includes('--json');
  const index = loadIndex();
  if (action === 'verify') {
    const strict = args.includes('--strict');
    const result = verifyWorklog(index);
    const failed = !result.ok || (strict && result.warnings.length > 0);
    if (json) {
      console.log(JSON.stringify({ ...result, strict, ok: !failed }, null, 2));
    } else {
      console.log(
        `[worklog verify] ${failed ? 'FAIL' : 'PASS'}${strict ? ' (strict)' : ''} 活跃=${result.stats.activeTasks} 归档=${result.stats.archivedTasks} 记录包=${result.stats.bundles} inbox=${result.stats.inboxFiles} legacy指针=${result.stats.legacyPointers} 无任务单=${result.stats.missingTaskSheets}`,
      );
      for (const warning of result.warnings) console.warn(`  ! ${warning}`);
      for (const error of result.errors) console.error(`  - ${error}`);
    }
    if (failed) process.exitCode = 1;
    return { ...result, strict, ok: !failed };
  }
  if (action === 'stats') {
    const stats = statsWorklog(index);
    if (json) console.log(JSON.stringify(stats, null, 2));
    else {
      console.log(
        `[worklog stats] 活跃=${stats.activeTasks} 归档=${stats.archivedTasks} 记录包=${stats.bundles} 墓碑=${stats.tombstones} pending=${stats.pendingFiles} inbox=${stats.inboxFiles} 记录体积=${(stats.recordBytes / 1024).toFixed(1)}KB`,
      );
    }
    return stats;
  }
  if (action === 'migrate') {
    const apply = args.includes('--apply');
    const report = migrateWorklog(index, { apply });
    if (json) console.log(JSON.stringify(report, null, 2));
    else {
      console.log(
        `[worklog migrate] ${apply ? 'APPLY' : 'DRY-RUN'} 任务=${report.totals.tasks} 任务单=${report.totals.movedSheets} 回执=${report.totals.movedReceipts} pending清尾=${report.totals.orphanSheets} 错误=${report.totals.errors}`,
      );
      for (const error of report.errors) console.error(`  - ${error}`);
      if (!apply) console.log('  - 正式执行请追加 --apply（先跑一次 dry-run 核对计数）。');
    }
    if (report.totals.errors > 0) process.exitCode = 1;
    return report;
  }
  throw new Error(`未知 worklog 子命令：${action}（可选 migrate / verify / stats）`);
}

/**
 * 事件溯源命令：verify / rebuild / backfill / create。
 * `create` 只追加 created 事件；任务进入活跃列表后由 scheduler / archive 继续流转。
 */
async function cmdEvents(args = []) {
  const action = args[0] ?? 'verify';

  if (action === 'verify') {
    const events = loadJournal();
    const integrity = journalIntegrity(events);
    const schema = await validateJournalSchema(events);
    const projection = verifyProjection();
    const errors = [...integrity.errors, ...schema.errors, ...projection.errors];
    if (events.length === 0) errors.push('事件日志为空');
    if (errors.length > 0) {
      console.error(`事件日志校验失败：${errors.length} 项`);
      for (const error of errors) console.error(`   - ${error}`);
      process.exit(1);
    }
    console.log(`[PASS] 事件日志 ${events.length} 条；schema ${schema.schemaId ?? 'state-event'}；哈希链与索引投影一致`);
    return;
  }

  if (action === 'rebuild') {
    const index = rebuildIndex({ write: true });
    console.log(`已重建索引：任务 ${index.tasks.length}、归档 ${index.archivedTasks.length}、末条事件 ${index.projection.lastEventSeq}`);
    return;
  }

  if (action === 'backfill') {
    const res = backfillJournalFromIndex();
    if (!res.ok) throw new Error(res.errors.join('；'));
    console.log(`已回填事件 ${res.appended} 条；索引已由日志重建`);
    return;
  }

  if (action === 'create') {
    const taskId = argValue(args, '--task-id');
    if (!taskId)
      throw new Error(
        '用法：cli.mjs events create --task-id <id> --title <标题> --type <类型> [--status backlog] [--sheet <file>] [--record <file>]',
      );
    const artifacts = {};
    for (const [key, flag] of [
      ['taskSheet', '--sheet'],
      ['deliveryRecord', '--record'],
      ['reply', '--reply'],
    ]) {
      const relPath = argValue(args, flag);
      if (!relPath) continue;
      const abs = resolve(REPO_ROOT, relPath);
      if (!existsSync(abs)) throw new Error(`创建失败：工件文件不存在（${key}）：${relPath}`);
      artifacts[key] = relPath;
    }
    const index = createTask(
      {
        taskId,
        contextId: argValue(args, '--context') ?? null,
        type: argValue(args, '--type') ?? 'implementation',
        title: argValue(args, '--title') ?? taskId,
        status: argValue(args, '--status') ?? 'backlog',
        artifacts,
      },
      { actor: 'orchestrator-cli' },
    );
    const task = index.tasks.find((item) => item.taskId === taskId);
    console.log(`已创建：${taskId} [${task?.status ?? 'unknown'}]（事件已追加并重建索引）`);
    return;
  }

  if (action === 'rotate') {
    const maxEvents = Number(argValue(args, '--max-events') ?? 5000);
    const force = args.includes('--force');
    const compress = args.includes('--compress') || args.includes('--gzip');
    const dryRun = args.includes('--dry-run');
    const res = rotateJournal({ maxEvents, force, compress, dryRun });
    if (!res.rotated) {
      console.log(`未轮转：${res.reason}${res.segment ? `；候选段 ${res.segment}` : ''}`);
      return;
    }
    console.log(`已轮转：${res.events} 条（EV-${res.firstSeq} → EV-${res.lastSeq}）→ ${res.segment}`);
    console.log('当前 journal 已重建为空；事件总数与投影不变，请随后执行 events verify');
    return;
  }

  if (action === 'rechain') {
    const fromEventId = argValue(args, '--from');
    if (!fromEventId) throw new Error('用法：cli.mjs events rechain --from <EV-xxxx> [--apply]  从切点起重算当前段哈希链');
    const apply = args.includes('--apply');
    const events = loadJournalSegment();
    if (events.length === 0) throw new Error('当前 journal 段为空，无需重算');
    const res = rechainEvents(events, {
      fromEventId,
      ...(segmentEntryPoint(events) ?? {}),
    });
    if (!apply) {
      console.log(
        `[干跑] 切点 ${fromEventId}（本段第 ${res.cutIndex + 1} 条）：其后 ${events.length - res.cutIndex} 条将重编号并重算哈希；未写盘`,
      );
      return;
    }
    saveJournalSegment(res.events);
    console.log(`已重算：从 ${fromEventId} 起 ${events.length - res.cutIndex} 条（仅当前段）；请随后执行 events rebuild 与 verify`);
    return;
  }

  throw new Error(`未知 events 动作：${action}（允许 verify / rebuild / backfill / create / rotate / rechain）`);
}

/**
 * AF-012 任务分支流程：list（巡检分类）/ plan（基线与清理计划干跑）/ create / merge / cleanup。
 * 默认干跑校验；仅显式 --apply 调用变更型 git 端口。脚本不自动 commit / push，不触碰 master。
 */
function cmdBranch(args) {
  return runBranch(args);
}

async function runBranch(args) {
  const action = args[0] ?? 'list';
  const apply = args.includes('--apply');
  const git = createGitPort();
  const nowIso = new Date().toISOString();

  function collectBranches() {
    const { local, remote } = git.listBranches();
    return [...new Set(local)].map((name) => {
      const remoteRef = remote.find((r) => r.endsWith(`/${name}`)) ?? null;
      const date = git.ageFor(name);
      const ab = git.aheadBehind(name);
      return {
        name,
        remote: remoteRef ? remoteRef.split('/')[0] : null,
        merged: git.isMerged(name),
        ageDays: date ? branchAgeDays(`${date}T00:00:00.000Z`, nowIso) : null,
        aheadBy: ab.ahead,
        behindBy: ab.behind,
      };
    });
  }

  if (action === 'list') {
    const staleDays = Number(argValue(args, '--stale-days')) || DEFAULT_STALE_DAYS;
    const { merged, unmerged, stale, needsRebase } = classifyBranches(collectBranches(), { staleDays });
    console.log(
      `=== 分支巡检（已合并 ${merged.length} / 未合并 ${unmerged.length} / 待 rebase ${needsRebase.length} / 超期 ${stale.length}）===`,
    );
    for (const b of merged) console.log(`  [已合并] ${b.name}${b.remote ? `（远端 ${b.remote}）` : ''}`);
    for (const b of needsRebase) console.log(`  [待 rebase] ${b.name}（落后基线 ${b.behindBy} 个提交，保留待 rebase）`);
    for (const b of stale) console.log(`  [超期·未合并] ${b.name}（${b.ageDays} 天，保留不删）`);
    for (const b of unmerged) console.log(`  [未合并] ${b.name}${b.ageDays !== null ? `（${b.ageDays} 天）` : ''}`);
    return;
  }

  const taskId = argValue(args, '--taskId');
  if (!taskId) {
    console.error('用法：cli.mjs branch <plan|create|merge|cleanup> --taskId <id> [--slug <slug>] [--apply] [--stale-days n]');
    process.exit(2);
  }
  const index = loadIndex();
  const task = index.tasks.find((t) => t.taskId === taskId) ?? index.archivedTasks.find((t) => t.taskId === taskId);
  if (!task) throw new Error(`任务不在索引中：${taskId}`);

  const slug = argValue(args, '--slug') ?? taskId.toLowerCase();
  const name = buildBranchName(taskId, slug);
  if (!name.valid) throw new Error(`分支名校验失败：${name.errors.join('；')}`);
  const branchName = name.branchName;
  // 分支 HEAD：门禁判的必须是「被合并的那条分支」，缺能力或分支不存在时返回 null，由调用方决定口径。
  function resolveBranchHead() {
    if (typeof git.branchHead !== 'function') return null;
    try {
      return git.branchHead(branchName);
    } catch {
      return null;
    }
  }

  if (action === 'plan') {
    const baseline = verifyBaseline(task, git.headRef());
    const plan = planCleanup(collectBranches());
    console.log(`任务分支：${branchName}`);
    console.log(`基线核对：${baseline.reason ?? '基线一致'}`);
    console.log(`清理计划：待删 ${plan.toDelete.length}，保留未合并 ${plan.keptUnmerged.length}，超期 ${plan.stale.length}`);
    return;
  }

  if (action === 'create') {
    if (apply) {
      if (git.branchExists(branchName)) throw new Error(`分支已存在：${branchName}`);
      git.createBranch(branchName, 'integrate');
      auditRegistryCall('TOOL-QUEUE-SCHEDULER', {
        actor: 'orchestrator',
        correlationId: `branch:create:${taskId}`,
        resources: [branchName],
      });
      console.log(`已建分支：${branchName}（自 integrate）`);
    } else {
      console.log(`[干跑] 将自 integrate 切出 ${branchName}（--apply 执行）`);
    }
    return;
  }

  if (action === 'merge') {
    const baseline = verifyBaseline(task, git.headRef());
    if (baseline.matches === false) throw new Error(baseline.reason);
    if (!git.worktreeClean()) throw new Error('工作区存在未归属改动，拒绝合并（先清理或归组）');
    // IM-018：远端 CI 门禁。--require-ci 时先要一句远端结论，pending / unknown 一律不放行
    // （本地闸门绿 ≠ 远端绿：E2E、Coverage Gate、Contracts、Security Audit、Build Docker 只在 CI 跑）。
    if (args.includes('--require-ci')) {
      const repo = argValue(args, '--repo') ?? 'aa386400024/mofang-nestjs';
      const branchHead = resolveBranchHead();
      // AF-046-O1：默认判「分支 HEAD」而不是当前工作 HEAD——工作 HEAD 在 integrate 上，
      // 拿它的结论判一条待合并分支等于没判。显式传 --sha 时必须是该分支 HEAD，
      // 否则可以用一个旧绿的 SHA 给已前进的分支放行。
      const sha = argValue(args, '--sha') ?? branchHead ?? git.headRef();
      if (apply && branchHead && sha !== branchHead) {
        throw new Error(`--sha 与分支 HEAD 不一致：${sha} ≠ ${branchHead}（拒绝用旧绿的提交给新提交放行）`);
      }
      const gate = await evaluateRemoteCiGate({ repo, sha });
      if (gate.verdict !== 'pass') {
        const detail = gate.error ?? [...gate.failing, ...gate.pending].join('、');
        throw new Error(`远端 CI 未通过（${gate.verdict}）：${detail}`);
      }
      console.log(`远端 CI 通过：${gate.total} 项 check 全非失败态（${sha.slice(0, 12)}）`);
      performMerge();
      return;
    }
    performMerge();
    return;
  }

  function performMerge() {
    const baseline = verifyBaseline(task, git.headRef());
    if (apply) {
      // IM-012：一次调用完成「squash 暂存 → 提交 → 删源分支」，不再把提交与清理留给人工。
      const result = finalizeSquashMerge({
        source: branchName,
        taskId,
        taskType: task.type,
        title: `squash merge into integrate（${task.title ?? taskId}）`,
        remote: argValue(args, '--remote'),
        gitPort: git,
      });
      auditRegistryCall('TOOL-QUEUE-SCHEDULER', {
        actor: 'orchestrator',
        correlationId: `branch:merge:${taskId}`,
        resources: [branchName],
      });
      console.log(`合并阶段：${result.stages.join(' → ') || '无'}；提交标题：${result.commitMessage}`);
      if (result.errors.length > 0) throw new Error(`合并未完整收口：${result.errors.join('；')}`);
    } else {
      console.log(`[干跑] 将 squash 合并 ${branchName} → integrate 并补提交与清理（基线：${baseline.reason ?? '一致'}；--apply 执行）`);
    }
  }

  if (action === 'cleanup') {
    const plan = planCleanup(collectBranches());
    if (apply) {
      for (const item of plan.toDelete) {
        if (item.ref === 'local') git.deleteLocal(item.name);
        else git.deleteRemote(item.name, item.ref.slice('remote:'.length));
      }
      auditRegistryCall('TOOL-QUEUE-SCHEDULER', {
        actor: 'orchestrator',
        correlationId: `branch:cleanup:${taskId}`,
        resources: plan.toDelete.map((d) => d.name),
      });
      console.log(`已清理 ${plan.toDelete.length} 项分支引用；保留未合并 ${plan.keptUnmerged.length}，超期 ${plan.stale.length}`);
    } else {
      console.log(
        `[干跑] 待删 ${plan.toDelete.length} 项；保留未合并 ${plan.keptUnmerged.length}；超期 ${plan.stale.length}（--apply 执行）`,
      );
    }
    return;
  }

  console.error(`未知分支动作：${action}`);
  process.exit(2);
}

/**
 * AF-013 派发通道规则视图（rules / queue）与 AF-024 GUI 投递协议（dispatch / confirm / fallback / state）。
 * rules / queue / state 只读；dispatch 只落投递件与运行态 pending；confirm / fallback 由桌面 relay 执行后回写。
 * 本命令不驱动桌面：真实拉起、粘贴、发送由 orchestrator 的桌面 relay 完成，避免 CLI 冒充 GUI 能力。
 */
function cmdChannel(args) {
  const action = args[0] ?? 'rules';
  if (action === 'rules') {
    console.log('=== GUI 派发通道规则（只读）===');
    console.log(`会话降级链：${SESSION_PATHS.join(' → ')}`);
    console.log(`定位四层：${LOCATE_LAYERS.join(' → ')}`);
    console.log(`进程 / 窗口启动重试上限：${MAX_START_RETRIES}；发送换路径重试上限：${MAX_SEND_RETRIES}`);
    console.log('登录门交人工接管；审计与回执不含对话原文；单任务队列，在办未回收不发下一个');
    console.log('送达确认协议：执行代理收到 brief 后写 transport/acks/<taskId>.json；ack 到达才 auto-confirm，缺 ack 按投递租约回滚');
    return;
  }
  if (action === 'queue') {
    const taskId = argValue(args, '--taskId');
    if (!taskId) {
      console.error('用法：cli.mjs channel queue --taskId <id>');
      process.exit(2);
    }
    const index = loadIndex();
    const decision = canDispatch(index, taskId);
    if (decision.allowed) console.log(`可派发：${taskId}（无其他在办任务）`);
    else console.log(`队列占用：${taskId} 暂不派发；在办阻塞 ${decision.blockers.join(', ')}`);
    return;
  }
  if (action === 'dispatch') {
    const taskId = argValue(args, '--taskId');
    if (!taskId) {
      console.error(
        '用法：cli.mjs channel dispatch --taskId <id> [--extra-file <md>] [--executor <relay 标识>]  生成 GUI 投递件并置投递 pending',
      );
      process.exit(2);
    }
    const index = loadIndex();
    const runtimeState = loadRuntimeState();
    const task = index.tasks.find((item) => item.taskId === taskId);
    if (!task) throw new Error(`投递准备失败：任务不在活跃列表：${taskId}`);
    if (task.status !== 'submitted') throw new Error(`投递准备失败：任务须已领单（submitted）：${taskId} 当前 ${task.status}`);
    const entry = runtimeState.tasks?.[taskId];
    if (!entry?.dispatch) throw new Error(`投递准备失败：缺派发记录（先用 run-once 领单）：${taskId}`);
    const handoverPath = join(PATHS.transportDir, 'tasks', `${taskId}.json`);
    const handover = existsSync(handoverPath) ? (JSON.parse(readFileSync(handoverPath, 'utf8')).payload ?? {}) : {};
    const extraFile = argValue(args, '--extra-file');
    const extra = extraFile && existsSync(resolve(extraFile)) ? readFileSync(resolve(extraFile), 'utf8') : null;
    // 执行器注入点：谁去驱动桌面要落进投递记录（可审计、可替换），
    // 当前默认 doubao-cu（豆包桌面技能 seed_computer_use），换 relay 只需改这一处标注。
    const executor = argValue(args, '--executor') ?? 'doubao-cu';
    // 通道不在这里硬写：编排者任务投给自己只走文件交接件，GUI 通道只对执行代理角色生效（选路真相源在 scheduler）。
    const targetRole = entry.dispatch.targetRole ?? task.agentRole ?? 'executor';
    if (targetRole === 'orchestrator') {
      throw new Error(`投递准备失败：${taskId} 的目标角色是编排者，走文件交接件，不驱动桌面（GUI 通道只对执行代理生效）`);
    }
    if (entry.dispatch.delivery?.state === 'delivered') {
      throw new Error(`投递准备失败：${taskId} 已确认送达，重派请先走 fallback 或等回执验收后重开`);
    }
    const brief = buildGuiBrief(task, handover, {
      receiptPath: pathToPosix(join(PATHS.transportDir, 'receipts', `${taskId}.json`)),
      extra,
    });
    const briefPath = writeGuiBrief({ transportDir: PATHS.transportDir, taskId, text: brief.text });
    const previous = entry.dispatch.delivery ?? null;
    entry.dispatch.channel = 'gui-relay';
    entry.dispatch.delivery = {
      state: 'pending',
      preparedAt: nowIso(),
      briefRef: pathToPosix(briefPath),
      executor,
      sessionPath: null,
      locateLayer: null,
      evidenceRef: null,
      history: previous?.state ? [...(previous.history ?? []), { ...previous }] : (previous?.history ?? []),
    };
    saveRuntimeState(runtimeState);
    refreshSnapshotArtifacts();
    console.log(`投递件已生成：${briefPath}`);
    console.log(`通道：gui-relay；投递状态：pending；交接件：${pathToPosix(entry.dispatch.handoverRef ?? '') || '(缺)'}`);
    console.log('桌面 relay 执行顺序：聚焦执行代理窗口 → 粘贴投递件 → 发送 → 校验输入框已清空且消息出现在会话中');
    console.log(`发送接管（主桌面焦点窗口，发送后释放）：cli.mjs channel send --taskId ${taskId} [--dry-run] [--wait-ack]`);
    console.log(
      `确认送达（ack 自动）：cli.mjs channel auto-confirm --taskId ${taskId}；手工兜底：cli.mjs channel confirm --taskId ${taskId} --session-path <${SESSION_PATHS.join('|')}> --locate-layer <${LOCATE_LAYERS.join('|')}> --evidence <仓内截图或时间戳文件>`,
    );
    console.log(
      `降级回退：cli.mjs channel fallback --taskId ${taskId} --reason <原因> --cause <${DELIVERY_CAUSES.join('|')}> [--classification deterministic|flaky|legacy-debt]`,
    );
    return;
  }
  if (action === 'send') {
    const taskId = argValue(args, '--taskId');
    if (!taskId) {
      console.error('用法：channel send --taskId <id> [--dry-run] [--wait-ack] [--ack-timeout 90] [--window-title "MiniMax Code"]');
      process.exit(2);
    }
    const index = loadIndex();
    const runtimeState = loadRuntimeState();
    const task = index.tasks.find((item) => item.taskId === taskId);
    if (!task) throw new Error(`发送失败：任务不在活跃列表：${taskId}`);
    if (task.status !== 'submitted') throw new Error(`发送失败：任务须已领单（submitted）：${taskId} 当前 ${task.status}`);
    const entry = runtimeState.tasks?.[taskId];
    if (!entry?.dispatch) throw new Error(`发送失败：缺派发记录（先用 run-once 领单）：${taskId}`);
    if (entry.dispatch.channel !== 'gui-relay') throw new Error(`发送失败：通道 ${String(entry.dispatch.channel)} 不是 gui-relay`);
    if (entry.dispatch.delivery?.state !== 'pending') {
      throw new Error(`发送失败：投递状态须为 pending，当前 ${String(entry.dispatch.delivery?.state)}`);
    }
    const targetRole = entry.dispatch.targetRole ?? task.agentRole ?? 'executor';
    if (targetRole === 'orchestrator') throw new Error(`发送失败：${taskId} 是编排者任务，不驱动桌面`);

    let briefPath = entry.dispatch.delivery?.briefRef ? resolve(REPO_ROOT, entry.dispatch.delivery.briefRef) : null;
    if (!briefPath || !existsSync(briefPath)) {
      const handoverPath = join(PATHS.transportDir, 'tasks', `${taskId}.json`);
      const handover = existsSync(handoverPath) ? (JSON.parse(readFileSync(handoverPath, 'utf8')).payload ?? {}) : {};
      const brief = buildGuiBrief(task, handover, {
        receiptPath: pathToPosix(join(PATHS.transportDir, 'receipts', `${taskId}.json`)),
      });
      briefPath = writeGuiBrief({ transportDir: PATHS.transportDir, taskId, text: brief.text });
      entry.dispatch.delivery.briefRef = pathToPosix(briefPath);
      saveRuntimeState(runtimeState);
    }

    const scriptPath = join(REPO_ROOT, 'scripts', 'orchestration', 'gui-relay-send.ps1');
    if (!existsSync(scriptPath)) throw new Error(`发送失败：缺桌面 relay 脚本：${scriptPath}`);
    const powershell = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    if (!existsSync(powershell)) throw new Error(`发送失败：找不到 Windows PowerShell：${powershell}`);
    const dryRun = args.includes('--dry-run');
    const windowTitle = argValue(args, '--window-title') ?? 'MiniMax Code';
    const psArgs = [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      scriptPath,
      '-TaskId',
      taskId,
      '-BriefPath',
      briefPath,
      '-RepoRoot',
      REPO_ROOT,
      '-EvidenceDir',
      join(PATHS.transportDir, 'gui-sent'),
      '-WindowTitle',
      windowTitle,
    ];
    if (dryRun) psArgs.push('-DryRun');
    if (args.includes('--no-click-input')) psArgs.push('-NoClickInput');
    const result = spawnSync(powershell, psArgs, { encoding: 'utf8', timeout: 60_000, maxBuffer: 8 * 1024 * 1024 });
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    if (result.error) throw new Error(`发送失败：${result.error.message}`);
    if (result.status !== 0) throw new Error(`发送失败：桌面 relay 退出码 ${result.status}`);
    if (dryRun) {
      console.log('干跑完成：只验证窗口定位与证据链，未发送任何内容。');
      return;
    }
    if (args.includes('--wait-ack')) {
      const timeoutSeconds = Number(argValue(args, '--ack-timeout') ?? 90);
      const deadline = Date.now() + Math.max(5, timeoutSeconds) * 1000;
      while (Date.now() < deadline) {
        const ackResult = autoConfirmDelivery({
          record: entry.dispatch,
          taskId,
          transportDir: PATHS.transportDir,
          repoRoot: REPO_ROOT,
        });
        if (ackResult.confirmed) {
          entry.dispatch = ackResult.record;
          saveRuntimeState(runtimeState);
          refreshSnapshotArtifacts();
          console.log(`已收到执行代理 ack 并确认送达：${taskId}；证据=${ackResult.record.delivery.evidenceRef}`);
          return;
        }
        const waitMs = Math.min(2000, deadline - Date.now());
        if (waitMs > 0) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, waitMs);
      }
      throw new Error(`发送后 ${timeoutSeconds}s 未收到 ack：${taskId}；任务保持 pending，按租约回滚`);
    }
    console.log(`发送动作已完成：${taskId}；下一步在 ack 到达后执行 channel auto-confirm --taskId ${taskId}`);
    return;
  }
  if (action === 'auto-confirm') {
    const taskId = argValue(args, '--taskId');
    const runtimeState = loadRuntimeState();
    const index = loadIndex();
    let confirmed = 0;
    const targets = taskId ? [taskId] : index.tasks.filter((task) => task.status === 'submitted').map((task) => task.taskId);
    for (const id of targets) {
      const entry = runtimeState.tasks?.[id];
      if (!entry?.dispatch) continue;
      const result = autoConfirmDelivery({
        record: entry.dispatch,
        taskId: id,
        transportDir: PATHS.transportDir,
        repoRoot: REPO_ROOT,
      });
      if (!result.confirmed) {
        if (taskId) console.log(`未确认：${id}；原因=${result.reason}`);
        continue;
      }
      entry.dispatch = result.record;
      confirmed += 1;
      console.log(`已确认送达：${id}；证据=${result.record.delivery.evidenceRef}`);
    }
    if (confirmed > 0) {
      saveRuntimeState(runtimeState);
      refreshSnapshotArtifacts();
    }
    console.log(`自动确认完成：${confirmed} 条`);
    return;
  }
  if (action === 'confirm') {
    const taskId = argValue(args, '--taskId');
    const sessionPath = argValue(args, '--session-path');
    const locateLayer = argValue(args, '--locate-layer');
    const evidenceRef = argValue(args, '--evidence');
    if (!taskId) {
      console.error('用法：channel confirm --taskId <id> --session-path <..> --locate-layer <..> --evidence <..>');
      process.exit(2);
    }
    const runtimeState = loadRuntimeState();
    const entry = runtimeState.tasks?.[taskId];
    if (!entry?.dispatch) throw new Error(`确认失败：缺派发记录：${taskId}`);
    const result = confirmDelivery(entry.dispatch, { sessionPath, locateLayer, evidenceRef, repoRoot: REPO_ROOT });
    if (!result.valid) throw new Error(result.errors.join('；'));
    entry.dispatch = result.record;
    saveRuntimeState(runtimeState);
    refreshSnapshotArtifacts();
    console.log(`已确认送达：${taskId}；会话路径=${sessionPath}；定位层=${locateLayer}；投递状态=delivered`);
    return;
  }
  if (action === 'fallback') {
    const taskId = argValue(args, '--taskId');
    const reason = argValue(args, '--reason');
    const classification = argValue(args, '--classification') ?? 'deterministic';
    // AF-043-I2：cause 是**判决值**，不再允许缺省。
    // 缺省时过去会落 deterministic-defect，决策链据此把任务判 failed 终态（AF-041 实测不可复活）。
    const cause = argValue(args, '--cause');
    const usage =
      '用法：channel fallback --taskId <id> --reason <原因> --cause <' +
      DELIVERY_CAUSES.join('|') +
      '> [--classification deterministic|flaky|legacy-debt] [--login-gate] [--start-retries N] [--send-retries N] [--attempt-count N] [--process-running] [--window-ready]';
    if (!taskId || !reason) {
      console.error(usage);
      process.exit(2);
    }
    if (!cause) {
      console.error('降级失败：--cause 必填（它是决策链的判决值，缺省会把流程问题判成任务死）。');
      console.error(usage);
      process.exit(2);
    }
    if (!DELIVERY_CAUSES.includes(cause)) {
      console.error(`降级失败：--cause 非法（${cause}）；可选 ${DELIVERY_CAUSES.join(' / ')}`);
      process.exit(2);
    }
    const runtimeState = loadRuntimeState();
    const entry = runtimeState.tasks?.[taskId];
    if (!entry?.dispatch) throw new Error(`降级失败：缺派发记录：${taskId}`);
    // IM-028：现场事实随降级一并落盘，回收环节的运行时决策链按它判「终态失败 / 升级人工 / 可重试」。
    const list = (value) =>
      value
        ? String(value)
            .split(',')
            .map((x) => x.trim())
            .filter(Boolean)
        : [];
    const facts = {
      cause,
      loginGate: args.includes('--login-gate'),
      processRunning: args.includes('--process-running') ? true : false,
      windowReady: args.includes('--window-ready') ? true : false,
      startRetries: Number(argValue(args, '--start-retries') ?? 1),
      sendRetries: Number(argValue(args, '--send-retries') ?? 1),
      sessionAttempted: list(argValue(args, '--session-attempted')),
      locateAttempted: list(argValue(args, '--locate-attempted')),
      attemptCount: Number(argValue(args, '--attempt-count') ?? 1),
    };
    const result = fallbackDelivery(entry.dispatch, { reason, classification, repoRoot: REPO_ROOT, facts });
    if (!result.valid) throw new Error(result.errors.join('；'));
    entry.dispatch = result.record;
    saveRuntimeState(runtimeState);
    refreshSnapshotArtifacts();
    const bypassed = result.record.delivery?.state === 'bypassed';
    console.log(
      `已降级：${taskId}；channel=gui-file-fallback；原因=${reason}；cause=${cause}；` +
        (bypassed ? '投递状态=bypassed（通道旁路，不计通道失败）' : `定性=${classification}`),
    );
    console.log(`现场事实：cause=${facts.cause} loginGate=${facts.loginGate} attemptCount=${facts.attemptCount}`);
    console.log(
      bypassed
        ? '下一步：任务保持 submitted，写完回执后 run-once 正常验收（既不会重试派发，也不会判 failed）。'
        : '下一步：run-once 会按运行时决策链处理该任务（不可恢复→failed；否则回滚 ready 并置 heldForHuman）；修好通道后 task resume 再重派。',
    );
    return;
  }
  if (action === 'state') {
    const taskId = argValue(args, '--taskId');
    if (!taskId) {
      console.error('用法：cli.mjs channel state --taskId <id>');
      process.exit(2);
    }
    const runtimeState = loadRuntimeState();
    const record = runtimeState.tasks?.[taskId]?.dispatch ?? null;
    if (!record) throw new Error(`缺派发记录：${taskId}`);
    const stalled = isDeliveryStalled(record, { deliveryLeaseMinutes: loadConfig().dispatch?.deliveryLeaseMinutes });
    console.log(JSON.stringify({ taskId, channel: record.channel, delivery: record.delivery ?? null, stalled }, null, 2));
    return;
  }
  console.error(`未知通道动作：${action}（支持 rules / queue / dispatch / send / auto-confirm / confirm / fallback / state）`);
  process.exit(2);
}

const SKIPPED = { ok: true, skipped: true, errors: [], schemaId: null };

/** 仓库相对路径（正斜杠）：派发记录只存仓内指针，不落绝对路径。 */
function pathToPosix(absPath) {
  return absPath
    .replace(REPO_ROOT, '')
    .replace(/^[\\/]+/, '')
    .replace(/\\/g, '/');
}

/** 任务单登记：`task register --sheet <md>` / `task import --handover <json>`。 */
async function cmdTask(args) {
  const sub = args[0] ?? 'register';
  // `task` 子命令需要 YAML frontmatter 解析（yaml 为可选运行时依赖），延迟到实际使用时加载，
  // 避免 `worklog verify` 等零依赖命令把 yaml 带进 Orchestration Gate 的模块图。
  const intake = await import('./task-intake.mjs');
  if (sub === 'next-id') {
    // AF-217：三源占用合并后给出下一个可用编号，供跨机登记前先问一句。
    // AF-223：--reserve 时先在远端创建占号 ref 做 CAS，抢不到自动顺延，
    // 输出的是「已经抢下」的编号，两台机器同时取号不会再拿到同一个号。
    const occupancy = collectOccupiedTaskIds({ rootDir: REPO_ROOT });
    for (const warning of occupancy.warnings ?? []) console.error(`[task-id] ${warning}`);
    const prefix = argValue(args, '--prefix') ?? 'AF';
    if (!args.includes('--reserve')) {
      console.log(nextTaskId(occupancy.ids, prefix));
      return;
    }
    const reservation = createGitTaskIdReservation({ rootDir: REPO_ROOT, actor: 'orchestrator-cli' });
    const picked = pickReservedTaskId({
      occupiedIds: occupancy.ids,
      prefix,
      nextIdFn: nextTaskId,
      reserve: (taskId) => reservation.reserve(taskId),
    });
    for (const attempt of picked.attempts) {
      if (!attempt.reserved) {
        const holder = attempt.holder;
        const why = attempt.unavailable ? '远端不可达' : `已被 ${holder?.host ?? 'unknown'} 于 ${holder?.reservedAt ?? '?'} 占号`;
        console.error(`[task-id] ${attempt.taskId} 抢号失败：${why}`);
      }
    }
    if (picked.unavailable) {
      console.error('[task-id] 远端不可达，无法完成占号 CAS；本次只给只读建议，请勿据此登记');
      console.log(nextTaskId(occupancy.ids, prefix));
      process.exitCode = 1;
      return;
    }
    if (!picked.taskId) {
      console.error(`[task-id] 连续 ${picked.attempts.length} 次抢号失败，请检查远端 occupation（orchestration-task-ids/*）`);
      process.exitCode = 1;
      return;
    }
    console.log(picked.taskId);
    return;
  }
  if (sub === 'reserve') {
    const taskId = argValue(args, '--taskId');
    if (!taskId) {
      console.error('用法：task reserve --taskId AF-NNN   显式在远端占号（refs/heads/orchestration-task-ids/<id>）');
      process.exit(2);
    }
    const reservation = createGitTaskIdReservation({ rootDir: REPO_ROOT, actor: 'orchestrator-cli' });
    const result = reservation.reserve(taskId);
    if (result.reserved) {
      console.log(`已占号 ${taskId} → ${reservationRef(taskId)}`);
      return;
    }
    if (result.unavailable) throw new Error(`占号失败：${result.error ?? '远端不可达'}`);
    throw new Error(`占号失败：${taskId} 已被 ${result.holder?.host ?? 'unknown'} 占用（${result.holder?.reservedAt ?? '?'}）`);
  }
  if (sub === 'release-id') {
    const taskId = argValue(args, '--taskId');
    if (!taskId) {
      console.error('用法：task release-id --taskId AF-NNN   释放远端占号 ref（归档后清理，避免远端 ref 无界增长）');
      process.exit(2);
    }
    const reservation = createGitTaskIdReservation({ rootDir: REPO_ROOT, actor: 'orchestrator-cli' });
    const released = reservation.release(taskId);
    console.log(released ? `已释放占号 ${taskId}` : `释放占号失败 ${taskId}（ref 不存在、被他人占用或远端不可达）`);
    return;
  }
  if (sub === 'register') {
    const sheetPath = argValue(args, '--sheet');
    if (!sheetPath) {
      console.error('用法：task register --sheet docs/worklog/inbox/<task>.md [--status ready]');
      process.exit(2);
    }
    // AF-223：重建同一任务时，本机已推送的同名任务分支不再挡自己；
    // 真正防并发的是远端占号 ref，三源占用只做事后校验。
    const taskIdHint = argValue(args, '--taskId');
    const branch = createGitPort().currentBranch();
    const excludeRefs =
      !taskIdHint && branch?.startsWith('task/') && /^task\/([A-Z0-9]+-[0-9]+)-/.test(branch) ? [`refs/heads/${branch}`] : [];
    const task = await intake.registerTaskFromSheet({
      sheetPath,
      status: argValue(args, '--status'),
      actor: 'orchestrator-cli',
      excludeRefs,
    });
    refreshSnapshotArtifacts();
    console.log(`已登记任务 ${task.taskId}（${task.status}）→ ${task.artifacts.taskSheet}`);
    return;
  }
  if (sub === 'import') {
    const handoverPath = argValue(args, '--handover');
    if (!handoverPath) {
      console.error('用法：task import --handover docs/team/agent-orchestration/transport/tasks/<task>.json [--status ready]');
      process.exit(2);
    }
    const task = await intake.registerTaskFromHandover({
      handoverPath,
      status: argValue(args, '--status'),
      actor: 'orchestrator-cli',
    });
    refreshSnapshotArtifacts();
    console.log(`已补登任务 ${task.taskId}（${task.status}）→ ${task.artifacts.taskSheet}`);
    return;
  }
  if (sub === 'resume') {
    const taskId = argValue(args, '--taskId');
    if (!taskId) {
      console.error('用法：task resume --taskId <id> [--reason <text>]  解除租约超时的人工持单，允许重新领取');
      process.exit(2);
    }
    const index = loadIndex();
    const task = index.tasks.find((item) => item.taskId === taskId);
    if (!task) throw new Error(`任务不在活跃列表：${taskId}`);
    if (task.status !== 'ready') throw new Error(`只能恢复 ready 任务：${taskId} 当前 ${task.status}`);
    const runtimeState = loadRuntimeState();
    const entry = runtimeState.tasks?.[taskId];
    if (!entry) throw new Error(`任务缺运行态条目：${taskId}`);
    if (entry.heldForHuman !== true) throw new Error(`任务未处于人工持单：${taskId}`);
    entry.heldForHuman = false;
    entry.releaseReason = 'manual-resume';
    entry.resumedAt = nowIso();
    entry.resumedBy = 'orchestrator-cli';
    entry.escalation = null;
    saveRuntimeState(runtimeState);
    refreshSnapshotArtifacts();
    console.log(`已恢复任务 ${taskId}：heldForHuman=false，releaseReason=manual-resume`);
    return;
  }
  if (sub === 'promote') {
    const taskId = argValue(args, '--taskId');
    if (!taskId) {
      console.error('用法：task promote --taskId <id> [--reason <text>]  把 backlog 提到 ready（校验契约 / 基线 / 依赖）');
      process.exit(2);
    }
    const index = loadIndex();
    const runtimeState = loadRuntimeState();
    const reason = argValue(args, '--reason') ?? '人工提级';
    const task = promoteTask(index, runtimeState, taskId, { reason });
    commitIndex(index, { actor: 'orchestrator-cli' });
    saveRuntimeState(runtimeState);
    refreshSnapshotArtifacts();
    auditRegistryCall('TOOL-QUEUE-SCHEDULER', { actor: 'orchestrator', correlationId: `promote:${taskId}` });
    console.log(`已提级任务 ${taskId}：status=${task.status}，promotedAt=${task.promotedAt}`);
    return task;
  }
  if (sub === 'cancel') {
    const taskId = argValue(args, '--taskId');
    if (!taskId) {
      console.error('用法：task cancel --taskId <id> [--reason <text>]  按状态机把非终态任务闭合到 canceled，随后可 archive');
      process.exit(2);
    }
    const index = loadIndex();
    const runtimeState = loadRuntimeState();
    const reason = argValue(args, '--reason') ?? '人工取消';
    const task = cancelTask(index, runtimeState, taskId, { reason });
    commitIndex(index, { actor: 'orchestrator-cli' });
    saveRuntimeState(runtimeState);
    refreshSnapshotArtifacts();
    auditRegistryCall('TOOL-QUEUE-SCHEDULER', { actor: 'orchestrator', correlationId: `cancel:${taskId}` });
    console.log(`已取消任务 ${taskId}：status=canceled，cancelReason=${reason}`);
    return task;
  }
  if (sub === 'reissue' || sub === 'rescope') {
    // AF-084：scope 不原地改写。重签发 = 登记新任务 + 提级 + 取消原任务，一次显式操作。
    const fromTaskId = argValue(args, '--from') ?? argValue(args, '--fromTaskId');
    const sheetPath = argValue(args, '--sheet');
    const apply = args.includes('--apply');
    const archiveOld = args.includes('--archive-old');
    if (!fromTaskId || !sheetPath) {
      console.error(
        '用法：task reissue --from <oldTaskId> --sheet docs/worklog/inbox/<newTask>.md [--apply] [--archive-old]\n' +
          '      task rescope 为同义入口；scope 不原地修改，而是重签发一个新任务并在 priorTasks 指向原任务。',
      );
      process.exit(2);
    }
    const absSheet = resolve(REPO_ROOT, sheetPath);
    if (!existsSync(absSheet)) throw new Error(`任务单不存在：${sheetPath}`);
    const relSheet = pathToPosix(absSheet);
    if (!relSheet.startsWith('docs/worklog/inbox/') && !relSheet.startsWith('docs/worklog/pending/')) {
      throw new Error(`重签发任务单必须位于 docs/worklog/inbox/：${relSheet}`);
    }
    const { meta } = intake.parseTaskSheetFrontmatter(readFileSync(absSheet, 'utf8'));
    const newTask = intake.buildTaskRecord(meta, { taskSheetPath: relSheet, status: 'backlog' });
    const index = loadIndex();
    const plan = planReissue(index, { fromTaskId, newTask });
    if (!plan.ok) {
      console.error(`[FAIL] 重签发计划不成立：${fromTaskId} → ${String(meta?.taskId)}`);
      for (const error of plan.errors) console.error(`  - ${error}`);
      process.exit(1);
    }
    if (!apply) {
      console.log(`[DRY-RUN] 重签发 ${fromTaskId} → ${newTask.taskId}`);
      console.log(`  - 新任务单：${relSheet}`);
      console.log(`  - 原任务：status=${plan.oldTask.status} → canceled${archiveOld ? ' → archived' : ''}`);
      console.log('  - 正式执行请追加 --apply；scope 不会在原任务上原地修改。');
      return;
    }
    const created = await intake.registerTaskFromSheet({ sheetPath: relSheet, status: 'backlog', actor: 'orchestrator-cli' });
    const next = loadIndex();
    const runtimeState = loadRuntimeState();
    const reason = `scope 重签发自 ${fromTaskId}`;
    promoteTask(next, runtimeState, created.taskId, { reason });
    cancelTask(next, runtimeState, fromTaskId, { reason: `scope 重签发 → ${created.taskId}（原任务不再执行）` });
    commitIndex(next, { actor: 'orchestrator-cli' });
    saveRuntimeState(runtimeState);
    if (archiveOld) {
      archiveTaskEvent(fromTaskId, { status: 'canceled', note: `scope 重签发 → ${created.taskId}` });
    }
    refreshSnapshotArtifacts();
    auditRegistryCall('TOOL-QUEUE-SCHEDULER', { actor: 'orchestrator', correlationId: `reissue:${fromTaskId}:${created.taskId}` });
    console.log(`已重签发：${fromTaskId} → ${created.taskId}（${created.status}）`);
    console.log(`原任务 status=canceled${archiveOld ? ' 并已归档' : ''}；scope 未原地修改，审计链路见 newTask.priorTasks。`);
    return;
  }
  console.error(`未知 task 子命令：${sub}（支持 register / import / resume / promote / cancel / reissue / rescope）`);
  process.exit(2);
}

/** AF-006：框架 schema 机读校验（索引 / 工具契约 / Agent Card；可选任务单元 JSON）。 */
async function cmdValidate(args) {
  if (requireFramework() && !existsSync(join(frameworkDir(), 'schemas', 'versions.json'))) {
    console.error(`[FAIL] 框架契约不可达：${join(frameworkDir(), 'schemas', 'versions.json')}（ORCH_REQUIRE_FRAMEWORK=1）`);
    process.exit(1);
  }
  const sections = [];

  if (existsSync(PATHS.index)) {
    sections.push(['状态索引', await validateTaskIndex(JSON.parse(readFileSync(PATHS.index, 'utf8')))]);
  } else {
    sections.push(['状态索引', SKIPPED]);
  }

  if (existsSync(PATHS.toolsDir)) {
    sections.push(['工具契约目录', await validateToolDir(PATHS.toolsDir)]);
  } else {
    sections.push(['工具契约目录', SKIPPED]);
  }

  if (existsSync(PATHS.snapshot)) {
    const snapshot = JSON.parse(readFileSync(PATHS.snapshot, 'utf8'));
    sections.push(['协议视图', await validateProtocolView(snapshot.protocolView ?? {})]);
  } else {
    sections.push(['协议视图', SKIPPED]);
  }

  const packFiles = existsSync(PATHS.deliveryPackDir) ? readdirSync(PATHS.deliveryPackDir).filter((f) => f.endsWith('.json')) : [];
  for (const file of packFiles.sort()) {
    sections.push([`交付包 ${file}`, await validateDeliveryPackage(JSON.parse(readFileSync(join(PATHS.deliveryPackDir, file), 'utf8')))]);
  }

  const cardFiles = existsSync(PATHS.agentCardsDir) ? readdirSync(PATHS.agentCardsDir).filter((f) => f.endsWith('.json')) : [];
  for (const file of cardFiles) {
    const card = JSON.parse(readFileSync(join(PATHS.agentCardsDir, file), 'utf8'));
    sections.push([`Agent Card ${file}`, await validateAgentCard(card)]);
  }

  const reviewDir = join(PATHS.transportDir, 'reviews');
  const reviewFiles = existsSync(reviewDir) ? readdirSync(reviewDir).filter((f) => f.endsWith('.json')) : [];
  for (const file of reviewFiles) {
    const record = JSON.parse(readFileSync(join(reviewDir, file), 'utf8'));
    const review = record?.payload ?? record;
    sections.push([`Review 交接件 ${file}`, await validateReviewHandoverSchema(review)]);
  }

  const receiptDir = join(PATHS.transportDir, 'receipts');
  const receiptFiles = existsSync(receiptDir) ? readdirSync(receiptDir).filter((f) => f.endsWith('.json')) : [];
  for (const file of receiptFiles.sort()) {
    const record = JSON.parse(readFileSync(join(receiptDir, file), 'utf8'));
    const receipt = record?.payload ?? record;
    sections.push([`回执 ${file}`, await validateReceiptSchema(receipt)]);
  }

  const taskDir = join(PATHS.transportDir, 'tasks');
  const taskFiles = existsSync(taskDir) ? readdirSync(taskDir).filter((f) => f.endsWith('.json')) : [];
  for (const file of taskFiles.sort()) {
    const record = JSON.parse(readFileSync(join(taskDir, file), 'utf8'));
    // transport 写入的是 {deliveredAt,payload} 包装；裸任务单也兼容。
    const payload = record?.payload ?? record;
    sections.push([`运行态任务单 ${file}`, await validateTaskSheet(payload)]);
  }

  const sheetFile = argValue(args, '--sheet');
  if (sheetFile) {
    const abs = resolve(REPO_ROOT, sheetFile);
    if (existsSync(abs)) {
      const text = readFileSync(abs, 'utf8');
      let meta;
      try {
        meta = text.trimStart().startsWith('{')
          ? JSON.parse(text)
          : (await import('./task-intake.mjs')).parseTaskSheetFrontmatter(text).meta;
      } catch (err) {
        sections.push([
          '任务单元',
          { ok: false, skipped: false, schemaId: null, errors: [{ instancePath: '', message: err.message, params: {} }] },
        ]);
      }
      if (meta) sections.push(['任务单元', await validateTaskSheet(meta)]);
    } else {
      console.log(`[SKIP] 任务单元：文件不存在：${sheetFile}`);
    }
  }

  const events = loadJournal();
  if (events.length === 0) {
    sections.push([
      '状态事件日志',
      { ok: false, skipped: false, schemaId: null, errors: [{ instancePath: '', message: '事件日志为空，事件溯源未生效', params: {} }] },
    ]);
  } else {
    const journalSchema = await validateJournalSchema(events);
    const integrity = journalIntegrity(events);
    sections.push([
      '状态事件日志（schema + 哈希链）',
      {
        ok: journalSchema.ok && integrity.ok,
        skipped: false,
        schemaId: journalSchema.schemaId,
        errors: [...journalSchema.errors, ...integrity.errors],
      },
    ]);
    sections.push(['索引投影一致', verifyProjection()]);
  }

  let failed = false;
  for (const [name, res] of sections) {
    if (res.skipped) {
      console.log(`[SKIP] ${name}：schema 不可达，跳过机读校验`);
      continue;
    }
    if (res.ok) {
      console.log(`[PASS] ${name}${res.schemaId ? `（${res.schemaId}）` : ''}`);
    } else {
      failed = true;
      console.log(`[FAIL] ${name}`);
      for (const err of res.errors) console.log(`   - ${err.instancePath || '/'}：${err.message}`);
    }
  }
  if (failed) process.exit(1);
}

function cmdConfig(args) {
  if (args.includes('--enable')) {
    saveConfigPatch({ autoLoop: { enabled: true } });
    console.log('自治模式已开启。');
  } else if (args.includes('--disable')) {
    saveConfigPatch({ autoLoop: { enabled: false } });
    console.log('自治模式已关闭。');
  } else {
    const cfg = loadConfig();
    console.log(
      `自治模式：${cfg.autoLoop.enabled ? '开启' : '关闭'}；返修上限=${cfg.reworkLimit}；默认租约=${cfg.leaseDefaultMinutes} 分钟`,
    );
  }
}

function argValue(args, flag) {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
}

function parseList(value) {
  return value
    ? String(value)
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : [];
}

function formatSummary(s) {
  return `台账概览：候选=${s.byStatus.candidate} 排队=${s.byStatus.queued} 实现中=${s.byStatus.accepted} 已完成=${s.byStatus.done} 不采纳=${s.byStatus.wontfix}；活跃=${s.activeCount} / 总=${s.total}`;
}

/** 候选改进台账：list / --summary / --extract / --add / --transition。 */
function cmdImprovements(args) {
  const log = loadImprovementLog();

  if (args.includes('--summary')) {
    console.log(formatSummary(summarizeLog(log)));
    return;
  }

  if (args.includes('--extract')) {
    const snapshot = buildSnapshot(loadIndex(), loadRuntimeState(), loadConfig(), summarizeLog(log));
    const drafts = extractFromSnapshot(snapshot, log.improvements);
    // IM-001：回执正文解析通道；existing 并入快照草稿，避免跨通道重复登记。
    const receiptDrafts = [];
    if (existsSync(PATHS.receiptArchiveDir)) {
      for (const fileName of readdirSync(PATHS.receiptArchiveDir)) {
        if (!/^relay-response-.*\.md$/.test(fileName)) continue;
        let markdown = '';
        try {
          markdown = readFileSync(join(PATHS.receiptArchiveDir, fileName), 'utf8');
        } catch {
          continue;
        }
        receiptDrafts.push(...extractFromReceiptDoc(markdown, [...log.improvements, ...drafts], { docRef: fileName }));
      }
    }
    const added = [...drafts, ...receiptDrafts].map((draft) => addCandidate(log, draft));
    if (added.length > 0) saveImprovementLog(log);
    refreshSnapshotArtifacts();
    console.log(`从快照与回执正文抽取候选 ${added.length} 条${added.length === 0 ? '（无新增，均已登记或队列为空）' : ''}。`);
    for (const e of added) console.log(`  + ${e.improvementId} [${e.status}] ${e.source}/${e.type}｜${e.title}`);
    console.log(formatSummary(summarizeLog(log)));
    return;
  }

  if (args.includes('--add')) {
    const raw = {
      title: argValue(args, '--title'),
      source: argValue(args, '--source'),
      type: argValue(args, '--type'),
      layer: argValue(args, '--layer'),
      relatedTaskId: argValue(args, '--related-task') ?? null,
      evidence: parseList(argValue(args, '--evidence')),
      impact: argValue(args, '--impact') ?? null,
      suggestion: argValue(args, '--suggestion') ?? null,
      createdBy: 'orchestrator-cli',
    };
    const entry = addCandidate(log, raw);
    saveImprovementLog(log);
    refreshSnapshotArtifacts();
    console.log(`已登记候选：${entry.improvementId}｜${entry.title}`);
    return;
  }

  const transitionIdx = args.indexOf('--transition');
  if (transitionIdx >= 0) {
    const id = args[transitionIdx + 1];
    const to = args[transitionIdx + 2];
    const entry = transitionImprovement(log, id, to, {
      note: argValue(args, '--note') ?? undefined,
      linkedTaskId: argValue(args, '--linked-task') ?? undefined,
      by: argValue(args, '--by') ?? undefined,
    });
    saveImprovementLog(log);
    refreshSnapshotArtifacts();
    console.log(`${entry.improvementId} → ${entry.status}｜${entry.title}`);
    return;
  }

  console.log(formatSummary(summarizeLog(log)));
  const open = listOpen(log);
  if (open.length === 0) {
    console.log('（无活跃候选）');
    return;
  }
  console.log('=== 非终态条目 ===');
  for (const e of open) {
    console.log(
      `${e.improvementId} [${e.status}] ${e.source}/${e.type}/${e.layer}｜${e.title}${e.relatedTaskId ? `｜关联=${e.relatedTaskId}` : ''}`,
    );
  }
}

/** AF-084：回执预检，在 run-once 之前暴露格式与 scope 问题。 */
function cmdReceipt(args) {
  const sub = args[0];
  if (sub !== 'lint') {
    console.error('用法：receipt lint --taskId <id> [--path <receipt.json>]');
    process.exit(2);
  }
  const taskId = argValue(args, '--taskId');
  if (!taskId) {
    console.error('用法：receipt lint --taskId <id> [--path <receipt.json>]');
    process.exit(2);
  }
  const index = loadIndex();
  const task = index.tasks.find((item) => item.taskId === taskId) ?? index.archivedTasks.find((item) => item.taskId === taskId);
  if (!task) throw new Error(`任务不存在：${taskId}`);
  const pathArg = argValue(args, '--path');
  const receiptFile = pathArg ? resolve(REPO_ROOT, pathArg) : join(PATHS.transportDir, 'receipts', `${taskId}.json`);
  if (!existsSync(receiptFile)) throw new Error(`回执文件不存在：${relativePath(receiptFile)}`);
  const result = lintReceiptFile(receiptFile, task, { repoRoot: REPO_ROOT });
  console.log(`回执预检 ${taskId} ← ${relativePath(receiptFile)}`);
  for (const warning of result.warnings) console.log(`[WARN] ${warning}`);
  if (result.ok) {
    console.log(`[PASS] 七组字段、scope、工件与换行检查通过${result.warnings.length > 0 ? `（${result.warnings.length} 条警告）` : ''}`);
    return;
  }
  for (const error of result.errors) console.log(`[FAIL] ${error}`);
  console.log(`[FAIL] 共 ${result.errors.length} 项错误；修正后再执行 run-once。`);
  process.exit(1);
}

/** 仓根相对路径展示（只读命令用）。 */
function relativePath(absPath) {
  return String(absPath)
    .replace(REPO_ROOT, '')
    .replace(/^[\\/]+/, '')
    .replace(/\\/g, '/');
}

/** AF-084：docs 文本 LF / BOM 规范化，默认只读检查，--apply 才写盘。 */
function cmdDocs(args) {
  const sub = args[0];
  if (sub !== 'normalize') {
    console.error('用法：docs normalize --path docs/<file>.md [--apply]');
    process.exit(2);
  }
  const pathArg = argValue(args, '--path');
  if (!pathArg) {
    console.error('用法：docs normalize --path docs/<file>.md [--apply]');
    process.exit(2);
  }
  const absPath = resolve(REPO_ROOT, pathArg);
  if (!existsSync(absPath)) throw new Error(`文件不存在：${pathArg}`);
  const rel = pathToPosix(absPath);
  if (!rel.startsWith('docs/')) throw new Error(`只允许规范化 docs/ 下的文本文件：${rel}`);
  const apply = args.includes('--apply');
  const before = inspectTextFile(absPath);
  if (!before.needsNormalize) {
    console.log(`[PASS] ${rel} 已是 UTF-8 无 BOM + LF（${before.bytes} bytes）`);
    return;
  }
  const result = normalizeTextFile(absPath, { apply });
  const summary = `BOM=${result.hasBom} CR=${result.crCount} ${result.bytesBefore} → ${result.bytesAfter} bytes`;
  if (apply) {
    console.log(`[APPLIED] ${rel} 已规范化为 UTF-8 无 BOM + LF（${summary}）`);
    return;
  }
  console.log(`[DRY-RUN] ${rel} 需要规范化（${summary}）；追加 --apply 落盘。`);
}

function printHelp() {
  console.log(
    '用法：cli.mjs <status|run-once|task|receipt|docs|watch|protocol|snapshot|pack|archive|events|validate|config|improvements> [参数]',
  );
  console.log('  archive <taskId> [--status ..] [--sheet ..] [--record ..] [--reply ..] [--note ..]');
  console.log('  task register --sheet <task.md> [--status ready]  解析 frontmatter 并登记进状态索引');
  console.log('  task import --handover <task.json> [--status ready]  补登 transport 已落交接件');
  console.log('  task resume --taskId <id> [--reason <text>]  解除租约超时的人工持单，允许重新领取');
  console.log('  task promote --taskId <id> [--reason <text>]  backlog → ready（校验任务单 / 基线 / 依赖满足）');
  console.log('  task cancel --taskId <id> [--reason <text>]  按状态机把非终态任务闭合到 canceled（随后可 archive）');
  console.log('  task reissue|rescope --from <oldId> --sheet <new.md> [--apply] [--archive-old]  受审计的 scope 重签发');
  console.log('  receipt lint --taskId <id> [--path <receipt.json>]  回执摄入前预检（七组字段 / scope / 工件 / 换行）');
  console.log('  docs normalize --path docs/<file>.md [--apply]  UTF-8 无 BOM + LF 规范化（默认只读）');
  console.log('  events verify|rebuild|backfill             事件日志校验 / 重建索引 / 首次回填');
  console.log('  worklog <migrate|verify|stats> [--apply|--json]  记录包迁移 / 完整性校验 / 统计');
  console.log('  events rotate [--max-events 5000] [--compress] [--force] [--dry-run]  归档当前日志段（不删事件）');
  console.log(
    '  events create --task-id <id> --title <标题> --type <类型> [--status backlog] [--context <id>] [--sheet <file>] [--record <file>]',
  );
  console.log('  branch <list|plan|create|merge|cleanup> [--taskId <id>] [--slug <slug>] [--apply] [--stale-days n]');
  console.log('  channel <rules|queue> [--taskId <id>]   AF-013 派发通道规则只读视图');
  console.log('  watch                        监听任务单 / 回执目录，变更防抖后自动执行一轮 run-once');
  console.log('  protocol                     导出标准协议视图（protocolView 只读映射投影）');
  console.log('  validate [--sheet <file>]   校验索引 / 工具契约 / Agent Card / Review 交接件（可选任务单元 JSON）');
  console.log('  improvements [--summary]              列出台账与活跃候选');
  console.log('  improvements --extract                 从快照遗留项抽取候选（只登记 candidate）');
  console.log(
    '  improvements --add --title .. --source .. --type .. --layer .. [--related-task ..] [--evidence a,b] [--impact ..] [--suggestion ..]',
  );
  console.log('  improvements --transition <IM-001> <queued|accepted|done|wontfix> [--note ..] [--linked-task ..]');
}

const [, , command, ...args] = process.argv;

switch (command) {
  case 'status':
    cmdStatus();
    break;
  case 'run-once':
    cmdRunOnce();
    break;
  case 'task':
    try {
      await cmdTask(args);
    } catch (err) {
      console.error(`任务操作失败：${err.message}`);
      process.exit(2);
    }
    break;
  case 'watch':
    cmdWatch();
    break;
  case 'protocol':
    cmdProtocol();
    break;
  case 'snapshot':
    cmdSnapshot();
    break;
  case 'pack':
    cmdPack();
    break;
  case 'archive':
    try {
      cmdArchive(args);
    } catch (err) {
      console.error(`归档失败：${err.message}`);
      process.exit(2);
    }
    break;
  case 'branch':
    // IM-018：合并门禁要读远端 CI 状态（异步），这里用 IIFE 承接，错误仍统一落到退出码 2。
    (async () => {
      try {
        await cmdBranch(args);
      } catch (err) {
        console.error(`分支流程失败：${err.message}`);
        process.exit(2);
      }
    })();
    break;
  case 'channel':
    try {
      cmdChannel(args);
    } catch (err) {
      console.error(`通道规则失败：${err.message}`);
      process.exit(2);
    }
    break;
  case 'events':
    try {
      await cmdEvents(args);
    } catch (err) {
      console.error(`事件日志操作失败：${err.message}`);
      process.exit(2);
    }
    break;
  case 'worklog':
    try {
      cmdWorklog(args);
    } catch (err) {
      console.error(`worklog 操作失败：${err.message}`);
      process.exit(2);
    }
    break;
  case 'validate':
    try {
      await cmdValidate(args);
    } catch (err) {
      console.error(`Schema 校验失败：${err.message}`);
      process.exit(2);
    }
    break;
  case 'config':
    cmdConfig(args);
    break;
  case 'improvements':
    try {
      cmdImprovements(args);
    } catch (err) {
      console.error(`台账操作失败：${err.message}`);
      process.exit(2);
    }
    break;
  case 'receipt':
    try {
      cmdReceipt(args);
    } catch (err) {
      console.error(`回执预检失败：${err.message}`);
      process.exit(2);
    }
    break;
  case 'docs':
    try {
      cmdDocs(args);
    } catch (err) {
      console.error(`文档规范化失败：${err.message}`);
      process.exit(2);
    }
    break;
  case undefined:
  case 'help':
  case '--help':
  case '-h':
    printHelp();
    break;
  default:
    console.error(`未知子命令：${command}`);
    printHelp();
    process.exit(2);
}
