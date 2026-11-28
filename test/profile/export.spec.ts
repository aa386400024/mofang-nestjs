import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { describe, expect, it, vi } from 'vitest';

import { BizCode } from '../../src/common/exceptions/biz-code.enum.js';
import { BizException } from '../../src/common/exceptions/biz.exception.js';
import { DeleteAccountDto } from '../../src/profile/dto/export.dto.js';
import { buildExportArchive, buildSingleFileZip, crc32 } from '../../src/profile/providers/export-archive.js';
import { ExportService } from '../../src/profile/providers/export.service.js';
import type { UserDataExportPayload } from '../../src/profile/providers/user-data-export.collector.js';
import { AuditEvent } from '../../src/user/enums/audit-event.enum.js';
import { UserState } from '../../src/user/user.state.js';

/** 最小导出载荷（真实采集器在 collector 单测里覆盖）. */
function samplePayload(): UserDataExportPayload {
  return {
    schemaVersion: '1.1',
    exportedAt: '2026-11-28T00:00:00.000Z',
    scope: { includedDomains: ['account'], pendingDomains: [] },
    account: {
      uid: 'uid-1',
      phone: '13800000000',
      email: null,
      state: 'active',
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-01-01T00:00:00Z'),
      lastLoginAt: null,
      emailVerifiedAt: null,
      phoneVerifiedAt: null,
      deletedAt: null,
    },
    profile: null,
    notificationSettings: null,
    membership: null,
    certification: null,
    companionBindings: [],
    companionRecords: [],
    selfcareRecords: [],
    burnoutSettings: null,
    consentSignatures: [],
    privacyAuthorizations: [],
    aiConversationSummaries: [],
    practiceSessions: [],
    practiceRecords: [],
  };
}

/** 内存 Redis 桩：覆盖服务用到的三个命令. */
function fakeRedis() {
  const values = new Map<string, string>();
  return {
    values,
    set: vi.fn(async (key: string, value: string) => {
      values.set(key, value);
    }),
    get: vi.fn(async (key: string) => values.get(key) ?? null),
    setnx: vi.fn(async (key: string, value: string) => {
      if (values.has(key)) return false;
      values.set(key, value);
      return true;
    }),
  };
}

function buildService(options: { failCollect?: boolean } = {}) {
  const redis = fakeRedis();
  const collector = {
    collect: vi.fn(async () => {
      if (options.failCollect) throw new Error('collector down');
      return samplePayload();
    }),
  };
  const audit = { log: vi.fn(async () => ({})) };
  const jobs: { taskId: string; uid: string; format: 'json' | 'zip' }[] = [];
  let processor: ((data: { taskId: string; uid: string; format: 'json' | 'zip' }) => Promise<void>) | undefined;
  const queue = {
    registerProcessor: vi.fn((fn: typeof processor) => {
      processor = fn;
    }),
    enqueue: vi.fn(async (data: { taskId: string; uid: string; format: 'json' | 'zip' }) => {
      jobs.push(data);
      return true;
    }),
  };
  const service = new ExportService(
    { findOne: vi.fn() } as never,
    { revokeAllByUserId: vi.fn() } as never,
    { revokeMany: vi.fn() } as never,
    audit as never,
    collector as never,
    redis as never,
    { get: vi.fn(() => 30) } as never,
    queue as never,
  );
  /** 模拟 Worker 消费：按入队顺序跑注册的处理器. */
  const drain = async () => {
    while (jobs.length > 0) {
      const job = jobs.shift()!;
      await processor?.(job);
    }
  };
  return { service, redis, collector, audit, queue, jobs, drain };
}

/** 删除账户路径：用户仓储、会话、JWT、OAuth 全部用可断言的桩. */
function buildDeletionService(options: { user?: Record<string, unknown> | null; retentionDays?: number } = {}) {
  const user =
    options.user === undefined
      ? {
          uid: 'uid-del',
          state: UserState.Active,
          deletedAt: null,
          passwordHash: 'bcrypt-hash',
          phone: '13800000000',
          email: 'del@example.com',
          emailVerifiedAt: new Date('2026-01-01T00:00:00Z'),
          phoneVerifiedAt: new Date('2026-01-01T00:00:00Z'),
        }
      : options.user;
  const oauthDelete = vi.fn(async () => ({ affected: 1 }));
  const repo = {
    findOne: vi.fn(async () => user),
    save: vi.fn(async (row: unknown) => row),
    manager: { getRepository: vi.fn(() => ({ delete: oauthDelete })) },
  };
  const sessions = { revokeAllByUserId: vi.fn(async () => ['session-1', 'session-2']) };
  const blacklist = { revokeMany: vi.fn(async () => {}) };
  const audit = { log: vi.fn(async () => ({})) };
  const service = new ExportService(
    repo as never,
    sessions as never,
    blacklist as never,
    audit as never,
    { collect: vi.fn() } as never,
    fakeRedis() as never,
    { get: vi.fn(() => options.retentionDays ?? 30) } as never,
    { registerProcessor: vi.fn(), enqueue: vi.fn() } as never,
  );
  return { service, repo, sessions, blacklist, audit, oauthDelete };
}

describe('Phase4 WP29 · 用户数据导出纵切', () => {
  it('申请导出先落 pending，Worker 消费后转 completed 并写审计', async () => {
    const { service, redis, audit, drain } = buildService();

    const task = await service.exportData('uid-1', { format: 'json' });

    expect(task.status).toBe('pending');
    expect(task.downloadUrl).toBeNull();
    expect(task.sizeBytes).toBeNull();
    expect(redis.values.size).toBe(2); // lock + 任务元数据（data 还没生成）
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'uid-1', event: 'user_data_export_requested', isSuccess: true }),
    );

    await drain();

    const done = await service.getExportTask('uid-1', task.taskId);
    expect(done.status).toBe('completed');
    expect(done.downloadUrl).toBe(`/profile/me/export/${task.taskId}/download`);
    expect(done.sizeBytes).toBeGreaterThan(0);
    expect(done.completedAt).not.toBeNull();
  });

  it('采集失败 → 任务落 failed 可查询，下载 404，且不静默丢失', async () => {
    const { service, drain } = buildService({ failCollect: true });
    const task = await service.exportData('uid-1', { format: 'json' });

    await expect(drain()).rejects.toThrow('collector down');

    const failed = await service.getExportTask('uid-1', task.taskId);
    expect(failed.status).toBe('failed');
    expect(failed.downloadUrl).toBeNull();
    expect(failed.sizeBytes).toBeNull();
    await expect(service.getExportDownload('uid-1', task.taskId)).rejects.toMatchObject({ status: 404 });
  });

  it('同一用户 60s 内重复导出 → RateLimited', async () => {
    const { service } = buildService();
    await service.exportData('uid-1', { format: 'json' });

    await expect(service.exportData('uid-1', { format: 'json' })).rejects.toMatchObject({
      code: BizCode.RateLimited,
    });
    await expect(service.exportData('uid-1', { format: 'json' })).rejects.toBeInstanceOf(BizException);
  });

  it('查询 / 下载只允许任务所有者', async () => {
    const { service, drain } = buildService();
    const task = await service.exportData('uid-1', { format: 'json' });
    await drain();

    await expect(service.getExportTask('uid-2', task.taskId)).rejects.toMatchObject({ status: 404 });
    await expect(service.getExportDownload('uid-2', task.taskId)).rejects.toMatchObject({ status: 404 });
    await expect(service.getExportTask('uid-1', 'not-a-task')).rejects.toMatchObject({ status: 404 });
  });

  it('JSON 下载内容与采集载荷一致', async () => {
    const { service, drain } = buildService();
    const task = await service.exportData('uid-1', { format: 'json' });
    await drain();

    const file = await service.getExportDownload('uid-1', task.taskId);
    expect(file.contentType).toBe('application/json; charset=utf-8');
    expect(file.fileName.endsWith('.json')).toBe(true);
    const parsed = JSON.parse(file.body.toString('utf8'));
    expect(parsed.account.phone).toBe('13800000000');
    expect(parsed.schemaVersion).toBe('1.1');
  });

  it('ZIP 下载是合法单成员归档', async () => {
    const { service, drain } = buildService();
    const task = await service.exportData('uid-1', { format: 'zip' });
    await drain();

    const file = await service.getExportDownload('uid-1', task.taskId);
    expect(file.contentType).toBe('application/zip');
    expect(file.fileName.endsWith('.zip')).toBe(true);
    expect(file.body.subarray(0, 4).toString('hex')).toBe('504b0304');
    expect(file.body.subarray(-22).readUInt32LE(0)).toBe(101_010_256);
  });
});

describe('Phase4 WP29 · 删除账户纵切', () => {
  const confirmation = { confirmation: '确认删除', reason: '不想继续使用' };

  it('软删账号、撤销会话 / JWT、解绑 OAuth 并写审计', async () => {
    const { service, repo, sessions, blacklist, audit, oauthDelete } = buildDeletionService();

    const response = await service.deleteAccount('uid-del', confirmation);

    expect(response.status).toBe('deletion_requested');
    expect(new Date(response.deletedAt).getTime()).toBeLessThanOrEqual(Date.now());
    const purgeAt = new Date(response.purgeAt).getTime();
    expect(purgeAt - new Date(response.deletedAt).getTime()).toBe(30 * 24 * 60 * 60 * 1000);

    const saved = repo.save.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(saved).toMatchObject({
      uid: 'uid-del',
      state: UserState.Deleted,
      passwordHash: '!DELETED!',
      phone: null,
      email: null,
      emailVerifiedAt: null,
      phoneVerifiedAt: null,
    });
    expect(saved['deletedAt']).toBeInstanceOf(Date);

    expect(sessions.revokeAllByUserId).toHaveBeenCalledWith('uid-del');
    expect(blacklist.revokeMany).toHaveBeenCalledWith(['session-1', 'session-2']);
    expect(oauthDelete).toHaveBeenCalledWith({ userId: 'uid-del' });
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'uid-del',
        event: AuditEvent.UserAccountDeletionRequested,
        metadata: expect.objectContaining({ reason: '不想继续使用', sessionsRevoked: 2, retentionDays: 30 }),
        isSuccess: true,
      }),
    );
  });

  it('二次确认不匹配 → InvalidParameter，且不触碰账号与会话', async () => {
    const { service, repo, sessions, blacklist, oauthDelete } = buildDeletionService();

    await expect(service.deleteAccount('uid-del', { confirmation: '删除' })).rejects.toMatchObject({
      code: BizCode.InvalidParameter,
    });
    await expect(service.deleteAccount('uid-del', { confirmation: '删除' })).rejects.toBeInstanceOf(BizException);
    expect(repo.findOne).not.toHaveBeenCalled();
    expect(repo.save).not.toHaveBeenCalled();
    expect(sessions.revokeAllByUserId).not.toHaveBeenCalled();
    expect(blacklist.revokeMany).not.toHaveBeenCalled();
    expect(oauthDelete).not.toHaveBeenCalled();
  });

  it('用户不存在或已软删 → 404，不做任何写入', async () => {
    const { service, repo, sessions } = buildDeletionService({ user: null });

    await expect(service.deleteAccount('uid-del', confirmation)).rejects.toMatchObject({ status: 404 });
    expect(repo.save).not.toHaveBeenCalled();
    expect(sessions.revokeAllByUserId).not.toHaveBeenCalled();
  });

  it('自定义 retentionDays 决定 purgeAt', async () => {
    const { service } = buildDeletionService({ retentionDays: 7 });

    const response = await service.deleteAccount('uid-del', confirmation);
    const delta = new Date(response.purgeAt).getTime() - new Date(response.deletedAt).getTime();
    expect(delta).toBe(7 * 24 * 60 * 60 * 1000);
  });

  it('DeleteAccountDto 拒绝缺失或非字符串的 confirmation', async () => {
    const missing = await validate(plainToInstance(DeleteAccountDto, {}));
    expect(missing.some((error) => error.property === 'confirmation')).toBe(true);

    const nonString = await validate(plainToInstance(DeleteAccountDto, { confirmation: 123 }));
    expect(nonString.some((error) => error.property === 'confirmation')).toBe(true);

    const valid = await validate(plainToInstance(DeleteAccountDto, confirmation));
    expect(valid).toHaveLength(0);
  });
});

describe('导出归档字节层', () => {
  it('CRC-32 与标准向量一致', () => {
    expect(crc32(Buffer.from('123456789'))).toBe(3_421_780_262);
  });

  it('ZIP 中央目录指向唯一成员，且文件名正确', () => {
    const zip = buildSingleFileZip('xinsu-data.json', Buffer.from('{"a":1}'));
    const centralOffset = zip.subarray(-22).readUInt32LE(16);
    expect(zip.subarray(centralOffset, centralOffset + 4).toString('hex')).toBe('504b0102');
    const nameLength = zip.subarray(centralOffset + 28).readUInt16LE(0);
    const name = zip.subarray(centralOffset + 46, centralOffset + 46 + nameLength).toString('ascii');
    expect(name).toBe('xinsu-data.json');
    expect(zip.subarray(-22).readUInt16LE(10)).toBe(1);
  });

  it('format=json 时文件名带时间戳且内容可解析', () => {
    const built = buildExportArchive('json', { hello: '世界' }, new Date('2026-11-28T01:02:03Z'));
    expect(built.fileName).toBe('xinsu-export-20261128T010203.json');
    expect(JSON.parse(built.buffer.toString('utf8'))).toEqual({ hello: '世界' });
  });
});
