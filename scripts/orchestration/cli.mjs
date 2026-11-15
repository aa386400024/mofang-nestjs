/**
 * L2 编排工具链 CLI 入口。
 *
 * 子命令：
 *   status                 打印队列概览计数与任务列表（读快照；无快照则按当前索引构建）
 *   run-once               执行一轮状态机推进并落盘索引 / 运行态 / 快照
 *   snapshot               仅刷新队列快照（不推进验收与返修）
 *   pack                   生成夜间交付包（JSON + MD 副本）
 *   config --enable        开启自治模式（写回 config.json）
 *   config --disable       关闭自治模式
 *
 * 用法（pnpm，禁裸 npx）：`pnpm orchestration:<subcommand>`，入口在 package.json。
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { PATHS, loadConfig, loadIndex, loadRuntimeState, saveConfigPatch, writeJsonAtomic } from './state-store.mjs';
import { advanceOnce, buildSnapshot, shouldAdvance } from './scheduler.mjs';
import { generateDeliveryPack } from './delivery-pack.mjs';

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
  const snapshot = readSnapshot() ?? buildSnapshot(loadIndex(), loadRuntimeState(), loadConfig());
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
  const snapshot = buildSnapshot(loadIndex(), loadRuntimeState(), loadConfig());
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

function printHelp() {
  console.log('用法：cli.mjs <status|run-once|snapshot|pack|config> [--enable|--disable]');
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
