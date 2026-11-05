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

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
// node:fs / node:path 没 default export, unicorn/import-style 误报 — 忽略.
// eslint-disable-next-line unicorn/import-style
import { isAbsolute, join, resolve } from 'node:path';

/**
 * 调试会话的标题来源.
 *
 * 为什么**要记来源**:
 *   自动命名 (LLM) 与人工改名会**互相覆盖** —— 用户手动改过的标题不该被后到的
 *   LLM 结果冲掉. 记下来源, 覆盖规则就有一条明确的口径:
 *   `llm` 只能覆盖 `fallback`, 永远盖不掉 `manual`.
 */
export type DebugSessionTitleSource = 'fallback' | 'llm' | 'manual';

/**
 * 调试会话的生命周期状态.
 */
export type DebugSessionStatus = 'active' | 'completed';

/**
 * 一条调试消息 (一轮里的咨询师发言 / 来访者回应).
 */
export interface DebugSessionMessage {
  /** 谁说的: `counselor` = 学员 (咨询师), `visitor` = AI 扮演的来访者. */
  readonly role: 'counselor' | 'visitor';
  /** 原文. */
  readonly text: string;
  /** 属于第几轮 (从 1 开始). */
  readonly turnIndex: number;
  /** 时刻 (ISO). */
  readonly ts: string;
}

/**
 * 调试会话的落盘记录 (一个 JSON 文件的形状).
 */
export interface DebugSessionRecord {
  /** 会话 id (= 内核 sessionId; 也是文件名). */
  readonly id: string;
  /** 会话标题. */
  readonly title: string;
  /** 标题来源 (决定谁能覆盖谁). */
  readonly titleSource: DebugSessionTitleSource;
  /** 角色代号. */
  readonly characterSlug: string;
  /** 角色展示名. */
  readonly characterLabel: string;
  /** 创建时刻 (ISO). */
  readonly createdAt: string;
  /** 最后更新时刻 (ISO). */
  readonly updatedAt: string;
  /** 状态: `active` = 还在跑, `completed` = 已关闭. */
  readonly status: DebugSessionStatus;
  /** 已跑轮数. */
  readonly turnCount: number;
  /** 逐轮消息 (咨询师 + 来访者, 一轮两条). */
  readonly messages: readonly DebugSessionMessage[];
  /** 逐轮调试 trace (完整内部状态, 含 prompt 全文). */
  readonly traces: readonly unknown[];
}

/**
 * 会话列表的一行 (列表不返 messages/traces —— 那是详情的事).
 */
export interface DebugSessionSummary {
  readonly id: string;
  readonly title: string;
  readonly characterSlug: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly turnCount: number;
  readonly status: DebugSessionStatus;
}

/**
 * 保留的会话上限.
 *
 * 为什么是 50: 调试面板的会话列表是"最近跑过的那几场" —— 50 场足够回溯,
 * 再多就只是垃圾堆积 (每个文件都含完整对话 + prompt 全文, 体积不小).
 */
export const MAX_DEBUG_SESSIONS = 50;

/**
 * 存储目录的 env 键 (可覆盖, 便于测试与部署时挂到独立卷).
 */
export const DEBUG_SESSION_DIR_ENV = 'ADMIN_DEBUG_SESSION_DIR';

/**
 * 存储目录的默认位置 (相对进程工作目录).
 */
export const DEFAULT_DEBUG_SESSION_DIR = 'data/debug-sessions';

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
export class DebugSessionStore {
  private readonly logger = new Logger(DebugSessionStore.name);
  /** 存储目录. */
  private readonly dir: string;
  /**
   * 每个会话的写串行队列 (会话 id → 队列尾 promise).
   *
   * 为什么需要: 追加一轮是"读文件 → 改 → 写回". 两个并发轮次同时进来会**互相覆盖**
   * (后写的基于旧的快照 → 丢掉先写的那轮). 用一条 per-session 的 promise 链把写操作
   * 串起来, 就不会有"读到旧快照"的机会.
   */
  private readonly writeQueues = new Map<string, Promise<unknown>>();

  constructor(config: ConfigService) {
    this.dir = resolveStoreDir(config);
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
   * 建档 (写一个空会话文件).
   *
   * @param record 会话初始记录
   * @returns 落盘的记录
   */
  async create(record: DebugSessionRecord): Promise<DebugSessionRecord> {
    return this.enqueue(record.id, async () => {
      await this.writeRecord(record);
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
  ): Promise<DebugSessionRecord | null> {
    return this.enqueue(id, async () => {
      const current = await this.readRecord(id);
      if (!current) return null;
      const updated: DebugSessionRecord = {
        ...current,
        updatedAt: new Date().toISOString(),
        turnCount: current.turnCount + 1,
        messages: [...current.messages, message, reply],
        traces: [...current.traces, trace],
      };
      await this.writeRecord(updated);
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
      const current = await this.readRecord(id);
      if (!current) return null;
      if (source === 'llm' && current.titleSource === 'manual') return current;
      const updated: DebugSessionRecord = {
        ...current,
        title,
        titleSource: source,
        updatedAt: new Date().toISOString(),
      };
      await this.writeRecord(updated);
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
      const current = await this.readRecord(id);
      if (!current) return null;
      const updated: DebugSessionRecord = { ...current, status: 'completed', updatedAt: new Date().toISOString() };
      await this.writeRecord(updated);
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
      });
    }
    return summaries.toSorted((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  /**
   * 读一个会话的完整记录.
   *
   * @param id 会话 id
   * @returns 记录; 不存在 / 读失败 → null
   */
  async get(id: string): Promise<DebugSessionRecord | null> {
    return this.readRecord(id);
  }

  /**
   * 删除一个会话 (文件).
   *
   * @param id 会话 id
   * @returns 确实删掉了 → true
   */
  async remove(id: string): Promise<boolean> {
    if (!SESSION_ID_PATTERN.test(id)) return false;
    try {
      await rm(this.filePath(id), { force: true });
      return true;
    } catch (error) {
      this.logger.warn(`[debug_store] 调试会话文件删除失败 session=${id}: ${errorName(error)}`);
      return false;
    }
  }

  // ── private ────────────────────────────────────────────────────

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
      return parseRecord(raw);
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
      const record = parseRecord(raw);
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
    await rename(temp, target);
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
    if (files.length <= MAX_DEBUG_SESSIONS) return;
    const dated = await Promise.all(
      files.map(async (file) => {
        const record = await this.readRecordFile(file);
        return { file, createdAt: record?.createdAt ?? '' };
      }),
    );
    // ⚠️ `toSorted` 返回**新**数组 (不改原数组) —— 淘汰名单必须从排序后的那份切.
    const stale = dated.toSorted((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(MAX_DEBUG_SESSIONS);
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
 * 解析 JSON 文本 → 会话记录 (形状不对 → null).
 *
 * 为什么要**逐字段兜底**: 文件可能被手工改过 / 被别的版本写过. 缺字段就当缺省,
 * 而不是整条丢弃 —— 一条消息的缺失不该让整场会话从列表里消失.
 */
function parseRecord(raw: string): DebugSessionRecord | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const record = parsed as Record<string, unknown>;
  const id = readString(record['id']);
  if (id === null) return null;
  const createdAt = readString(record['createdAt']) ?? new Date().toISOString();
  return {
    id,
    title: readString(record['title']) ?? '',
    titleSource: readTitleSource(record['titleSource']),
    characterSlug: readString(record['characterSlug']) ?? '',
    characterLabel: readString(record['characterLabel']) ?? '',
    createdAt,
    updatedAt: readString(record['updatedAt']) ?? createdAt,
    status: record['status'] === 'completed' ? 'completed' : 'active',
    turnCount: readNumber(record['turnCount']) ?? 0,
    messages: Array.isArray(record['messages']) ? (record['messages'] as DebugSessionMessage[]) : [],
    traces: Array.isArray(record['traces']) ? (record['traces'] as unknown[]) : [],
  };
}

/**
 * 读字符串 (非空).
 */
function readString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/**
 * 读数字 (有限).
 */
function readNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * 读标题来源 (非法值 → `fallback`).
 */
function readTitleSource(value: unknown): DebugSessionTitleSource {
  if (value === 'llm' || value === 'manual') return value;
  return 'fallback';
}

/**
 * 错误类型名 (不取 message —— 隐私红线: 报错文案可能带内容片段).
 */
function errorName(error: unknown): string {
  return error instanceof Error ? error.name : 'unknown';
}
