// V2026-11-08 治本 (Phase2.5 WP-A · 审议输入最小化 · prompt 模板重写):
//   职责: 组装「LLM 审议层」的三个 prompt 零件 —— 系统 prompt / 用户 prompt /
//         schema 自然语言描述. 让审议层只靠**结构化数据**提问.
//   边界: 纯函数, 零 IO / 零 LLM 调用 / 零 @nestjs. **不写 prompt 进内核** (内核零 prompt,
//         boundary 断言④守着).
//
//   ⚠️ **本文件产出的文本不再含任何对话原文** (Phase2.5 WP-A 硬红线):
//     改造前用户 prompt 里有两个区块 —— 「本轮咨询师发言」「本轮来访者反应」——
//     里面是**逐字原文**, 原样发给第三方模型 (合规问题 R6) 且每轮都在烧 token (成本问题 R8).
//     现在用户 prompt 里只有: 事件分类 / 状态变化对比 / 角色基线 / 行为策略 /
//     风险等级 / 轮次 —— **没有一句话是来访者或咨询师说过的**.
//
//   为什么 prompt 模板要跟着重写 (而不只是"少传两个字段"):
//     系统 prompt 原文写着"根据……本轮咨询师的发言和来访者的反应, 判断……".
//     任务描述与实际输入**对不上** = 模型会去找它以为存在的东西 = 脑补.
//     任务单 §6.2 说"不改 LLM 输出什么", 但那指的是**输出契约**; 输入换了,
//     提问方式必须跟着换 —— 否则模型要么忽略数据、要么自己编.
//
//   反双胞胎:
//     - **不自己拼"完整系统 prompt"** —— `CounselorLlmJsonClient` 已经把
//       `schemaDescription` 拼到 system prompt 尾部 (见 llm-json.client.ts:115).
//       再造一个"合并版" = 两种拼法, 一不留神就把 schema 拼两遍.
//       本文件只出零件, 拼装**由 client 独家负责**.
//     - **枚举清单不手写** —— 维度名与标签名从 `deliberation-types.ts` 的常量**生成**.
//     - **不在这里做格式校验 / 重试** —— 那是 WP66 的事 (本文件只负责"问得清楚").
//     - **不问模型要分数 / 评级** —— 零压红线 (AGENTS.md §5.3).
//     - **空值写明"没有"而不是留空** —— 留空 = 模型看到一段没有回答的提问, 很可能**脑补**.
//     - **不替模型编证据** —— prompt 明说"你没有对话原文", 免得它去臆测话术.
//
//   ⚠️ 隐私红线 (AGENTS.md §5.4):
//     本文件产出的文本现在**不含心理内容** (只有标签 / 数字 / 角色种子元数据),
//     但它仍属"会发给第三方模型的数据" —— 角色简述来自种子设定 (合成数据),
//     状态数字是来访者的心理状态**指标** (不含内容). 依然不进普通日志 / crash report.
//
//   如何验证:
//     1. npx tsc -p tsconfig.build.json --noEmit 0 错
//     2. test/engine-adapters/wp63-deliberation-schema.spec.ts 覆盖两种模式的措辞差异 /
//        prompt 组装 / schema 描述里的枚举清单与常量一致
//     3. test/engine-adapters/phase25-wp-a-deliberation-input-minimization.spec.ts
//        覆盖"prompt 里没有原文"与 token 量下降 ≥40%

import { DELIBERATION_RISK_LEVEL_LABELS } from './deliberation-input.js';
import {
  DELIBERATION_BEHAVIOR_STRATEGIES,
  DELIBERATION_DIMS,
  DELIBERATION_LLM_ONLY_TAGS,
  DELIBERATION_MAX_ABS_DELTA,
  DELIBERATION_REASON_MAX_CHARS,
  DELIBERATION_RULE_ALIGNED_TAGS,
  DELIBERATION_SUMMARY_MAX_CHARS,
  type DeliberationInput,
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
 *   6. 不臆测话术 —— 模型**没有原文**, 复述或编造话术都是幻觉;
 *   7. 不输出分数 / 评级 / 对错 —— 零压红线, 两种模式都适用.
 */
const COMMON_SYSTEM_PROMPT_LINES: readonly string[] = [
  '你是一名心理咨询督导，正在旁听一场咨询师与 AI 扮演的来访者之间的对练。',
  '',
  '【任务】',
  '下面是本轮对练的**结构化数据**（不含任何对话原文）：',
  '  · 本轮咨询师行为的事件分类（内核规则分类器的产物）',
  '  · BDI 状态逐维的前后对比（前值 → 后值 + 变化量）',
  '  · 角色基线（依恋风格 / 大五人格 / 阻抗基线）',
  '  · 风险等级',
  '请据此判断：这一轮之后来访者的内心状态**应该**发生哪些变化，',
  '并以结构化的增量建议（delta）给出每一条变化及其理由。',
  '',
  '【你没有对话原文】',
  '你看不到咨询师和来访者说过的话 —— 这是刻意的（心理内容不外传）。因此：',
  '  · 只依据下面给出的结构化数据判断，不要臆测、也不要编造他们说过什么；',
  '  · 事件分类标签就是「这一轮咨询师做了什么行为」的全部证据；',
  '  · 状态对比就是「这一轮状态怎么动了」的全部证据。',
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
  '6. reason 只写状态层面的判断，不要复述或臆测咨询师的具体话术——你没有拿到原文，',
  '   任何具体话术都只能是你编的。',
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
  '- 负向标签必须打准：本轮事件分类里出现 judgment / preaching / minimizing / boundary_cross / sensitive_touch 时，',
  '  就把它们标出来，不要为了"温和"而放过；',
  '- delta 幅度取保守值：宁可小于真实影响，也不要夸大——夸大的幅度会让考核结论失真；',
  '- 只依据给出的结构化数据判断，不要从角色基线反推来访者"一定是"什么感受；',
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
 * 本文件**不提供**"合并版"函数 —— 两种拼法并存, 一不留神就把 schema 拼两遍.
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
 *
 * ⚠️ **没有任何原文字段** —— 这是本单最硬的一条约束 (WP-A §6.3).
 */
export interface DeliberationUserPromptInput {
  /** 会话轮次. */
  readonly turnIndex: number;
  /** 结构化输入 (事件分类 / 状态对比 / 角色基线 / 风险等级). */
  readonly structured: DeliberationInput;
}

/**
 * 组装审议用户 prompt.
 *
 * 六个区块各管一件事, 顺序固定 (先证据 → 再基准 → 最后轮次):
 *   ① 本轮事件分类 —— "这一轮咨询师做了什么" (证据);
 *   ② 状态变化对比 —— "状态怎么动了" (要判的对象);
 *   ③ 角色基线 —— "这个来访者本来是什么样" (判断基准);
 *   ④ 当前行为策略 —— "现在在做什么" (WP68 意图锁定要它);
 *   ⑤ 风险等级 —— "这一轮的风险上下文";
 *   ⑥ 会话轮次 —— "这是第几轮" (量感).
 *
 * 空值一律写明"没有"而不是留空 (见文件头"反双胞胎"第 5 条).
 *
 * @param input 组装入参
 * @returns 用户 prompt 正文
 */
export function buildDeliberationUserPrompt(input: DeliberationUserPromptInput): string {
  const { structured } = input;
  const parts: string[] = [
    `【本轮事件分类】\n${formatEvents(structured.events)}`,
    `【状态变化对比】\n${formatStateComparison(structured)}`,
    `【角色基线】\n${formatCharacterBaseline(structured)}`,
    `【当前行为策略】\n${formatStrategy(structured.ruleStrategy)}`,
    `【风险等级】\n${formatRisk(structured)}`,
    `【会话轮次】\n第 ${input.turnIndex} 轮`,
  ];
  return parts.join('\n\n');
}

/**
 * 事件分类区块 (一行, 逗号分隔).
 *
 * ⚠️ 空数组写明"没有" —— 留空会让模型以为数据缺失, 进而脑补"可能是共情吧".
 *
 * @param events 本轮事件分类标签
 * @returns 区块正文
 */
function formatEvents(events: readonly string[]): string {
  if (events.length === 0) return '（本轮未命中任何行为分类）';
  return events.join(', ');
}

/**
 * 状态变化对比区块 (逐维: 前值 → 后值 (变化量)).
 *
 * ⚠️ **固定 3 位小数**: 数字位数越少 token 越省, 但 3 位足够看出"变了多少"
 *   (内核 delta 的典型量级是 0.01-0.20). 少于 3 位会把 +0.015 显示成 +0.02 —— 失真.
 *
 * @param structured 结构化输入
 * @returns 区块正文
 */
function formatStateComparison(structured: DeliberationInput): string {
  const lines = structured.stateComparison.map(
    (entry) => `${entry.dimension}: ${formatFixed(entry.before)} → ${formatFixed(entry.after)} (${formatSigned(entry.delta)})`,
  );
  if (lines.length === 0) return '（未提供状态对比）';
  return ['（本轮前 → 本轮后，括号内为变化量）', ...lines].join('\n');
}

/**
 * 角色基线区块 (角色种子元数据 + 阻抗基线).
 *
 * @param structured 结构化输入
 * @returns 区块正文
 */
function formatCharacterBaseline(structured: DeliberationInput): string {
  const baseline = structured.resistanceBaseline;
  const resistance = `阻抗基线（话量 / 内容深度 / 表达风格）: ${formatFixed(baseline.verbal)} / ${formatFixed(baseline.depth)} / ${formatFixed(baseline.style)}`;
  const brief = structured.characterBrief.trim();
  if (brief.length === 0) return resistance;
  return `${brief}\n${resistance}`;
}

/**
 * 风险等级区块 (等级 + 命中的类别).
 *
 * @param structured 结构化输入
 * @returns 区块正文
 */
function formatRisk(structured: DeliberationInput): string {
  const label = DELIBERATION_RISK_LEVEL_LABELS[structured.riskLevel];
  if (structured.riskCategories.length === 0) return label;
  return `${label}（命中类别: ${structured.riskCategories.join(', ')}）`;
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
 * 固定小数位 (不带符号).
 *
 * @param value 数值
 * @returns 3 位小数的字符串
 */
function formatFixed(value: number): string {
  return value.toFixed(3);
}

/**
 * 带符号的固定小数位 (变化量).
 *
 * ⚠️ 零不带正负号 (`0.000` 而不是 `+0.000`) —— 免得"没动"看起来像"动了"。
 *
 * @param value 数值
 * @returns 3 位小数的字符串 (带 + / -)
 */
function formatSigned(value: number): string {
  const rounded = Number(value.toFixed(3));
  if (rounded === 0) return (0).toFixed(3);
  return `${rounded > 0 ? '+' : ''}${rounded.toFixed(3)}`;
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
