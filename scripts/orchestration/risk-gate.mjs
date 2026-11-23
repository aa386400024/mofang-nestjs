/**
 * AF-365 · 风险分级门禁策略（框架 v2.1 task-sheet 1.2.0）。
 *
 * 设计口径：
 *   - 风险等级只调整「执行范围与证据深度」，不减少五类核对；
 *   - R0 仅限文档 / 注释 / 零运行时影响；R1 为普通实现（默认）；R2 为核心引擎、
 *     临床语义、安全、迁移、跨模块高风险；
 *   - 显式 riskClass 优先于路径推断；路径推断只用于没有任务单的 push / 工具调用；
 *   - gatePlan 返回每个 check 是否执行，未执行项必须显式记录原因，不允许静默放行。
 */
import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export const RISK_CLASSES = ['R0', 'R1', 'R2'];

/** R2 路径：核心引擎、适配层、迁移、安全、契约、CI 拓扑、跨模块编排。 */
export const R2_PATH_PATTERNS = [
  /^(src\/engine-core|src\/engine-adapters)\//,
  /^src\/migration\//,
  /^src\/shared\/infra\//,
  /^src\/user\//,
  /^contracts\//,
  /^\.github\/workflows\//,
  /^scripts\/orchestration\//,
  /^bin\/ormconfig\.ts$/,
  /^docker\//,
  /^\.env\.example$/,
];

/** R0 路径：只允许纯文档 / 注释 / 计划，且不得同时出现代码或配置。 */
export const R0_PATH_PATTERNS = [/^docs\//, /^.*\.md$/i, /^LICENSE$/, /^\.gitignore$/, /^\.prettierignore$/];

function normalize(path) {
  return String(path ?? '')
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\.\//, '');
}

/**
 * 从任务单 frontmatter 读取 riskClass / gateProfile。
 * @param {string} text
 * @returns {{riskClass:string|null, gateProfile:string|null}}
 */
export function parseTaskSheetRisk(text) {
  const source = String(text ?? '');
  const riskClass = /^riskClass:\s*(R[0-2])\s*$/m.exec(source)?.[1] ?? null;
  const gateProfile = /^gateProfile:\s*(\S+)\s*$/m.exec(source)?.[1] ?? null;
  return { riskClass, gateProfile: gateProfile ? gateProfile.replace(/^["']|["']$/g, '') : null };
}

/**
 * 路径风险推断。
 * @param {string[]} changedFiles
 * @returns {'R0'|'R1'|'R2'}
 */
export function inferRiskFromPaths(changedFiles) {
  const files = (changedFiles ?? []).map(normalize).filter(Boolean);
  if (files.length === 0) return 'R1';
  if (files.some((file) => R2_PATH_PATTERNS.some((pattern) => pattern.test(file)))) return 'R2';
  const allDocs = files.every((file) => R0_PATH_PATTERNS.some((pattern) => pattern.test(file)));
  return allDocs ? 'R0' : 'R1';
}

/**
 * 合并显式风险与路径推断。显式 R2 永远压过路径；显式 R0 只在路径也全部为文档时成立。
 * @param {{changedFiles?:string[], explicitRiskClass?:string|null}} input
 * @returns {{riskClass:string, source:string, rationale:string[]}}
 */
export function resolveRiskClass({ changedFiles = [], explicitRiskClass = null } = {}) {
  const inferred = inferRiskFromPaths(changedFiles);
  if (explicitRiskClass && RISK_CLASSES.includes(explicitRiskClass)) {
    if (explicitRiskClass === 'R0' && inferred !== 'R0') {
      return {
        riskClass: 'R1',
        source: 'explicit-downgraded-to-R1',
        rationale: ['任务单声明 R0，但改动包含运行时/配置路径，按 R1 执行'],
      };
    }
    return {
      riskClass: explicitRiskClass,
      source: 'task-sheet',
      rationale: [`任务单 riskClass=${explicitRiskClass}`],
    };
  }
  return {
    riskClass: inferred,
    source: 'path-inference',
    rationale: [`按改动路径推断 ${inferred}`],
  };
}

/**
 * 门禁执行计划。13 项 required checks 全部保留；跳过项必须由调用方打印原因。
 * @param {'R0'|'R1'|'R2'} riskClass
 */
export function gatePlan(riskClass) {
  const risk = RISK_CLASSES.includes(riskClass) ? riskClass : 'R1';
  const plan = {
    riskClass: risk,
    orchestration: true,
    lint: true,
    contracts: risk !== 'R0',
    security: risk !== 'R0',
    unit: risk !== 'R0',
    coverage: risk === 'R2',
    e2e: risk === 'R2',
    build: risk === 'R2',
    skipped: [],
  };
  if (!plan.contracts) plan.skipped.push('Contracts');
  if (!plan.security) plan.skipped.push('Security Audit');
  if (!plan.unit) plan.skipped.push('Unit 1/3', 'Unit 2/3', 'Unit 3/3');
  if (!plan.coverage) plan.skipped.push('Coverage 1/3', 'Coverage 2/3', 'Coverage 3/3', 'Coverage Gate');
  if (!plan.e2e) plan.skipped.push('E2E');
  if (!plan.build) plan.skipped.push('Build (Docker)');
  return plan;
}

/** 在记录包里按 taskId 目录找任务单。 */
export function readTaskRisk(taskId) {
  if (!taskId) return { riskClass: null, gateProfile: null, sheet: null };
  const records = join('docs', 'worklog', 'records');
  if (!existsSync(records)) return { riskClass: null, gateProfile: null, sheet: null };
  const stack = [records];
  while (stack.length) {
    const current = stack.pop();
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = join(current, entry.name);
      if (entry.isDirectory() && entry.name === taskId) {
        const sheet = join(full, 'task-sheet.md');
        if (existsSync(sheet)) return { ...parseTaskSheetRisk(readFileSync(sheet, 'utf8')), sheet };
      }
      if (entry.isDirectory()) stack.push(full);
    }
  }
  return { riskClass: null, gateProfile: null, sheet: null };
}

function main(argv) {
  const valueAfter = (flag, fallback) => {
    const index = argv.indexOf(flag);
    return index >= 0 ? argv[index + 1] : fallback;
  };
  const base = valueAfter('--base', null);
  const head = valueAfter('--head', 'HEAD');
  const taskId = valueAfter('--task-id', null);
  const githubOutput = valueAfter('--github-output', null);
  let changedFiles = [];
  if (base) {
    const range = `${base}..${head}`;
    const raw = execFileSync('git', ['diff', '--name-only', range], { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 }).trim();
    changedFiles = raw ? raw.split('\n').map((line) => line.trim()).filter(Boolean) : [];
  }
  const task = readTaskRisk(taskId);
  const resolved = resolveRiskClass({ changedFiles, explicitRiskClass: task.riskClass });
  if (task.gateProfile === 'full' && resolved.riskClass !== 'R2') {
    resolved.riskClass = 'R2';
    resolved.source = 'task-sheet-gate-profile';
    resolved.rationale.push('任务单 gateProfile=full，强制 R2 门禁');
  }
  const plan = gatePlan(resolved.riskClass);
  const output = { ...plan, ...resolved, changedFiles, taskSheet: task.sheet, gateProfile: task.gateProfile };
  console.log(JSON.stringify(output, null, 2));
  if (githubOutput) {
    const lines = [
      `risk_class=${plan.riskClass}`,
      `run_contracts=${plan.contracts}`,
      `run_security=${plan.security}`,
      `run_unit=${plan.unit}`,
      `run_coverage=${plan.coverage}`,
      `run_e2e=${plan.e2e}`,
      `run_build=${plan.build}`,
    ];
    appendFileSync(githubOutput, `${lines.join('\n')}\n`, 'utf8');
  }
  return output;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2));
}
