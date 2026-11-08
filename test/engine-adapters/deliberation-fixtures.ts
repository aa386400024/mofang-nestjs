// V2026-11-08 (Phase2.5 WP-A · 审议输入最小化): 审议入参的**共享测试夹具**.
//
//   为什么要有这个文件 (而不是每个 spec 各写一份):
//     WP-A 把审议入参从"四个原文字段"换成了"一个结构化输入" —— 十来个既有 spec
//     都要跟着改. 各写一份 = 十来份夹具 = 十来份会漂移的真相.
//     本文件是**唯一**的夹具出口, 而且它用的是**真实的** `buildDeliberationInput`
//     (不是手搓一份假结构) —— 于是"夹具"本身也在测真代码.
//
//   ⚠️ 它**不是** spec (文件名不含 `.spec`) —— vitest 不会把它当测试收集.
//
//   ⚠️ 风险等级**不做手工覆盖**: 高风险轮次用**真的**内核判定构造
//     (block 级安全判定 / 危机类别的 warn 判定) —— 这样"风险等级怎么算出来的"
//     也在测试覆盖范围内, 而不是被夹具偷偷写死.

import { buildDeliberationInput } from '../../src/engine-adapters/deliberation/deliberation-input.js';
import type { DeliberationInput } from '../../src/engine-adapters/deliberation/deliberation-types.js';
import { createEmptyBdiSnapshot } from '../../src/engine-core/index.js';
import type { BehaviorStrategy, BdiSnapshot, CounselorEventKind, SafetyVerdict } from '../../src/engine-core/index.js';

/** 夹具的可调项. */
export interface TestStructuredInputOptions {
  /** 本轮咨询师发言 (只用于事件分类兜底; 不进结构化结果). */
  readonly counselorText?: string;
  /** 本轮来访的渲染文本 (只用于来访侧安全规则判定; 不进结构化结果). */
  readonly visitorText?: string;
  /** 角色简述 (角色种子元数据). */
  readonly characterBrief?: string;
  /** 内核本轮事件分类 (权威; 缺省 = 走规则分类器兜底). */
  readonly kernelEvents?: readonly CounselorEventKind[];
  /** 本轮开始时的快照 (缺省 = 中性空快照). */
  readonly stateBefore?: BdiSnapshot;
  /** 本轮结束后的快照 (缺省 = 与开始时相同 = 状态没动). */
  readonly stateAfter?: BdiSnapshot;
  /** 咨询师侧安全判定 (内核本轮判定). */
  readonly counselorVerdict?: SafetyVerdict;
  /** 本轮规则算子选中的行为策略. */
  readonly ruleStrategy?: BehaviorStrategy;
}

/**
 * 造一份审议的结构化输入 (走**真实**的装配函数).
 *
 * @param options 可调项
 * @returns 结构化输入
 */
export function buildTestStructuredInput(options: TestStructuredInputOptions = {}): DeliberationInput {
  const stateBefore = options.stateBefore ?? createEmptyBdiSnapshot();
  const stateAfter = options.stateAfter ?? stateBefore;
  return buildDeliberationInput({
    ...(options.kernelEvents ? { kernelEvents: options.kernelEvents } : {}),
    counselorText: options.counselorText ?? '',
    stateBefore,
    stateAfter,
    characterBrief: options.characterBrief ?? '',
    ...(options.counselorVerdict ? { counselorVerdict: options.counselorVerdict } : {}),
    visitorText: options.visitorText ?? '',
    ruleStrategy: options.ruleStrategy ?? 'recounting',
  });
}

/**
 * 造一个 block 级的咨询师侧安全判定 —— 用于测"高风险轮次永远不跑 LLM 审议".
 *
 * @param categories 命中的类别 (缺省 = 自杀指导)
 * @returns 内核口径的安全判定
 */
export function buildBlockCounselorVerdict(categories: readonly string[] = ['suicide_coaching']): SafetyVerdict {
  return {
    level: 'block',
    side: 'counselor_input',
    categories: categories as SafetyVerdict['categories'],
    matchedRules: ['counselor.test'],
    source: 'rule',
  };
}
