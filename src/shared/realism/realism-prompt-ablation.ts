// V2026-11-23 建立 (AF-330 · 来访者真人度 prompt 分层消融):
//   职责: 把生产 humanization-v1 prompt 块拆成 quota / event / context 三个可归因层,
//         在固定合成人设下构造逐字子集; 纯常量 + 纯函数, 不调用模型.
//   边界: 不修改生产块、不切模式、不读环境; 合成语料, 不涉及真实咨询内容.

import { REALISM_AB_BASE_SYSTEM, REALISM_AB_CONTEXT } from './realism-prompt-ab.js';
import { buildVisitorRealismPromptBlock, buildVisitorRealismProfile, type VisitorRealismContext } from './visitor-realism-profile.js';

export const ABLATION_ARMS = ['off', 'full', 'quota', 'event', 'context'] as const;

export type AblationArm = (typeof ABLATION_ARMS)[number];

export const ABLATION_PERSONAS = ['anxious', 'guarded'] as const;

export type AblationPersonaId = (typeof ABLATION_PERSONAS)[number];

export interface AblationPersona {
  readonly id: AblationPersonaId;
  readonly label: string;
  readonly baseSystem: string;
  readonly context: VisitorRealismContext;
}

/** 焦虑依恋人设复用 AF-329 的基础人设, 并显式补上焦虑依恋底色, 保证 role 解析为 anxious_seeker. */
const ANXIOUS_PERSONA: AblationPersona = {
  id: 'anxious',
  label: '焦虑依恋',
  baseSystem: REALISM_AB_BASE_SYSTEM,
  context: { ...REALISM_AB_CONTEXT, attachmentStyle: 'anxious', riskLevel: 'none' },
};

/** 回避依恋人设; 只改底色与状态输入, 咨询师轮次与输出约束保持同一套. */
const GUARDED_PERSONA: AblationPersona = {
  id: 'guarded',
  label: '回避依恋',
  baseSystem:
    '你是一名 41 岁的来访者陈默，伴侣总说你什么都不说，最近你自己也觉得什么都提不起劲。' +
    '用第一人称口语回答，每次只说 1-2 句；不要旁白、列表、术语或解释。' +
    '你习惯先挡一下，不主动交代，也不一次把心事说完。',
  context: {
    attachmentStyle: 'avoidant',
    trust: 0.32,
    arousal: 0.48,
    verbalResistance: 0.68,
    depthResistance: 0.55,
    styleResistance: 0.5,
    riskLevel: 'none',
    encounter: { mode: 'in_person' as const },
  },
};

export const ABLATION_PERSONA_DEFS: readonly AblationPersona[] = [ANXIOUS_PERSONA, GUARDED_PERSONA];

const CONTEXT_PREFIXES = ['优先级：', '场景层：', '语域层：', '角色声音层：', '话轮形态层：'] as const;

const QUOTA_PREFIX = '不流利配额：';
const EVENT_PREFIX = '事件层：';

/**
 * 从生产 profile 中挑出某一层.
 *
 * @param directives 生产块里的 directive 行 (不含首行标题)
 * @param arm 消融分支
 * @returns 该层 directive 行; off 为空
 */
export function selectAblationDirectives(directives: readonly string[], arm: AblationArm): readonly string[] {
  if (arm === 'off') return [];
  if (arm === 'full') return directives;
  const content = (line: string): string => (line.startsWith('- ') ? line.slice(2) : line);
  if (arm === 'quota') return directives.filter((line) => content(line).startsWith(QUOTA_PREFIX));
  if (arm === 'event') return directives.filter((line) => content(line).startsWith(EVENT_PREFIX));
  return directives.filter((line) => CONTEXT_PREFIXES.some((prefix) => content(line).startsWith(prefix)));
}

/**
 * 构造某个分支的 prompt 块.
 *
 * 除 off 外, 首行标题固定保留; 其余行必须逐字来自生产块, 不重写、不补句.
 *
 * @param persona 人设
 * @param arm 消融分支
 * @returns prompt 块; off 为空字符串
 */
export function buildAblationPromptBlock(persona: AblationPersona, arm: AblationArm): string {
  if (arm === 'off') return '';
  const profile = buildVisitorRealismProfile(persona.context, 'active');
  const fullBlock = buildVisitorRealismPromptBlock(profile);
  if (fullBlock.length === 0) return '';
  if (arm === 'full') return fullBlock;

  const [header, ...directiveLines] = fullBlock.split('\n');
  const selected = selectAblationDirectives(directiveLines, arm);
  if (selected.length === 0) return '';
  return [header, ...selected].join('\n');
}

/**
 * 构造某个分支的完整 system prompt.
 *
 * @param persona 人设
 * @param arm 消融分支
 * @returns 基础人设 + 可选块; off 只返回基础人设
 */
export function buildAblationSystemPrompt(persona: AblationPersona, arm: AblationArm): string {
  const block = buildAblationPromptBlock(persona, arm);
  return block.length > 0 ? `${persona.baseSystem}\n\n${block}` : persona.baseSystem;
}

/**
 * 按 id 取人设; 未知 id 抛错, 避免静默回落到单一人设.
 *
 * @param id 人设 id
 * @returns 人设定义
 */
export function getAblationPersona(id: string): AblationPersona {
  const persona = ABLATION_PERSONA_DEFS.find((entry) => entry.id === id);
  if (persona === undefined) throw new Error(`未知人设 ${id}; 可选 ${ABLATION_PERSONAS.join(' / ')}`);
  return persona;
}
