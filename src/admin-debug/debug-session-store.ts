// V2026-11-05 治本 (Admin Dashboard 调试会话持久化 · 文件存储):
//   职责: 把调试会话存成 **JSON 文件** (`data/debug-sessions/{sessionId}.json`) ——
//         建档 / 追加一轮 / 改标题 / 标完成 / 列会话 / 读详情 / 删除,
//         并维持"只保留最近 N 个会话"的上限.
//   边界: 只做文件 I/O + 记录形状; **不含**业务编排 (那是 `DebugSessionService` 的事).
//
//   为什么存**文件**而不是数据库 (任务单 D1):
//     · 调试数据, 不该污染学员的正式场次表 (WP58 的原始纪律: 调试会话不落库);
//     · 量不大 (上限 50 个), JSON 文件足够;
//     · 落库要建表 + migration, 对一个调试面板太重了.
//     ⚠️ **对 WP58 纪律的扩展** (登记在交付记录 §偏差 B1):
//       WP58 说"调试会话不落库", 本单把它扩展成"落**文件**" ——
//       仍然**不写** `training_sessions` / `turn_debug_trace`, 但不再"刷新即丢".
//
//   为什么**每轮都写**而不是"关会话时一次性写":
//     中途崩溃 / 进程重启也不丢数据 —— 刷新页面就能看到跑了一半的会话.
//     代价是每轮一次小文件写 (调试场景, 无所谓).
//
//   写文件为什么**先写临时文件再 rename**:
//     `writeFile` 直接覆盖时, 进程在写一半被杀 → 文件是**半截 JSON** → 下次读就炸.
//     rename 在同一文件系统内是**原子**的: 要么是旧文件, 要么是完整的新文件.
//     (临时文件与目标文件必须在同一目录 → 同一文件系统, rename 才原子.)
//
//   ⚠️ **这些文件含心理内容** (对话原文 + prompt 全文):
//     · 目录已在 `.gitignore` 里 (`data/debug-sessions/`) —— 绝不进版本库;
//     · 日志只出定位信息 (会话 id / 轮次), **不打**对话正文.
//
//   反双胞胎:
//     - 不落库: 见上面的 D1;
//     - 不自己算轮次: 轮次由调用方 (服务层) 传进来, 存储层不猜;
//     - 不写"半截文件": 临时文件 + rename.
//
//   验证: npx vitest run test/admin-debug/debug-session-persistence.spec.ts
//   时间戳: 2026-11-05 GMT+8

import { Injectable, Logger, Optional, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource } from '@nestjs/typeorm';
import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
// node:fs / node:path 没 default export, unicorn/import-style 误报 — 忽略.
// eslint-disable-next-line unicorn/import-style
import { isAbsolute, join, resolve } from 'node:path';
import type { DataSource } from 'typeorm';

import type { DebugKernelState } from './debug-kernel-state.js';
import { DebugSessionMirror } from './debug-session-mirror.js';
import { parseDebugSessionRecord } from './debug-session-record.js';
import type { DebugSessionMessage, DebugSessionRecord, DebugSessionSummary, DebugSessionTitleSource } from './debug-session-record.js';

export type {
  DebugSessionMessage,
  DebugSessionRecord,
  DebugSessionStatus,
  DebugSessionSummary,
  DebugSessionTitleSource,
} from './debug-session-record.js';

/**
 * Windows 上可安全重试的 rename 失败码.
 *
 * EPERM / EACCES: 目标文件句柄被短暂占用 (杀毒扫描 / 另一个读句柄尚未释放);
 * EBUSY: 目录或文件被占用; ENOTEMPTY: 目标目录在替换瞬间非空.
 * 这些错误过几毫秒通常就消失, 直接抛会让 fire-and-forget 的 markCompleted 永久丢状态.
 */
export const RENAME_RETRY_CODES = ['EPERM', 'EACCES', 'EBUSY', 'ENOTEMPTY'] as const;

/**
 * renameWithRetry 的可注入依赖 (单测用桩替换, 不碰真实文件系统).
 */
export interface RenameWithRetryOptions {
  attempts?: number;
  baseDelayMs?: number;
  renameFn?: (from: string, to: string) => Promise<void>;
  sleepFn?: (ms: number) => Promise<void>;
}

/**
 * 判断 rename 错误是否为 Windows 瞬时占用 (值得重试).
 *
 * @param error 捕获到的错误
 * @returns 命中可重试错误码 → true
 */
export function isRetryableRenameError(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | null)?.code;
  return typeof code === 'string' && (RENAME_RETRY_CODES as readonly string[]).includes(code);
}

/**
 * 原子 rename, 遇 Windows 瞬时占用时有限指数退避重试.
 *
 * 非瞬时错误 (ENOENT / EXDEV 等) 立即抛出, 不做无意义重试;
 * 重试耗尽后抛最后一次错误, 由调用方决定降级.
 *
 * @param temp 临时文件路径
 * @param target 目标文件路径
 * @param options 重试次数 / 基础退避 / 注入依赖
 * @returns rename 成功 → void
 */
export async function renameWithRetry(temp: string, target: string, options: RenameWithRetryOptions = {}): Promise<void> {
  const attempts = Math.max(1, Math.trunc(options.attempts ?? 3));
  const baseDelayMs = Math.max(0, options.baseDelayMs ?? 10);
  const renameFn = options.renameFn ?? rename;
  const sleepFn = options.sleepFn ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      await renameFn(temp, target);
      return;
    } catch (error) {
      const isLast = attempt === attempts - 1;
      if (isLast || !isRetryableRenameError(error)) throw error;
      await sleepFn(baseDelayMs * 2 ** attempt);
    }
  }
}

/**
 * 保留的会话上限.
 *
 * 为什么是 500 (原 50, commit 1cd56ee 上调): 调试面板的会话列表是"最近跑过的那几场",
 *   50 场够日常回溯 —— 但**批量实验**期间单批就 300+ 场, 50 会在跑一半时把最老的
 *   逐字稿顶掉, **直接吃掉对比基线** (上一批的样本没了, 跨批对比就无从谈起).
 *   500 是"批量实验够用"与"垃圾堆积"之间的折中.
 *
 * ⚠️ 500 对单批仍然紧张: 后续批次应按 `ADMIN_DEBUG_SESSION_DIR` 分目录隔离,
 *   不要依赖这个上限 (见 docs/worklog/pending/phase2.5-data-pipeline-audit-2026-11-09.md).
 *
 * ⚠️ 本上限**与 prune 的淘汰口径**是一对: prune 按**创建时间**保留最新的 MAX 个.
 */
export const MAX_DEBUG_SESSIONS = 500;

/**
 * 存储目录的 env 键 (可覆盖, 便于测试与部署时挂到独立卷).
 */
export const DEBUG_SESSION_DIR_ENV = 'ADMIN_DEBUG_SESSION_DIR';

/**
 * 存储目录的默认位置 (相对进程工作目录).
 */
export const DEFAULT_DEBUG_SESSION_DIR = 'data/debug-sessions';

/**
 * 远端持久化开关的 env 键.
 *
 * `on` (缺省): MySQL 为系统记录, 本地文件为写穿缓存;
 * `off`: 逐字回到纯文件模式 (回滚开关).
 */
export const DEBUG_SESSION_REMOTE_ENV = 'ADMIN_DEBUG_SESSION_REMOTE';

/** 远端已知 id 缓存刷新周期 (标注台 sync exists 判定用). */
export const DEBUG_SESSION_KNOWN_IDS_REFRESH_MS = 60_000;

/**
 * 保留会话上限的 env 键.
 *
 * 文件模式缺省 500 (与原行为一致); DB 模式建议部署时放大到 2000+, 避免导入历史时
 * 首次 create 就把老基线淘汰.
 */
export const DEBUG_SESSION_MAX_ENV = 'ADMIN_DEBUG_SESSION_MAX';

/** 缺省保留上限 (与历史 MAX_DEBUG_SESSIONS 一致). */
export const DEFAULT_DEBUG_SESSION_MAX = MAX_DEBUG_SESSIONS;

/**
 * 会话 id 的合法形状.
 *
 * 为什么**要校验**: 会话 id 会被拼成文件路径. 不校验的话, 一个 `../../etc/passwd`
 * 形状的 id 就能把文件写到目录外面去. 白名单式校验 (只允许字母数字下划线连字符)
 * 从根上堵死这条.
 */
const SESSION_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

/**
 * 调试会话文件存储.
 */
@Injectable()
export class DebugSessionStore implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DebugSessionStore.name);
  /** 本地缓存目录. */
  private readonly dir: string;
  /** 保留上限 (文件与远端共用一个口径). */
  private readonly maxSessions: number;
  /** 远端系统记录层; null = 纯文件模式. */
  private readonly mirror: DebugSessionMirror | null;
  /** 远端已知 id (让标注台同步 exists 判定不必读大 JSON). */
  private readonly knownRemoteIds = new Set<string>();
  /** knownRemoteIds 周期刷新定时器. */
  private knownIdsTimer: ReturnType<typeof setInterval> | null = null;
  /**
   * 每个会话的写串行队列 (会话 id → 队列尾 promise).
   *
   * 为什么需要: 追加一轮是"读文件 → 改 → 写回". 两个并发轮次同时进来会**互相覆盖**
   * (后写的基于旧的快照 → 丢掉先写的那轮). 用一条 per-session 的 promise 链把写操作
   * 串起来, 就不会有"读到旧快照"的机会.
   */
  private readonly writeQueues = new Map<string, Promise<unknown>>();

  constructor(config: ConfigService, @Optional() @InjectDataSource() dataSource?: DataSource) {
    this.dir = resolveStoreDir(config);
    this.maxSessions = resolveMaxSessions(config);
    const remoteEnabled = resolveRemoteEnabled(config);
    this.mirror = remoteEnabled && dataSource !== undefined ? new DebugSessionMirror(dataSource) : null;
  }

  /**
   * 启动时登记远端 id 集; 远端开启但表缺失 → 启动即失败 (fail-closed).
   */
  async onModuleInit(): Promise<void> {
    if (this.mirror === null) return;
    await this.refreshKnownIds(true);
    this.knownIdsTimer = setInterval(() => {
      void this.refreshKnownIds(false);
    }, DEBUG_SESSION_KNOWN_IDS_REFRESH_MS);
    this.knownIdsTimer.unref();
  }

  /** 停机清理刷新定时器. */
  onModuleDestroy(): void {
    if (this.knownIdsTimer !== null) {
      clearInterval(this.knownIdsTimer);
      this.knownIdsTimer = null;
    }
  }

  /**
   * 存储目录 (只读, 供运维查看).
   *
   * @returns 目录绝对路径
   */
  directory(): string {
    return this.dir;
  }

  /**
   * 会话是否存在 (本机文件或远端已知 id).
   *
   * 标注台用它替代 `existsSync(path.join(store.directory(), ...))` ——
   * 远端有记录、本机还没回填缓存时也不能误判 missing.
   *
   * @param id 会话 id
   * @returns 存在 → true
   */
  exists(id: string): boolean {
    if (!SESSION_ID_PATTERN.test(id)) return false;
    if (existsSync(this.filePath(id))) return true;
    return this.knownRemoteIds.has(id);
  }

  /**
   * 建档 (写远端系统记录 + 本地缓存).
   *
   * @param record 会话初始记录
   * @returns 落盘/落库的记录
   */
  async create(record: DebugSessionRecord): Promise<DebugSessionRecord> {
    return this.enqueue(record.id, async () => {
      if (this.mirror !== null) await this.mirror.upsert(record, { maxSessions: this.maxSessions });
      await this.writeRecord(record);
      this.knownRemoteIds.add(record.id);
      await this.prune();
      return record;
    });
  }

  /**
   * 追加一轮 (消息 + trace), 并更新 `updatedAt` / `turnCount`.
   *
   * @param id 会话 id
   * @param message 本轮的咨询师发言
   * @param reply 本轮的来访者回应
   * @param trace 本轮的调试 trace
   * @returns 更新后的记录; 会话文件不存在 → null
   */
  async appendTurn(
    id: string,
    message: DebugSessionMessage,
    reply: DebugSessionMessage,
    trace: unknown,
    kernelState: DebugKernelState | null = null,
  ): Promise<DebugSessionRecord | null> {
    return this.enqueue(id, async () => {
      const current = await this.readCurrent(id);
      if (!current) return null;
      const updated: DebugSessionRecord = {
        ...current,
        updatedAt: new Date().toISOString(),
        turnCount: current.turnCount + 1,
        messages: [...current.messages, message, reply],
        traces: [...current.traces, trace],
        // 内核快照: 每轮**覆盖**一次 (它是"当前状态", 不是历史流水).
        // 缺省 (调用方没给) → 保留上一轮那份 —— 老调用方不会把快照写没.
        kernelState: kernelState ?? current.kernelState,
      };
      if (this.mirror !== null) await this.mirror.upsert(updated);
      await this.writeRecord(updated);
      this.knownRemoteIds.add(id);
      return updated;
    });
  }

  /**
   * 改标题.
   *
   * 覆盖规则 (唯一的口径, 在这里定一次):
   *   · `manual` → **总是**生效 (用户改的就是最终的);
   *   · `llm`    → 只在当前来源是 `fallback` 时生效 ——
   *     自动命名不能盖掉用户手动改过的标题 (那是"用户说了什么就是什么").
   *
   * @param id 会话 id
   * @param title 新标题
   * @param source 标题来源
   * @returns 更新后的记录; 会话不存在 → null; 被覆盖规则拒绝 → 原记录
   */
  async updateTitle(id: string, title: string, source: Exclude<DebugSessionTitleSource, 'fallback'>): Promise<DebugSessionRecord | null> {
    return this.enqueue(id, async () => {
      const current = await this.readCurrent(id);
      if (!current) return null;
      if (source === 'llm' && current.titleSource === 'manual') return current;
      const updated: DebugSessionRecord = {
        ...current,
        title,
        titleSource: source,
        updatedAt: new Date().toISOString(),
      };
      if (this.mirror !== null) await this.mirror.upsert(updated);
      await this.writeRecord(updated);
      this.knownRemoteIds.add(id);
      return updated;
    });
  }

  /**
   * 标记会话已完成 (关闭时调).
   *
   * @param id 会话 id
   * @returns 更新后的记录; 会话不存在 → null
   */
  async markCompleted(id: string): Promise<DebugSessionRecord | null> {
    return this.enqueue(id, async () => {
      const current = await this.readCurrent(id);
      if (!current) return null;
      const updated: DebugSessionRecord = { ...current, status: 'completed', updatedAt: new Date().toISOString() };
      if (this.mirror !== null) await this.mirror.upsert(updated);
      await this.writeRecord(updated);
      this.knownRemoteIds.add(id);
      return updated;
    });
  }

  /**
   * 标记会话为进行中 (恢复后调: 关过的会话恢复回来就是活的).
   *
   * @param id 会话 id
   * @returns 更新后的记录; 会话不存在 → null
   */
  async markActive(id: string): Promise<DebugSessionRecord | null> {
    return this.enqueue(id, async () => {
      const current = await this.readCurrent(id);
      if (!current) return null;
      const updated: DebugSessionRecord = { ...current, status: 'active', updatedAt: new Date().toISOString() };
      if (this.mirror !== null) await this.mirror.upsert(updated);
      await this.writeRecord(updated);
      this.knownRemoteIds.add(id);
      return updated;
    });
  }

  /**
   * 列出会话 (按创建时间倒序).
   *
   * ⚠️ **坏文件跳过, 不炸整页**: 某个文件被手工改坏 / 写到一半被强杀 → 跳过它,
   *   其余照常返回. 列表页不该因为一个坏文件就 500.
   *
   * @returns 会话摘要 (按创建时间倒序)
   */
  async list(): Promise<DebugSessionSummary[]> {
    const local = await this.listLocal();
    if (this.mirror === null) return local;
    await this.refreshKnownIds(false);
    const remote = await this.mirror.list();
    return mergeSummaries(remote, local);
  }

  /**
   * 读一个会话的完整记录.
   *
   * 远端开启时 MySQL 优先; 读到后回填本地缓存 (标注/冻结读路径仍可用).
   * 远端没有该 id → 回落本地 (未被导入的历史文件).
   *
   * @param id 会话 id
   * @returns 记录; 不存在 / 读失败 → null
   */
  async get(id: string): Promise<DebugSessionRecord | null> {
    if (this.mirror !== null) {
      const remote = await this.mirror.get(id);
      if (remote !== null) {
        this.knownRemoteIds.add(id);
        await this.writeRecord(remote);
        return remote;
      }
    }
    return this.readRecord(id);
  }

  /**
   * 删除一个会话 (远端 + 本地).
   *
   * @param id 会话 id
   * @returns 至少一侧确实删掉了 → true
   */
  async remove(id: string): Promise<boolean> {
    if (!SESSION_ID_PATTERN.test(id)) return false;
    let remoteDeleted = false;
    if (this.mirror !== null) {
      remoteDeleted = await this.mirror.remove(id);
      this.knownRemoteIds.delete(id);
    }
    let localDeleted = false;
    try {
      await rm(this.filePath(id), { force: true });
      localDeleted = true;
    } catch (error) {
      this.logger.warn(`[debug_store] 调试会话文件删除失败 session=${id}: ${errorName(error)}`);
    }
    return remoteDeleted || localDeleted;
  }

  // ── private ────────────────────────────────────────────────────

  /**
   * 列本地缓存摘要 (坏文件跳过, 不炸整页).
   *
   * @returns 摘要
   */
  private async listLocal(): Promise<DebugSessionSummary[]> {
    const files = await this.listFiles();
    const summaries: DebugSessionSummary[] = [];
    for (const file of files) {
      const record = await this.readRecordFile(file);
      if (!record) continue;
      summaries.push({
        id: record.id,
        title: record.title,
        characterSlug: record.characterSlug,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
        turnCount: record.turnCount,
        status: record.status,
        resumable: record.kernelState !== null,
      });
    }
    return summaries.toSorted((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  /**
   * 读当前记录: 远端优先, 本地回落.
   *
   * @param id 会话 id
   * @returns 记录 / null
   */
  private async readCurrent(id: string): Promise<DebugSessionRecord | null> {
    if (this.mirror !== null) {
      const remote = await this.mirror.get(id);
      if (remote !== null) return remote;
    }
    return this.readRecord(id);
  }

  /**
   * 刷新远端已知 id 集 (启动严格模式失败即抛出).
   *
   * @param strict true = 失败抛给启动; false = 只告警
   */
  private async refreshKnownIds(strict: boolean): Promise<void> {
    if (this.mirror === null) return;
    try {
      const ids = await this.mirror.listIds();
      this.knownRemoteIds.clear();
      for (const id of ids) this.knownRemoteIds.add(id);
    } catch (error) {
      if (strict) throw error;
      this.logger.warn(`[debug_store] 远端会话 id 刷新失败: ${errorName(error)}`);
    }
  }

  /**
   * 把写操作串到该会话的队列上.
   *
   * 队列本身**不吞异常**: 失败要能被调用方看到 (调用方决定降级还是报错).
   * 但队列不能因为一次失败就**卡死** —— 所以用 `catch` 把错误转成"队列继续".
   */
  private enqueue<T>(id: string, task: () => Promise<T>): Promise<T> {
    const previous = this.writeQueues.get(id) ?? Promise.resolve();
    const next = previous.then(task, task);
    // 队列尾永远"成功" (错误由 next 自己带出去), 否则后续任务会被前一次的失败连累.
    const tail = next.then(
      () => {},
      () => {},
    );
    this.writeQueues.set(id, tail);
    void tail.then(() => {
      // 队尾跑完且没有新任务接上 → 删掉这条链 (防内存泄漏).
      if (this.writeQueues.get(id) === tail) this.writeQueues.delete(id);
    });
    return next;
  }

  /**
   * 读一个会话记录 (文件不存在 / 解析失败 → null).
   */
  private async readRecord(id: string): Promise<DebugSessionRecord | null> {
    if (!SESSION_ID_PATTERN.test(id)) return null;
    try {
      const raw = await readFile(this.filePath(id), 'utf8');
      return parseDebugSessionRecord(raw);
    } catch {
      // 文件不存在 (ENOENT) 是常态 (查一个已删的会话) —— 不记日志, 返 null.
      return null;
    }
  }

  /**
   * 读一个已列出的文件 (解析失败 → null, 跳过).
   */
  private async readRecordFile(file: string): Promise<DebugSessionRecord | null> {
    try {
      const raw = await readFile(file, 'utf8');
      const record = parseDebugSessionRecord(raw);
      if (!record) {
        this.logger.warn(`[debug_store] 调试会话文件内容不可解析, 已跳过 file=${file}`);
        return null;
      }
      return record;
    } catch (error) {
      this.logger.warn(`[debug_store] 调试会话文件读取失败, 已跳过 file=${file}: ${errorName(error)}`);
      return null;
    }
  }

  /**
   * 写一个会话文件 (临时文件 + rename, 原子).
   */
  private async writeRecord(record: DebugSessionRecord): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    const target = this.filePath(record.id);
    const temp = `${target}.tmp`;
    await writeFile(temp, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
    await renameWithRetry(temp, target);
  }

  /**
   * 目录下的会话文件 (只认 `.json`, 跳过 `.tmp`).
   */
  private async listFiles(): Promise<string[]> {
    try {
      const names = await readdir(this.dir);
      return names.filter((name) => name.endsWith('.json')).map((name) => join(this.dir, name));
    } catch {
      // 目录还没建 (一个会话都没跑过) → 空列表.
      return [];
    }
  }

  /**
   * 淘汰超额的会话 (只留最近 MAX_DEBUG_SESSIONS 个).
   *
   * 按**创建时间**倒序保留 (不是按更新时间):
   *   更新时间是"最后被碰过", 一场跑了一半的老会话会被顶到前面, 于是新建的会话
   *   反被淘汰 —— 那等于"新会话把老会话挤没了", 与"保留最近 50 个"的字面意思相反.
   */
  private async prune(): Promise<void> {
    const files = await this.listFiles();
    if (files.length <= this.maxSessions) return;
    const dated = await Promise.all(
      files.map(async (file) => {
        const record = await this.readRecordFile(file);
        return { file, createdAt: record?.createdAt ?? '' };
      }),
    );
    // ⚠️ `toSorted` 返回**新**数组 (不改原数组) —— 淘汰名单必须从排序后的那份切.
    const stale = dated.toSorted((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(this.maxSessions);
    for (const item of stale) {
      try {
        await rm(item.file, { force: true });
      } catch (error) {
        this.logger.warn(`[debug_store] 淘汰旧调试会话文件失败: ${errorName(error)}`);
      }
    }
  }

  /**
   * 会话文件路径.
   */
  private filePath(id: string): string {
    return join(this.dir, `${id}.json`);
  }
}

/**
 * 解析存储目录 (env 覆盖, 缺省 `data/debug-sessions`).
 *
 * 相对路径按**进程工作目录**解析 (不是本文件所在目录) —— 部署时容器的工作目录
 * 是应用根, `data/` 就在那儿.
 *
 * @param config 配置服务
 * @returns 目录绝对路径
 */
export function resolveStoreDir(config: ConfigService): string {
  const raw = (config.get<string>(DEBUG_SESSION_DIR_ENV) ?? '').trim();
  if (raw.length === 0) return resolve(process.cwd(), DEFAULT_DEBUG_SESSION_DIR);
  return isAbsolute(raw) ? raw : resolve(process.cwd(), raw);
}

/**
 * 解析远端开关 (缺省 on; off/false/0/no 关闭).
 *
 * @param config 配置服务
 * @returns 是否启用远端
 */
export function resolveRemoteEnabled(config: ConfigService): boolean {
  const raw = (config.get<string>(DEBUG_SESSION_REMOTE_ENV) ?? '').trim().toLowerCase();
  if (raw.length === 0) return true;
  return !(raw === 'off' || raw === 'false' || raw === '0' || raw === 'no');
}

/**
 * 解析保留上限 (缺省 500; 夹在 1..10000).
 *
 * @param config 配置服务
 * @returns 上限
 */
export function resolveMaxSessions(config: ConfigService): number {
  const raw = (config.get<string>(DEBUG_SESSION_MAX_ENV) ?? '').trim();
  if (raw.length === 0) return DEFAULT_DEBUG_SESSION_MAX;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return DEFAULT_DEBUG_SESSION_MAX;
  return Math.min(Math.max(parsed, 1), 10_000);
}

/**
 * 合并远端与本地摘要: 同 id 取 updatedAt 更新的一份.
 *
 * @param remote 远端摘要
 * @param local 本地摘要
 * @returns 合并后按创建时间倒序
 */
function mergeSummaries(remote: readonly DebugSessionSummary[], local: readonly DebugSessionSummary[]): DebugSessionSummary[] {
  const merged = new Map<string, DebugSessionSummary>();
  for (const item of remote) merged.set(item.id, item);
  for (const item of local) {
    const existing = merged.get(item.id);
    if (existing === undefined || item.updatedAt > existing.updatedAt) merged.set(item.id, item);
  }
  return [...merged.values()].toSorted((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/**
 * 错误类型名 (不取 message —— 隐私红线: 报错文案可能带内容片段).
 */
function errorName(error: unknown): string {
  return error instanceof Error ? error.name : 'unknown';
}
