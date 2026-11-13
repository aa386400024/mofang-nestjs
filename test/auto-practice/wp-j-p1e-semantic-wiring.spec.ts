// V2026-11-10 建立 (WP-J P1e Phase2 — 离线接线 · runner 单测):
//   覆盖交付记录 §验收:
//     ① **只来访者侧**: persister 收到的是来访者回复 (result.reply), 不是咨询师台词;
//     ② **三个落库条件**: 非降级 / 非空回复 → 才落; 降级轮与空轮 → 不落;
//     ③ **失败不炸**: persister 抛错 → 整场照常跑完 (只是那一轮语义没落);
//     ④ **gateway 事件不变**: 推的仍是**原始带标签文本** (标注台要看到标签);
//     ⑤ **没注入 persister 也能跑** (optional 注入).
//
//   全 mock: 引擎 / 咨询师 / repo / gateway / persister 全是替身.
//
//   验证: npx vitest run test/auto-practice/wp-j-p1e-semantic-wiring.spec.ts
//   时间戳: 2026-11-10

import { describe, expect, it, vi } from 'vitest';

import { AUTO_PRACTICE_EVENTS } from '../../src/auto-practice/auto-practice.events.js';
import type { CounselorGenerateOptions, CounselorHistoryTurn, CounselorReply } from '../../src/auto-practice/counselor-agent.service.js';
import { CounselorMode } from '../../src/auto-practice/entities/counselor-mode.entity.js';
import type { EngineTurnResult } from '../../src/auto-practice/ports/turn-engine.port.js';
import { PracticeRunnerService } from '../../src/auto-practice/practice-runner.service.js';

// TD-10 · T-2: 真实 ioredis 不进 import 阶段 (适配层仍是真实现; 替身口径见 test/helpers/sdk-stubs.ts).
vi.mock('ioredis', async () => {
  const { createIoredisStub } = await import('../helpers/sdk-stubs.js');
  return createIoredisStub();
});

/** 咨询师 generate 的真实签名 (显式标注, 让 mockImplementation 的回调类型与线上一致). */
type CounselorGenerateSignature = (
  mode: CounselorMode,
  history: readonly CounselorHistoryTurn[],
  options?: CounselorGenerateOptions,
) => Promise<CounselorReply>;

/**
 * 造一个 CounselorMode 替身.
 *
 * @returns 模式替身
 */
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

/**
 * 造一轮引擎结果.
 *
 * @param turnIndex 轮次
 * @param reply 来访者回复
 * @param degraded 是否走了渲染兜底
 * @returns 引擎结果
 */
function makeTurn(turnIndex: number, reply: string, degraded = false): EngineTurnResult {
  return {
    reply,
    turnIndex,
    crisisDetected: false,
    crisisCategory: null,
    trace: { turnIndex, degraded, crisis: { detected: false, category: null } } as EngineTurnResult['trace'],
  };
}

/** 咨询师逐轮轮换的话 (彼此不近似, 避免误触发复读检测). */
const COUNSELOR_LINES = ['我先把这句接住。', '你愿意再多说一点吗？', '刚才那点我们停一下。', '我听到的是工作那部分。', '这里我们慢慢来。'];

/**
 * 假 repo.
 *
 * @returns 替身 repo
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
 * 造一个 runner (全替身).
 *
 * @param withPersister 是否注入 persister 替身
 * @returns runner + 各替身
 */
function makeRunner(withPersister = true): {
  readonly runner: PracticeRunnerService;
  readonly repo: ReturnType<typeof stubRepo>;
  readonly gateway: { publishToSession: ReturnType<typeof vi.fn> };
  readonly engine: { turn: ReturnType<typeof vi.fn> };
  readonly counselor: { generate: ReturnType<typeof vi.fn<CounselorGenerateSignature>> };
  readonly persister: { persistVisitorTurn: ReturnType<typeof vi.fn> };
} {
  const engine = { open: vi.fn(), turn: vi.fn(), close: vi.fn() };
  const counselor = { generate: vi.fn<CounselorGenerateSignature>() };
  const repo = stubRepo();
  const gateway = { publishToSession: vi.fn() };
  const persister = { persistVisitorTurn: vi.fn(async () => {}) };
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
  engine.open.mockResolvedValue({ debugSessionId: 'ds_test' });
  // 兜底: 没被 mockResolvedValueOnce 命中的轮次也要给个**合法**结果 ——
  //   引擎返回 undefined 会让 runner 直接炸 (status=failed), 测的就不是接线了.
  let defaultTurn = 0;
  engine.turn.mockImplementation(async () => {
    defaultTurn += 1;
    return makeTurn(defaultTurn, '兜底回复' + defaultTurn);
  });
  let turn = 0;
  counselor.generate.mockImplementation(() => {
    turn += 1;
    return Promise.resolve({
      text: COUNSELOR_LINES[turn % COUNSELOR_LINES.length],
      model: 'test-model',
      degraded: false,
      closeRequested: false,
    });
  });
  const runner = withPersister
    ? new PracticeRunnerService(
        engine,
        counselor as never,
        fingerprint as never,
        repo as never,
        gateway as never,
        undefined,
        persister as never,
      )
    : new PracticeRunnerService(engine, counselor as never, fingerprint as never, repo as never, gateway as never, undefined);
  return { runner, repo, gateway, engine, counselor, persister };
}

describe('WP-J P1e Phase2 · 离线接线 (runner → persister)', () => {
  it('① 非降级 + 非空 → 落一次, 参数是来访者回复', async () => {
    const setup = makeRunner();
    setup.engine.turn.mockResolvedValueOnce(makeTurn(1, '[sigh]我最近有点累。'));

    await setup.runner.run({ characterSlug: 'vpt_test', counselorMode: makeMode(), maxTurns: 1 });

    expect(setup.persister.persistVisitorTurn).toHaveBeenCalledTimes(1);
    const args = setup.persister.persistVisitorTurn.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(args['turnIndex']).toBe(1);
    expect(args['rawVisitorText']).toBe('[sigh]我最近有点累。');
    expect(typeof args['practiceSessionId']).toBe('string');
  });

  it('② 落的是**来访者**的话, 不是咨询师的话', async () => {
    const setup = makeRunner();
    setup.engine.turn.mockResolvedValueOnce(makeTurn(1, '来访者这一轮说的话'));

    await setup.runner.run({ characterSlug: 'vpt_test', counselorMode: makeMode(), maxTurns: 1 });

    const args = setup.persister.persistVisitorTurn.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(args['rawVisitorText']).toBe('来访者这一轮说的话');
    expect(String(args['rawVisitorText'])).not.toContain('我先把这句接住');
  });

  it('③ 渲染降级轮 → 不落 (那不是来访者真说的话)', async () => {
    const setup = makeRunner();
    setup.engine.turn.mockResolvedValueOnce(makeTurn(1, '我先缓一下，我们接着说。', true));

    await setup.runner.run({ characterSlug: 'vpt_test', counselorMode: makeMode(), maxTurns: 1 });

    expect(setup.persister.persistVisitorTurn).not.toHaveBeenCalled();
  });

  it('④ 空回复轮 → 不落', async () => {
    const setup = makeRunner();
    setup.engine.turn.mockResolvedValueOnce(makeTurn(1, ' '.repeat(3)));

    await setup.runner.run({ characterSlug: 'vpt_test', counselorMode: makeMode(), maxTurns: 1 });

    expect(setup.persister.persistVisitorTurn).not.toHaveBeenCalled();
  });

  it('⑤ persister 抛错 → 整场照常跑完 (不炸)', async () => {
    const setup = makeRunner();
    setup.persister.persistVisitorTurn.mockRejectedValueOnce(new Error('db down'));
    setup.engine.turn.mockResolvedValueOnce(makeTurn(1, '第一轮来访者的话')).mockResolvedValueOnce(makeTurn(2, '第二轮来访者的话'));

    const result = await setup.runner.run({ characterSlug: 'vpt_test', counselorMode: makeMode(), maxTurns: 2 });

    expect(result.status).not.toBe('failed');
    expect(setup.persister.persistVisitorTurn).toHaveBeenCalledTimes(2);
  });

  it('⑥ gateway 事件仍推**原始带标签文本** (标注台要看到标签)', async () => {
    const setup = makeRunner();
    setup.engine.turn.mockResolvedValueOnce(makeTurn(1, '[sigh]我最近有点累。'));

    await setup.runner.run({ characterSlug: 'vpt_test', counselorMode: makeMode(), maxTurns: 1 });

    const call = setup.gateway.publishToSession.mock.calls.find((item: unknown[]) => item[1] === AUTO_PRACTICE_EVENTS.turn);
    expect(call).toBeDefined();
    const payload = call?.[2] as Record<string, unknown>;
    expect(payload['visitorText']).toBe('[sigh]我最近有点累。');
  });

  it('⑦ 没注入 persister → 也能正常跑完 (optional 注入)', async () => {
    const setup = makeRunner(false);
    setup.engine.turn.mockResolvedValueOnce(makeTurn(1, '来访者的话'));

    const result = await setup.runner.run({ characterSlug: 'vpt_test', counselorMode: makeMode(), maxTurns: 1 });

    expect(result.status).not.toBe('failed');
    expect(setup.persister.persistVisitorTurn).not.toHaveBeenCalled();
  });
});
