// V2026-10-26 治本 (来访者速查卡构造 — 纯函数, spec 任务 7):
//   原因: 任务 7 要在前端准备页 / 会话页补一张"来访者速查卡" (年龄区间 / 职业 / 主诉 /
//     风险标签), 且**不下发 7 大块剧本**. 这三件事要同时成立:
//       ① 卡片只由**可公开的表层字段**构成 (类型层面就不可能带出剧本)
//       ② 年龄区间要有下限数值 (前端要按年龄段排版, 光有「28-35」不够)
//       ③ 风险标签只**标记不展开**
//   修法: 本文件是卡片构造的**唯一出口** (纯函数, 无 DI):
//     - parseAgeRangeLowerBound  年龄区间 → 下限 (counselor 侧 prompt 组装也复用它)
//     - buildVoiceVisitorCard     模板摘要 → 速查卡
//   反双胞胎:
//     - 不让 counselor 侧直接构造卡片: 卡片是**跨模块契约**, 构造逻辑放 voice 侧,
//       counselor 只负责"提供摘要里那几项表层字段" —— 两边各造一份卡片必然漂移
//     - 不在卡片里放剧本字段 (basics / innerWorkingModel / ...): 卡片一旦能装剧本,
//       下一次加字段就可能顺手带出去 —— 零压红线的结构级保证靠**类型**不靠自觉
//     - 不解析精确年龄: 公共人物只存区间 (避免可识别), 下限是"约"值, 语义是下限不是生日
//   验证:
//     1. tsc 0 错
//     2. 「28-35」→ 下限 28;「40+」→ 40;「未知」→ null (不是 0)
//     3. 卡片字段里 grep 不到 script / 剧本 7 大块任一字段名
//   时间戳: 2026-10-26

import type { VoiceTemplateSummary, VoiceVisitorCard } from './voice-session.types';

/**
 * 年龄区间 → 下限.
 *
 * 公共人物只存**区间**不存精确生日 (可识别性红线), 所以这里取的是"下限约值":
 *   - 「28-35」→ 28
 *   - 「40+」   → 40
 *   - 「未知」 → null (**不是 0** —— 0 岁是荒谬的假值, null 才能表达"解析不出")
 *
 * @param ageRange 年龄区间字符串
 * @returns 下限; 解析不出 → null
 */
export function parseAgeRangeLowerBound(ageRange: string): number | null {
  const matched = /(\d+)/.exec(ageRange);
  if (!matched?.[1]) {
    return null;
  }
  const parsed = Number(matched[1]);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * 模板摘要 → 来访者速查卡.
 *
 * @param summary 公共人物模板表层摘要
 * @returns 速查卡
 */
export function buildVoiceVisitorCard(summary: VoiceTemplateSummary): VoiceVisitorCard {
  return {
    templateId: summary.templateId,
    codename: summary.codename,
    ageRange: summary.ageRange,
    ageLowerBound: parseAgeRangeLowerBound(summary.ageRange),
    occupation: summary.occupation,
    presentingComplaint: summary.presentingComplaint,
    riskTags: [...summary.riskTags],
  };
}
