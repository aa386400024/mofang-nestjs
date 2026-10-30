// V2026-10-26 治本 (复盘报告状态归一 — 纯函数单测):
//   原因: 本轮要治的 P0 是「vpt 结束后报告一直 pending, 前端永远转圈」. 兜底逻辑
//     (陈旧 pending → parse_error) 是**纯函数** (无 IO), 所以能单测 —— 而它一旦写错:
//       - 阈值判反 → 正常还在生成的报告被误报成"失败" (用户白跑一趟)
//       - 漏判 endedAt=null → 会话**还没结束**就被判失败 (逻辑上不可能, 但代码上看不出来)
//       - 边界用 >= 而非 > → 恰好在阈值上的报告被判失败
//     这三类都不会抛异常, 只会让状态**安静地错**, 所以必须用测试锁死.
//
//   验证:
//     1. npx jest test/counselor/session-report-status.spec.ts 全绿
//     2. 故意把 `>` 改成 `>=` → "恰好在阈值上"用例变红
//     3. 故意去掉 endedAtMs === null 分支 → "会话未结束"用例变红
//
//   时间戳: 2026-10-26
//
// ─────────────────────────────────────────────────────────────────────────────
// V2026-10-27 治本 (第二轮 — 报告状态统一派生处, spec 任务 C/D):
//   原因: `resolveSessionReportStatus` 被 `resolveSessionReportState` 取代 (单一派生处):
//     列表与详情共用同一套判定, 且新增 `no_content` (空局) 与失败终态的失败原因码.
//     判定口径变了, 用例必须跟着走 —— 否则测试锁的是**旧口径**, 反而成了负担.
//   修法: 本文件按新签名重写, 覆盖: 主报告行两态 / 空局 / 失败终态 / 陈旧兜底边界.
//   验证: npx jest test/counselor/session-report-status.spec.ts 全绿
//   时间戳: 2026-10-27 14:15 GMT+8
import {
  resolveHasMainReportChannel,
  resolveSessionReportState,
  type SessionReportStateInput,
} from '../../src/counselor/domain/session-core/session-core.types';
import { SessionType } from '../../src/counselor/enums/session-type.enum';
import { SupervisionFailureCode } from '../../src/counselor/enums/supervision-failure-code.enum';
import { TrainingSessionStatus } from '../../src/counselor/enums/training-session-status.enum';

/** 陈旧阈值 (与 env `SUPERVISION_REPORT_PENDING_TIMEOUT_MS` 默认值一致). */
const TIMEOUT_MS = 300_000;

/** 固定"当前时刻", 免得测试随系统时间漂移. */
const NOW = 1_800_000_000_000;

/** 默认阈值 (与 config `supervision.minEffectiveTurns` / `minEffectiveChars` 同值). */
const THRESHOLDS = { minTurns: 2, minChars: 30 };

/** 素材充足 (2 轮 / 40 字). */
const ENOUGH_MATERIAL = { effectiveTurns: 2, effectiveChars: 40 };

/** 素材不足 (1 轮 / 12 字) — 空局. */
const EMPTY_MATERIAL = { effectiveTurns: 1, effectiveChars: 12 };

/** 构造派生入参 (只覆盖差异项). 默认 = 单次训练口径 (无主报告链路). */
function buildInput(overrides: Partial<SessionReportStateInput> = {}): SessionReportStateInput {
  return {
    sessionStatus: TrainingSessionStatus.FINISHED,
    endedAtMs: NOW - 1000,
    nowMs: NOW,
    mainReport: null,
    schoolFeedback: null,
    material: ENOUGH_MATERIAL,
    thresholds: THRESHOLDS,
    stalePendingTimeoutMs: TIMEOUT_MS,
    applyStaleTimeout: true,
    hasMainReportChannel: false,
    ...overrides,
  };
}

describe('复盘报告状态归一 · 主报告行', () => {
  it('已有报告且成功 → completed (分数取报告分)', () => {
    const state = resolveSessionReportState(buildInput({ mainReport: { status: 'completed', overallScore: 82 } }));
    expect(state.status).toBe('completed');
    expect(state.overallScore).toBe(82);
    expect(state.failureCode).toBeNull();
    expect(state.retryable).toBe(false);
  });

  it('已有报告但生成失败 (parse_error) → parse_error (分数 null, 可重试)', () => {
    const state = resolveSessionReportState(buildInput({ mainReport: { status: 'parse_error', overallScore: 0 } }));
    expect(state.status).toBe('parse_error');
    expect(state.overallScore).toBeNull();
    expect(state.retryable).toBe(true);
  });

  it('主报告 parse_error + 流派反馈也失败 → 失败原因码取**更具体**的那个', () => {
    const state = resolveSessionReportState(
      buildInput({
        mainReport: { status: 'parse_error', overallScore: 0 },
        schoolFeedback: { status: 'parse_error', overallScore: null, failureCode: SupervisionFailureCode.RATE_LIMITED },
      }),
    );
    expect(state.failureCode).toBe(SupervisionFailureCode.RATE_LIMITED);
  });
});

describe('复盘报告状态归一 · 空局 (no_content)', () => {
  it('已结束 + 素材不足 → no_content (不再走陈旧兜底, 也不转圈)', () => {
    const state = resolveSessionReportState(buildInput({ material: EMPTY_MATERIAL, endedAtMs: NOW - TIMEOUT_MS - 1000 }));
    expect(state.status).toBe('no_content');
    expect(state.overallScore).toBeNull();
    expect(state.retryable).toBe(false);
  });

  it('未结束 → 不判空局 (素材还在长)', () => {
    const state = resolveSessionReportState(
      buildInput({ sessionStatus: TrainingSessionStatus.LISTENING, material: EMPTY_MATERIAL, endedAtMs: null }),
    );
    expect(state.status).toBe('pending');
  });

  it('空局的失败原因码为 null (状态本身就是结论, 不再叠一个码)', () => {
    const state = resolveSessionReportState(buildInput({ material: EMPTY_MATERIAL }));
    expect(state.failureCode).toBeNull();
  });
});

describe('复盘报告状态归一 · 4 流派反馈 (单次训练的唯一报告来源)', () => {
  it('反馈成功 → completed (分数取反馈分)', () => {
    const state = resolveSessionReportState(buildInput({ schoolFeedback: { status: 'completed', overallScore: 76, failureCode: null } }));
    expect(state.status).toBe('completed');
    expect(state.overallScore).toBe(76);
  });

  it('反馈失败 → parse_error + 失败原因码 (可重试)', () => {
    const state = resolveSessionReportState(
      buildInput({
        schoolFeedback: { status: 'parse_error', overallScore: null, failureCode: SupervisionFailureCode.UPSTREAM_UNAVAILABLE },
      }),
    );
    expect(state.status).toBe('parse_error');
    expect(state.failureCode).toBe(SupervisionFailureCode.UPSTREAM_UNAVAILABLE);
    expect(state.retryable).toBe(true);
  });
});

describe('复盘报告状态归一 · vpt 适用范围隔离 (vpt-feedback-status-isolation-2026-10-27)', () => {
  it('场景位: vpt_voice 有主报告链路, 单次训练没有', () => {
    expect(resolveHasMainReportChannel(SessionType.VPT_VOICE)).toBe(true);
    expect(resolveHasMainReportChannel(SessionType.TRAINING_SESSION)).toBe(false);
    expect(resolveHasMainReportChannel(SessionType.LONG_TERM_CASE_SESSION)).toBe(false);
  });

  it('vpt + 主报告未到 + 反馈成功 → pending (**不得** completed)', () => {
    const state = resolveSessionReportState(
      buildInput({
        hasMainReportChannel: true,
        schoolFeedback: { status: 'completed', overallScore: 76, failureCode: null },
      }),
    );
    expect(state.status).toBe('pending');
    expect(state.overallScore).toBeNull();
  });

  it('vpt + 主报告未到 + 反馈失败 → pending (**不得** parse_error)', () => {
    const state = resolveSessionReportState(
      buildInput({
        hasMainReportChannel: true,
        schoolFeedback: { status: 'parse_error', overallScore: null, failureCode: SupervisionFailureCode.RATE_LIMITED },
      }),
    );
    expect(state.status).toBe('pending');
    expect(state.overallScore).toBeNull();
    expect(state.failureCode).toBeNull();
    expect(state.retryable).toBe(false);
  });

  it('vpt + 主报告已到 (completed) → completed + 主报告分 (反馈不影响)', () => {
    const state = resolveSessionReportState(
      buildInput({
        hasMainReportChannel: true,
        mainReport: { status: 'completed', overallScore: 91 },
        schoolFeedback: { status: 'completed', overallScore: 76, failureCode: null },
      }),
    );
    expect(state.status).toBe('completed');
    expect(state.overallScore).toBe(91);
  });

  it('vpt + 主报告已到 (parse_error) → parse_error (反馈不改变整体状态)', () => {
    const state = resolveSessionReportState(
      buildInput({
        hasMainReportChannel: true,
        mainReport: { status: 'parse_error', overallScore: 0 },
        schoolFeedback: { status: 'completed', overallScore: 76, failureCode: null },
      }),
    );
    expect(state.status).toBe('parse_error');
    expect(state.overallScore).toBeNull();
  });

  it('vpt + 素材不足 → no_content (空局判定**不受**场景隔离影响)', () => {
    const state = resolveSessionReportState(
      buildInput({
        hasMainReportChannel: true,
        material: EMPTY_MATERIAL,
        schoolFeedback: { status: 'completed', overallScore: 76, failureCode: null },
      }),
    );
    expect(state.status).toBe('no_content');
    expect(state.retryable).toBe(false);
  });
});

describe('复盘报告状态归一 · 陈旧 pending 兜底', () => {
  it('会话**还没结束** → pending (报告本来就还没开始生成)', () => {
    const state = resolveSessionReportState(buildInput({ endedAtMs: null }));
    expect(state.status).toBe('pending');
  });

  it('会话刚结束、还在生成 → pending', () => {
    const state = resolveSessionReportState(buildInput({ endedAtMs: NOW - 60_000 }));
    expect(state.status).toBe('pending');
  });

  it('会话已结束且**超过阈值**、无报告行 → parse_error (不再永远 pending)', () => {
    const state = resolveSessionReportState(buildInput({ endedAtMs: NOW - TIMEOUT_MS - 1000 }));
    expect(state.status).toBe('parse_error');
    expect(state.failureCode).toBe(SupervisionFailureCode.TIMEOUT);
  });

  it('边界: 恰好等于阈值 → 仍是 pending (用 `>` 不是 `>=`, 不误杀正在生成的报告)', () => {
    const state = resolveSessionReportState(buildInput({ endedAtMs: NOW - TIMEOUT_MS }));
    expect(state.status).toBe('pending');
  });

  it('阈值可配: 阈值调大后, 同一个"已结束很久"不再被判失败', () => {
    const endedAtMs = NOW - TIMEOUT_MS - 1000;
    expect(resolveSessionReportState(buildInput({ endedAtMs })).status).toBe('parse_error');
    expect(resolveSessionReportState(buildInput({ endedAtMs, stalePendingTimeoutMs: TIMEOUT_MS * 10 })).status).toBe('pending');
  });

  it('列表侧关闭墙钟兜底 (列表是快照) → 同样是"已结束很久"也只判 pending', () => {
    const state = resolveSessionReportState(buildInput({ endedAtMs: NOW - TIMEOUT_MS - 1000, applyStaleTimeout: false }));
    expect(state.status).toBe('pending');
  });
});
