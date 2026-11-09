// V2026-11-08 治本 (Phase2.5 WP-D · 自动对练 runner 单测):
//   覆盖核心循环的结束条件:
//     ① 跑满 maxTurns → status=completed
//     ② crisisDetected → status=crisis_ended, 提前停
//     ③ 来访连续复读 → status=stagnant, 提前停
//     ④ LLM/引擎抛错 → status=failed
//   全 mock: TurnEnginePort / CounselorAgentService / repo 全是替身, 不起容器不连 DB.
//
//   验证: npx vitest run test/auto-practice/practice-runner.spec.ts

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CounselorMode } from '../../src/auto-practice/entities/counselor-mode.entity.js';
import type { InferenceFingerprint } from '../../src/auto-practice/inference-fingerprint.service.js';
import type { EngineTurnResult, TurnEnginePort } from '../../src/auto-practice/ports/turn-engine.port.js';
import { PracticeRunnerService, DEFAULT_MAX_TURNS } from '../../src/auto-practice/practice-runner.service.js';

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
function makeTurn(turnIndex: number, reply: string, crisis = false): EngineTurnResult {
  return {
    reply,
    turnIndex,
    crisisDetected: crisis,
    crisisCategory: crisis ? 'suicidal_ideation' : null,
    trace: { turnIndex, crisis: { detected: crisis, category: crisis ? 'x' : null } } as EngineTurnResult['trace'],
  };
}

/** 假 repo: 记录 create/update 调用. */
function stubRepo() {
  const created: unknown[] = [];
  return {
    created,
    create: (fields: unknown) => fields,
    save: vi.fn(async (row: unknown) => {
      created.push(row);
      return row;
    }),
    update: vi.fn(async () => {}),
    find: vi.fn(async () => []),
  };
}

/** 咨询师逐轮轮换的话 (彼此不近似, 避免误触发复读检测). */
const COUNSELOR_LINES = ['我先把这句接住。', '你愿意再多说一点吗？', '刚才那点我们停一下。', '我听到的是工作那部分。', '这里我们慢慢来。'];

describe('PracticeRunnerService', () => {
  let counselorTurn = 0;
  let engine: { open: ReturnType<typeof vi.fn>; turn: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn> };
  let counselor: { generate: ReturnType<typeof vi.fn> };
  let repo: ReturnType<typeof stubRepo>;
  let runner: PracticeRunnerService;

  beforeEach(() => {
    counselorTurn = 0;
    engine = { open: vi.fn(), turn: vi.fn(), close: vi.fn() };
    counselor = { generate: vi.fn() };
    repo = stubRepo();
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
    runner = new PracticeRunnerService(
      engine as unknown as TurnEnginePort,
      counselor as never,
      fingerprint as never,
      repo as never,
      undefined, // gateway optional, 单测不给
    );
    engine.open.mockResolvedValue({ debugSessionId: 'ds_test' });
    // 咨询师**逐轮换话** —— 原来每轮都是同一句"咨询师话".
    // WP-G 加了咨询师复读检测之后, 那样会让每一场都在第 3 轮被判停滞
    // (那是新逻辑的**正确**行为, 但不是这些用例想测的东西).
    counselor.generate.mockImplementation(() => {
      counselorTurn += 1;
      return Promise.resolve({ text: COUNSELOR_LINES[counselorTurn % COUNSELOR_LINES.length], model: 'test-model', degraded: false });
    });
  });

  it('跑满 maxTurns → completed', async () => {
    // 每次 turn 返回不同回复 (不复读), 跑 3 轮.
    engine.turn
      .mockResolvedValueOnce(makeTurn(1, '来访说第一句'))
      .mockResolvedValueOnce(makeTurn(2, '来访说第二句'))
      .mockResolvedValueOnce(makeTurn(3, '来访说第三句'));

    const result = await runner.run({
      characterSlug: 'vpt_test',
      counselorMode: makeMode(),
      maxTurns: 3,
    });

    expect(result.status).toBe('completed');
    expect(result.exitReason).toBe('max_turns');
    expect(result.turnCount).toBe(3);
    expect(result.crisisEnded).toBe(false);
    expect(engine.turn).toHaveBeenCalledTimes(3);
    expect(engine.close).toHaveBeenCalledWith('ds_test');
  });

  it('crisisDetected → crisis_ended 提前停', async () => {
    engine.turn.mockResolvedValueOnce(makeTurn(1, '来访第一句')).mockResolvedValueOnce(makeTurn(2, '我不想活了', true));

    const result = await runner.run({
      characterSlug: 'vpt_test',
      counselorMode: makeMode(),
      maxTurns: 10,
    });

    expect(result.status).toBe('crisis_ended');
    expect(result.exitReason).toBe('crisis');
    expect(result.crisisEnded).toBe(true);
    // 第 3 轮不该跑.
    expect(engine.turn).toHaveBeenCalledTimes(2);
  });

  it('来访连续复读 → stagnant 提前停', async () => {
    // 三轮完全相同的短回复 (命中复读检测).
    engine.turn.mockResolvedValueOnce(makeTurn(1, '嗯')).mockResolvedValueOnce(makeTurn(2, '嗯')).mockResolvedValueOnce(makeTurn(3, '嗯'));

    const result = await runner.run({
      characterSlug: 'vpt_test',
      counselorMode: makeMode(),
      maxTurns: 10,
    });

    expect(result.status).toBe('stagnant');
    expect(result.exitReason).toBe('stagnant');
  });

  it('咨询师连续复读 → stagnant 提前停 (WP-G 改动 3)', async () => {
    // 咨询师每轮说同一句, 来访者每轮都在换话 —— 只有咨询师这一侧卡死.
    counselor.generate.mockResolvedValue({ text: '嗯，我在听。你可以接着说。', model: 'm', degraded: false });
    for (let i = 1; i <= 5; i += 1) {
      engine.turn.mockResolvedValueOnce(makeTurn(i, `来访第${i}句不同内容`));
    }

    const result = await runner.run({
      characterSlug: 'vpt_test',
      counselorMode: makeMode(),
      maxTurns: 10,
    });

    expect(result.status).toBe('stagnant');
    expect(result.exitReason).toBe('stagnant');
    // 连续 3 轮复读 → 第 3 轮就停.
    expect(engine.turn).toHaveBeenCalledTimes(3);
  });

  it('咨询师判断可收尾 → natural_close 提前停 (且不超过最小轮数保护)', async () => {
    // 咨询师第 6 轮给出收尾标记.
    counselor.generate
      .mockResolvedValueOnce({ text: '开场', model: 'm', degraded: false, closeRequested: false })
      .mockResolvedValueOnce({ text: '澄清', model: 'm', degraded: false, closeRequested: false })
      .mockResolvedValueOnce({ text: '共情', model: 'm', degraded: false, closeRequested: false })
      .mockResolvedValueOnce({ text: '方向', model: 'm', degraded: false, closeRequested: false })
      .mockResolvedValueOnce({ text: '再确认', model: 'm', degraded: false, closeRequested: false })
      .mockResolvedValueOnce({ text: '收尾总结，约定下次', model: 'm', degraded: false, closeRequested: true });
    // 来访者按调用序号返回 (用 Once 序列, 避开 mockImplementation 返回 Promise 引发的
    // @typescript-eslint/no-misused-promises).
    for (let i = 1; i <= 6; i += 1) {
      engine.turn.mockResolvedValueOnce(makeTurn(i, `来访第${i}句内容`));
    }

    const result = await runner.run({
      characterSlug: 'vpt_test',
      counselorMode: makeMode(),
      maxTurns: 15,
    });

    expect(result.status).toBe('completed');
    expect(result.exitReason).toBe('natural_close');
    expect(result.turnCount).toBe(6);
    expect(engine.turn).toHaveBeenCalledTimes(6);
  });

  it('收尾标记出现太早 (未到最小轮数) 不生效', async () => {
    // 每轮换一句 (同一句会被新增的咨询师复读检测判成停滞).
    let closeTurn = 0;
    counselor.generate.mockImplementation(() => {
      closeTurn += 1;
      return Promise.resolve({ text: `想说收尾第${closeTurn}轮`, model: 'm', degraded: false, closeRequested: true });
    });
    for (let i = 1; i <= 4; i += 1) {
      engine.turn.mockResolvedValueOnce(makeTurn(i, `来访第${i}句内容`));
    }

    const result = await runner.run({
      characterSlug: 'vpt_test',
      counselorMode: makeMode(),
      maxTurns: 4,
    });

    expect(result.exitReason).toBe('max_turns');
    expect(engine.turn).toHaveBeenCalledTimes(4);
  });

  it('引擎抛错 → failed', async () => {
    engine.turn.mockRejectedValue(new Error('engine exploded'));

    const result = await runner.run({
      characterSlug: 'vpt_test',
      counselorMode: makeMode(),
      maxTurns: 5,
    });

    expect(result.status).toBe('failed');
    expect(result.exitReason).toBe('error');
    // close 仍然被调用 (finally 块).
    expect(engine.close).toHaveBeenCalledWith('ds_test');
  });

  it('默认 maxTurns = 15', async () => {
    // 不传 maxTurns 时, 应该用 DEFAULT_MAX_TURNS.
    expect(DEFAULT_MAX_TURNS).toBe(15);
  });
});
