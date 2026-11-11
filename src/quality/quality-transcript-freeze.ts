// V2026-11-11 治本 (WP-N · 标注台批次化 — 逐字稿冻结留档):
//   原因: 逐字稿上限 MAX_DEBUG_SESSIONS=500, prune 按创建时间淘汰.
//     淘汰后标注记录还在, 但台词读不出来, 自动对照也算不出 —— **且界面不报错**.
//   本模块提供**独立冻结副本** (data/quality/transcripts/<batchId>/<debugSessionId>.json),
//   只由 quality 模块使用, **不改 DebugSessionStore 任何行为** (那是共享读路径).
//
//   读路径: 冻结副本存在 → 优先读冻结 ('frozen'); 否则读活 store ('live'); 都没有 → 'missing'.
//   写路径: 懒冻结 (PUT 保存成功后冻结一次) + 预冻结 CLI (bin/quality-freeze-batch.ts).

import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { isValidBatchId } from './quality-annotation-batch.js';
import { TRANSCRIPT_SOURCE, UNASSIGNED_BATCH_DIR, type TranscriptSource } from './quality-annotation.constants.js';

/**
 * 冻结副本根目录 (相对进程工作目录).
 */
export const TRANSCRIPT_FREEZE_ROOT_DIR = 'data/quality/transcripts';

/**
 * 调试会话 id 的合法形状 —— 与 `debug-session-store.ts` 的 SESSION_ID_PATTERN 同口径.
 *
 * ⚠️ **为什么在这里重写一份**: 会话 id 会被拼成文件路径, 不校验就能写到目录外面去.
 *   store 里那个常量是模块私有的, 为此改既有文件不值得; 两处口径必须一致.
 */
const SESSION_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

/**
 * 一条逐字稿消息 (只要标注台要用的三个字段).
 */
export interface TranscriptMessage {
  /** 谁说的 (visitor / counselor). */
  readonly role: string;
  /** 台词原文. */
  readonly text: string;
  /** 轮次 (从 1 起). */
  readonly turnIndex: number;
  /** 时刻 (ISO; 老文件可能没有). */
  readonly ts?: string;
}

/**
 * 一份逐字稿记录 (冻结副本与活文件的公共形状).
 *
 * ⚠️ **只声明要用的字段, 不加索引签名** —— 加了索引签名, DebugSessionRecord 就
 *   没法赋值过来了 (TS 报 "Index signature for type 'string' is missing").
 *   运行时 JSON.stringify 仍会写出**全部**字段, 所以冻结副本不裁剪.
 */
export interface TranscriptRecord {
  /** 会话 id. */
  readonly id: string;
  /** 标题. */
  readonly title: string;
  /** 角色代号. */
  readonly characterSlug: string;
  /** 角色展示名. */
  readonly characterLabel: string;
  /** 创建时刻. */
  readonly createdAt: string;
  /** 最后更新时刻. */
  readonly updatedAt: string;
  /** 状态. */
  readonly status: string;
  /** 已跑轮数. */
  readonly turnCount: number;
  /** 逐轮消息. */
  readonly messages: readonly TranscriptMessage[];
  /** 逐轮 trace. */
  readonly traces: readonly unknown[];
  /** 内核状态快照. */
  readonly kernelState: unknown;
}

/**
 * 活逐字稿读端口 (由 DebugSessionStore 实现).
 */
export interface TranscriptReader {
  /**
   * 读一份逐字稿.
   *
   * @param id 会话 id
   * @returns 记录; 不存在 / 读失败 → null
   */
  get(id: string): Promise<TranscriptRecord | null>;
}

/**
 * 读到的逐字稿 (含来源).
 */
export interface TranscriptReadResult {
  /** 来源 (frozen / live / missing). */
  readonly source: TranscriptSource;
  /** 记录 (source=missing 时为 null). */
  readonly record: TranscriptRecord | null;
}

/**
 * 冻结结果.
 */
export interface FreezeResult {
  /** 本次是否真的写了冻结副本. */
  readonly frozen: boolean;
  /** 原因 (already-frozen / missing / failed / frozen). */
  readonly reason: 'frozen' | 'already-frozen' | 'missing' | 'failed';
}

/**
 * 逐字稿冻结留档器.
 *
 * ⚠️ **不碰 DebugSessionStore**: 它是共享读路径 (admin 调试页也在用),
//    改它的行为会让调试页的淘汰行为跟着变 —— 本单明令禁止.
 */
export class QualityTranscriptFreeze {
  /**
   * @param reader 活逐字稿读端口
   * @param rootDir 冻结副本根目录
   */
  constructor(
    private readonly reader: TranscriptReader,
    private readonly rootDir: string = path.resolve(process.cwd(), TRANSCRIPT_FREEZE_ROOT_DIR),
  ) {}

  /**
   * 冻结副本的落盘路径.
   *
   * @param debugSessionId 会话 id
   * @param batchId 批次 id (NULL → _unassigned 目录)
   * @returns 路径; id 不合法 → null
   */
  freezePath(debugSessionId: string, batchId: string | null): string | null {
    if (!SESSION_ID_PATTERN.test(debugSessionId)) return null;
    const dir = batchId !== null && isValidBatchId(batchId) ? batchId : UNASSIGNED_BATCH_DIR;
    return path.join(this.rootDir, dir, `${debugSessionId}.json`);
  }

  /**
   * 冻结副本是否已存在.
   *
   * @param debugSessionId 会话 id
   * @param batchId 批次 id
   * @returns 存在 → true
   */
  hasFrozen(debugSessionId: string, batchId: string | null): boolean {
    const target = this.freezePath(debugSessionId, batchId);
    if (target !== null && existsSync(target)) return true;
    // 归属未知的兜底目录也要看: 一行先按"无归属"冻结, 后来才被归到某批, 冻结副本不能丢.
    const fallback = this.unassignedPath(debugSessionId);
    return fallback !== null && existsSync(fallback);
  }

  /**
   * 兜底目录 (无归属) 的冻结副本路径.
   *
   * @param debugSessionId 会话 id
   * @returns 路径; id 不合法 → null
   */
  unassignedPath(debugSessionId: string): string | null {
    if (!SESSION_ID_PATTERN.test(debugSessionId)) return null;
    return path.join(this.rootDir, UNASSIGNED_BATCH_DIR, `${debugSessionId}.json`);
  }

  /**
   * 读逐字稿 (**冻结优先**).
   *
   * ⚠️ 冻结优先是本单的核心: 活文件会被 500 淘汰, 冻结副本是标注结论的**唯一**回看依据.
   *
   * @param debugSessionId 会话 id
   * @param batchId 批次 id
   * @returns 来源 + 记录
   */
  async read(debugSessionId: string, batchId: string | null): Promise<TranscriptReadResult> {
    const target = this.freezePath(debugSessionId, batchId);
    if (target !== null) {
      const frozen = await this.readFrozen(target);
      if (frozen !== null) return { source: TRANSCRIPT_SOURCE.Frozen, record: frozen };
    }
    const fallback = this.unassignedPath(debugSessionId);
    if (fallback !== null) {
      const frozen = await this.readFrozen(fallback);
      if (frozen !== null) return { source: TRANSCRIPT_SOURCE.Frozen, record: frozen };
    }
    const live = await this.reader.get(debugSessionId);
    if (live !== null) return { source: TRANSCRIPT_SOURCE.Live, record: live };
    return { source: TRANSCRIPT_SOURCE.Missing, record: null };
  }

  /**
   * 冻结一份逐字稿 (已存在则不重复写).
   *
   * ⚠️ **逐字节**: 落盘用 JSON.stringify(record, null, 2) + 换行 —— 与 DebugSessionStore
   *   自己的写盘格式完全一致, 所以"活文件"与"冻结副本"在字节层面可对照.
   *
   * @param debugSessionId 会话 id
   * @param batchId 批次 id
   * @returns 冻结结果
   */
  async freeze(debugSessionId: string, batchId: string | null): Promise<FreezeResult> {
    const target = this.freezePath(debugSessionId, batchId);
    if (target === null) return { frozen: false, reason: 'failed' };
    if (existsSync(target)) return { frozen: false, reason: 'already-frozen' };

    const live = await this.reader.get(debugSessionId);
    if (live === null) return { frozen: false, reason: 'missing' };

    try {
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, `${JSON.stringify(live, null, 2)}\n`, 'utf8');
      return { frozen: true, reason: 'frozen' };
    } catch {
      return { frozen: false, reason: 'failed' };
    }
  }

  /**
   * 读冻结副本 (不存在 / 不可解析 → null).
   *
   * @param path 冻结副本路径
   * @returns 记录; 读不到 → null
   */
  private async readFrozen(target: string): Promise<TranscriptRecord | null> {
    let raw: string;
    try {
      raw = await readFile(target, 'utf8');
    } catch {
      return null;
    }
    return parseFrozenRecord(raw);
  }
}

/**
 * 解析冻结副本 (宽容: 缺字段按缺省, 但 id 缺失直接判废).
 *
 * ⚠️ **不复用 DebugSessionStore 的 parseRecord**: 那是模块私有函数, 改它就动了共享读路径.
 *   这里只解析标注台真正要用的字段, 其余一律忽略.
 *
 * @param raw 文件内容
 * @returns 记录; 不可解析 → null
 */
export function parseFrozenRecord(raw: string): TranscriptRecord | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const record = parsed as Record<string, unknown>;
  const id = typeof record['id'] === 'string' ? record['id'] : '';
  if (id.length === 0) return null;
  const createdAt = typeof record['createdAt'] === 'string' ? record['createdAt'] : '';
  return {
    id,
    title: typeof record['title'] === 'string' ? record['title'] : '',
    characterSlug: typeof record['characterSlug'] === 'string' ? record['characterSlug'] : '',
    characterLabel: typeof record['characterLabel'] === 'string' ? record['characterLabel'] : '',
    createdAt,
    updatedAt: typeof record['updatedAt'] === 'string' ? record['updatedAt'] : createdAt,
    status: typeof record['status'] === 'string' ? record['status'] : 'active',
    turnCount: typeof record['turnCount'] === 'number' ? record['turnCount'] : 0,
    messages: Array.isArray(record['messages']) ? (record['messages'] as TranscriptMessage[]) : [],
    traces: Array.isArray(record['traces']) ? (record['traces'] as unknown[]) : [],
    kernelState: record['kernelState'] ?? null,
  };
}
