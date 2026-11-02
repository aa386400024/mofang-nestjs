// V2026-10-22 治本 (V1.3 §1.3 / §3.3 / §3.5 — 练习评判 + 自定义场景生成的 prompt 与输出契约):
//   原因: V1.3 有 3 个独立的 LLM 任务, 输入粒度与输出形状完全不同:
//     ① 练习评判 (§3.3)         —— 读 rubric + 用户回应, 产出**零压技术批注**
//     ② 来访者反应 (P2 多轮)   —— 读用户这一轮回应, 产出 AI 来访者的下一句情绪反应
//     ③ 自定义场景生成 (§3.5)   —— 读用户描述的真实情况, 产出一个可练的场景
//     若共用一个 prompt / 一个 JSON 契约, 三个任务的失败语义会互相污染:
//     "模型没读懂" 在①里是"降级到关键词判定", 在③里是"生成不了场景", 绝不能一样.
//   修法: 本文件集中 3 组 system prompt + 3 份 JSON 契约 + 3 个 user prompt 拼装函数.
//   反双胞胎:
//     - 不共用一个 prompt: 3 个任务的输入粒度 (一句话 / 一段转写 / 一段描述) 与
//       输出形状 (批注清单 / 一句话 / 完整场景) 完全不同
//     - 不在 prompt 里写 "temperature=0": M3.1-Flash 官方明确忽略 temperature/top_p
//       (固定 1 / 0.95), 写进 prompt 是误导后来人; 确定性只能靠 prompt 约束 +
//       reasoning_effort 分档
//     - 不把「零压红线」只写在文档里: 必须写进 system prompt, 因为模型是唯一
//       能产出"你这次不太行"这类越界文案的地方; 另外服务端还有一道
//       零压红线守门 (practice-evaluator.service.ts) 做二次拦截
//   验证:
//     1. tsc 0 错
//     2. 大炮跑一次提交 → 批注无分数/无对错/无评价人措辞
//     3. 模型若输出"得分 85"这类越界内容 → 守门层拦下并降级
//   时间戳: 2026-10-22

import type { PracticeRubricDimension } from '../domain/practice/practice.types';
import type { PracticeTurn } from '../domain/practice/practice.types';
import { PracticeEngine } from '../enums/practice-engine.enum';

/**
 * 批注侧重点轮换 (§3.3).
 *
 * spec §3.3 原文: 「同一场景第 N 次答, 批注侧重点轮换: 第1次看动作, 第2次看语气/长度,
 * 第3次给稳定确认」.
 * 这是"练完就没了"的解药 —— 同一场景反复练, 每轮批注看的不是同一个东西.
 */
export type PracticeEvaluationFocus = 'action' | 'tone' | 'stability';

/**
 * 按作答序数取批注侧重点 (3 档循环).
 *
 * @param attemptOrdinal 第几次作答 (1-based)
 * @returns 侧重点
 */
export function evaluationFocusOf(attemptOrdinal: number): PracticeEvaluationFocus {
  const normalized = (((attemptOrdinal - 1) % 3) + 3) % 3;
  if (normalized === 0) return 'action';
  if (normalized === 1) return 'tone';
  return 'stability';
}

/** 侧重点 → 给模型看的说明 (中文, 写进 user prompt). */
const FOCUS_HINTS: Record<PracticeEvaluationFocus, string> = {
  action: '这是第 1 次作答: 请重点看**技术动作**是否出现 (有没有做到这个技能的关键动作), 动作出现了就明确指出。',
  tone: '这是第 2 次作答: 请重点看**语气与长度** (是否像在跟来访者说话, 而不是像在做分析或背话术; 句子是否过长、是否一次塞了太多信息), 动作层面的重复提醒可以省掉。',
  stability:
    '这是第 3 次及以后: 动作层面多半已经做到了, 请给**稳定确认** —— 指出这一轮保持住了什么, 再补一条仍然可以打磨的细节, 不要重复前几轮已经提过的点。',
};

/**
 * 练习评判的 system prompt.
 *
 * 零压红线 (§1.3) 是**硬约束**, 逐条写明:
 *   - 不返回分数 / 不返回对错 / 不返回"你错了"
 *   - 固定三态: ✅ 动作达成 / ⚠️ 可以留意 / ℹ️ 技术提示, 共 3-5 条
 *   - 每条批注锚定一个 rubric 维度
 *   - 只做技术描述, 禁止评价人
 */
export const PRACTICE_EVALUATION_SYSTEM_PROMPT = `你是一位临床督导, 正在陪一名实习咨询师打磨一项微技能. 用户刚提交了一次自由作答, 请给出**技术批注**.

零压红线 (违反其一即视为不合格输出):
1. **绝不**出现分数、等级、评级、通过/不通过、正确/错误.
2. **绝不**评价人 (如"你还不行""水平不够""这次很差""有进步"这类评价人的句子).
3. 只描述**技术动作**: 用户做了什么 / 没做什么 / 换个说法会怎样.
4. 语气中性、专业、具体. 不要安慰, 不要打气, 不要说"加油".

批注格式 (严格三态):
- tone = "positive": 这个技术动作达成了, 明确指出它在哪句话里体现了.
- tone = "warning": 这个技术动作还没到位或越位了, 说明越在哪, 以及可能引发的后果.
- tone = "info": 一条技术提示 (例如某个概念的区别、某个常见误区的提醒).

条数: 3 到 5 条. 不要凑数, 也不要只给 1 条.

每条批注必须锚定一个给定的评判维度 (dimensionKey 用给定值, 不要自造).
文案长度 15 到 40 字, 一句话说完.

参考回应 (referenceResponse): 一段可以直接说出口的示范回应, 30 到 80 字.
常见偏差 (commonPitfalls): 2 到 4 条, 每条 10 到 30 字, 写动作层面的偏差.`;

/**
 * 练习评判的 JSON 输出契约.
 */
export const PRACTICE_EVALUATION_SCHEMA_DESCRIPTION = `输出 JSON 结构 (必须严格符合, 字段名不可改):
{
  "items": [
    { "tone": "positive" | "warning" | "info", "dimensionKey": "给定维度 key 之一", "text": "15-40 字的技术描述" }
  ],
  "referenceResponse": "30-80 字的示范回应",
  "commonPitfalls": ["10-30 字的偏差描述", "..."]
}

items 必须是 3-5 条; dimensionKey 只能从给定的评判维度 key 里选, 不要自造;
不要输出分数 / 等级 / 对错 / 评价人的话. 不要输出任何额外说明文字或 markdown 代码块.`;

/**
 * 练习评判的输入 (拼 user prompt 用).
 */
export interface PracticeEvaluationPromptInput {
  /** 引擎 (决定关注点与提示语) */
  engine: PracticeEngine;
  /** 基本功中文名 */
  modeLabel: string;
  /** 难度档中文名 */
  difficultyLabel: string;
  /** 来访者画像摘要 */
  personaSummary: string;
  /** 来访者开场白 */
  openingLine: string;
  /** 训练任务说明 */
  taskPrompt: string;
  /** 改写工坊专用: 被砸了的原话 */
  botchedUtterance: string | null;
  /** 语音引擎专用: 要求朗读的文本 */
  voiceScript: string | null;
  /** 评判维度 */
  dimensions: PracticeRubricDimension[];
  /** 用户这次提交的文本 (语音引擎为 ASR 转写文本) */
  submittedText: string;
  /** 语音引擎专用: 折算出的语速 (字/分) */
  speechRateWpm: number | null;
  /** 语音引擎专用: 录音时长 (秒) */
  recordSeconds: number | null;
  /** 第几次作答 */
  attemptOrdinal: number;
  /** P2 多轮: 该场景此前的转写 */
  transcript: PracticeTurn[];
}

/**
 * 拼练习评判的 user prompt.
 *
 * @param input 评判输入
 * @returns user prompt 文本
 */
export function buildPracticeEvaluationUserPrompt(input: PracticeEvaluationPromptInput): string {
  const lines: string[] = [];

  lines.push(
    `【训练项】${input.modeLabel}（${input.difficultyLabel}）`,
    `【来访者】${input.personaSummary}`,
    `【来访者开场白】${input.openingLine}`,
    `【本次任务】${input.taskPrompt}`,
  );

  if (input.botchedUtterance) {
    lines.push(`【被改写的原话】${input.botchedUtterance}`);
  }
  if (input.voiceScript) {
    lines.push(`【要求朗读的文本】${input.voiceScript}`);
  }

  if (input.transcript.length > 0) {
    lines.push('', '【此前对话】');
    for (const turn of input.transcript) {
      lines.push(`[第${turn.turn}轮 咨询师] ${turn.counselorText}`);
      if (turn.visitorReaction) {
        lines.push(`[第${turn.turn}轮 来访者] ${turn.visitorReaction}`);
      }
    }
  }

  lines.push('', `【本次提交】${input.submittedText.length > 0 ? input.submittedText : '（本次没有提交文本）'}`);
  if (input.speechRateWpm !== null && input.recordSeconds !== null) {
    lines.push(`【语音指标】本次录音 ${input.recordSeconds} 秒, 语速约 ${Math.round(input.speechRateWpm)} 字/分（专业区间 120-140 字/分）`);
  }

  lines.push('', '【评判维度（dimensionKey 只能用下列 key）】');
  for (const dimension of input.dimensions) {
    const positive = dimension.positiveKeywords.length > 0 ? dimension.positiveKeywords.join('、') : '（无）';
    const anti = dimension.antiKeywords.length > 0 ? dimension.antiKeywords.join('、') : '（无）';
    lines.push(`- ${dimension.key}: ${dimension.label}｜命中即达成的措辞: ${positive}｜代表越位的措辞: ${anti}`);
  }

  lines.push('', FOCUS_HINTS[evaluationFocusOf(input.attemptOrdinal)]);

  if (input.engine === PracticeEngine.VOICE_METRIC) {
    lines.push(
      '注意: 这是语音微训练, 请基于转写文本与语音指标给出**技术**批注 (语速是否在区间、语调是否平稳、是否说完了整句), 不要评价来访者。',
    );
  }

  return lines.join('\n');
}

/**
 * 来访者反应 (P2 多轮) 的 system prompt.
 */
export const PRACTICE_VISITOR_REACTION_SYSTEM_PROMPT = `你正在扮演一位来访者, 正在接受一次心理咨询.

你的任务: 针对咨询师刚刚说出的一句话, 给出你**此刻的反应** —— 1 到 2 句, 口语化, 符合你这个人设 (防御风格 / 情绪负荷).

硬性规则:
1. 只输出来访者会说的话, 不要写旁白、不要写"来访者沉默了一会儿"这种舞台指示以外的说明.
2. 不要评价咨询师的技术水平, 不要配合咨询师的引导 (哪怕对方说错了, 你也只是按自己的防御方式反应).
3. 不要提建议, 不要总结会谈.
4. 保持人设一致: 沉默型来访者就是话少; 愤怒型来访者会带情绪; 理智化者会用分析性的话回避情绪.`;

/**
 * 来访者反应的 JSON 输出契约.
 */
export const PRACTICE_VISITOR_REACTION_SCHEMA_DESCRIPTION = `输出 JSON 结构 (必须严格符合, 字段名不可改):
{ "reaction": "1-2 句来访者会说的话" }

不要输出任何额外说明文字或 markdown 代码块.`;

/**
 * 拼来访者反应的 user prompt.
 *
 * @param input 输入
 * @returns user prompt 文本
 */
export function buildPracticeVisitorReactionPrompt(input: {
  personaSummary: string;
  openingLine: string;
  taskPrompt: string;
  counselorText: string;
  transcript: PracticeTurn[];
}): string {
  const lines: string[] = [];
  lines.push(
    `【你扮演的来访者】${input.personaSummary}`,
    `【你一开始说的话】${input.openingLine}`,
    `【咨询师此刻的目标】${input.taskPrompt}`,
  );

  if (input.transcript.length > 0) {
    lines.push('', '【此前对话】');
    for (const turn of input.transcript) {
      lines.push(`[第${turn.turn}轮 咨询师] ${turn.counselorText}`);
      if (turn.visitorReaction) {
        lines.push(`[第${turn.turn}轮 来访者] ${turn.visitorReaction}`);
      }
    }
  }

  lines.push('', `【咨询师刚刚说的话】${input.counselorText}`, '', '给出你此刻的反应 (1-2 句).');
  return lines.join('\n');
}

/**
 * 自定义场景生成 (§3.5) 的 system prompt.
 */
export const PRACTICE_SCENARIO_GENERATION_SYSTEM_PROMPT = `你是一位临床教学设计师, 正在把用户描述的一个真实工作困境, 改写成一条可练习的咨询场景.

硬性规则:
1. 生成的内容必须是**虚构的教学场景**, 不要复述用户真实个案里的可识别信息 (具体姓名 / 单位 / 地点一律用泛化称呼).
2. 来访者人设要具体 (姓名 / 年龄 / 性别 / 职业 / 背景), 不能是"一个焦虑的来访者"这种空壳.
3. 开场白要像真实来访者说出口的话, 不是教科书陈述.
4. 参考回应要示范这个技能的技术动作, 不是泛泛的"共情 + 建议".
5. 常见偏差写动作层面的偏差, 不要评价人.
6. 评判维度 (rubric) 的 key 用英文 camelCase, label 用中文; 每个维度都要能被"用户回应的措辞"判定.
7. **绝对不要**出现分数 / 等级 / 对错 / 评价人的措辞.

按给定的 JSON 结构输出, 不要输出额外说明文字或 markdown 代码块.`;

/**
 * 自定义场景生成的 JSON 输出契约.
 */
export const PRACTICE_SCENARIO_GENERATION_SCHEMA_DESCRIPTION = `输出 JSON 结构 (必须严格符合, 字段名不可改):
{
  "persona": { "name": "称呼", "age": 25, "gender": "男", "occupation": "职业", "defenseStyle": "cooperative|intellectualizing|stoic|silent|angry|crying", "emotionIntensity": "calm|elevated|acute", "background": "一两句背景" },
  "openingLine": "来访者第一句话",
  "taskPrompt": "给练习者的一句话任务说明",
  "botchedUtterance": "改写工坊专用: 被砸了的原话; 非改写场景填空字符串",
  "voiceScript": "语音微训练专用: 要求朗读的文本; 非语音场景填空字符串",
  "referenceResponse": "参考回应 (30-80 字)",
  "commonPitfalls": ["2-4 条偏差"],
  "rubric": { "dimensions": [ { "key": "camelCaseKey", "label": "中文维度名", "positiveKeywords": ["措辞"], "antiKeywords": [], "check": "contains_any|contains_none|custom_llm" } ] }
}

rubric.dimensions 至少 3 条, 至少 1 条 positiveKeywords 非空, 至少 1 条 antiKeywords 非空.`;

/**
 * 拼自定义场景生成的 user prompt.
 *
 * @param input 输入
 * @returns user prompt 文本
 */
export function buildPracticeScenarioGenerationPrompt(input: { modeLabel: string; engine: PracticeEngine; situation: string }): string {
  const lines: string[] = [];
  lines.push(`【要练的基本功】${input.modeLabel}`, `【引擎】${input.engine}`, `【用户描述的真实情况】${input.situation}`, '');
  if (input.engine === PracticeEngine.REWRITE) {
    lines.push('注意: 这是改写工坊场景, botchedUtterance 必须给出一句真实的糟糕回应 (咨询师砸了的话).');
  }
  if (input.engine === PracticeEngine.VOICE_METRIC) {
    lines.push('注意: 这是语音微训练场景, voiceScript 必须给出要求朗读的文本 (语速场景给长段, 语调场景给短句, 破冰场景给开场白).');
  }
  lines.push('', '请生成一条可练习的场景.');
  return lines.join('\n');
}
