// V2026-11-18 建立 (AF-091 · 长会话档案 · 单测):
//   覆盖任务单 §验收口径:
//     ① **legacy 逐字不变**: 缺省档案 = 老常量 (15 轮 / 最早 5 轮收尾 / 停滞 2·3 / 危机窗 4);
//     ② **long 档数值**: 上限 50 / 目标 40-50 / 最早 35 轮收尾 / 停滞 4·5 / 危机窗 6;
//     ③ **long 的收尾硬闸门**: 35 轮前 closeRequested 不生效, 第 35 轮才生效;
//     ④ **long 的停滞阈值比 legacy 宽**;
//     ⑤ **档案解析**: 缺省 legacy / 非法值明确报错 (不静默回落).
//
//   全 mock / 纯函数, 不起 NestJS, 不连 DB, 不发网络.
//
//   验证: pnpm exec vitest run test/auto-practice/session-profile.spec.ts

import { describe, expect, it } from 'vitest';

import {
  CRISIS_PRACTICE_TURNS,
  DEFAULT_MAX_TURNS,
  STAGNANT_LITERAL_STREAK_LIMIT,
  STAGNANT_NO_PROGRESS_LIMIT,
  decideTurn,
  type CrisisWindowState,
  type StagnationState,
} from '../../src/auto-practice/practice-runner.service.js';
import {
  LONG_SESSION_PROFILE,
  LEGACY_SESSION_PROFILE,
  STANDARD_SESSION_PROFILE,
  isSessionProfileName,
  parseSessionProfile,
  resolveSessionProfile,
  sessionThresholdsOf,
  targetTurnsBandText,
} from '../../src/auto-practice/session-profile.js';

/** 造一份空的危机窗 / 停滞计数状态. */
function freshState(): { crisisWindow: CrisisWindowState; stagnation: StagnationState } {
  return {
    crisisWindow: { active: false, firstTurn: 0, postTurns: 0, peakLevel: 0, category: null, escalated: false },
    stagnation: { literalRepeatStreak: 0, noProgressStreak: 0, semanticEchoTurns: 0 },
  };
}

/** 一轮判定的事实 (复读用例共用). */
const REPEAT_TURN = {
  crisisDetected: false,
  crisisCategory: null,
  visitorText: '嗯',
  counselorText: '我听到了。',
  lastCounselorText: '',
  closeRequested: false,
} as const;

describe('AF-091 · 会话档案 (纯函数)', () => {
  it('① legacy 档 = 老常量 (逐字不变)', () => {
    expect(LEGACY_SESSION_PROFILE.maxTurns).toBe(15);
    expect(LEGACY_SESSION_PROFILE.minTurnsBeforeClose).toBe(5);
    expect(LEGACY_SESSION_PROFILE.stagnantLiteralStreakLimit).toBe(2);
    expect(LEGACY_SESSION_PROFILE.stagnantNoProgressLimit).toBe(3);
    expect(LEGACY_SESSION_PROFILE.crisisPracticeTurns).toBe(4);
    // runner 对外暴露的老常量必须跟着档案走 (值不能漂).
    expect(DEFAULT_MAX_TURNS).toBe(LEGACY_SESSION_PROFILE.maxTurns);
    expect(STAGNANT_LITERAL_STREAK_LIMIT).toBe(LEGACY_SESSION_PROFILE.stagnantLiteralStreakLimit);
    expect(STAGNANT_NO_PROGRESS_LIMIT).toBe(LEGACY_SESSION_PROFILE.stagnantNoProgressLimit);
    expect(CRISIS_PRACTICE_TURNS).toBe(LEGACY_SESSION_PROFILE.crisisPracticeTurns);
  });

  it('② standard 档 = 30 轮档', () => {
    expect(STANDARD_SESSION_PROFILE.maxTurns).toBe(30);
    expect(STANDARD_SESSION_PROFILE.minTurnsBeforeClose).toBe(20);
    expect(STANDARD_SESSION_PROFILE.stagnantLiteralStreakLimit).toBe(3);
    expect(STANDARD_SESSION_PROFILE.stagnantNoProgressLimit).toBe(4);
    expect(STANDARD_SESSION_PROFILE.crisisPracticeTurns).toBe(4);
  });

  it('② long 档 = 50 分钟档 (上限 50 / 目标 40-50 / 最早 35 / 停滞 4·5 / 危机窗 6)', () => {
    expect(LONG_SESSION_PROFILE.maxTurns).toBe(50);
    expect(LONG_SESSION_PROFILE.targetTurns).toBe(45);
    expect(LONG_SESSION_PROFILE.targetTurnsBand).toEqual([40, 50]);
    expect(LONG_SESSION_PROFILE.minTurnsBeforeClose).toBe(35);
    expect(LONG_SESSION_PROFILE.stagnantLiteralStreakLimit).toBe(4);
    expect(LONG_SESSION_PROFILE.stagnantNoProgressLimit).toBe(5);
    expect(LONG_SESSION_PROFILE.crisisPracticeTurns).toBe(6);
    expect(targetTurnsBandText(LONG_SESSION_PROFILE)).toBe('40-50');
  });

  it('④ long 的停滞阈值比 legacy 宽', () => {
    expect(LONG_SESSION_PROFILE.stagnantLiteralStreakLimit).toBeGreaterThan(LEGACY_SESSION_PROFILE.stagnantLiteralStreakLimit);
    expect(LONG_SESSION_PROFILE.stagnantNoProgressLimit).toBeGreaterThan(LEGACY_SESSION_PROFILE.stagnantNoProgressLimit);
  });

  it('⑤ 缺省 / 空串 → legacy', () => {
    expect(resolveSessionProfile().name).toBe('legacy');
    expect(resolveSessionProfile(null).name).toBe('legacy');
    expect(resolveSessionProfile('').name).toBe('legacy');
    expect(resolveSessionProfile(' '.repeat(3)).name).toBe('legacy');
  });

  it('⑤ 已知档名 → 对应档案', () => {
    expect(resolveSessionProfile('legacy').name).toBe('legacy');
    expect(resolveSessionProfile('standard').name).toBe('standard');
    expect(resolveSessionProfile('long').name).toBe('long');
    expect(resolveSessionProfile(' long ').name).toBe('long');
  });

  it('⑤ 未知档名 → 回落 legacy (不抛异常, 让整场对练不崩)', () => {
    expect(resolveSessionProfile('ultra-long').name).toBe('legacy');
    expect(resolveSessionProfile('LONG').name).toBe('legacy');
  });

  it('⑤ 入口解析: 非法值明确报错, 不静默回落', () => {
    expect(parseSessionProfile()).toEqual({ value: 'legacy' });
    expect(parseSessionProfile('long')).toEqual({ value: 'long' });
    const bad = parseSessionProfile('ultra-long');
    expect(bad.error).toContain('sessionProfile 非法');
    expect(bad.value).toBeUndefined();
  });

  it('档名判定 isSessionProfileName', () => {
    expect(isSessionProfileName('long')).toBe(true);
    expect(isSessionProfileName('ultra-long')).toBe(false);
    expect(isSessionProfileName(42)).toBe(false);
  });

  it('阈值子集只带判定用的四个数', () => {
    expect(sessionThresholdsOf(LONG_SESSION_PROFILE)).toEqual({
      minTurnsBeforeClose: 35,
      stagnantLiteralStreakLimit: 4,
      stagnantNoProgressLimit: 5,
      crisisPracticeTurns: 6,
    });
  });
});

describe('AF-091 · decideTurn 的阈值入参', () => {
  it('③ long 档: 35 轮前 closeRequested 不生效', () => {
    const state = freshState();
    const decision = decideTurn(
      {
        turnIndex: 34,
        closeRequested: true,
        crisisDetected: false,
        crisisCategory: null,
        visitorText: '来访这轮说的话',
        visitorHistory: [],
        counselorText: '咨询师这轮说的话',
        lastCounselorText: '',
      },
      state.crisisWindow,
      state.stagnation,
      sessionThresholdsOf(LONG_SESSION_PROFILE),
    );

    expect(decision.kind).toBe('continue');
  });

  it('③ long 档: 第 35 轮 closeRequested 生效 (natural_close)', () => {
    const state = freshState();
    const decision = decideTurn(
      {
        turnIndex: 35,
        closeRequested: true,
        crisisDetected: false,
        crisisCategory: null,
        visitorText: '来访这轮说的话',
        visitorHistory: [],
        counselorText: '咨询师这轮说的话',
        lastCounselorText: '',
      },
      state.crisisWindow,
      state.stagnation,
      sessionThresholdsOf(LONG_SESSION_PROFILE),
    );

    expect(decision).toEqual({ kind: 'stop', reason: 'natural_close' });
  });

  it('③ legacy 档 (缺省入参): 第 5 轮就生效 (老行为不变)', () => {
    const state = freshState();
    const decision = decideTurn(
      {
        turnIndex: 5,
        closeRequested: true,
        crisisDetected: false,
        crisisCategory: null,
        visitorText: '来访这轮说的话',
        visitorHistory: [],
        counselorText: '咨询师这轮说的话',
        lastCounselorText: '',
      },
      state.crisisWindow,
      state.stagnation,
    );

    expect(decision).toEqual({ kind: 'stop', reason: 'natural_close' });
  });

  it('③ legacy 档 (缺省入参): 第 4 轮不生效 (老行为不变)', () => {
    const state = freshState();
    const decision = decideTurn(
      {
        turnIndex: 4,
        closeRequested: true,
        crisisDetected: false,
        crisisCategory: null,
        visitorText: '来访这轮说的话',
        visitorHistory: [],
        counselorText: '咨询师这轮说的话',
        lastCounselorText: '',
      },
      state.crisisWindow,
      state.stagnation,
    );

    expect(decision.kind).toBe('continue');
  });

  it('④ long 档: 连续 3 轮字面复读不判停滞 (legacy 第 3 轮就判)', () => {
    const long = freshState();
    const longThresholds = sessionThresholdsOf(LONG_SESSION_PROFILE);
    // 第 2 轮: 与第 1 轮全等 → 复读 streak=1.
    decideTurn({ ...REPEAT_TURN, turnIndex: 2, visitorHistory: ['嗯'] }, long.crisisWindow, long.stagnation, longThresholds);
    // 第 3 轮: streak=2 —— legacy 到 2 就停, long 未到 4 → 继续.
    const third = decideTurn(
      { ...REPEAT_TURN, turnIndex: 3, visitorHistory: ['嗯', '嗯'] },
      long.crisisWindow,
      long.stagnation,
      longThresholds,
    );
    expect(third.kind).toBe('continue');
    expect(long.stagnation.literalRepeatStreak).toBe(2);

    const legacy = freshState();
    decideTurn(
      { ...REPEAT_TURN, turnIndex: 2, visitorHistory: ['嗯'] },
      legacy.crisisWindow,
      legacy.stagnation,
      sessionThresholdsOf(LEGACY_SESSION_PROFILE),
    );
    const legacyThird = decideTurn(
      { ...REPEAT_TURN, turnIndex: 3, visitorHistory: ['嗯', '嗯'] },
      legacy.crisisWindow,
      legacy.stagnation,
      sessionThresholdsOf(LEGACY_SESSION_PROFILE),
    );
    expect(legacyThird.kind).toBe('stop');
  });

  it('④ long 档: 连续 4 轮字面复读才判停滞', () => {
    const long = freshState();
    const thresholds = sessionThresholdsOf(LONG_SESSION_PROFILE);
    decideTurn({ ...REPEAT_TURN, turnIndex: 2, visitorHistory: ['嗯'] }, long.crisisWindow, long.stagnation, thresholds);
    decideTurn({ ...REPEAT_TURN, turnIndex: 3, visitorHistory: ['嗯', '嗯'] }, long.crisisWindow, long.stagnation, thresholds);
    const fourth = decideTurn(
      { ...REPEAT_TURN, turnIndex: 4, visitorHistory: ['嗯', '嗯', '嗯'] },
      long.crisisWindow,
      long.stagnation,
      thresholds,
    );
    expect(fourth.kind).toBe('continue');
    const fifth = decideTurn(
      { ...REPEAT_TURN, turnIndex: 5, visitorHistory: ['嗯', '嗯', '嗯', '嗯'] },
      long.crisisWindow,
      long.stagnation,
      thresholds,
    );
    expect(fifth.kind).toBe('stop');
  });

  it('long 档的危机后置窗 = 6 轮 (legacy 是 4 轮)', () => {
    const long = freshState();
    const thresholds = sessionThresholdsOf(LONG_SESSION_PROFILE);
    // 第 1 轮披露 → 开窗 (postTurns = 0).
    decideTurn(
      {
        turnIndex: 1,
        closeRequested: false,
        crisisDetected: true,
        crisisCategory: 'passive_ideation',
        visitorText: '有时候真的觉得活着没意思',
        visitorHistory: [],
        counselorText: '我在这里。',
        lastCounselorText: '',
      },
      long.crisisWindow,
      long.stagnation,
      thresholds,
    );
    // 披露之后每轮 postTurns +1: 第 4 轮 legacy 已停, long 继续.
    for (let postTurn = 1; postTurn <= 5; postTurn += 1) {
      const decision = decideTurn(
        {
          turnIndex: 1 + postTurn,
          closeRequested: false,
          crisisDetected: false,
          crisisCategory: null,
          visitorText: `危机后第${postTurn}轮`,
          visitorHistory: [],
          counselorText: '先确认安全。',
          lastCounselorText: '',
        },
        long.crisisWindow,
        long.stagnation,
        thresholds,
      );
      expect(decision.kind).toBe('continue');
    }
    expect(long.crisisWindow.postTurns).toBe(5);
    // 第 6 轮 → 停 (long 的危机窗 = 6 轮).
    const sixth = decideTurn(
      {
        turnIndex: 7,
        closeRequested: false,
        crisisDetected: false,
        crisisCategory: null,
        visitorText: '明天我打算去找医生聊一聊',
        visitorHistory: [],
        counselorText: '我们把下一步定下来。',
        lastCounselorText: '',
      },
      long.crisisWindow,
      long.stagnation,
      thresholds,
    );
    expect(sixth).toEqual({ kind: 'stop', reason: 'crisis_practice_max' });
  });
});
