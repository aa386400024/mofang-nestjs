import { describe, expect, it, vi } from 'vitest';

import {
  EXPORT_INCLUDED_DOMAINS,
  EXPORT_PENDING_DOMAINS,
  EXPORT_SCHEMA_VERSION,
  UserDataExportCollector,
} from '../../src/profile/providers/user-data-export.collector.js';
import { User } from '../../src/user/entities/user.entity.js';

interface RepoStub {
  findOne: ReturnType<typeof vi.fn>;
  find: ReturnType<typeof vi.fn>;
}

/** 按 entity 类名返回桩仓储；findOne / find 的结果由 map 决定. */
function buildCollector() {
  const rows = new Map<string, unknown>();
  const lists = new Map<string, unknown[]>();
  const calls: { name: string; method: string; args: unknown }[] = [];

  const dataSource = {
    getRepository: (entity: { name: string }): RepoStub => ({
      findOne: vi.fn(async (args: unknown) => {
        calls.push({ name: entity.name, method: 'findOne', args });
        return rows.get(entity.name) ?? null;
      }),
      find: vi.fn(async (args: unknown) => {
        calls.push({ name: entity.name, method: 'find', args });
        return lists.get(entity.name) ?? [];
      }),
    }),
  };
  const collector = new UserDataExportCollector(dataSource as never);
  return { collector, rows, lists, calls };
}

function baseUser(): User {
  return {
    uid: 'uid-1',
    phone: '13800000000',
    email: 'a@b.com',
    state: 'active',
    passwordHash: '!SECRET!',
    failedLoginCount: 3,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-02T00:00:00Z'),
    lastLoginAt: null,
    emailVerifiedAt: null,
    phoneVerifiedAt: null,
    deletedAt: null,
  } as User;
}

describe('Phase4 WP29 · 用户数据导出采集器', () => {
  it('只导出白名单账号字段，不泄露密码哈希与风控计数', async () => {
    const { collector, rows } = buildCollector();
    rows.set('User', baseUser());

    const payload = await collector.collect('uid-1');

    expect(payload.schemaVersion).toBe(EXPORT_SCHEMA_VERSION);
    expect(payload.scope.includedDomains).toEqual(EXPORT_INCLUDED_DOMAINS);
    expect(payload.scope.pendingDomains).toEqual(EXPORT_PENDING_DOMAINS);
    expect(payload.account).toMatchObject({ uid: 'uid-1', phone: '13800000000' });
    expect(payload.account).not.toHaveProperty('passwordHash');
    expect(payload.account).not.toHaveProperty('failedLoginCount');
  });

  it('按 uid 查一对一表，按双方关系查陪伴数据', async () => {
    const { collector, rows, lists, calls } = buildCollector();
    rows.set('User', baseUser());
    rows.set('UserProfile', { uid: 'uid-1', nickname: '小林' });
    rows.set('Membership', { uid: 'uid-1', tier: 'plus' });
    lists.set('CompanionRecord', [{ id: 'r1', companionUid: 'uid-1' }]);
    lists.set('ConsentSignature', [{ id: 'c1', uid: 'uid-1' }]);

    const payload = await collector.collect('uid-1');

    expect(payload.profile).toEqual({ uid: 'uid-1', nickname: '小林' });
    expect(payload.membership).toEqual({ uid: 'uid-1', tier: 'plus' });
    expect(payload.companionRecords).toEqual([{ id: 'r1', companionUid: 'uid-1' }]);
    expect(payload.consentSignatures).toEqual([{ id: 'c1', uid: 'uid-1' }]);

    const profileCall = calls.find((call) => call.name === 'UserProfile' && call.method === 'findOne');
    expect(profileCall?.args).toEqual({ where: { uid: 'uid-1' } });
    const recordCall = calls.find((call) => call.name === 'CompanionRecord' && call.method === 'find');
    expect(recordCall?.args).toEqual({ where: [{ companionUid: 'uid-1' }, { companionToUid: 'uid-1' }] });
  });

  it('用户不存在时账号为 null，但其他空域仍返回空结构', async () => {
    const { collector } = buildCollector();
    const payload = await collector.collect('missing');
    expect(payload.account).toBeNull();
    expect(payload.profile).toBeNull();
    expect(payload.companionBindings).toEqual([]);
    expect(payload.selfcareRecords).toEqual([]);
  });

  it('十张 profile 表全部被访问（防漏表）', async () => {
    const { collector, rows, calls } = buildCollector();
    rows.set('User', baseUser());
    await collector.collect('uid-1');
    const visited = new Set(calls.map((call) => call.name));
    for (const entity of [
      'User',
      'UserProfile',
      'NotificationSettings',
      'Membership',
      'Certification',
      'BurnoutSettings',
      'CompanionBinding',
      'CompanionRecord',
      'SelfcareRecord',
      'ConsentSignature',
      'PrivacyAuthorization',
    ]) {
      expect(visited.has(entity), `${entity} 未被采集`).toBe(true);
    }
  });
});
