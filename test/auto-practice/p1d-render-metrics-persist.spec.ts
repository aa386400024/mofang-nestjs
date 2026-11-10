// V2026-11-10 建立 (WP-J P1d · 渲染兜底 / 真实调用两列落库 · 单测):
//   覆盖交付记录 §8 #2 的验收:
//     ① **成功路径**: 一场里若干正常轮 + 1 个访客侧渲染兜底轮
//        → llm_call_turns = 正常轮数, render_fallback_turns = 兜底轮数;
//     ② **阻断轮不算调用**: 来访者一个字都没说 (reply 为空, 但没降级)
//        → 不计入 llm_call_turns (那轮根本没调 LLM);
//     ③ **口径分离**: 咨询师侧降级计入 degraded_turns, 但**不**计入
//        render_fallback_turns (后者只算访客侧那一半);
//     ④ **不是 maxTurns**: maxTurns=10 但第 3 轮收尾 → llm_call_turns=3
//        (证明口径是"真调了几轮", 不是拿 maxTurns 冒充);
//     ⑤ **失败路径**: 循环异常 → 两列落 0 (不是 undefined, 也不 throw).
//
//   关于"轮数怎么钉住" (为什么每条都断言 turnCount):
//     循环的退出条件有三个 (maxTurns / 停滞 / 收尾请求), 替身一旦把 mock 用尽,
//     engine.turn 会返回 undefined → 抛错 → 整场落进 failed 路径 (两列全 0),
//     断言会**假绿**. 所以每条用例都用 turnCount 把"实际跑了多少轮"钉住,
//     再看两列 —— 计数口径才验得实.
//
//   全 mock: TurnEnginePort / CounselorAgentService / repo / gateway 全是替身,
//     不起容器不连 DB.
//
//   验证: npx vitest run test/auto-practice/p1d-render-metrics-persist.spec.ts
//   时间戳: 2026-11-10

import { describe, expect, it, vi } from 'vitest';

import type { CounselorGenerateOptions, CounselorHistoryTurn, CounselorReply } from '../../src/auto-practice/counselor-agent.service.js';
import { CounselorMode } from '../../src/auto-practice/entities/counselor-mode.entity.js';
import type { EngineTurnResult } from '../../src/auto-practice/ports/turn-engine.port.js';
import { PracticeRunnerService } from '../../src/auto-practice/practice-runner.service.js';

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

/**
 * 造一轮引擎结果.
 *
 * @param turnIndex 轮次
 * @param reply 来访者说的话 (空串 = 阻断轮, 来访者没出声)
 * @param degraded 本轮访客侧是否走了渲染兜底
 */
function makeTurn(turnIndex: number, reply: string, degraded = false): EngineTurnResult {
  return {
    reply,
    turnIndex,
    crisisDetected: false,
    crisisCategory: null,
    trace: { turnIndex, crisis: { detected: false, category: null }, degraded } as EngineTurnResult['trace'],
  };
}

/** 咨询师逐轮轮换的话 (彼此不近似, 避免误触发复读检测). */
const COUNSELOR_LINES = ['我先把这句接住。', '你愿意再多说一点吗？', '刚才那点我们停一下。', '我听到的是工作那部分。', '这里我们慢慢来。'];

function stubRepo() {
  const update = vi.fn(async (_id: string, _fields: Record<string, unknown>): Promise<void> => {});
  return {
    update,
    create: (fields: unknown) => fields,
    save: vi.fn(async (row: unknown) => row),
    find: vi.fn(async () => []),
  };
}

function stubGateway() {
  return { publishToSession: vi.fn() };
}

/**
 * 造一个 runner (全替身).
 *
 * @param options.counselorDegradedTurns 咨询师侧降级的轮次 (1 起算; 空 = 不降级)
 * @param options.closeAtTurn 咨询师请求收尾的轮次 (1 起算; 空 = 不收尾)
 */
function makeRunner(options: { readonly counselorDegradedTurns?: readonly number[]; readonly closeAtTurn?: number } = {}): {
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
      degraded: (options.counselorDegradedTurns ?? []).includes(turn),
      closeRequested: options.closeAtTurn === turn,
    });
  });
  return { runner, repo, gateway, engine, counselor };
}

/**
 * 取结算落库时写的字段 (update 的第二个参数).
 */
function writtenFields(repo: ReturnType<typeof stubRepo>): Record<string, unknown> {
  const call = repo.update.mock.calls.at(-1);
  if (!call) throw new Error('updateSessionResult 没被调用');
  return call[1] ?? {};
}

describe('WP-J P1d · 渲染兜底 / 真实调用两列落库', () => {
  it('① 成功路径: 3 个正常轮 + 1 个访客侧兜底轮 → llm=3 / fallback=1', async () => {
    const setup = makeRunner();
    setup.engine.turn
      .mockResolvedValueOnce(makeTurn(1, '我最近状态还算稳'))
      .mockResolvedValueOnce(makeTurn(2, '有时候确实挺难的'))
      .mockResolvedValueOnce(makeTurn(3, '我姐可以过来陪我'))
      .mockResolvedValueOnce(makeTurn(4, '……我先缓一下', true));

    await setup.runner.run({ characterSlug: 'vpt_test', counselorMode: makeMode(), maxTurns: 4 });

    const fields = writtenFields(setup.repo);
    expect(fields['turnCount']).toBe(4);
    expect(fields['llmCallTurns']).toBe(3);
    expect(fields['renderFallbackTurns']).toBe(1);
    // 两个都不能是 undefined (undefined 会被 TypeORM 当"不写"→ 列保持旧值).
    expect(fields['llmCallTurns']).not.toBeUndefined();
    expect(fields['renderFallbackTurns']).not.toBeUndefined();
  });

  it('② 阻断轮 (来访者没出声) 不算真实调用', async () => {
    const setup = makeRunner();
    setup.engine.turn
      .mockResolvedValueOnce(makeTurn(1, '我最近状态还算稳'))
      .mockResolvedValueOnce(makeTurn(2, '有时候确实挺难的'))
      .mockResolvedValueOnce(makeTurn(3, '', false));

    await setup.runner.run({ characterSlug: 'vpt_test', counselorMode: makeMode(), maxTurns: 3 });

    const fields = writtenFields(setup.repo);
    expect(fields['turnCount']).toBe(3);
    // 3 轮里只有 2 轮真的出了话 → 2 轮真调用; 阻断轮既不算调用也不算兜底.
    expect(fields['llmCallTurns']).toBe(2);
    expect(fields['renderFallbackTurns']).toBe(0);
  });

  it('③ 口径分离: 咨询师侧降级计入 degraded_turns, 不计入 render_fallback_turns', async () => {
    const setup = makeRunner({ counselorDegradedTurns: [2] });
    setup.engine.turn
      .mockResolvedValueOnce(makeTurn(1, '我最近状态还算稳'))
      .mockResolvedValueOnce(makeTurn(2, '我姐可以过来陪我'))
      .mockResolvedValueOnce(makeTurn(3, '今晚我一个人在家'));

    await setup.runner.run({ characterSlug: 'vpt_test', counselorMode: makeMode(), maxTurns: 3 });

    const fields = writtenFields(setup.repo);
    expect(fields['turnCount']).toBe(3);
    expect(fields['degradedTurns']).toBe(1);
    expect(fields['renderFallbackTurns']).toBe(0);
    expect(fields['llmCallTurns']).toBe(3);
  });

  it('④ 不是 maxTurns: maxTurns=10 但第 5 轮收尾 → llm_call_turns=5', async () => {
    // 收尾最早第 5 轮 (MIN_TURNS_BEFORE_CLOSE=5) —— 前 4 轮收尾会被忽略.
    const setup = makeRunner({ closeAtTurn: 5 });
    setup.engine.turn
      .mockResolvedValueOnce(makeTurn(1, '我最近状态还算稳'))
      .mockResolvedValueOnce(makeTurn(2, '有时候确实挺难的'))
      .mockResolvedValueOnce(makeTurn(3, '我姐可以过来陪我'))
      .mockResolvedValueOnce(makeTurn(4, '那我们约下周再聊'))
      .mockResolvedValueOnce(makeTurn(5, '好，那我先回去了'));

    await setup.runner.run({ characterSlug: 'vpt_test', counselorMode: makeMode(), maxTurns: 10 });

    const fields = writtenFields(setup.repo);
    expect(fields['turnCount']).toBe(5);
    expect(fields['llmCallTurns']).toBe(5);
    expect(fields['llmCallTurns']).not.toBe(10);
  });

  it('⑥ 渲染兜底率随场次落库 = render_fallback_turns / turn_count', async () => {
    // 兜底率这一列此前**建了但没人写** → 批次健康服务的 fallback_ratio 永远是 null
    //   → 每个批次都被标 FALLBACK_RATIO_UNKNOWN → valid 永远 false.
    const setup = makeRunner();
    setup.engine.turn
      .mockResolvedValueOnce(makeTurn(1, '我最近状态还算稳'))
      .mockResolvedValueOnce(makeTurn(2, '有时候确实挺难的'))
      .mockResolvedValueOnce(makeTurn(3, '我姐可以过来陪我'))
      .mockResolvedValueOnce(makeTurn(4, '……我先缓一下', true));

    await setup.runner.run({ characterSlug: 'vpt_test', counselorMode: makeMode(), maxTurns: 4 });

    const fields = writtenFields(setup.repo);
    expect(fields['turnCount']).toBe(4);
    expect(fields['renderFallbackTurns']).toBe(1);
    // 1/4 = 0.25 (分子分母同源: 访客侧兜底轮 / 来访者轮数).
    expect(fields['renderFallbackRatio']).toBeCloseTo(0.25, 10);
  });

  it('⑦ 没跑起来的场次 → 兜底率落 null ("没测过" ≠ 0)', async () => {
    const setup = makeRunner();
    setup.engine.turn.mockRejectedValue(new Error('engine exploded'));

    await setup.runner.run({ characterSlug: 'vpt_test', counselorMode: makeMode(), maxTurns: 5 });

    const fields = writtenFields(setup.repo);
    expect(fields['turnCount']).toBe(0);
    // 分母是 0 → 不许落 0 (那等于替这场编了一个"当时没问题"的结论).
    expect(fields['renderFallbackRatio']).toBeNull();
  });

  it('⑧ 两侧降级拆分列落库: 咨询师侧 / 来访者侧分得清, degraded_turns 仍是合计', async () => {
    // WP-H 改动 5 建了 counselor_degraded_turns / visitor_degraded_turns 两列,
    //   此前同样**全库无人写** → 看板与 audit 拿到的永远是 0.
    const setup = makeRunner({ counselorDegradedTurns: [2] });
    setup.engine.turn
      .mockResolvedValueOnce(makeTurn(1, '我最近状态还算稳'))
      .mockResolvedValueOnce(makeTurn(2, '我姐可以过来陪我'))
      .mockResolvedValueOnce(makeTurn(3, '今晚我一个人在家', true));

    await setup.runner.run({ characterSlug: 'vpt_test', counselorMode: makeMode(), maxTurns: 3 });

    const fields = writtenFields(setup.repo);
    expect(fields['counselorDegradedTurns']).toBe(1);
    expect(fields['visitorDegradedTurns']).toBe(1);
    expect(fields['degradedTurns']).toBe(2);
    expect(fields['renderFallbackTurns']).toBe(1);
    expect(fields['llmCallTurns']).toBe(2);
  });

  it('⑤ 失败路径: 循环异常 → 两列落 0 (不是 undefined, 也不 throw)', async () => {
    const setup = makeRunner();
    setup.engine.turn.mockRejectedValue(new Error('engine exploded'));

    const result = await setup.runner.run({ characterSlug: 'vpt_test', counselorMode: makeMode(), maxTurns: 5 });

    expect(result.status).toBe('failed');
    const fields = writtenFields(setup.repo);
    expect(fields['llmCallTurns']).toBe(0);
    expect(fields['renderFallbackTurns']).toBe(0);
  });
});
