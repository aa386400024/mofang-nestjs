// AF-594: 同意前置校验正缓存回归.
//
// 目标: 已同意且当前版本的重复校验不再打 DB; 撤回时缓存失效.

import type { ConfigService } from '@nestjs/config';
import type { ConsentRepository, ConsentRow } from '../../src/consent/domain/repositories/consent.repository.js';
import { ConsentService } from '../../src/consent/providers/consent.service.js';
import type { RedisService } from '../../src/shared/infra/redis/redis.service.js';

function acceptedRow(): ConsentRow {
  return {
    id: 'consent-1',
    userId: 'u-1',
    deviceId: 'device-1',
    consentVersion: 'v1.0',
    consentType: 'ai_chat',
    platform: 'ios',
    appId: 'xinsu',
    acceptedAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ipAddress: '127.0.0.1',
    userAgent: 'test',
    metadata: null,
  };
}

function build() {
  const repo = {
    findLatestByUser: vi.fn().mockResolvedValue(acceptedRow()),
    findByIdempotentKey: vi.fn(),
    save: vi.fn(),
    deleteByUser: vi.fn().mockResolvedValue(1),
    findLatestByDevice: vi.fn(),
    bindDeviceToUser: vi.fn(),
  } as unknown as ConsentRepository;

  const cache = new Map<string, string>();
  const redis = {
    get: vi.fn(async (key: string) => cache.get(key) ?? null),
    set: vi.fn(async (key: string, value: string) => {
      cache.set(key, value);
      return 'OK';
    }),
    del: vi.fn(async (key: string) => {
      cache.delete(key);
      return 1;
    }),
  } as unknown as RedisService;

  const config = {
    get: vi.fn().mockReturnValue({ currentVersion: 'v1.0' }),
  } as unknown as ConfigService;

  const service = new ConsentService(repo, config, redis);
  return { service, repo, redis };
}

describe('AF-594 · consent 正缓存', () => {
  it('首次通过后写缓存, 第二次不再查 DB', async () => {
    const { service, repo, redis } = build();

    await service.assertAccepted('u-1', 'ai_chat');
    await service.assertAccepted('u-1', 'ai_chat');

    expect(repo.findLatestByUser).toHaveBeenCalledTimes(1);
    expect(redis.set).toHaveBeenCalledWith('consent:accepted:v1.0:ai_chat:u-1', '1', 300);
  });

  it('撤回时删除缓存, 下次重新查 DB', async () => {
    const { service, repo } = build();

    await service.assertAccepted('u-1', 'ai_chat');
    await service.withdraw('u-1', 'ai_chat');
    await service.assertAccepted('u-1', 'ai_chat');

    expect(repo.findLatestByUser).toHaveBeenCalledTimes(2);
  });

  it('未同意不写缓存 (避免绑定/补记录后仍命中旧否定)', async () => {
    const { service, repo, redis } = build();
    repo.findLatestByUser = vi.fn().mockResolvedValue(null);

    await expect(service.assertAccepted('u-1', 'ai_chat')).rejects.toBeDefined();
    expect(redis.set).not.toHaveBeenCalled();
  });
});
