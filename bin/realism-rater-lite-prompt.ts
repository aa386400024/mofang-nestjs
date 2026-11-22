// V2026-11-21 建立 (AF-229 · R6-D2 Lite 专用真人度评分 prompt):
//   职责: 给小体量模型（doubao-seed-2-1-lite-260915）单独一套真人度评分提示词，
//         与 Pro/MiniMax 用的 buildRealismRaterPrompt 并存（路线 A：双轨制）。
//   边界: 纯函数、零 IO、零网络、零模型调用；只产出 system/user 文本；
//         不改 src 既有协议与阈值，不改 runtime/CLI，不做跨模型分数合并或校准。
//   为什么单独写一套:
//     Lite 在同一批 24 个评测 packet 上 exact 一致率贴近 Pro，但五维 κ 不稳。
//     先按"提示词未适配小模型"这一支做开发集实验，再用留出集决定双轨要不要保留。
//   适配点（小模型共性，逐条对应可观察行为而不是形容词）:
//     · 锚点改成行为清单：1 分要能被识别、5 分要够得着，中间两档给确定性归并规则；
//     · 显式禁止"默认给 3 分"，并给出必须重看清单的触发条件（五维里 ≥3 维都是 3 分）；
//     · 三个最易滑过去的维度给专项检查步骤（前后轮对比 / 媒介线索 / 咨询师一句话后的反应）；
//     · 输出契约给完整示例行，降低小模型把协议写坏的概率；
//     · 评分步骤显式成文（读场景 → 列来访者轮次 → 逐维找证据 → 对清单 → 给整数分）。
//   协议兼容: 输出仍是 AF-214 的行协议（dimension=分数|轮次|原文短句 + overall + notes），
//         可被 parseRealismRatingLines 直接解析；本模块不引入任何新协议。

import {
  AI_REALISM_DISCLAIMER,
  REALISM_DIMENSIONS,
  REALISM_DIMENSION_LABELS,
  type RealismBlindPacket,
  type RealismDimension,
  type RealismRaterPrompt,
} from '../src/auto-practice/metrics/visitor-realism-rating.js';

/** Lite 专用提示词版本；与 AF-214 主协议版本分开递增，改清单或步骤必须递增。 */
export const LITE_PROMPT_VERSION_V1 = 'lite-rubric-v1';
export const LITE_PROMPT_VERSION_V2 = 'lite-rubric-v2';
/** 兼容既有 V1 调用方：默认版本仍是 V1，V2 必须显式选择。 */
export const LITE_PROMPT_VERSION = LITE_PROMPT_VERSION_V1;

export type LitePromptVariant = 'lite-v1' | 'lite-v2';

/** 评分员；R1 证据优先 / R2 整体叙事，两人都用同一套清单与同一套行协议。 */
export type LiteRaterId = 'R1' | 'R2';

/**
 * Lite 版场景标签。
 * src 里的 SCENE_LABELS 是私常量、不可跨模块引用，故此处自持一份；
 * 三个键与 RealismScene 严格一致（用索引访问保证编译期不漂移）。
 */
const LITE_SCENE_LABELS: Readonly<Record<RealismBlindPacket['scene'], string>> = {
  in_person: '面对面咨询（同一个咨询室，面对面出声说话）',
  online_voice: '线上实时语音咨询（能听见彼此声音，不是打字）',
  online_text: '线上文字咨询（通过文字消息来回交流）',
};

/** 单维行为清单：1 / 3 / 5 分各自写成"能不能一眼看出来"的可观察行为。 */
interface LiteDimensionRubric {
  /** 这一维在问什么（一句话）。 */
  readonly question: string;
  /** 5 分：命中 ≥3 条，且无 1 分档特征。 */
  readonly five: readonly string[];
  /** 3 分：命中本档描述、且没有 1 分档特征时给 3。 */
  readonly three: string;
  /** 1 分：命中 ≥2 条即可给 1。 */
  readonly one: readonly string[];
}

/**
 * 五维行为清单（Lite 专用，不是 AF-214 锚点的改写版）。
 * 每条都是可以指出来"这句话算不算命中"的行为，不写"好/差/自然"这类空话。
 */
const LITE_RUBRICS: Readonly<Record<RealismDimension, LiteDimensionRubric>> = {
  naturalness: {
    question: '这段话像不像现场说出来',
    five: ['有停顿词（嗯、那个、呃、就是）', '长句短句混着来', '会说到一半改口或吞回去', '只讲想讲的，不交代背景'],
    three: '有口语词，但整句仍像提前写好的；停顿只在句首出现，不承担表达功能；没有真正的自我修正',
    one: ['每轮都是完整论述，长度接近', '连接词成串出现、书面语', '没有填充词、没有未完成句', '多轮之间节奏完全一致'],
  },
  emotional_continuity: {
    question: '情绪有没有被上一轮真的推动',
    five: ['情绪跟着上一轮走，有迟滞', '反复、自我否认、说完又收回', '只给身体感觉或动作，说不清', '靠近与回避交替出现'],
    three: '情绪大致接得上，但转折生硬、像按剧情需要换情绪；深层情绪出现得快、收得也快',
    one: ['情绪突然跳档', '上一轮还在防御，下一轮突然深情告白', '切换处没有任何过渡词或动作'],
  },
  turn_shape: {
    question: '话轮像不像真人现场博弈',
    five: ['会只给半句', '会躲（答非所问、转移话题）', '会突然多说一句', '防御时变短、松动时变长'],
    three: '有长有短，但分布均匀、像按模板轮换；话轮长短与当下状态无关',
    one: ['每轮都是完整论述', '从不短答、不反问、不沉默', '每轮长度整齐划一'],
  },
  scene_congruence: {
    question: '说话方式有没有被场景改变',
    five: [
      '媒介线索贯穿 ≥2 轮（当面：眼神/点头/沉默/起身；语音：停顿/呼吸/打断；文字：分段/撤回/错字/表情）',
      '表达方式带着媒介限制：当面靠动作、语音靠听觉线索、文字靠打字痕迹',
      '没有任何其他媒介的词（消息/屏幕/语音条/看到脸/听到叹气）',
    ],
    three: '没有穿帮，但场景只停留在称呼层面，不影响说话方式',
    one: ['混入别的媒介：当面场景出现"消息/屏幕/我发给你/语音条"', '文字场景出现"我看到你的脸/你点点头"这类当面描述'],
  },
  relational_presence: {
    question: '来访者是不是在跟咨询师互动，而不是自说自话',
    five: ['因为咨询师一句话而停顿、改口、回避或靠近', '主动试探，不只是等着被问', '对咨询师的说法有真实反应（信任/阻抗/试探）'],
    three: '能接住咨询师的话，但反应偏礼貌、偏配合；没有主动试探',
    one: ['自说自话，像独白', '对咨询师的话基本没有反应', '没有任何针对性回应'],
  },
};

/** R1 / R2 只在取证顺序上不同，清单与行协议完全共用。 */
const LITE_STANCES: Readonly<Record<LiteRaterId, string>> = {
  R1: '你的做法是证据优先：先在来访者原句里把证据找出来，再定分数；找不到证据的维度不要凭印象给高分。',
  R2: '你的做法是整体叙事：先通读整段，判断这像不像一个人在现场说话，再用证据把分数校准到你看到的档位。',
};

/** 五步评分流程：显式成文，降低小模型漏步骤的概率。 */
const LITE_STEPS: readonly string[] = [
  '1. 读场景：按标签确定媒介（当面 / 语音 / 文字）。',
  '2. 列轮次：只数来访者轮次并记住编号；证据只能落这些编号。',
  '3. 找证据：五个维度各找一条最能说明问题的来访者原句。',
  '4. 对清单：证据对照五维清单，看落在 1 / 3 / 5 哪档。',
  '5. 给分：五维各给整数分，再给 overall。',
];

/** 三个最易滑过去的维度：给独立检查步骤，不靠模型自觉。 */
const LITE_FOCUS_CHECKS: readonly string[] = [
  '· 情绪连续性：必须对比前后两个来访者轮次，看情绪有没有变化和过渡；只看一句不算。',
  '· 场景一致：先找媒介线索——当面场景出现"消息/屏幕/发送/语音条"是穿帮，文字场景出现"我看到你的脸"也是穿帮。',
  '· 关系在场：必须看咨询师一句话之后，来访者有没有反应（停顿、改口、回避、靠近、被戳到）。',
];

/** 反默认 3 分：小模型最容易在这里塌成一档中位分。 */
const LITE_NO_DEFAULT_MIDDLE: readonly string[] = [
  '· 3 分是"能看出在演但没出戏"的中间档，不是安全答案。',
  '· 五维最多 2 维给 5 分；第 3 维先重看是否真命中 ≥3 条，否则压回 4 分。',
  '· 五维有 3 维以上都是 3 分时，重看清单，不许保留默认分。',
  '· 5 分要命中 ≥3 条且无 1 分档特征，不轻易给。',
];

/** V2 阶梯：整体下移一档，专治 V1 的「4 分安全答案」。 */
const LITE_V2_LADDER: readonly string[] = [
  '· 5 分 = 命中 5 分档 ≥4 条，且无任何 1 分档特征。',
  '· 4 分 = 命中 5 分档恰好 3 条，且无任何 1 分档特征。',
  '· 3 分 = 命中 5 分档 ≤2 条，且无任何 1 分档特征。',
  '· 2 分 = 命中 1 分档 1 条。',
  '· 1 分 = 命中 1 分档 ≥2 条。',
  '· 五维最多 2 维给 5 分；第 3 维即使命中 ≥4 条，也压到 4 分。',
  '· 本阶梯覆盖上方清单里的「≥3 条给 5、2 条给 4」旧口径；V2 以本阶梯为准。',
];

/** V2 反「全 4」：只有最弱维也稳定命中 3 条，才允许保留 4。 */
const LITE_V2_ALL_FOUR_REVIEW: readonly string[] = [
  '· 五维全为 4 时，必须停下来复核最弱的那一维，不许直接提交。',
  '· 最弱维只要命中任一 1 分档特征：压到 2 分；命中 ≥2 条则压到 1 分。',
  '· 最弱维命中 5 分档 ≤2 条：压到 3 分。',
  '· 只有最弱维也稳定命中 5 分档 ≥3 条且无 1 分档特征，才保留 4 分。',
  '· 复核后至少一维发生变化，才允许进入 overall；不要用「整体还行」把全 4 保住。',
];

/** V2 overall：跟最突出维度或最弱维度，不取五维平均。 */
const LITE_V2_OVERALL: readonly string[] = [
  '· 若任一维为 5 且没有维度 ≤2：overall=5。',
  '· 若任一维 ≤2：overall 取最低的那一维分数。',
  '· 其余情况：把五维排序，overall 取第 3 个（中位数），不取算术平均。',
  '· overall 必须能从五维分数直接复算；notes 写清依据，不写「整体不错」。',
];

/** 证据规则：与 AF-214 解析器的校验口径一一对应（来访者轮次 / 原文子串 / ≤120 字符）。 */
const LITE_EVIDENCE_RULES: readonly string[] = [
  '· 五维各给一条证据，一条都不能少。',
  '· turnIndex 必须是来访者那一轮的编号，不能填咨询师那一轮。',
  '· quote 必须是该轮台词的原文子串，不超过 120 字符；不改写、不拼接、不加省略号、不编造。',
  '· 某维没有明显证据时，选最接近的一条来访者原句，不许省略该维。',
];

/** 输出契约：行协议，与 parseRealismRatingLines 的解析口径一致。 */
const LITE_OUTPUT_CONTRACT: readonly string[] = [
  '第一行必须是 naturalness=；五维按顺序各一行；最后 overall=；notes≤40 字。',
  '格式：维度=分数|轮次编号|原文短句',
  'naturalness=4|2|嗯……不太好',
  'emotional_continuity=3|4|胸口闷',
  'turn_shape=4|2|躺下就开始想工作',
  'scene_congruence=4|4|有时候会突然坐起来',
  'relational_presence=3|2|不太好',
  'overall=4',
  'notes=整体能接住咨询师的话。',
  '（示例只是格式，必须换成本次对话真实原句。）',
  '不要 JSON、不要 markdown、不要解释、不要分析过程、不要 <think>；不要复述对话。',
];

function renderRubric(): string {
  return REALISM_DIMENSIONS.map((dimension, index) => {
    const rubric = LITE_RUBRICS[dimension];
    return [
      `${index + 1}. ${dimension} ${REALISM_DIMENSION_LABELS[dimension]}｜在问：${rubric.question}`,
      `5 分（命中 ≥3 条，且无 1 分档特征）：${rubric.five.map((item) => `□ ${item}`).join(' ')}`,
      `3 分（命中 5 分档 ≤1 条，且无 1 分档特征）：${rubric.three}`,
      `1 分（命中 ≥2 条）：${rubric.one.map((item) => `□ ${item}`).join(' ')}`,
    ].join('\n');
  }).join('\n');
}

function buildSystem(raterId: LiteRaterId, variant: LitePromptVariant): string {
  const preamble = [
    `你是心塑 AI 来访者真人度评测的评分员 ${raterId}。`,
    AI_REALISM_DISCLAIMER,
    '只评来访者台词；不评咨询师、诊断、疗效或心理内容好坏。',
    LITE_STANCES[raterId],
    'R1/R2 共用清单与行协议，只有取证顺序不同。',
    '',
    '【五步流程】',
    ...LITE_STEPS,
    '',
    '【五维行为清单】',
    renderRubric(),
  ];
  if (variant === 'lite-v1') {
    return [
      ...preamble,
      '2 分 = 命中 1 分档 1 条；4 分 = 命中 5 分档 2 条；5 分 = 命中 5 分档 ≥3 条。',
      '',
      '【三个易滑维度的专项检查】',
      ...LITE_FOCUS_CHECKS,
      '',
      '【不要默认给 3 分】',
      ...LITE_NO_DEFAULT_MIDDLE,
      '',
      '【证据规则】',
      ...LITE_EVIDENCE_RULES,
      '',
      '【输出：行协议】',
      ...LITE_OUTPUT_CONTRACT,
    ].join('\n');
  }
  return [
    ...preamble,
    '',
    '【V2 评分阶梯】',
    ...LITE_V2_LADDER,
    '',
    '【全 4 必须复核】',
    ...LITE_V2_ALL_FOUR_REVIEW,
    '',
    '【overall 规则】',
    ...LITE_V2_OVERALL,
    '',
    '【三个易滑维度的专项检查】',
    ...LITE_FOCUS_CHECKS,
    '',
    '【不要默认给 4 分】',
    '· 4 分不是安全答案；不确定时按最弱维的 1 分档/≤2 条规则下调。',
    '· 五维里有 3 维以上都是 4 分时，必须逐维重看，不许整体提交。',
    '· 5 分要命中 ≥4 条且无 1 分档特征，不轻易给；最多 2 维给 5。',
    '',
    '【证据规则】',
    ...LITE_EVIDENCE_RULES,
    '',
    '【输出：行协议】',
    ...LITE_OUTPUT_CONTRACT,
  ].join('\n');
}

function renderPacket(packet: RealismBlindPacket): string {
  const visitorTurnIndexes = packet.turns.filter((turn) => turn.role === 'visitor').map((turn) => turn.turnIndex);
  const turnLines = packet.turns.map((turn) => `第 ${turn.turnIndex} 轮 ${turn.role === 'visitor' ? '来访者' : '咨询师'}：${turn.text}`);
  return [
    `场景：${LITE_SCENE_LABELS[packet.scene]}`,
    `packetId：${packet.packetId}`,
    `来访者轮次编号：${visitorTurnIndexes.length === 0 ? '无' : visitorTurnIndexes.join('、')}`,
    '',
    ...turnLines,
  ].join('\n');
}

/**
 * 构造 Lite 专用评分员提示词。
 *
 * 与 buildRealismRaterPrompt 并存（双轨制）：本函数只给 Lite 模型用，
 * 输出仍是 AF-214 的行协议，可直接喂给 parseRealismRatingLines。
 *
 * @param packet 盲评包
 * @param raterId R1 证据优先 / R2 整体叙事
 * @returns system + user
 */
export function buildLiteRaterPrompt(
  packet: RealismBlindPacket,
  raterId: LiteRaterId,
  variant: LitePromptVariant = 'lite-v1',
): RealismRaterPrompt {
  return {
    system: buildSystem(raterId, variant),
    user: ['请按上面五步给这段对话里的来访者打分（只评来访者，不评咨询师）。', '', renderPacket(packet)].join('\n'),
  };
}
