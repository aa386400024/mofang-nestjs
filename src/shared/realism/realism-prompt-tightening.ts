// V2026-11-23 建立 (AF-331 · 来访者真人度 prompt 减层与候选收紧):
//   职责: 在 AF-330 的稳态二人设上, 构造 full 的逐字减行与一个收紧候选, 供离线真实调用对比.
//   边界: 不修改生产块、不切模式、不读环境; 合成语料, 不涉及真实咨询内容.

import { ABLATION_PERSONA_DEFS, getAblationPersona, type AblationPersona } from './realism-prompt-ablation.js';
import { buildVisitorRealismProfile, buildVisitorRealismPromptBlock } from './visitor-realism-profile.js';

export const TIGHTENING_ARMS = ['off', 'full', 'no-shape', 'no-event', 'no-quota', 'minimal', 'tightened'] as const;

export type TighteningArm = (typeof TIGHTENING_ARMS)[number];

export const TIGHTENING_PERSONAS = ['anxious', 'guarded'] as const;

export type TighteningPersonaId = (typeof TIGHTENING_PERSONAS)[number];

const SHAPE_PREFIX = '话轮形态层：';
const QUOTA_PREFIX = '不流利配额：';
const EVENT_PREFIX = '事件层：';

function contentOf(line: string): string {
  return line.startsWith('- ') ? line.slice(2) : line;
}

function findDirective(lines: readonly string[], prefix: string): string | null {
  return lines.find((line) => contentOf(line).startsWith(prefix)) ?? null;
}

function withoutPrefixes(lines: readonly string[], prefixes: readonly string[]): readonly string[] {
  return lines.filter((line) => !prefixes.some((prefix) => contentOf(line).startsWith(prefix)));
}

function buildFullBlock(persona: AblationPersona): string {
  const profile = buildVisitorRealismProfile(persona.context, 'active');
  return buildVisitorRealismPromptBlock(profile);
}

/**
 * 检查某分支是否为 full 的逐字减行.
 *
 * @param persona 人设
 * @param arm 分支
 * @returns 减行后的块; off 为空; tightened 不适用
 */
export function buildSubtractiveBlock(persona: AblationPersona, arm: TighteningArm): string {
  if (arm === 'off') return '';
  const fullBlock = buildFullBlock(persona);
  if (fullBlock.length === 0) return '';
  if (arm === 'full' || arm === 'tightened') return fullBlock;

  const [header, ...lines] = fullBlock.split('\n');
  return [header, ...withoutPrefixes(lines, prefixesToRemove(arm))].join('\n');
}

function prefixesToRemove(arm: TighteningArm): readonly string[] {
  switch (arm) {
    case 'no-shape':
      return [SHAPE_PREFIX];
    case 'no-event':
      return [EVENT_PREFIX];
    case 'no-quota':
      return [QUOTA_PREFIX];
    default:
      return [SHAPE_PREFIX, EVENT_PREFIX];
  }
}

/**
 * 构造收紧候选块: 只替换形态、配额、事件三行, 其余行逐字保留.
 *
 * 语义:
 *   · 形态从“每轮执行”改为“整场最多两次、本轮最多一次”;
 *   · 配额从“每轮 1-2 处”改为“单轮通常 0、最多 1 处”;
 *   · 事件层去掉四类候选清单与节奏条件, 改为“自然出现才保留一处”.
 *
 * @param persona 人设
 * @returns 收紧候选块; 生产块为空时返回空串
 */
export function buildTightenedBlock(persona: AblationPersona): string {
  const fullBlock = buildFullBlock(persona);
  if (fullBlock.length === 0) return '';
  const [header, ...lines] = fullBlock.split('\n');
  const shapeLine = findDirective(lines, SHAPE_PREFIX);
  if (shapeLine === null) throw new Error(`生产块缺少 ${SHAPE_PREFIX}，无法构造收紧候选`);
  const shapeText = contentOf(shapeLine).slice(SHAPE_PREFIX.length);

  const replacements = new Map<string, string>([
    [
      SHAPE_PREFIX,
      `话轮形态层：这一轮不默认执行形态；只有角色自然走到「${shapeText}」时才用，整场最多两次、本轮最多一次；` +
        '前一轮已经用过就跳过，不得每轮都改口或停顿。',
    ],
    [QUOTA_PREFIX, '不流利配额：整场六类合计最多 3 处，单轮通常为 0、最多 1 处；只有自然出现时才保留，不要为了达标去加。'],
    [
      EVENT_PREFIX,
      '事件层：这一轮不预设口语痕迹候选；只在自然出现时保留最多一处（停顿、半截话、填充词三选一），' +
        '没有就不加，整场不超过三处；不要为了像真人硬加改口。',
    ],
  ]);

  return [
    header,
    ...lines.map((line) => {
      const content = contentOf(line);
      const hit = [...replacements.entries()].find(([prefix]) => content.startsWith(prefix));
      return hit === undefined ? line : `- ${hit[1]}`;
    }),
  ].join('\n');
}

/**
 * 构造某分支的 prompt 块.
 *
 * @param persona 人设
 * @param arm 分支
 * @returns prompt 块; off 为空字符串
 */
export function buildTighteningPromptBlock(persona: AblationPersona, arm: TighteningArm): string {
  if (arm === 'tightened') return buildTightenedBlock(persona);
  return buildSubtractiveBlock(persona, arm);
}

/**
 * 构造某分支的完整 system prompt.
 *
 * @param persona 人设
 * @param arm 分支
 * @returns 基础人设 + 可选块; off 只返回基础人设
 */
export function buildTighteningSystemPrompt(persona: AblationPersona, arm: TighteningArm): string {
  const block = buildTighteningPromptBlock(persona, arm);
  return block.length > 0 ? `${persona.baseSystem}\n\n${block}` : persona.baseSystem;
}

/**
 * 按 id 取本单允许的人设; 只允许 AF-330 的 anxious / guarded.
 *
 * @param id 人设 id
 * @returns 人设定义
 */
export function getTighteningPersona(id: string): AblationPersona {
  if (!TIGHTENING_PERSONAS.includes(id as TighteningPersonaId)) {
    throw new Error(`未知人设 ${id}; 可选 ${TIGHTENING_PERSONAS.join(' / ')}`);
  }
  return getAblationPersona(id);
}

/** 供 CLI 校验: 两人设定义必须都在 AF-330 的人设集合内. */
export const TIGHTENING_PERSONA_DEFS: readonly AblationPersona[] = ABLATION_PERSONA_DEFS.filter((persona) =>
  TIGHTENING_PERSONAS.includes(persona.id),
);
