/**
 * 共享枚举与常量 — 专项训练技巧码 (V2026-10-26, spec §任务 1).
 *
 * 为什么要放 shared (跟 practice.types.ts 同款定位):
 *   「专项训练技巧码」的语义要同时被**两侧**消费, 且两侧不能互相 import:
 *     - counselor 侧: 给 AI 来访者注入"聚焦指令" (让来访者的表现**逼出**目标技巧)
 *     - agent 侧 (supervisor): 生成**事后专项反馈**时优先聚焦对应评分维度
 *   counselor → agent 方向允许 (counselor 已经 import agent 的类型), 但 agent → counselor
 *   是明令禁止的反向依赖 (agent 侧 0 处 import counselor). 把技巧码放 counselor 会逼出
 *   agent → counselor; 放 agent 会逼出 counselor → agent (虽然允许, 但语音协议层
 *   voice → agent 已经存在, 再叠一条 counselor → agent 会让 voice/counselor/agent
 *   三方的依赖边界变糊).
 *   唯一无争议的家 = shared: 两边都只依赖 shared, 谁也不认识谁.
 *
 * 设计原则:
 *   - 码值本身是**跨端协议** (前端 `SessionStart.skillCode` 也用这三个字面量), 不能各端各写
 *   - 标签 / 聚焦维度只此一份, 避免"来访者聚焦用 A 说法、督导聚焦用 B 说法"的漂移
 */

/** 专项训练技巧码枚举 (与前端 `SessionStart.skillCode` 1:1). */
export const VOICE_SKILL_CODES = [
  'listening', // 倾听 — 能不能接住来访者的话
  'questioning', // 提问 — 能不能问出关键信息
  'voice', // 表达 — 语调 / 语速 / 措辞是否匹配来访者状态
] as const;

export type VoiceSkillCode = (typeof VOICE_SKILL_CODES)[number];

/**
 * 技巧码 → 中文标签.
 *
 * 两处 prompt (来访者聚焦 / 督导聚焦) 共用这一份, 改文案只改这里.
 */
export const VOICE_SKILL_LABELS: Readonly<Record<VoiceSkillCode, string>> = {
  listening: '倾听',
  questioning: '提问',
  voice: '表达',
};

/**
 * 技巧码 → 督导六维里对应的维度 (事后专项反馈的聚焦点).
 *
 * 六维取自 `SupervisionDimensions`: empathy / activeListening / questioning /
 * boundary / response / professionalism.
 */
export const VOICE_SKILL_FOCUS_DIMENSIONS: Readonly<Record<VoiceSkillCode, string>> = {
  listening: 'activeListening (主动倾听)',
  questioning: 'questioning (提问技术)',
  voice: 'response (反应) 与 professionalism 中的语速语调表达',
};

/**
 * 码值是否合法.
 *
 * 非法值**直接忽略** (不报错、不断连) —— 见 spec §任务 1「非法值直接忽略」.
 *
 * @param raw 原始值
 * @returns 合法技巧码; 非法 / 空 → undefined
 */
export function toVoiceSkillCode(raw: string | null | undefined): VoiceSkillCode | undefined {
  if (raw === null || raw === undefined) {
    return undefined;
  }
  const value = raw.trim().toLowerCase();
  if (value.length === 0) {
    return undefined;
  }
  return VOICE_SKILL_CODES.find((item) => item === value);
}
