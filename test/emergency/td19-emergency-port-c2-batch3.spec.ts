// V2026-11-15 治本 (TD-19 · C2 第三批仓储端口化 · emergency 域 · P-DEBT-11 / L-1):
//   端口替身 spec —— emergency service 用**端口替身**驱动: 不起真数据源, 不连 DB,
//   不 mock 持久化库. 替身只记调用参数 + 返回预设行.
//
//   覆盖:
//     ① upsert: 入参逐字透传 (行纯对象构造) + 回读未命中抛错 (判定留 service);
//     ② list: uid / sinceMs / limit 参数形态 + items+total 组装留 service;
//     ③ getOne: id + uid 双条件越权隔离 + 未命中返 null;
//     ④ getToolStats: 窗口换算 (windowDays → sinceMs) 留 service + 统计行原样返回;
//     ⑤ DTO 转换: 响应层 Number(...) 时间戳转换留 service;
//     ⑥ 调用次数口径 + 写入失败时的现有语义 (行为锁) + 端口方法面恰为 4 个.
//
//   时间口径: 本 spec 不依赖任何定时器 —— 回显时刻由替身按**固定常量**给出,
//     所以断言不随真实时钟漂移 (窗口换算用相对容差断言).
//
//   替身写法: 直接实现端口 interface (跟 TD-13 analytics / TD-16 life-map / TD-17 consent /
//     TD-18 good_state_diary 同款口径).
//   边界: **零** entity import、零 typeorm 值符号; 实体类名不出现在本文件.
//
//   分工: 本 spec 锁**端口契约** (调用面 / 参数 / 出参形状); 业务行为 (窗口换算 /
//     越权隔离 / DTO 转换) 由本文件一并锁住 (本域零既有 spec, 业务行为无别处可锁).
//
//   验证: pnpm exec vitest run test/emergency/td19-emergency-port-c2-batch3.spec.ts
//   时间戳: 2026-11-15 GMT+8

import { describe, expect, it } from 'vitest';

import {
  EMERGENCY_SESSION_REPOSITORY,
  type EmergencySessionListQuery,
  type EmergencySessionRepository,
  type EmergencySessionRow,
  type EmergencyToolStatRow,
  type UpsertEmergencySessionInput,
} from '../../src/emergency/domain/repositories/emergency-session.repository.js';
import type { UpsertEmergencySessionDto } from '../../src/emergency/dto/emergency.dto.js';
import { EmergencyToolKind, SessionPhase } from '../../src/emergency/enums/emergency.enums.js';
import { EmergencyService } from '../../src/emergency/providers/emergency.service.js';

/** 固定的"落库时刻" —— 替身回显用, 不随真实时钟漂移. */
const NOW = new Date('2026-11-15T00:00:00.000Z');

/** 一天毫秒数 —— 窗口换算断言用. */
const DAY_MS = 24 * 60 * 60 * 1000;

// ═════════════════════════════════════════════════════════════
// 行构造器
// ═════════════════════════════════════════════════════════════

/** 读路径返回的行 (可覆盖). */
function emergencySessionRow(overrides: Partial<EmergencySessionRow> = {}): EmergencySessionRow {
  return {
    id: 'sess-1',
    uid: 'uid-1',
    toolKind: EmergencyToolKind.GROUNDING_54321,
    phase: SessionPhase.COMPLETED,
    intensityBefore: 5,
    intensityAfter: 2,
    stagesCompleted: 5,
    startedAtMs: '1725432100123',
    completedAtMs: '1725432160000',
    notes: 'note',
    context: { client: 'android' },
    createdAt: NOW,
    ...overrides,
  };
}

/** 写路径回显行 —— 由入参构造, 缺省时刻用固定常量. */
function rowFromUpsertInput(input: UpsertEmergencySessionInput): EmergencySessionRow {
  return {
    id: input.id,
    uid: input.uid,
    toolKind: input.toolKind,
    phase: input.phase,
    intensityBefore: input.intensityBefore,
    intensityAfter: input.intensityAfter,
    stagesCompleted: input.stagesCompleted,
    startedAtMs: input.startedAtMs.toString(),
    completedAtMs: input.completedAtMs === null ? null : input.completedAtMs.toString(),
    notes: input.notes,
    context: input.context,
    createdAt: NOW,
  };
}

/** 上报入参 (结构同 DTO —— 不 import DTO 类构造, 只按结构传). */
function upsertDto(overrides: Partial<UpsertEmergencySessionDto> = {}): UpsertEmergencySessionDto {
  return {
    id: 'sess-1',
    toolKind: EmergencyToolKind.GROUNDING_54321,
    phase: SessionPhase.COMPLETED,
    intensityBefore: 5,
    intensityAfter: 2,
    stagesCompleted: 5,
    startedAtMs: 1_725_432_100_123,
    completedAtMs: 1_725_432_160_000,
    notes: 'note',
    context: { client: 'android' },
    ...overrides,
  };
}

// ═════════════════════════════════════════════════════════════
// 端口替身
// ═════════════════════════════════════════════════════════════

/** 急救会话端口替身 —— 只记调用参数 + 返回预设行. */
class EmergencyRepoDouble {
  /** upsert 的入参序列. */
  readonly upserts: UpsertEmergencySessionInput[] = [];
  /** findById 的入参序列. */
  readonly findByIdCalls: { id: string; uid?: string }[] = [];
  /** list 的入参序列. */
  readonly listCalls: { uid: string; query?: EmergencySessionListQuery }[] = [];
  /** aggregateToolStats 的入参序列. */
  readonly statsCalls: { uid: string; sinceMs: number }[] = [];

  /** upsert 回读结果 (null = 回读未命中 → service 抛错). */
  upsertResult: EmergencySessionRow | null = null;
  /** findById 返回行 (缺省 null). */
  found: EmergencySessionRow | null = null;
  /** list 返回行. */
  rows: EmergencySessionRow[] = [];
  /** 聚合统计返回行. */
  stats: EmergencyToolStatRow[] = [];
  /** 注入给写入的失败 (测失败语义; null = 正常). */
  writeFailure: Error | null = null;

  readonly repo: EmergencySessionRepository;

  constructor() {
    this.repo = {
      upsert: async (input: UpsertEmergencySessionInput): Promise<EmergencySessionRow | null> => {
        this.upserts.push(input);
        if (this.writeFailure) {
          throw this.writeFailure;
        }
        return this.upsertResult;
      },
      findById: async (id: string, uid?: string): Promise<EmergencySessionRow | null> => {
        this.findByIdCalls.push({ id, uid });
        return this.found;
      },
      list: async (uid: string, query?: EmergencySessionListQuery): Promise<EmergencySessionRow[]> => {
        this.listCalls.push({ uid, query });
        return this.rows;
      },
      aggregateToolStats: async (uid: string, sinceMs: number): Promise<EmergencyToolStatRow[]> => {
        this.statsCalls.push({ uid, sinceMs });
        return this.stats;
      },
    };
  }
}

/** 装配 service + 端口替身. */
function makeService(): { service: EmergencyService; double: EmergencyRepoDouble } {
  const double = new EmergencyRepoDouble();
  return { service: new EmergencyService(double.repo), double };
}

// ═════════════════════════════════════════════════════════════
// ① upsert
// ═════════════════════════════════════════════════════════════

describe('EmergencyService · 端口替身 (TD-19 C2 第三批)', () => {
  it('A1 · upsert —— 入参逐字透传 (行纯对象构造, service 侧零工厂依赖)', async () => {
    const { service, double } = makeService();
    double.upsertResult = rowFromUpsertInput({
      id: 'sess-1',
      uid: 'uid-1',
      toolKind: EmergencyToolKind.GROUNDING_54321,
      phase: SessionPhase.COMPLETED,
      intensityBefore: 5,
      intensityAfter: 2,
      stagesCompleted: 5,
      startedAtMs: 1_725_432_100_123,
      completedAtMs: 1_725_432_160_000,
      notes: 'note',
      context: { client: 'android' },
    });

    const result = await service.upsert('uid-1', upsertDto());

    expect(double.upserts).toHaveLength(1);
    expect(double.upserts[0]).toEqual({
      id: 'sess-1',
      uid: 'uid-1',
      toolKind: EmergencyToolKind.GROUNDING_54321,
      phase: SessionPhase.COMPLETED,
      intensityBefore: 5,
      intensityAfter: 2,
      stagesCompleted: 5,
      startedAtMs: 1_725_432_100_123,
      completedAtMs: 1_725_432_160_000,
      notes: 'note',
      context: { client: 'android' },
    });
    expect(result.id).toBe('sess-1');
    expect(result.uid).toBe('uid-1');
  });

  it('A2 · upsert 回读未命中 —— 端口返 null, service 抛错 (判定留 service, 行为锁)', async () => {
    const { service, double } = makeService();
    double.upsertResult = null;

    await expect(service.upsert('uid-1', upsertDto())).rejects.toThrow('Emergency session upsert failed id=sess-1');
  });

  it('A3 · upsert 的 context 为 null —— 原样透传给端口 (序列化兜底在实现层)', async () => {
    const { service, double } = makeService();
    double.upsertResult = emergencySessionRow({ context: null });

    await service.upsert('uid-1', upsertDto({ context: null }));

    expect(double.upserts[0]?.context).toBeNull();
  });

  // ═════════════════════════════════════════════════════════════
  // ② list
  // ═════════════════════════════════════════════════════════════

  it('A4 · list —— 端口收 uid + 查询入参, items+total 组装留 service', async () => {
    const { service, double } = makeService();
    double.rows = [emergencySessionRow({ id: 'sess-1' }), emergencySessionRow({ id: 'sess-2' })];

    const page = await service.list('uid-1');

    expect(double.listCalls).toHaveLength(1);
    expect(double.listCalls[0]?.uid).toBe('uid-1');
    // 未传过滤 / 上限 → 端口收到 undefined (默认上限 100 的口径在实现层)
    expect(double.listCalls[0]?.query?.sinceMs).toBeUndefined();
    expect(double.listCalls[0]?.query?.limit).toBeUndefined();
    expect(page.items).toHaveLength(2);
    expect(page.total).toBe(2);
  });

  it('A5 · list 带 sinceMs / limit —— 原样透传给端口', async () => {
    const { service, double } = makeService();

    await service.list('uid-1', { sinceMs: 1_725_432_100_123, limit: 20 });

    expect(double.listCalls[0]?.query?.sinceMs).toBe(1_725_432_100_123);
    expect(double.listCalls[0]?.query?.limit).toBe(20);
  });

  it('A6 · list 空结果 —— total 0 + items 空数组', async () => {
    const { service, double } = makeService();
    double.rows = [];

    const page = await service.list('uid-1');

    expect(page.total).toBe(0);
    expect(page.items).toEqual([]);
  });

  // ═════════════════════════════════════════════════════════════
  // ③ getOne
  // ═════════════════════════════════════════════════════════════

  it('A7 · getOne —— 端口收 id + uid 双条件 (越权隔离口径)', async () => {
    const { service, double } = makeService();
    double.found = emergencySessionRow();

    const result = await service.getOne('uid-1', 'sess-1');

    expect(double.findByIdCalls).toHaveLength(1);
    expect(double.findByIdCalls[0]?.id).toBe('sess-1');
    expect(double.findByIdCalls[0]?.uid).toBe('uid-1');
    expect(result?.id).toBe('sess-1');
  });

  it('A8 · getOne 未命中 —— 返回 null (不抛错)', async () => {
    const { service, double } = makeService();
    double.found = null;

    const result = await service.getOne('uid-1', 'missing');

    expect(result).toBeNull();
  });

  // ═════════════════════════════════════════════════════════════
  // ④ getToolStats
  // ═════════════════════════════════════════════════════════════

  it('A9 · getToolStats —— 窗口换算留 service (默认 30 天), 端口收 sinceMs', async () => {
    const { service, double } = makeService();
    double.stats = [{ toolKind: 'grounding_54321', sampleCount: 3, avgIntensityDelta: -1.5, completionRate: 1 }];

    const stats = await service.getToolStats('uid-1');

    expect(double.statsCalls).toHaveLength(1);
    expect(double.statsCalls[0]?.uid).toBe('uid-1');
    const sinceMs = double.statsCalls[0]?.sinceMs ?? 0;
    expect(Math.abs(Date.now() - sinceMs - 30 * DAY_MS)).toBeLessThan(5000);
    expect(stats).toEqual(double.stats);
  });

  it('A10 · getToolStats 显式 windowDays —— sinceMs 相应前移', async () => {
    const { service, double } = makeService();

    await service.getToolStats('uid-1', 7);

    const sinceMs = double.statsCalls[0]?.sinceMs ?? 0;
    expect(Math.abs(Date.now() - sinceMs - 7 * DAY_MS)).toBeLessThan(5000);
  });

  it('A11 · getToolStats —— 统计行原样返回 (snake_case→camelCase 与数值化在实现层)', async () => {
    const { service, double } = makeService();
    double.stats = [{ toolKind: 'grounding_54321', sampleCount: 3, avgIntensityDelta: null, completionRate: 2 / 3 }];

    const stats = await service.getToolStats('uid-1');

    expect(stats[0]?.toolKind).toBe('grounding_54321');
    expect(stats[0]?.sampleCount).toBe(3);
    // 全无评分时 AVG 返 NULL 的兜底口径: null 原样透出, 不被转成 0
    expect(stats[0]?.avgIntensityDelta).toBeNull();
    expect(stats[0]?.completionRate).toBeCloseTo(2 / 3, 6);
  });

  // ═════════════════════════════════════════════════════════════
  // ⑤ DTO 转换
  // ═════════════════════════════════════════════════════════════

  it('A12 · DTO 转换 —— 响应层 Number(...) 时间戳转换留 service', async () => {
    const { service, double } = makeService();
    double.found = emergencySessionRow({ startedAtMs: '1725432100123', completedAtMs: '1725432160000' });

    const result = await service.getOne('uid-1', 'sess-1');

    expect(result?.startedAtMs).toBe(1_725_432_100_123);
    expect(result?.completedAtMs).toBe(1_725_432_160_000);
  });

  it('A13 · DTO 转换 —— completedAtMs 为空时保持 null', async () => {
    const { service, double } = makeService();
    double.found = emergencySessionRow({ completedAtMs: null });

    const result = await service.getOne('uid-1', 'sess-1');

    expect(result?.completedAtMs).toBeNull();
  });

  // ═════════════════════════════════════════════════════════════
  // ⑥ 调用次数 / 方法面 / 失败语义
  // ═════════════════════════════════════════════════════════════

  it('A14 · 调用次数口径 —— 每个端口方法各调一次', async () => {
    const { service, double } = makeService();
    double.upsertResult = emergencySessionRow();
    double.found = emergencySessionRow();
    double.rows = [emergencySessionRow()];
    double.stats = [];

    await service.upsert('uid-1', upsertDto());
    await service.list('uid-1');
    await service.getOne('uid-1', 'sess-1');
    await service.getToolStats('uid-1');

    expect(double.upserts).toHaveLength(1);
    expect(double.listCalls).toHaveLength(1);
    expect(double.findByIdCalls).toHaveLength(1);
    expect(double.statsCalls).toHaveLength(1);
  });

  it('A15 · 方法面不泛化 —— 端口方法恰为 4 个, 无通用仓储代理', () => {
    const { double } = makeService();

    expect(Object.keys(double.repo).sort()).toEqual(['aggregateToolStats', 'findById', 'list', 'upsert']);
    expect(typeof EMERGENCY_SESSION_REPOSITORY).toBe('symbol');
    expect(EMERGENCY_SESSION_REPOSITORY.description).toBe('EMERGENCY_SESSION_REPOSITORY');
  });

  it('A16 · 写入失败时的现有语义 —— 异常上抛 (行为锁)', async () => {
    const { service, double } = makeService();
    double.writeFailure = new Error('db down');

    await expect(service.upsert('uid-1', upsertDto())).rejects.toThrow('db down');
  });
});
