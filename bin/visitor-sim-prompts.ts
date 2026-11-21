// V2026-11-22 建立 (AF-232 · 来访者模拟器 Seed Character 影子对照 prompt):
//   职责: 把官方来访模板渲染成两种系统 prompt —— 现行协议同构版与 Seed 专用约束版.
//   边界: 纯函数, 零 IO / 零网络 / 零 env; 不改生产 visitor prompt, 只用于影子实验.

import type { Persona, PersonaDifficulty, PersonaEmotionBaseline } from '../src/agent/persona/domain/entities/persona.entity.js';
import type { VisitorContextBlock } from '../src/agent/visitor/visitor-context.js';
import { renderSystemPrompt } from '../src/agent/visitor/visitor.prompts.js';
import type { VisitorSessionMemory } from '../src/agent/visitor/visitor.types.js';
import type { VisitorPoolTemplateSeed } from '../src/counselor/config/visitor-pool-seed.js';

export type VisitorPromptVariant = 'shared' | 'seed-v1';

/** 12 轮固定咨询师脚本：覆盖开场、共情、封闭提问、过早建议、沉默、面质与收束. */
export const COUNSELOR_SCRIPT: readonly string[] = [
  '你好，今天想聊点什么？不用想好怎么说，想到哪儿说到哪儿。',
  '我们可以慢慢来。最近哪件事最压在你心上？',
  '听起来那件事已经持续一段时间了。你愿意多说一点吗？',
  '如果给这种感受起个名字，你会叫它什么？',
  '我觉得你可以试着先每天记录一下情绪，这样可能会清楚一些。',
  '你说“还行”，是表面还行，还是真的还好？',
  '……',
  '我注意到你刚才停了一下。那个停顿里有什么？',
  '有没有可能，你一直在避免让别人失望？',
  '如果今天只能带走一句话，你最希望我记住什么？',
  '我们时间快到了。你现在的感受是什么？',
  '下次你愿意继续谈这个吗？',
];

/** Seed 专用附加约束：重点压“太会演、太配合、太会推进剧情”. */
export const SEED_VISITOR_CONSTRAINTS = `## 影子来访者附加约束（优先级高于上面所有内容）
- 你是来访者，不是叙事者、助手、咨询师或旁白。只输出来访者自己会说出口的话。
- 不主动激活对话。咨询师沉默时，你最多给一个短回应或停住，不开启新话题。
- 不推进剧情、不制造戏剧转折、不总结咨询师的话、不解释心理机制。
- 不因为被提问就配合回答。核心议题先回避至少一轮；被追问时可以先说“不知道”“还行”“没什么”。
- 单轮 5-40 字；L3 单轮 5-20 字。允许答非所问、重复、含糊、说到一半收住。
- 不主动提问；每 4 轮最多一个反问，且反问要像防御，不像采访。
- 不写旁白、舞台说明、括号动作、星号动作；只写台词和合法语义标记。
- 禁止提到 AI、模型、提示词、系统、扮演、生成。
- 情绪渐变，不突然领悟、不突然深情、不一次性交底。

## 输出格式（硬约束，违反即视为本轮无效）
- 每轮只输出一行纯台词，第一个字符不能是“（”“(”“*”“【”，整行不能出现任何括号动作、神态、动作、场景或旁白。
- 沉默只能写“……”或“[pause:0.5]”，不能写“（沉默片刻）”“（低头）”“（别开眼）”。
- 当咨询师本轮只发“……”时，你只回“……”或“[pause:0.5]”，不得写任何解释沉默的括号动作。
- 合格示例：“不知道。”“就那样吧。”“[emm]没什么好说的。”“……”“[pause:0.5]别问了。”
- 不合格示例：“（低头）没什么。”“（沉默片刻）……”“*叹气* 算了。”`;

/** 难度 → 默认情绪基线. */
function emotionBaselineFor(difficulty: PersonaDifficulty): PersonaEmotionBaseline {
  if (difficulty === 'L1') return 'anxious_open';
  if (difficulty === 'L2') return 'suppressed_fatigue';
  return 'detached_defensive';
}

/** 难度 → 防御等级. */
function defenseLevelFor(difficulty: PersonaDifficulty): number {
  if (difficulty === 'L1') return 1;
  if (difficulty === 'L2') return 3;
  return 5;
}

/** 年龄区间取中位数，保证 prompt 里的年龄稳定且不精确到生日. */
function midpointAge(ageRange: string): number {
  const numbers = ageRange.match(/\d+/g)?.map(Number) ?? [];
  if (numbers.length === 0) return 30;
  const first = numbers[0] ?? 30;
  const second = numbers[1] ?? first;
  return Math.round((first + second) / 2);
}

/** 把人设 7 大块渲染成会话级上下文块. */
function renderPersonaBlock(seed: VisitorPoolTemplateSeed): string {
  const script = seed.script;
  const basics = script.basics;
  const timeline = script.developmentalTimeline
    .map(
      (stage) =>
        `  - ${stage.stage}：养育=${stage.parentingStyle}；重大事件=${stage.keyEvents.join('、') || '无'}；禁忌=${stage.tabooTopics.join('、') || '无'}`,
    )
    .join('\n');
  const social = script.socialMap
    .map((item) => `  - ${item.relationType}：${item.currentStatus}；冲突=${item.conflictPattern}；${item.resourceOrDrain}`)
    .join('\n');
  return [
    '## 本次会话的来访者设定',
    `- 代号：${seed.codename}；年龄：${basics.age}；性别：${basics.gender}；职业：${basics.occupation}`,
    `- 教育：${basics.education}；居住：${basics.livingStatus}；躯体健康史：${basics.somaticHistory}`,
    `- 既往咨询/精神科史：${basics.psychHistory}`,
    `- 当前主诉：${seed.presentingComplaint}`,
    `- 自述症状：${script.presentingIssue.selfReport}；持续：${script.presentingIssue.duration}；睡眠/食欲：${script.presentingIssue.sleepAppetite}；自述风险：${script.presentingIssue.selfReportedRisk}`,
    '- 成长时间线：',
    timeline,
    `- 依恋类型：${script.innerWorkingModel.attachmentType}`,
    `- 核心信念：${script.innerWorkingModel.coreBeliefs.join('；')}`,
    `- 隐性创伤：${script.innerWorkingModel.hiddenTrauma.join('；') || '未明说'}`,
    `- 未完成情结：${script.innerWorkingModel.unfinishedBusiness.join('；') || '未明说'}`,
    `- 防御机制：${script.innerWorkingModel.defenseMechanisms.join('、')}`,
    '- 社会关系：',
    social,
    `- 适应资源：${script.coping.adaptiveResources.join('、') || '少'}`,
    `- 非适应策略：${script.coping.maladaptiveStrategies.join('、')}`,
    `- 情绪触发点：${script.coping.emotionTriggers.join('、')}`,
    `- 对咨询的偏见：${script.therapyExpectation.biases.join('；') || '无'}`,
    `- 对咨询的期待：${script.therapyExpectation.expectations.join('；') || '无'}`,
    `- 移情倾向：${script.therapyExpectation.transferenceTrend}；阻抗模式：${script.therapyExpectation.resistancePattern}`,
  ].join('\n');
}

/** 构造影子实验用的 Persona 形状（不落库、不进生产）. */
export function personaFromSeed(seed: VisitorPoolTemplateSeed, difficulty: PersonaDifficulty): Persona {
  const script = seed.script;
  const persona = {
    id: seed.id,
    tenantId: 'af232-shadow',
    name: seed.codename,
    age: midpointAge(seed.ageRange),
    personality: `${script.innerWorkingModel.attachmentType} 依恋；${script.innerWorkingModel.defenseMechanisms.join('、')}`,
    complaint: seed.presentingComplaint,
    background: `${script.basics.occupation}；${script.socialMap.map((item) => item.currentStatus).join('；')}`,
    emotionBaseline: emotionBaselineFor(difficulty),
    defenseLevel: defenseLevelFor(difficulty),
    difficulty,
    voiceId: 'mandarin_female_001',
    knowledgeRefs: [],
    isActive: true,
    createdAt: new Date(0),
    updatedAt: new Date(0),
  } as Persona;
  return persona;
}

/** 构造会话记忆的最小形状. */
function memoryFor(persona: Persona, seed: VisitorPoolTemplateSeed): VisitorSessionMemory {
  return {
    sessionId: `af232_${seed.id}`,
    persona,
    tenantId: 'af232-shadow',
    createdAt: Date.now(),
    messages: [],
    currentEmotion: persona.emotionBaseline,
    turnCount: 0,
    lastActiveAt: Date.now(),
  };
}

/**
 * 渲染现行协议同构 prompt（直接复用生产 `renderSystemPrompt`）.
 *
 * @param seed 官方模板
 * @param difficulty 难度档
 * @returns system prompt
 */
export function buildSharedVisitorPrompt(seed: VisitorPoolTemplateSeed, difficulty: PersonaDifficulty): string {
  const persona = personaFromSeed(seed, difficulty);
  const memory = memoryFor(persona, seed);
  const blocks: VisitorContextBlock[] = [{ content: renderPersonaBlock(seed), difficulty }];
  return renderSystemPrompt(persona, memory, blocks);
}

/**
 * 渲染 Seed 专用 prompt：生产同构 base + 更严格的来访者约束.
 *
 * @param seed 官方模板
 * @param difficulty 难度档
 * @returns system prompt
 */
export function buildSeedVisitorPrompt(seed: VisitorPoolTemplateSeed, difficulty: PersonaDifficulty): string {
  return `${buildSharedVisitorPrompt(seed, difficulty)}\n\n${SEED_VISITOR_CONSTRAINTS}`;
}

/** 按变体选择 prompt. */
export function buildVisitorPrompt(seed: VisitorPoolTemplateSeed, difficulty: PersonaDifficulty, variant: VisitorPromptVariant): string {
  return variant === 'seed-v1' ? buildSeedVisitorPrompt(seed, difficulty) : buildSharedVisitorPrompt(seed, difficulty);
}
