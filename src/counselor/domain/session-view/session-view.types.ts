// V2026-10-27 治本 (会话对外视图 — 派生字段的**唯一**判定处):
//   原因: docs/progress/history-list-backend-2026-10-26.md 要求列表项补
//     sessionType / reportStatus / overallScore / reportReady / interrupted.
//     这几个字段**全部是派生值** (库里没有对应列), 判定一旦散落在 service 的 if 里,
//     就会出现两处口径打架 (列表说"生成中", 报告页说"生成失败") ——
//     而这种不一致**不会抛异常**, 只会让学员看到自相矛盾的卡片, 极难排查.
//     规则来源 (任务单 规则 A/B/C):
//       A. sessionType: 场景 id 归一 (vpt_voice → vpt_voice, 其余 → training_session)
//       B. reportStatus: 报告行 + 会话状态 → completed / pending / parse_error / none
//          (只有 reportStatus === 'completed' 时才有分数, 其余一律 null, 绝不补 0)
//       C. interrupted: 开过头 (有开始时间或说过话) 但没走到 finished
//   修法: 全部判定收进本文件 (纯函数, 无 IO, 无 Nest 依赖), service 只负责取数 + 组装;
//     判定逻辑 100% 可单测 (test/counselor/session-view.spec.ts).
//     报告状态复用 session-core 的 SessionReportStatus 再加 'none' 一档
//     (列表要表达"这条会话根本不会有报告", 详情端点不需要这一档).
//   反双胞胎:
//     - 不用 boolean `hasReport` + 让各处自己算 (表达不了"还没生成"与"生成失败"的区别,
//       学员分不清该等还是该重试)
//     - 不新建 reportStatus 枚举: 复用 SessionReportStatus 再加一档, 避免两套字面量各写各的
//     - 不在本文件复制 supervision_reports 的状态字面量: 只做 type 引用 (编译期),
//       运行时零依赖
//     - 不把"陈旧 pending → parse_error"的超时判定搬进列表: 任务单 明确不做
//       (列表是快照, 报告页才是带轮询上限 + 重试的判定现场), 两处语义不同不是 bug
//     - 不在本文件复制 scenario_id 的字面量: VPT 场景标识由调用方注入
//       (本层不反向依赖 config, 跟 domain 层"不认识 Nest / 配置"的口径一致)
//   验证:
//     1. npx jest test/counselor/session-view.spec.ts 全绿
//     2. 故意把 'finished + 无报告行 → pending' 改成 '→ none' → 用例变红
//   时间戳: 2026-10-27 09:20 GMT+8
//
// ─────────────────────────────────────────────────────────────────────────────
// V2026-10-27 治本 (第二轮 — 空会话 / 报告生命周期边界, spec 任务 C):
//   原因: 上一轮的列表判定只吃「报告行 + 会话状态」两件事, 于是:
//     · 空局 (没产生有效对话就结束) 被判成 pending → 用户永远看到"生成中"
//     · 列表与详情各写一份判定 → 改一处忘另一处就出现"列表说 A、详情说 B"
//   修法: 列表判定**不再自己判**, 全部委托给 domain/session-core 的
//     `resolveSessionReportState` (列表与详情共用的唯一派生处); 本文件只负责
//     「列表特有」的那一层: 未结束的会话把 pending 翻成 none.
//   反双胞胎:
//     - 不在本文件再写一份状态判定: 那正是上一轮留下的债, 这轮必须还
//     - 不在列表做墙钟陈旧兜底: 列表是快照, 报告页才是带轮询上限的判定现场
//   验证: npx jest test/counselor/session-view.spec.ts 全绿
//   时间戳: 2026-10-27 13:40 GMT+8

import type { EffectiveMaterial, EffectiveMaterialThresholds } from './session-material';
import { SessionType } from '../../enums/session-type.enum';
import { SupervisionFailureCode } from '../../enums/supervision-failure-code.enum';
import { TrainingSessionStatus } from '../../enums/training-session-status.enum';
import { resolveSessionReportState, type SessionReportStatus, type SessionSchoolFeedbackState } from '../session-core/session-core.types';

/**
 * 列表项的会话类型取值 (2 档).
 *
 * 跟 `SessionType` enum 的关系: 本仓 `training_sessions` 表现阶段只区分
 * 「vpt 全真语音」与「单次训练」两类; `SessionType` 里另外两档
 * (long_term_case_session / full_session) 属于长程个案域, 列表本期不涉及.
 * 这里**引用 enum 成员**而不是复制字面量, 将来 enum 改名不会漏改.
 */
export type SessionListType = SessionType.VPT_VOICE | SessionType.TRAINING_SESSION;

/**
 * 列表项会话类型的合法取值 (供 DTO 校验 + Swagger 展示).
 *
 * 可变数组 (不是 `as const` 元组): Swagger 的 `enum` 选项要求可变数组类型.
 */
export const SESSION_LIST_TYPE_VALUES: SessionListType[] = [SessionType.VPT_VOICE, SessionType.TRAINING_SESSION];

/**
 * 列表项的报告状态.
 *
 * = 详情端点的四档 (`SessionReportStatus`) + 'none'.
 * 'none' 的含义: 这条会话**不会有**报告 (还没结束 / 中断 / 纯空会话),
 * 与 'pending' (已结束、报告正在异步生成) 是两回事, 前端卡片态也不同.
 */
export type SessionListReportStatus = SessionReportStatus | 'none';

/**
 * 列表项报告状态的合法取值 (供 DTO 校验 + Swagger 展示).
 *
 * 前四档直接引用 `SessionReportStatus` 的取值域, 只有 'none' 是列表新增的一档.
 */
export const SESSION_LIST_REPORT_STATUS_VALUES: SessionListReportStatus[] = ['completed', 'pending', 'parse_error', 'no_content', 'none'];

/**
 * 报告行本身的状态 (落库那 2 档).
 *
 * = `SessionReportStatus` 去掉 'pending' 与 'no_content' —— 这两档都是**推导**出来的状态
 * (还没有报告行 / 没有可分析素材), 不是报告行能有的状态.
 * 报告行只有"生成成功"与"生成失败"两种.
 */
export type SessionListReportRowStatus = Exclude<SessionReportStatus, 'pending' | 'no_content'>;

/**
 * 列表项的报告聚合结果 (3 个字段同源, 不允许各算各的).
 */
export interface SessionListReportAggregate {
  /** 报告状态 (5 档). */
  readonly reportStatus: SessionListReportStatus;
  /** 报告总分 0-100; 仅 'completed' 时非 null, 其余一律 null (红线: 绝不补 0). */
  readonly overallScore: number | null;
  /** 报告是否就绪 (= reportStatus === 'completed'). */
  readonly reportReady: boolean;
  /** 失败原因码 (失败态才有值; 非失败态为 null). */
  readonly failureCode: SupervisionFailureCode | null;
  /** 是否可手动重试 (仅 parse_error 且素材充足时为 true). */
  readonly retryable: boolean;
}

/**
 * 场景 id → 会话类型 (规则 A).
 *
 * **全仓唯一**的 scenario_id → SessionType 口径: 列表项 (练习历史) 与报告详情
 * (`GET /counselor/supervision/report/:sessionId`) 共用本函数, 两处不会漂移.
 *
 * @param scenarioId 会话行的 scenario_id
 * @param vptScenarioId vpt 场景标识 (由调用方注入, 避免本层反向依赖 config)
 * @returns vpt_voice / training_session
 */
export function resolveSessionTypeByScenarioId(scenarioId: string, vptScenarioId: string): SessionListType {
  return scenarioId === vptScenarioId ? SessionType.VPT_VOICE : SessionType.TRAINING_SESSION;
}

/**
 * 报告聚合 (规则 B): 报告行 + 会话状态 → 状态 / 分数 / 是否就绪.
 *
 * 判定表 (任务单 规则 B):
 *   - 有报告行且 completed  → completed, 分数取报告分, ready=true
 *   - 有报告行且 parse_error → parse_error, 分数 null, ready=false
 *   - 无报告行且会话 finished → pending (报告异步生成中), 分数 null
 *   - 无报告行且会话未结束   → none (这条会话不会有报告), 分数 null
 *
 * @param input 报告行 (可为 null = 报告还没落库) + 会话状态 + 素材量 + 流派反馈状态
 * @returns 报告聚合结果
 */
export function resolveSessionListReportAggregate(input: {
  readonly report: { readonly status: SessionListReportRowStatus; readonly overallScore: number } | null;
  readonly sessionStatus: TrainingSessionStatus;
  /** 有效素材量 (service 层算好传入; null = 未取到). */
  readonly material: EffectiveMaterial | null;
  /** 最小可分析量阈值. */
  readonly thresholds: EffectiveMaterialThresholds;
  /** 4 流派反馈状态 (counselor 侧); null = 还没有反馈记录. */
  readonly schoolFeedback: SessionSchoolFeedbackState | null;
  /**
   * 这条会话的「报告正身」是不是 agent 主报告链路 (vpt_voice = true).
   *
   * V2026-10-27 治本 (vpt 适用范围隔离): vpt 的反馈只是**附加** (技术统计 + 多流派展示),
   * 不参与整体 reportStatus / overallScore 的判定 —— 判定口径在 domain/session-core
   * 的 `resolveSessionReportState` 里, 本文件不重复实现.
   */
  readonly hasMainReportChannel: boolean;
}): SessionListReportAggregate {
  const state = resolveSessionReportState({
    sessionStatus: input.sessionStatus,
    // 列表是**快照**: 不做墙钟陈旧兜底 → 不传结束时刻与当前时刻.
    endedAtMs: null,
    nowMs: 0,
    stalePendingTimeoutMs: 0,
    applyStaleTimeout: false,
    mainReport: input.report,
    schoolFeedback: input.schoolFeedback,
    material: input.material,
    thresholds: input.thresholds,
    hasMainReportChannel: input.hasMainReportChannel,
  });
  // 未结束的会话: 没有报告内容 → 'none' (这条会话还不会有什么报告),
  // 与 'pending' (已结束、报告正在异步生成) 是两回事.
  const reportStatus: SessionListReportStatus =
    state.status === 'pending' && input.sessionStatus !== TrainingSessionStatus.FINISHED ? 'none' : state.status;
  return {
    reportStatus,
    overallScore: state.overallScore,
    reportReady: reportStatus === 'completed',
    failureCode: state.failureCode,
    retryable: state.retryable,
  };
}

/**
 * 是否中断 (规则 C).
 *
 * 判据: 没走到 finished, 且"开过头" (有开始时间或说过话) —— 纯 idle 且没开过的不算.
 *
 * @param input 会话状态 + 开始时间 + 已说话轮数
 * @returns true = 已中断 (前端灰态, 不可进报告页)
 */
export function resolveSessionListInterrupted(input: {
  readonly status: TrainingSessionStatus;
  readonly startedAt: Date | null;
  readonly turnCount: number;
}): boolean {
  if (input.status === TrainingSessionStatus.FINISHED) {
    return false;
  }
  return input.startedAt !== null || input.turnCount > 0;
}

/**
 * 会话时长 (秒) — 任务单 可选增强.
 *
 * 后端算好下发比前端拿时间戳自己猜稳 (前端拿到的两个时间戳可能来自不同来源).
 *
 * @param startedAt 开始时间
 * @param endedAt 结束时间
 * @returns 秒数; 任一端缺失 → null (不编造)
 */
export function resolveSessionListDurationSeconds(startedAt: Date | null, endedAt: Date | null): number | null {
  if (startedAt === null || endedAt === null) {
    return null;
  }
  const seconds = Math.floor((endedAt.getTime() - startedAt.getTime()) / 1000);
  return Math.max(seconds, 0);
}
