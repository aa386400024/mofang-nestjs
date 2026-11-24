/**
 * AF-223 · 跨机取号仲裁（远端占号 ref 原子创建）。
 *
 * 背景：AF-217 的三源占用检查只能「读」——两台机器同时 `task next-id` 仍会算到同一个号，
 * 谁先登记谁赢，输的一方要重做。AF-222 实施时又两次实证：AF-216 被远端分支占用、
 * AF-221 被本机自己推送的同名分支占用（重建场景被自己挡住）。
 *
 * 取号改成两段：
 *   1. 本地三源（远端任务分支 / 远端 integrate 索引 / 本地 records）算出候选号——只读建议；
 *   2. 候选号先在远端创建占号 ref 做 CAS：`refs/heads/orchestration-task-ids/<AF-NNN>`。
 *      创建失败（ref 已存在）即视为被抢，顺延到下一个号重试，直到成功或超过上限。
 *
 * 与远端单写者锁（remote-lock.mjs）同源技术：payload 写进 root commit 的 message，
 * 用 `git push` 的非快进语义做原子抢占；ref 放在 `refs/heads/` 下保证跨机 fetch 可见。
 *
 * 边界：只用 `git` 命令；远端不可达时返回 unavailable，由调用方决定降级（只读建议）还是中止。
 */
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { hostname } from 'node:os';

/** 占号 ref 前缀（`refs/heads/orchestration-task-ids/<AF-NNN>`）。 */
export const RESERVATION_REF_PREFIX = 'refs/heads/orchestration-task-ids';

/** 占号 ref 的完整名称。 */
export function reservationRef(taskId) {
  if (!taskId) throw new Error('占号需要 taskId');
  return `${RESERVATION_REF_PREFIX}/${taskId}`;
}

function defaultRunGit(args, opts = {}) {
  const hasInput = opts.input !== undefined;
  try {
    return execFileSync('git', args, {
      cwd: opts.cwd,
      encoding: 'utf8',
      // 占号 commit 也改成空 tree；`mktree` 从 stdin 读，空输入时要用 pipe。
      stdio: [hasInput ? 'pipe' : 'ignore', 'pipe', 'pipe'],
      ...(hasInput ? { input: opts.input } : {}),
    }).trim();
  } catch (error) {
    if (opts.allowFailure) return null;
    throw new Error(`git ${args.join(' ')} 失败：${String(error.stderr ?? error.message).trim()}`);
  }
}

/**
 * 从 `git ls-remote --heads origin 'orchestration-task-ids/*'` 输出解析已占号编号。
 * 只认 `<PREFIX>-<NNN>` 形态，避免把前缀里的单词误算成编号。
 */
export function remoteReservationIds(lsRemoteOutput) {
  const ids = [];
  for (const line of String(lsRemoteOutput ?? '').split(/\r?\n/)) {
    const ref = line.split('\t')[1]?.trim();
    if (!ref || !ref.startsWith(`${RESERVATION_REF_PREFIX}/`)) continue;
    const tail = ref.slice(RESERVATION_REF_PREFIX.length + 1);
    if (/^[A-Z0-9]+-[0-9]+$/.test(tail)) ids.push(tail);
  }
  return [...new Set(ids)];
}

function parsePayload(message) {
  const text = String(message ?? '')
    .replace(/^\uFEFF/, '')
    .trim();
  try {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object') return { corrupt: true };
    return parsed;
  } catch {
    return { corrupt: true };
  }
}

/**
 * 远端占号句柄。
 * @param {{rootDir?:string, remote?:string, runGit?:Function, now?:Function, actor?:string}} opts
 * @returns {{
 *   list: () => {ids:string[], unavailable:boolean},
 *   read: (taskId:string) => {held:boolean, payload:object|null, unavailable:boolean},
 *   reserve: (taskId:string, payload?:object) => {reserved:boolean, ref?:string, holder?:object|null, unavailable?:boolean, conflict?:boolean, error?:string},
 *   release: (taskId:string) => boolean,
 * }}
 */
export function createGitTaskIdReservation(opts = {}) {
  const remote = opts.remote ?? 'origin';
  const cwd = opts.rootDir;
  const nowFn = opts.now ?? (() => Date.now());
  const call = (args, extra = {}) => (opts.runGit ?? defaultRunGit)(args, { cwd, ...extra });

  function lsRemoteRef(ref) {
    return call(['ls-remote', remote, ref], { allowFailure: true });
  }

  function list() {
    const out = call(['ls-remote', '--heads', remote, 'orchestration-task-ids/*'], { allowFailure: true });
    if (out === null) return { ids: [], unavailable: true };
    return { ids: remoteReservationIds(out), unavailable: false };
  }

  function refSha(taskId) {
    const out = lsRemoteRef(reservationRef(taskId));
    if (out === null) return { sha: null, unavailable: true };
    const line = out.split('\n').find((item) => item.trim());
    return { sha: line ? line.split('\t')[0].trim() : null, unavailable: false };
  }

  function readPayload(sha) {
    const local = call(['cat-file', '-p', sha], { allowFailure: true });
    if (local !== null) {
      const parts = local.split(/\r?\n\r?\n/);
      const payload = parsePayload(parts.slice(1).join('\n\n'));
      if (!payload.corrupt) return payload;
    }
    const bySha = call(['fetch', '--no-tags', '--quiet', remote, sha], { allowFailure: true });
    if (bySha !== null) {
      const body = call(['cat-file', '-p', sha], { allowFailure: true });
      if (body !== null) {
        const parts = body.split(/\r?\n\r?\n/);
        return parsePayload(parts.slice(1).join('\n\n'));
      }
    }
    return { corrupt: true };
  }

  function read(taskId) {
    const { sha, unavailable } = refSha(taskId);
    if (unavailable) return { held: false, payload: null, unavailable: true };
    if (!sha) return { held: false, payload: null, unavailable: false };
    return { held: true, payload: readPayload(sha), unavailable: false };
  }

  function reserve(taskId, payload = {}) {
    const current = refSha(taskId);
    if (current.unavailable) {
      return { reserved: false, unavailable: true, error: '远端不可达（ls-remote 失败）' };
    }
    if (current.sha) {
      return { reserved: false, unavailable: false, conflict: true, holder: read(taskId).payload };
    }
    const body = {
      taskId,
      pid: payload.pid ?? process.pid,
      host: payload.host ?? hostname(),
      actor: payload.actor ?? opts.actor ?? 'orchestrator-cli',
      token: payload.token ?? randomBytes(8).toString('hex'),
      reservedAt: payload.reservedAt ?? new Date(nowFn()).toISOString(),
      baseSha: payload.baseSha ?? null,
    };
    // 与远端锁同源修复：payload 在 message 里，tree 用空树，避免 push 带上 HEAD 整棵树。
    const tree = call(['mktree'], { input: '' });
    const commitSha = call(['commit-tree', tree, '-m', JSON.stringify(body)]);
    const pushed = call(['push', '--quiet', remote, `${commitSha}:${reservationRef(taskId)}`], { allowFailure: true });
    if (pushed === null) {
      // 竞争落败：另一台机器在同一毫秒创建了同一个占号 ref。
      return { reserved: false, unavailable: false, conflict: true, holder: read(taskId).payload };
    }
    return { reserved: true, ref: reservationRef(taskId), holder: body };
  }

  function release(taskId) {
    const { held, payload, unavailable } = read(taskId);
    if (unavailable) return false;
    if (!held) return true;
    // 只释放形状合法的占号 payload，避免把误写进该前缀的其它 ref 删掉。
    if (payload?.corrupt !== true && payload?.taskId && payload.taskId !== taskId) return false;
    return call(['push', '--quiet', remote, '--delete', reservationRef(taskId)], { allowFailure: true }) !== null;
  }

  return { list, read, reserve, release };
}

/**
 * 取号主循环：候选号 → 远端 CAS 占号 → 失败顺延。
 * @param {{occupiedIds:Iterable<string>, reserve:(taskId:string)=>{reserved:boolean, conflict?:boolean, unavailable?:boolean, holder?:object|null}, prefix?:string, maxAttempts?:number, nextIdFn:Function}} opts
 * @returns {{taskId:string|null, attempts:object[], unavailable:boolean}}
 */
export function pickReservedTaskId(opts = {}) {
  const prefix = opts.prefix ?? 'AF';
  const maxAttempts = Number(opts.maxAttempts ?? 20);
  const occupied = new Set([...(opts.occupiedIds ?? [])]);
  const attempts = [];
  for (let index = 0; index < maxAttempts; index += 1) {
    const candidate = opts.nextIdFn(occupied, prefix);
    const result = opts.reserve(candidate);
    attempts.push({ taskId: candidate, ...result });
    if (result?.reserved) return { taskId: candidate, attempts, unavailable: false };
    if (result?.unavailable) return { taskId: null, attempts, unavailable: true };
    occupied.add(candidate);
  }
  return { taskId: null, attempts, unavailable: false };
}
