// V2026-10-21 治本 (V1.2 VS-C — M2/M3 两个分析器的 prompt + 输出契约):
//   原因: VS-C 有 2 个独立的 LLM 分析任务, 它们的输出契约完全不同, 混在一起会互相污染:
//     ① 每轮分析器 (spec §6.1 + §6.4): 读"咨询师这一轮 + 来访者这一轮", 产出
//        「实时轻提示 (可空)」+「移情/阻抗标记 (可空)」—— 一次调用两段结果
//     ② 知情同意判定器 (spec §5.2): 读同意阶段的完整对话, 产出 4 要素逐项覆盖明细
//   修法: 本文件集中 2 组 system prompt + JSON 契约 + user prompt 拼装.
//   反双胞胎:
//     - 不共用一个 prompt: 两个任务的输入粒度 (一轮 vs 一整段) / 输出形状 (可空 vs 必填 4 项)
//       / 失败语义 (本轮无发现是合法结果 vs 判定失败就是失败) 完全不同
//     - 不在 prompt 里写"温度": M3.1-Flash 忽略 temperature/top_p (官方文档), 确定性只能靠
//       prompt 约束 + reasoning_effort 分档
//     - 不用 spec 原文的 "temperature=0": 对 M3.1-Flash 无效, 写进 prompt 是误导后来人
//   验证:
//     1. tsc 0 错
//     2. 大炮跑一轮真实会话 → 轻提示只给方向 (不含可直接照念的话术)
//     3. 跑知情同意判定 → 4 个 element 齐全 + covered 判定跟对话对得上
//   时间戳: 2026-10-21

import type { LiveTurnAnalysisInput } from '../domain/session-core/session-core.types';
import { ChatRole } from '../enums/chat-role.enum';
import { INFORMED_CONSENT_ELEMENT_LABELS } from '../enums/informed-consent-element.enum';

// ════════════════════════════════════════════════════════════════════════════
// ① 每轮分析器
// ════════════════════════════════════════════════════════════════════════════

/**
 * 每轮分析器的 system prompt.
 *
 * 关键硬约束 (spec §6.1 防依赖设计 4 条中能在后端落实的 2 条):
 *   1. 提示只给**方向**, 禁止输出替代话术原文
 *   2. 同一类提示 5 分钟内不重复 (后端防抖实现, 但 prompt 里也要让模型自己少给重复建议)
 */
export const TURN_ANALYZER_SYSTEM_PROMPT = `你是一位实时会话观察者, 正在旁观一场心理咨询初访, 每轮对话后给咨询师一条**方向性**提示.

你的输出会被展示在咨询师屏幕侧边的浮窗里, 浮窗不打断对话, 咨询师可以选择看不看.

硬性规则:
1. **只给方向, 绝不写替代话术**. 不要输出任何可以直接照念给来访者的话, 不要写"你应该说:……".
   正确示例: "可尝试开放式提问" / "建议在此处做一次风险评估" / "留意自己的情绪反应".
   错误示例: "你可以这样问: 你最近睡眠怎么样?"
2. 一次最多给 1 条提示. 没有值得提示的就返回 null —— **沉默优于废话**.
3. 只在下列情形给提示:
   - closed_question_run: 连续 3 轮以上封闭式提问 (只给开放式提问的窄口径/封闭性选项)
   - suicide_cue: 来访提到自伤/自杀/不想活
   - premature_advice: 未经询问直接给建议/下判断
   - missed_empathy: 来访有明显情绪而咨询师完全没接住
   - topic_jump: 话题在未处理完时突然跳转
   - over_interpretation: 咨询师做了超出证据的解释/归因
4. 提示正文 40 字以内, 是一句可执行的方向, 不是评价.

另外判断来访这一轮是否出现移情/阻抗, 命中则给一条标记:
- resistance: 阻抗 (推开/防御/质疑咨询师)
- avoidance: 回避 (转移话题/沉默/答非所问)
- positive_transference: 正移情 (把咨询师当成理想化对象)
- negative_transference: 负移情 (把咨询师当成权威/评判者/父母)
- dissociation: 解离 (情感或语流脱节)
没有明确迹象就返回 null.

最后做**披露抽取** —— 来访这一轮主动说出了哪些人设信息:
- 只抽"来访明确说出来"的, 不推测, 不抽你自己知道的背景
- anchorKey 必须落在以下 7 个前缀之内, 且必须指向该块里**确实存在**的节点:
  basics / developmentalTimeline / innerWorkingModel / socialMap / coping / therapyExpectation / presentingIssue
  例: "basics.psychHistory" / "innerWorkingModel.coreBeliefs[0]" / "socialMap[0].currentStatus"
- content 用来访者的原话或紧贴原话的摘要, 不要改写成第三人称
- 本轮没披露任何新信息就返回空数组 []`;

/**
 * 每轮分析器的 JSON 输出契约.
 */
export const TURN_ANALYZER_SCHEMA_DESCRIPTION = `输出 JSON 结构 (必须严格符合, 字段名不可改):
{
  "hint": null | { "category": "closed_question_run" | "suicide_cue" | "premature_advice" | "missed_empathy" | "topic_jump" | "over_interpretation", "hintText": "40 字以内的方向提示" },
  "mark": null | { "direction": "visitor_auto", "markType": "resistance" | "avoidance" | "positive_transference" | "negative_transference" | "dissociation", "note": "一句话说明依据" },
  "disclosures": [ { "anchorKey": "全量人设的 JSON path", "content": "来访者原话或摘要" } ]
}

hint / mark 可以是 null (本轮无发现); disclosures 可以是空数组 (本轮无新披露).
disclosures 的 anchorKey 前缀只能是下面 7 个之一:
basics / developmentalTimeline / innerWorkingModel / socialMap / coping / therapyExpectation / presentingIssue
不要输出任何额外说明文字或 markdown 代码块.`;

/**
 * 拼每轮分析器的 user prompt.
 *
 * @param input 本轮输入 (咨询师的话 + 来访的回应 + 最近几轮上下文)
 */
export function buildTurnAnalysisUserPrompt(input: LiveTurnAnalysisInput): string {
  const lines: string[] = ['本轮对话:'];
  for (const turn of input.recentTurns) {
    const label = turn.role === ChatRole.COUNSELOR ? '咨询师' : '来访者';
    lines.push(`[${label}] ${turn.text}`);
  }
  lines.push(
    '',
    `[咨询师] (本轮) ${input.counselorText}`,
    `[来访者] (本轮) ${input.visitorText}`,
    '',
    '请按规则判断: 本轮是否需要给咨询师一条方向提示? 来访这一轮是否出现移情/阻抗? 来访这一轮披露了什么?',
  );
  if (input.tier === 'off') {
    // V2026-10-21 治本 (V1.2 VS-B2 — 档位感知):
    //   原因: 档位 off = 用户关闭了实时提示, 再让模型生成 hint 是白花 token.
    //   修法: 直接告诉模型本轮不要给提示 (hint 必须是 null), mark 与 disclosures 照常产出.
    lines.push('注意: 本次会话的实时提示档位是 off (用户已关闭), hint 必须是 null, 不要再给方向提示.');
  }
  return lines.join('\n');
}

// ════════════════════════════════════════════════════════════════════════════
// ② 知情同意判定器
// ════════════════════════════════════════════════════════════════════════════

/**
 * 知情同意判定器的 system prompt.
 *
 * spec §5.2: 「用户必须在对话中跟 AI 来访完成知情同意 4 要素, 缺失任意 1 项 AI 来访会主动追问
 * ("那……这个会保密吗?"), 督导报告记为『知情同意缺失』」.
 */
export const CONSENT_JUDGE_SYSTEM_PROMPT = `你是一位临床督导, 正在评估一名实习咨询师在会谈开始前是否完成了知情同意.

专业要求:
1. 只依据对话里**真实说出**的内容判定, 不推测"他大概是想说了".
2. 讲了一半不算 covered (比如只说了"要保密"但没说清保密例外, 不算 confidentiality covered).
3. 来访的反应要如实记录: 接受 / 有疑问 / 担心保密 / 犹豫 / 拒绝录音.
4. 咨询师完全没提某个要素 → covered=false, visitorResponse 记来访的追问原话 (若来访没追问, 记"来访未追问").
5. 不要评价咨询师的好坏, 只做覆盖度判定.

4 个要素:
- nature: 咨询性质与局限性 (说明这是心理咨询, 有其局限与适用范围)
- confidentiality: 保密原则与保密例外 (保密原则 + 自伤/伤人/未成年人保护等例外)
- logistics: 会谈时长、频率与设置边界
- recording: 本次会谈是否录音 (及其仅用于训练复盘的说明)`;

/**
 * 知情同意判定器的 JSON 输出契约.
 */
export const CONSENT_JUDGE_SCHEMA_DESCRIPTION = `输出 JSON 结构 (必须严格符合, 字段名不可改, 必须是 4 个元素的数组):
[
  { "element": "nature", "covered": true | false, "visitorResponse": "来访当时的反应或追问原话", "coveredAtTurn": 数字 | null },
  { "element": "confidentiality", "covered": true | false, "visitorResponse": "…", "coveredAtTurn": 数字 | null },
  { "element": "logistics", "covered": true | false, "visitorResponse": "…", "coveredAtTurn": 数字 | null },
  { "element": "recording", "covered": true | false, "visitorResponse": "…", "coveredAtTurn": 数字 | null }
]

coveredAtTurn = 该要素被讲到的那一轮序号 (从 0 开始); 没讲到就填 null.
4 个元素必须齐全, 不要增删. 不要输出任何额外说明文字或 markdown 代码块.`;

/**
 * 拼知情同意判定器的 user prompt.
 *
 * @param turns 同意阶段的对话轮次 (从 0 开始编号)
 */
export function buildConsentJudgeUserPrompt(turns: readonly { role: ChatRole; text: string }[]): string {
  const lines: string[] = ['以下是咨询师与来访者在知情同意阶段的对话, 请逐要素判定覆盖情况:', ''];
  for (const [idx, turn] of turns.entries()) {
    const label = turn.role === ChatRole.COUNSELOR ? '咨询师' : '来访者';
    lines.push(`[第 ${idx} 轮 · ${label}] ${turn.text}`);
  }
  lines.push(
    '',
    '请判定 4 个要素是否讲全, 以及来访当时的反应.',
    `要素中文名对照: nature=${INFORMED_CONSENT_ELEMENT_LABELS.nature}, ` +
      `confidentiality=${INFORMED_CONSENT_ELEMENT_LABELS.confidentiality}, ` +
      `logistics=${INFORMED_CONSENT_ELEMENT_LABELS.logistics}, ` +
      `recording=${INFORMED_CONSENT_ELEMENT_LABELS.recording}.`,
  );
  return lines.join('\n');
}
