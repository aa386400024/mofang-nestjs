// V2026-10-22 治本 (V1.3 §7.3 — 「我遇到了真实情况」场景生成的 prompt 与输出契约):
//   原因: §7 是本引擎区别于所有题库类竞品的护城河功能 (新手咨询师今天现场卡住,
//     当晚 1:1 还原重练). 它跟 §3.5 的"一句话描述 → 场景"相比, 输入更结构化
//     (三问: 来访者说了什么 / 咨询师怎么回的 / 卡在哪), 因此 prompt 也要更精细:
//       - §7.3.1 脱敏: 输入里出现人名/地名/单位名时, 输出 personaName 一律用代称
//       - §7.3.2 零压: commonErrors 只描述技术动作, 不评价用户当时的回应
//       - §7.3.3 贴近真实: visitorLine 忠实于 visitorQuote 原意, 不得美化成教科书
//       - §7.3.4 stuckPoint 对齐 rubric: 用户说"冷场"→ dimensions 必须有一条
//         "是否给出了继续展开的邀请"; 说"说教"→ 必须有一条 "是否在给建议"
//       - §7.3.5 重试: 无状态生成, 同输入两次结果允许不同 (所以**不能**要求
//         模型输出确定性内容, 也不该把结果缓存成"同输入同输出")
//     这些约束**必须写进 prompt**: 模型是唯一能产出"你当时说得不对"这类越界文案的地方;
//     服务端另有零压红线守门 (practice-evaluator.service.ts) 做二次拦截, 但那层
//     只能拦"评级/评价人"这类硬伤, 拦不住"把用户描述美化成了教科书"这种软伤.
//
//   修法: 本文件集中 1 组 system prompt + 1 份 JSON 契约 + 1 个 user prompt 拼装函数.
//     与 §3.5 的生成 prompt (practice-evaluation-prompts.ts) 分文件放:
//       - 输入粒度不同 (三问结构化 vs 一段自由描述)
//       - 输出契约不同 (多了 exerciseMode / difficulty 两个路由元信息)
//       - §7.3.4 的 stuckPoint→rubric 对齐规则只对 §7 成立
//     混在一个文件里会让两份 prompt 的规则互相污染.
//
//   反双胞胎:
//     - 不共用一个 prompt: 见上
//     - 不在 prompt 里写 "temperature=0": M3.1-Flash 官方明确忽略 temperature/top_p,
//       写进 prompt 是误导后来人; §7.3.5 要求的"同输入可出不同结果"恰恰是**要**多样性
//     - 不用 i18n key: V0.x 阶段中文, V1.x 多语言时再加 i18n layer
//
//   验证:
//     1. tsc 0 错
//     2. 输入含真实人名 → 输出 personaName 是代称 (他/她/TA)
//     3. stuckPoint 写"冷场" → dimensions 里出现"继续展开的邀请"维度
//     4. 输出 commonErrors 里没有"你当时说得不对"这类评价用户的句子
//
//   时间戳: 2026-10-22

import { TRAINING_EXERCISE_MODE_META } from './training-exercise-display-meta';
import { PracticeEngine } from '../enums/practice-engine.enum';
import { TrainingExerciseMode } from '../enums/training-exercise-mode.enum';

/**
 * 10 档基本功的中文名清单 (给 LLM 挑 exerciseMode 用).
 *
 * 顺序跟 `TRAINING_EXERCISE_MODE_META` 的声明顺序一致 (= 客户端列表页顺序),
 * 让模型的选择倾向跟用户看到的列表顺序一致.
 */
const MODE_LINES: readonly string[] = Object.values(TrainingExerciseMode).map((mode) => {
  const meta = TRAINING_EXERCISE_MODE_META[mode];
  return `- ${mode} (${meta.label}): ${meta.summary}`;
});

/**
 * 场景生成的 system prompt (§7.3 的 5 条约束逐条写死).
 */
export const PRACTICE_CUSTOM_SCENARIO_SYSTEM_PROMPT = `你是一位临床教学设计师. 用户刚刚描述了一个**真实工作困境**, 想在今晚把它还原成一条可以反复重练的咨询场景.

你必须同时满足以下 5 条硬约束, 违反任何一条都算不合格输出:

1. **脱敏**:
   - 用户原文里出现的真实人名 / 地名 / 单位名 / 机构名, 一律**不要**出现在输出里.
   - personaName 用代称 (他 / 她 / TA), 绝不写真名.
   - personaNote 只保留年龄 / 性别 / 议题这类**不可识别**信息, 不写"XX 公司的 X 经理"这种可定位的描述.
   - openingLine (来访者第一句话) 允许保留用户原文的**议题内容** (那是练习必需的), 但要抹掉其中的专有名词.

2. **零压**:
   - commonErrors (常见偏差) 只描述**技术动作层面**的偏差 (例如"直接给建议了""连续问了三个问题").
   - 绝不评价用户本人 (不写"你当时处理得很差""你的回应不合适"这类句子).
   - 用户说他"卡住了""说错了", 你要做的是**把那个卡点变成一条可练的动作**, 而不是点评他.

3. **贴近真实**:
   - openingLine 必须尽量忠实于用户描述的来访者原话原意, 允许口语化润色.
   - 禁止美化成教科书式来访者 (不要写成"我最近感到非常焦虑和无助"这种书面语).
   - 来访者要像**一个具体的人**: 有自己的说话节奏, 有防御方式, 不是一个"焦虑的来访者"标签.

4. **stuckPoint 对齐 rubric**:
   - 用户说卡在"冷场 / 接不住 / 对方不说话了" → dimensions 里**必须**有一条"是否给出了让对方可以继续展开的邀请".
   - 用户说卡在"说教 / 给建议 / 讲道理" → dimensions 里**必须**有一条"是否在给建议".
   - 用户说卡在"没接住情绪 / 太机械" → dimensions 里**必须**有一条"是否先命名了对方此刻的情绪".
   - 其余情况按该基本功的标准技术动作给维度.
   - 每条维度都要能被"用户回应的措辞"判定 (给出 positiveKeywords / antiKeywords).

5. **可练习性**:
   - taskPrompt 是给练习者看的一句话任务说明, 要具体 (例如"重新接一次这句话, 这次先别急着评价").
   - referenceResponse 是一段可以直接说出口的示范回应, 要示范**这个基本功的技术动作**, 不是泛泛的"共情 + 建议".
   - 评判维度 3 到 5 条, key 用英文 camelCase, label 用中文.

硬性禁令: 绝不出现分数 / 等级 / 对错 / 评价人的话.

按给定的 JSON 结构输出, 不要输出任何额外说明文字或 markdown 代码块.`;

/**
 * 场景生成的 JSON 输出契约 (§7.2 的 `content` + 两个路由元信息).
 */
export const PRACTICE_CUSTOM_SCENARIO_SCHEMA_DESCRIPTION = `输出 JSON 结构 (必须严格符合, 字段名不可改):
{
  "exerciseMode": "10 档基本功之一 (从给定清单里选)",
  "difficulty": 1,
  "persona": { "name": "他", "age": 28, "gender": "男", "occupation": "职业", "defenseStyle": "cooperative|intellectualizing|stoic|silent|angry|crying", "emotionIntensity": "calm|elevated|acute", "background": "一两句背景 (不可识别)" },
  "openingLine": "来访者第一句话",
  "taskPrompt": "给练习者的一句话任务说明",
  "botchedUtterance": "改写工坊专用: 被砸了的原话; 非改写场景填空字符串",
  "voiceScript": "语音微训练专用: 要求朗读的文本; 非语音场景填空字符串",
  "referenceResponse": "参考回应 (30-80 字)",
  "commonPitfalls": ["2-4 条动作层面的偏差"],
  "rubric": { "dimensions": [ { "key": "camelCaseKey", "label": "中文维度名", "positiveKeywords": ["措辞"], "antiKeywords": ["措辞"], "check": "contains_any|contains_none|custom_llm" } ] }
}

exerciseMode 只能从给定的 10 档清单里选; difficulty 只能是 1 / 2 / 3;
rubric.dimensions 必须是 3 到 5 条, 且至少 1 条 positiveKeywords 非空、至少 1 条 antiKeywords 非空;
不要输出分数 / 等级 / 对错 / 评价人的话. 不要输出任何额外说明文字或 markdown 代码块.`;

/**
 * 场景生成的 user prompt 输入.
 */
export interface PracticeCustomScenarioPromptInput {
  /** 来访者当时说了什么 (必填) */
  visitorQuote: string;
  /** 咨询师当时怎么回应的 (可空) */
  counselorReply: string;
  /** 用户觉得卡在哪 (可空) */
  stuckPoint: string;
  /** 用户指定的基本功线索 (mode; 可空 = 由模型自行判断) */
  hintMode: TrainingExerciseMode | null;
  /** 用户指定的基本功线索对应的中文名 (可空) */
  hintModeLabel: string | null;
  /** 该基本功对应的三引擎 (可空 = 未指定) */
  engine: PracticeEngine | null;
}

/**
 * 拼场景生成的 user prompt.
 *
 * @param input 生成输入
 * @returns user prompt 文本
 */
export function buildPracticeCustomScenarioUserPrompt(input: PracticeCustomScenarioPromptInput): string {
  const lines: string[] = [];

  lines.push('【可用基本功清单 (exerciseMode 只能从里面选)】', ...MODE_LINES);

  if (input.hintMode) {
    lines.push(
      '',
      `【用户指定的练习方向】${input.hintMode} (${input.hintModeLabel ?? ''}) —— 优先选这一项, 只有明显不匹配才改选别的并在心里记下理由.`,
    );
  } else {
    lines.push('', '【用户没有指定练习方向】请根据用户描述的卡点, 自行判断最匹配的一项基本功.');
  }

  lines.push(
    '',
    '【来访者当时说的话】',
    input.visitorQuote,
    '',
    '【咨询师当时的回应】',
    input.counselorReply.trim().length > 0 ? input.counselorReply : '（用户没有记录自己当时说了什么）',
    '',
    '【用户觉得卡在哪】',
    input.stuckPoint.trim().length > 0 ? input.stuckPoint : '（用户没有说明卡点, 请按最可能的技术动作给维度）',
  );

  if (input.engine) {
    lines.push('', '【本次生成的引擎】', input.engine);
    if (input.engine === PracticeEngine.REWRITE) {
      lines.push('注意: 改写工坊场景, botchedUtterance 必须给出一句真实的糟糕回应 (咨询师当时砸了的话), 脱敏后复述即可.');
    }
    if (input.engine === PracticeEngine.VOICE_METRIC) {
      lines.push('注意: 语音微训练场景, voiceScript 必须给出要求朗读的文本 (语速场景给长段, 语调场景给短句, 破冰场景给开场白).');
    }
  }

  lines.push('', '请生成一条可练习的场景.');
  return lines.join('\n');
}
