// V2026-11-10 建立 (WP-J P1b · 自动对练危机指标落库 · 单测):
//   覆盖任务单 §2 / §4.3 的验收:
//     ① **成功路径**: 跑一场危机场次 → updateSessionResult 写入 6 个危机字段
//        (crisis_practiced=1 / crisis_first_turn / crisis_post_turns /
//         crisis_peak_level / crisis_category / crisis_escalated);
//     ② **失败路径**: 循环异常 → 写进去的是 emptyMetrics 的默认值
//        (0 / null / 0 / 0 / null / 0), **不是 undefined**, 更不能 throw;
//     ③ 二次升级场次 → crisis_escalated=1 且 crisis_ended=1 (两个信号独立);
//     ④ socket session_end payload 带齐 6 个危机字段;
//     ⑤ admin 场次列表默认**不带** 6 列, include=crisis 才带; 单场详情**始终**带.
//
//   全 mock: TurnEnginePort / CounselorAgentService / repo / gateway 全是替身,
//     不起容器不连 DB.
//
//   验证: npx vitest run test/auto-practice/crisis-metrics-persist.spec.ts
//   时间戳: 2026-11-10

import { describe, expect, it, vi } from 'vitest';

import { AutoPracticeController } from '../../src/auto-practice/auto-practice.controller.js';
import { AUTO_PRACTICE_EVENTS } from '../../src/auto-practice/auto-practice.events.js';
import type { CounselorGenerateOptions, CounselorHistoryTurn, CounselorReply } from '../../src/auto-practice/counselor-agent.service.js';
import { CounselorMode } from '../../src/auto-practice/entities/counselor-mode.entity.js';
import { PracticeSession } from '../../src/auto-practice/entities/practice-session.entity.js';
import type { EngineTurnResult } from '../../src/auto-practice/ports/turn-engine.port.js';
import { PracticeRunnerService } from '../../src/auto-practice/practice-runner.service.js';

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
 * 咨询师 generate 的真实签名 (显式标注给 vi.fn, 让 mockImplementation 的回调类型
 * 与线上一致 —— 否则 mock 会被当成"返回 void 的回调", 触发 no-misused-promises).
 */
type CounselorGenerateSignature = (
  mode: CounselorMode,
  history: readonly CounselorHistoryTurn[],
  options?: CounselorGenerateOptions,
) => Promise<CounselorReply>;

/** 造一个 CounselorMode 替身. */
function makeMode(): CounselorMode {
  const m = new CounselorMode();
  m.id = 'expert';
  m.name = '专家';
  m.systemPrompt = '你是专家';
  m.description = '';
  m.enabled = 1;
  m.sortOrder = 1;
  return m;
}

/** 造一轮引擎结果. */
function makeTurn(turnIndex: number, reply: string, crisisCategory: string | null = null): EngineTurnResult {
  const crisis = crisisCategory !== null;
  return {
    reply,
    turnIndex,
    crisisDetected: crisis,
    crisisCategory,
    trace: { turnIndex, crisis: { detected: crisis, category: crisisCategory } } as EngineTurnResult['trace'],
  };
}

/** 咨询师逐轮轮换的话 (彼此不近似, 避免误触发复读检测). */
const COUNSELOR_LINES = ['我先把这句接住。', '你愿意再多说一点吗？', '刚才那点我们停一下。', '我听到的是工作那部分。', '这里我们慢慢来。'];

/**
 * 假 repo: 记录 update 调用 (结算时写终态就是走 update).
 */
function stubRepo() {
  const update = vi.fn(async (_id: string, _fields: Record<string, unknown>): Promise<void> => {});
  return {
    update,
    create: (fields: unknown) => fields,
    save: vi.fn(async (row: unknown) => row),
    find: vi.fn(async () => []),
  };
}

/**
 * 假 gateway: 记录推的事件.
 */
function stubGateway() {
  return { publishToSession: vi.fn() };
}

/**
 * 造一个 runner (全替身).
 */
function makeRunner(): {
  readonly runner: PracticeRunnerService;
  readonly repo: ReturnType<typeof stubRepo>;
  readonly gateway: ReturnType<typeof stubGateway>;
  readonly engine: { turn: ReturnType<typeof vi.fn> };
  readonly counselor: { generate: ReturnType<typeof vi.fn<CounselorGenerateSignature>> };
} {
  const engine = { open: vi.fn(), turn: vi.fn(), close: vi.fn() };
  const counselor = { generate: vi.fn<CounselorGenerateSignature>() };
  const repo = stubRepo();
  const gateway = stubGateway();
  const fingerprint = {
    build: vi.fn(async () => ({
      model: 'MiniMax-M3.1-Flash',
      characterSlug: 'vpt_test',
      characterVersion: '1.0.0',
      counselorModeId: 'expert',
      deliberationMode: 'rule_only',
      scenarioType: 'full_simulation',
      engineVersion: 'test',
      sessionSeed: 'single/test',
    })),
  };
  const runner = new PracticeRunnerService(engine, counselor as never, fingerprint as never, repo as never, gateway as never);
  engine.open.mockResolvedValue({ debugSessionId: 'ds_test' });
  let turn = 0;
  counselor.generate.mockImplementation((_mode, _history, _options?) => {
    turn += 1;
    return Promise.resolve({
      text: COUNSELOR_LINES[turn % COUNSELOR_LINES.length],
      model: 'test-model',
      degraded: false,
      closeRequested: false,
    });
  });
  return { runner, repo, gateway, engine, counselor };
}

/**
 * 取结算落库时写的字段 (update 的第二个参数).
 *
 * @param repo 假 repo
 * @returns 落库字段
 */
function writtenFields(repo: ReturnType<typeof stubRepo>): Record<string, unknown> {
  const call = repo.update.mock.calls.at(-1);
  if (!call) throw new Error('updateSessionResult 没被调用');
  return call[1] ?? {};
}

describe('WP-J P1b · 危机练习窗指标落库', () => {
  it('① 成功路径: 危机场次跑完 → 6 个危机字段全部落库 (0/1 口径)', async () => {
    const setup = makeRunner();
    setup.engine.turn
      .mockResolvedValueOnce(makeTurn(1, '我最近状态还算稳'))
      .mockResolvedValueOnce(makeTurn(2, '有时候真的觉得活着没意思', 'passive_ideation'))
      .mockResolvedValueOnce(makeTurn(3, '今晚我一个人在家，没什么人'))
      .mockResolvedValueOnce(makeTurn(4, '试了呼吸，稍微能坐住了'))
      .mockResolvedValueOnce(makeTurn(5, '我姐可以过来陪我'))
      .mockResolvedValueOnce(makeTurn(6, '明天我打算去找医生聊一聊'));

    await setup.runner.run({ characterSlug: 'vpt_test', counselorMode: makeMode(), maxTurns: 8 });

    const fields = writtenFields(setup.repo);
    expect(fields['crisisPracticed']).toBe(1);
    expect(fields['crisisFirstTurn']).toBe(2);
    expect(fields['crisisPostTurns']).toBe(4);
    expect(fields['crisisPeakLevel']).toBe(1);
    expect(fields['crisisCategory']).toBe('passive_ideation');
    expect(fields['crisisEscalated']).toBe(0);
    // 旧列 crisis_ended 不动 —— 进了窗但没终止, 所以是 0.
    expect(fields['crisisEnded']).toBe(0);
  });

  it('③ 二次升级 → crisis_escalated=1 且 crisis_ended=1 (两个信号独立)', async () => {
    const setup = makeRunner();
    setup.engine.turn
      .mockResolvedValueOnce(makeTurn(1, '我最近状态还算稳'))
      .mockResolvedValueOnce(makeTurn(2, '有时候真的觉得活着没意思', 'passive_ideation'))
      .mockResolvedValueOnce(makeTurn(3, '我已经想好了，今晚就动手', 'suicide_plan'));

    await setup.runner.run({ characterSlug: 'vpt_test', counselorMode: makeMode(), maxTurns: 10 });

    const fields = writtenFields(setup.repo);
    expect(fields['crisisPracticed']).toBe(1);
    expect(fields['crisisEscalated']).toBe(1);
    expect(fields['crisisPeakLevel']).toBe(3);
    expect(fields['crisisCategory']).toBe('suicide_plan');
    // 因危机终止 (旧列) 与 进过练习窗 (新列) 同时为 1 —— 这是合法组合.
    expect(fields['crisisEnded']).toBe(1);
  });

  it('② 失败路径: 循环异常 → 6 个字段写的是默认值 (不是 undefined, 也不 throw)', async () => {
    const setup = makeRunner();
    setup.engine.turn.mockRejectedValue(new Error('engine exploded'));

    const result = await setup.runner.run({ characterSlug: 'vpt_test', counselorMode: makeMode(), maxTurns: 5 });

    expect(result.status).toBe('failed');
    const fields = writtenFields(setup.repo);
    // emptyMetrics() 的默认值 —— 语义是"这场没测到危机指标".
    expect(fields['crisisPracticed']).toBe(0);
    expect(fields['crisisFirstTurn']).toBeNull();
    expect(fields['crisisPostTurns']).toBe(0);
    expect(fields['crisisPeakLevel']).toBe(0);
    expect(fields['crisisCategory']).toBeNull();
    expect(fields['crisisEscalated']).toBe(0);
    // 关键: 一个都不能是 undefined (undefined 会被 TypeORM 当"不写"→ 列保持旧值).
    for (const key of ['crisisPracticed', 'crisisFirstTurn', 'crisisPostTurns', 'crisisPeakLevel', 'crisisCategory', 'crisisEscalated']) {
      expect(fields[key]).not.toBeUndefined();
    }
  });

  it('④ socket session_end payload 带齐 6 个危机字段', async () => {
    const setup = makeRunner();
    setup.engine.turn
      .mockResolvedValueOnce(makeTurn(1, '我最近状态还算稳'))
      .mockResolvedValueOnce(makeTurn(2, '有时候真的觉得活着没意思', 'passive_ideation'))
      .mockResolvedValueOnce(makeTurn(3, '今晚我一个人在家，没什么人'))
      .mockResolvedValueOnce(makeTurn(4, '试了呼吸，稍微能坐住了'))
      .mockResolvedValueOnce(makeTurn(5, '我姐可以过来陪我'))
      .mockResolvedValueOnce(makeTurn(6, '明天我打算去找医生聊一聊'));

    await setup.runner.run({ characterSlug: 'vpt_test', counselorMode: makeMode(), maxTurns: 8 });

    const call = setup.gateway.publishToSession.mock.calls.find((args) => args[1] === AUTO_PRACTICE_EVENTS.sessionEnd);
    expect(call).toBeDefined();
    const payload = call?.[2] as Record<string, unknown>;
    // ⚠️ WS 契约里这两个是 **boolean** (库里那两列是 0/1) —— 两套载体, 两套表示.
    expect(payload['crisisPracticed']).toBe(true);
    expect(payload['crisisPostTurns']).toBe(4);
    expect(payload['crisisFirstTurn']).toBe(2);
    expect(payload['crisisPeakLevel']).toBe(1);
    expect(payload['crisisCategory']).toBe('passive_ideation');
    expect(payload['crisisEscalated']).toBe(false);
  });

  it('⑤ 场次列表默认不带 6 列; include=crisis 才带', async () => {
    const row = {
      id: 'sess-1',
      debugSessionId: 'ds-1',
      characterSlug: 'vpt_test',
      counselorModeId: 'expert',
      status: 'completed',
      turnCount: 6,
      crisisEnded: 0,
      crisisPracticed: 1,
      crisisFirstTurn: 2,
      crisisPostTurns: 4,
      crisisPeakLevel: 1,
      crisisCategory: 'passive_ideation',
      crisisEscalated: 0,
    } as unknown as PracticeSession;
    const sessionRepo = {
      findAndCount: vi.fn(async () => [[row], 1]),
      findOne: vi.fn(async () => row),
    };
    const controller = new AutoPracticeController({} as never, {} as never, {} as never, sessionRepo as never, {} as never, {} as never);

    const plain = await controller.listSessions();
    const plainItem = plain.items[0];
    expect(plainItem['crisisPracticed']).toBeUndefined();
    expect(plainItem['crisisPostTurns']).toBeUndefined();
    // 旧列 crisis_ended 一直在列表里 (前端拿它判"因危机掉线").
    expect(plainItem['crisisEnded']).toBe(0);

    const withCrisis = await controller.listSessions(undefined, undefined, undefined, undefined, 'crisis');
    const crisisItem = withCrisis.items[0];
    expect(crisisItem['crisisPracticed']).toBe(1);
    expect(crisisItem['crisisFirstTurn']).toBe(2);
    expect(crisisItem['crisisPostTurns']).toBe(4);
    expect(crisisItem['crisisPeakLevel']).toBe(1);
    expect(crisisItem['crisisCategory']).toBe('passive_ideation');
    expect(crisisItem['crisisEscalated']).toBe(0);
  });

  it('⑤ 单场详情始终带 6 列 (复盘要看危机指标)', async () => {
    const row = {
      id: 'sess-1',
      crisisPracticed: 1,
      crisisFirstTurn: 2,
      crisisPostTurns: 4,
      crisisPeakLevel: 1,
      crisisCategory: 'passive_ideation',
      crisisEscalated: 0,
    } as unknown as PracticeSession;
    const sessionRepo = {
      findAndCount: vi.fn(async () => [[row], 1]),
      findOne: vi.fn(async () => row),
    };
    const controller = new AutoPracticeController({} as never, {} as never, {} as never, sessionRepo as never, {} as never, {} as never);

    const detail = (await controller.getSession('sess-1')) as Record<string, unknown>;
    expect(detail['crisisPracticed']).toBe(1);
    expect(detail['crisisFirstTurn']).toBe(2);
    expect(detail['crisisPostTurns']).toBe(4);
    expect(detail['crisisPeakLevel']).toBe(1);
    expect(detail['crisisCategory']).toBe('passive_ideation');
    expect(detail['crisisEscalated']).toBe(0);
  });
});
