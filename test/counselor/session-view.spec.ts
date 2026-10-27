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
import {
  resolveSessionListDurationSeconds,
  resolveSessionListInterrupted,
  resolveSessionListReportAggregate,
  resolveSessionTypeByScenarioId,
  SESSION_LIST_REPORT_STATUS_VALUES,
  SESSION_LIST_TYPE_VALUES,
} from '../../src/counselor/domain/session-view/session-view.types';
import { SessionType } from '../../src/counselor/enums/session-type.enum';
import { TrainingSessionStatus } from '../../src/counselor/enums/training-session-status.enum';

const VPT_SCENARIO_ID = 'vpt_voice';
const STARTED_AT = new Date('2026-10-27T10:00:00.000Z');
const ENDED_AT = new Date('2026-10-27T10:05:30.000Z');

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
    const result = resolveSessionListReportAggregate({
      report: { status: 'completed', overallScore: 82 },
      sessionStatus: TrainingSessionStatus.FINISHED,
    });
    expect(result).toEqual({ reportStatus: 'completed', overallScore: 82, reportReady: true });
  });

  it('有报告行但生成失败 → parse_error, **分数为 null (不显示 0 分)**', () => {
    const result = resolveSessionListReportAggregate({
      report: { status: 'parse_error', overallScore: 0 },
      sessionStatus: TrainingSessionStatus.FINISHED,
    });
    expect(result).toEqual({ reportStatus: 'parse_error', overallScore: null, reportReady: false });
  });

  it('无报告行但会话已结束 → pending (报告还在异步生成)', () => {
    const result = resolveSessionListReportAggregate({
      report: null,
      sessionStatus: TrainingSessionStatus.FINISHED,
    });
    expect(result).toEqual({ reportStatus: 'pending', overallScore: null, reportReady: false });
  });

  it('无报告行且会话未结束 → none (这条会话不会有报告)', () => {
    for (const status of [
      TrainingSessionStatus.IDLE,
      TrainingSessionStatus.LISTENING,
      TrainingSessionStatus.THINKING,
      TrainingSessionStatus.SPEAKING,
    ]) {
      const result = resolveSessionListReportAggregate({ report: null, sessionStatus: status });
      expect(result).toEqual({ reportStatus: 'none', overallScore: null, reportReady: false });
    }
  });

  it('分数非整数 → 取整 (分数是 0-100 的整数, 库里存的是整型列)', () => {
    const result = resolveSessionListReportAggregate({
      report: { status: 'completed', overallScore: 82.4 },
      sessionStatus: TrainingSessionStatus.FINISHED,
    });
    expect(result.overallScore).toBe(82);
  });

  it('分数越界 / 非有限值 → null (宁可没有分数, 也不显示错分)', () => {
    for (const score of [-1, 101, Number.NaN, Number.POSITIVE_INFINITY]) {
      const result = resolveSessionListReportAggregate({
        report: { status: 'completed', overallScore: score },
        sessionStatus: TrainingSessionStatus.FINISHED,
      });
      expect(result.reportStatus).toBe('completed');
      expect(result.overallScore).toBeNull();
    }
  });

  it('0 分是合法分数 (跟"补 0"是两回事: 补 0 是把失败伪装成成功)', () => {
    const result = resolveSessionListReportAggregate({
      report: { status: 'completed', overallScore: 0 },
      sessionStatus: TrainingSessionStatus.FINISHED,
    });
    expect(result.overallScore).toBe(0);
    expect(result.reportReady).toBe(true);
  });

  it('状态取值域 = 详情端点 3 档 + none', () => {
    expect(SESSION_LIST_REPORT_STATUS_VALUES).toEqual(['completed', 'pending', 'parse_error', 'none']);
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
