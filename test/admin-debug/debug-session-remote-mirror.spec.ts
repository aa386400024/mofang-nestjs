// V2026-11-22 (AF-313 · 调试会话远端持久化契约):
//   覆盖:
//     ① 远端开启时 create 先写 MySQL 再写本地缓存;
//     ② 本机无文件但远端有记录 → get 远端读到并回填缓存;
//     ③ list 合并远端 + 本地, 同 id 取 updatedAt 更新的一份;
//     ④ onModuleInit 登记远端 id, exists 不依赖本机文件;
//     ⑤ remote=off 回到纯文件模式;
//     ⑥ remove 双侧删除.
//
//   用内存替身模拟 DataSource/Repository; 真文件用临时目录.

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DataSource } from 'typeorm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DebugSessionMirror } from '../../src/admin-debug/debug-session-mirror.js';
import { guardSensitiveDebugQueryLogging } from '../../src/admin-debug/debug-session-query-log.guard.js';
import type { DebugSessionRecord } from '../../src/admin-debug/debug-session-record.js';
import { DebugSessionStore, resolveMaxSessions, resolveRemoteEnabled } from '../../src/admin-debug/debug-session-store.js';
import type { AdminDebugSessionEntity } from '../../src/admin-debug/entities/admin-debug-session.entity.js';

/** env 替身. */
function stubConfig(values: Record<string, string>): { get: (key: string) => string | undefined } {
  return { get: (key: string) => values[key] };
}

/**
 * 造一份记录.
 *
 * @param id 会话 id
 * @param overrides 覆盖字段
 * @returns 记录
 */
function makeRecord(id: string, overrides: Partial<DebugSessionRecord> = {}): DebugSessionRecord {
  const createdAt = overrides.createdAt ?? '2026-11-21T06:31:33.000Z';
  return {
    id,
    title: '晚晴与伴侣临时失约的等待',
    titleSource: 'fallback',
    characterSlug: 'vpt_intimate_avoidance_l1',
    characterLabel: '晚晴',
    createdAt,
    updatedAt: overrides.updatedAt ?? createdAt,
    status: 'completed',
    turnCount: 20,
    messages: [],
    traces: [],
    kernelState: null,
    ...overrides,
  };
}

/** 内存 Repository 替身. */
class FakeRepo {
  readonly rows = new Map<string, AdminDebugSessionEntity>();
  readonly upserts: AdminDebugSessionEntity[] = [];

  async findOne(options: { where?: { id?: string } } = {}): Promise<AdminDebugSessionEntity | null> {
    const id = options.where?.id;
    if (typeof id !== 'string') return null;
    return this.rows.get(id) ?? null;
  }

  async find(): Promise<AdminDebugSessionEntity[]> {
    return [...this.rows.values()].toSorted((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  async upsert(row: AdminDebugSessionEntity): Promise<void> {
    this.rows.set(row.id, { ...row });
    this.upserts.push({ ...row });
  }

  async delete(criteria: { id?: unknown }): Promise<{ affected: number }> {
    const id = criteria.id;
    if (typeof id === 'string') return { affected: this.rows.delete(id) ? 1 : 0 };
    const values = (id as { value?: unknown })?.value;
    if (Array.isArray(values)) {
      let affected = 0;
      for (const value of values) {
        if (typeof value === 'string' && this.rows.delete(value)) affected += 1;
      }
      return { affected };
    }
    return { affected: 0 };
  }

  async count(): Promise<number> {
    return this.rows.size;
  }
}

/** 内存 DataSource 替身. */
function makeDataSource(repo: FakeRepo): DataSource {
  return { getRepository: () => repo } as unknown as DataSource;
}

describe('AF-313 调试会话远端持久化', () => {
  let dir: string;
  let repo: FakeRepo;
  let ds: DataSource;
  let store: DebugSessionStore;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'af313-debug-store-'));
    repo = new FakeRepo();
    ds = makeDataSource(repo);
    store = new DebugSessionStore(stubConfig({ ADMIN_DEBUG_SESSION_DIR: dir, ADMIN_DEBUG_SESSION_MAX: '2000' }) as never, ds);
    await store.onModuleInit();
  });

  afterEach(async () => {
    store.onModuleDestroy();
    await rm(dir, { recursive: true, force: true });
  });

  it('create 先落远端再写本地缓存，exists 两侧都成立', async () => {
    const record = makeRecord('debug_remote_create');
    await store.create(record);
    expect(repo.rows.has(record.id)).toBe(true);
    expect(JSON.parse(await readFile(join(dir, `${record.id}.json`), 'utf8'))).toMatchObject({ id: record.id });
    expect(store.exists(record.id)).toBe(true);
  });

  it('本机无文件但远端有记录 → get 读到并回填缓存', async () => {
    const record = makeRecord('debug_remote_get');
    await store.create(record);
    await rm(join(dir, `${record.id}.json`), { force: true });
    const loaded = await store.get(record.id);
    expect(loaded?.title).toBe(record.title);
    expect(store.exists(record.id)).toBe(true);
    const cached = JSON.parse(await readFile(join(dir, `${record.id}.json`), 'utf8')) as DebugSessionRecord;
    expect(cached.id).toBe(record.id);
  });

  it('list 合并远端与本地，同 id 取 updatedAt 更新的一份', async () => {
    const remoteOld = makeRecord('debug_merge', { updatedAt: '2026-11-21T06:32:00.000Z', title: '远端旧' });
    await store.create(remoteOld);
    const localNew = makeRecord('debug_merge', { updatedAt: '2026-11-21T07:00:00.000Z', title: '本地新' });
    await writeFile(join(dir, `${localNew.id}.json`), `${JSON.stringify(localNew, null, 2)}\n`, 'utf8');
    const other = makeRecord('debug_local_only', { title: '仅本地' });
    await writeFile(join(dir, `${other.id}.json`), `${JSON.stringify(other, null, 2)}\n`, 'utf8');

    const list = await store.list();
    const merged = list.find((item) => item.id === 'debug_merge');
    expect(merged?.title).toBe('本地新');
    expect(list.some((item) => item.id === 'debug_local_only')).toBe(true);
  });

  it('onModuleInit 登记远端 id 后，本机无文件 exists 仍为 true', async () => {
    const record = makeRecord('debug_known_remote');
    await store.create(record);
    await rm(join(dir, `${record.id}.json`), { force: true });
    const reopened = new DebugSessionStore(stubConfig({ ADMIN_DEBUG_SESSION_DIR: dir }) as never, ds);
    await reopened.onModuleInit();
    try {
      expect(reopened.exists(record.id)).toBe(true);
      expect(reopened.exists('debug_not_exists')).toBe(false);
    } finally {
      reopened.onModuleDestroy();
    }
  });

  it('remove 同时删除远端与本地', async () => {
    const record = makeRecord('debug_remove_both');
    await store.create(record);
    expect(await store.remove(record.id)).toBe(true);
    expect(repo.rows.has(record.id)).toBe(false);
    expect(store.exists(record.id)).toBe(false);
  });

  it('remote=off 时不创建远端记录，行为回到纯文件模式', async () => {
    const offStore = new DebugSessionStore(stubConfig({ ADMIN_DEBUG_SESSION_DIR: dir, ADMIN_DEBUG_SESSION_REMOTE: 'off' }) as never, ds);
    const record = makeRecord('debug_remote_off');
    await offStore.create(record);
    expect(repo.rows.has(record.id)).toBe(false);
    expect(offStore.exists(record.id)).toBe(true);
    expect((await offStore.get(record.id))?.id).toBe(record.id);
  });

  it('resolveRemoteEnabled 缺省 on，off/false/0/no 关闭', () => {
    expect(resolveRemoteEnabled(stubConfig({}) as never)).toBe(true);
    for (const value of ['off', 'false', '0', 'no', 'OFF']) {
      expect(resolveRemoteEnabled(stubConfig({ ADMIN_DEBUG_SESSION_REMOTE: value }) as never)).toBe(false);
    }
    expect(resolveMaxSessions(stubConfig({ ADMIN_DEBUG_SESSION_MAX: '2000' }) as never)).toBe(2000);
    expect(resolveMaxSessions(stubConfig({ ADMIN_DEBUG_SESSION_MAX: '0' }) as never)).toBe(1);
  });

  it('远端 upsert 的 onlyIfNewer 只升不降', async () => {
    const repo2 = new FakeRepo();
    const ds2 = makeDataSource(repo2);
    const mirror = new DebugSessionMirror(ds2);
    const newer = makeRecord('debug_newer', { updatedAt: '2026-11-21T08:00:00.000Z', title: '新' });
    const older = makeRecord('debug_newer', { updatedAt: '2026-11-21T07:00:00.000Z', title: '旧' });
    await mirror.upsert(newer, { onlyIfNewer: true });
    await mirror.upsert(older, { onlyIfNewer: true });
    const row = repo2.rows.get('debug_newer');
    expect(row?.title).toBe('新');
  });

  it('受保护表的慢查询日志只出占位，不带对话参数', () => {
    const inner = {
      logQuery: vi.fn(),
      logQueryError: vi.fn(),
      logQuerySlow: vi.fn(),
      logSchemaBuild: vi.fn(),
      logMigration: vi.fn(),
      log: vi.fn(),
    };
    const dsWithLogger = { logger: inner, getRepository: () => repo } as unknown as DataSource;
    guardSensitiveDebugQueryLogging(dsWithLogger);
    const guarded = dsWithLogger.logger;

    guarded.logQuerySlow(1200, 'INSERT INTO admin_debug_sessions (record_json) VALUES (?)', ['{"messages":[{"text":"原文"}]}']);
    expect(inner.logQuerySlow).toHaveBeenCalledWith(
      1200,
      'INSERT INTO admin_debug_sessions (record_json) VALUES (?)',
      ['[redacted:admin_debug_sessions]'],
      undefined,
    );

    guarded.logQuery('SELECT * FROM user', ['ok']);
    expect(inner.logQuery).toHaveBeenCalledWith('SELECT * FROM user', ['ok'], undefined);
  });
});
