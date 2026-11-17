/**
 * L2 验收护栏（机读项）。
 *
 * 对齐框架 docs/tools.md §8 V1–V6 与 docs/acceptance.md §3：只判定可由文件与
 * 结构复核的机读项；契约语义、口径 SSOT、偏差合理性、分歧仲裁列入人工复核，
 * 不由脚本下结论（设计备忘 §6）。
 *
 * 护栏：
 *   V1 任务单契约   任务单工件存在且非空；头部标识字段可抽取
 *   V2 索引契约     索引结构、归档轻量指针、任务标识模式符合结构断言
 *   V3 工件指针     登记指针存在且非空，可反查交付记录
 *   V4 链接可达     文档内相对链接目标存在；断链归零或显式标注
 *   V5 编码一致     文本工件无 BOM、无 CR（纯 LF）
 *   V6 工具契约     工具声明 JSON 字段与枚举合法；未登记工具声明时记 skip
 *
 * 结论：任一 fail → rejected；无 fail 且存在人工复核项 → conditional-pass；
 * 无 fail 且无人工复核项 → passed（五类全清，见框架 docs/acceptance.md §4）。
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { PATHS, REPO_ROOT } from './state-store.mjs';
import { detectResidualFiles, normalizeScope } from './scope-mutex.mjs';
import { TASK_ID_PATTERN, TOOL_CATEGORIES, SIDE_EFFECTS, ROLES } from './contract-enums.mjs';

function relToAbs(rel) {
  if (!rel) return null;
  return resolve(REPO_ROOT, rel);
}

/** 文本文件探测：存在性、大小、BOM、CR。 */
function probeTextFile(absPath) {
  const probe = { exists: false, size: 0, hasBom: false, hasCr: false, text: null };
  if (!absPath || !existsSync(absPath)) return probe;
  probe.exists = true;
  probe.size = statSync(absPath).size;
  const buf = readFileSync(absPath);
  probe.hasBom = buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf;
  probe.hasCr = buf.includes(0x0d);
  probe.text = buf.toString('utf8');
  return probe;
}

function extractMarkdownLinks(text) {
  const links = [];
  const re = /\]\(([^)]+)\)/g;
  let match;
  while ((match = re.exec(text)) !== null) {
    const target = match[1].trim();
    if (!target) continue;
    if (/^(https?:|mailto:|#|data:)/.test(target)) continue;
    links.push(target);
  }
  return links;
}

function record(checks, code, name, status, detail) {
  checks.push({ code, name, status, detail });
}

/** V1 任务单契约。 */
function checkTaskSheet(task) {
  const checks = [];
  const rel = task.artifacts?.taskSheet;
  const abs = relToAbs(rel);
  if (!rel) {
    record(checks, 'V1', '任务单契约', 'fail', '任务单指针缺失');
    return { checks, manualReview: [] };
  }
  const probe = probeTextFile(abs);
  if (!probe.exists || probe.size === 0) {
    record(checks, 'V1', '任务单契约', 'fail', `任务单不存在或为空：${rel}`);
    return { checks, manualReview: [] };
  }
  const missing = [];
  for (const field of ['taskId', 'contextId', 'type']) {
    if (!task[field]) missing.push(field);
  }
  if (missing.length > 0) {
    record(checks, 'V1', '任务单契约', 'fail', `任务标识字段缺失：${missing.join(', ')}`);
  } else {
    record(checks, 'V1', '任务单契约', 'pass', '任务单存在非空，标识字段齐全');
  }
  return { checks, manualReview: [] };
}

/** V2 索引契约（结构断言；schema 合规由独立校验步骤用框架 schema 复核）。 */
function checkIndexContract(index, task) {
  const checks = [];
  const problems = [];
  if (!Array.isArray(index.tasks)) problems.push('tasks 非数组');
  if (!Array.isArray(index.archivedTasks)) problems.push('archivedTasks 非数组');
  if (!TASK_ID_PATTERN.test(task.taskId ?? '')) problems.push(`taskId 不符合标识模式：${task.taskId}`);
  if (problems.length > 0) {
    record(checks, 'V2', '索引契约', 'fail', problems.join('；'));
  } else {
    record(checks, 'V2', '索引契约', 'pass', '索引结构与任务标识模式通过结构断言');
  }
  return { checks, manualReview: [] };
}

/** V3 工件指针。 */
function checkArtifactRefs(task) {
  const checks = [];
  const refs = task.artifacts ?? {};
  const missing = [];
  const empty = [];
  for (const key of ['taskSheet', 'deliveryRecord', 'reply']) {
    const rel = refs[key];
    if (rel === undefined || rel === null) continue;
    const probe = probeTextFile(relToAbs(rel));
    if (!probe.exists) missing.push(`${key}: ${rel}`);
    else if (probe.size === 0) empty.push(`${key}: ${rel}`);
  }
  const problems = [...missing.map((m) => `指针不存在 ${m}`), ...empty.map((e) => `指针为空 ${e}`)];
  if (problems.length > 0) {
    record(checks, 'V3', '工件指针', 'fail', problems.join('；'));
  } else {
    record(checks, 'V3', '工件指针', 'pass', '已登记工件指针存在且非空');
  }
  return { checks, manualReview: [] };
}

/** V4 链接可达（相对链接；http / 锚点 / mailto 跳过）。 */
function checkLinks(task) {
  const checks = [];
  const rel = task.artifacts?.deliveryRecord ?? task.artifacts?.taskSheet;
  if (!rel) {
    record(checks, 'V4', '链接可达', 'skip', '无工件文档可检查链接');
    return { checks, manualReview: [] };
  }
  const abs = relToAbs(rel);
  const probe = probeTextFile(abs);
  if (!probe.exists) {
    record(checks, 'V4', '链接可达', 'fail', `链接检查对象不存在：${rel}`);
    return { checks, manualReview: [] };
  }
  const broken = [];
  for (const target of extractMarkdownLinks(probe.text ?? '')) {
    const targetAbs = resolve(dirname(abs), target);
    if (!existsSync(targetAbs)) broken.push(target);
  }
  if (broken.length > 0) {
    record(checks, 'V4', '链接可达', 'fail', `断链：${broken.join('；')}`);
  } else {
    record(checks, 'V4', '链接可达', 'pass', '相对链接目标均存在');
  }
  return { checks, manualReview: [] };
}

/** V5 编码一致。 */
function checkEncoding(task) {
  const checks = [];
  const refs = task.artifacts ?? {};
  const bad = [];
  for (const key of ['taskSheet', 'deliveryRecord', 'reply']) {
    const rel = refs[key];
    if (!rel) continue;
    const probe = probeTextFile(relToAbs(rel));
    if (!probe.exists) continue;
    if (probe.hasBom) bad.push(`${key}: 含 BOM`);
    if (probe.hasCr) bad.push(`${key}: 含 CR`);
  }
  if (bad.length > 0) {
    record(checks, 'V5', '编码一致', 'fail', bad.join('；'));
  } else {
    record(checks, 'V5', '编码一致', 'pass', '工件无 BOM、无 CR（纯 LF）');
  }
  return { checks, manualReview: [] };
}

/** V6 工具契约：遍历 `tools/*.json`（一工具一文件），断言字段、枚举与 contractRef；目录缺失记 skip。 */
function checkToolContracts() {
  const checks = [];
  if (!existsSync(PATHS.toolsDir)) {
    record(checks, 'V6', '工具契约', 'skip', '未登记工具声明工件；工具契约 schema 合规由框架仓样例校验覆盖');
    return { checks, manualReview: [] };
  }
  const problems = [];
  let tools = [];
  const files = readdirSync(PATHS.toolsDir).filter((f) => f.endsWith('.json'));
  try {
    for (const file of files) {
      tools.push({ file, tool: JSON.parse(readFileSync(join(PATHS.toolsDir, file), 'utf8')) });
    }
  } catch (err) {
    record(checks, 'V6', '工具契约', 'fail', `工具声明 JSON 解析失败：${err.message}`);
    return { checks, manualReview: [] };
  }
  if (tools.length === 0) problems.push('工具目录为空');
  for (const { file, tool } of tools) {
    const id = tool.toolId ?? file;
    if (!tool.toolId) problems.push(`${id}：缺 toolId`);
    else if (`${tool.toolId}.json` !== file) problems.push(`${id}：文件名须与 toolId 一致（${file}）`);
    if (!tool.category) problems.push(`${id}：缺 category`);
    else if (!TOOL_CATEGORIES.includes(tool.category)) problems.push(`${id}：category 不在 8 值枚举内（${tool.category}）`);
    if (!SIDE_EFFECTS.includes(tool.sideEffect)) problems.push(`${id}：sideEffect 非法（${String(tool.sideEffect)}）`);
    if (typeof tool.contractRef !== 'string' || !tool.contractRef.includes('tool-contract')) {
      problems.push(`${id}：contractRef 缺失或非 tool-contract 契约`);
    }
    if (!Array.isArray(tool.allowedRoles)) {
      problems.push(`${id}：allowedRoles 须为数组`);
    } else {
      for (const role of tool.allowedRoles) {
        if (!ROLES.includes(role)) problems.push(`${id}：角色非法（${role}）`);
      }
    }
  }
  if (problems.length > 0) {
    record(checks, 'V6', '工具契约', 'fail', problems.join('；'));
  } else {
    record(checks, 'V6', '工具契约', 'pass', `工具声明 ${tools.length} 件（一工具一文件），字段与枚举合法`);
  }
  return { checks, manualReview: [] };
}

/**
 * 编排状态面生成物：由 CLI 在每轮推进时自动重写（快照 / 索引投影 / 事件日志 / transport）。
 * 它们不属于任何单个任务的交付面，V7 必须排除，否则每次验收都会把编排自己的写入
 * 判成任务越域，导致真实的合规任务永久 rejected。
 */
export const STATE_PLANE_ARTIFACTS = [
  'docs/team/agent-orchestration/orchestration-state.json',
  'docs/team/agent-orchestration/orchestration-snapshot.json',
  'docs/team/agent-orchestration/task-state-index.json',
  'docs/team/agent-orchestration/state/journal.jsonl',
  'docs/team/agent-orchestration/state/archived-notes.json',
  'web/orchestration/data.js',
];

/** transport 目录整体属运行态收件箱，不作为任务交付面。 */
const STATE_PLANE_DIR_PREFIXES = ['docs/team/agent-orchestration/transport/'];

/** 该变更文件是否属编排状态面（V7 排除）。 */
export function isStatePlaneArtifact(file) {
  const path = String(file ?? '')
    .replace(/\\/g, '/')
    .replace(/^\.\//, '');
  if (STATE_PLANE_ARTIFACTS.includes(path)) return true;
  return STATE_PLANE_DIR_PREFIXES.some((prefix) => path.startsWith(prefix));
}

/**
 * 任务单本身也是编排状态面：登记 / 提级 / 提交 / 归档每一跳都会改写它的状态行与 §状态，
 * 把它算成交付残留会让任何走了正规流程的任务都必然 rejected。V7 因而按
 * 「本任务自己的任务单路径」精确排除，不按目录前缀排除（同目录的其它任务单仍是交付面）。
 */
export function isTaskSheetArtifact(task, file) {
  const normalize = (value) =>
    String(value ?? '')
      .replace(/\\/g, '/')
      .replace(/^\.\//, '');
  const sheet = normalize(task?.artifacts?.taskSheet);
  if (!sheet) return false;
  const path = normalize(file);
  return path === sheet;
}

/**
 * V7 文件域残留：变更清单与 scope 比对，清单外文件判残留（只识别报告，不删除、不归集）。
 * changedFiles 由调用方采集 git diff 传入；未传入时记 skip（纯函数模块无 git IO）。
 * 编排状态面生成物先剔除，再与任务 scope 比对。
 *
 * AF-043-I1：回执用 `changedFiles.commits` 声明提交集合后，**改按 commit 事实比对**。
 * 原因：V7 原来按 `git diff` 全树比对，同批次多任务共存时必然互相误判——AF-040、AF-042
 * 连续两次实现全部在库却判 `rejected`，都是把别人的未提交改动算成本单越界。
 * 声明 commit 后，工作树里属同批次其它任务的在办改动不参与比对（只写进 detail 供人看）。
 */
function checkResidual(task, opts) {
  const checks = [];
  // 只读 / 调研 / 评审 / 验证类任务不占写域，产出报告不需要落进 scope.files；
  // 否则每次只读调研都会被 V7 误判为残留。
  if (normalizeScope(task).readOnly) {
    record(checks, 'V7', '文件域残留', 'pass', '只读任务不占写域，报告类产出不纳入残留比对');
    return { checks, manualReview: [] };
  }
  const changed = Array.isArray(opts?.changedFiles) ? opts.changedFiles : null;
  const declaredCommits = Array.isArray(task?.receipt?.changedFiles?.commits) ? task.receipt.changedFiles.commits : [];
  if (declaredCommits.length > 0) {
    return checkResidualByCommits(task, opts, declaredCommits, changed);
  }
  if (!changed || changed.length === 0) {
    record(checks, 'V7', '文件域残留', 'skip', '未传入变更文件清单；残留比对需调用方采集 git diff');
    return { checks, manualReview: [] };
  }
  const statePlane = changed.filter(isStatePlaneArtifact);
  const sheet = changed.filter((file) => !isStatePlaneArtifact(file) && isTaskSheetArtifact(task, file));
  const deliverable = changed.filter((file) => !isStatePlaneArtifact(file) && !isTaskSheetArtifact(task, file));
  if (deliverable.length === 0) {
    record(
      checks,
      'V7',
      '文件域残留',
      'pass',
      `变更清单仅含编排状态面生成物 ${statePlane.length} 项${sheet.length > 0 ? ` + 本任务任务单 ${sheet.length} 项` : ''}，不纳入任务交付面比对`,
    );
    return { checks, manualReview: [] };
  }
  const { covered, residual } = detectResidualFiles(deliverable, task);
  if (residual.length > 0) {
    record(checks, 'V7', '文件域残留', 'fail', `scope 外变更文件（不进提交分组）：${residual.join('；')}`);
  } else {
    record(checks, 'V7', '文件域残留', 'pass', `变更 ${deliverable.length} 个交付文件均在 scope 文件域内（覆盖 ${covered.length}）`);
  }
  return { checks, manualReview: [] };
}

/**
 * 按回执声明的提交集合做残留比对（AF-043-I1）。
 * 解析失败即 fail：声明了 commit 却给不出文件清单，等于没有证据。
 */
function checkResidualByCommits(task, opts, declaredCommits, changed) {
  const checks = [];
  const resolver = opts?.resolveCommitFiles;
  if (typeof resolver !== 'function') {
    record(checks, 'V7', '文件域残留', 'skip', '回执声明了 commit 集合，但调用方未注入 commit 解析器；残留比对按 commit 事实进行需 git');
    return { checks, manualReview: [] };
  }
  const files = new Set();
  const unresolved = [];
  for (const sha of declaredCommits) {
    const list = resolver(sha);
    if (!Array.isArray(list)) {
      unresolved.push(sha);
      continue;
    }
    for (const file of list) files.add(String(file).replace(/\\/g, '/').replace(/^\.\//, ''));
  }
  if (unresolved.length > 0) {
    record(checks, 'V7', '文件域残留', 'fail', `回执声明的 commit 无法解析（不存在或不在本仓）：${unresolved.join('；')}`);
    return { checks, manualReview: [] };
  }
  const deliverable = [...files].filter((file) => !isStatePlaneArtifact(file) && !isTaskSheetArtifact(task, file));
  const uncommitted = Array.isArray(changed) ? changed.length : 0;
  if (deliverable.length === 0) {
    record(
      checks,
      'V7',
      '文件域残留',
      'pass',
      `声明的 ${declaredCommits.length} 个提交未改动任务交付面（工作树 ${uncommitted} 项未提交改动不参与比对）`,
    );
    return { checks, manualReview: [] };
  }
  const { covered, residual } = detectResidualFiles(deliverable, task);
  if (residual.length > 0) {
    record(checks, 'V7', '文件域残留', 'fail', `scope 外提交文件（已按 commit 事实比对）：${residual.join('；')}`);
  } else {
    record(
      checks,
      'V7',
      '文件域残留',
      'pass',
      `按声明 commit 集合比对：${declaredCommits.length} 个提交 / ${deliverable.length} 个交付文件均在 scope 文件域内（覆盖 ${covered.length}）；工作树另有 ${uncommitted} 项未提交改动不参与比对`,
    );
  }
  return { checks, manualReview: [] };
}

/**
 * 人工复核项：只列**本次回执真实存在**的、脚本不可判定的项。
 * 固定样板项会让 `passed` 永远不可达（五类全清也无法通过），因此逐项按证据触发：
 * 遗留 / 偏差 / 未决问题非空、回执缺失、交付记录字段标记不全才计入。
 */
function manualReviewItems(task) {
  const items = [];
  const receipt = task.receipt ?? null;
  if (!receipt) {
    items.push('缺机读回执：验收只有交付记录，未摄入 transport 回执');
  }
  if (Array.isArray(receipt?.deviationTable) && receipt.deviationTable.length > 0) {
    items.push(`偏差表 ${receipt.deviationTable.length} 条：需人工确认每条偏差可接受且已缓解`);
  }
  if (Array.isArray(receipt?.openQuestions) && receipt.openQuestions.length > 0) {
    items.push(`未决问题 ${receipt.openQuestions.length} 条：需人工裁决后回写`);
  }
  if (Array.isArray(receipt?.manualReviewList) && receipt.manualReviewList.length > 0) {
    items.push(`执行侧自报复核项 ${receipt.manualReviewList.length} 条：需逐条确认`);
  }
  if (Array.isArray(receipt?.backlogItems) && receipt.backlogItems.length > 0) {
    items.push(`遗留登记 ${receipt.backlogItems.length} 条：需确认影响面与排期`);
  }
  const rel = task.artifacts?.deliveryRecord;
  if (rel) {
    const probe = probeTextFile(relToAbs(rel));
    if (probe.exists && probe.text) {
      for (const group of ['gateResults', 'scopeCheck', 'contractChecks', 'backlogItems', 'deviationTable', 'reviewVerdict']) {
        if (!probe.text.includes(group)) items.push(`交付记录未出现字段标记：${group}`);
      }
    }
  }
  return items;
}

/**
 * 运行单任务验收。
 * @param {object} task 索引任务条目
 * @param {object} index 完整索引
 * @param {object} [opts] changedFiles：本次变更文件相对路径清单（V7 残留比对）；缺省 skip
 * @returns {{taskId:string, verdict:'passed'|'conditional-pass'|'rejected', checks:object[], manualReview:string[], rationale:string}}
 */
export function runAcceptance(task, index, opts = {}) {
  const parts = [
    checkTaskSheet(task),
    checkIndexContract(index, task),
    checkArtifactRefs(task),
    checkLinks(task),
    checkEncoding(task),
    checkToolContracts(),
    checkResidual(task, opts),
  ];
  const checks = parts.flatMap((p) => p.checks);
  const manualReview = manualReviewItems(task);
  const hasFail = checks.some((c) => c.status === 'fail');

  let verdict;
  if (hasFail) verdict = 'rejected';
  else if (manualReview.length > 0) verdict = 'conditional-pass';
  else verdict = 'passed';

  const failed = checks.filter((c) => c.status === 'fail').map((c) => c.detail);
  const rationale = hasFail
    ? `机读护栏不通过：${failed.join('；')}`
    : manualReview.length > 0
      ? '机读护栏全绿，存在需人工复核的语义 / 口径项'
      : '机读护栏全绿且无人工复核项';

  return { taskId: task.taskId, verdict, checks, manualReview, rationale };
}

/** 供 CLI / 快照复用的路径常量。 */
export { PATHS, REPO_ROOT };
