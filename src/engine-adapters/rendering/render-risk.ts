// V2026-10-29 治本 (WP9-C · B 层 · 风险信号与渲染规格扩展):
//   职责: 定义**适配层**的风险信号契约 (本轮是否带危机信号 / 什么等级),
//         以及在内核 `RenderSpec` 之上追加该信号的**扩展规格**形状.
//   边界: 纯类型 + 纯函数, 零 @nestjs / 零 IO / 零网络 / 零 prompt.
//
//   为什么用"扩展规格"而不是直接改内核 `RenderSpec` (本期红线: 内核整树零改动):
//     风险信号是**渲染执行侧的路由输入** —— 它决定"这轮用多深的思考 / prompt 要不要
//     加安全护栏 / 要不要给督导推提示", 不是内核决策的一部分 (内核只判定, 不路由).
//     把它塞进内核 RenderSpec 等于让内核知道"下游怎么用我的判定", 违反内核第 0 原则.
//
//   为什么"扩展"对既有调用方零破坏:
//     `AdaptiveRenderSpec` 只是**多一个可选字段**, 所以任何 `RenderSpec` 依然是合法的
//     `AdaptiveRenderSpec` —— 既有单测 / 既有调用方一行不用改.
//
//   反双胞胎:
//     - 不在这里另写一套危机词典: 风险判定走内核 WP4 的 `RiskProbePort` + 规则层,
//       本文件只承载"判定结果 → 渲染参数"的**路由**.
//     - 不把内核的 SafetyLevel 直接当路由档: 内核三级 (pass/warn/block) 表达的是
//       "要不要拦", 而渲染路由要的是"想多深" —— 两者语义不同, 映射集中在本文件一处.
//
//   如何验证:
//     1. npx tsc -p tsconfig.build.json --noEmit 0 错
//     2. test/engine-adapters/wp9c-render-risk.spec.ts 覆盖等级映射与思考强度升级

import type { RenderSpec, SafetyLevel, VisitorRiskCategory } from '../../engine-core';

/**
 * 渲染路由用的风险等级 (适配层口径).
 *
 * 与内核 `SafetyLevel` 的关系:
 *   - `none`  = 本轮没有危机信号 (正常轮);
 *   - `medium` = 有危机信号但未到"行动层" (意念 / 探索 / 轻中度) → 思考抬到 medium;
 *   - `high`   = 行动层 (计划 / 准备 / 已发生 / 伤人) → 思考抬到 high.
 *
 * 为什么不直接复用内核的 pass/warn/block:
 *   内核等级回答"要不要拦", 渲染路由回答"要想多深". warn 既可能是"咨询师过早给建议"
 *   (专业性问题, 与危机无关), 也可能是"来访流露轻中度自杀意念" (危机信号) ——
 *   同一个等级对应两种完全不同的处置, 直接复用会把专业性提示也升级成危机路由.
 */
export type RenderRiskLevel = 'none' | 'medium' | 'high';

/**
 * 本轮风险信号 (内核判定结果 → 渲染路由输入).
 */
export interface RenderRiskSignal {
  /** 风险档位. */
  readonly level: RenderRiskLevel;
  /** 命中类别 (内核 SafetyCategory 口径, 供日志与督导提示定位). */
  readonly categories: readonly string[];
  /** 判定来源 (rule / probe / rule+probe). */
  readonly source: string;
}

/**
 * 适配层扩展的渲染规格 = 内核 RenderSpec + 适配层路由输入.
 */
export interface AdaptiveRenderSpec extends RenderSpec {
  /** 本轮风险信号 (缺省 = 无风险, 走常规渲染路由). */
  readonly riskSignal?: RenderRiskSignal;
  /** 角色代号 (仅供 dev 调试日志; **不进 prompt**, 模型不该看见自己的角色名). */
  readonly characterLabel?: string;
}

/**
 * 内核安全等级 + 危机类别 → 渲染风险档位.
 *
 * 判定口径 (为什么要求"必须有危机类别"):
 *   内核 warn 级有两类来源 —— 咨询师侧的专业性违规 (过早给建议 / 价值审判) 与
 *   来访侧的危机意念. 只有后者该触发"加思考 + 推督导提示", 前者不该 (那是督导的
 *   事后复盘项, 不是本轮的危机路由). 所以: **有危机类别才升级**.
 *
 * @param level 内核安全等级
 * @param categories 命中类别
 * @returns 渲染风险档位
 */
export function resolveRiskLevel(level: SafetyLevel | undefined, categories: readonly string[] | undefined): RenderRiskLevel {
  if (!level || level === 'pass') return 'none';
  const crisis = (categories ?? []).filter(isCrisisCategory);
  if (crisis.length === 0) return 'none';
  return level === 'block' ? 'high' : 'medium';
}

/**
 * 危机类别清单 (内核 PsyGUARD 11 类里的危机子集, 排除 'neutral').
 *
 * 单一真相: 探测实现 (装配层) 与渲染路由 (本文件) 都用这一份 —— 两处各列一份,
 * 迟早出现"探测判了 crisis, 路由却当成 neutral"这种静默漏路由.
 */
export const CRISIS_RISK_CATEGORIES: readonly VisitorRiskCategory[] = [
  'suicide_attempt',
  'suicide_plan',
  'suicide_preparation',
  'active_ideation',
  'self_harm_behavior',
  'passive_ideation',
  'suicide_exploration',
  'self_harm_ideation',
  'aggression_others',
  'aggression_self',
];

/**
 * 危机类别查表 (字符串 → 判定).
 */
const CRISIS_CATEGORY_SET: ReadonlySet<string> = new Set(CRISIS_RISK_CATEGORIES);

/**
 * 是否危机类别 (非危机 → 不触发危机路由).
 */
export function isCrisisCategory(category: string): boolean {
  return CRISIS_CATEGORY_SET.has(category);
}
