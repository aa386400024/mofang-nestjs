/**
 * AF-217 · 跨机单写者锁（远端 git ref 原子创建）。
 *
 * 背景：`run-lock.mjs` 的锁文件落在 `transport/`（被 gitignore），跨机不可见。
 * 两台机器同时跑 run-once 会重复领单、重复验收、互相覆盖状态面。远端锁用
 * git 的 ref 更新语义做分布式 CAS：
 *
 *   - 抢锁 = 推一个带 payload 的 root commit 到 `refs/orchestration/locks/run-once`；
 *     远端 ref 已存在时 push 被拒（非 fast-forward），这就是原子抢占；
 *   - payload（host / pid / token / acquiredAt / baseSha）写在 commit message 里，
 *     任何机器 fetch 该 ref 即可读到「谁、何时、持了多久」；
 *   - 释放 = 先读回 payload 比对 token，一致才删 ref，避免误删他人锁；
 *   - 陈旧 = payload.acquiredAt 超过 staleMs（与本地锁同口径 45 min）视为崩溃残留，
 *     删 ref 后重抢一次，并保留 stolen 事实。
 *
 * 边界：只用 `git` 命令（复用推送凭据），不引入网络客户端、不写本地文件；
 * 抢锁失败/远端不可达如实返回，由调用方决定降级还是拒绝执行，模块本身不静默放行。
 */
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { hostname } from 'node:os';

/**
 * 锁 ref。
 *
 * 刻意放在 `refs/heads/` 下：GitHub 只对 advertized ref（heads/tags）保证常规 fetch 可见，
 * 非 heads 的 ref 在部分环境下 `git fetch <ref>` 会报 "couldn't find remote ref"，跨机读不到
 * 持有者就无法判断陈旧。代价是运行期分支列表会多一个 `orchestration-lock`（CI 只在
 * master/integrate 上触发，不会因此跑流水线）。
 */
export const REMOTE_LOCK_REF = 'refs/heads/orchestration-lock';

/** 读 payload 时把远端锁 ref 映射到的本地缓存 ref（只用于读 message，不参与推送）。 */
const LOCAL_CACHE_REF = 'refs/orchestration-lock/run-once';

/** 与本地锁同口径的陈旧阈值。 */
export const DEFAULT_REMOTE_STALE_MS = 45 * 60 * 1000;

function defaultRunGit(args, opts = {}) {
  try {
    return execFileSync('git', args, {
      cwd: opts.cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  } catch (error) {
    if (opts.allowFailure) return null;
    throw new Error(`git ${args.join(' ')} 失败：${String(error.stderr ?? error.message).trim()}`);
  }
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
 * 远端锁句柄。
 * @param {{rootDir?:string, remote?:string, ref?:string, runGit?:Function, staleMs?:number, now?:Function}} opts
 * @returns {{
 *   ref: string,
 *   read: () => {sha:string|null, holder:object|null, unavailable:boolean},
 *   acquire: (payload?:object) => {acquired:boolean, holder?:object|null, sha?:string, stolen?:object|null, unavailable?:boolean, conflict?:boolean, error?:string, release?:()=>boolean},
 *   release: (token:string) => boolean,
 * }}
 */
export function createGitRemoteLock(opts = {}) {
  const remote = opts.remote ?? 'origin';
  const ref = opts.ref ?? REMOTE_LOCK_REF;
  const cwd = opts.rootDir;
  const staleMs = Number(opts.staleMs ?? DEFAULT_REMOTE_STALE_MS);
  const nowFn = opts.now ?? (() => Date.now());
  const call = (args, extra = {}) => (opts.runGit ?? defaultRunGit)(args, { cwd, ...extra });

  /** 读远端 ref 指向的 sha；远端不可达时 unavailable=true（与「ref 不存在」区分开）。 */
  function readRefSha() {
    const out = call(['ls-remote', remote, ref], { allowFailure: true });
    if (out === null) return { sha: null, unavailable: true };
    const line = out.split('\n').find((item) => item.trim());
    return { sha: line ? line.split('\t')[0].trim() : null, unavailable: false };
  }

  /**
   * 读锁 payload（三路读取，按成本从低到高）：
   *   1. 本地对象直读：本机刚创建 / 刚 fetch 过时对象已在本地，零网络；
   *   2. 显式 refspec 映射到本地缓存 ref，再读其 commit message；
   *   3. 用 ls-remote 得到的 sha 取对象（本地缺对象时才真正走网络）。
   * 现场实测单用 `git fetch origin <ref>` 在部分环境会报 "couldn't find remote ref"，
   * 因此不赌单一读法；三路都失败才按 corrupt 处理，由调用方决定是否强制释放。
   */
  function readHolderBySha(sha) {
    const local = call(['cat-file', '-p', sha], { allowFailure: true });
    if (local !== null) {
      const parts = local.split(/\r?\n\r?\n/);
      const payload = parsePayload(parts.slice(1).join('\n\n'));
      if (!payload.corrupt) return payload;
    }
    const mapped = call(['fetch', '--no-tags', '--quiet', remote, `+${ref}:${LOCAL_CACHE_REF}`], { allowFailure: true });
    if (mapped !== null) {
      const message = call(['log', '-1', '--format=%B', LOCAL_CACHE_REF], { allowFailure: true });
      if (message !== null && message.trim()) {
        const payload = parsePayload(message);
        if (!payload.corrupt) return payload;
      }
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

  function read() {
    const { sha, unavailable } = readRefSha();
    if (unavailable) return { sha: null, holder: null, unavailable: true };
    if (!sha) return { sha: null, holder: null, unavailable: false };
    return { sha, holder: readHolderBySha(sha), unavailable: false };
  }

  function deleteRemoteRef() {
    return call(['push', '--quiet', remote, '--delete', ref], { allowFailure: true }) !== null;
  }

  function release(token) {
    if (!token) return false;
    const { holder, unavailable } = read();
    if (unavailable) return false;
    if (!holder) return true;
    if (holder.token !== token) return false;
    return deleteRemoteRef();
  }

  function acquire(payload = {}) {
    const current = read();
    if (current.unavailable) {
      return { acquired: false, unavailable: true, error: '远端不可达（ls-remote 失败）', release: () => false };
    }
    let stolen = null;
    if (current.holder) {
      const acquiredMs = Date.parse(current.holder.acquiredAt ?? '') || 0;
      const stale = current.holder.corrupt === true || !acquiredMs || nowFn() - acquiredMs > staleMs;
      if (!stale) {
        return { acquired: false, unavailable: false, holder: current.holder, release: () => false };
      }
      stolen = current.holder;
      deleteRemoteRef();
    }

    const body = {
      pid: payload.pid ?? process.pid,
      host: payload.host ?? hostname(),
      token: payload.token ?? randomBytes(8).toString('hex'),
      actor: payload.actor ?? 'run-once',
      acquiredAt: payload.acquiredAt ?? new Date(nowFn()).toISOString(),
      baseSha: payload.baseSha ?? null,
    };
    const tree = call(['rev-parse', 'HEAD^{tree}']);
    const commitSha = call(['commit-tree', tree, '-m', JSON.stringify(body)]);
    const pushed = call(['push', '--quiet', remote, `${commitSha}:${ref}`], { allowFailure: true });
    if (pushed === null) {
      // 抢占竞争：另一台机器先创建了 ref。读回真实持有者，让调用方打印事实。
      return { acquired: false, unavailable: false, holder: read().holder, conflict: true, release: () => false };
    }
    return {
      acquired: true,
      unavailable: false,
      holder: body,
      sha: commitSha,
      stolen,
      release: () => release(body.token),
    };
  }

  return { ref, read, acquire, release };
}

/** 持锁摘要（供 status 打成一行；远端不可达返回 unavailable 而不是抛错）。 */
export function describeRemoteRunLock(opts = {}) {
  const lock = opts.lock ?? createGitRemoteLock(opts);
  const { holder, unavailable } = lock.read();
  if (unavailable) return { unavailable: true };
  if (!holder) return null;
  const acquiredMs = Date.parse(holder.acquiredAt ?? '') || 0;
  const now = (opts.now ?? (() => Date.now()))();
  return {
    ...holder,
    heldMinutes: acquiredMs ? Math.round((now - acquiredMs) / 60000) : null,
    stale: holder.corrupt === true || !acquiredMs || now - acquiredMs > Number(opts.staleMs ?? DEFAULT_REMOTE_STALE_MS),
  };
}
