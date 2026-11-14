// V2026-11-14 治本 (TD-16 · C1 试点域仓储端口化 · life-map 域 · P-DEBT-11 / L-1):
//   端口替身 spec —— life-map 两个 service 用**端口替身**驱动: 不起真数据源,
//   不连 DB, 不 mock 持久化库. 替身只记调用参数 + 返回预设行 / 序列.
//
//   覆盖:
//     ① LifeMapService (A1-A16): 三入口进度与解锁态 + 时间轴阶段映射 +
//        阶段写入 + 事件 CRUD (新增 / 更新合并 / 软删 / 不存在) + 维度盘点
//        (等级由 service 算) + 推演三态与风险维度 + 综合报告 (未解锁 /
//        解锁 summary 与推荐训练);
//     ② DriftBottleService (B1-B10): 投瓶 (入参透传 / 30 秒冷却 / 字符长度) +
//        捞瓶 (海面空 / 命中状态迁移 / 60 秒冷却排除) + 回信校验 (不能回信给自己
//        / 已回信过 / 成功写回信) + 4 个 counter 透传.
//
//   时间口径: 漂流瓶的冷却窗口与落库时刻要钉住"现在", 否则 30 秒 / 60 秒冷却
//     断言随真实时钟漂移. 用 `vi.useFakeTimers({ toFake: ['Date'], now: NOW })`
//     只 faked Date (不 faked 其它 timer): 本 spec 不依赖定时器.
//
//   替身写法: 直接实现端口 interface (跟 TD-13 analytics spec 同款端口替身口径).
//   枚举按 TD-13 口径从**纯枚举文件**值位置 import (不是 entity 目录) ——
//     本 spec 零 `src/life-map/entities/**` import, 零 typeorm 值符号.
//
//   验证: pnpm exec vitest run test/life-map/td16-life-map-port-pilot.spec.ts
//   时间戳: 2026-11-14 GMT+8

import { NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  CreateDriftBottleInput,
  DriftBottleRepository,
  DriftBottleRow,
  DriftBottleStats,
  MarkBottlePickedInput,
  MarkBottleRespondedInput,
} from '../../src/life-map/domain/repositories/drift-bottle.repository.js';
import type {
  GenomeDimensionRepository,
  GenomeDimensionRow,
  SaveGenomeDimensionInput,
} from '../../src/life-map/domain/repositories/genome-dimension.repository.js';
import type {
  CreateKeyEventInput,
  KeyEventRepository,
  KeyEventRow,
  SaveKeyEventInput,
} from '../../src/life-map/domain/repositories/key-event.repository.js';
import type {
  LifeStageProgressRepository,
  LifeStageProgressRow,
  SaveStageProgressInput,
} from '../../src/life-map/domain/repositories/life-stage-progress.repository.js';
import { DriftBottleStatus } from '../../src/life-map/enums/drift-bottle-status.enum.js';
import { DriftBottleService } from '../../src/life-map/providers/drift-bottle.service.js';
import { LifeMapService } from '../../src/life-map/providers/life-map.service.js';

/** 钉住的"现在" —— 2026-11-14 00:00:00Z. */
const NOW = new Date('2026-11-14T00:00:00.000Z');

// ═════════════════════════════════════════════════════════════
// 行构造器 (替身预设行)
// ═════════════════════════════════════════════════════════════

function stageRow(overrides: Partial<LifeStageProgressRow> = {}): LifeStageProgressRow {
  return {
    id: 'stage-1',
    userId: 'user-1',
    stage: 'adolescence',
    completionPct: 60,
    stuckPoints: null,
    gains: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function eventRow(overrides: Partial<KeyEventRow> = {}): KeyEventRow {
  return {
    id: 'event-1',
    userId: 'user-1',
    title: '高考失利',
    age: 18,
    type: 'negative',
    description: null,
    feelings: null,
    influence: null,
    interpretation: null,
    stage: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function dimensionRow(overrides: Partial<GenomeDimensionRow> = {}): GenomeDimensionRow {
  return {
    id: 'dim-1',
    userId: 'user-1',
    key: 'security',
    score: 50,
    tier: 'balanced',
    source: null,
    improvement: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function bottleRow(overrides: Partial<DriftBottleRow> = {}): DriftBottleRow {
  return {
    id: 'bottle-1',
    authorId: 'user-2',
    authorAnonymousName: '远方的人',
    content: '给陌生的你',
    status: DriftBottleStatus.DRIFT,
    pickedByUserId: null,
    pickedByAnonymousName: null,
    pickedAt: null,
    respondedText: null,
    respondedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

// ═════════════════════════════════════════════════════════════
// 端口替身
// ═════════════════════════════════════════════════════════════

/** 阶段完成度替身. */
class StageRepositoryDouble {
  /** listActiveByUser 的调用参数序列. */
  readonly listCalls: string[] = [];
  /** saveProgress 的入参序列. */
  readonly saves: SaveStageProgressInput[] = [];
  /** listActiveByUser 的返回行 (缺省空). */
  rows: LifeStageProgressRow[] = [];

  readonly repo: LifeStageProgressRepository;

  constructor() {
    this.repo = {
      listActiveByUser: async (userId: string): Promise<LifeStageProgressRow[]> => {
        this.listCalls.push(userId);
        return this.rows;
      },
      saveProgress: async (input: SaveStageProgressInput): Promise<LifeStageProgressRow> => {
        this.saves.push(input);
        return stageRow({
          userId: input.userId,
          stage: input.stage,
          completionPct: input.completionPct,
          stuckPoints: input.stuckPoints ?? null,
          gains: input.gains ?? null,
        });
      },
    };
  }
}

/** 关键事件替身. */
class KeyEventDouble {
  /** listActiveByUser 的调用参数序列. */
  readonly listCalls: string[] = [];
  /** countActiveByUser 的调用参数序列. */
  readonly countCalls: string[] = [];
  /** findActiveById 的调用参数序列. */
  readonly findCalls: { userId: string; eventId: string }[] = [];
  /** createEvent 的入参序列. */
  readonly creates: CreateKeyEventInput[] = [];
  /** saveEvent 的入参序列. */
  readonly saves: SaveKeyEventInput[] = [];
  /** softDeleteEvent 的调用参数序列. */
  readonly softDeletes: { eventId: string; deletedAt: Date }[] = [];
  /** listActiveByUser 的返回行 (缺省空). */
  rows: KeyEventRow[] = [];
  /** countActiveByUser 的返回值 (缺省 0). */
  count = 0;
  /** findActiveById 的返回行 (缺省 null). */
  found: KeyEventRow | null = null;

  readonly repo: KeyEventRepository;

  constructor() {
    this.repo = {
      listActiveByUser: async (userId: string): Promise<KeyEventRow[]> => {
        this.listCalls.push(userId);
        return this.rows;
      },
      countActiveByUser: async (userId: string): Promise<number> => {
        this.countCalls.push(userId);
        return this.count;
      },
      findActiveById: async (userId: string, eventId: string): Promise<KeyEventRow | null> => {
        this.findCalls.push({ userId, eventId });
        return this.found;
      },
      createEvent: async (input: CreateKeyEventInput): Promise<KeyEventRow> => {
        this.creates.push(input);
        return eventRow({
          id: 'event-' + this.creates.length,
          userId: input.userId,
          title: input.title,
          age: input.age,
          type: input.type,
          description: input.description,
          feelings: input.feelings,
          influence: input.influence,
          interpretation: input.interpretation,
          stage: input.stage,
        });
      },
      saveEvent: async (input: SaveKeyEventInput): Promise<KeyEventRow> => {
        this.saves.push(input);
        return eventRow({
          id: input.id,
          userId: input.userId,
          title: input.title,
          age: input.age,
          type: input.type,
          description: input.description,
          feelings: input.feelings,
          influence: input.influence,
          interpretation: input.interpretation,
          stage: input.stage,
        });
      },
      softDeleteEvent: async (eventId: string, deletedAt: Date): Promise<void> => {
        this.softDeletes.push({ eventId, deletedAt });
      },
    };
  }
}

/** 心理基因维度替身. */
class DimensionDouble {
  /** listActiveByUser 的调用参数序列. */
  readonly listCalls: string[] = [];
  /** countActiveByUser 的调用参数序列. */
  readonly countCalls: string[] = [];
  /** saveDimension 的入参序列. */
  readonly saves: SaveGenomeDimensionInput[] = [];
  /** listActiveByUser 的返回行 (缺省空). */
  rows: GenomeDimensionRow[] = [];
  /** countActiveByUser 的返回值 (缺省 0). */
  count = 0;

  readonly repo: GenomeDimensionRepository;

  constructor() {
    this.repo = {
      listActiveByUser: async (userId: string): Promise<GenomeDimensionRow[]> => {
        this.listCalls.push(userId);
        return this.rows;
      },
      countActiveByUser: async (userId: string): Promise<number> => {
        this.countCalls.push(userId);
        return this.count;
      },
      saveDimension: async (input: SaveGenomeDimensionInput): Promise<GenomeDimensionRow> => {
        this.saves.push(input);
        return dimensionRow({
          userId: input.userId,
          key: input.key,
          score: input.score,
          tier: input.tier,
          source: input.source ?? null,
          improvement: input.improvement ?? null,
        });
      },
    };
  }
}

/** 漂流瓶替身. */
class DriftBottleDouble {
  /** create 的入参序列. */
  readonly creates: CreateDriftBottleInput[] = [];
  /** findById 的调用参数序列. */
  readonly findCalls: string[] = [];
  /** pickRandomExcluding 的调用参数序列. */
  readonly picks: { currentUserId: string; excludeIds: string[] }[] = [];
  /** markPicked 的调用参数序列. */
  readonly picked: { id: string; input: MarkBottlePickedInput }[] = [];
  /** markResponded 的调用参数序列. */
  readonly responded: { id: string; input: MarkBottleRespondedInput }[] = [];
  /** pickRandomExcluding 的返回行 (缺省 null = 海面空). */
  pickedRow: DriftBottleRow | null = null;
  /** findById 的返回行 (缺省 null). */
  found: DriftBottleRow | null = null;
  /** getStats 的返回值. */
  stats: DriftBottleStats = { seaCount: 0, myPostedCount: 0, myPickedCount: 0, myRespondedCount: 0 };

  readonly repo: DriftBottleRepository;

  constructor() {
    this.repo = {
      create: async (input: CreateDriftBottleInput): Promise<DriftBottleRow> => {
        this.creates.push(input);
        return bottleRow({
          id: 'bottle-' + this.creates.length,
          authorId: input.authorId,
          authorAnonymousName: input.authorAnonymousName,
          content: input.content,
        });
      },
      findById: async (id: string): Promise<DriftBottleRow | null> => {
        this.findCalls.push(id);
        return this.found;
      },
      pickRandomExcluding: async (currentUserId: string, excludeIds: string[]): Promise<DriftBottleRow | null> => {
        this.picks.push({ currentUserId, excludeIds });
        return this.pickedRow;
      },
      findSea: async (): Promise<DriftBottleRow[]> => [],
      findMine: async (): Promise<DriftBottleRow[]> => [],
      findInbox: async (): Promise<DriftBottleRow[]> => [],
      getStats: async (): Promise<DriftBottleStats> => this.stats,
      markPicked: async (id: string, input: MarkBottlePickedInput): Promise<DriftBottleRow> => {
        this.picked.push({ id, input });
        return bottleRow({
          id,
          status: DriftBottleStatus.PICKED,
          pickedByUserId: input.pickedByUserId,
          pickedByAnonymousName: input.pickedByAnonymousName,
          pickedAt: input.pickedAt,
        });
      },
      markResponded: async (id: string, input: MarkBottleRespondedInput): Promise<DriftBottleRow> => {
        this.responded.push({ id, input });
        return bottleRow({
          id,
          status: DriftBottleStatus.RESPONDED,
          respondedText: input.respondedText,
          respondedAt: input.respondedAt,
        });
      },
    };
  }
}

// ═════════════════════════════════════════════════════════════
// 装配
// ═════════════════════════════════════════════════════════════

/** 装配 LifeMapService + 3 个端口替身. */
function makeLifeMap(): {
  service: LifeMapService;
  stage: StageRepositoryDouble;
  event: KeyEventDouble;
  dimension: DimensionDouble;
} {
  const stage = new StageRepositoryDouble();
  const event = new KeyEventDouble();
  const dimension = new DimensionDouble();
  return {
    service: new LifeMapService(stage.repo, event.repo, dimension.repo),
    stage,
    event,
    dimension,
  };
}

/** 装配 DriftBottleService + 端口替身. */
function makeDriftBottle(): { service: DriftBottleService; bottle: DriftBottleDouble } {
  const bottle = new DriftBottleDouble();
  return { service: new DriftBottleService(bottle.repo), bottle };
}

/** 钉住"现在" —— 只 faked Date, 本 spec 不依赖任何定时器. */
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'], now: NOW });
});

afterEach(() => {
  vi.useRealTimers();
});

// ═════════════════════════════════════════════════════════════
// ① LifeMapService
// ═════════════════════════════════════════════════════════════

describe('LifeMapService · 端口替身 (TD-16 C1)', () => {
  it('A1 · getOverview 三入口进度与文案口径', async () => {
    const { service, stage, event, dimension } = makeLifeMap();
    stage.rows = [
      stageRow({ id: 's1', stage: 'adolescence', completionPct: 60 }),
      stageRow({ id: 's2', stage: 'transition', completionPct: 20 }),
    ];
    event.count = 3;
    dimension.count = 1;

    const overview = await service.getOverview('user-1');

    expect(overview.entries).toHaveLength(3);
    expect(overview.entries[0].tag).toBe('已梳理 2 / 4 阶段');
    expect(overview.entries[0].progress).toBeCloseTo(0.5, 10);
    expect(overview.entries[1].tag).toBe('已记录 3 个事件');
    expect(overview.entries[1].progress).toBeCloseTo(0.6, 10);
    expect(overview.entries[2].tag).toBe('已盘点 1 / 5 维度');
    expect(overview.entries[2].progress).toBeCloseTo(0.2, 10);
    // userId 隔离: 三个端口都只收到当前用户的 id
    expect(stage.listCalls).toEqual(['user-1']);
    expect(event.countCalls).toEqual(['user-1']);
    expect(dimension.countCalls).toEqual(['user-1']);
  });

  it('A2 · getOverview 解锁态 (报告口径比推演多一道维度门槛)', async () => {
    const { service, stage, event, dimension } = makeLifeMap();
    stage.rows = [
      stageRow({ id: 's1', stage: 'adolescence', completionPct: 60 }),
      stageRow({ id: 's2', stage: 'emerging_adulthood', completionPct: 60 }),
      stageRow({ id: 's3', stage: 'transition', completionPct: 60 }),
      stageRow({ id: 's4', stage: 'midlife', completionPct: 60 }),
    ];
    event.count = 3;
    dimension.count = 5;

    const unlocked = await service.getOverview('user-1');
    expect(unlocked.forecastUnlocked).toBe(true);
    expect(unlocked.reportUnlocked).toBe(true);

    // 维度不足 5 → 推演仍解锁, 报告未解锁
    dimension.count = 4;
    const partial = await service.getOverview('user-1');
    expect(partial.forecastUnlocked).toBe(true);
    expect(partial.reportUnlocked).toBe(false);
  });

  it('A3 · getTimeline 阶段映射与 filled 判定', async () => {
    const { service, stage } = makeLifeMap();
    stage.rows = [
      stageRow({ id: 's1', stage: 'adolescence', completionPct: 60 }),
      stageRow({ id: 's2', stage: 'transition', completionPct: 0 }),
    ];

    const timeline = await service.getTimeline('user-1');

    expect(timeline.nodes).toHaveLength(4);
    const byStage = new Map(timeline.nodes.map((n) => [n.stage, n]));
    expect(byStage.get('adolescence')?.filled).toBe(true);
    expect(byStage.get('adolescence')?.completionPct).toBe(60);
    // 完成度 0 = 已建行但未推进, filled 判定按 completionPct > 0
    expect(byStage.get('transition')?.filled).toBe(false);
    expect(byStage.get('transition')?.completionPct).toBe(0);
    expect(byStage.get('midlife')?.filled).toBe(false);
    expect(timeline.filledCount).toBe(1);
  });

  it('A4 · listStageProgress 返回全 4 阶段 + 未填写态', async () => {
    const { service, stage } = makeLifeMap();
    stage.rows = [stageRow({ stage: 'adolescence', completionPct: 60 })];

    const result = await service.listStageProgress('user-1');

    expect(result.stages).toHaveLength(4);
    expect(result.stages[0]).toMatchObject({ stage: 'adolescence', completionPct: 60, keyEventCount: 0 });
    expect(result.allStagesFilled).toBe(false);
    // 未填写阶段: completionPct null + epoch updatedAt
    expect(result.stages[1].completionPct).toBeNull();
    expect(result.stages[1].updatedAt).toBe(new Date(0).toISOString());
  });

  it('A5 · saveStageProgress 入参透传 + DTO 转换', async () => {
    const { service, stage } = makeLifeMap();

    const dto = await service.saveStageProgress('user-1', {
      stage: 'adolescence',
      completionPct: 70,
      stuckPoints: '升学焦虑',
      gains: '学会独居',
    });

    expect(stage.saves).toHaveLength(1);
    expect(stage.saves[0]).toEqual({
      userId: 'user-1',
      stage: 'adolescence',
      completionPct: 70,
      stuckPoints: '升学焦虑',
      gains: '学会独居',
    });
    expect(dto).toEqual({
      stage: 'adolescence',
      completionPct: 70,
      keyEventCount: 0,
      stuckPoints: '升学焦虑',
      gains: '学会独居',
      updatedAt: NOW.toISOString(),
    });
  });

  it('A6 · listKeyEvents DTO 转换与 total', async () => {
    const { service, event } = makeLifeMap();
    event.rows = [
      eventRow({ id: 'event-1', title: '高考失利', age: 18, type: 'negative' }),
      eventRow({
        id: 'event-2',
        title: '入职',
        age: 24,
        type: 'positive',
        description: '描述',
        stage: 'emerging_adulthood',
      }),
    ];

    const result = await service.listKeyEvents('user-1');

    expect(result.total).toBe(2);
    expect(result.events[0]).toMatchObject({
      id: 'event-1',
      title: '高考失利',
      age: 18,
      type: 'negative',
      createdAt: NOW.toISOString(),
      updatedAt: NOW.toISOString(),
    });
    // null 字段转 undefined (DTO 口径: 可选字段不出现)
    expect(result.events[0].description).toBeUndefined();
    expect(result.events[0].stage).toBeUndefined();
    expect(result.events[1].description).toBe('描述');
    expect(result.events[1].stage).toBe('emerging_adulthood');
  });

  it('A7 · createKeyEvent 入参透传 (缺省字段归一为 null)', async () => {
    const { service, event } = makeLifeMap();

    const dto = await service.createKeyEvent('user-1', {
      title: '考研上岸',
      age: 22,
      type: 'turning',
    });

    expect(event.creates).toHaveLength(1);
    expect(event.creates[0]).toEqual({
      userId: 'user-1',
      title: '考研上岸',
      age: 22,
      type: 'turning',
      description: null,
      feelings: null,
      influence: null,
      interpretation: null,
      stage: null,
    });
    expect(dto.title).toBe('考研上岸');
    expect(dto.age).toBe(22);
  });

  it('A8 · updateKeyEvent 缺省字段保留原值', async () => {
    const { service, event } = makeLifeMap();
    event.found = eventRow({
      id: 'event-1',
      title: '原标题',
      age: 18,
      type: 'negative',
      description: '原描述',
      feelings: '原感受',
      influence: '原影响',
      interpretation: '原解读',
      stage: 'adolescence',
    });

    await service.updateKeyEvent('user-1', 'event-1', { title: '新标题' });

    expect(event.findCalls).toEqual([{ userId: 'user-1', eventId: 'event-1' }]);
    expect(event.saves).toHaveLength(1);
    expect(event.saves[0]).toEqual({
      id: 'event-1',
      userId: 'user-1',
      title: '新标题',
      age: 18,
      type: 'negative',
      description: '原描述',
      feelings: '原感受',
      influence: '原影响',
      interpretation: '原解读',
      stage: 'adolescence',
    });
  });

  it('A9 · updateKeyEvent 事件不存在 → NotFoundException', async () => {
    const { service, event } = makeLifeMap();
    event.found = null;

    await expect(service.updateKeyEvent('user-1', 'event-404', { title: 'x' })).rejects.toThrow(NotFoundException);
    await expect(service.updateKeyEvent('user-1', 'event-404', { title: 'x' })).rejects.toThrow('Key event event-404 not found');
    expect(event.saves).toHaveLength(0);
  });

  it('A10 · deleteKeyEvent 软删时刻由 service 生成', async () => {
    const { service, event } = makeLifeMap();
    event.found = eventRow({ id: 'event-1' });

    await service.deleteKeyEvent('user-1', 'event-1');

    expect(event.softDeletes).toHaveLength(1);
    expect(event.softDeletes[0].eventId).toBe('event-1');
    expect(event.softDeletes[0].deletedAt.getTime()).toBe(NOW.getTime());
  });

  it('A11 · listGenomeDimensions 计数 / 维度名 / 全量态', async () => {
    const { service, dimension } = makeLifeMap();
    dimension.rows = [
      dimensionRow({ id: 'd1', key: 'security', score: 30, tier: 'balanced' }),
      dimensionRow({ id: 'd2', key: 'self_esteem', score: 60, tier: 'stable' }),
    ];

    const partial = await service.listGenomeDimensions('user-1');
    expect(partial.filledCount).toBe(2);
    expect(partial.allFilled).toBe(false);
    expect(partial.dimensions[0].label).toBe('安全感');
    expect(partial.dimensions[0].tier).toBe('balanced');
    expect(partial.dimensions[1].label).toBe('自尊水平');

    dimension.rows = [
      dimensionRow({ id: 'd1', key: 'security' }),
      dimensionRow({ id: 'd2', key: 'self_esteem' }),
      dimensionRow({ id: 'd3', key: 'autonomy' }),
      dimensionRow({ id: 'd4', key: 'resilience' }),
      dimensionRow({ id: 'd5', key: 'self_integration' }),
    ];
    const full = await service.listGenomeDimensions('user-1');
    expect(full.filledCount).toBe(5);
    expect(full.allFilled).toBe(true);
  });

  it('A12 · saveGenomeDimension 等级由 service 算 (4 档映射)', async () => {
    const { service, dimension } = makeLifeMap();

    const scores = [10, 30, 60, 90];
    for (const score of scores) {
      await service.saveGenomeDimension('user-1', { key: 'security', score });
    }

    expect(dimension.saves.map((s) => s.tier)).toEqual(['gentle', 'balanced', 'stable', 'strong']);
    expect(dimension.saves[0]).toMatchObject({ userId: 'user-1', key: 'security', score: 10, tier: 'gentle' });
  });

  it('A13 · listForecasts 三态解锁口径', async () => {
    const { service, stage, event } = makeLifeMap();

    const locked = await service.listForecasts('user-1');
    expect(locked.unlockStatus).toBe('locked');
    expect(locked.lockedReason).toBe('完成全量阶段梳理 + 记录 ≥3 个关键事件后解锁');
    expect(locked.total).toBe(0);
    expect(locked.forecasts).toEqual([]);

    stage.rows = [
      stageRow({ id: 's1', stage: 'adolescence', completionPct: 60 }),
      stageRow({ id: 's2', stage: 'emerging_adulthood', completionPct: 60 }),
    ];
    event.count = 1;
    const locking = await service.listForecasts('user-1');
    expect(locking.unlockStatus).toBe('locking');
    expect(locking.lockedReason).toBe('再记录 2 个关键事件即可解锁');

    stage.rows = [
      stageRow({ id: 's1', stage: 'adolescence', completionPct: 60 }),
      stageRow({ id: 's2', stage: 'emerging_adulthood', completionPct: 60 }),
      stageRow({ id: 's3', stage: 'transition', completionPct: 60 }),
      stageRow({ id: 's4', stage: 'midlife', completionPct: 60 }),
    ];
    event.count = 3;
    const unlocked = await service.listForecasts('user-1');
    expect(unlocked.unlockStatus).toBe('unlocked');
    expect(unlocked.lockedReason).toBeUndefined();
  });

  it('A14 · runForecast 风险 / 机会 / 准备维度', async () => {
    const { service, dimension, event } = makeLifeMap();
    dimension.rows = [
      dimensionRow({ id: 'd1', key: 'security', score: 20, tier: 'gentle' }),
      dimensionRow({ id: 'd2', key: 'autonomy', score: 70, tier: 'strong' }),
      dimensionRow({ id: 'd3', key: 'self_esteem', score: 70, tier: 'strong' }),
    ];
    event.rows = [eventRow({ id: 'event-1', type: 'negative' })];

    const forecast = await service.runForecast('user-1', {
      scenario: 'job_change',
      description: '考虑跳槽到大厂',
      worries: ['适应成本'],
      expectations: ['成长空间'],
    });

    expect(forecast.id.startsWith('forecast_')).toBe(true);
    expect(forecast.scenario).toBe('job_change');
    expect(forecast.description).toBe('考虑跳槽到大厂');
    // 安全感 20 < 30 → high; 存在负向事件 → 追加一条 low
    expect(forecast.risks.map((r) => r.dimension)).toEqual(['安全感冲击', '过往经历激活']);
    expect(forecast.risks[0].level).toBe('high');
    expect(forecast.risks[1].level).toBe('low');
    // 自主性 / 自尊 >= 60 → 各追加一条机会
    expect(forecast.opportunities.map((o) => o.dimension)).toEqual(['自主性提升', '能力边界拓展', '自我整合机会']);
    // 维度未满 5 → 追加盘点提示; job_change → 追加环境调研提示
    expect(forecast.preparations).toHaveLength(4);
    expect(forecast.preparations[2]).toBe('建议先完成心理基因盘点, 推演会更精准');
    expect(forecast.preparations[3]).toBe('提前调研新环境的日常节奏, 减少未知的消耗');
  });

  it('A15 · getGrowthReport 未解锁 → canGenerate false', async () => {
    const { service } = makeLifeMap();

    const report = await service.getGrowthReport('user-1');

    expect(report.canGenerate).toBe(false);
    expect(report.id).toBe('pending');
    expect(report.stageCompletionCurve).toEqual([]);
    expect(report.genomeDimensions).toEqual([]);
    expect(report.coreStuckPoints).toEqual([]);
    expect(report.stageActionPlan).toEqual([]);
    expect(report.recommendedTools).toEqual([]);
    expect(report.summary).toBe('');
    expect(report.blockedReason).toBe('请先完成阶段梳理 + 关键事件记录 + 心理基因盘点');
  });

  it('A16 · getGrowthReport 解锁 → summary / 卡点 / 推荐训练', async () => {
    const { service, stage, event, dimension } = makeLifeMap();
    stage.rows = [
      stageRow({ id: 's1', stage: 'adolescence', completionPct: 100, stuckPoints: '升学压力很大' }),
      stageRow({ id: 's2', stage: 'emerging_adulthood', completionPct: 80 }),
      stageRow({ id: 's3', stage: 'transition', completionPct: 60 }),
      stageRow({ id: 's4', stage: 'midlife', completionPct: 40 }),
    ];
    event.count = 3;
    dimension.rows = [
      dimensionRow({ id: 'd1', key: 'security', score: 30, tier: 'balanced' }),
      dimensionRow({ id: 'd2', key: 'self_esteem', score: 70, tier: 'stable' }),
      dimensionRow({ id: 'd3', key: 'autonomy', score: 70, tier: 'stable' }),
      dimensionRow({ id: 'd4', key: 'resilience', score: 70, tier: 'stable' }),
      dimensionRow({ id: 'd5', key: 'self_integration', score: 70, tier: 'stable' }),
    ];

    const report = await service.getGrowthReport('user-1');

    expect(report.canGenerate).toBe(true);
    expect(report.id.startsWith('report_')).toBe(true);
    expect(report.stageCompletionCurve).toEqual([100, 80, 60, 40]);
    expect(report.coreStuckPoints).toEqual(['adolescence: 升学压力很大']);
    expect(report.stageActionPlan[3]).toBe('midlife: 优先补全任务完成度, 建议回到该阶段做 1 次自我梳理');
    // 安全感 30 < 50 → 追加安全岛练习
    expect(report.recommendedTools).toEqual(['安全岛想象练习 (emergency.safe-island)']);
    // 平均分 (30 + 70 * 4) / 5 = 62
    expect(report.summary).toBe(
      '你已完成 4 / 4 个人生阶段梳理, 记录 3 个关键事件, 心理基因 5 维度平均得分 62。建议从得分较低维度开始针对性训练。',
    );
  });
});

// ═════════════════════════════════════════════════════════════
// ② DriftBottleService
// ═════════════════════════════════════════════════════════════

describe('DriftBottleService · 端口替身 (TD-16 C1)', () => {
  it('B1 · postBottle 入参透传 (内容与匿名名 trim)', async () => {
    const { service, bottle } = makeDriftBottle();

    const dto = await service.postBottle({
      authorId: 'user-1',
      content: '  给陌生的你  ',
      authorAnonymousName: '  夜航船  ',
    });

    expect(bottle.creates).toHaveLength(1);
    expect(bottle.creates[0]).toEqual({
      authorId: 'user-1',
      authorAnonymousName: '夜航船',
      content: '给陌生的你',
    });
    expect(dto.content).toBe('给陌生的你');
    expect(dto.authorAnonymousName).toBe('夜航船');
    expect(dto.status).toBe(DriftBottleStatus.DRIFT);
  });

  it('B2 · postBottle 30 秒冷却窗口', async () => {
    const { service, bottle } = makeDriftBottle();

    await service.postBottle({ authorId: 'user-1', content: '第一封' });
    expect(bottle.creates).toHaveLength(1);

    vi.setSystemTime(new Date(NOW.getTime() + 29_000));
    await expect(service.postBottle({ authorId: 'user-1', content: '第二封' })).rejects.toThrow(UnprocessableEntityException);
    expect(bottle.creates).toHaveLength(1);

    vi.setSystemTime(new Date(NOW.getTime() + 30_000));
    await expect(service.postBottle({ authorId: 'user-1', content: '第三封' })).resolves.toBeDefined();
    expect(bottle.creates).toHaveLength(2);
  });

  it('B3 · postBottle 字符长度边界 (空 / 501 字)', async () => {
    const { service, bottle } = makeDriftBottle();

    await expect(service.postBottle({ authorId: 'user-1', content: ' '.repeat(3) })).rejects.toThrow(
      '信件内容需在 1..500 字之间 (当前 0).',
    );
    await expect(service.postBottle({ authorId: 'user-2', content: 'x'.repeat(501) })).rejects.toThrow(
      '信件内容需在 1..500 字之间 (当前 501).',
    );
    expect(bottle.creates).toHaveLength(0);
  });

  it('B4 · pickRandomBottle 海面空 → null', async () => {
    const { service, bottle } = makeDriftBottle();

    const result = await service.pickRandomBottle({ currentUserId: 'user-1' });

    expect(result).toBeNull();
    expect(bottle.picks).toHaveLength(1);
    expect(bottle.picks[0].currentUserId).toBe('user-1');
    expect(bottle.picks[0].excludeIds).toEqual([]);
    expect(bottle.picked).toHaveLength(0);
  });

  it('B5 · pickRandomBottle 命中 → markPicked 状态迁移', async () => {
    const { service, bottle } = makeDriftBottle();
    bottle.pickedRow = bottleRow({ id: 'bottle-9', authorId: 'user-2' });

    const result = await service.pickRandomBottle({ currentUserId: 'user-1' });

    expect(result).not.toBeNull();
    expect(result?.status).toBe(DriftBottleStatus.PICKED);
    expect(result?.pickedByUserId).toBe('user-1');
    expect(bottle.picked).toHaveLength(1);
    expect(bottle.picked[0].id).toBe('bottle-9');
    expect(bottle.picked[0].input.pickedByUserId).toBe('user-1');
    expect(bottle.picked[0].input.pickedByAnonymousName).toBe('你');
    expect(bottle.picked[0].input.pickedAt.getTime()).toBe(NOW.getTime());
  });

  it('B6 · pickRandomBottle 60 秒内不重复返回同一封', async () => {
    const { service, bottle } = makeDriftBottle();
    bottle.pickedRow = bottleRow({ id: 'bottle-9', authorId: 'user-2' });

    await service.pickRandomBottle({ currentUserId: 'user-1' });
    expect(bottle.picks[0].excludeIds).toEqual([]);

    await service.pickRandomBottle({ currentUserId: 'user-1' });
    expect(bottle.picks[1].excludeIds).toEqual(['bottle-9']);

    // 超过 60 秒 → 冷却窗口过期, 排除列表清空
    vi.setSystemTime(new Date(NOW.getTime() + 61_000));
    await service.pickRandomBottle({ currentUserId: 'user-1' });
    expect(bottle.picks[2].excludeIds).toEqual([]);
  });

  it('B7 · respondToBottle 不能回信给自己', async () => {
    const { service, bottle } = makeDriftBottle();
    bottle.found = bottleRow({ id: 'bottle-1', authorId: 'user-1' });

    await expect(service.respondToBottle({ bottleId: 'bottle-1', currentUserId: 'user-1', responseText: '你好' })).rejects.toThrow(
      UnprocessableEntityException,
    );
    expect(bottle.responded).toHaveLength(0);
  });

  it('B8 · respondToBottle 已回信过 → 状态机单向, 拒写', async () => {
    const { service, bottle } = makeDriftBottle();
    bottle.found = bottleRow({
      id: 'bottle-1',
      authorId: 'user-2',
      status: DriftBottleStatus.RESPONDED,
      respondedText: '已回',
    });

    await expect(service.respondToBottle({ bottleId: 'bottle-1', currentUserId: 'user-1', responseText: '再回' })).rejects.toThrow(
      '这封信已经被回复过.',
    );

    // 状态未到 responded 但已有回信文本 → 同样拒写
    bottle.found = bottleRow({
      id: 'bottle-2',
      authorId: 'user-2',
      status: DriftBottleStatus.PICKED,
      respondedText: '旧回信',
    });
    await expect(service.respondToBottle({ bottleId: 'bottle-2', currentUserId: 'user-1', responseText: '再回' })).rejects.toThrow(
      '这封信已经被回复过.',
    );
    expect(bottle.responded).toHaveLength(0);
  });

  it('B9 · respondToBottle 成功 → markResponded 状态迁移', async () => {
    const { service, bottle } = makeDriftBottle();
    bottle.found = bottleRow({ id: 'bottle-3', authorId: 'user-2', status: DriftBottleStatus.PICKED });

    const dto = await service.respondToBottle({
      bottleId: 'bottle-3',
      currentUserId: 'user-1',
      responseText: '  谢谢你  ',
    });

    expect(bottle.responded).toHaveLength(1);
    expect(bottle.responded[0].id).toBe('bottle-3');
    expect(bottle.responded[0].input.respondedText).toBe('谢谢你');
    expect(bottle.responded[0].input.respondedAt.getTime()).toBe(NOW.getTime());
    expect(dto.status).toBe(DriftBottleStatus.RESPONDED);
    expect(dto.respondedText).toBe('谢谢你');
  });

  it('B10 · getStats 4 个 counter 原样透传', async () => {
    const { service, bottle } = makeDriftBottle();
    bottle.stats = { seaCount: 3, myPostedCount: 5, myPickedCount: 2, myRespondedCount: 1 };

    const stats = await service.getStats('user-1');

    expect(stats).toEqual({ seaCount: 3, myPostedCount: 5, myPickedCount: 2, myRespondedCount: 1 });
  });
});
