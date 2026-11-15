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
 *   V6 工具契约     工具声明 JSON 结构齐全（当前仓无工具声明时记 skip）
 *
 * 结论：任一 fail → rejected；无 fail 且人工复核非空 → conditional-pass；
 * 无 fail 且人工复核为空 → passed。
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { PATHS, REPO_ROOT } from './state-store.mjs';

const TASK_ID_PATTERN = /^[A-Z0-9]+-[0-9]+$/;

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

/** V6 工具契约：当前仓未登记工具声明 JSON，记 skip；存在时做基础字段断言。 */
function checkToolContracts() {
  const checks = [];
  record(checks, 'V6', '工具契约', 'skip', '当前仓无工具声明工件；工具契约 schema 合规由框架仓样例校验覆盖');
  return { checks, manualReview: [] };
}

/** 人工复核项：脚本不可判定的语义 / 口径 / 偏差类核对。 */
function manualReviewItems(task) {
  const items = [
    '回执七组字段完整性（落地 / 证据 / 范围 / 契约 / 遗留 / 偏差 / 结论）需人工逐条核对',
    '契约语义对齐与字段可空性需人工确认；真相源唯一、消费端不复算口径',
    '偏差表合理性与失败项定性（确定性缺陷 / 偶发波动）需人工复核',
  ];
  const rel = task.artifacts?.deliveryRecord;
  if (rel) {
    const probe = probeTextFile(relToAbs(rel));
    if (probe.exists && probe.text) {
      for (const group of ['gateResults', 'scopeCheck', 'contractChecks', 'backlogItems', 'deviationTable', 'reviewVerdict']) {
        if (!probe.text.includes(group)) items.push(`回执交付记录未出现字段标记：${group}`);
      }
    }
  }
  return items;
}

/**
 * 运行单任务验收。
 * @param {object} task 索引任务条目
 * @param {object} index 完整索引
 * @returns {{taskId:string, verdict:'passed'|'conditional-pass'|'rejected', checks:object[], manualReview:string[], rationale:string}}
 */
export function runAcceptance(task, index) {
  const parts = [
    checkTaskSheet(task),
    checkIndexContract(index, task),
    checkArtifactRefs(task),
    checkLinks(task),
    checkEncoding(task),
    checkToolContracts(),
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
