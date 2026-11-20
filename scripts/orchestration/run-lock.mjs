/**
 * 单写者锁（run-once / watch 互斥）。
 *
 * 背景：文件 transport 没有并发仲裁，两台机器或两个进程同时跑 run-once 会重复领单、
 * 重复验收、互相覆盖状态面。本模块用「transport 目录下的独占锁文件」做单写者：
 *   - 创建用 `wx`（O_EXCL），已存在即抢锁失败，不存在竞争窗口；
 *   - 持锁信息含 pid / host / token / acquiredAt，便于定位是谁持锁；
 *   - 超过 staleMs 未释放视为陈旧锁（进程崩溃），抢锁方带 token 覆盖，并留 `stolen` 事实；
 *   - 释放只删自己那把（token 比对），不会误删他人锁。
 *
 * 边界：只管并发互斥，不负责崩溃后状态修复（租约回收由 scheduler.releaseExpiredLeases 负责）。
 */
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, unlinkSync, writeSync } from 'node:fs';
import { hostname } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { PATHS } from './state-store.mjs';

/** 默认陈旧阈值：比默认任务租约（30 min）略宽，避免正常长跑被判陈旧。 */
export const DEFAULT_STALE_MS = 45 * 60 * 1000;

/** 锁文件路径（放在 transport 收件箱旁边，随 transport 一起被 gitignore）。 */
export function runLockPath(dir = PATHS.transportDir) {
  return join(dir, '.run-once.lock');
}

/** 读取当前锁事实；文件不存在或不可解析返回 null（不可解析按「空锁」处理）。 */
export function readRunLock(dir = PATHS.transportDir) {
  const file = runLockPath(dir);
  if (!existsSync(file)) return null;
  try {
    // PowerShell 写出的 UTF-8 文件可能带 BOM，JSON.parse 会直接失败；读取时先剥掉。
    const raw = JSON.parse(readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
    return {
      pid: raw.pid ?? null,
      host: raw.host ?? null,
      token: raw.token ?? null,
      actor: raw.actor ?? null,
      acquiredAt: raw.acquiredAt ?? null,
    };
  } catch {
    return { pid: null, host: null, token: null, actor: null, acquiredAt: null, corrupt: true };
  }
}

function writeLock(file, payload) {
  const fd = openSync(file, 'wx');
  try {
    writeSync(fd, JSON.stringify(payload));
  } finally {
    closeSync(fd);
  }
}

/**
 * 抢锁。
 * @param {{dir?:string, staleMs?:number, actor?:string, now?:number}} opts
 * @returns {{acquired:boolean, path:string, holder?:object, stolen?:object, release:()=>void}}
 */
export function acquireRunLock(opts = {}) {
  const dir = opts.dir ?? PATHS.transportDir;
  const staleMs = opts.staleMs ?? DEFAULT_STALE_MS;
  const now = opts.now ?? Date.now();
  const actor = opts.actor ?? 'run-once';
  const token = opts.token ?? randomBytes(8).toString('hex');
  const file = runLockPath(dir);
  mkdirSync(dir, { recursive: true });

  const payload = {
    pid: process.pid,
    host: hostname(),
    token,
    actor,
    acquiredAt: new Date(now).toISOString(),
  };

  let stolen = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      writeLock(file, payload);
      return {
        acquired: true,
        path: file,
        stolen,
        token,
        release: () => {
          const held = readRunLock(dir);
          if (held && held.token === payload.token) unlinkSync(file);
        },
      };
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
      const holder = readRunLock(dir);
      const acquiredMs = Date.parse(holder?.acquiredAt ?? '') || 0;
      const stale = holder?.corrupt === true || !acquiredMs || now - acquiredMs > staleMs;
      if (!stale) return { acquired: false, path: file, holder, release: () => {} };
      // 陈旧锁：覆盖前留事实（stolen），随后重试一次独占创建。
      stolen = holder;
      try {
        unlinkSync(file);
      } catch {
        /* 竞争方已清掉：继续重试 */
      }
    }
  }
  return { acquired: false, path: file, holder: readRunLock(dir), release: () => {} };
}

/** 持锁摘要（供 status 输出一行，不参与状态迁移）。 */
export function describeRunLock(dir = PATHS.transportDir, now = Date.now(), staleMs = DEFAULT_STALE_MS) {
  const holder = readRunLock(dir);
  if (!holder) return null;
  const acquiredMs = Date.parse(holder.acquiredAt ?? '') || 0;
  return {
    ...holder,
    heldMinutes: acquiredMs ? Math.round((now - acquiredMs) / 60000) : null,
    stale: holder.corrupt === true || !acquiredMs || now - acquiredMs > staleMs,
  };
}

/**
 * AF-213 · 本机 + 跨机双层单写者。
 *
 * 顺序固定为「先本机、后远端」：
 *   1. 本机抢不到 → 直接返回（同机并发不打扰远端，也不产生无意义的 push）；
 *   2. 远端锁注入缺失（未配置 / 离线调试）→ 只回本机结果，并标记 degraded；
 *   3. 远端抢不到（另一台机器持锁）→ 立刻释放本机锁，返回持有者事实；
 *   4. 远端不可达（网络 / 无推送凭据）→ `mode='required'` 时拒绝执行，否则降级为仅本机
 *      互斥并标记 degraded —— 降级必须被调用方打印，不允许静默放行。
 *
 * @param {{dir?:string, staleMs?:number, actor?:string, token?:string, remote?:object|null, mode?:'optional'|'required', now?:number}} opts
 * @returns {object} 与 acquireRunLock 同形，额外带 `remote` 段描述远端结果
 */
export function acquireClusterRunLock(opts = {}) {
  const token = opts.token ?? randomBytes(8).toString('hex');
  const local = acquireRunLock({ ...opts, token });
  if (!local.acquired) {
    return { ...local, token, remote: { skipped: 'local-lock-busy' } };
  }

  const remote = opts.remote ?? null;
  if (!remote) {
    return { ...local, token, remote: { degraded: true, reason: 'remote-lock-not-configured' } };
  }

  const result = remote.acquire({ pid: process.pid, host: hostname(), token, actor: opts.actor ?? 'run-once' });
  if (result.unavailable) {
    if ((opts.mode ?? 'optional') === 'required') {
      local.release();
      return {
        acquired: false,
        token,
        holder: null,
        remote: { unavailable: true, required: true, error: result.error ?? '远端不可达' },
        release: () => {},
      };
    }
    return {
      ...local,
      token,
      remote: { degraded: true, unavailable: true, error: result.error ?? '远端不可达' },
    };
  }
  if (!result.acquired) {
    local.release();
    return {
      acquired: false,
      token,
      holder: result.holder ?? null,
      path: local.path,
      remote: { acquired: false, conflict: result.conflict === true, holder: result.holder ?? null },
      release: () => {},
    };
  }
  return {
    ...local,
    token,
    remote: { acquired: true, sha: result.sha, stolen: result.stolen ?? null },
    release: () => {
      const released = result.release();
      local.release();
      return released;
    },
  };
}
