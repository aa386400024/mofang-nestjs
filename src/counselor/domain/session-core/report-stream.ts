// V2026-10-29 治本 (WP21 — 报告生成 SSE 推送端点 · 推送决策纯函数):
//   原因: SSE 端点要按任务单 §2 做一张**三岔的决策表** —— 「推报告 / 推超时 / 继续等」.
//     这张表一旦写成 service 里的 if-else 散落两处 (首次查询一处、轮询一处),
//     改一处忘另一处就会出现「已经终态了还在轮询」或「超时了还在等」这类**只在线上暴露**的 bug;
//     而且它没有 IO, 本可以单测, 内联进 service 就只能靠联调兜.
//   修法: 本文件把决策收成**一个纯函数** `decideReportStreamAction` ——
//     输入只有「当前报告状态 / 当前时刻 / 截止时刻」三个事实, 输出一个动作.
//     service 只负责取事实 + 按动作执行, 不再自己判断.
//   反双胞胎:
//     - 不在 domain 层读时钟: `nowMs` 由调用方传入 (与 `resolveSessionReportState` 同口径),
//       纯函数保持纯粹 (可测 / 可重放 / 不受墙钟影响)
//     - 不把「超时」塞进报告四态: `SessionReportStatus` 是**报告本身**的状态,
//       报告没有「超时」这种状态 —— 超时是**推送通道**的状态, 两者混在一起
//       前端就会把"通道超时"当成"报告失败"(两者给用户的处置完全不同)
//     - 不用 boolean 返回值: 三岔决策用 boolean 表达会出现 `true` 到底是"推报告"还是"推超时"
//       的歧义, 动作名自解释
//   验证:
//     1. tsc 0 错
//     2. 单测锁住决策表四行 (终态 / 未到点 / 到点 / pending)
//   时间戳: 2026-10-29

import { type SessionReportStatus } from './session-core.types';

/**
 * 等待超时状态值 (推送通道专用, **不属于报告四态**).
 *
 * 任务单 §2.4: 等待超过上限时推 `data: {"status":"timeout"}` 并关流.
 * 它描述的是"这条推送通道等不到报告了", 不是"这份报告生成失败了" ——
 * 前者该提示"稍后再看", 后者该提示"重试生成", 处置不同, 不能混.
 */
export const REPORT_STREAM_TIMEOUT_STATUS = 'timeout';

/**
 * 等待超时负载 (只带一个 status 字段).
 *
 * 为什么不给别的字段: 前端拿到它只需要知道"别再等了", 给一堆空字段反而会让前端
 * 误以为"这是一份空报告"而渲染出一张空卡片.
 */
export interface ReportStreamTimeoutPayload {
  /** 恒为 `'timeout'`. */
  readonly status: typeof REPORT_STREAM_TIMEOUT_STATUS;
}

/**
 * 推送动作.
 *
 * - `emit_report`  : 推一份完整报告 (报告已到终态), 随后关流
 * - `emit_timeout` : 推等待超时负载, 随后关流
 * - `keep_waiting` : 继续等 (报告还在 pending, 且没到超时点)
 */
export type ReportStreamAction = 'emit_report' | 'emit_timeout' | 'keep_waiting';

/**
 * 决策入参 (全部是**已取好的事实**, 本函数不碰 IO、不读时钟).
 */
export interface ReportStreamDecisionInput {
  /** 当前已派生的报告状态 (四态之一). */
  readonly status: SessionReportStatus;
  /** 当前时刻 (ms) —— 调用方传入, 保持纯函数. */
  readonly nowMs: number;
  /** 等待截止时刻 (ms). */
  readonly deadlineMs: number;
}

/**
 * 报告推送的**唯一决策处** (任务单 §2 的决策表).
 *
 * 判定优先级 (自上而下, 先命中先返回):
 *   1. 报告已到终态 (completed / parse_error / no_content) → `emit_report`
 *      —— 终态优先于超时: 报告已经能看了, 哪怕刚好踩着超时点, 也该把报告推出去
 *      (让用户"超时"却看不到已经生成的报告 = 白等一场)
 *   2. 还没到截止时刻且报告仍 pending → `keep_waiting`
 *   3. 到点了仍是 pending → `emit_timeout`
 *
 * 反双胞胎:
 *   - 不用 `status !== 'pending'` 的隐式约定散在两处: 这里显式成一条规则, 读代码即知
 *   - 不把超时当成"报告失败": 见 {@link REPORT_STREAM_TIMEOUT_STATUS} 的注释
 *
 * @param input 决策入参
 * @returns 推送动作
 */
export function decideReportStreamAction(input: ReportStreamDecisionInput): ReportStreamAction {
  if (input.status !== 'pending') {
    return 'emit_report';
  }
  if (input.nowMs >= input.deadlineMs) {
    return 'emit_timeout';
  }
  return 'keep_waiting';
}

/**
 * 构造等待超时负载.
 *
 * @returns 只带 `status='timeout'` 的负载
 */
export function buildReportStreamTimeoutPayload(): ReportStreamTimeoutPayload {
  return { status: REPORT_STREAM_TIMEOUT_STATUS };
}
