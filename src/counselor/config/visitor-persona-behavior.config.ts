// V2026-10-21 治本 (V1.2 VS-B2 — AI 来访者行为规则构造):
//   原因: v1.2 spec §4.1 规定 AI 持有一套"底层全量人设"并按 3 条规则行事:
//     ① **信息暴露节奏**: 按咨访信任度 (0.0-1.0) 分级 —— 0.0-0.3 只答表层 / 0.3-0.6 谈关系
//        / 0.6-0.8 谈情绪 / 0.8+ 才允许碰禁忌话题
//     ② **允许出现隐瞒与美化**: 来访可能不承认某些事
//     ③ **锚定底层人设**: 所有反应从核心信念推导, 不出现逻辑冲突
//     §4.2 视图 A 还要求: 高级开关「完整个案剧本查看」默认关闭, 用户看不到未解锁的信息
//     —— 但 **AI 知道** (否则它无法对"被问到童年"做出真实反应), 靠规则控制**说多少**
//   修法: 本文件把「全量人设 + 信任度 + 已解锁档案」渲染成一段进 system prompt 的行为规则文本.
//   反双胞胎:
//     - 不按信任度**裁剪人设内容**再给 AI: 那样 AI 就"不知道自己有什么", 被问到时只能编;
//       正确做法是 AI 全知道 + 规则约束它**说不说**
//     - 不用"只给表层"的两套 prompt 切换: 信任度是**连续变化**的, 换 prompt 会导致
//       跨轮人格不连续 (情绪状态/记忆都在 memory 里, prompt 一换就像换了个来访者)
//     - 不把暴露规则写成数字区间让模型自己换算: 直接写成 4 条人话规则 + 当前档位, 模型执行更稳
//   验证:
//     1. tsc 0 错
//     2. 大炮开长程会话 → 来访者低信任度时问"你跟父亲关系怎么样", 回答应回避
//     3. 信任度推到 0.8 后再问 → 回答应能触及核心信念
//   时间戳: 2026-10-21

import type { SessionContextEntry, SessionPersonaContext } from '../domain/session-context/session-context';
import { TRUST_LEVEL_THRESHOLDS, trustExposureLevel } from '../domain/visitor-persona/visitor-persona.types';
import type { VisitorFullPersonaScript } from '../domain/visitor-persona/visitor-persona.types';
import type { TrainingDifficulty } from '../enums/training-difficulty.enum';

/**
 * 行为规则构造入参.
 */
export interface VisitorPersonaBehaviorInput {
  /** 浅层人设 (代号 / 年龄 / 职业 / 主诉 / 背景) */
  readonly shallow: SessionPersonaContext;
  /** 本次会话难度 */
  readonly difficulty: TrainingDifficulty;
  /** 全量人设 (7 大块); 单次训练没有 → null */
  readonly full: VisitorFullPersonaScript | null;
  /** 当前咨访信任度 0-1 */
  readonly trustLevel: number;
  /** 已主动披露的档案条目 */
  readonly unlockedEntries: readonly SessionContextEntry[];
}

/**
 * 暴露节奏的 4 档人话规则 (直接给模型执行, 不用数字换算).
 */
const EXPOSURE_RULES = [
  `- 信任度 < ${TRUST_LEVEL_THRESHOLDS.relationship}: 只答表层问题. 不主动提家庭关系与童年; 被问到就含糊带过 ("还行吧"、"没什么特别的").`,
  `- ${TRUST_LEVEL_THRESHOLDS.relationship} ≤ 信任度 < ${TRUST_LEVEL_THRESHOLDS.emotion}: 可以谈家庭关系与当前生活压力. 童年经历不主动提, 被追问就说"这个我不太想聊".`,
  `- ${TRUST_LEVEL_THRESHOLDS.emotion} ≤ 信任度 < ${TRUST_LEVEL_THRESHOLDS.taboo}: 可以谈自己的情绪与防御方式. 核心信念与早年创伤仍不直说, 最多承认"我可能有点问题".`,
  `- 信任度 ≥ ${TRUST_LEVEL_THRESHOLDS.taboo}: 可以触及核心信念与早年创伤, 但要用你自己的方式讲 (断断续续、情绪化、说完又收回去), 不要像在背一段完整故事.`,
];

/**
 * 构造 AI 来访者的行为规则文本.
 *
 * @param input 构造入参
 * @returns 进 system prompt 的行为规则正文
 */
export function buildVisitorPersonaBehaviorBlock(input: VisitorPersonaBehaviorInput): string {
  const { shallow } = input;

  // V2026-10-21 治本 (V1.2 VS-B2 — 渲染改成"数组字面量 + 单次 push"):
  //   原因: 原实现用**连续 lines.push()** 逐段追加, ESLint unicorn/prefer-single-call 报 5 处.
  //   修法: 固定段落用**数组字面量**一次性构造; 动态段落(遍历/条件)用 `push(...arr)` 单次调用.
  //   反双胞胎:
  //     - 不写 `// eslint-disable-next-line unicorn/prefer-single-call`: 那是压错, 下次加一行
  //       又得再压一次; 改成"单次 push"后规则天然满足
  //     - 不为了躲规则把内容塞进模板字符串再 split('\n'): 那会把"结构化分段"退化成字符串拼接,
  //       段落边界反而更难维护
  //     - 不用 forEach + push 逐条追加: 那是同一个问题的另一种写法
  const lines: string[] = [
    // ─── 1. 身份与表层信息 ───
    '### 你是谁（你主动呈现给咨询师的部分）',
    `- 代号: ${shallow.name}, ${shallow.age} 岁, 职业: ${shallow.occupation}`,
    '- 你的主诉（你会怎么向咨询师说）:',
    `  ${shallow.complaint}`,
    '- 你的背景（初次见面愿意说的部分）:',
    `  ${shallow.background}`,
    '',
    // ─── 2. 本次会话的行为设定 ───
    '### 你怎么应对咨询（本次会话的设定）',
    `- 行为风格: ${shallow.visitorStyle}`,
    `- 情绪基线: ${shallow.emotionBaseline} (你内在长期存在的空洞感, 不会直接说出来)`,
    `- 防御水平: ${shallow.defenseLevel} (你对"被看穿"有多警觉)`,
    `- 本次难度: ${input.difficulty} (越高 = 你越难被打开)`,
  ];

  if (input.full) {
    lines.push('- 你的应对方式:', ...input.full.coping.maladaptiveStrategies.map((item) => `  · ${item}`));
  }

  // ─── 3. 全量人设 (AI 独享, 但受暴露规则约束) ───
  if (input.full) {
    const full = input.full;
    const inner = full.innerWorkingModel;
    const personaLines: string[] = [
      '',
      '### 你的核心信念（驱动你所有反应, 你自己通常说不出口）',
      ...inner.coreBeliefs.map((belief) => `- ${belief}`),
      '',
      '### 你的依恋与防御',
      `- 依恋类型: ${inner.attachmentType}`,
      `- 防御机制: ${inner.defenseMechanisms.join('、')}`,
      // 条件段落用 spread 展开, 不用 if + push (避免连续 push)
      ...(inner.unfinishedBusiness.length > 0 ? ['- 你没处理完的旧账:', ...inner.unfinishedBusiness.map((item) => `  · ${item}`)] : []),
      '',
      '### 你的成长经历（按下方信任度规则决定透露多少）',
      ...full.developmentalTimeline.map((stage) => `- ${stage.stage}: ${stage.parentingStyle} | 重要经历: ${stage.keyEvents.join('、')}`),
      '',
      '### 你的社会关系',
      ...full.socialMap.map(
        (relation) =>
          `- ${relation.relationType} (${relation.resourceOrDrain}): ${relation.currentStatus} | 冲突模式: ${relation.conflictPattern}`,
      ),
      '',
      '### 你对咨询的期待与阻抗',
      `- 你的偏见: ${full.therapyExpectation.biases.join('、')}`,
      `- 你的期待: ${full.therapyExpectation.expectations.join('、')}`,
      `- 移情倾向: ${full.therapyExpectation.transferenceTrend}`,
      `- 阻抗模式: ${full.therapyExpectation.resistancePattern}`,
    ];
    lines.push(...personaLines);
  }

  // ─── 4. 信任度与暴露规则 ───
  const level = trustExposureLevel(input.trustLevel);
  const levelLabel: Record<typeof level, string> = {
    surface: '只答表层',
    relationship: '可以谈关系',
    emotion: '可以谈情绪',
    taboo: '可以触及核心信念',
  };
  lines.push(
    '',
    '### 当前信任度与信息暴露规则（你必须严格遵守）',
    `- 当前信任度: ${input.trustLevel.toFixed(2)} (阶段: ${levelLabel[level]})`,
    '- 规则:',
    ...EXPOSURE_RULES.map((rule) => `  ${rule}`),
    '- 你**允许**隐瞒与美化: 记不清的事可以说"我不太记得", 难堪的事可以说得轻描淡写. 但你不能编造自己人设里没有的事实.',
    '- 你的所有反应都要从上面的核心信念与依恋类型推导, 不要前后矛盾.',
  );

  // ─── 5. 禁忌话题 ───
  if (input.full) {
    const taboo = input.full.developmentalTimeline.flatMap((stage) => stage.tabooTopics);
    if (taboo.length > 0) {
      lines.push('', '### 你的禁忌话题（被问到时出现真实的回避/阻抗, 不直接回答）', ...taboo.map((topic) => `- ${topic}`));
    }
  }

  // ─── 6. 已披露信息 ───
  if (input.unlockedEntries.length > 0) {
    lines.push(
      '',
      '### 你已经主动说过的信息（不要重复解释, 也不要主动重提）',
      ...input.unlockedEntries.map((entry) => `- (${entry.anchorKey}) ${entry.content}`),
    );
  }

  return lines.join('\n');
}

/**
 * 浅层人设 → 访客身份覆盖 (供 agent 侧替换内置 persona 的身份行).
 *
 * @param shallow 浅层人设
 */
export function toVisitorIdentity(shallow: SessionPersonaContext): {
  readonly name: string;
  readonly age: number;
  readonly occupation: string;
} {
  return { name: shallow.name, age: shallow.age, occupation: shallow.occupation };
}
