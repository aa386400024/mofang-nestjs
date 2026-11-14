// V2026-11-14 治本 (TD-17 · C2 第一批仓储端口化 · consent 域 · P-DEBT-11 / L-1):
//   端口替身 spec —— consent service 用**端口替身**驱动: 不起真数据源, 不连 DB,
//   不 mock 持久化库. 替身只记调用参数 + 返回预设行.
//
//   覆盖:
//     ① record: 幂等四元组查重 + 首次写入行构造 (userId 留空 / metadata 归一) +
//        幂等命中只刷新审计三件套 (IP / UA / metadata) 且保留首写时间;
//     ② checkStatus: 无记录 / 版本匹配 / 版本不匹配 / 配置缺省回落;
//     ③ bindToUser: 批量回填参数与受影响行数;
//     ④ 调用次数口径 + 写入失败时的现有语义 (行为锁).
//
//   时间口径: 本 spec 不依赖任何定时器 —— 落库时刻由替身按**固定常量**回显,
//     所以断言不随真实时钟漂移.
//
//   替身写法: 直接实现端口 interface (跟 TD-13 analytics / TD-16 life-map 同款口径).
//   边界: **零** entity import、零 typeorm 值符号; 实体类名不出现在本文件.
//
//   验证: pnpm exec vitest run test/consent/td17-consent-port-c2-batch1.spec.ts
//   时间戳: 2026-11-14 GMT+8

import { describe, expect, it } from 'vitest';

import type {
  ConsentIdempotentKey,
  ConsentRepository,
  ConsentRow,
  SaveConsentInput,
} from '../../src/consent/domain/repositories/consent.repository.js';
import { ConsentService } from '../../src/consent/providers/consent.service.js';

/** 固定的"落库时刻" —— 替身回显用, 不随真实时钟漂移. */
const NOW = new Date('2026-11-14T00:00:00.000Z');

// ═════════════════════════════════════════════════════════════
// 行构造器
// ═════════════════════════════════════════════════════════════

/** 读路径返回的行 (可覆盖). */
function consentRow(overrides: Partial<ConsentRow> = {}): ConsentRow {
  return {
    id: 'consent-1',
    userId: null,
    deviceId: 'device-1',
    consentVersion: 'v1.0',
    consentType: 'agreement+privacy',
    platform: 'android',
    appId: 'xin_su',
    acceptedAt: NOW,
    updatedAt: NOW,
    ipAddress: 'ip-old',
    userAgent: 'ua-old',
    metadata: null,
    ...overrides,
  };
}

/** 写路径回显行 —— 由入参构造, 缺省时刻用固定常量. */
function rowFromInput(input: SaveConsentInput): ConsentRow {
  return {
    id: input.id ?? 'consent-new',
    userId: input.userId,
    deviceId: input.deviceId,
    consentVersion: input.consentVersion,
    consentType: input.consentType,
    platform: input.platform,
    appId: input.appId,
    acceptedAt: input.acceptedAt ?? NOW,
    updatedAt: input.updatedAt ?? NOW,
    ipAddress: input.ipAddress,
    userAgent: input.userAgent,
    metadata: input.metadata,
  };
}

// ═════════════════════════════════════════════════════════════
// 端口替身
// ═════════════════════════════════════════════════════════════

/** 同意记录端口替身. */
class ConsentRepoDouble {
  /** 幂等查重的入参序列. */
  readonly keyLookups: ConsentIdempotentKey[] = [];
  /** 最新一条查询的入参序列. */
  readonly latestLookups: { deviceId: string; consentType: string; appId: string }[] = [];
  /** 写入的入参序列. */
  readonly saves: SaveConsentInput[] = [];
  /** 批量回填的入参序列. */
  readonly binds: { deviceId: string; userId: string }[] = [];
  /** 幂等查重返回行 (缺省 null = 从未同意过). */
  existing: ConsentRow | null = null;
  /** 最新一条返回行 (缺省 null = 从未同意过). */
  latest: ConsentRow | null = null;
  /** 批量回填受影响行数 (缺省 0). */
  affected = 0;
  /** 注入给写入的失败 (测失败语义; null = 正常). */
  saveFailure: Error | null = null;

  readonly repo: ConsentRepository;

  constructor() {
    this.repo = {
      findByIdempotentKey: async (key: ConsentIdempotentKey): Promise<ConsentRow | null> => {
        this.keyLookups.push(key);
        return this.existing;
      },
      findLatestByDevice: async (deviceId: string, consentType: string, appId: string): Promise<ConsentRow | null> => {
        this.latestLookups.push({ deviceId, consentType, appId });
        return this.latest;
      },
      save: async (input: SaveConsentInput): Promise<ConsentRow> => {
        this.saves.push(input);
        if (this.saveFailure) {
          throw this.saveFailure;
        }
        return rowFromInput(input);
      },
      bindDeviceToUser: async (deviceId: string, userId: string): Promise<number> => {
        this.binds.push({ deviceId, userId });
        return this.affected;
      },
    };
  }
}

/** 配置服务替身 (按 key 返回值). */
function stubConfig(values: Record<string, unknown>): { get<T>(key: string): T | undefined } {
  return {
    get<T>(key: string): T | undefined {
      return values[key] as T | undefined;
    },
  };
}

/** 装配 service + 端口替身. */
function makeService(configValues: Record<string, unknown> = {}): { service: ConsentService; double: ConsentRepoDouble } {
  const double = new ConsentRepoDouble();
  return {
    service: new ConsentService(double.repo, stubConfig(configValues) as never),
    double,
  };
}

/**
 * 记录入参 (与 DTO 字段同构 —— 不 import DTO 类, 只按结构传).
 */
interface RecordInput {
  deviceId: string;
  consentVersion: string;
  consentType: string;
  platform: string;
  appId: string;
  metadata?: Record<string, unknown>;
}

/** 记录入参 (覆盖). */
function recordInput(overrides: Partial<RecordInput> = {}): RecordInput {
  return {
    deviceId: 'device-1',
    consentVersion: 'v1.0',
    consentType: 'agreement+privacy',
    platform: 'android',
    appId: 'xin_su',
    ...overrides,
  };
}

// ═════════════════════════════════════════════════════════════
// ① record
// ═════════════════════════════════════════════════════════════

describe('ConsentService · 端口替身 (TD-17 C2 第一批)', () => {
  it('A1 · record 首次写入 —— 查重四元组 + 行构造 (userId 留空 / metadata 归一)', async () => {
    const { service, double } = makeService();

    await service.record(recordInput(), { ipAddress: 'ip-new', userAgent: 'ua-new' });

    // 幂等查重: 四元组逐字透传
    expect(double.keyLookups).toEqual([
      { deviceId: 'device-1', consentVersion: 'v1.0', consentType: 'agreement+privacy', appId: 'xin_su' },
    ]);
    // 首次写入: 游客态 userId 留空, metadata 缺省归一为 null, 不带 id / 首写时刻
    expect(double.saves).toHaveLength(1);
    expect(double.saves[0]).toEqual({
      userId: null,
      deviceId: 'device-1',
      consentVersion: 'v1.0',
      consentType: 'agreement+privacy',
      platform: 'android',
      appId: 'xin_su',
      ipAddress: 'ip-new',
      userAgent: 'ua-new',
      metadata: null,
    });
    expect(double.saves[0]?.id).toBeUndefined();
    expect(double.saves[0]?.acceptedAt).toBeUndefined();
  });

  it('A2 · record 首次写入 —— 返回落库行的 id + acceptedAt', async () => {
    const { service } = makeService();

    const result = await service.record(recordInput(), { ipAddress: 'ip-new', userAgent: 'ua-new' });

    expect(result.id).toBe('consent-new');
    expect(result.acceptedAt).toBe(NOW);
  });

  it('A3 · record 幂等命中 —— 只刷新审计三件套, 保留首写时刻与用户绑定', async () => {
    const { service, double } = makeService();
    const acceptedAt = new Date('2026-01-01T00:00:00.000Z');
    const updatedAt = new Date('2026-02-01T00:00:00.000Z');
    double.existing = consentRow({
      id: 'consent-42',
      userId: 'user-7',
      acceptedAt,
      updatedAt,
      ipAddress: 'ip-old',
      userAgent: 'ua-old',
      metadata: { lang: 'zh-CN' },
    });

    const result = await service.record(recordInput(), { ipAddress: 'ip-new', userAgent: 'ua-new' });

    expect(double.saves).toHaveLength(1);
    expect(double.saves[0]).toEqual({
      id: 'consent-42',
      userId: 'user-7',
      deviceId: 'device-1',
      consentVersion: 'v1.0',
      consentType: 'agreement+privacy',
      platform: 'android',
      appId: 'xin_su',
      acceptedAt,
      updatedAt,
      ipAddress: 'ip-new',
      userAgent: 'ua-new',
      metadata: { lang: 'zh-CN' },
    });
    // 返回的仍是原行 id + 原首写时间
    expect(result.id).toBe('consent-42');
    expect(result.acceptedAt).toBe(acceptedAt);
  });

  it('A4 · record 幂等命中且 metadata 未定义 —— 保留原 metadata', async () => {
    const { service, double } = makeService();
    double.existing = consentRow({ metadata: { lang: 'zh-CN' } });

    await service.record(recordInput(), { ipAddress: 'ip-new', userAgent: 'ua-new' });

    expect(double.saves[0]?.metadata).toEqual({ lang: 'zh-CN' });
  });

  it('A5 · record 幂等命中且 metadata 显式给 —— 覆盖原 metadata', async () => {
    const { service, double } = makeService();
    double.existing = consentRow({ metadata: { lang: 'zh-CN' } });

    await service.record(recordInput({ metadata: { lang: 'en-US' } }), {
      ipAddress: 'ip-new',
      userAgent: 'ua-new',
    });

    expect(double.saves[0]?.metadata).toEqual({ lang: 'en-US' });
  });

  // ═════════════════════════════════════════════════════════════
  // ② checkStatus
  // ═════════════════════════════════════════════════════════════

  it('A6 · checkStatus 无记录 —— hasAccepted false / needReaccept true', async () => {
    const { service, double } = makeService({ consent: { currentVersion: 'v2.0' } });
    double.latest = null;

    const status = await service.checkStatus('device-1', 'agreement+privacy', 'xin_su');

    expect(status).toEqual({
      hasAccepted: false,
      needReaccept: true,
      currentVersion: 'v2.0',
    });
    expect(double.latestLookups).toEqual([{ deviceId: 'device-1', consentType: 'agreement+privacy', appId: 'xin_su' }]);
  });

  it('A7 · checkStatus 版本匹配 —— needReaccept false + 返回同意时间与版本', async () => {
    const { service, double } = makeService({ consent: { currentVersion: 'v2.0' } });
    double.latest = consentRow({ consentVersion: 'v2.0', acceptedAt: NOW });

    const status = await service.checkStatus('device-1', 'agreement+privacy', 'xin_su');

    expect(status).toEqual({
      hasAccepted: true,
      acceptedAt: NOW.toISOString(),
      consentVersion: 'v2.0',
      needReaccept: false,
      currentVersion: 'v2.0',
    });
  });

  it('A8 · checkStatus 版本不匹配 —— needReaccept true (服务端强制重弹)', async () => {
    const { service, double } = makeService({ consent: { currentVersion: 'v2.0' } });
    double.latest = consentRow({ consentVersion: 'v1.0' });

    const status = await service.checkStatus('device-1', 'agreement+privacy', 'xin_su');

    expect(status.hasAccepted).toBe(true);
    expect(status.needReaccept).toBe(true);
    expect(status.consentVersion).toBe('v1.0');
    expect(status.currentVersion).toBe('v2.0');
  });

  it('A9 · checkStatus 未配版本 —— 回落 v1.0', async () => {
    const { service, double } = makeService({});
    double.latest = consentRow({ consentVersion: 'v1.0' });

    const status = await service.checkStatus('device-1', 'agreement+privacy', 'xin_su');

    expect(status.currentVersion).toBe('v1.0');
    expect(status.needReaccept).toBe(false);
  });

  // ═════════════════════════════════════════════════════════════
  // ③ bindToUser
  // ═════════════════════════════════════════════════════════════

  it('A10 · bindToUser —— 回填参数透传 + 返回受影响行数', async () => {
    const { service, double } = makeService();
    double.affected = 3;

    const affected = await service.bindToUser('device-1', 'user-7');

    expect(affected).toBe(3);
    expect(double.binds).toEqual([{ deviceId: 'device-1', userId: 'user-7' }]);
  });

  it('A11 · bindToUser 无命中 —— 返回 0', async () => {
    const { service, double } = makeService();
    double.affected = 0;

    const affected = await service.bindToUser('device-1', 'user-7');

    expect(affected).toBe(0);
  });

  // ═════════════════════════════════════════════════════════════
  // ④ 调用次数 + 失败语义
  // ═════════════════════════════════════════════════════════════

  it('A12 · 调用次数口径 —— 查重 1 次 / 写入 1 次 / 最新查询 1 次', async () => {
    const { service, double } = makeService();

    await service.record(recordInput(), { ipAddress: 'ip-new', userAgent: 'ua-new' });
    await service.checkStatus('device-1', 'agreement+privacy', 'xin_su');

    expect(double.keyLookups).toHaveLength(1);
    expect(double.saves).toHaveLength(1);
    expect(double.latestLookups).toHaveLength(1);
  });

  it('A13 · 写入失败时的现有语义 —— 异常上抛 (行为锁, 与类注释不一致登记为另案 P)', async () => {
    const { service, double } = makeService();
    double.saveFailure = new Error('db down');

    await expect(service.record(recordInput(), { ipAddress: 'ip-new', userAgent: 'ua-new' })).rejects.toThrow('db down');
  });
});
