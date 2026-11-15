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
 *   validate [--sheet f]   AF-006 框架 schema 机读校验（索引 / 工具契约 / Agent Card）
 *   config --enable        开启自治模式（写回 config.json）
 *   config --disable       关闭自治模式
 *
 * 用法（pnpm，禁裸 npx）：`pnpm orchestration:<subcommand>`，入口在 package.json。
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { PATHS, REPO_ROOT, loadConfig, loadIndex, loadRuntimeState, saveConfigPatch, saveIndex, writeJsonAtomic } from './state-store.mjs';
import { advanceOnce, archiveTaskEntry, buildSnapshot, shouldAdvance } from './scheduler.mjs';
import { validateAgentCard, validateTaskIndex, validateTaskSheet, validateToolManifest } from './validator.mjs';
import { loadRegistry, call as registryCall } from './tool-registry.mjs';
import { loadAuditLog, saveAuditLog } from './audit-log.mjs';
import { createWatcher } from './file-watcher.mjs';
import { generateDeliveryPack } from './delivery-pack.mjs';
import {
  addCandidate,
  extractFromSnapshot,
  listOpen,
  loadImprovementLog,
  saveImprovementLog,
  summarizeLog,
  transitionImprovement,
} from './improvement-log.mjs';

/** 快照双写：JSON（机读 / 存档）+ data.js（静态网页在 file:// 下读取，规避本地 fetch 限制）。 */
function writeSnapshotArtifacts(snapshot) {
  writeJsonAtomic(PATHS.snapshot, snapshot);
  writeFileSync(PATHS.webDataJs, `// 由 orchestration CLI 生成，勿手改\nwindow.ORCH_SNAPSHOT = ${JSON.stringify(snapshot, null, 2)};\n`, {
    encoding: 'utf8',
  });
}

/**
 * 重建快照并双写 JSON + data.js，供变更类命令尾部自动刷新看板数据。
 * 索引缺失等读取异常时跳过刷新并告警，不阻断台账 / 交付包等已落盘产物。
 * @returns {object|null} 快照对象；跳过刷新时为 null。
 */
function refreshSnapshotArtifacts() {
  try {
    const config = loadConfig();
    const snapshot = buildSnapshot(loadIndex(), loadRuntimeState(), config, summarizeLog(loadImprovementLog()));
    writeSnapshotArtifacts(snapshot);
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

/** 派发类动作逐条落审计（通道、任务标识、交接件指针）；复用队列调度器工具契约。 */
function auditDispatchActions(actions) {
  for (const action of actions ?? []) {
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
    `计数：ready=${c.ready} submitted=${c.submitted} working=${c.working} completed=${c.completed} failed=${c.failed} canceled=${c.canceled} rejected=${c.rejected} input-required=${c['input-required']} deadLetter=${c.deadLetter}`,
  );
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
}

function cmdRunOnce() {
  const config = loadConfig();
  if (!shouldAdvance(config)) {
    console.log('自治模式关闭：本轮仅生成只读快照，不执行领单 / 验收归档 / 返修等状态迁移。');
  }
  auditRegistryCall('TOOL-QUEUE-SCHEDULER', { actor: 'orchestrator', correlationId: 'run-once' });
  const { snapshot, actions } = advanceOnce({ commit: true });
  auditDispatchActions(actions);
  writeSnapshotArtifacts(snapshot);
  for (const action of actions) console.log(`[动作] ${action.type} ${action.taskId ?? ''}${action.reason ? `（${action.reason}）` : ''}`);
  console.log('');
  printSnapshot(snapshot);
}

function cmdWatch() {
  const dirs = [
    join(REPO_ROOT, 'docs', 'worklog', 'pending'),
    join(REPO_ROOT, 'docs', 'worklog', 'completed'),
    join(PATHS.transportDir, 'receipts'),
  ];
  const watcher = createWatcher({
    dirs,
    debounceMs: 300,
    onChange(events) {
      console.log(`[watch] 检测到变更 ${events.length} 项，执行一轮 run-once`);
      auditRegistryCall('TOOL-QUEUE-SCHEDULER', { actor: 'orchestrator', correlationId: 'watch' });
      const { snapshot, actions } = advanceOnce({ commit: true });
      auditDispatchActions(actions);
      writeSnapshotArtifacts(snapshot);
      for (const action of actions)
        console.log(`[动作] ${action.type} ${action.taskId ?? ''}${action.reason ? `（${action.reason}）` : ''}`);
      printSnapshot(snapshot);
    },
    onError(err) {
      console.error(`[watch] 监听错误：${err.message}`);
    },
  });
  console.log(`[watch] 监听目录：${dirs.join('、')}；Ctrl+C 退出。`);
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
  const snapshot = refreshSnapshotArtifacts();
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
    `任务结论=${pack.taskResults.length} 死信=${pack.deadLetters.length} 遗留项=${pack.openItems.length} 待批=${pack.pendingApprovals.length}`,
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
  const entry = archiveTaskEntry(index, taskId, { status, artifacts, note });
  saveIndex(index);
  auditRegistryCall('TOOL-QUEUE-SCHEDULER', { actor: 'orchestrator', correlationId: `archive:${taskId}` });
  refreshSnapshotArtifacts();
  console.log(`已归档：${entry.taskId} [${entry.status}]${note ? `｜${note}` : ''}`);
}

const SKIPPED = { ok: true, skipped: true, errors: [], schemaId: null };

/** AF-006：框架 schema 机读校验（索引 / 工具契约 / Agent Card；可选任务单元 JSON）。 */
async function cmdValidate(args) {
  const sections = [];

  if (existsSync(PATHS.index)) {
    sections.push(['状态索引', await validateTaskIndex(JSON.parse(readFileSync(PATHS.index, 'utf8')))]);
  } else {
    sections.push(['状态索引', SKIPPED]);
  }

  if (existsSync(PATHS.toolsContractFile)) {
    sections.push(['工具契约清单', await validateToolManifest(JSON.parse(readFileSync(PATHS.toolsContractFile, 'utf8')))]);
  } else {
    sections.push(['工具契约清单', SKIPPED]);
  }

  const cardFiles = existsSync(PATHS.agentCardsDir) ? readdirSync(PATHS.agentCardsDir).filter((f) => f.endsWith('.json')) : [];
  for (const file of cardFiles) {
    const card = JSON.parse(readFileSync(join(PATHS.agentCardsDir, file), 'utf8'));
    sections.push([`Agent Card ${file}`, await validateAgentCard(card)]);
  }

  const sheetFile = argValue(args, '--sheet');
  if (sheetFile) {
    const abs = resolve(REPO_ROOT, sheetFile);
    if (existsSync(abs)) {
      sections.push(['任务单元', await validateTaskSheet(JSON.parse(readFileSync(abs, 'utf8')))]);
    } else {
      console.log(`[SKIP] 任务单元：文件不存在：${sheetFile}`);
    }
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
    const added = drafts.map((draft) => addCandidate(log, draft));
    if (added.length > 0) saveImprovementLog(log);
    refreshSnapshotArtifacts();
    console.log(`从快照抽取候选 ${added.length} 条${added.length === 0 ? '（无新增，均已登记或队列为空）' : ''}。`);
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

function printHelp() {
  console.log('用法：cli.mjs <status|run-once|watch|protocol|snapshot|pack|archive|validate|config|improvements> [参数]');
  console.log('  archive <taskId> [--status ..] [--sheet ..] [--record ..] [--reply ..] [--note ..]');
  console.log('  watch                        监听任务单 / 回执目录，变更防抖后自动执行一轮 run-once');
  console.log('  protocol                     导出标准协议视图（protocolView 只读映射投影）');
  console.log('  validate [--sheet <file>]   校验索引 / 工具契约 / Agent Card（可选任务单元 JSON）');
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
