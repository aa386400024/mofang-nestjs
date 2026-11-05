// V2026-11-05 治本 (WP63 · B 层 · 审议 prompt 模板):
//   职责: 组装「LLM 审议层」的三个 prompt 零件 —— 系统 prompt / 用户 prompt /
//         schema 自然语言描述. 让 WP64 只管"发一次请求", 不用重写 prompt.
//   边界: 纯函数, 零 IO / 零 LLM 调用 / 零 @nestjs. **不写 prompt 进内核** (内核零 prompt,
//         boundary 断言④守着).
//
//   为什么 prompt 写在**适配层**而不是内核:
//     北极星 (hybrid-bdi-agent-blueprint-v1.0.md §2.2) 明确: 审议服务在
//     `src/engine-adapters/deliberation/`, 不在 engine-core. 内核是纯层, 零 prompt.
//
//   反双胞胎:
//     - **不自己拼"完整系统 prompt"** —— `CounselorLlmJsonClient` 已经把
//       `schemaDescription` 拼到 system prompt 尾部 (见 llm-json.client.ts:115).
//       再造一个"合并版" = 两种拼法, WP64 一不留神就把 schema 拼两遍.
//       本文件只出零件, 拼装**由 client 独家负责**.
//     - **枚举清单不手写** —— 维度名与标签名从 `deliberation-types.ts` 的常量**生成**.
//       手写一份 = 两份真相, 内核加了维度而 prompt 没跟上, 模型就会输出非法维度.
//     - **不在这里做格式校验 / 重试** —— 那是 WP66 的事 (本文件只负责"问得清楚").
//     - **不问模型要分数 / 评级** —— 零压红线 (AGENTS.md §5.3): 分数只允许出现在
//       MCQ 备考频道, 且由那一侧的评分链路产出. 审议层在两种模式下都**只**产出
//       delta 建议 + 理由, 产物形状完全相同.
//     - **空发言不写空串** —— 写「（本轮没有发言）」. 留空 = 模型看到一段没有回答的
//       提问, 很可能**脑补**一个回答 (与 `formatRollingSummaryInput` 同款治本).
//
//   ⚠️ 隐私红线 (AGENTS.md §5.4):
//     本文件产出的文本**含心理内容** (咨询师发言 / 来访反应 / 心理状态快照).
//     它只应作为 LLM 请求体流出去, **禁止进普通日志 / crash report / 网络日志**.
//
//   如何验证:
//     1. npx tsc -p tsconfig.build.json --noEmit 0 错
//     2. test/engine-adapters/wp63-deliberation-schema.spec.ts 覆盖两种模式的措辞差异 /
//        prompt 组装 / schema 描述里的枚举清单与常量一致
//
//   V2026-11-05 治本 (WP68 · B 层 · 意图锁定机制):
//     prompt 侧加两样东西:
//       ① **当前行为策略**进 user prompt —— `intentionShift` 是"换到另一个策略",
//         模型不知道现在用的是哪个, 就无从判断该不该换 (只能瞎猜) ——
//         那 WP68 想回答的问题（"LLM 会不会乱改意图"）就问不出答案.
//       ② **schema 描述**里给出 intentionShift 的写法 + 8 种策略的合法取值与含义.
//
//     ⚠️ 措辞纪律: intentionShift 是**可选**的 —— prompt 明确写"大多数轮次都该是 null",
//       否则模型会觉得"不填就是没干活", 硬凑一个切换建议 (那正好污染我们要测的东西).
//
//   如何验证 (WP68):
//     1. npx tsc -p tsconfig.build.json --noEmit 0 错
//     2. test/engine-adapters/wp68-deliberation-intention-lock.spec.ts 覆盖 intentionShift
//        的 prompt / schema 描述 / 校验

import {
  DELIBERATION_BEHAVIOR_STRATEGIES,
  DELIBERATION_DIMS,
  DELIBERATION_LLM_ONLY_TAGS,
  DELIBERATION_MAX_ABS_DELTA,
  DELIBERATION_REASON_MAX_CHARS,
  DELIBERATION_RULE_ALIGNED_TAGS,
  DELIBERATION_SUMMARY_MAX_CHARS,
  type DeliberationMode,
} from './deliberation-types.js';
import type { BehaviorStrategy } from '../../engine-core/index.js';

/**
 * 8 种行为策略的中文说明 (WP68) —— 给审议模型看的.
 *
 * ⚠️ 为什么必须给中文:
 *   `affective_exploration` / `cognitive_exploration` 这类英文名, 模型**猜不出**区别 ——
 *   猜不出就给出没有意义的切换建议, 而"LLM 会不会乱改意图"这个问题就**答不出来**了
 *   (WP68 的全部意义就是回答它). 所以给"英文名（中文）"两栏:
 *   模型既看得懂, 又知道 `targetStrategy` 该**原样输出英文名**.
 *
 * ⚠️ 用**穷尽 Record**: 内核加策略而这里没跟 → TS 报错, 逼着补 (与渲染层 `STRATEGY_LABEL` 同范式).
 */
const STRATEGY_INFO: Readonly<Record<BehaviorStrategy, { short: string; detail: string }>> = {
  simple_response: { short: '简单回应', detail: '只接住对方的话，不做深层处理' },
  request: { short: '提出请求', detail: '向来访索要信息、配合或承诺' },
  recounting: { short: '复述经历', detail: '把一件事从头讲一遍' },
  cognitive_exploration: { short: '认知探索', detail: '谈想法、看法、认知层面的内容' },
  affective_exploration: { short: '情感探索', detail: '谈情绪、感受、体验层面' },
  insight: { short: '洞察', detail: '触及核心议题与深层模式' },
  discussing_plans: { short: '讨论计划', detail: '谈接下来怎么做、具体安排' },
  resistance: { short: '阻抗', detail: '回避、防御、转移话题' },
};

/**
 * 审议系统 prompt 的**公共段** (两种模式共用).
 *
 * 硬约束清单 (每条都有理由, 不是凑数):
 *   1. 只输出软状态维度 —— 硬安全维度只走规则引擎 (见 deliberation-types.ts 的说明);
 *   2. 不判断也不提硬安全 —— 模型不擅长的领域不交给模型, 更不能让它"顺手提一句";
 *   3. delta 幅度上限 —— 与内核单回合 cap 对齐 (精确逐维 cap 由下游约束校验层施加);
 *   4. 没变化就不写 —— 审议输出是**增量**列表, 写一堆 delta=0 的条目纯浪费 token;
 *   5. 每条 delta 必须带标签 + 理由 —— 可解释性是这个层的**存在理由**, 不是加分项;
 *   6. 理由不许写话术、不许下临床诊断 —— 与仓库既有纪要 prompt 的护栏同款;
 *   7. 不要输出分数 / 评级 / 对错 —— 零压红线, 两种模式都适用.
 */
const COMMON_SYSTEM_PROMPT_LINES: readonly string[] = [
  '你是一名心理咨询督导，正在旁听一场咨询师与 AI 扮演的来访者之间的对练。',
  '',
  '【任务】',
  '根据来访者当前的心理状态、本轮咨询师的发言和来访者的反应，判断这一轮之后来访者的内心状态应该发生哪些变化，',
  '并以结构化的增量建议（delta）给出每一条变化及其理由。',
  '',
  '【输出契约】',
  '严格输出一个 JSON 对象，字段结构见本 prompt 末尾的 schema 描述。',
  '只输出 JSON，不要输出解释、注释或 markdown 代码块围栏。',
  '',
  '【硬约束】',
  `1. 只输出下列软状态维度：${DELIBERATION_DIMS.join(' / ')}。`,
  '2. 绝对不要输出硬安全维度（自杀倾向 / 自伤风险 / 危机等级）——那些由规则引擎负责，你不判断，也不要在理由里提及。',
  `3. 每个维度的 delta 是增量值，绝对值不超过 ${DELIBERATION_MAX_ABS_DELTA}。`,
  '4. 没有变化的维度不要出现在 deltas 里——真的没变就写 0 条，不要写成 delta=0 的条目。',
  `5. 每一条 delta 都必须带 operatorTags（至少 1 个）和 reason（一句话中文，≤${DELIBERATION_REASON_MAX_CHARS} 字），`,
  '   reason 必须说清"为什么"，不要写"因为来访者情绪变化"这类没有指向的空话。',
  '6. reason 里不要复述咨询师的具体话术，也不要做临床诊断。',
  '7. 不要输出分数、评级或对错判断——你的产物只有 delta 建议、标签和理由。',
  '8. 你是给"建议"，不是下"结论"：拿不准的维度就别写，或把整体 confidence 调低。',
  '9. intentionShift 是可选的：只有当来访者的心理阶段确实该换一个行为策略时才给建议，',
  '   否则一律填 null——大多数轮次都该是 null。不要为了"看起来有产出"而建议切换意图。',
];

/**
 * 考核模式 (MCQ 备考频道) 的追加段.
 *
 * 口径与自由模式的差别只有一个: **判定标准更严**（判定严 ≠ 打分严）.
 * 产物形状完全相同 —— 两种模式的 `DeliberationOutput` 是同一个类型.
 */
const EXAM_MODE_LINES: readonly string[] = [
  '',
  '【当前模式：考核（判定标准更严格）】',
  '这一场的咨询师回应会被用于考核评分，所以你的判定标准要比平时更严：',
  '- 负向标签必须打准：本轮里出现评判 / 说教 / 淡化 / 越界 / 触碰敏感议题的迹象，就标出来，',
  '  不要为了"温和"而放过；',
  '- delta 幅度取保守值：宁可小于真实影响，也不要夸大——夸大的幅度会让考核结论失真；',
  '- 只依据本轮明确出现的内容判断，不要从角色设定反推来访者"一定是"什么感受；',
  '- 不确定时把 delta 写小、把 confidence 写低，不要编造证据来填补空白。',
];

/**
 * 自由练习模式 (零压域) 的追加段.
 *
 * 口径与考核模式的差别只有一个: **允许更细地捕捉变化**.
 * 同样不产出分数 (零压红线) —— 只是不必要求"非黑即白".
 */
const FREEFORM_MODE_LINES: readonly string[] = [
  '',
  '【当前模式：自由练习（可以更灵活）】',
  '这一场是零压的自由练习，没有评分标准，所以可以更细地捕捉变化：',
  '- 除了明显的干预，也请捕捉细微信号：语气与情绪的细微变化（micro_expression）、',
  '  话里没明说但感觉在躲（implicit_resistance）、关系氛围的微妙升降（rapport_shift）；',
  '- 同一维度可以带多个标签，不必只挑一个最像的；',
  '- delta 可以小但准确——"几乎没变"本身也是一个有价值的判断，不要为了显得有产出而夸大；',
  '- 鼓励给出理由，哪怕这一轮的变化很小。',
];

/**
 * 组装审议系统 prompt.
 *
 * ⚠️ 返回的是**不含 schema 描述**的部分: `CounselorLlmJsonClient` 会把
 * `schemaDescription` 拼到 system prompt 尾部 (llm-json.client.ts:115).
 * 本文件**不提供**"合并版"函数 —— 两种拼法并存, WP64 一不留神就把 schema 拼两遍.
 *
 * @param mode 审议模式 (考核 / 自由练习)
 * @returns 系统 prompt 正文
 */
export function buildDeliberationSystemPrompt(mode: DeliberationMode): string {
  const modeLines = mode === 'exam' ? EXAM_MODE_LINES : FREEFORM_MODE_LINES;
  return [...COMMON_SYSTEM_PROMPT_LINES, ...modeLines].join('\n');
}

/**
 * 审议用户 prompt 的组装入参.
 */
export interface DeliberationUserPromptInput {
  /** 当前 BDI 状态快照 (JSON 字符串, LLM 能读). */
  readonly currentSnapshotJson: string;
  /** 本轮咨询师说的话. */
  readonly counselorText: string;
  /** 本轮来访的反应 (渲染出来的文本). */
  readonly visitorText: string;
  /** 角色种子信息 (依恋类型 / 大五人格 简述). */
  readonly characterBrief: string;
  /** 会话轮次. */
  readonly turnIndex: number;
  /**
   * 本轮**规则算子**选中的行为策略 (WP68).
   *
   * ⚠️ 为什么必须告诉模型"现在在做什么":
   *   `intentionShift` 是"**换**到另一个策略" —— 模型不知道当前策略, 就无从判断该不该换,
   *   只能瞎猜. 缺了这个字段, WP68 想回答的问题（"LLM 会不会乱改意图"）就**问不出答案**.
   */
  readonly ruleStrategy: BehaviorStrategy;
}

/**
 * 组装审议用户 prompt.
 *
 * 四个区块各管一件事, 顺序固定 (先状态 → 再发言 → 再背景 → 最后轮次):
 *   模型判 delta 需要的是"**状态 + 触发它的事件**" → 状态在前, 本轮发言紧随,
 *   角色背景垫底 (背景是**解释性**信息, 不是本轮证据), 轮次最后 (用于"这是第几轮"的量感).
 *
 * 空值一律写明"没有"而不是留空 (见文件头"反双胞胎"第 5 条).
 *
 * @param input 组装入参
 * @returns 用户 prompt 正文
 */
export function buildDeliberationUserPrompt(input: DeliberationUserPromptInput): string {
  const parts: string[] = [
    `【来访者当前状态】\n${orPlaceholder(input.currentSnapshotJson, '（未提供状态快照）')}`,
    `【当前行为策略】\n${formatStrategy(input.ruleStrategy)}`,
    `【本轮咨询师发言】\n${orPlaceholder(input.counselorText, '（本轮咨询师没有发言）')}`,
    `【本轮来访者反应】\n${orPlaceholder(input.visitorText, '（本轮来访者没有回复）')}`,
    `【角色背景】\n${orPlaceholder(input.characterBrief, '（未提供角色背景）')}`,
    `【会话轮次】\n第 ${input.turnIndex} 轮`,
  ];
  return parts.join('\n\n');
}

/**
 * 行为策略的一行展示 (WP68): `英文名（中文）`.
 *
 * ⚠️ **英文名在前**: 模型要**原样输出**英文名 (`targetStrategy` 的白名单是英文),
 *   中文只是帮它理解. 中文在前会让模型倾向于输出中文 → 校验层直接丢掉.
 */
function formatStrategy(strategy: BehaviorStrategy): string {
  return `${strategy}（${STRATEGY_INFO[strategy].short}）`;
}

/**
 * 组装输出 JSON 的**自然语言 schema 描述**.
 *
 * 为什么用自然语言描述而不是直接贴 JSON Schema:
 *   - 这类模型对"字段含义 + 取值范围 + 一条示例"的自然语言描述理解得比裸 JSON Schema 好;
 *   - 与仓库既有 `CounselorLlmJsonClient` 的用法一致 —— 它要的就是 `schemaDescription` 字符串.
 *
 * 枚举清单**从常量生成**, 不手写 (手写 = 两份真相, 见文件头"反双胞胎"第 2 条).
 *
 * @returns schema 描述正文
 */
export function buildDeliberationSchemaDescription(): string {
  const ruleTags = DELIBERATION_RULE_ALIGNED_TAGS.join(', ');
  const llmTags = DELIBERATION_LLM_ONLY_TAGS.join(', ');
  return [
    '【输出 JSON 结构】',
    '{',
    '  "deltas": [',
    '    {',
    `      "dimension": "<维度名>",     // 只能是下列 ${DELIBERATION_DIMS.length} 个字符串之一`,
    `      "delta": <数字>,              // 增量值, 绝对值 ≤ ${DELIBERATION_MAX_ABS_DELTA}`,
    '      "operatorTags": ["<标签>"],   // 至少 1 个, 只能是下列标签之一',
    `      "reason": "<一句话中文理由>"  // ≤${DELIBERATION_REASON_MAX_CHARS} 字, 说清"为什么"`,
    '    }',
    '  ],',
    `  "summary": "<一句话中文总结>",   // ≤${DELIBERATION_SUMMARY_MAX_CHARS} 字, 描述来访者此刻的状态`,
    '  "confidence": <0 到 1 的数字>,    // 整体置信度; 拿不准就调低',
    '  "intentionShift": null           // 可选: 建议切换行为策略时写成对象, 否则一律 null',
    '}',
    '',
    `dimension 的合法取值（${DELIBERATION_DIMS.length} 个，只能原样使用这些字符串）：`,
    DELIBERATION_DIMS.join(', '),
    '',
    `operatorTags 的合法取值（${DELIBERATION_RULE_ALIGNED_TAGS.length + DELIBERATION_LLM_ONLY_TAGS.length} 个，只能原样使用这些字符串）：`,
    `- 与规则算子对齐的 ${DELIBERATION_RULE_ALIGNED_TAGS.length} 个：${ruleTags}`,
    `- 只有你能打的 ${DELIBERATION_LLM_ONLY_TAGS.length} 个：${llmTags}`,
    '',
    'deltas 数组只放"确实发生变化"的维度；这一轮什么都没变就放空数组 []。',
    '',
    `intentionShift 的写法（可选字段，不需要切换行为策略时一律写 null）：`,
    'null  或  { "targetStrategy": "<策略名>", "reason": "<一句话中文理由>" }',
    `targetStrategy 的合法取值（${DELIBERATION_BEHAVIOR_STRATEGIES.length} 个，只能原样使用这些英文名）：`,
    ...DELIBERATION_BEHAVIOR_STRATEGIES.map(
      (strategy) => `- ${strategy}（${STRATEGY_INFO[strategy].short}）：${STRATEGY_INFO[strategy].detail}`,
    ),
    '只有当来访者的心理阶段确实该换一个行为策略时才给建议，否则写 null。',
  ].join('\n');
}

/**
 * 空值 → 占位说明 (而不是留空).
 *
 * 留空会让模型把"没说话"读成"内容缺失", 进而脑补; 显式写明是事实, 模型不会替它编.
 */
function orPlaceholder(raw: string, placeholder: string): string {
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : placeholder;
}
