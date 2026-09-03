import { BadgeId } from '../enums/badge-id.enum';
import { FragmentType } from '../enums/fragment-type.enum';

/**
 * 徽章解锁规则 — 纯函数, 跟数据层解耦.
 *
 * V4.0 §3.3 规则集:
 *   - FirstListen:        完成第一次呼吸练习 (任何 breathing 工具)
 *   - BreathingBeginner:  连续 3 天完成呼吸 (去重按 day)
 *   - ThoughtCatcher:     完成第一篇觉察日记 (act.thought-leaves.refactored)
 *   - GentleExplorer:     完成第一次分级暴露 (cbt.graduated-exposure 完成)
 *   - Companion:          完成第一次双人协同 (dual.exercise.completed)
 *   - IslandGardener:     小岛解锁 10 个元素 (island_elements unlocked 数 >= 10)
 *   - Collector:          累计收集 100 颗碎片 (SUM(delta > 0) >= 100)
 *   - BreathingArtist:    解锁 10 幅呼吸小画 (后续 breath_drawing 表, V4.0 暂用 0)
 *   - ForestGardener:     思维森林长出 10 棵树 (act.thought-leaves 完成 10 个重构)
 */

export interface BadgeRuleContext {
  readonly userId: string;
  /** 工具完成事件列表 (from practice/emergency/ companion sessions). */
  readonly toolCompletions: readonly { toolId: string; completedAt: Date; phase?: string }[];
  /** 已解锁元素数. */
  readonly unlockedElementCount: number;
  /** 已完成的 thought-leaves refactor 数. */
  readonly refactoredLeafCount: number;
  /** 总产出碎片数 (跨类型 sum delta>0). */
  readonly totalGrantedFragments: number;
  /** 呼吸小画数 (V4.0 暂用 0, 后续 breath_drawing 表出来后填). */
  readonly breathDrawingCount: number;
}

/** 单条规则的判定函数: 返回 true 表示满足解锁条件. */
export type BadgeJudge = (ctx: BadgeRuleContext) => boolean;

/**
 * 9 个徽章的判定规则 — 集中维护, 修改只动这里.
 */
export const BADGE_RULES: ReadonlyMap<BadgeId, BadgeJudge> = new Map([
  [BadgeId.FirstListen, (ctx) => ctx.toolCompletions.some((c) => c.toolId === 'emergency.4-4-8' || c.toolId === 'breathing.exercise')],

  [
    BadgeId.BreathingBeginner,
    (ctx) => {
      // 连续 3 天都有 breathing 完成
      const breathingDays = new Set(
        ctx.toolCompletions
          .filter((c) => c.toolId === 'emergency.4-4-8' || c.toolId === 'breathing.exercise')
          .map((c) => c.completedAt.toISOString().slice(0, 10)),
      );
      if (breathingDays.size < 3) return false;
      const sorted = [...breathingDays].toSorted((a: string, b: string) => a.localeCompare(b));
      for (let i = 0; i < sorted.length - 2; i++) {
        const a = new Date(sorted[i]);
        const b = new Date(sorted[i + 2]);
        const diffDays = (b.getTime() - a.getTime()) / 86_400_000;
        if (diffDays === 2) return true;
      }
      return false;
    },
  ],

  [BadgeId.ThoughtCatcher, (ctx) => ctx.toolCompletions.some((c) => c.toolId === 'act.thought-leaves' && c.phase === 'refactored')],

  [BadgeId.GentleExplorer, (ctx) => ctx.toolCompletions.some((c) => c.toolId === 'cbt.graduated-exposure')],

  [BadgeId.Companion, (ctx) => ctx.toolCompletions.some((c) => c.toolId.startsWith('dual.') || c.toolId.startsWith('companion.dual'))],

  [BadgeId.IslandGardener, (ctx) => ctx.unlockedElementCount >= 10],

  [BadgeId.Collector, (ctx) => ctx.totalGrantedFragments >= 100],

  [BadgeId.BreathingArtist, (ctx) => ctx.breathDrawingCount >= 10],

  [BadgeId.ForestGardener, (ctx) => ctx.refactoredLeafCount >= 10],
]);

/** 列出所有 BadgeId — 用在 reconcile 全量扫描. */
export const ALL_BADGE_IDS: readonly BadgeId[] = [
  BadgeId.FirstListen,
  BadgeId.BreathingBeginner,
  BadgeId.ThoughtCatcher,
  BadgeId.GentleExplorer,
  BadgeId.Companion,
  BadgeId.IslandGardener,
  BadgeId.Collector,
  BadgeId.BreathingArtist,
  BadgeId.ForestGardener,
];

/**
 * 给定 context, 返回应当被解锁的徽章全集.
 * 用法: const desired = judgeAll(ctx); 对比已有, 差集 = 本次新解锁.
 */
export function judgeAll(ctx: BadgeRuleContext): readonly BadgeId[] {
  const out: BadgeId[] = [];
  for (const id of ALL_BADGE_IDS) {
    const rule = BADGE_RULES.get(id);
    if (rule?.(ctx)) out.push(id);
  }
  return out;
}

/**
 * 产出规则 — 根据来源决定碎片类型和数量.
 *
 * V4.0 §3.2:
 *   - 急救工具完成: +1 温暖碎片
 *   - 双人练习完成: +2 温暖碎片 +2 平静气泡
 *   - 思维落叶重构: +2 星光粒子
 *   - 小怪兽驯服节点: +1 勇气结晶
 *   - 分级暴露完成: +1 勇气结晶 +1 思维镜片
 *   - 急救盲盒完成: +1 温暖碎片
 *   - 工具完成 (基础): +3 平静气泡
 *   - 深度工具 (有反思步骤): +2 平静气泡 +2 星光粒子
 */
export interface FragmentGrantSpec {
  type: FragmentType;
  delta: number;
  source: string;
}

export function resolveGrantsForSource(source: string, _meta?: Record<string, unknown>): readonly FragmentGrantSpec[] {
  switch (source) {
    case 'practice.tool.completed':
      return [{ type: FragmentType.Calm, delta: 3, source }];
    case 'practice.tool.completed.deep':
      return [
        { type: FragmentType.Calm, delta: 2, source },
        { type: FragmentType.Starlight, delta: 2, source },
      ];
    case 'emergency.tool.completed':
      return [{ type: FragmentType.Warmth, delta: 1, source }];
    case 'emergency.blindbox.completed':
      return [{ type: FragmentType.Warmth, delta: 1, source }];
    case 'dual.exercise.completed':
      return [
        { type: FragmentType.Warmth, delta: 2, source },
        { type: FragmentType.Calm, delta: 2, source },
      ];
    case 'act.thought-leaves.refactored':
      return [{ type: FragmentType.Starlight, delta: 2, source }];
    case 'genome-reshape.monster.tamed':
      return [{ type: FragmentType.Courage, delta: 1, source }];
    case 'cbt.exposure.completed':
      return [
        { type: FragmentType.Courage, delta: 1, source },
        { type: FragmentType.Thinking, delta: 1, source },
      ];
    case 'cbt.thought-record.completed':
      return [{ type: FragmentType.Thinking, delta: 2, source }];
    default:
      return [];
  }
}

/** 根据 toolKind 判断是不是"深度工具" (产出比基础多). */
export const DEEP_TOOL_IDS: ReadonlySet<string> = new Set([
  'act.thought-leaves',
  'cbt.thought-record',
  'act.values-clarification',
  'cbt.behavioral-activation',
  'genome-reshape.targeted',
]);
