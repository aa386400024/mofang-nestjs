import { describe, expect, it, vi } from 'vitest';

import { BizCode } from '../../src/common/exceptions/biz-code.enum.js';
import { BizException } from '../../src/common/exceptions/biz.exception.js';
import { buildExportArchive, buildSingleFileZip, crc32 } from '../../src/profile/providers/export-archive.js';
import { ExportService } from '../../src/profile/providers/export.service.js';
import type { UserDataExportPayload } from '../../src/profile/providers/user-data-export.collector.js';

/** 最小导出载荷（真实采集器在 collector 单测里覆盖）. */
function samplePayload(): UserDataExportPayload {
  return {
    schemaVersion: '1.0',
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

function buildService() {
  const redis = fakeRedis();
  const collector = { collect: vi.fn(async () => samplePayload()) };
  const audit = { log: vi.fn(async () => ({})) };
  const service = new ExportService(
    { findOne: vi.fn() } as never,
    { revokeAllByUserId: vi.fn() } as never,
    { revokeMany: vi.fn() } as never,
    audit as never,
    collector as never,
    redis as never,
    { get: vi.fn(() => 30) } as never,
  );
  return { service, redis, collector, audit };
}

describe('Phase4 WP29 · 用户数据导出纵切', () => {
  it('导出完成态返回任务、下载地址与真实字节数，并写审计', async () => {
    const { service, redis, audit } = buildService();

    const task = await service.exportData('uid-1', { format: 'json' });

    expect(task.status).toBe('completed');
    expect(task.downloadUrl).toBe(`/profile/me/export/${task.taskId}/download`);
    expect(task.sizeBytes).toBeGreaterThan(0);
    expect(task.completedAt).not.toBeNull();
    expect(redis.values.size).toBe(3); // lock + task + data
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'uid-1', event: 'user_data_export_requested', isSuccess: true }),
    );
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
    const { service } = buildService();
    const task = await service.exportData('uid-1', { format: 'json' });

    await expect(service.getExportTask('uid-2', task.taskId)).rejects.toMatchObject({ status: 404 });
    await expect(service.getExportDownload('uid-2', task.taskId)).rejects.toMatchObject({ status: 404 });
    await expect(service.getExportTask('uid-1', 'not-a-task')).rejects.toMatchObject({ status: 404 });
  });

  it('JSON 下载内容与采集载荷一致', async () => {
    const { service } = buildService();
    const task = await service.exportData('uid-1', { format: 'json' });

    const file = await service.getExportDownload('uid-1', task.taskId);
    expect(file.contentType).toBe('application/json; charset=utf-8');
    expect(file.fileName.endsWith('.json')).toBe(true);
    const parsed = JSON.parse(file.body.toString('utf8'));
    expect(parsed.account.phone).toBe('13800000000');
    expect(parsed.schemaVersion).toBe('1.0');
  });

  it('ZIP 下载是合法单成员归档', async () => {
    const { service } = buildService();
    const task = await service.exportData('uid-1', { format: 'zip' });

    const file = await service.getExportDownload('uid-1', task.taskId);
    expect(file.contentType).toBe('application/zip');
    expect(file.fileName.endsWith('.zip')).toBe(true);
    expect(file.body.subarray(0, 4).toString('hex')).toBe('504b0304');
    expect(file.body.subarray(-22).readUInt32LE(0)).toBe(101_010_256);
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
