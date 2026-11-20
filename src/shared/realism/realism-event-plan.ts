// V2026-11-20 建立 (AF-208 · R2 生成侧真人度):
//   把 R1 的"这一轮可以用几处不流利"推进到"这一轮具体可以怎么不流利"。
//
//   设计约束:
//     ① 只给候选词表与上限，不强制发生 —— 真人不会每轮都按配额塞语气词；
//     ② 同角色 / 状态 / 场景永远得到同一份计划，保证回归与双盲可归因；
//     ③ 风险轮计划为空：安全信息优先清楚，真人感不压过可听性；
//     ④ 纯函数，不读 env、不写日志、不落库。

import type { RealismEventRhythm } from './realism-event-rhythm.js';
import type { RealismScene, RealismStateBand, VisitorVoiceRole } from './turn-shape-selector.js';

/** 六类文字层口语事件（与 Phase3 不流利度量同一组类型）。 */
export const REALISM_EVENT_KINDS = ['filler', 'pause', 'repair', 'trailoff', 'repetition', 'elongation'] as const;

export type RealismEventKind = (typeof REALISM_EVENT_KINDS)[number];

/** 事件计划只消费配额，不反向依赖 profile 类型。 */
export interface RealismEventQuotaSource {
  readonly filler: number;
  readonly pause: number;
  readonly repair: number;
  readonly trailoff: number;
  readonly repetition: number;
  readonly elongation: number;
  readonly maxEvents: number;
}

/** 一个事件候选：类别、具体词/标点、本轮上限、给模型的一句短提示。 */
export interface RealismEventOption {
  readonly kind: RealismEventKind;
  readonly token: string;
  readonly maxCount: number;
  readonly hint: string;
}

/** 本轮口语事件计划；options 为空表示这一轮不加任何不流利痕迹。 */
export interface RealismEventPlan {
  readonly maxEvents: number;
  readonly options: readonly RealismEventOption[];
}

/** 角色级候选词表；没有该项的角色给 null，表示这类痕迹不自然，不提供。 */
type RoleEventTokens = Readonly<Record<RealismEventKind, { readonly token: string; readonly hint: string } | null>>;

const ROLE_EVENT_TOKENS: Readonly<Record<VisitorVoiceRole, RoleEventTokens>> = {
  restrained: {
    filler: null,
    pause: { token: '……', hint: '用省略号留一个短停顿' },
    repair: null,
    trailoff: { token: '……', hint: '句尾留半截，不补完整' },
    repetition: null,
    elongation: null,
  },
  emotional: {
    filler: { token: '嗯', hint: '句首或句间一个短促的“嗯”' },
    pause: { token: '……', hint: '用省略号留一个短停顿' },
    repair: { token: '不对，我是说', hint: '说出口后改一次口' },
    trailoff: { token: '……', hint: '句尾留半截，不补完整' },
    repetition: null,
    elongation: { token: '——', hint: '一个词拖一下，不要整句拖' },
  },
  intellectualizing: {
    filler: { token: '那个', hint: '句首一个“那个”，不要连用' },
    pause: { token: '……', hint: '用省略号留一个短停顿' },
    repair: { token: '应该是', hint: '用“应该是”修正一次说法' },
    trailoff: { token: '……', hint: '句尾留半截，不补完整' },
    repetition: null,
    elongation: null,
  },
  passive_aggressive: {
    filler: { token: '呵', hint: '句首一个很轻的“呵”，不冷笑成段' },
    pause: { token: '……', hint: '用省略号留一个短停顿' },
    repair: { token: '不是，我是说', hint: '表面改口一次，不要解释动机' },
    trailoff: { token: '……', hint: '句尾留半截，不补完整' },
    repetition: null,
    elongation: null,
  },
  anxious_seeker: {
    filler: { token: '那个', hint: '句首一个“那个”，像在斟酌' },
    pause: { token: '……', hint: '用省略号留一个短停顿' },
    repair: { token: '不是，我是说', hint: '说错后赶紧改一次口' },
    trailoff: { token: '……', hint: '句尾留半截，不补完整' },
    repetition: { token: '那个……那个', hint: '同一句里重复一个词，最多一次' },
    elongation: null,
  },
  guarded_withdrawn: {
    filler: null,
    pause: { token: '……', hint: '用省略号留一个短停顿' },
    repair: null,
    trailoff: { token: '……', hint: '句尾留半截，不补完整' },
    repetition: null,
    elongation: null,
  },
  chaotic_disorganized: {
    filler: { token: '呃', hint: '句首一个“呃”，像突然卡住' },
    pause: { token: '……', hint: '用省略号留一个短停顿' },
    repair: { token: '不对，我是说', hint: '说到一半改口一次' },
    trailoff: { token: '……', hint: '句尾留半截，不补完整' },
    repetition: { token: '就……就', hint: '同一个词卡一下，最多一次' },
    elongation: { token: '——', hint: '一个词拖一下，不要整句拖' },
  },
};

const EVENT_ORDER: readonly RealismEventKind[] = ['filler', 'pause', 'repair', 'trailoff', 'repetition', 'elongation'];

/**
 * 生成本轮口语事件计划。
 *
 * @param input 角色、状态、场景与配额
 * @returns 确定性事件计划；风险轮 / 零配额返回空计划
 */
export function buildRealismEventPlan(input: {
  readonly role: VisitorVoiceRole;
  readonly state: RealismStateBand;
  readonly scene: RealismScene;
  readonly quotas: RealismEventQuotaSource;
}): RealismEventPlan {
  if (input.state === 'risk' || input.quotas.maxEvents <= 0) {
    return { maxEvents: 0, options: [] };
  }

  const tokens = ROLE_EVENT_TOKENS[input.role];
  const options: RealismEventOption[] = [];
  for (const kind of EVENT_ORDER) {
    const quota = input.quotas[kind];
    if (quota <= 0) continue;
    const candidate = tokens[kind];
    if (!candidate) continue;
    options.push({ kind, token: candidate.token, maxCount: quota, hint: candidate.hint });
  }

  // 场景当前只影响“是否走文字短句形态”，事件词表本身在三种场景通用。
  const optionCap = options.reduce((sum, option) => sum + option.maxCount, 0);
  return {
    maxEvents: Math.min(input.quotas.maxEvents, optionCap),
    options,
  };
}

/**
 * 把事件计划拼成 prompt 里的一行。
 *
 * R6: 传入 rhythm 时追加“停顿在哪里、有多长、改口在句中还是句缝、分句上限”的条件指令；
 * 不传 rhythm 时保持 R2 的原文案，供旧调用与回归逐字比对。
 *
 * @param plan 事件计划
 * @param rhythm 状态化节奏（可选）
 * @returns 空计划返回空串
 */
export function buildRealismEventPromptLine(plan: RealismEventPlan, rhythm?: RealismEventRhythm): string {
  if (plan.maxEvents <= 0 || plan.options.length === 0) return '';
  const options = plan.options.map((option) => `${option.hint}（「${option.token}」，最多 ${option.maxCount} 处）`).join('；');
  const base = `这一轮的口语痕迹候选：${options}。六类合计最多 ${plan.maxEvents} 处，按需取用，不必全用。`;
  return rhythm === undefined ? base : `${base}${rhythm.conditionDirective}`;
}
