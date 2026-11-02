// V2026-10-27 治本 (练习历史列表 — 派生字段判定单测):
//   原因: 列表项的 sessionType / reportStatus / overallScore / reportReady / interrupted
//     **全部是派生值** (库里没有对应列), 而这类判定写错**不会抛异常** ——
//     只会让学员看到"总分 0 分"或"已生成却显示生成中"这种自相矛盾的卡片, 极难排查.
//     规则散在 service 的 if 里时, 也没有任何东西能锁住它.
//   修法: 判定全部收进 domain/session-view/session-view.types.ts (纯函数), 本文件锁死:
//     ① 规则 A: 场景 id → 会话类型
//     ② 规则 B: 报告行 + 会话状态 → 报告状态 / 分数 / 是否就绪 (含"绝不补 0"红线)
//     ③ 规则 C: 是否中断
//     ④ 时长秒数
//   验证:
//     1. npx jest test/counselor/session-view.spec.ts 全绿
//     2. 故意把 'parse_error → overallScore null' 改成 '→ 0' → "不显示 0 分"用例变红
//   时间戳: 2026-10-27 09:20 GMT+8
//
// ─────────────────────────────────────────────────────────────────────────────
// V2026-10-27 治本 (第二轮 — 空局 / 失败终态, spec 任务 C):
//   原因: 列表判定新增两个输入 (素材量 / 4 流派反馈状态), 且状态多了一档 `no_content`.
//     "空局被误判成 pending (永久生成中)" 与 "失败终态没显示出来" 都是**静默**的错误,
//     必须有测试锁住.
//   修法: 本文件补齐 ⑤ 空局 → no_content / ⑥ 失败终态 → parse_error + failureCode /
//     ⑦ 4 流派反馈成功 → completed (单次训练的唯一报告内容来源).
//   验证: npx jest test/counselor/session-view.spec.ts 全绿
//   时间戳: 2026-10-27 14:10 GMT+8
//
// ─────────────────────────────────────────────────────────────────────────────
// V2026-10-27 治本 (第三轮 — vpt 适用范围隔离, vpt-feedback-status-isolation-2026-10-27.md):
//   原因: ⑦ 对**所有** sessionType 无差别生效, 于是 vpt 会在「主报告还没异步到达」的
//     窗口里被反馈带跑: 反馈先成功 → 提前 completed (但 dimensions/annotations 为空),
//     反馈先失败 → 误报 parse_error (主报告其实可能成功).
//   修法: 派生入参加一个场景位 `hasMainReportChannel` (vpt=true / 单次训练=false);
//     vpt 跳过反馈档, 反馈照常读取但只当"附加" (技术统计 / 多流派展示).
//   验证: npx jest test/counselor/session-view.spec.ts 全绿
//   时间戳: 2026-10-27 13:55 GMT+8
import {
  resolveSessionListDurationSeconds,
  resolveSessionListInterrupted,
  resolveSessionListReportAggregate,
  resolveSessionTypeByScenarioId,
  SESSION_LIST_REPORT_STATUS_VALUES,
  SESSION_LIST_TYPE_VALUES,
} from '../../src/counselor/domain/session-view/session-view.types';
import { SupervisionFailureCode } from '../../src/counselor/enums/supervision-failure-code.enum';
import { SessionType } from '../../src/counselor/enums/session-type.enum';
import { TrainingSessionStatus } from '../../src/counselor/enums/training-session-status.enum';

const VPT_SCENARIO_ID = 'vpt_voice';
const STARTED_AT = new Date('2026-10-27T10:00:00.000Z');
const ENDED_AT = new Date('2026-10-27T10:05:30.000Z');

/** 默认阈值 (与 config `supervision.minEffectiveTurns` / `minEffectiveChars` 同值). */
const THRESHOLDS = { minTurns: 2, minChars: 30 };

/** 素材充足 (2 轮 / 40 字). */
const ENOUGH_MATERIAL = { effectiveTurns: 2, effectiveChars: 40 };

/** 素材不足 (1 轮 / 12 字) — 空局. */
const EMPTY_MATERIAL = { effectiveTurns: 1, effectiveChars: 12 };

/** 列表派生的入参形状 (取自被测函数的签名, 避免手抄漂移). */
type ListAggregateInput = Parameters<typeof resolveSessionListReportAggregate>[0];

/**
 * 列表派生调用器 (默认 = 单次训练口径: 无主报告链路 + 素材充足 + 会话已结束).
 *
 * @param overrides 差异项
 * @returns 列表报告聚合
 */
function buildAggregate(overrides: Partial<ListAggregateInput> = {}): ReturnType<typeof resolveSessionListReportAggregate> {
  return resolveSessionListReportAggregate({
    report: null,
    sessionStatus: TrainingSessionStatus.FINISHED,
    material: ENOUGH_MATERIAL,
    thresholds: THRESHOLDS,
    schoolFeedback: null,
    hasMainReportChannel: false,
    ...overrides,
  });
}

describe('规则 A · 场景 id → 会话类型', () => {
  it('vpt 场景 → vpt_voice', () => {
    expect(resolveSessionTypeByScenarioId(VPT_SCENARIO_ID, VPT_SCENARIO_ID)).toBe(SessionType.VPT_VOICE);
  });

  it('其余场景 (全流程 / 专项技能) 一律 → training_session', () => {
    expect(resolveSessionTypeByScenarioId('workplace', VPT_SCENARIO_ID)).toBe(SessionType.TRAINING_SESSION);
    expect(resolveSessionTypeByScenarioId('skill_listening', VPT_SCENARIO_ID)).toBe(SessionType.TRAINING_SESSION);
    expect(resolveSessionTypeByScenarioId('case_ethics', VPT_SCENARIO_ID)).toBe(SessionType.TRAINING_SESSION);
  });

  it('取值域只有 2 档 (前端分段切换只用这 2 个)', () => {
    expect(SESSION_LIST_TYPE_VALUES).toEqual(['vpt_voice', 'training_session']);
  });
});

describe('规则 B · 报告状态聚合', () => {
  it('有报告行且生成成功 → completed + 分数 + ready', () => {
    const result = buildAggregate({
      report: { status: 'completed', overallScore: 82 },
    });
    expect(result).toEqual({
      reportStatus: 'completed',
      overallScore: 82,
      reportReady: true,
      failureCode: null,
      retryable: false,
    });
  });

  it('有报告行但生成失败 → parse_error, **分数为 null (不显示 0 分)**', () => {
    const result = buildAggregate({
      report: { status: 'parse_error', overallScore: 0 },
    });
    expect(result).toEqual({
      reportStatus: 'parse_error',
      overallScore: null,
      reportReady: false,
      failureCode: SupervisionFailureCode.PARSE_FAILED,
      retryable: true,
    });
  });

  it('无报告行但会话已结束 → pending (报告还在异步生成)', () => {
    const result = buildAggregate({});
    expect(result).toEqual({
      reportStatus: 'pending',
      overallScore: null,
      reportReady: false,
      failureCode: null,
      retryable: false,
    });
  });

  it('无报告行且会话未结束 → none (这条会话不会有报告)', () => {
    for (const status of [
      TrainingSessionStatus.IDLE,
      TrainingSessionStatus.LISTENING,
      TrainingSessionStatus.THINKING,
      TrainingSessionStatus.SPEAKING,
    ]) {
      const result = buildAggregate({ sessionStatus: status });
      expect(result.reportStatus).toBe('none');
      expect(result.overallScore).toBeNull();
      expect(result.reportReady).toBe(false);
    }
  });

  it('分数非整数 → 取整 (分数是 0-100 的整数, 库里存的是整型列)', () => {
    const result = buildAggregate({ report: { status: 'completed', overallScore: 82.4 } });
    expect(result.overallScore).toBe(82);
  });

  it('分数越界 / 非有限值 → null (宁可没有分数, 也不显示错分)', () => {
    for (const score of [-1, 101, Number.NaN, Number.POSITIVE_INFINITY]) {
      const result = buildAggregate({ report: { status: 'completed', overallScore: score } });
      expect(result.reportStatus).toBe('completed');
      expect(result.overallScore).toBeNull();
    }
  });

  it('0 分是合法分数 (跟"补 0"是两回事: 补 0 是把失败伪装成成功)', () => {
    const result = buildAggregate({ report: { status: 'completed', overallScore: 0 } });
    expect(result.overallScore).toBe(0);
    expect(result.reportReady).toBe(true);
  });

  it('状态取值域 = 详情端点 4 档 + none', () => {
    expect(SESSION_LIST_REPORT_STATUS_VALUES).toEqual(['completed', 'pending', 'parse_error', 'no_content', 'none']);
  });
});

describe('规则 B-2 · 空局 → no_content (spec 任务 C)', () => {
  it('会话已结束 + 素材不足 + 无报告行 → no_content (不是 pending!)', () => {
    const result = buildAggregate({ material: EMPTY_MATERIAL });
    expect(result).toEqual({
      reportStatus: 'no_content',
      overallScore: null,
      reportReady: false,
      failureCode: null,
      retryable: false,
    });
  });

  it('空局 **不可重试** (重试多少次都是空)', () => {
    expect(buildAggregate({ material: EMPTY_MATERIAL }).retryable).toBe(false);
  });

  it('会话**还没结束**时不判空局 (素材还在长, 提前判空会误伤刚开始的会谈)', () => {
    const result = buildAggregate({ sessionStatus: TrainingSessionStatus.LISTENING, material: EMPTY_MATERIAL });
    expect(result.reportStatus).toBe('none');
  });

  it('素材量未知 (null) → 不判空局 (无法证明"没有素材")', () => {
    const result = buildAggregate({ material: null });
    expect(result.reportStatus).toBe('pending');
  });
});

describe('规则 B-3 · 4 流派反馈 (单次训练的唯一报告内容来源, spec 任务 C/D)', () => {
  it('单次训练: 4 流派反馈成功 → completed (单次训练没有主报告行, 靠它不落 pending)', () => {
    const result = buildAggregate({
      schoolFeedback: { status: 'completed', overallScore: 78, failureCode: null },
    });
    expect(result.reportStatus).toBe('completed');
    expect(result.overallScore).toBe(78);
    expect(result.reportReady).toBe(true);
  });

  it('单次训练: 4 流派反馈失败 → parse_error + 失败原因码 (可重试)', () => {
    const result = buildAggregate({
      schoolFeedback: { status: 'parse_error', overallScore: null, failureCode: SupervisionFailureCode.RATE_LIMITED },
    });
    expect(result.reportStatus).toBe('parse_error');
    expect(result.overallScore).toBeNull();
    expect(result.failureCode).toBe(SupervisionFailureCode.RATE_LIMITED);
    expect(result.retryable).toBe(true);
  });

  it('主报告行优先于 4 流派反馈 (主报告是"报告"的正身)', () => {
    const result = buildAggregate({
      report: { status: 'completed', overallScore: 91 },
      schoolFeedback: { status: 'parse_error', overallScore: null, failureCode: SupervisionFailureCode.RATE_LIMITED },
    });
    expect(result.reportStatus).toBe('completed');
    expect(result.overallScore).toBe(91);
  });

  it('空局优先于失败反馈 (素材不足归 no_content, 不落 parse_error)', () => {
    const result = buildAggregate({
      material: EMPTY_MATERIAL,
      schoolFeedback: { status: 'parse_error', overallScore: null, failureCode: SupervisionFailureCode.TIMEOUT },
    });
    expect(result.reportStatus).toBe('no_content');
    expect(result.retryable).toBe(false);
  });
});

describe('规则 B-4 · vpt 适用范围隔离 (vpt-feedback-status-isolation-2026-10-27)', () => {
  it('vpt + 主报告未到 + 反馈成功 → pending (**不得** completed)', () => {
    const result = buildAggregate({
      hasMainReportChannel: true,
      schoolFeedback: { status: 'completed', overallScore: 78, failureCode: null },
    });
    expect(result.reportStatus).toBe('pending');
    expect(result.overallScore).toBeNull();
    expect(result.reportReady).toBe(false);
  });

  it('vpt + 主报告未到 + 反馈失败 → pending (**不得** parse_error)', () => {
    const result = buildAggregate({
      hasMainReportChannel: true,
      schoolFeedback: { status: 'parse_error', overallScore: null, failureCode: SupervisionFailureCode.UPSTREAM_UNAVAILABLE },
    });
    expect(result.reportStatus).toBe('pending');
    expect(result.overallScore).toBeNull();
    expect(result.failureCode).toBeNull();
    expect(result.retryable).toBe(false);
  });

  it('vpt + 主报告已到 (completed) → completed + 主报告分 (反馈不影响)', () => {
    const result = buildAggregate({
      hasMainReportChannel: true,
      report: { status: 'completed', overallScore: 91 },
      schoolFeedback: { status: 'completed', overallScore: 78, failureCode: null },
    });
    expect(result.reportStatus).toBe('completed');
    expect(result.overallScore).toBe(91);
  });

  it('vpt + 主报告已到 (parse_error) → parse_error (反馈不改变整体状态)', () => {
    const result = buildAggregate({
      hasMainReportChannel: true,
      report: { status: 'parse_error', overallScore: 0 },
      schoolFeedback: { status: 'completed', overallScore: 78, failureCode: null },
    });
    expect(result.reportStatus).toBe('parse_error');
    expect(result.overallScore).toBeNull();
  });

  it('vpt + 素材不足 → no_content (空局判定**不受**场景隔离影响)', () => {
    const result = buildAggregate({
      hasMainReportChannel: true,
      material: EMPTY_MATERIAL,
      schoolFeedback: { status: 'completed', overallScore: 78, failureCode: null },
    });
    expect(result.reportStatus).toBe('no_content');
  });

  it('vpt + 主报告未到 + 无反馈 → pending (与单次训练同档, 不会被场景位改坏)', () => {
    const result = buildAggregate({ hasMainReportChannel: true });
    expect(result.reportStatus).toBe('pending');
  });
});

describe('规则 C · 是否中断', () => {
  it('已结束 → 不算中断', () => {
    expect(
      resolveSessionListInterrupted({
        status: TrainingSessionStatus.FINISHED,
        startedAt: STARTED_AT,
        turnCount: 12,
      }),
    ).toBe(false);
  });

  it('进行中 + 有开始时间 → 中断', () => {
    expect(
      resolveSessionListInterrupted({
        status: TrainingSessionStatus.LISTENING,
        startedAt: STARTED_AT,
        turnCount: 0,
      }),
    ).toBe(true);
  });

  it('进行中 + 说过话 (无开始时间) → 中断', () => {
    expect(
      resolveSessionListInterrupted({
        status: TrainingSessionStatus.SPEAKING,
        startedAt: null,
        turnCount: 3,
      }),
    ).toBe(true);
  });

  it('纯 idle 且没开过 (无开始时间 + 0 轮) → 不算中断 (空会话, 不是中断)', () => {
    expect(
      resolveSessionListInterrupted({
        status: TrainingSessionStatus.IDLE,
        startedAt: null,
        turnCount: 0,
      }),
    ).toBe(false);
  });
});

describe('会话时长 (秒)', () => {
  it('有起止时间 → 秒数', () => {
    expect(resolveSessionListDurationSeconds(STARTED_AT, ENDED_AT)).toBe(330);
  });

  it('缺任一端 → null (不编造时长)', () => {
    expect(resolveSessionListDurationSeconds(STARTED_AT, null)).toBeNull();
    expect(resolveSessionListDurationSeconds(null, ENDED_AT)).toBeNull();
    expect(resolveSessionListDurationSeconds(null, null)).toBeNull();
  });

  it('不足 1 秒 → 0', () => {
    expect(resolveSessionListDurationSeconds(STARTED_AT, new Date(STARTED_AT.getTime() + 400))).toBe(0);
  });
});
