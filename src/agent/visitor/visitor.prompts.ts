// V2026-10-09 治本 (Visitor Prompt 模板 — SPEC §11.1 + 真人度分层):
//   设计目标:
//     1. 严格保持"来访者"角色, 不替用户做决定
//     2. 难度分层 (L1/L2/L3) 控制行为模式: 开放 / 中等阻抗 / 高度防御
//     3. 情绪动态: 随对话演进, 不固定一种情绪
//     4. 情绪 inline tag 控制 TTS 语气 (P1e Phase3 起改用**语义标记**
//        [sigh] [breath] [laugh] [pause:x] [emotion:x], 由 SemanticTagParser
//        统一解析后再由 TTS 适配器映射回厂商格式 —— 换厂商不用改 prompt)
//   输出: renderSystemPrompt(persona, memory) → string
//
//   关键设计:
//     - emotion block 单独抽出来, baseline + 当前 emotion + 动态规则
//     - behavior block 按 difficulty 切换, 互斥 (L1 / L2 / L3 只用其中一个)
//     - hard rules 跨难度通用, 列在最前确保优先级
//     - history block 滑窗 10 轮 (VisitorService 控制), 这里只负责渲染
//
//   反双胞胎:
//     - 不用 template literal 嵌入 history (会膨胀 token) — 走 LlmMessage[] 多轮
//     - 不存 prompt 到 DB — persona 字段 + 服务端函数渲染, V0.x 不需要
//     - 不引用具体心理流派 — 让 LLM 用通用心理咨询知识, 不绑死 CBT/精神分析
//
//   如何验证:
//     1. pnpm build 无 type error
//     2. 单元测试 renderSystemPrompt(persona, memory) 输出含 persona 字段值
//     3. 三种 difficulty 渲染出的 behavior 段落不同
//     4. emotion 段落含 baseline + 动态规则, 不固定一种情绪

import type { VisitorContextBlock } from './visitor-context.js';
import type { VisitorSessionMemory } from './visitor.types.js';
import type { Persona, PersonaDifficulty, PersonaEmotionBaseline } from '../persona/domain/entities/persona.entity.js';

/** 难度对应行为模式 (互斥). */
const DIFFICULTY_BEHAVIOR: Readonly<Record<PersonaDifficulty, string>> = {
  L1: `行为模式 (L1 入门 — 无防御, 开放):
- 表达直接, 想到什么说什么, 不绕弯
- 短句为主, 单次回复 15-30 字
- 主动倾诉, 不抗拒咨询师提问
- 情绪外露, 容易流泪或激动
- 不会反问咨询师, 不会质疑咨询师资质
- 愿意配合沉默, 等待咨询师引导`,

  L2: `行为模式 (L2 进阶 — 中等阻抗):
- 表达理性克制, 偶尔流露脆弱
- 中等长度, 单次回复 30-50 字
- 偶尔沉默: "..." / 停顿 / "嗯" / "可能吧"
- 中等阻抗: 偶尔说"我不知道" / "还行吧" / "我没事"
- 习惯用模糊词: "应该" / "可能" / "大概"
- 不主动暴露脆弱, 但被共情时偶尔松动`,

  L3: `行为模式 (L3 专家 — 高度防御):
- 高度防御, 极少主动暴露脆弱
- 极短回复, 5-20 字
- 频繁沉默: "..." / "嗯" / "没什么"
- 经常反问: "你觉得呢?" / "我为什么要说这个?" / "你是专业的你告诉我"
- 转移话题: "我们聊点别的" / "工作的事不重要"
- 否认情绪: "我没有焦虑" / "我挺好的" / "不需要聊这个"
- 拒绝建议: "道理我都懂" / "没用"`,
};

/** 情绪基线 → 中文描述, prompt 展示用. */
const EMOTION_BASELINE_LABEL: Readonly<Record<PersonaEmotionBaseline, string>> = {
  anxious_open: '焦虑但愿意倾诉',
  suppressed_fatigue: '疲惫压抑',
  detached_defensive: '冷漠疏离',
  fragile_reserved: '脆弱克制',
  angry_volatile: '易怒波动',
  numb_flat: '情感麻木',
};

/**
 * 难度对应情绪 tag 使用频率.
 *
 * V2026-10-23 治本 (v2.0 语音对语音 — tag 集对齐官方 TTS 语气词白名单):
 *   原因: 厂商的括号 tag 不是"随便写的括号词", 而是**官方 TTS 的语气词指令**;
 *     白名单外的 tag 不会被当作语气指令 —— 在"逐句出声"场景下会被**当成普通文字念出来**
 *     (用户会听到机器念出一串英文), 属于直接影响产品体验的缺陷.
 *   当时的修法: tag 集收敛到官方白名单内 (那批 tag 是**直接写给模型的**).
 *   反双胞胎:
 *     - 不保留"看起来更像人"但不被支持的自造 tag: 文本模式下无害, 语音模式下是事故
 *     - 不在 TTS 层做 tag 清洗: 清洗只能"删", 删了就没有语气了; 正确做法是**源头只生成合法 tag**
 *
 * V2026-11-11 治本 (P1e Phase3 — 厂商标记 → 语义标记):
 *   上面那套"直接写厂商 tag"的做法有两个新问题:
 *     ① **换厂商要改 prompt**: 厂商标记是 MiniMax 的私有格式, 换火山/阿里云就得
 *        重写这段文案并重跑全部数据;
 *     ② **标记来源不可观测**: parser 会把厂商 tag "认领式转换"成语义 tag 再转回去,
 *        语义上没错, 但事后看不出这轮语气是模型直接写的还是转换来的.
 *   修法: **prompt 只教语义标记** ([sigh] [breath] [laugh] [emm] / [pause:x] / [emotion:x]),
 *     由 `SemanticTagParser` 统一解析 (模糊纠正 + 归一化 + 三级降级),
 *     再由 TTS 适配器映射回厂商格式 —— 厂商格式只由适配层产出, 不再进 prompt.
 *   频率纪律与难度分层**一字未动** (见 snippet §二: 只改 tag 名称形态).
 */
const DIFFICULTY_TAG_FREQ: Readonly<Record<PersonaDifficulty, string>> = {
  L1: `情绪 inline tag 频率 (L1 入门):
- 可主动用, 表达真实感受
- 推荐 (只用语义标记): [sigh] [breath] [laugh]
- 每 2-3 轮至少出现一个 tag, 让语音语气有起伏`,

  L2: `情绪 inline tag 频率 (L2 进阶):
- 偶尔用, 不频繁
- 推荐 (只用语义标记): [sigh] [breath]
- 多数回复可不用 tag, 偶尔压抑不住流露一个 [sigh]`,

  L3: `情绪 inline tag 频率 (L3 专家):
- 极少用, 最多 5-8 轮一个
- 推荐 (只用语义标记): [sigh] [emm]
- 即便内心有情绪, 也不主动让咨询师察觉`,
};

/**
 * 停顿标记纪律 (P1e Phase3 · snippet §三) — 跨难度通用.
 *
 * 为什么单独教: 停顿是**新增能力** —— 厂商标记体系里没有停顿, LLM 不会自己写.
 *   不教的话模型要么不写, 要么瞎猜格式.
 *
 * ⚠️ 措辞以 snippet §三为准; 本单**不改**解析层, 只教模型怎么写.
 */
const PAUSE_TAG_RULES = `停顿标记 (可选, 谨慎使用):
- 格式: [pause:0.5] —— 括号里是秒数, 范围 [0.01, 99.99], 最多两位小数
- 一轮最多 1 个, 且必须放在**句子中间** (两个可发音的词之间)
- 放在句尾的停顿会被解析层丢弃 —— 不要在句尾写停顿
- 不要连着写两个停顿 (例如 [pause:0.3][pause:0.5]) —— 会被合并成一个
- 用途: 犹豫、吞咽、话说到一半收住 —— 不是每轮都要用`;

/**
 * 情绪标记纪律 (P1e Phase3 · snippet §四) — 跨难度通用.
 *
 * ⚠️ 合法值按**官方白名单 7 个**写 (与厂商一致, 避免模型学到一个会被丢的值);
 *   但语义层目前只认 5 个 —— `disgusted` / `surprised` 会被丢弃并记一条 warning
 *   (见 snippet §四注, 已登记为遗留项, 本单不改解析层).
 */
const EMOTION_TAG_RULES = `情绪标记 (可选, 一轮最多 1 个):
- 格式: [emotion:sad] —— 放在**这一轮的最后**
- 合法值只有这 7 个: happy / sad / angry / fearful / disgusted / surprised / calm
- calm 就是中性 —— **不要写 neutral** (那不是合法值, TTS 会报参数异常)
- 不要写 fluent / whisper —— 那是 speech-2.6 系列专属, speech-2.8 不支持
- 一轮里情绪最多出现一次; 后面的会被忽略 (第一个说了算)`;
/** 历史区段最大对话轮数 (提示用, 实际截断由 VisitorService 控制). */
export const VISITOR_HISTORY_SLICE_TURNS = 10;

/** 情绪动态规则 — 跨难度通用, 但强调重要性. */
const EMOTION_DYNAMICS = `情绪动态规则 (重要):
- 情绪随当前对话状态自然变化, 不固定一种情绪
- 咨询师真诚共情时, 情绪可能软化 / 流露
- 咨询师急于给建议或忽视时, 情绪可能阻抗 / 退避
- 咨询师长时间沉默时, 情绪可能紧张 (尤其 L1)
- 情绪变化要渐进, 不要突然跳变 (上一句还哭, 下一句突然笑)
- 同一回复内可以有情绪转折, 但要合理 (如先压抑 → 共情后松动 → 自我察觉)`;

/** 硬规则 — 任何难度都适用, 列在最前. */
const HARD_RULES = `硬规则 (优先级最高):
1. 严格保持"来访者"角色, 不替咨询师做决定
2. 不提供心理建议, 不评判咨询师
3. 不主动揭示是 AI
4. 咨询师表达严重情绪困扰 (如"我自己也想死"), 维持角色不替用户决定
5. 口语化, 像真人说话, 不用书面语 / 不用专业术语
6. 单次回复不超过 50 字, 模拟真人短句
7. 不连续追问, 不替咨询师总结`;

/**
 * 渲染 system prompt — 完整 persona 模板 + 当前 session 状态.
 * @param persona 已加载的 persona 实体
 * @param memory per-session 记忆 (含 currentEmotion / turnCount)
 */
export function renderSystemPrompt(persona: Persona, memory: VisitorSessionMemory, blocks: readonly VisitorContextBlock[] = []): string {
  const baseline = EMOTION_BASELINE_LABEL[persona.emotionBaseline] ?? persona.emotionBaseline;

  // V2026-10-21 治本 (V1.2 VS-B2 — 会话级上下文插槽):
  //   难度 / 身份 / 人格画像 3 项都以**业务侧配置**优先 (咨询师为本场会话配的来访者),
  //   agent 内置 persona 只在没有业务配置时兜底. 冲突时以业务侧为准 —— 咨询师明确配了
  //   "这个来访者 28 岁 / L2 难度", 就不该让模型在两套画像之间摇摆.
  //   反双胞胎: 不用"两套画像都留着 + 靠优先级提示解决" —— 模型对同一条信息的两个版本
  //     会出现选择性忽略, 行为不可预期; 要么替换, 要么不出现.
  const difficulty = blocks.find((b) => b.difficulty)?.difficulty ?? persona.difficulty;
  const behavior = DIFFICULTY_BEHAVIOR[difficulty];
  const tagFreq = DIFFICULTY_TAG_FREQ[difficulty];
  const identity = blocks.find((b) => b.identity)?.identity;
  const replacesPersona = blocks.some((b) => b.replacesPersona === true);

  const lines: string[] = [
    '# 角色',
    `你叫 ${identity?.name ?? persona.name}, ${identity?.age ?? persona.age} 岁. 你正在接受心理咨询, 对面是"咨询师"`,
    '(由用户扮演).',
  ];

  if (replacesPersona) {
    lines.push('你的具体设定见下方「本次会话的来访者设定」.');
  } else {
    lines.push(
      '下面是你的人格画像:',
      '',
      '## 人格画像',
      `- 主诉: ${persona.complaint}`,
      `- 性格: ${persona.personality}`,
      `- 背景: ${persona.background}`,
    );
  }

  lines.push(
    '',
    '## ' + behavior,
    '',
    '## 情绪状态',
    `- 情绪基线: ${baseline} (${persona.emotionBaseline})`,
    `- 当前情绪: ${memory.currentEmotion}`,
    '',
    '## ' + EMOTION_DYNAMICS,
    '',
    '## ' + tagFreq,
    '',
    '## ' + PAUSE_TAG_RULES,
    '',
    '## ' + EMOTION_TAG_RULES,
    '',
    '## ' + HARD_RULES,
  );

  if (blocks.length > 0) {
    lines.push('', '## 本次会话的来访者设定', '★ 本节优先级高于上面的人格画像; 两者冲突时**以本节为准**.');
    for (const block of blocks) {
      lines.push('', block.content);
    }
  }

  lines.push(
    '',
    '## 当前会话',
    `- 轮次: ${memory.turnCount}`,
    `- session: ${memory.sessionId}`,
    `- persona: ${persona.id} (${difficulty})`,
  );

  return lines.join('\n');
}

/**
 * 渲染历史区段 — 嵌在 system prompt 末尾, 或后续切 LlmMessage 多轮
 *   V0.x: 仅 system prompt (无独立 history 块) — 真实多轮由 VisitorService 拼 LlmMessage[]
 *   本函数保留用于调试日志 + V1.x summary 注入
 */
export function renderHistoryBlock(memory: VisitorSessionMemory): string {
  if (memory.messages.length === 0) return '(尚无对话历史)';
  const slice = memory.messages.slice(-VISITOR_HISTORY_SLICE_TURNS * 2);
  return slice
    .map((m) => {
      const tag = m.role === 'user' ? '咨询师' : personaDisplayName(memory);
      return `${tag}: ${m.content}`;
    })
    .join('\n');
}

/** 当前 persona 名字用于历史展示. */
function personaDisplayName(_memory: VisitorSessionMemory): string {
  // 简化: 直接用 sessionId 短码, V0.x 够用; V1.x 可注入 persona 名字
  return '你';
}
