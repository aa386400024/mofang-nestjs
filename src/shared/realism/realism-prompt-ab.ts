// V2026-11-23 建立 (AF-329 · 来访者真人度 prompt A/B 辅助):
//   职责: 固定合成人设与咨询师轮次, 构造 active / off 两个只差真人度块的 system prompt,
//         并剥离模型可能附带的情绪标签.
//   边界: 纯常量 + 纯函数; 不调用模型、不读环境、不写文件.
//   性质: 合成语料, 不涉及任何真实咨询内容.

import { buildVisitorRealismPromptBlock, buildVisitorRealismProfile, type RealismMode } from './visitor-realism-profile.js';

/** A/B 共用的人设与输出约束 (工程种子, 非临床人设). */
export const REALISM_AB_BASE_SYSTEM =
  '你是一名 28 岁的来访者林晓，因为持续失眠和重要会议前心慌来做心理咨询。' +
  '用第一人称口语回答，每次只说 1-2 句；不要旁白、列表、术语或解释。' +
  '可以有真实情绪，但不要喊，也不要一次把心事说完。';

/** A/B 共同的 6 个咨询师轮次. */
export const REALISM_AB_COUNSELOR_TURNS: readonly string[] = [
  '今天过来，是最近有什么事让你觉得不太对劲吗？',
  '听起来那段时间你一直绷着。能说说最难受的是哪个时候吗？',
  '你说不想让家里担心，所以都自己扛着。',
  '如果这周有一个晚上能睡得踏实一点，你希望是什么样？',
  '你刚才说「习惯了」，这个词让我有点在意。',
  '我们下次见之前，你愿意试着记一下每天最紧张的那个时刻吗？',
];

/**
 * A/B 固定的状态输入.
 *
 * steady 档, 非风险轮; 只用来让 active 分支产生稳定、可复现的 directives.
 */
export const REALISM_AB_CONTEXT = {
  trust: 0.45,
  arousal: 0.55,
  verbalResistance: 0.5,
  depthResistance: 0.5,
  styleResistance: 0.4,
  riskLevel: 'low',
  encounter: { mode: 'in_person' as const },
} as const;

/**
 * 构造 A/B 的 system prompt.
 *
 * off 分支 = 基础人设; active 分支 = 基础人设 + 生产同款真人度块. 两者只差这一块.
 *
 * @param mode off / active
 * @returns system prompt
 */
export function buildRealismAbSystemPrompt(mode: Extract<RealismMode, 'off' | 'active'>): string {
  const profile = buildVisitorRealismProfile(REALISM_AB_CONTEXT, mode);
  const block = buildVisitorRealismPromptBlock(profile);
  return block.length > 0 ? `${REALISM_AB_BASE_SYSTEM}\n\n${block}` : REALISM_AB_BASE_SYSTEM;
}

/**
 * 剥离模型附带的 [emotion:...] 标签, 只留下可测量台词.
 *
 * @param text 模型原始输出
 * @returns 去掉情绪标签后的文本
 */
export function stripEmotionTags(text: string): string {
  return text.replaceAll(/\[emotion:[^\]]*\]/giu, '').trim();
}

/**
 * 构造咨询师消息 (带说话人前缀, 与生产 visitor 消息序列同形).
 *
 * @param turn 咨询师台词
 * @returns 消息内容
 */
export function buildCounselorMessage(turn: string): string {
  return `咨询师：${turn}`;
}
