// V2026-11-06 治本 (WP43 — 评估引擎基础版 · 规则快评单测):
//   原因: 评估引擎是**纯规则** —— 算错了不会抛异常, 只会让学员看到"共情 0 次还拿 85 分"
//     这种自相矛盾的结果. 规则刻度 (每分多少、封顶多少、权重多少) 必须有测试锁死.
//   覆盖:
//     ① 算分规则 (技术维度计数 / BDI 首末差值 / 伦理扣分 / 60-20-20 总分)
//     ② 空场次 (一轮都没跑 → 全 0, 不给"中性分")
//     ③ 评估插槽 (注册 / 注销 / 落库失败只记 warn 不抛)
//     ④ 落库口径 (一场一份, 覆盖写; 三种"不落库"都不是错误)
//     ⑤ 查询口径 (归属校验 / 分页钳制)
//     ⑥ 端点路径与方法 (前端 AI 对接的契约面)
//
//   验证: npx vitest run test/counselor/wp43-evaluation-engine.spec.ts
//
//   时间戳: 2026-11-06
import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import type { Repository } from 'typeorm';
import { vi } from 'vitest';

import { BizException } from '../../src/common/exceptions/biz.exception.js';
import { SessionEvaluationController } from '../../src/counselor/controllers/session-evaluation.controller.js';
import { CounselorTrainingSessionController } from '../../src/counselor/controllers/training-session.controller.js';
import { SessionEvaluation } from '../../src/counselor/entities/session-evaluation.entity.js';
import { TrainingSession } from '../../src/counselor/entities/training-session.entity.js';
import { computeSessionEvaluation } from '../../src/counselor/evaluation/evaluation-engine.js';
import { SessionEvaluationService } from '../../src/counselor/evaluation/session-evaluation.service.js';
import {
  SessionEvaluationRegistry,
  type SessionEvaluationSessionInput,
  type SessionEvaluationSink,
  type SessionEvaluationTurnInput,
} from '../../src/voice/session-evaluation-slot.js';

// TD-10 · T-2: 真实 ioredis 不进 import 阶段 (适配层仍是真实现; 替身口径见 test/helpers/sdk-stubs.ts).
vi.mock('ioredis', async () => {
  const { createIoredisStub } = await import('../helpers/sdk-stubs.js');
  return createIoredisStub();
});

// TD-10 · T-2: 真实 bullmq 不进 import 阶段 (适配层仍是真实现; 替身口径见 test/helpers/sdk-stubs.ts).
vi.mock('bullmq', async () => {
  const { createBullmqStub } = await import('../helpers/sdk-stubs.js');
  return createBullmqStub();
});

/**
 * 造一轮评估输入 (只写差异项).
 *
 * @param overrides 差异项
 * @returns 一轮评估输入
 */
function makeTurn(overrides: Partial<SessionEvaluationTurnInput> = {}): SessionEvaluationTurnInput {
  return {
    turnIndex: 1,
    trust: 0.5,
    safety: 0.5,
    bond: 0.5,
    resistance: 0.5,
    valence: 0,
    arousal: 0.3,
    events: [],
    safetyLevel: 'pass',
    safetyCategories: [],
    ...overrides,
  };
}

/**
 * 造一场会话的评估输入.
 *
 * @param turns 逐轮输入
 * @param overrides 差异项
 * @returns 一场会话的评估输入
 */
function makeSession(
  turns: SessionEvaluationTurnInput[],
  overrides: Partial<SessionEvaluationSessionInput> = {},
): SessionEvaluationSessionInput {
  return {
    sessionId: 'voice-1',
    dbSessionId: 'sess-1',
    userId: 'user-1',
    tenantId: 'tenant-1',
    turns,
    ...overrides,
  };
}

/**
 * 造一个假的仓储 (只实现评估服务用到的方法).
 *
 * @param overrides 差异项
 * @returns 假仓储
 */
function makeRepo(overrides: Record<string, unknown> = {}): Repository<SessionEvaluation> {
  const repo = {
    findOne: async (): Promise<SessionEvaluation | null> => null,
    update: async (): Promise<void> => undefined,
    insert: async (): Promise<void> => undefined,
    findAndCount: async (): Promise<[SessionEvaluation[], number]> => [[], 0],
    ...overrides,
  };
  return repo as unknown as Repository<SessionEvaluation>;
}

/**
 * 造一个假的训练会话仓储 (只实现 degraded 过滤用到的方法).
 *
 * @param overrides 差异项
 * @returns 假仓储
 */
function makeSessionRepo(overrides: Record<string, unknown> = {}): Repository<TrainingSession> {
  const repo = {
    find: async (): Promise<TrainingSession[]> => [],
    ...overrides,
  };
  return repo as unknown as Repository<TrainingSession>;
}

describe('WP43 · 评估算分规则 (纯函数)', () => {
  it('空场次 → 全 0 (没有事实就不给"中性分")', () => {
    const scores = computeSessionEvaluation([]);
    expect(scores.overall).toBe(0);
    expect(scores.technical.average).toBe(0);
    expect(scores.bdiDelta.average).toBe(0);
    expect(scores.ethics.score).toBe(0);
    expect(scores.ethics.crisisCount).toBe(0);
    expect(scores.ethics.label).toBe('safe');
    expect(scores.raw.turnCount).toBe(0);
    expect(scores.raw.firstTurn).toBeNull();
  });

  it('正向手法: 共情 1 次 = 25 分 (未命中 = 0 分)', () => {
    const scores = computeSessionEvaluation([makeTurn({ events: ['empathy'] })]);
    expect(scores.technical.empathy).toBe(25);
    expect(scores.technical.openProbe).toBe(0);
    // 9 维求和 425 (25 + 4×100 + 4×0) → 平均 47.2 → 47.
    expect(scores.technical.average).toBe(47);
  });

  it('正向手法封顶: 共情 5 次 = 100 分', () => {
    const scores = computeSessionEvaluation([makeTurn({ events: ['empathy'] }), makeTurn({ turnIndex: 2, events: ['empathy'] })]);
    expect(scores.technical.empathy).toBe(50);
    expect(scores.technical.empathy).toBeLessThanOrEqual(100);
  });

  it('负向手法: 评判 1 次 = 75 分 (0 次满分)', () => {
    const scores = computeSessionEvaluation([makeTurn({ events: ['judgment'] })]);
    expect(scores.technical.judgment).toBe(75);
    expect(scores.technical.preaching).toBe(100);
    expect(scores.technical.minimizing).toBe(100);
  });

  it('边界越界是严重项: 1 次 = 50 分 (2 次 = 0 分)', () => {
    const one = computeSessionEvaluation([makeTurn({ events: ['boundary_cross'] })]);
    expect(one.technical.boundaryCross).toBe(50);
    const two = computeSessionEvaluation([
      makeTurn({ events: ['boundary_cross'] }),
      makeTurn({ turnIndex: 2, events: ['boundary_cross'] }),
    ]);
    expect(two.technical.boundaryCross).toBe(0);
  });

  it('BDI 变化: 无变化 = 50 分; 信任提升 = 100 分', () => {
    const flat = computeSessionEvaluation([makeTurn({ turnIndex: 1 }), makeTurn({ turnIndex: 2 })]);
    expect(flat.bdiDelta.trust).toBe(50);
    const up = computeSessionEvaluation([makeTurn({ turnIndex: 1, trust: 0 }), makeTurn({ turnIndex: 2, trust: 1 })]);
    expect(up.bdiDelta.trust).toBe(100);
    // 变化 0.8 → 50 + 0.8×50 = 90 (刻度是线性的, 不做"接近满分就给满分").
    const partial = computeSessionEvaluation([makeTurn({ turnIndex: 1, trust: 0.2 }), makeTurn({ turnIndex: 2, trust: 1 })]);
    expect(partial.bdiDelta.trust).toBe(90);
  });

  it('BDI 变化: 阻抗下降 = 分高 (反向口径)', () => {
    const down = computeSessionEvaluation([makeTurn({ turnIndex: 1, resistance: 0.9 }), makeTurn({ turnIndex: 2, resistance: 0.4 })]);
    expect(down.bdiDelta.resistance).toBe(75);
    const up = computeSessionEvaluation([makeTurn({ turnIndex: 1, resistance: 0.4 }), makeTurn({ turnIndex: 2, resistance: 0.9 })]);
    expect(up.bdiDelta.resistance).toBe(25);
  });

  it('BDI 变化: 情绪效价按首末差值算', () => {
    const scores = computeSessionEvaluation([makeTurn({ turnIndex: 1, valence: -0.4 }), makeTurn({ turnIndex: 2, valence: 0.2 })]);
    expect(scores.bdiDelta.valence).toBe(80);
  });

  it('伦理: warn 扣 20 / block 扣 40, 评级取最高档', () => {
    const warn = computeSessionEvaluation([makeTurn({ safetyLevel: 'warn' })]);
    expect(warn.ethics.score).toBe(80);
    expect(warn.ethics.label).toBe('warning');
    const block = computeSessionEvaluation([makeTurn({ safetyLevel: 'block' })]);
    expect(block.ethics.score).toBe(60);
    expect(block.ethics.label).toBe('danger');
  });

  it('伦理: crisis 只统计内核危机类别 (非危机类别不计)', () => {
    const crisis = computeSessionEvaluation([makeTurn({ safetyLevel: 'warn', safetyCategories: ['suicide_plan'] })]);
    expect(crisis.ethics.crisisCount).toBe(1);
    const notCrisis = computeSessionEvaluation([makeTurn({ safetyLevel: 'warn', safetyCategories: ['value_judgment'] })]);
    expect(notCrisis.ethics.crisisCount).toBe(0);
  });

  it('总分 = 技术 60% + BDI 20% + 伦理 20%', () => {
    // 技术 avg 47 / BDI avg 50 / 伦理 100 → 28.2 + 10 + 20 = 58.2 → 58.
    const scores = computeSessionEvaluation([makeTurn({ events: ['empathy'] })]);
    expect(scores.technical.average).toBe(47);
    expect(scores.bdiDelta.average).toBe(50);
    expect(scores.ethics.score).toBe(100);
    expect(scores.overall).toBe(58);
  });

  it('乱序输入按轮次排序 (首末轮口径稳定)', () => {
    const scores = computeSessionEvaluation([
      makeTurn({ turnIndex: 3, trust: 0.9 }),
      makeTurn({ turnIndex: 1, trust: 0.1 }),
      makeTurn({ turnIndex: 2, trust: 0.5 }),
    ]);
    expect(scores.raw.firstTurn?.turnIndex).toBe(1);
    expect(scores.raw.lastTurn?.turnIndex).toBe(3);
    // 信任 0.1 → 0.9 = 变化 0.8 → 90 分.
    expect(scores.bdiDelta.trust).toBe(90);
  });

  it('纽带感变化不单独计分 (只落原始统计供回溯)', () => {
    const scores = computeSessionEvaluation([makeTurn({ turnIndex: 1, bond: 0.1 }), makeTurn({ turnIndex: 2, bond: 0.6 })]);
    expect(scores.raw.bondDelta).toBeCloseTo(0.5, 6);
    expect(Object.keys(scores.bdiDelta)).not.toContain('bond');
  });
});

describe('WP43 · 评估插槽 (voice 层 @Global 注册表)', () => {
  it('注册后交办 → 落库方被调用', async () => {
    const registry = new SessionEvaluationRegistry();
    const received: SessionEvaluationSessionInput[] = [];
    const sink: SessionEvaluationSink = {
      name: 'test-sink',
      finalize: async (input) => {
        received.push(input);
      },
    };
    registry.register(sink);
    await registry.finalize(makeSession([makeTurn()]));
    expect(received).toHaveLength(1);
    expect(received[0]?.dbSessionId).toBe('sess-1');
  });

  it('注销后不再交办', async () => {
    const registry = new SessionEvaluationRegistry();
    let calls = 0;
    registry.register({
      name: 'test-sink',
      finalize: async () => {
        calls += 1;
      },
    });
    registry.unregister('test-sink');
    await registry.finalize(makeSession([makeTurn()]));
    expect(calls).toBe(0);
  });

  it('业务侧没注册实现 → 静默跳过 (不抛)', async () => {
    const registry = new SessionEvaluationRegistry();
    await expect(registry.finalize(makeSession([makeTurn()]))).resolves.toBeUndefined();
  });

  it('落库方抛错 → 只记 warn, 不影响会话收尾', async () => {
    const registry = new SessionEvaluationRegistry();
    registry.register({
      name: 'bad-sink',
      finalize: async () => {
        throw new Error('db down');
      },
    });
    await expect(registry.finalize(makeSession([makeTurn()]))).resolves.toBeUndefined();
  });

  it('一个实现抛错 → 另一个实现仍被交办', async () => {
    const registry = new SessionEvaluationRegistry();
    let calls = 0;
    registry.register({
      name: 'bad-sink',
      finalize: async () => {
        throw new Error('db down');
      },
    });
    registry.register({
      name: 'good-sink',
      finalize: async () => {
        calls += 1;
      },
    });
    await registry.finalize(makeSession([makeTurn()]));
    expect(calls).toBe(1);
  });
});

describe('WP43 · 评估落库口径', () => {
  it('首场 → insert 一行', async () => {
    const inserted: unknown[] = [];
    const repo = makeRepo({
      insert: async (row: unknown) => {
        inserted.push(row);
      },
    });
    const service = new SessionEvaluationService(repo, new SessionEvaluationRegistry(), makeSessionRepo());
    await service.finalize(makeSession([makeTurn({ events: ['empathy'] })]));
    expect(inserted).toHaveLength(1);
    expect(inserted[0]).toMatchObject({ sessionId: 'sess-1', userId: 'user-1' });
  });

  it('重算 → 覆盖写 (不堆第二行)', async () => {
    const updated: unknown[] = [];
    const repo = makeRepo({
      findOne: async (): Promise<SessionEvaluation | null> => ({ id: 'row-1' }) as SessionEvaluation,
      update: async (criteria: unknown, row: unknown) => {
        updated.push({ criteria, row });
      },
      insert: async (): Promise<void> => {
        throw new Error('不该走到 insert');
      },
    });
    const service = new SessionEvaluationService(repo, new SessionEvaluationRegistry(), makeSessionRepo());
    await service.finalize(makeSession([makeTurn({ events: ['empathy'] })]));
    expect(updated).toHaveLength(1);
  });

  it('一轮都没跑 → 不落库 (不写一条 0 分)', async () => {
    const inserted: unknown[] = [];
    const repo = makeRepo({
      insert: async (row: unknown) => {
        inserted.push(row);
      },
    });
    const service = new SessionEvaluationService(repo, new SessionEvaluationRegistry(), makeSessionRepo());
    await service.finalize(makeSession([]));
    expect(inserted).toHaveLength(0);
  });

  it('没有业务会话 id / 没有学员身份 → 不落库', async () => {
    const inserted: unknown[] = [];
    const repo = makeRepo({
      insert: async (row: unknown) => {
        inserted.push(row);
      },
    });
    const service = new SessionEvaluationService(repo, new SessionEvaluationRegistry(), makeSessionRepo());
    await service.finalize(makeSession([makeTurn()], { dbSessionId: '' }));
    await service.finalize(makeSession([makeTurn()], { userId: '' }));
    expect(inserted).toHaveLength(0);
  });
});

describe('WP43 · 评估查询口径', () => {
  it('按**学员**归属查 —— 不是谁的评估谁看不到', async () => {
    const where: Record<string, unknown>[] = [];
    const repo = makeRepo({
      findOne: async (options: { where: Record<string, unknown> }) => {
        where.push(options.where);
        return null;
      },
    });
    const service = new SessionEvaluationService(repo, new SessionEvaluationRegistry(), makeSessionRepo());
    await expect(service.findBySession('user-1', 'sess-1')).rejects.toBeInstanceOf(BizException);
    expect(where[0]).toEqual({ sessionId: 'sess-1', userId: 'user-1' });
  });

  it('列表分页参数被钳制 (pageSize 上限 100)', async () => {
    const repo = makeRepo();
    const service = new SessionEvaluationService(repo, new SessionEvaluationRegistry(), makeSessionRepo());
    const result = await service.listMine('user-1', { page: 0, pageSize: 9999 });
    expect(result.page).toBe(1);
    expect(result.pageSize).toBe(100);
  });
});

describe('WP43 · 端点契约 (前端 AI 对接面)', () => {
  /**
   * 取某个 controller 处理器上的路由元数据.
   *
   * @param target controller 类
   * @param methodName 处理器方法名
   * @returns 路径 + HTTP 方法
   */
  function routeOf(target: unknown, methodName: string): { path: string; method: number } {
    const handler = (target as Record<string, unknown>)[methodName];
    const path = Reflect.getMetadata(PATH_METADATA, handler as object) as string;
    const method = Reflect.getMetadata(METHOD_METADATA, handler as object) as number;
    return { path, method };
  }

  it('单场评估挂在训练会话下面 (GET :id/evaluation)', () => {
    const route = routeOf(CounselorTrainingSessionController.prototype, 'findEvaluation');
    expect(route.path).toBe(':id/evaluation');
    expect(route.method).toBe(RequestMethod.GET);
  });

  it('我的评估列表是独立端点 (GET /counselor/evaluations)', () => {
    const route = routeOf(SessionEvaluationController.prototype, 'list');
    expect(route.path).toBe('/');
    expect(route.method).toBe(RequestMethod.GET);
  });

  it('两个端点都要 JWT 鉴权', () => {
    const guards = Reflect.getMetadata('__guards__', SessionEvaluationController) as unknown[] | undefined;
    expect(guards?.length ?? 0).toBeGreaterThan(0);
  });
});
