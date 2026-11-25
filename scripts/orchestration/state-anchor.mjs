/**
 * AF-498 · 编排状态锚点。
 *
 * 问题：状态索引 / 事件日志放在 git 工作树里，`git switch -f` 到另一分支会把
 * active 任务、归档任务整体回落到旧基线，导致重复登记、重复换号、重复重建分支。
 *
 * 口径：状态面是「本机单写者状态」，不是仓库内容。默认把索引、事件日志、运行态、
 * 归档说明锚定到仓库外的持久目录；仓库内文件只作为镜像/种子。CLI 每次启动先把
 * 锚点恢复回工作树，命令结束后把工作树镜像回锚点。
 *
 * 关闭：`ORCH_STATE_ANCHOR=off`、`ORCH_STATE_FREE=1`；CI（`CI=1`/`GITHUB_ACTIONS=1`）
 * 默认关闭。显式 `ORCH_STATE_ANCHOR=on` 优先于 CI 自动关闭，供锚点回归测试在
 * CI 环境变量下验证；普通 CI 不显式开启时不碰本机锚点。
 */
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, unlinkSync } from 'node:fs';
import { homedir, hostname } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
export const ANCHOR_REPO_ROOT = resolve(__dirname, '..', '..');

/** 需要锚定的状态文件（相对仓根）。 */
export const ANCHORED_FILES = [
  'docs/team/agent-orchestration/task-state-index.json',
  'docs/team/agent-orchestration/state/journal.jsonl',
  'docs/team/agent-orchestration/state/archived-notes.json',
  'docs/team/agent-orchestration/orchestration-state.json',
  'docs/team/agent-orchestration/orchestration-snapshot.json',
];

function envFlag(name) {
  return String(process.env[name] ?? '')
    .trim()
    .toLowerCase();
}

export function stateAnchorEnabled() {
  const flag = envFlag('ORCH_STATE_ANCHOR');
  // `on` 是显式强制开启：CI 默认不碰本机状态，但锚点自身的回归测试必须能在
  // CI 环境变量下验证播种/恢复，否则该路径只在开发者机器上被覆盖。
  if (['1', 'on', 'true', 'yes', 'force'].includes(flag)) return true;
  if (['0', 'off', 'false', 'no'].includes(flag)) return false;
  if (envFlag('CI') === 'true' || envFlag('GITHUB_ACTIONS') === 'true') return false;
  if (envFlag('ORCH_STATE_FREE') === '1') return false;
  return true;
}

/** 仓库级锚点目录；可用 `ORCH_STATE_HOME` 覆盖（测试/多仓共用）。 */
export function stateAnchorDir(repoRoot = ANCHOR_REPO_ROOT) {
  const override = String(process.env.ORCH_STATE_HOME ?? '').trim();
  if (override) return resolve(override);
  const base = String(process.env.LOCALAPPDATA ?? '').trim() || join(homedir(), '.local', 'share');
  const key = `${repoRoot}|${hostname()}`.replace(/\\/g, '/').toLowerCase();
  const hash = createHash('sha1').update(key).digest('hex').slice(0, 12);
  return join(base, 'mofang-orchestration', `${hash}`);
}

function copyAtomic(source, target) {
  if (!existsSync(source)) return false;
  mkdirSync(dirname(target), { recursive: true });
  const tmp = `${target}.anchor-tmp`;
  copyFileSync(source, tmp);
  if (existsSync(target)) unlinkSync(target);
  renameSync(tmp, target);
  return true;
}

function lineCount(file) {
  if (!existsSync(file)) return 0;
  const text = readFileSync(file, 'utf8');
  return text.split(/\r?\n/).filter(Boolean).length;
}

/**
 * 启动时恢复锚点：工作树里的状态被分支切换回退时，用锚点覆盖。
 * @returns {{enabled:boolean, dir:string|null, seeded:boolean, restored:boolean}}
 */
export function ensureStateAnchor({ repoRoot = ANCHOR_REPO_ROOT } = {}) {
  if (!stateAnchorEnabled()) return { enabled: false, dir: null, seeded: false, restored: false };
  const dir = stateAnchorDir(repoRoot);
  const canonicalIndex = join(dir, ANCHORED_FILES[0]);
  let seeded = false;
  let restored = false;
  if (!existsSync(canonicalIndex)) {
    for (const rel of ANCHORED_FILES) {
      const source = join(repoRoot, rel);
      if (existsSync(source)) {
        copyAtomic(source, join(dir, rel));
        seeded = true;
      }
    }
  } else {
    // 锚点是权威状态：只要它存在，分支里的旧索引/旧日志就不允许重新变成事实。
    for (const rel of ANCHORED_FILES) {
      const source = join(dir, rel);
      if (existsSync(source)) {
        copyAtomic(source, join(repoRoot, rel));
        restored = true;
      }
    }
  }
  return { enabled: true, dir, seeded, restored };
}

/** 把单个状态文件镜像回锚点；供 saveIndex / appendEvents / saveRuntimeState 调用。 */
export function mirrorStateFile(file, { repoRoot = ANCHOR_REPO_ROOT } = {}) {
  if (!stateAnchorEnabled()) return false;
  const abs = resolve(file);
  const rel = relative(repoRoot, abs).replace(/\\/g, '/');
  if (!ANCHORED_FILES.includes(rel) || !existsSync(abs)) return false;
  return copyAtomic(abs, join(stateAnchorDir(repoRoot), rel));
}

/** 命令结束时整体同步一次，覆盖多文件写入。 */
export function syncStateAnchor({ repoRoot = ANCHOR_REPO_ROOT } = {}) {
  if (!stateAnchorEnabled()) return { enabled: false, synced: 0 };
  let synced = 0;
  for (const rel of ANCHORED_FILES) {
    const source = join(repoRoot, rel);
    if (existsSync(source) && mirrorStateFile(source, { repoRoot })) synced += 1;
  }
  return { enabled: true, synced };
}

/** 诊断信息，供 smoke / status 使用。 */
export function describeStateAnchor({ repoRoot = ANCHOR_REPO_ROOT } = {}) {
  const dir = stateAnchorDir(repoRoot);
  return {
    enabled: stateAnchorEnabled(),
    dir,
    indexExists: existsSync(join(dir, ANCHORED_FILES[0])),
    journalLines: lineCount(join(dir, ANCHORED_FILES[1])),
    repoIndexExists: existsSync(join(repoRoot, ANCHORED_FILES[0])),
  };
}
