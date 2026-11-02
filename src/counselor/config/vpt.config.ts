// V2026-10-26 治本 (vpt 全真语音会话 — 业务配置, spec 任务 1 / 任务 7):
//   原因: vpt 增强引入两处**跨模块共享**的业务常量, 都需要单一真相源:
//     ① `VPT_SCENARIO_ID` —— vpt 会话在 `training_sessions` 表里的场景标识.
//        它同时被"落库桥"(写入方) 与"报告查询"(读出方, 据此判定 sessionType) 使用,
//        两边各写一份字面量, 改一处就断链.
//     ② 自述风险等级 → 展示标签的映射 —— 风险的**原始值**在公共人物剧本的
//        `presentingIssue.selfReportedRisk` (low / medium / high / concealed), 那是 AI 独享层,
//        跨模块不能直接传; 要传的是**面向咨询师的中文标签**.
//   反双胞胎:
//     - 不把 `selfReportedRisk` 原始值直接跨模块传: 原始值是**剧本字段**, 跨模块传它
//       等于把 AI 独享层的字段名暴露给协议层, 将来加剧本字段会被顺手带出去
//     - 不用 boolean `hasRisk`: 表达不了"中度风险 vs 高风险"的不同关注点, 而咨询师
//       恰恰要区别对待 (低 → 不必打断; 高 → 必须盯住)
//     - 不用 `low` → "无风险"标签: 没有风险标签 = 没有需要额外关注项, 前端据此**不渲染**
//       风险区 —— 渲染"无风险"反而像是在提示用户"这里没有风险", 是误导
//     - 不在 voice 侧做映射: voice 侧不认识风险语义, 放那儿等于把业务判断写进协议层
//   验证:
//     1. tsc 0 错
//     2. high → 含「涉及危机需识别转介」; low → 空数组
//     3. grep 'VPT_SCENARIO_ID' 于 src/ → 命中写方 + 读方 (无第三处字面量)
//   时间戳: 2026-10-26

import type { SelfReportedRisk } from '../domain/visitor-persona/visitor-persona.types';

/**
 * vpt 会话在 `training_sessions` 表里的场景标识.
 *
 * 用一个**专属值**而不是复用某个单次训练场景 (如 `skill_listening`):
 * vpt 的临场参数来自公共人物模板 + 临场滑杆, 不属于那 9 个预置场景中的任何一个 ——
 * 借用其中一个会让"按场景筛会话"的分面把 vpt 混进专项技能训练里.
 */
export const VPT_SCENARIO_ID = 'vpt_voice';

/**
 * 自述风险等级 → 展示标签.
 *
 * `low` 刻意给**空数组** (而不是"无风险"这种标签): 没有风险标签 = 没有需要额外关注项,
 * 前端据此**不渲染**风险区 —— 渲染"无风险"反而像是在提示用户"这里没有风险", 是误导.
 */
export const RISK_TAGS_BY_SELF_REPORTED_RISK: Readonly<Record<SelfReportedRisk, readonly string[]>> = {
  low: [],
  medium: ['需关注情绪风险'],
  high: ['涉及危机需识别转介'],
  concealed: ['风险可能被隐瞒, 需留意躯体化信号'],
};

/**
 * 自述风险等级 → 展示标签.
 *
 * @param risk 自述风险等级 (剧本 presentingIssue.selfReportedRisk)
 * @returns 标签数组 (不展开风险内容)
 */
export function riskTagsForSelfReportedRisk(risk: SelfReportedRisk | undefined): string[] {
  if (!risk) {
    return [];
  }
  return [...(RISK_TAGS_BY_SELF_REPORTED_RISK[risk] ?? [])];
}
