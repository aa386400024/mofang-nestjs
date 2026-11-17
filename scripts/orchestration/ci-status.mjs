/**
 * IM-018 · 远端 CI 状态门禁（adapter 层；纯判定 + 注入式取数）。
 *
 * 背景：L3 自动合并此前只有本地闸门（lint / typecheck / test）。本地绿不等于远端绿——
 * CI 里还有 E2E、Coverage Gate、Contracts、Security Audit、Build Docker，
 * 这些本地跑不动或不该跑。缺口是「合并前没有人问远端要一句结论」。
 *
 * 口径：
 *   - 取数走 GitHub REST `commits/<sha>/check-runs`（`gh` 不在 PATH，不依赖 gh）；
 *   - token 优先 `GITHUB_TOKEN` / `GH_TOKEN` 环境变量，其次 `git credential fill`（与人工查 CI 同源）；
 *   - 判定纯函数：任一 check 结论为失败/取消/超时 → `fail`；仍有未完成 → `pending`；
 *     全部 success / skipped / neutral → `pass`；一条 check 都没有 → `unknown`（不当作 pass）。
 *   - **`pending` 与 `unknown` 都不放行合并**：没结论的合并请求在语义上等于「先斩后奏」。
 *
 * 边界：本模块不做重试、不轮询、不写状态；调用方决定等多久。
 */
import { execFileSync } from 'node:child_process';

/** 视为「通过」的 check 结论（GitHub conclusion 枚举里的非失败态）。 */
export const PASSING_CONCLUSIONS = ['success', 'skipped', 'neutral'];

/** 视为「失败」的 check 结论。 */
export const FAILING_CONCLUSIONS = ['failure', 'timed_out', 'cancelled', 'action_required', 'startup_failure'];

/**
 * 纯判定（可单测）：把 check-runs 归约成合并门禁结论。
 * @param {Array<{name?:string,status?:string,conclusion?:string|null}>} checkRuns
 * @returns {{verdict:'pass'|'fail'|'pending'|'unknown', total:number, failing:string[], pending:string[]}}
 */
export function ciGateVerdict(checkRuns) {
  const runs = Array.isArray(checkRuns) ? checkRuns : [];
  if (runs.length === 0) return { verdict: 'unknown', total: 0, failing: [], pending: [] };
  const failing = [];
  const pending = [];
  for (const run of runs) {
    const name = run?.name ?? '(unnamed)';
    const conclusion = (run?.conclusion ?? '').toLowerCase();
    const status = (run?.status ?? '').toLowerCase();
    if (status !== 'completed') {
      pending.push(name);
      continue;
    }
    if (FAILING_CONCLUSIONS.includes(conclusion)) failing.push(`${name}（${conclusion}）`);
  }
  if (failing.length > 0) return { verdict: 'fail', total: runs.length, failing, pending };
  if (pending.length > 0) return { verdict: 'pending', total: runs.length, failing, pending };
  return { verdict: 'pass', total: runs.length, failing, pending };
}

/**
 * 解析 GitHub token：环境变量优先，其次 `git credential fill`（仅当 credential helper 已登录）。
 * @param {{env?:object, fillCredential?:(host:string)=>string}} [opts]
 * @returns {string|null}
 */
export function resolveGithubToken(opts = {}) {
  const env = opts.env ?? process.env;
  const fromEnv = env.GITHUB_TOKEN ?? env.GH_TOKEN ?? null;
  if (fromEnv && String(fromEnv).trim() !== '') return String(fromEnv).trim();
  const fill = opts.fillCredential ?? defaultFillCredential;
  try {
    const output = fill('github.com');
    const line = String(output)
      .split(/\r?\n/)
      .find((item) => item.startsWith('password='));
    const token = line ? line.slice('password='.length).trim() : '';
    return token || null;
  } catch {
    return null;
  }
}

function defaultFillCredential(host) {
  return execFileSync('git', ['credential', 'fill'], {
    input: `protocol=https\nhost=${host}\n\n`,
    encoding: 'utf8',
  });
}

/**
 * 取某提交的 check-runs（GitHub REST）。`fetchImpl` 可注入以便单测与离线环境。
 * @param {{repo:string, sha:string, token?:string|null, fetchImpl?:Function, perPage?:number}} opts
 * @returns {Promise<{ok:boolean, status:number, checkRuns:object[], error?:string}>}
 */
export async function fetchCheckRuns(opts = {}) {
  const { repo, sha } = opts;
  if (!repo || !sha) return { ok: false, status: 0, checkRuns: [], error: 'repo / sha 必填' };
  const token = opts.token ?? resolveGithubToken();
  if (!token) return { ok: false, status: 0, checkRuns: [], error: '无 GitHub token（GITHUB_TOKEN / git credential 均不可用）' };
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== 'function') return { ok: false, status: 0, checkRuns: [], error: '运行环境无 fetch' };
  const url = `https://api.github.com/repos/${repo}/commits/${sha}/check-runs?per_page=${Number(opts.perPage ?? 100)}`;
  try {
    const response = await fetchImpl(url, {
      headers: { Authorization: `token ${token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'mofang-orchestration' },
    });
    if (!response.ok) return { ok: false, status: response.status, checkRuns: [], error: `GitHub API ${response.status}` };
    const body = await response.json();
    return { ok: true, status: response.status, checkRuns: Array.isArray(body?.check_runs) ? body.check_runs : [] };
  } catch (err) {
    return { ok: false, status: 0, checkRuns: [], error: `请求失败：${err.message}` };
  }
}

/**
 * 一次性门禁判定：取数 + 归约。
 * @returns {Promise<{verdict:string, total:number, failing:string[], pending:string[], error?:string}>}
 */
export async function evaluateRemoteCiGate(opts = {}) {
  const fetched = await fetchCheckRuns(opts);
  if (!fetched.ok) {
    return { verdict: 'unknown', total: 0, failing: [], pending: [], error: fetched.error };
  }
  return ciGateVerdict(fetched.checkRuns);
}
