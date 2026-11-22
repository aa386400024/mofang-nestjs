// V2026-11-22 (AF-313 · 调试会话远端持久化):
//   MySQL 侧的系统记录层 —— 把 `DebugSessionRecord` 落到专用表 `admin_debug_sessions`.
//
//   定位: 远端开启时由 `DebugSessionStore` 调用; 本类不直接面向 controller.
//   边界: 只做记录投影 / 序列化 / 读写; 不做业务编排; 不读 env.
//   隐私: 任何日志只出会话 id / 计数 / 错误类型名, 不输出 recordJson 片段.

import { Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { In, type DataSource, type Repository } from 'typeorm';

import { guardSensitiveDebugQueryLogging } from './debug-session-query-log.guard.js';
import { parseDebugSessionRecord, type DebugSessionRecord, type DebugSessionSummary } from './debug-session-record.js';
import { ADMIN_DEBUG_SESSION_SCHEMA_VERSION, AdminDebugSessionEntity } from './entities/admin-debug-session.entity.js';

/** upsert 结果 (导入脚本据此计数). */
export type DebugSessionUpsertResult = 'created' | 'updated' | 'skipped';

/** upsert 选项. */
export interface DebugSessionUpsertOptions {
  /** 只在传入记录 updatedAt 更新时覆盖 (导入历史文件用). */
  readonly onlyIfNewer?: boolean;
  /** 写入后按创建时间保留的会话上限; 不传 = 不淘汰. */
  readonly maxSessions?: number;
}

/**
 * 调试会话 MySQL 记录层.
 */
export class DebugSessionMirror {
  private readonly logger = new Logger(DebugSessionMirror.name);
  private readonly repo: Repository<AdminDebugSessionEntity>;

  /**
   * @param dataSource TypeORM 数据源
   */
  constructor(dataSource: DataSource) {
    // 隐私护栏: 慢查询/query 日志不得带出 record_json 参数.
    guardSensitiveDebugQueryLogging(dataSource);
    this.repo = dataSource.getRepository(AdminDebugSessionEntity);
  }

  /**
   * 写一条记录 (幂等: 同 id 覆盖).
   *
   * @param record 会话记录
   * @param options 导入/淘汰选项
   * @returns 新建 / 更新 / 跳过
   */
  async upsert(record: DebugSessionRecord, options: DebugSessionUpsertOptions = {}): Promise<DebugSessionUpsertResult> {
    const existing = await this.repo.findOne({
      where: { id: record.id },
      select: { id: true, updatedAt: true },
    });
    if (options.onlyIfNewer === true && existing !== null) {
      const incoming = Date.parse(record.updatedAt);
      const current = new Date(existing.updatedAt).getTime();
      if (Number.isFinite(incoming) && Number.isFinite(current) && incoming <= current) {
        return 'skipped';
      }
    }

    const payload = JSON.stringify(record);
    const row: AdminDebugSessionEntity = {
      id: record.id,
      title: record.title.slice(0, 255),
      titleSource: record.titleSource,
      characterSlug: record.characterSlug.slice(0, 128),
      characterLabel: record.characterLabel.slice(0, 255),
      status: record.status,
      turnCount: record.turnCount,
      hasKernelState: record.kernelState === null ? 0 : 1,
      recordJson: payload,
      contentSha256: createHash('sha256').update(payload).digest('hex'),
      recordBytes: Buffer.byteLength(payload, 'utf8'),
      schemaVersion: ADMIN_DEBUG_SESSION_SCHEMA_VERSION,
      createdAt: toDate(record.createdAt, Date.now()),
      updatedAt: toDate(record.updatedAt, Date.now()),
    };
    await this.repo.upsert(row, ['id']);
    if (options.maxSessions !== undefined && options.maxSessions > 0) {
      await this.prune(options.maxSessions);
    }
    return existing === null ? 'created' : 'updated';
  }

  /**
   * 读一条完整记录.
   *
   * @param id 会话 id
   * @returns 记录; 不存在 / JSON 损坏 → null
   */
  async get(id: string): Promise<DebugSessionRecord | null> {
    const row = await this.repo.findOne({ where: { id } });
    if (row === null) return null;
    const record = parseDebugSessionRecord(row.recordJson);
    if (record === null) {
      this.logger.warn(`[debug_mirror] 记录 JSON 不可解析 session=${id}`);
      return null;
    }
    return record;
  }

  /**
   * 列出摘要 (不读 record_json).
   *
   * @returns 按创建时间倒序的摘要
   */
  async list(): Promise<DebugSessionSummary[]> {
    const rows = await this.repo.find({
      select: {
        id: true,
        title: true,
        characterSlug: true,
        createdAt: true,
        updatedAt: true,
        turnCount: true,
        status: true,
        hasKernelState: true,
      },
      order: { createdAt: 'DESC' },
    });
    return rows.map((row) => ({
      id: row.id,
      title: row.title,
      characterSlug: row.characterSlug,
      createdAt: toIso(row.createdAt),
      updatedAt: toIso(row.updatedAt),
      turnCount: row.turnCount,
      status: row.status === 'completed' ? 'completed' : 'active',
      resumable: row.hasKernelState === 1,
    }));
  }

  /**
   * 列出全部会话 id (供本机 exists 缓存).
   *
   * @returns id 集合
   */
  async listIds(): Promise<string[]> {
    const rows = await this.repo.find({ select: { id: true } });
    return rows.map((row) => row.id);
  }

  /**
   * 删除一条记录.
   *
   * @param id 会话 id
   * @returns 确实删掉了 → true
   */
  async remove(id: string): Promise<boolean> {
    const result = await this.repo.delete({ id });
    return (result.affected ?? 0) > 0;
  }

  /**
   * 按创建时间保留最近 N 条.
   *
   * @param maxSessions 保留上限
   */
  async prune(maxSessions: number): Promise<void> {
    if (!Number.isFinite(maxSessions) || maxSessions <= 0) return;
    const max = Math.floor(maxSessions);
    let total = await this.repo.count();
    while (total > max) {
      const limit = Math.min(1000, total - max);
      const stale = await this.repo
        .createQueryBuilder('s')
        .select('s.id', 'id')
        .orderBy('s.created_at', 'DESC')
        .offset(max)
        .limit(limit)
        .getRawMany<{ id: string }>();
      if (stale.length === 0) break;
      await this.repo.delete({ id: In(stale.map((item) => item.id)) });
      total -= stale.length;
    }
  }
}

/**
 * 日期解析 (非法 → fallback).
 *
 * @param value ISO 字符串
 * @param fallback 毫秒时间戳
 * @returns Date
 */
function toDate(value: string, fallback: number): Date {
  const parsed = Date.parse(value);
  return new Date(Number.isFinite(parsed) ? parsed : fallback);
}

/**
 * Date → ISO (非法 → epoch, 不抛).
 *
 * @param value Date
 * @returns ISO 字符串
 */
function toIso(value: Date): string {
  const ms = value instanceof Date ? value.getTime() : Number.NaN;
  return Number.isNaN(ms) ? new Date(0).toISOString() : new Date(ms).toISOString();
}
