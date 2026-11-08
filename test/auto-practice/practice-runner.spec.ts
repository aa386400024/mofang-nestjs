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
import { PracticeRunnerService, DEFAULT_MAX_TURNS } from '../../src/auto-practice/practice-runner.service.js';
import type { EngineTurnResult, TurnEnginePort } from '../../src/auto-practice/ports/turn-engine.port.js';

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

describe('PracticeRunnerService', () => {
  let engine: { open: ReturnType<typeof vi.fn>; turn: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn> };
  let counselor: { generate: ReturnType<typeof vi.fn> };
  let repo: ReturnType<typeof stubRepo>;
  let runner: PracticeRunnerService;

  beforeEach(() => {
    engine = { open: vi.fn(), turn: vi.fn(), close: vi.fn() };
    counselor = { generate: vi.fn() };
    repo = stubRepo();
    runner = new PracticeRunnerService(
      engine as unknown as TurnEnginePort,
      counselor as never,
      repo as never,
      undefined, // gateway optional, 单测不给
    );
    engine.open.mockResolvedValue({ debugSessionId: 'ds_test' });
    counselor.generate.mockResolvedValue({ text: '咨询师话', model: 'test-model', degraded: false });
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

  it('咨询师判断可收尾 → natural_close 提前停 (且不超过最小轮数保护)', async () => {
    // 咨询师第 6 轮给出收尾标记.
    counselor.generate
      .mockResolvedValueOnce({ text: '开场', model: 'm', degraded: false, closeRequested: false })
      .mockResolvedValueOnce({ text: '澄清', model: 'm', degraded: false, closeRequested: false })
      .mockResolvedValueOnce({ text: '共情', model: 'm', degraded: false, closeRequested: false })
      .mockResolvedValueOnce({ text: '方向', model: 'm', degraded: false, closeRequested: false })
      .mockResolvedValueOnce({ text: '再确认', model: 'm', degraded: false, closeRequested: false })
      .mockResolvedValueOnce({ text: '收尾总结，约定下次', model: 'm', degraded: false, closeRequested: true });
    engine.turn.mockImplementation(async (_s: string, _t: string) => {
      const n = engine.turn.mock.calls.length;
      return makeTurn(n, `来访第${n}句内容`);
    });

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
    counselor.generate.mockResolvedValue({ text: '想说收尾', model: 'm', degraded: false, closeRequested: true });
    engine.turn.mockImplementation(async (_s: string, _t: string) => {
      const n = engine.turn.mock.calls.length;
      return makeTurn(n, `来访第${n}句内容`);
    });

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
