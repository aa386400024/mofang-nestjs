/**
 * L2 编排工具链 CLI 入口。
 *
 * 子命令：
 *   status                 打印队列概览计数与任务列表（读快照；无快照则按当前索引构建）
 *   run-once               执行一轮状态机推进并落盘索引 / 运行态 / 快照
 *   snapshot               仅刷新队列快照（不推进验收与返修）
 *   pack                   生成夜间交付包（JSON + MD 副本）
 *   improvements           候选改进台账：list / extract / add / transition
 *   config --enable        开启自治模式（写回 config.json）
 *   config --disable       关闭自治模式
 *
 * 用法（pnpm，禁裸 npx）：`pnpm orchestration:<subcommand>`，入口在 package.json。
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { PATHS, loadConfig, loadIndex, loadRuntimeState, saveConfigPatch, writeJsonAtomic } from './state-store.mjs';
import { advanceOnce, buildSnapshot, shouldAdvance } from './scheduler.mjs';
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
  const { snapshot, actions } = advanceOnce({ commit: true });
  writeSnapshotArtifacts(snapshot);
  for (const action of actions) console.log(`[动作] ${action.type} ${action.taskId ?? ''}${action.reason ? `（${action.reason}）` : ''}`);
  console.log('');
  printSnapshot(snapshot);
}

function cmdSnapshot() {
  const snapshot = buildSnapshot(loadIndex(), loadRuntimeState(), loadConfig(), summarizeLog(loadImprovementLog()));
  writeSnapshotArtifacts(snapshot);
  console.log(`快照已写入：${PATHS.snapshot}`);
  printSnapshot(snapshot);
}

function cmdPack() {
  const { pack, jsonPath, mdPath } = generateDeliveryPack({ write: true });
  console.log(`交付包 JSON：${jsonPath}`);
  console.log(`交付包 MD ：${mdPath}`);
  console.log(
    `任务结论=${pack.taskResults.length} 死信=${pack.deadLetters.length} 遗留项=${pack.openItems.length} 待批=${pack.pendingApprovals.length}`,
  );
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
    const snapshot = buildSnapshot(loadIndex(), loadRuntimeState(), loadConfig());
    const drafts = extractFromSnapshot(snapshot, log.improvements);
    const added = drafts.map((draft) => addCandidate(log, draft));
    if (added.length > 0) saveImprovementLog(log);
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
  console.log('用法：cli.mjs <status|run-once|snapshot|pack|config|improvements> [参数]');
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
  case 'snapshot':
    cmdSnapshot();
    break;
  case 'pack':
    cmdPack();
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
