// V2026-10-27 治本 (督导生成相关阈值 — 单一真值源, spec 任务 A/E):
//   原因: 这三个阈值散落在两处时会漂:
//     · `src/config/envs/default.ts` 里的 env 兜底值 (运行时真正生效的那个)
//     · service 里的 `?? 默认值` 兜底 (config 键缺失时的保护)
//     两边各写一份字面量, 改一处忘另一处 → "改了配置但没生效" 或 "默认值对不上",
//     而这类不一致**不会抛异常**, 只会让"空局判定"在某些部署下失效.
//   修法: 本文件是这三个阈值的**唯一真值源**:
//     - src/config/envs/default.ts 引用它做 env 兜底
//     - service 引用它做 config 缺失兜底
//   反双胞胎:
//     - 不把阈值写进 domain 的判定函数: 判定只吃入参 (纯函数, 可单测)
//     - 不在 domain 层放默认值: domain 是零依赖的最底层, 不该知道"配置"这件事
//   验证:
//     1. tsc 0 错
//     2. env 不配时, 生效值 = 本文件的常量 (minEffectiveTurns=2 / minEffectiveChars=30 / 5min)
//   时间戳: 2026-10-27 13:50 GMT+8

/**
 * 最小有效轮数 (默认 2 轮).
 *
 * 低于这个数 → 判为空局 (no_content): 1 轮对话撑不起一份督导报告.
 */
export const SUPERVISION_MIN_EFFECTIVE_TURNS = 2;

/**
 * 最小有效字数 (默认 30 字).
 *
 * 低于这个数 → 判为空局: "2 轮但每轮 3 个字"同样没有分析价值
 * (任务单 D2 拍板: 轮数与字数满足**其一**不足即算空局).
 */
export const SUPERVISION_MIN_EFFECTIVE_CHARS = 30;

/**
 * 陈旧 pending 兜底阈值 (默认 5 分钟).
 *
 * 只覆盖"worker 没跑 / 落库失败"这类漏网 —— 正常失败已由失败终态主动落
 * `parse_error` (spec 任务 D2), 不再依赖墙钟猜.
 *
 * 5 分钟的余量依据: 4 流派督导的 LLM 调用正常 30-120s, 5 分钟是它的 2.5-10 倍,
 * 既不会把"慢"误判成"失败", 也不会让学员盯着转圈 15 分钟.
 */
export const SUPERVISION_REPORT_PENDING_TIMEOUT_MS = 300_000;
