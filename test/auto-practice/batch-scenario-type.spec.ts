// V2026-11-17 (AF-065 · 批次入口 scenarioType 透传与 exam 入口补齐):
//   锁住三段链路, 一段都不许悄悄退化:
//     ① HTTP 入口: POST /admin/api/auto-practice/batch 接受 scenarioType,
//        非法值**明确报错** —— 绝不静默回落 `full_simulation`;
//     ② 队列:     enqueue 把 scenarioType 原样写进 job data (没给就**不带**这个键);
//     ③ worker:   processJob 把 job data 的 scenarioType 原样透传给 runner.run(),
//        没给时仍由 runner 侧兜 `full_simulation` (缺省语义只留一份).
//
//   为什么值得单测: `exam` 是**考核场景**, 走"锁版本 / 锁温度 / 逐字复现"红线
//   (审议恒 `rule_only`) —— 入口把拼错的 `exam` 悄悄跑成 `full_simulation`,
//   产出一批"看着像考核"的普通数据, 事后没人查得出来.
//
//   测法: 真 Nest app (supertest 打**真路由** + 真 body 解析) + 真 PracticeQueueService;
//   只把 runner / repo / bullmq / ioredis 打桩. 不起 DB, 不连 LLM, 不改任何运行态.
//   验证: pnpm exec vitest run test/auto-practice/batch-scenario-type.spec.ts

import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import supertest from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AdminRoleGuard } from '../../src/admin-debug/guards/admin-role.guard.js';
import { AutoPracticeController } from '../../src/auto-practice/auto-practice.controller.js';
import { CounselorMode } from '../../src/auto-practice/entities/counselor-mode.entity.js';
import { PracticeBatch } from '../../src/auto-practice/entities/practice-batch.entity.js';
import { PracticeSession } from '../../src/auto-practice/entities/practice-session.entity.js';
import { PracticeBatchHealthService } from '../../src/auto-practice/practice-batch-health.service.js';
import { PracticeQueueService, type AutoPracticeJobData } from '../../src/auto-practice/practice-queue.service.js';
import { PracticeRunnerService } from '../../src/auto-practice/practice-runner.service.js';

// TD-10 · T-2: 真实 ioredis 不进 import 阶段 (适配层仍是真实现; 替身口径见 test/helpers/sdk-stubs.ts).
vi.mock('ioredis', async () => {
  const { createIoredisStub } = await import('../helpers/sdk-stubs.js');
  return createIoredisStub();
});

/**
 * bullmq 替身: **捕获**入队 payload 与 Worker 处理器.
 *
 * ⚠️ 为什么自己写而不复用 `test/helpers/sdk-stubs.ts`: 那个替身的 `Queue.add`
 *   一被调用就当场炸 (防"静默返 undefined"的假绿) —— 但本用例**就是要**断言
 *   "入队 payload 里带了什么", 必须能真的 add.
 */
const bull = vi.hoisted(() => ({
  /** 每次 `Queue.add` 的 payload (原样记录, 不加工). */
  added: [] as unknown[],
  /** Worker 的处理函数 (onModuleInit 时被 Service 注册). */
  processor: null as null | ((job: { data: unknown }) => Promise<void>),
}));

vi.mock('bullmq', () => {
  class QueueStub {
    async add(_name: string, data: unknown, _opts?: unknown): Promise<void> {
      bull.added.push(data);
    }

    on(): this {
      return this;
    }

    async close(): Promise<void> {}
  }

  class WorkerStub {
    constructor(_name: string, processor: (job: { data: unknown }) => Promise<void>) {
      bull.processor = processor;
    }

    on(): this {
      return this;
    }

    async close(): Promise<void> {}
  }

  class JobStub {}

  return { Queue: QueueStub, Worker: WorkerStub, Job: JobStub };
});

/** 批次入口的入参体 (只挑本用例关心的字段). */
interface BatchRequestBody {
  characterSlugs: string[];
  counselorModeIds: string[];
  maxTurns?: number;
  repeats?: number;
  scenarioType?: string;
}

/** 队列入队调用记录 (替身). */
interface QueueStub {
  enqueue: ReturnType<typeof vi.fn>;
}

/** runner.run 的入参 (只挑本用例关心的字段). */
interface RunnerCall {
  characterSlug: string;
  counselorModeId: string;
  maxTurns: number;
  batchId: string;
  scenarioType?: string;
}

describe('AF-065 · 批次入口 scenarioType 透传', () => {
  let app: INestApplication;
  let queue: QueueStub;
  let enqueued: AutoPracticeJobData[];

  beforeEach(async () => {
    enqueued = [];
    queue = {
      enqueue: vi.fn(async (data: AutoPracticeJobData) => {
        enqueued.push(data);
      }),
    };

    const moduleRef = await Test.createTestingModule({
      controllers: [AutoPracticeController],
      providers: [
        { provide: PracticeRunnerService, useValue: { run: vi.fn(async () => ({})) } },
        { provide: PracticeQueueService, useValue: queue },
        { provide: PracticeBatchHealthService, useValue: { refreshBatch: vi.fn(async () => ({})) } },
        { provide: getRepositoryToken(PracticeSession), useValue: { findAndCount: vi.fn(async () => [[], 0]) } },
        { provide: getRepositoryToken(CounselorMode), useValue: { findOne: vi.fn(async () => null) } },
        { provide: getRepositoryToken(PracticeBatch), useValue: { findOne: vi.fn(async () => null) } },
      ],
    })
      // 角色守卫本轮不测 (DB 真值判定另有用例): 这里只放行, 守住"路由 + body 解析 + 透传"这条链.
      .overrideGuard(AdminRoleGuard)
      .useValue({ canActivate: () => true })
      .compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  /** 打真路由 (POST /admin/api/auto-practice/batch). */
  async function postBatch(body: BatchRequestBody) {
    return supertest(app.getHttpServer()).post('/admin/api/auto-practice/batch').send(body);
  }

  it('exam: HTTP 入口接受 scenarioType=exam, 且原样写进每个排队 job', async () => {
    const res = await postBatch({
      characterSlugs: ['vpt_a'],
      counselorModeIds: ['expert'],
      scenarioType: 'exam',
    });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ enqueued: 1 });
    expect(res.body.error).toBeUndefined();
    expect(enqueued).toHaveLength(1);
    // 原样透传: 不改写、不映射、不丢.
    expect(enqueued[0]?.scenarioType).toBe('exam');
    expect(enqueued[0]?.characterSlug).toBe('vpt_a');
    expect(enqueued[0]?.counselorModeId).toBe('expert');
  });

  it('exam: 笛卡尔积的每个组合都带同一个 scenarioType', async () => {
    const res = await postBatch({
      characterSlugs: ['vpt_a', 'vpt_b'],
      counselorModeIds: ['expert', 'novice'],
      scenarioType: 'exam',
    });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ enqueued: 4 });
    expect(enqueued).toHaveLength(4);
    for (const job of enqueued) {
      expect(job.scenarioType).toBe('exam');
    }
  });

  it('缺省: 不传 scenarioType → job data 不带这个键 (缺省由 runner 兜 full_simulation)', async () => {
    const res = await postBatch({
      characterSlugs: ['vpt_a'],
      counselorModeIds: ['expert'],
    });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ enqueued: 1 });
    expect(enqueued).toHaveLength(1);
    // ⚠️ 关键: 不是"写成 full_simulation", 而是**整个键不写** ——
    //   缺省语义只留一份 (runner 侧), 入口再写一份就迟早漂移.
    expect(Object.hasOwn(enqueued[0] ?? {}, 'scenarioType')).toBe(false);
    expect(enqueued[0]?.scenarioType).toBeUndefined();
  });

  it('非法值: scenarioType 拼错 → 明确报错, 一个 job 都不入队 (不静默降级)', async () => {
    const res = await postBatch({
      characterSlugs: ['vpt_a'],
      counselorModeIds: ['expert'],
      scenarioType: 'exam-mode',
    });

    expect(typeof res.body.error).toBe('string');
    expect(res.body.error).toContain('scenarioType');
    expect(res.body.error).toContain('exam-mode');
    // 报错里必须带上可选项, 让调用方知道该怎么改.
    expect(res.body.error).toContain('freeform');
    expect(res.body.error).toContain('full_simulation');
    expect(res.body.error).toContain('exam');
    // 关键: 非法值**不许**入队 (否则脏场景已经在跑, 报错了也拦不住).
    expect(enqueued).toHaveLength(0);
    expect(queue.enqueue).not.toHaveBeenCalled();
  });

  it('非法值: 空字符串同样判非法 (不当作"没传")', async () => {
    const res = await postBatch({
      characterSlugs: ['vpt_a'],
      counselorModeIds: ['expert'],
      scenarioType: ' '.repeat(3),
    });

    expect(typeof res.body.error).toBe('string');
    expect(enqueued).toHaveLength(0);
  });

  it('freeform: 自由练习场景同样可从生产入口创建', async () => {
    const res = await postBatch({
      characterSlugs: ['vpt_a'],
      counselorModeIds: ['expert'],
      scenarioType: 'freeform',
    });

    expect(res.status).toBe(201);
    expect(enqueued[0]?.scenarioType).toBe('freeform');
  });
});

describe('AF-065 · 队列 → worker → runner 的 scenarioType 透传', () => {
  let runCalls: RunnerCall[];
  let service: PracticeQueueService;

  beforeEach(async () => {
    bull.added.length = 0;
    bull.processor = null;
    runCalls = [];

    const mode = new CounselorMode();
    mode.id = 'expert';
    mode.name = '专家';
    mode.systemPrompt = '你是专家';
    mode.enabled = 1;

    const runner = {
      run: vi.fn(async (input: RunnerCall) => {
        runCalls.push(input);
        return {};
      }),
    };
    const redis = { getBullClient: vi.fn(() => ({})) };
    const batchHealth = {
      refreshBatch: vi.fn(async () => ({ allSessionsFinished: false, health: { valid: true, flags: [] } })),
    };
    const modeRepo = { findOne: vi.fn(async () => mode) };

    service = new PracticeQueueService(
      redis as unknown as never,
      runner as unknown as PracticeRunnerService,
      batchHealth as unknown as PracticeBatchHealthService,
      modeRepo as unknown as never,
    );
    await service.onModuleInit();
  });

  afterEach(async () => {
    await service.onModuleDestroy();
  });

  it('enqueue: scenarioType 原样进 job payload (薄 payload 纪律不变)', async () => {
    await service.enqueue({
      characterSlug: 'vpt_a',
      counselorModeId: 'expert',
      maxTurns: 15,
      batchId: 'batch-1',
      scenarioType: 'exam',
    });

    expect(bull.added).toHaveLength(1);
    expect(bull.added[0]).toMatchObject({
      characterSlug: 'vpt_a',
      counselorModeId: 'expert',
      maxTurns: 15,
      batchId: 'batch-1',
      scenarioType: 'exam',
    });
  });

  it('worker: job data 带 exam → runner.run 原样收到 exam', async () => {
    const processor = bull.processor;
    expect(processor).not.toBeNull();

    await processor?.({
      data: {
        characterSlug: 'vpt_a',
        counselorModeId: 'expert',
        maxTurns: 15,
        batchId: 'batch-2',
        scenarioType: 'exam',
      },
    });

    expect(runCalls).toHaveLength(1);
    expect(runCalls[0]?.scenarioType).toBe('exam');
    expect(runCalls[0]?.characterSlug).toBe('vpt_a');
  });

  it('worker: job data 不带场景 → runner 收到的仍是 undefined (缺省 full_simulation 由 runner 兜)', async () => {
    const processor = bull.processor;
    expect(processor).not.toBeNull();

    await processor?.({
      data: {
        characterSlug: 'vpt_a',
        counselorModeId: 'expert',
        maxTurns: 15,
        batchId: 'batch-3',
      },
    });

    expect(runCalls).toHaveLength(1);
    expect(runCalls[0]?.scenarioType).toBeUndefined();
    // runner 侧的缺省口径 (`input.scenarioType ?? 'full_simulation'`) 仍成立.
    expect(runCalls[0]?.scenarioType ?? 'full_simulation').toBe('full_simulation');
  });
});
