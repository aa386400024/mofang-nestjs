// V2026-10-27 治本 (情景演练 · LLM 润色层的 prompt 与输出契约):
//   原因: 任务单 §1.3 的判定结果带 `source: keyword | llm`, §2.2 又把 LLM 的权限限定死:
//     "LLM 只在关键词不足时做**形态润色**, **不得由 LLM 直接改判档位**".
//     这两句合起来意味着 LLM **没有判定权**, 只有措辞权 —— 那么 prompt 就必须把这条
//     写成硬约束, 且输出契约必须**结构上**容不下判定字段 (模型即使想改也改不了).
//   修法: 本文件定义 3 件事:
//     ① system prompt: 零压红线 + 只润色不改判 + 禁止号码/机构名/诊断词
//     ② JSON 输出契约: 只允许 { items: [{ tone, pointKey, text }] }
//        —— 注意契约里**没有** verdict / covered / missed / 分数 字段, 模型无从产出
//     ③ user prompt 拼装: 把"确定性判定结果 + 用户原话"交给模型, 让它只改写 items[].text
//
//   ── 为什么 crisis 赛道不走这一层 (与 boundary 不同) ──
//   任务单 §3.1 把危机内容的**审核责任**划给录入方 ("内容审核责任在录入方"),
//   §6 明确 "LLM 自由生成危机人物/剧本（本期全部静态录入）".
//   让模型改写危机批注 = 让未审内容进入危机域, 且模型有可能顺手带出热线号码 /
//   机构名 / 临床措辞 (任务单 §3.1 明令禁止出现的三类东西) —— 风险不对等.
//   故: **crisis 恒走确定性路径** (source 恒为 keyword), boundary 才允许润色.
//   这条差异写在这里, 而不是散在 service 的 if 里.
//
//   ── 反双胞胎 ──
//   - **不给 LLM 判定权**: 输出契约里没有判定字段; verdict / covered / missed
//     永远来自纯函数 (drill-judge.ts), 服务端只接受模型改写后的 items[].text.
//   - **不复用 practice 的评判 prompt**: practice 的模型要判维度; 这里模型只改措辞,
//     任务形状与失败语义都不同 (practice 失败=降级判定, 这里失败=降级措辞).
//   - **不在 prompt 里写 temperature**: M3.1-Flash 官方忽略 temperature/top_p,
//     写进 prompt 是误导后来人.
//
//   验证:
//     1. tsc 0 错
//     2. 模型若试图输出 verdict / 分数 → 结构校验不过 → 整份判废 → 走关键词路径
//     3. 模型若在批注里写"得分 / 及格" → 零压守门拦下 → 整份判废 → 走关键词路径
//   时间戳: 2026-10-27 21:00 GMT+8

import type { DrillItem } from '../domain/drill.types';

/**
 * 演练润色的 system prompt.
 *
 * 硬约束逐条写死 (prompt 是模型唯一的约束面, 服务端还有一道零压守门兜底).
 */
export const DRILL_POLISH_SYSTEM_PROMPT = `你是一位临床督导, 正在帮一名实习咨询师把**已经判定好的技术批注**改写得更贴近他实际说出口的话.

绝对边界 (违反其一即视为不合格输出):
1. 你**没有判定权**. 档位、覆盖清单、每条批注的锚点与语气都已经定好, 你一个字都不能改, 也不能新增或删除批注.
2. 绝不出现分数、等级、评级、通过/不通过、正确/错误.
3. 绝不评价人 (如"你还不行""水平不够""这次很差""有进步"这类句子).
4. 只描述**技术动作**: 学员做了什么 / 没做什么 / 换个说法会怎样.
5. **绝不**出现电话号码、热线号码、机构名、地址、诊断名、风险评估结论或任何求助渠道.
6. 语气中性、专业、具体. 不要安慰, 不要打气, 不要说"加油".

改写要求:
- 每条批注只改**措辞**, 让它读起来像在描述这位学员刚才那一句具体的话 (可以引用原话里的词).
- 批注条数与顺序必须与给定的一致, tone 与 pointKey 必须逐字照抄.
- 文案长度 15 到 45 字, 一句话说完. 不要拼成两段, 不要加标题.
- 不要输出任何额外说明文字或 markdown 代码块.`;

/**
 * 润色的 JSON 输出契约.
 *
 * 注意: 契约里**只有** items —— 没有 verdict / covered / missed / 分数 字段,
 * 模型在结构上就无法产出判定 (这是"不得由 LLM 直接改判档位"的最强保证).
 */
export const DRILL_POLISH_SCHEMA_DESCRIPTION = `输出 JSON 结构 (必须严格符合, 字段名不可改):
{
  "items": [
    { "tone": "positive" | "warning" | "info", "pointKey": "给定锚点 key 之一", "text": "15-45 字的技术描述" }
  ]
}

items 的条数、顺序、tone、pointKey 必须与给定的一致, 不要新增、不要删除、不要改写顺序;
不要输出分数 / 等级 / 对错 / 评价人的话; 不要输出任何额外说明文字或 markdown 代码块.`;

/**
 * 润色输入 (拼 user prompt 用).
 */
export interface DrillPolishPromptInput {
  /** 场景标题. */
  title: string;
  /** 场景说明. */
  setting: string;
  /** 来访者抛出的那句话. */
  visitorPrompt: string;
  /** 学员本次提交的回应原文. */
  submittedText: string;
  /** 确定性判定产出的批注 (模型只改写它们的 text). */
  items: readonly DrillItem[];
}

/**
 * 拼润色的 user prompt.
 *
 * @param input 润色输入
 * @returns user prompt 文本
 */
export function buildDrillPolishUserPrompt(input: DrillPolishPromptInput): string {
  const itemLines = input.items
    .map((item, index) => `${index + 1}. tone=${item.tone} pointKey=${item.pointKey} 原文: ${item.text}`)
    .join('\n');

  return [
    '场景标题: ' + input.title,
    '场景说明: ' + input.setting,
    '来访者原话: ' + input.visitorPrompt,
    '学员这次的回应: ' + input.submittedText,
    '',
    '已定好的批注 (只允许改写 text, tone 与 pointKey 必须原样照抄, 条数与顺序不变):',
    itemLines,
    '',
    '请按上述要求改写每条批注的措辞, 输出 JSON.',
  ].join('\n');
}
