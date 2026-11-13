// V2026-11-11 治本 (WP-N · 标注台批次化 — 端点契约与服务行为单测):
//   覆盖:
//     ① 端点路由清单 + class 级 AdminRoleGuard 继承;
//     ② ref 双解析 (标注行 id / debug_session_id / 场次表反查);
//     ③ batchId 非法 → 400;
//     ④ 读不写: GET 未建行时**不产生 DB 行**;
//     ⑤ upsert 幂等: 同一 debugSessionId 连 PUT 两次 → 仍一行, 归属列不动;
//     ⑥ 冻结读优先: 冻结副本与活文件内容不同 → 读到冻结; 两者都无 → missing;
//     ⑦ 全局口径: batchId 省略时已落库行保留, 未标注可标注场次补 id=null 派生行;
//     ⑧ 合规: 列表 / 批次 / 一致性响应里**不存在**逐字稿正文.
//
//   全 mock: 不起 Nest 容器, 不连 DB, 不发网络.
//
//   验证: pnpm exec vitest run test/quality/quality-annotation-batch-contract.spec.ts
//   时间戳: 2026-11-11 GMT+8

import { RequestMethod } from '@nestjs/common';
import { GUARDS_METADATA, METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildQualityAnnotationRow } from './quality-annotation-fixtures.js';
import { AdminRoleGuard } from '../../src/admin-debug/guards/admin-role.guard.js';
import { BizCode } from '../../src/common/exceptions/biz-code.enum.js';
import { sortBatchSessions, type BatchSessionFact } from '../../src/quality/quality-annotation-batch.js';
import type { BatchFactRow } from '../../src/quality/quality-annotation-batch.service.js';
import { QualityAnnotationController } from '../../src/quality/quality-annotation.controller.js';
import { QualityAnnotationEntity } from '../../src/quality/quality-annotation.entity.js';
import { QualityAnnotationService } from '../../src/quality/quality-annotation.service.js';
import { QualityTranscriptFreeze, type TranscriptRecord } from '../../src/quality/quality-transcript-freeze.js';

/**
 * 收集控制器上的路由 + 每个路由的**有效** guard 集合 (class 级 + method 级).
 *
 * @param target 控制器
 * @returns 路由清单
 */
function collectRoutes(target: unknown): { readonly path: string; readonly method: number; readonly guards: unknown[] }[] {
  const prototype = (target as { prototype: unknown }).prototype;
  const classGuards = (Reflect.getMetadata(GUARDS_METADATA, target as object) as unknown[] | undefined) ?? [];
  const routes: { path: string; method: number; guards: unknown[] }[] = [];
  for (const name of Object.getOwnPropertyNames(prototype)) {
    if (name === 'constructor') continue;
    const handler = (prototype as Record<string, unknown>)[name];
    if (typeof handler !== 'function') continue;
    const path = Reflect.getMetadata(PATH_METADATA, handler) as string | undefined;
    if (path === undefined) continue;
    const method = Reflect.getMetadata(METHOD_METADATA, handler) as number | undefined;
    const methodGuards = (Reflect.getMetadata(GUARDS_METADATA, handler) as unknown[] | undefined) ?? [];
    routes.push({ path, method: method ?? RequestMethod.GET, guards: [...classGuards, ...methodGuards] });
  }
  return routes;
}

/**
 * 内存版标注仓储 (只实现 service 用到的方法).
 */
class StubRepo {
  readonly rows: QualityAnnotationEntity[] = [];

  async find(): Promise<QualityAnnotationEntity[]> {
    return [...this.rows];
  }

  async findOne(options: {
    readonly where: { readonly id?: string; readonly debugSessionId?: string };
  }): Promise<QualityAnnotationEntity | null> {
    const where = options.where;
    if (where.id !== undefined) return this.rows.find((row) => row.id === where.id) ?? null;
    if (where.debugSessionId !== undefined) return this.rows.find((row) => row.debugSessionId === where.debugSessionId) ?? null;
    return null;
  }

  async save(entity: Partial<QualityAnnotationEntity> & { id: string }): Promise<QualityAnnotationEntity> {
    const index = this.rows.findIndex((row) => row.id === entity.id);
    const base = index === -1 ? makeRow({ id: entity.id }) : this.rows[index];
    const merged = { ...base, ...entity, updatedAt: new Date('2026-11-11T00:00:00.000Z') };
    if (index === -1) this.rows.push(merged);
    else this.rows[index] = merged;
    return merged;
  }
}

/**
 * 造一行标注.
 *
 * @param overrides 覆盖字段
 * @returns 标注行
 */
function makeRow(overrides: Partial<QualityAnnotationEntity> = {}): QualityAnnotationEntity {
  // 默认值来自共享夹具 (quality-annotation-fixtures.ts) —— 本组用例只覆盖批次相关的列.
  return buildQualityAnnotationRow({ debugSessionId: 'debug_1', characterSlug: 'vpt_a', ...overrides });
}

/**
 * 造一场批次事实.
 *
 * @param overrides 覆盖字段
 * @returns 场次事实
 */
function makeFact(overrides: Partial<BatchSessionFact> = {}): BatchSessionFact {
  return {
    practiceSessionId: 'ps-1',
    debugSessionId: 'debug_1',
    characterSlug: 'vpt_a',
    counselorModeId: 'expert',
    turnCount: 12,
    status: 'completed',
    engineVersion: 'e3b0680-dirty',
    promptVersion: 'f1fdb4f90a5e622a',
    characterVersion: '1.0.0',
    startedAt: '2026-11-11T00:00:00.000Z',
    batchId: 'batch-1',
    ...overrides,
  };
}

/**
 * 造一份逐字稿.
 *
 * @param text 台词
 * @returns 逐字稿
 */
function makeTranscript(text: string): TranscriptRecord {
  return {
    id: 'debug_1',
    title: 't',
    characterSlug: 'vpt_a',
    characterLabel: '角色',
    createdAt: '2026-11-11T00:00:00.000Z',
    updatedAt: '2026-11-11T00:00:00.000Z',
    status: 'completed',
    turnCount: 1,
    messages: [{ role: 'visitor', text, turnIndex: 1, ts: '2026-11-11T00:00:00.000Z' }],
    traces: [],
    kernelState: null,
  };
}

/**
 * 活逐字稿读端口替身.
 */
class FakeReader {
  readonly records = new Map<string, TranscriptRecord>();

  async get(id: string): Promise<TranscriptRecord | null> {
    return this.records.get(id) ?? null;
  }
}

/**
 * 批次读侧服务替身 (可配置场次 / 批次 / 风格; 逐字稿走真冻结器).
 */
class StubBatchService {
  readonly sessions: BatchSessionFact[] = [];
  readonly batchFacts: BatchFactRow[] = [];
  readonly styles = new Map<string, string>();
  readonly freeze: QualityTranscriptFreeze;

  constructor(
    private readonly reader: FakeReader,
    rootDir: string,
  ) {
    this.freeze = new QualityTranscriptFreeze(reader, rootDir);
  }

  transcriptSource(debugSessionId: string, batchId: string | null): 'frozen' | 'live' | 'missing' {
    if (this.freeze.hasFrozen(debugSessionId, batchId)) return 'frozen';
    return this.reader.records.has(debugSessionId) ? 'live' : 'missing';
  }

  async readTranscript(
    debugSessionId: string,
    batchId: string | null,
  ): Promise<{ source: 'frozen' | 'live' | 'missing'; record: TranscriptRecord | null }> {
    return this.freeze.read(debugSessionId, batchId);
  }

  async freezeTranscript(
    debugSessionId: string,
    batchId: string | null,
  ): Promise<{ frozen: boolean; reason: 'frozen' | 'already-frozen' | 'missing' | 'failed' }> {
    return this.freeze.freeze(debugSessionId, batchId);
  }

  async batchSessions(batchId: string): Promise<BatchSessionFact[]> {
    return sortBatchSessions(this.sessions.filter((fact) => fact.batchId === batchId));
  }

  async findSessionFact(debugSessionId: string): Promise<{ fact: BatchSessionFact | null; ambiguous: boolean }> {
    const matches = this.sessions.filter((fact) => fact.debugSessionId === debugSessionId);
    return { fact: matches.at(0) ?? null, ambiguous: matches.length > 1 };
  }

  async attachmentStyles(): Promise<Map<string, string>> {
    return new Map(this.styles);
  }

  async batchAnchorOrder(fact: BatchSessionFact): Promise<number> {
    const list = await this.batchSessions(fact.batchId ?? '');
    const index = list.findIndex((item) => item.debugSessionId === fact.debugSessionId);
    return index === -1 ? 0 : index + 1;
  }

  async groupedSessions(): Promise<Map<string, BatchSessionFact[]>> {
    const grouped = new Map<string, BatchSessionFact[]>();
    for (const fact of this.sessions) {
      if (fact.batchId === null) continue;
      grouped.set(fact.batchId, [...(grouped.get(fact.batchId) ?? []), fact]);
    }
    return grouped;
  }

  async batchRows(): Promise<BatchFactRow[]> {
    return this.batchFacts;
  }

  async allSessions(): Promise<BatchSessionFact[]> {
    return sortBatchSessions(this.sessions);
  }
}

/**
 * 递归收集 JSON 里的所有字符串值.
 *
 * @param node 任意节点
 * @returns 字符串值数组
 */
function collectStrings(node: unknown): string[] {
  if (typeof node === 'string') return [node];
  if (Array.isArray(node)) return node.flatMap((item) => collectStrings(item));
  if (node && typeof node === 'object') {
    return Object.values(node as Record<string, unknown>).flatMap((item) => collectStrings(item));
  }
  return [];
}

/** 冻结目录 (每个测试文件一个临时目录, 跑完删). */
let freezeRoot = '';

beforeAll(async () => {
  freezeRoot = await mkdtemp(join(tmpdir(), 'wpn-freeze-'));
});

afterAll(async () => {
  if (freezeRoot.length > 0) await rm(freezeRoot, { recursive: true, force: true });
});

describe('WP-N · 标注台批次化契约与服务行为', () => {
  describe('① 端点清单与鉴权', () => {
    it('七个端点的路径与方法齐备', () => {
      const routes = collectRoutes(QualityAnnotationController);
      expect(routes.map((route) => `${route.method} ${route.path}`).toSorted()).toEqual(
        [
          `${RequestMethod.GET} annotations`,
          `${RequestMethod.GET} annotations/:ref`,
          `${RequestMethod.GET} annotations/:ref/auto`,
          `${RequestMethod.GET} annotations/:ref/reveal`,
          `${RequestMethod.GET} batches`,
          `${RequestMethod.GET} consistency`,
          `${RequestMethod.PUT} annotations/:ref`,
        ].toSorted(),
      );
    });

    it('全部端点的有效 guard 都含 AdminRoleGuard', () => {
      for (const route of collectRoutes(QualityAnnotationController)) {
        expect(route.guards).toContain(AdminRoleGuard);
      }
    });
  });

  describe('② ref 双解析', () => {
    it('按标注行 id 命中', async () => {
      const repo = new StubRepo();
      repo.rows.push(makeRow({ id: 'row-1', debugSessionId: 'debug_1' }));
      const reader = new FakeReader();
      reader.records.set('debug_1', makeTranscript('台词'));
      const batch = new StubBatchService(reader, freezeRoot);
      const service = new QualityAnnotationService(repo as never, batch as never);

      const detail = await service.detail('row-1');
      expect(detail.row.id).toBe('row-1');
      expect(detail.messages).toHaveLength(1);
    });

    it('按 debug_session_id 命中', async () => {
      const repo = new StubRepo();
      repo.rows.push(makeRow({ id: 'row-1', debugSessionId: 'debug_1' }));
      const reader = new FakeReader();
      reader.records.set('debug_1', makeTranscript('台词'));
      const batch = new StubBatchService(reader, freezeRoot);
      const service = new QualityAnnotationService(repo as never, batch as never);

      const detail = await service.detail('debug_1');
      expect(detail.row.id).toBe('row-1');
    });

    it('标注行不存在但场次表有 → 派生视图 (id=null), 且**不建行**', async () => {
      const repo = new StubRepo();
      const reader = new FakeReader();
      reader.records.set('debug_9', makeTranscript('台词'));
      const batch = new StubBatchService(reader, freezeRoot);
      batch.sessions.push(makeFact({ debugSessionId: 'debug_9', practiceSessionId: 'ps-9' }));
      const service = new QualityAnnotationService(repo as never, batch as never);

      const detail = await service.detail('debug_9');
      expect(detail.row.id).toBeNull();
      expect(detail.row.batchId).toBe('batch-1');
      expect(repo.rows).toHaveLength(0);
    });

    it('两处都查不到 → 404', async () => {
      const repo = new StubRepo();
      const batch = new StubBatchService(new FakeReader(), freezeRoot);
      const service = new QualityAnnotationService(repo as never, batch as never);

      await expect(service.detail('nope')).rejects.toMatchObject({ code: BizCode.ResourceNotFound });
    });
  });

  describe('③ batchId 非法 → 400', () => {
    it('控制器拒绝含路径分隔符的 batchId', async () => {
      const repo = new StubRepo();
      const batch = new StubBatchService(new FakeReader(), freezeRoot);
      const service = new QualityAnnotationService(repo as never, batch as never);
      const controller = new QualityAnnotationController(service);

      await expect(controller.list(undefined, '../etc')).rejects.toMatchObject({ code: BizCode.InvalidParameter });
      await expect(controller.consistency('a b')).rejects.toMatchObject({ code: BizCode.InvalidParameter });
    });

    it('includeInvalid 非法值 → 400', async () => {
      const repo = new StubRepo();
      const batch = new StubBatchService(new FakeReader(), freezeRoot);
      const service = new QualityAnnotationService(repo as never, batch as never);
      const controller = new QualityAnnotationController(service);

      await expect(controller.batches('yes')).rejects.toMatchObject({ code: BizCode.InvalidParameter });
    });
  });

  describe('④⑤ 读不写 + upsert 幂等', () => {
    it('GET 未建行不产生 DB 行', async () => {
      const repo = new StubRepo();
      const reader = new FakeReader();
      reader.records.set('debug_9', makeTranscript('台词'));
      const batch = new StubBatchService(reader, freezeRoot);
      batch.sessions.push(makeFact({ debugSessionId: 'debug_9', practiceSessionId: 'ps-9' }));
      const service = new QualityAnnotationService(repo as never, batch as never);

      await service.list('all', 'batch-1');
      await service.detail('debug_9');
      await service.consistency('batch-1');
      expect(repo.rows).toHaveLength(0);
    });

    it('同一 debugSessionId 连 PUT 两次 → 仍一行, id 不变, 归属列不动', async () => {
      const repo = new StubRepo();
      const reader = new FakeReader();
      reader.records.set('debug_9', makeTranscript('台词'));
      const batch = new StubBatchService(reader, freezeRoot);
      batch.sessions.push(makeFact({ debugSessionId: 'debug_9', practiceSessionId: 'ps-9' }));
      const service = new QualityAnnotationService(repo as never, batch as never);

      const first = await service.save('debug_9', { dominantLabel: 'recounting' }, 'ops');
      expect(first.id).not.toBeNull();
      expect(repo.rows).toHaveLength(1);

      const second = await service.save('debug_9', { dominantLabel: 'resistance' }, 'ops2');
      expect(repo.rows).toHaveLength(1);
      expect(second.id).toBe(first.id);
      expect(repo.rows[0]?.dominantLabel).toBe('resistance');
      expect(repo.rows[0]?.batchId).toBe('batch-1');
      expect(repo.rows[0]?.engineVersion).toBe('e3b0680-dirty');
      expect(repo.rows[0]?.turnCount).toBe(12);
    });

    it('轮级三列非法 → 400 (不静默丢弃)', async () => {
      const repo = new StubRepo();
      const reader = new FakeReader();
      reader.records.set('debug_9', makeTranscript('台词'));
      const batch = new StubBatchService(reader, freezeRoot);
      batch.sessions.push(makeFact({ debugSessionId: 'debug_9', practiceSessionId: 'ps-9' }));
      const service = new QualityAnnotationService(repo as never, batch as never);

      await expect(service.save('debug_9', { badTurns: '99' }, 'ops')).rejects.toMatchObject({
        code: BizCode.InvalidParameter,
      });
      await expect(service.save('debug_9', { firstBadTurn: 99 }, 'ops')).rejects.toMatchObject({
        code: BizCode.InvalidParameter,
      });
    });

    it('轮级说明含评分语义 → 400 (零压红线)', async () => {
      const repo = new StubRepo();
      const reader = new FakeReader();
      reader.records.set('debug_9', makeTranscript('台词'));
      const batch = new StubBatchService(reader, freezeRoot);
      batch.sessions.push(makeFact({ debugSessionId: 'debug_9', practiceSessionId: 'ps-9' }));
      const service = new QualityAnnotationService(repo as never, batch as never);

      await expect(service.save('debug_9', { turnNote: '这一场评分 85 分' }, 'ops')).rejects.toMatchObject({
        code: BizCode.InvalidParameter,
      });
    });
  });

  describe('⑥ 冻结读优先', () => {
    it('冻结副本与活文件内容不同 → 读到冻结副本', async () => {
      const repo = new StubRepo();
      repo.rows.push(makeRow({ id: 'row-1', debugSessionId: 'debug_1', batchId: 'batch-1' }));
      const reader = new FakeReader();
      reader.records.set('debug_1', makeTranscript('冻结时的台词'));
      const batch = new StubBatchService(reader, freezeRoot);
      const service = new QualityAnnotationService(repo as never, batch as never);

      await batch.freezeTranscript('debug_1', 'batch-1');
      reader.records.set('debug_1', makeTranscript('后来改写的活文件台词'));

      const detail = await service.detail('debug_1');
      expect(detail.transcriptSource).toBe('frozen');
      expect(detail.messages[0]?.text).toBe('冻结时的台词');
    });

    it('归属未知 (batchId=null) 的冻结副本也在 _unassigned 目录, 照样读得到', async () => {
      const repo = new StubRepo();
      repo.rows.push(makeRow({ id: 'row-2', debugSessionId: 'debug_2', batchId: null }));
      const reader = new FakeReader();
      reader.records.set('debug_2', makeTranscript('无归属时的台词'));
      const batch = new StubBatchService(reader, freezeRoot);
      const service = new QualityAnnotationService(repo as never, batch as never);

      await batch.freezeTranscript('debug_2', null);
      reader.records.set('debug_2', makeTranscript('后来改写的活文件台词'));

      const detail = await service.detail('debug_2');
      expect(detail.transcriptSource).toBe('frozen');
      expect(detail.messages[0]?.text).toBe('无归属时的台词');
    });

    it('两者都没有 → transcriptSource=missing + 告警, 台词空数组', async () => {
      const repo = new StubRepo();
      repo.rows.push(makeRow({ id: 'row-1', debugSessionId: 'debug_1' }));
      const batch = new StubBatchService(new FakeReader(), freezeRoot);
      const service = new QualityAnnotationService(repo as never, batch as never);

      const detail = await service.detail('debug_1');
      expect(detail.transcriptSource).toBe('missing');
      expect(detail.messages).toEqual([]);
      expect(detail.warnings).toContain('TRANSCRIPT_MISSING');
    });
  });

  describe('⑦ 向后兼容', () => {
    it('batchId 省略 → 只返已落库的行, id 恒非空, done/total 全量口径', async () => {
      const repo = new StubRepo();
      repo.rows.push(makeRow({ id: 'row-1', anchorOrder: 1 }), makeRow({ id: 'row-2', anchorOrder: 2, dominantLabel: 'recounting' }));
      const batch = new StubBatchService(new FakeReader(), freezeRoot);
      const service = new QualityAnnotationService(repo as never, batch as never);

      const all = await service.list('all');
      expect(all.items.map((row) => row.id)).toEqual(['row-1', 'row-2']);
      expect(all.items.every((row) => row.id !== null)).toBe(true);
      expect(all.done).toBe(1);
      expect(all.total).toBe(2);

      const pending = await service.list('pending');
      expect(pending.items.map((row) => row.id)).toEqual(['row-1']);
      expect(pending.done).toBe(1);
      expect(pending.total).toBe(2);
    });

    it('batchId 省略 → 全局派生: 已落库行保留, 未标注可标注场次补 id=null 派生行', async () => {
      const repo = new StubRepo();
      repo.rows.push(makeRow({ id: 'row-1', debugSessionId: 'debug_1', dominantLabel: 'recounting' }));
      const reader = new FakeReader();
      reader.records.set('debug_2', makeTranscript('台词'));
      const batch = new StubBatchService(reader, freezeRoot);
      batch.sessions.push(
        makeFact({ debugSessionId: 'debug_1', practiceSessionId: 'ps-1' }),
        makeFact({ debugSessionId: 'debug_2', practiceSessionId: 'ps-2' }),
        makeFact({ debugSessionId: 'debug_3', practiceSessionId: 'ps-3', status: 'failed' }),
      );
      const service = new QualityAnnotationService(repo as never, batch as never);

      const all = await service.list('all');
      expect(all.items).toHaveLength(2);
      expect(all.items.map((row) => row.debugSessionId)).toEqual(['debug_1', 'debug_2']);
      expect(all.items[1]?.id).toBeNull();
      expect(all.done).toBe(1);
      expect(all.total).toBe(2);

      const pending = await service.list('pending');
      expect(pending.items.map((row) => row.debugSessionId)).toEqual(['debug_2']);
      expect(pending.done).toBe(1);
      expect(pending.total).toBe(2);
    });

    it('batchId 给出 → 按批派生, 未建行 id=null, done/total 按批', async () => {
      const repo = new StubRepo();
      const reader = new FakeReader();
      reader.records.set('debug_1', makeTranscript('台词'));
      reader.records.set('debug_2', makeTranscript('台词'));
      const batch = new StubBatchService(reader, freezeRoot);
      batch.sessions.push(
        makeFact({ debugSessionId: 'debug_1', practiceSessionId: 'ps-1' }),
        makeFact({ debugSessionId: 'debug_2', practiceSessionId: 'ps-2' }),
      );
      const service = new QualityAnnotationService(repo as never, batch as never);

      const all = await service.list('all', 'batch-1');
      expect(all.items).toHaveLength(2);
      expect(all.items.every((row) => row.id === null)).toBe(true);
      expect(all.done).toBe(0);
      expect(all.total).toBe(2);
    });
  });

  describe('⑧ 合规 (响应里没有逐字稿正文)', () => {
    it('列表 / 批次 / 一致性 响应里不存在台词字段, 且批次与一致性无长自由文本', async () => {
      const repo = new StubRepo();
      repo.rows.push(makeRow({ id: 'row-1', dominantLabel: 'recounting' }));
      const reader = new FakeReader();
      reader.records.set('debug_1', makeTranscript('绝不能出现在列表里的逐字稿正文'));
      const batch = new StubBatchService(reader, freezeRoot);
      batch.sessions.push(makeFact({ debugSessionId: 'debug_1', practiceSessionId: 'ps-1' }));
      batch.batchFacts.push({
        batchId: 'batch-1',
        valid: true,
        validityFlags: [],
        engineVersion: 'e3b0680-dirty',
        promptVersion: 'f1fdb4f9',
        configFingerprint: '64fb2a96',
      });
      const service = new QualityAnnotationService(repo as never, batch as never);

      const list = await service.list('all');
      const batches = await service.batches(false);
      const consistency = await service.consistency('batch-1');

      const payload = JSON.stringify({ list, batches, consistency });
      expect(payload).not.toContain('绝不能出现在列表里的逐字稿正文');
      expect(payload).not.toContain('"messages"');
      expect(payload).not.toContain('"traces"');
      expect(payload).not.toContain('"kernelState"');

      for (const text of collectStrings(batches)) expect(text.length).toBeLessThanOrEqual(200);
      for (const text of collectStrings(consistency)) expect(text.length).toBeLessThanOrEqual(200);
    });
  });

  describe('⑨ 全局一致性排除 legacy 行', () => {
    it('无批次归属与归属无效批的行不进全量一致性分母', async () => {
      const repo = new StubRepo();
      repo.rows.push(
        makeRow({ id: 'row-valid', debugSessionId: 'debug_valid', batchId: 'batch-1' }),
        makeRow({ id: 'row-null-batch', debugSessionId: 'debug_null', batchId: null }),
        makeRow({ id: 'row-invalid-batch', debugSessionId: 'debug_invalid', batchId: 'invalid-batch' }),
      );
      const batch = new StubBatchService(new FakeReader(), freezeRoot);
      batch.batchFacts.push({
        batchId: 'batch-1',
        valid: true,
        validityFlags: [],
        engineVersion: null,
        promptVersion: null,
        configFingerprint: null,
      });
      const service = new QualityAnnotationService(repo as never, batch as never);

      const consistency = await service.consistency();

      expect(consistency.total).toBe(1);
      expect(consistency.scope.sessions).toBe(1);
    });
  });
});
