// V2026-11-06 治本 (WP58 · B 层 · 事件 + delta 审计观测):
//   职责: 钉死"adapter 层自观测"这条链路的五段行为 ——
//     ① 开关: 关着时**连分类器都不跑** (零开销), 开时才观测;
//     ② 落库: 事件类型 + 命中词 + 原始 delta (11 维) 一次写齐, 重试覆盖同一行;
//     ③ 补齐: 内核认得的 sensitive_touch (本地分类器看不到) 按类型补回来 ——
//        免得记下来的 delta 与内核实际施加的对不上;
//     ④ 出口: 门面两个出口 (turn / turnStream) 都挂观测, 失败静默不影响主链路;
//     ⑤ 读侧: admin 端点按轮次升序返回, 无数据 = 空数组.
//   边界: 全 mock; 不起 Nest 容器; 不连 DB / 不发网络.
//
//   为什么这些断言值得存在:
//     观测通道是**增强** —— 它坏了不会有人立刻发现 (不抛错、不告警). 所以"它还活着
//     吗"只能靠断言钉住: 开关关着时零开销、开着时真的落库、落库失败不影响对话.
//     再加上内核真值一致性 (命中词 + delta 数值与内核系数表逐字对得上) ——
//     观测一旦与内核漂移, 它记下来的数就是**骗人的数**.
//
//   验证: npx vitest run test/engine-adapters/wp58-turn-delta-audit.spec.ts

import { RequestMethod } from '@nestjs/common';

import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { vi } from 'vitest';

import { AdminDebugChatModule } from '../../src/admin-debug/admin-debug-chat.module.js';
import { DebugSessionController } from '../../src/admin-debug/debug-session.controller.js';
import type { TurnRenderResult } from '../../src/engine-adapters/rendering/turn-render-orchestrator.js';
import { EngineSessionRegistry, EngineTurnService } from '../../src/engine-adapters/wiring/engine-turn.service.js';
import { EngineWiringModule } from '../../src/engine-adapters/wiring/engine.module.js';
import { resolveTurnDeltaAuditConfig } from '../../src/engine-adapters/wiring/turn-delta-audit/turn-delta-audit.config.js';
import { TurnDeltaAuditEntity } from '../../src/engine-adapters/wiring/turn-delta-audit/turn-delta-audit.entity.js';
import { TurnDeltaAuditModule } from '../../src/engine-adapters/wiring/turn-delta-audit/turn-delta-audit.module.js';
import { TURN_DELTA_AUDIT } from '../../src/engine-adapters/wiring/turn-delta-audit/turn-delta-audit.port.js';
import { TurnDeltaAuditService } from '../../src/engine-adapters/wiring/turn-delta-audit/turn-delta-audit.service.js';

/** 仓库根目录. */
const REPO_ROOT = path.join(__dirname, '../..');

/**
 * 造一个 ConfigService 桩 (只实现 get).
 *
 * @param env env 值表
 * @returns ConfigService 桩
 */
function configStub(env: Readonly<Record<string, string>>): ConfigService {
  return { get: (key: string): string | undefined => env[key] } as unknown as ConfigService;
}

/** 仓储桩 (记下写库的行). */
interface RepoStub {
  readonly findOne: ReturnType<typeof vi.fn>;
  readonly find: ReturnType<typeof vi.fn>;
  readonly create: ReturnType<typeof vi.fn>;
  readonly save: ReturnType<typeof vi.fn>;
  /** save 真正收到的行 (按写入顺序). */
  readonly saved: TurnDeltaAuditEntity[];
}

/**
 * 造一个审计表仓储桩.
 *
 * @param rows 已有行 (模拟库里已经有的数据)
 * @returns 仓储桩
 */
function repoStub(rows: TurnDeltaAuditEntity[] = []): RepoStub {
  const saved: TurnDeltaAuditEntity[] = [];
  return {
    findOne: vi.fn(async (options: { where: { tenantId: string; sessionId: string; turnIndex: number } }) => {
      const { where } = options;
      return (
        rows.find((row) => row.tenantId === where.tenantId && row.sessionId === where.sessionId && row.turnIndex === where.turnIndex) ??
        null
      );
    }),
    find: vi.fn(async () => rows),
    create: vi.fn((values: Partial<TurnDeltaAuditEntity>) => ({ ...values }) as TurnDeltaAuditEntity),
    save: vi.fn(async (entity: TurnDeltaAuditEntity) => {
      saved.push(entity);
      return entity;
    }),
    saved,
  };
}

/**
 * 造一个观测服务 (装配等价: 仓储 + 配置).
 *
 * @param env env 值表
 * @param repo 仓储桩
 * @returns 观测服务
 */
function makeService(env: Readonly<Record<string, string>>, repo: RepoStub = repoStub()): TurnDeltaAuditService {
  return new TurnDeltaAuditService(repo as never, configStub(env));
}

/**
 * 让微任务队列跑干净 (fire-and-forget 的写库是异步的).
 */
async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

/** 开启观测的 env. */
const ON = { TURN_DELTA_AUDIT_ENABLED: 'true' };

describe('WP58 · 观测开关装配 (env → TurnDeltaAuditConfig)', () => {
  it('没配 env → 关 (生产缺省: 不占空间、不耗性能)', () => {
    expect(resolveTurnDeltaAuditConfig(configStub({})).enabled).toBe(false);
  });

  it.each(['true', '1', 'yes', 'on', 'TRUE', ' On '])('%s → 开 (与仓库既有布尔开关同口径)', (raw) => {
    expect(resolveTurnDeltaAuditConfig(configStub({ TURN_DELTA_AUDIT_ENABLED: raw })).enabled).toBe(true);
  });

  it('非法值回退"关" (填错一个 env 不该让服务起不来)', () => {
    expect(resolveTurnDeltaAuditConfig(configStub({ TURN_DELTA_AUDIT_ENABLED: 'abc' })).enabled).toBe(false);
  });

  it('读的是**字面量** env 键 (env 覆盖断言的 AST 抽取看得到)', () => {
    const get = vi.fn();
    resolveTurnDeltaAuditConfig({ get } as unknown as ConfigService);

    const readKeys = get.mock.calls.map((call) => call[0]).filter((key): key is string => typeof key === 'string');
    expect(readKeys).toEqual(['TURN_DELTA_AUDIT_ENABLED']);
  });
});

describe('WP58 · 观测服务 (开关 / 落库 / 补齐 / 失败静默)', () => {
  it('开关关着 → 连分类器都不跑 (零开销)', async () => {
    const repo = repoStub();
    const service = makeService({}, repo);

    service.record({
      tenantId: 't1',
      sessionId: 's1',
      turnIndex: 1,
      userText: '听起来你现在一定很难受',
      kernelEventKinds: ['empathy'],
    });
    await flush();

    expect(repo.findOne).not.toHaveBeenCalled();
    expect(repo.save).not.toHaveBeenCalled();
  });

  it('开关开着 → 落库一行: 事件类型 + 命中词 + 原始 delta', async () => {
    const repo = repoStub();
    const service = makeService(ON, repo);

    service.record({
      tenantId: 't1',
      sessionId: 's1',
      turnIndex: 1,
      userText: '听起来你现在一定很难受',
      kernelEventKinds: ['empathy'],
    });
    await flush();

    expect(repo.save).toHaveBeenCalledTimes(1);
    const row = repo.saved[0];
    expect(row).toBeDefined();
    expect(row.tenantId).toBe('t1');
    expect(row.sessionId).toBe('s1');
    expect(row.turnIndex).toBe(1);
    expect(row.eventKinds).toEqual(['empathy']);
    expect(row.eventDetails[0]?.kind).toBe('empathy');
    expect(row.eventDetails[0]?.matchedTerms).toContain('听起来你');
    expect(row.eventDetails[0]?.strength).toBe(1);
  });

  it('原始 delta 与内核系数表逐字一致 (11 维全落, 不是自己估的数)', async () => {
    const repo = repoStub();
    const service = makeService(ON, repo);

    service.record({
      tenantId: 't1',
      sessionId: 's1',
      turnIndex: 1,
      userText: '听起来你现在一定很难受',
      kernelEventKinds: ['empathy'],
    });
    await flush();

    // 内核 DELTA_TABLE.empathy 的 11 维原值.
    expect(repo.saved[0]?.rawDelta).toEqual({
      trust: 0.1,
      safety: 0.02,
      bond: 0.01,
      verbal: -0.08,
      depth: -0.1,
      style: -0.06,
      valence: 0.1,
      arousal: -0.05,
      positive: 0.03,
      negative: 0,
      dependency: 0,
    });
  });

  it('没命中任何事件 → 记 neutral, delta 全零 (不是"没记录")', async () => {
    const repo = repoStub();
    const service = makeService(ON, repo);

    service.record({
      tenantId: 't1',
      sessionId: 's1',
      turnIndex: 1,
      userText: '嗯。',
      kernelEventKinds: ['neutral'],
    });
    await flush();

    expect(repo.saved[0]?.eventKinds).toEqual(['neutral']);
    expect(repo.saved[0]?.rawDelta.trust).toBe(0);
    expect(repo.saved[0]?.rawDelta.arousal).toBe(0);
  });

  it('内核认得的 sensitive_touch 按类型补回来 (delta 不与内核脱节)', async () => {
    const repo = repoStub();
    const service = makeService(ON, repo);

    service.record({
      tenantId: 't1',
      sessionId: 's1',
      turnIndex: 1,
      userText: '听起来你现在一定很难受',
      // 内核带了角色的敏感议题词表, 认得出 sensitive_touch; 适配层拿不到那个词表.
      kernelEventKinds: ['empathy', 'sensitive_touch'],
    });
    await flush();

    const row = repo.saved[0];
    expect(row?.eventKinds).toEqual(['empathy', 'sensitive_touch']);
    // 本期 sensitive_touch 只记类型不记命中词 (拿不到).
    const touch = row?.eventDetails.find((detail) => detail.kind === 'sensitive_touch');
    expect(touch?.matchedTerms).toEqual([]);
    // delta = empathy + sensitive_touch 两份系数之和 (safety 0.02 + (-0.01) / arousal -0.05 + 0.15).
    expect(row?.rawDelta.safety).toBeCloseTo(0.01, 10);
    expect(row?.rawDelta.arousal).toBeCloseTo(0.1, 10);
  });

  it('重试覆盖同一行 (同一轮再记一次不堆行)', async () => {
    const existing = {
      id: 'row-1',
      tenantId: 't1',
      sessionId: 's1',
      turnIndex: 2,
      eventKinds: ['neutral'],
      eventDetails: [],
      rawDelta: {},
      createdAt: new Date(),
    } as unknown as TurnDeltaAuditEntity;
    const repo = repoStub([existing]);
    const service = makeService(ON, repo);

    service.record({
      tenantId: 't1',
      sessionId: 's1',
      turnIndex: 2,
      userText: '听起来你现在一定很难受',
      kernelEventKinds: ['empathy'],
    });
    await flush();

    expect(repo.save).toHaveBeenCalledTimes(1);
    // 复用已有行 (id 不变) —— 不是插第二行.
    expect(repo.saved[0]?.id).toBe('row-1');
    expect(repo.saved[0]?.eventKinds).toEqual(['empathy']);
  });

  it('写库失败静默 (观测出问题 ≠ 对话出问题)', async () => {
    const repo = repoStub();
    repo.save.mockRejectedValue(new Error('db down'));
    const service = makeService(ON, repo);

    expect(() =>
      service.record({
        tenantId: 't1',
        sessionId: 's1',
        turnIndex: 1,
        userText: '听起来你现在一定很难受',
        kernelEventKinds: ['empathy'],
      }),
    ).not.toThrow();
    await flush();
  });

  it('listTurns 把排序交给数据库 (按轮次升序), 不在内存里排', async () => {
    const repo = repoStub([]);
    const service = makeService(ON, repo);

    await service.listTurns('s1');

    expect(repo.find).toHaveBeenCalledWith({ where: { sessionId: 's1' }, order: { turnIndex: 'ASC' } });
  });

  it('listTurns 无数据 → 空数组 (不报错)', async () => {
    const service = makeService(ON, repoStub([]));

    await expect(service.listTurns('s1')).resolves.toEqual([]);
  });
});

describe('WP58 · 装配 (模块 / 端口 / 护栏)', () => {
  it('审计模块注册实体 + 把实现绑到窄端口 token', () => {
    const imports = (Reflect.getMetadata('imports', TurnDeltaAuditModule) ?? []) as { module?: unknown }[];
    expect(imports.some((item) => item.module === TypeOrmModule)).toBe(true);

    const providers = (Reflect.getMetadata('providers', TurnDeltaAuditModule) ?? []) as {
      provide?: unknown;
      useExisting?: unknown;
    }[];
    expect(providers.some((item) => item.provide === TURN_DELTA_AUDIT)).toBe(true);
    expect(providers.some((item) => item.useExisting === TurnDeltaAuditService)).toBe(true);

    const exports = (Reflect.getMetadata('exports', TurnDeltaAuditModule) ?? []) as unknown[];
    expect(exports).toContain(TURN_DELTA_AUDIT);
  });

  it('引擎装配模块引入审计模块', () => {
    const imports = (Reflect.getMetadata('imports', EngineWiringModule) ?? []) as unknown[];
    expect(imports).toContain(TurnDeltaAuditModule);
  });

  it('调试面板模块也引入审计模块 (读侧与写侧同一模块 = 同一份真相)', () => {
    const imports = (Reflect.getMetadata('imports', AdminDebugChatModule) ?? []) as unknown[];
    expect(imports).toContain(TurnDeltaAuditModule);
  });

  it('装配层零 ORM 包名 (WP8-A §8-9 护栏: engine.module.ts 不得 import typeorm)', () => {
    const source = readFileSync(path.join(REPO_ROOT, 'src/engine-adapters/wiring/engine.module.ts'), 'utf8');
    const specifiers = [...source.matchAll(/from\s+'([^']+)'/g)].map((match) => match[1] ?? '');
    const thirdParty = specifiers.filter((specifier) => !specifier.startsWith('.'));
    expect(thirdParty.some((specifier) => specifier.includes('typeorm'))).toBe(false);
  });
});

describe('WP58 · 门面观测点 (turn / turnStream 两个出口)', () => {
  /**
   * 造一个引擎门面 (装配等价: 内核会话桩 + 编排器桩 + 归属登记表 + 观测端口桩).
   */
  function makeFacade(): {
    readonly facade: EngineTurnService;
    readonly registry: EngineSessionRegistry;
    readonly record: ReturnType<typeof vi.fn>;
  } {
    const registry = new EngineSessionRegistry();
    registry.register('h1', { tenantId: 't1', sessionId: 's1', visitorId: 'v1' });
    const result = {
      reply: '来访者回应',
      turnIndex: 3,
      events: ['empathy'],
      render: { fallbackUsed: false },
    } as unknown as TurnRenderResult;
    const orchestrator = {
      turn: vi.fn(async () => result),
      turnStream: vi.fn(async () => result),
    };
    const record = vi.fn();
    const facade = new EngineTurnService({} as never, orchestrator as never, registry, undefined, { record });
    return { facade, registry, record };
  }

  it('turn() 之后记一行 (归属 + 轮次 + 原话 + 内核事件类型)', async () => {
    const { facade, record } = makeFacade();

    await facade.turn('h1', { userText: '听起来你现在一定很难受' });

    expect(record).toHaveBeenCalledWith({
      tenantId: 't1',
      sessionId: 's1',
      turnIndex: 3,
      userText: '听起来你现在一定很难受',
      kernelEventKinds: ['empathy'],
    });
  });

  it('turnStream() 之后也记一行 (两条出口共用同一套闭环)', async () => {
    const { facade, record } = makeFacade();

    await facade.turnStream('h1', { userText: '听起来你现在一定很难受' }, { onDelta: () => {} });

    expect(record).toHaveBeenCalledTimes(1);
    expect(record.mock.calls[0]?.[0]).toMatchObject({ tenantId: 't1', sessionId: 's1', turnIndex: 3 });
  });

  it('归属查不到 → 静默跳过 (不炸主链路)', async () => {
    const { facade, record } = makeFacade();

    await facade.turn('h-unknown', { userText: '听起来你现在一定很难受' });

    expect(record).not.toHaveBeenCalled();
  });

  it('观测端口抛错 → turn() 照常返回 (观测是增强, 不是依赖)', async () => {
    const { facade, record } = makeFacade();
    record.mockImplementation(() => {
      throw new Error('audit boom');
    });

    await expect(facade.turn('h1', { userText: '听起来你现在一定很难受' })).resolves.toBeDefined();
  });

  it('没装配观测端口 → 照常跑 (缺席 = 不记审计)', async () => {
    const registry = new EngineSessionRegistry();
    registry.register('h1', { tenantId: 't1', sessionId: 's1', visitorId: 'v1' });
    const result = { reply: 'x', turnIndex: 1, render: { fallbackUsed: false } } as unknown as TurnRenderResult;
    const orchestrator = { turn: vi.fn(async () => result) };
    const facade = new EngineTurnService({} as never, orchestrator as never, registry);

    await expect(facade.turn('h1', { userText: '你好' })).resolves.toBeDefined();
  });
});

describe('WP58 · admin 读端点 (前端契约)', () => {
  it('路径与方法 (GET /admin/api/debug/sessions/:sessionId/delta-audit)', () => {
    expect(Reflect.getMetadata(PATH_METADATA, DebugSessionController.prototype.sessionDeltaAudit)).toBe('sessions/:sessionId/delta-audit');
    expect(Reflect.getMetadata(METHOD_METADATA, DebugSessionController.prototype.sessionDeltaAudit)).toBe(RequestMethod.GET);
  });

  it('返回 { code: 0, data: { sessionId, turns } }', async () => {
    const audit = {
      listTurns: vi.fn(async () => [{ turnIndex: 1, eventKinds: ['empathy'], eventDetails: [], rawDelta: {}, createdAt: 'now' }]),
    };
    const controller = new DebugSessionController({} as never, audit as never);

    const result = await controller.sessionDeltaAudit('s1');

    expect(result.code).toBe(0);
    expect(result.data.sessionId).toBe('s1');
    expect(result.data.turns).toHaveLength(1);
  });

  it('没有数据 → 空数组, 不报错', async () => {
    const audit = { listTurns: vi.fn(async () => []) };
    const controller = new DebugSessionController({} as never, audit as never);

    const result = await controller.sessionDeltaAudit('s1');

    expect(result.data.turns).toEqual([]);
  });
});
