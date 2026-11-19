// AF-133 建立 (长会话收束可达性与硬模板 · runner 侧定向单测):
//   覆盖任务单 §实现要求 1 (runner 侧优先修的那三条):
//     ① **forced-close cue**: maxTurns 前 2 轮必须注入 closingCue='forced',
//        让模型在被硬切之前有机会产出收束三件套 (AF-131 §2.2: 8/16 场次被
//        max_turns 硬切, 而模型**无从知道**自己会被切);
//     ② **危机窗不再硬切**: postTurns 达到 crisisPracticeTurns 时**不能**直接
//        crisis_practice_max, 至少再留 1 轮做风险收束, 收束轮之后才结束;
//     ③ **模型的收尾请求优先**: closeRequested 且危机窗已过披露轮时走
//        crisis_practice_close, 不被 crisis_practice_max 覆盖
//        (AF-131 §2.2 的 packet-12: 第 45 轮本该收尾, 被计数器抢走).
//
//   ⚠️ 口径边界: legacy 档**不变** —— 档案契约把危机窗钉在 4 轮, 且 legacy 是
//      15 轮短对练, 不存在 AF-131 那种"收尾不可达"的问题. 这条断言是红线守卫.
//
//   全 mock / 纯函数, 不起 NestJS, 不连 DB, 不发网络.
//
//   验证: pnpm exec vitest run test/auto-practice/practice-runner-decide-turn.spec.ts

import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

import type { CounselorGenerateContext, CounselorHistoryTurn, CounselorReply } from '../../src/auto-practice/counselor-agent.service.js';
import { CounselorMode } from '../../src/auto-practice/entities/counselor-mode.entity.js';
import type { EngineTurnResult, TurnEnginePort } from '../../src/auto-practice/ports/turn-engine.port.js';
import {
  PracticeRunnerService,
  decideTurn,
  type CrisisWindowState,
  type StagnationState,
} from '../../src/auto-practice/practice-runner.service.js';
import { LONG_SESSION_PROFILE, LEGACY_SESSION_PROFILE, sessionThresholdsOf } from '../../src/auto-practice/session-profile.js';

// TD-10 · T-2: 真实 ioredis 不进 import 阶段 (与 practice-runner.spec.ts 同款替身口径).
vi.mock('ioredis', async () => {
  const { createIoredisStub } = await import('../helpers/sdk-stubs.js');
  return createIoredisStub();
});

/** 咨询师 generate 的真实签名 (显式标注给 vi.fn, 免得 mock 被当成 void 回调). */
type CounselorGenerateSignature = (
  mode: CounselorMode,
  history: readonly CounselorHistoryTurn[],
  options?: CounselorGenerateContext,
) => Promise<CounselorReply>;

/** 引擎 turn 的真实签名. */
type EngineTurnSignature = (debugSessionId: string, counselorText: string) => Promise<EngineTurnResult>;

/** 造一份空的危机窗 / 停滞计数状态. */
function freshState(): { crisisWindow: CrisisWindowState; stagnation: StagnationState } {
  return {
    crisisWindow: { active: false, firstTurn: 0, postTurns: 0, peakLevel: 0, category: null, escalated: false },
    stagnation: { literalRepeatStreak: 0, noProgressStreak: 0, semanticEchoTurns: 0 },
  };
}

/** 一轮判定的事实 (除 crisisDetected 外都中性). */
const TURN = {
  crisisDetected: false,
  crisisCategory: null,
  visitorText: '来访这轮说的话',
  visitorHistory: [],
  counselorText: '咨询师这轮说的话',
  lastCounselorText: '',
  closeRequested: false,
} as const;

/** 危机披露那一轮的事实. */
const CRISIS_TURN = {
  ...TURN,
  crisisDetected: true,
  crisisCategory: 'passive_ideation',
  visitorText: '有时候真的觉得活着没意思',
} as const;

describe('AF-133 · decideTurn · 危机窗用满不再硬切（留 1 轮风险收束）', () => {
  const thresholds = sessionThresholdsOf(LONG_SESSION_PROFILE);

  it('long 档: postTurns 达到 crisisPracticeTurns 时**继续**，不硬切', () => {
    const state = freshState();
    // 第 1 轮披露 → 开窗 (postTurns = 0).
    decideTurn({ ...CRISIS_TURN, turnIndex: 1 }, state.crisisWindow, state.stagnation, thresholds);
    expect(state.crisisWindow.active).toBe(true);
    expect(state.crisisWindow.postTurns).toBe(0);

    // 披露之后的 6 轮 (long 的 crisisPracticeTurns = 6): 每一轮都继续.
    for (let postTurn = 1; postTurn <= 6; postTurn += 1) {
      const decision = decideTurn({ ...TURN, turnIndex: 1 + postTurn }, state.crisisWindow, state.stagnation, thresholds);
      expect(decision.kind).toBe('continue');
    }
    // 第 6 轮 (postTurns = 6 = 上限) 时**没有**结束 —— 收束轮还没发生.
    expect(state.crisisWindow.postTurns).toBe(6);

    // 第 7 轮 = 风险收束轮: 收束轮之后才结束.
    const afterClosingRound = decideTurn({ ...TURN, turnIndex: 8 }, state.crisisWindow, state.stagnation, thresholds);
    expect(afterClosingRound).toEqual({ kind: 'stop', reason: 'crisis_practice_max' });
    expect(state.crisisWindow.postTurns).toBe(7);
  });

  it('long 档: 风险收束轮之前不会结束 —— 收束不可达的老毛病被堵住', () => {
    const state = freshState();
    decideTurn({ ...CRISIS_TURN, turnIndex: 1 }, state.crisisWindow, state.stagnation, thresholds);
    const decisions = [];
    for (let postTurn = 1; postTurn <= 6; postTurn += 1) {
      decisions.push(decideTurn({ ...TURN, turnIndex: 1 + postTurn }, state.crisisWindow, state.stagnation, thresholds).kind);
    }
    expect(decisions).toEqual(['continue', 'continue', 'continue', 'continue', 'continue', 'continue']);
  });

  it('legacy 档: 危机窗计数一到就结束（档案契约"危机窗 4"不变）', () => {
    const state = freshState();
    const legacyThresholds = sessionThresholdsOf(LEGACY_SESSION_PROFILE);
    decideTurn({ ...CRISIS_TURN, turnIndex: 1 }, state.crisisWindow, state.stagnation, legacyThresholds);
    for (let postTurn = 1; postTurn <= 3; postTurn += 1) {
      const decision = decideTurn({ ...TURN, turnIndex: 1 + postTurn }, state.crisisWindow, state.stagnation, legacyThresholds);
      expect(decision.kind).toBe('continue');
    }
    const fourth = decideTurn({ ...TURN, turnIndex: 5 }, state.crisisWindow, state.stagnation, legacyThresholds);
    expect(fourth).toEqual({ kind: 'stop', reason: 'crisis_practice_max' });
  });
});

describe('AF-133 · decideTurn · 模型的收尾请求优先于危机计数器', () => {
  const thresholds = sessionThresholdsOf(LONG_SESSION_PROFILE);

  it('危机窗已过披露轮 + closeRequested → crisis_practice_close（不被 crisis_practice_max 覆盖）', () => {
    const state = freshState();
    decideTurn({ ...CRISIS_TURN, turnIndex: 1 }, state.crisisWindow, state.stagnation, thresholds);

    const decision = decideTurn({ ...TURN, turnIndex: 2, closeRequested: true }, state.crisisWindow, state.stagnation, thresholds);
    expect(decision).toEqual({ kind: 'stop', reason: 'crisis_practice_close' });
  });

  it('危机窗用满那一轮 closeRequested → 仍然是 crisis_practice_close（不是 crisis_practice_max）', () => {
    const state = freshState();
    decideTurn({ ...CRISIS_TURN, turnIndex: 1 }, state.crisisWindow, state.stagnation, thresholds);
    for (let postTurn = 1; postTurn <= 5; postTurn += 1) {
      decideTurn({ ...TURN, turnIndex: 1 + postTurn }, state.crisisWindow, state.stagnation, thresholds);
    }
    // 第 6 个练习轮: 计数正好到上限, 且模型请求收尾.
    const decision = decideTurn({ ...TURN, turnIndex: 7, closeRequested: true }, state.crisisWindow, state.stagnation, thresholds);
    expect(decision).toEqual({ kind: 'stop', reason: 'crisis_practice_close' });
  });

  it('披露当轮 closeRequested 仍被挡一次（不能把来访者一个人留在危机里）', () => {
    const state = freshState();
    const decision = decideTurn({ ...CRISIS_TURN, turnIndex: 1, closeRequested: true }, state.crisisWindow, state.stagnation, thresholds);
    expect(decision.kind).toBe('continue');
  });

  it('危机窗里动态放开 minTurnsBeforeClose（long 档 35 轮门槛不挡危机收束）', () => {
    const state = freshState();
    decideTurn({ ...CRISIS_TURN, turnIndex: 1 }, state.crisisWindow, state.stagnation, thresholds);
    // 第 2 轮 —— 远未到 long 档的"最早 35 轮收尾".
    const decision = decideTurn({ ...TURN, turnIndex: 2, closeRequested: true }, state.crisisWindow, state.stagnation, thresholds);
    expect(decision).toEqual({ kind: 'stop', reason: 'crisis_practice_close' });
  });

  it('非危机场: minTurnsBeforeClose 仍然生效（第 34 轮不生效 / 第 35 轮生效）', () => {
    const before = freshState();
    expect(decideTurn({ ...TURN, turnIndex: 34, closeRequested: true }, before.crisisWindow, before.stagnation, thresholds).kind).toBe(
      'continue',
    );

    const after = freshState();
    expect(decideTurn({ ...TURN, turnIndex: 35, closeRequested: true }, after.crisisWindow, after.stagnation, thresholds)).toEqual({
      kind: 'stop',
      reason: 'natural_close',
    });
  });
});

describe('AF-133 · runner · forced-close cue 与风险收束轮', () => {
  let counselorTurn = 0;
  let engine: { open: Mock; turn: Mock; close: Mock };
  let counselor: { generate: Mock<CounselorGenerateSignature> };
  let runner: PracticeRunnerService;

  beforeEach(() => {
    counselorTurn = 0;
    engine = { open: vi.fn(), turn: vi.fn(), close: vi.fn() };
    counselor = { generate: vi.fn<CounselorGenerateSignature>() };
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
      engine,
      counselor as never,
      fingerprint as never,
      { create: vi.fn(), save: vi.fn(async (row: unknown) => row), update: vi.fn(async () => {}), find: vi.fn(async () => []) } as never,
      undefined,
    );
    engine.open.mockResolvedValue({ debugSessionId: 'ds_test' });
    // 咨询师逐轮换话 (避免误触发复读停滞).
    counselor.generate.mockImplementation(() => {
      counselorTurn += 1;
      return Promise.resolve({
        text: `咨询师第${counselorTurn}轮的话`,
        model: 'test-model',
        degraded: false,
        closeRequested: false,
      } satisfies CounselorReply);
    });
  });

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

  it('最后 2 轮一定有 closingCue="forced"，更早的轮次没有', async () => {
    for (let i = 1; i <= 5; i += 1) {
      engine.turn.mockResolvedValueOnce(makeTurn(i, `来访第${i}句不同内容`));
    }

    await runner.run({
      characterSlug: 'vpt_test',
      counselorMode: { systemPrompt: '你是专家' } as CounselorMode,
      maxTurns: 5,
      sessionProfile: 'long',
    });

    const calls = counselor.generate.mock.calls;
    expect(calls).toHaveLength(5);
    const cues = calls.map((call) => call[2]?.closingCue);
    const remaining = calls.map((call) => call[2]?.remainingTurns);
    // 任务单口径: remaining = maxTurns - i, remaining ≤ 2 就注入 → 最后 3 轮.
    expect(cues[0]).toBeUndefined();
    expect(cues[1]).toBeUndefined();
    expect(cues[2]).toBe('forced');
    expect(cues[3]).toBe('forced');
    expect(cues[4]).toBe('forced');
    // 最后 2 轮一定带 cue (硬要求), 并且带上准确的剩余轮数.
    expect(cues.slice(3)).toEqual(['forced', 'forced']);
    expect(remaining[2]).toBe(3);
    expect(remaining[3]).toBe(2);
    expect(remaining[4]).toBe(1);
  });

  it('危机窗用满后的那一轮传 crisisClosing=true（风险收束轮）', async () => {
    // 第 1 轮正常, 第 2 轮披露危机, 之后连续几轮.
    engine.turn
      .mockResolvedValueOnce(makeTurn(1, '我最近状态还算稳'))
      .mockResolvedValueOnce(makeTurn(2, '有时候真的觉得活着没意思', 'passive_ideation'))
      .mockResolvedValueOnce(makeTurn(3, '今晚我一个人在家'))
      .mockResolvedValueOnce(makeTurn(4, '试了呼吸，稍微能坐住了'))
      .mockResolvedValueOnce(makeTurn(5, '我姐可以过来陪我'))
      .mockResolvedValueOnce(makeTurn(6, '明天我打算去找医生聊一聊'))
      .mockResolvedValueOnce(makeTurn(7, '那我今晚先把药收起来'))
      .mockResolvedValueOnce(makeTurn(8, '谢谢你陪我'))
      .mockResolvedValueOnce(makeTurn(9, '那我先找姐姐过来'));

    const result = await runner.run({
      characterSlug: 'vpt_test',
      counselorMode: { systemPrompt: '你是专家' } as CounselorMode,
      maxTurns: 12,
      sessionProfile: 'long',
    });

    const calls = counselor.generate.mock.calls;
    const crisisFlags = calls.map((call) => call[2]?.crisisClosing === true);
    // 危机窗 (long = 6 轮) 用满之前, 还没有风险收束轮.
    expect(crisisFlags[1]).toBe(false); // 披露当轮: 窗口是在这一轮**之后**才开的
    expect(crisisFlags[2]).toBe(false); // postTurns = 0
    expect(crisisFlags[7]).toBe(false); // postTurns = 5, 未到上限
    // 窗口用满 (postTurns = 6) 后的那一轮 = 风险收束轮.
    expect(crisisFlags[8]).toBe(true);
    // 收束轮之后才结束 (postTurns 超过上限 = 7).
    expect(result.exitReason).toBe('crisis_practice_max');
    expect(result.metrics.crisisPostTurns).toBe(7);
    expect(engine.turn).toHaveBeenCalledTimes(9);
  });

  it('危机窗里模型请求收尾 → crisis_practice_close（不再被计数器抢走）', async () => {
    counselor.generate.mockImplementation(() => {
      counselorTurn += 1;
      return Promise.resolve({
        text: `咨询师第${counselorTurn}轮的话`,
        model: 'test-model',
        degraded: false,
        // 披露后的第一轮就请求收尾.
        closeRequested: counselorTurn >= 3,
      } satisfies CounselorReply);
    });

    engine.turn
      .mockResolvedValueOnce(makeTurn(1, '我最近状态还算稳'))
      .mockResolvedValueOnce(makeTurn(2, '有时候真的觉得活着没意思', 'passive_ideation'))
      .mockResolvedValueOnce(makeTurn(3, '今晚我一个人在家'));

    const result = await runner.run({
      characterSlug: 'vpt_test',
      counselorMode: { systemPrompt: '你是专家' } as CounselorMode,
      maxTurns: 8,
      sessionProfile: 'long',
    });

    expect(result.exitReason).toBe('crisis_practice_close');
    expect(result.status).toBe('completed');
    expect(engine.turn).toHaveBeenCalledTimes(3);
  });
});
