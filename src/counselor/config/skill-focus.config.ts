// V2026-10-26 治本 (专项训练聚焦 — AI 来访者侧的聚焦指令, spec §任务 1):
//   原因: `skillCode` (listening / questioning / voice) 拍板的目的之一是「用于 LLM 聚焦」.
//     但"聚焦"对**来访者**和**咨询师**是两件不同的事:
//       - 对来访者 (AI): 要**制造**能逼出目标技巧的场面 —— 咨询师练倾听, 就得让来访者
//         多说、多留白; 咨询师练提问, 就得让来访者对关键问题答得含糊, 逼咨询师换问法.
//       - 对咨询师 (督导): 要**重点评估**对应维度 —— 见 agent 侧 supervisor.prompts.ts.
//     这两件事若各写各的, 会出现"来访者演的不是那个场景, 督导却按那个维度打分"的错位.
//     治本: 技巧码 → 场景的映射集中在本文件 (来访者侧), 标签与聚焦维度集中在
//     shared/types/voice-skill.types.ts (两侧共用), 两边共用同一份码值定义.
//   反双胞胎:
//     - 不把聚焦指令塞进 `buildVisitorPersonaBehaviorBlock` 的通用段落: 通用段落是
//       "每场会谈都成立"的行为规则, 聚焦指令是"本场只针对一个技巧"的一次性设定
//     - 不让来访者**假装**在练某个技巧 (例: 来访者说"你继续问, 我练提问"): 来访者不知道
//       自己在被考核, 一旦意识到就会开始表演, 场面立刻假掉
//   验证:
//     1. tsc 0 错
//     2. 专项入口 (SystemFallback, 带 skillCode) 的来访者 prompt 带上对应聚焦段
//     3. 全流程 / 个案 (无 skillCode) 的 prompt **不含**聚焦段 (行为与改前一致)
//   时间戳: 2026-10-26

import { VOICE_SKILL_LABELS, type VoiceSkillCode } from '../../shared/types/voice-skill.types';

/**
 * 技巧码 → 来访者侧聚焦指令.
 *
 * 每条指令只描述**来访者怎么演**, 不描述咨询师该做什么 —— 后者是督导报告的事,
 * 混在来访者 prompt 里会让来访者开始"教"咨询师.
 */
const VISITOR_FOCUS_BY_SKILL: Readonly<Record<VoiceSkillCode, readonly string[]>> = {
  listening: [
    '你今晚想说的话比平时多 —— 讲得慢一些, 中间多留白, 让对方有机会回应.',
    '你会绕开最核心的那件事, 先谈外围 (工作 / 吃饭 / 天气), 偶尔提一句又收回去.',
  ],
  questioning: [
    '对方问到你关键的事时, 你的回答会含糊 ("也还好" / "就那样吧"), 需要对方换个问法才肯多说.',
    '你不主动补充信息, 只在被问到时给最短的答案, 让对方决定往哪个方向深挖.',
  ],
  voice: [
    '你的情绪起伏比表面看起来大 —— 有些话会突然压低, 有些话会越说越急.',
    '你会在关键的地方停顿或改口, 让对方有机会用语气和节奏把你接住.',
  ],
};

/**
 * 渲染 AI 来访者的专项聚焦指令.
 *
 * @param skillCode 专项训练技巧码 (null / undefined = 全流程或个案, 不聚焦)
 * @returns 聚焦指令正文; 无技巧码 → null (调用方按"不追加"处理)
 */
export function renderVisitorSkillFocus(skillCode: VoiceSkillCode | null | undefined): string | null {
  if (!skillCode) {
    return null;
  }
  const lines = VISITOR_FOCUS_BY_SKILL[skillCode];
  const label = VOICE_SKILL_LABELS[skillCode];
  return [
    '',
    `### 你的状态 (本次是「${label}」专项训练场)`,
    `- 本场咨询师要练的是「${label}」, 你要**用下面的方式**把它逼出来:`,
    ...lines.map((line) => `  ${line}`),
    '- 你**不知道**这是一场专项训练, 也不要提及"练习" / "训练" / "技巧"这类词 —— 一旦说破, 场面就假了.',
    '- 除了上面这几条, 你其余的人设与设定照常 (核心信念 / 防御 / 信任度规则不变).',
  ].join('\n');
}
