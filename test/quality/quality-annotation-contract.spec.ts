// V2026-11-10 治本 (WP-J P2 · 专业级标注工具 · 端点契约 + 服务行为 · 单测):
//   覆盖:
//     ① 五个端点的路径与方法 (与前端 `api.qualityAnnotation` 严格 1:1);
//     ② 全部端点继承 class 级 `AdminRoleGuard`;
//     ③ 模块注册了 guard 与 User 仓储 (DI 能解析);
//     ④ list 的 done/total 是**全量口径** (前端左栏进度条不能跳);
//     ⑤ detail 只返双方台词 (不返 traces / kernelState);
//     ⑥ reveal 的双盲闸门: 没保存人工标注 → 拒;
//     ⑦ reveal 走 `DebugSessionStore.get()` 的读路径 (不自扫目录);
//     ⑧ save 覆盖标注列并记录标注人.
//
//   全 mock: 不起 Nest 容器, 不连 DB, 不发网络.
//
//   验证: npx vitest run test/quality/quality-annotation-contract.spec.ts
//   时间戳: 2026-11-10 GMT+8
import { RequestMethod } from '@nestjs/common';
import { GUARDS_METADATA, METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { getRepositoryToken } from '@nestjs/typeorm';

import { describe, expect, it } from 'vitest';

import { AdminRoleGuard } from '../../src/admin-debug/guards/admin-role.guard.js';
import { BizCode } from '../../src/common/exceptions/biz-code.enum.js';
import { QualityAnnotationController } from '../../src/quality/quality-annotation.controller.js';
import { QualityAnnotationEntity } from '../../src/quality/quality-annotation.entity.js';
import { QualityAnnotationModule } from '../../src/quality/quality-annotation.module.js';
import { QualityAnnotationService } from '../../src/quality/quality-annotation.service.js';
import { User } from '../../src/user/entities/user.entity.js';

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

  async findOne(options: { readonly where: { readonly id: string } }): Promise<QualityAnnotationEntity | null> {
    return this.rows.find((row) => row.id === options.where.id) ?? null;
  }

  async save(row: QualityAnnotationEntity): Promise<QualityAnnotationEntity> {
    const index = this.rows.findIndex((item) => item.id === row.id);
    if (index !== -1) this.rows[index] = row;
    return row;
  }
}

/**
 * 内存版逐字稿存储 (只实现 service 用到的 get).
 */
class StubStore {
  readonly requested: string[] = [];

  constructor(private readonly record: unknown) {}

  async get(id: string): Promise<unknown> {
    this.requested.push(id);
    return this.record;
  }
}

/**
 * 造一行标注.
 *
 * @param overrides 覆盖字段
 * @returns 标注行
 */
function makeRow(overrides: Partial<QualityAnnotationEntity> = {}): QualityAnnotationEntity {
  return {
    id: 'row-1',
    debugSessionId: 'debug_abc',
    characterSlug: 'vpt_general_secure_l1',
    attachmentStyle: 'secure',
    anchorOrder: 1,
    firstExplorationTurn: null,
    dominantLabel: null,
    crisisPeakLevel: 0,
    crisisFirstTurn: null,
    shouldEndTurn: null,
    needsReview: false,
    durationMs: 0,
    annotator: null,
    notes: null,
    createdAt: new Date('2026-11-10T00:00:00.000Z'),
    updatedAt: new Date('2026-11-10T00:00:00.000Z'),
    ...overrides,
  };
}

/**
 * 批次读侧服务替身 (只实现标注服务用到的方法).
 *
 * ⚠️ V2026-11-11 (WP-N): 标注服务不再直接依赖 DebugSessionStore ——
 *   批次事实 / 逐字稿来源 / 冻结都走批次读侧服务. 这里替身保持"逐字稿从哪来"可注入.
 */
class StubBatchService {
  constructor(private readonly store: StubStore) {}

  transcriptSource(): 'frozen' | 'live' | 'missing' {
    return 'live';
  }

  async readTranscript(): Promise<{ source: 'frozen' | 'live' | 'missing'; record: unknown }> {
    const record = await this.store.get('debug_abc');
    return { source: record === null ? 'missing' : 'live', record };
  }

  async freezeTranscript(): Promise<{ frozen: boolean; reason: 'frozen' | 'already-frozen' | 'missing' | 'failed' }> {
    return { frozen: false, reason: 'already-frozen' };
  }

  async batchSessions(): Promise<never[]> {
    return [];
  }

  async findSessionFact(): Promise<{ fact: null; ambiguous: boolean }> {
    return { fact: null, ambiguous: false };
  }

  async attachmentStyles(): Promise<Map<string, string>> {
    return new Map<string, string>();
  }

  async batchAnchorOrder(): Promise<number> {
    return 0;
  }

  async groupedSessions(): Promise<Map<string, never[]>> {
    return new Map<string, never[]>();
  }

  async batchRows(): Promise<never[]> {
    return [];
  }

  async allSessions(): Promise<never[]> {
    return [];
  }
}

/**
 * 一场逐字稿 (只给 service 要用的字段 + 几个不该外泄的字段做对照).
 */
const TRANSCRIPT = {
  id: 'debug_abc',
  messages: [
    { role: 'counselor', text: '咨询师台词', turnIndex: 1, ts: '2026-11-10T00:00:00.000Z' },
    { role: 'visitor', text: '来访者台词', turnIndex: 1, ts: '2026-11-10T00:00:01.000Z' },
  ],
  traces: [
    {
      turnIndex: 1,
      intention: { strategy: 'recounting' },
      crisis: { detected: false, category: null },
      prompt: '不该外泄的 prompt 全文',
    },
  ],
  kernelState: { snapshot: { trust: 0.5 } },
};

describe('WP-J P2 · 标注台端点契约与服务行为', () => {
  describe('① 端点清单', () => {
    it('七个端点的路径与方法与前端 api.qualityAnnotation 严格 1:1 (V2026-11-11 WP-N 新增 batches)', () => {
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
  });

  describe('② 鉴权继承', () => {
    it('controller 类级挂了 AdminRoleGuard', () => {
      const classGuards = Reflect.getMetadata(GUARDS_METADATA, QualityAnnotationController) as unknown[] | undefined;

      expect(classGuards).toContain(AdminRoleGuard);
    });

    it('全部端点的有效 guard 都含 AdminRoleGuard', () => {
      for (const route of collectRoutes(QualityAnnotationController)) {
        expect(route.guards).toContain(AdminRoleGuard);
      }
    });

    it('模块里注册了 AdminRoleGuard 与 User 仓储 (DI 能解析)', () => {
      const providers = Reflect.getMetadata('providers', QualityAnnotationModule) as unknown[] | undefined;
      expect(providers).toContain(AdminRoleGuard);

      const imports = Reflect.getMetadata('imports', QualityAnnotationModule) as { providers?: { provide: unknown }[] }[] | undefined;
      const userRepoToken = getRepositoryToken(User);
      expect(imports?.some((module) => (module.providers ?? []).some((provider) => provider.provide === userRepoToken))).toBe(true);
    });
  });

  describe('④ list 的进度口径', () => {
    it('status=pending 只返未标的, 但 done/total 是全量口径', async () => {
      const repo = new StubRepo();
      repo.rows.push(makeRow({ id: 'row-1' }), makeRow({ id: 'row-2', dominantLabel: 'recounting', anchorOrder: 2 }));
      const service = new QualityAnnotationService(repo as never, new StubBatchService(new StubStore(null)) as never);

      const pending = await service.list('pending');
      expect(pending.items.map((row) => row.id)).toEqual(['row-1']);
      expect(pending.done).toBe(1);
      expect(pending.total).toBe(2);

      const done = await service.list('done');
      expect(done.items.map((row) => row.id)).toEqual(['row-2']);
      expect(done.done).toBe(1);
      expect(done.total).toBe(2);
    });

    it('status=all 返全部, 且顺序按锚点清单顺序', async () => {
      const repo = new StubRepo();
      repo.rows.push(makeRow({ id: 'row-2', anchorOrder: 2 }), makeRow({ id: 'row-1', anchorOrder: 1 }));
      const service = new QualityAnnotationService(repo as never, new StubBatchService(new StubStore(null)) as never);

      const all = await service.list('all');
      expect(all.items.map((row) => row.id)).toEqual(['row-1', 'row-2']);
    });
  });

  describe('⑤ detail 只返双方台词', () => {
    it('返回行 + 台词, 不含 traces / kernelState / prompt', async () => {
      const repo = new StubRepo();
      repo.rows.push(makeRow());
      const service = new QualityAnnotationService(repo as never, new StubBatchService(new StubStore(TRANSCRIPT)) as never);

      const detail = await service.detail('row-1');

      expect(detail.row.id).toBe('row-1');
      expect(detail.messages).toHaveLength(2);
      expect(detail.messages[0]).toEqual({ role: 'counselor', text: '咨询师台词', turnIndex: 1 });
      expect(JSON.stringify(detail)).not.toContain('不该外泄的 prompt');
      expect(JSON.stringify(detail)).not.toContain('kernelState');
    });

    it('逐字稿缺失 → 台词空数组, 不报错', async () => {
      const repo = new StubRepo();
      repo.rows.push(makeRow());
      const service = new QualityAnnotationService(repo as never, new StubBatchService(new StubStore(null)) as never);

      const detail = await service.detail('row-1');
      expect(detail.messages).toEqual([]);
    });

    it('标注记录不存在 → 404 (BizCode.ResourceNotFound)', async () => {
      const service = new QualityAnnotationService(new StubRepo() as never, new StubBatchService(new StubStore(null)) as never);

      await expect(service.detail('nope')).rejects.toMatchObject({ code: BizCode.ResourceNotFound });
    });
  });

  describe('⑥⑦ reveal 的双盲闸门与读路径', () => {
    it('还没保存人工标注 → 拒 (BizCode.InvalidParameter)', async () => {
      const repo = new StubRepo();
      repo.rows.push(makeRow());
      const service = new QualityAnnotationService(repo as never, new StubBatchService(new StubStore(TRANSCRIPT)) as never);

      await expect(service.reveal('row-1')).rejects.toMatchObject({ code: BizCode.InvalidParameter });
    });

    it('已保存 → 返回自动判定 (走 store.get 读路径)', async () => {
      const repo = new StubRepo();
      repo.rows.push(makeRow({ dominantLabel: 'recounting' }));
      const store = new StubStore(TRANSCRIPT);
      const service = new QualityAnnotationService(repo as never, new StubBatchService(store) as never);

      const reveal = await service.reveal('row-1');

      expect(reveal.auto).toEqual({ explorationTurn: null, dominantLabel: 'recounting', crisisLevel: 0 });
      expect(store.requested).toEqual(['debug_abc']);
    });
  });

  describe('⑧ save 覆盖标注列', () => {
    it('保存人工标注 + 记录标注人', async () => {
      const repo = new StubRepo();
      repo.rows.push(makeRow());
      const service = new QualityAnnotationService(repo as never, new StubBatchService(new StubStore(TRANSCRIPT)) as never);

      const saved = await service.save(
        'row-1',
        {
          firstExplorationTurn: 3,
          dominantLabel: 'recounting',
          crisisPeakLevel: 2,
          crisisFirstTurn: 4,
          shouldEndTurn: 7,
          needsReview: true,
          durationMs: 12_345,
          notes: '存疑: 第 4 轮语气突变',
        },
        'ops',
      );

      expect(saved.dominantLabel).toBe('recounting');
      expect(saved.firstExplorationTurn).toBe(3);
      expect(saved.crisisPeakLevel).toBe(2);
      expect(saved.crisisFirstTurn).toBe(4);
      expect(saved.shouldEndTurn).toBe(7);
      expect(saved.needsReview).toBe(true);
      expect(saved.durationMs).toBe(12_345);
      expect(saved.notes).toBe('存疑: 第 4 轮语气突变');
      expect(repo.rows[0]?.annotator).toBe('ops');
    });
  });
});
