// V2026-10-28 治本 (WP3 · 引擎内核 · 触发条件判定):
//   职责: 把一幕的 trigger (事件 / 关键词 / 轮次 / 快照谓词) 对照本轮上下文
//         判定为布尔值; 同一幕内各原子 **AND** 组合.
//   边界: 纯函数, 无状态, 无 IO, 无随机. 不读运行时, 不改入参.
//
//   三态原子语义 (为什么不是简单的 true/false):
//     声明了且有内容 → 满足 / 不满足;
//     声明了但**没有内容** (空数组 / 全空白关键词) → **跳过** (既不满足也不阻断).
//   跳过而不是"判为不满足"的理由: 一条脏配置 (空白关键词) 不该让整幕永远
//   触发不了 —— 跳过让其余原子照常决定, 而"永远不触发"会让剧本静默失效.
//   全部原子都被跳过时, 触发条件视为**空真** (无约束 = 无条件满足).
//
//   反双胞胎:
//     - **不做 OR 组合**: OR 由多幕表达 (任务单 M6). 引擎里同时存在 AND 与 OR
//       两套组合语义时, "这条 trigger 到底怎么算"就没有唯一答案.
//     - 不自己判情绪标签: 直接比 snapshot.emotion.label —— 标签由 WP1 的
//       resolveEmotionLabel 唯一决定, 这里再写一套判定就是双胞胎.
//     - 不引入正则: 关键词是**小写子串**, 不是模式匹配. 正则会让人写出
//       灾难性回溯的剧本配置, 且匹配语义随引擎版本漂移.
//
//   如何验证:
//     1. npx tsc -p tsconfig.build.json --noEmit 0 错
//     2. test/engine-core/wp3-trajectory.spec.ts 覆盖四类原子与 AND 组合

import type { BdiSnapshot } from '../../domain/bdi-snapshot';
import type { SessionEvent } from '../../domain/events/session-event';
import type { TrajectoryTrigger } from '../../domain/trajectory/script';

/**
 * 本轮匹配上下文 (由 in-memory session 喂入, 纯函数不读运行时).
 */
export interface MatchContext {
  /** 本轮分类出的标准会话事件. */
  readonly events: readonly SessionEvent[];
  /** 咨询师本轮文本 (小写化在函数内做). */
  readonly userText: string;
  /**
   * 本轮轮次号 (**从 1 起**), 与 EngineTurnOutput.turnIndex 同口径.
   *
   * 用 1 起而不是 0 起: 剧本作者写 `afterTurns: 3` 想表达的是"第三轮开始",
   * 与会话出参里对外可见的轮次号对得上, 不必在心里换算一次.
   */
  readonly turnIndex: number;
  /** 本轮状态迁移后的快照 (判定 state 谓词用). */
  readonly snapshot: BdiSnapshot;
}

/** 单个原子的三态判定结果. */
type AtomOutcome = 'satisfied' | 'unsatisfied' | 'skipped';

/**
 * 单条触发条件对照上下文判布尔 (AND 组合); 纯函数, 无 IO.
 *
 * @param trigger 触发条件
 * @param ctx 本轮上下文
 * @returns 是否命中
 */
export function evaluateTrigger(trigger: TrajectoryTrigger, ctx: MatchContext): boolean {
  if (!trigger || typeof trigger !== 'object') return false;

  const outcomes: AtomOutcome[] = [
    evaluateEvents(trigger.onEvents, ctx),
    evaluateKeywords(trigger.onKeywords, ctx.userText),
    evaluateAfterTurns(trigger.afterTurns, ctx.turnIndex),
    evaluateState(trigger.state, ctx.snapshot),
  ];
  const effective = outcomes.filter((outcome) => outcome !== 'skipped');
  // 全部原子都被跳过 = 无有效约束 = 空真 (无条件幕).
  if (effective.length === 0) return true;
  return effective.every((outcome) => outcome === 'satisfied');
}

/** 事件原子: 本轮事件 kind 与列表有交集即满足. */
function evaluateEvents(list: readonly SessionEvent['kind'][] | undefined, ctx: MatchContext): AtomOutcome {
  if (!list || list.length === 0) return 'skipped';
  const kinds = new Set(list);
  return ctx.events.some((event) => kinds.has(event.kind)) ? 'satisfied' : 'unsatisfied';
}

/** 关键词原子: 文本小写后包含任一关键词即满足; 空白关键词跳过. */
function evaluateKeywords(list: readonly string[] | undefined, userText: string): AtomOutcome {
  if (!list || list.length === 0) return 'skipped';
  const keywords = list.map((keyword) => keyword.trim().toLowerCase()).filter((keyword) => keyword.length > 0);
  if (keywords.length === 0) return 'skipped';
  const text = userText.toLowerCase();
  return keywords.some((keyword) => text.includes(keyword)) ? 'satisfied' : 'unsatisfied';
}

/** 轮次原子: 轮次号达到阈值即满足. */
function evaluateAfterTurns(afterTurns: number | undefined, turnIndex: number): AtomOutcome {
  if (afterTurns === undefined) return 'skipped';
  if (!Number.isFinite(afterTurns)) return 'unsatisfied';
  return turnIndex >= afterTurns ? 'satisfied' : 'unsatisfied';
}

/** 快照谓词原子: 列出的子项全部满足即满足. */
function evaluateState(state: TrajectoryTrigger['state'] | undefined, snapshot: BdiSnapshot): AtomOutcome {
  if (!state) return 'skipped';

  const checks: AtomOutcome[] = [];
  if (state.minTrust !== undefined || state.maxTrust !== undefined) {
    checks.push(evaluateRange(snapshot.trust, state.minTrust, state.maxTrust));
  }
  if (state.minResistanceAgg !== undefined || state.maxResistanceAgg !== undefined) {
    const aggregate = (snapshot.resistance.verbal + snapshot.resistance.depth + snapshot.resistance.style) / 3;
    checks.push(evaluateRange(aggregate, state.minResistanceAgg, state.maxResistanceAgg));
  }
  if (state.emotionLabel !== undefined) {
    checks.push(snapshot.emotion.label === state.emotionLabel ? 'satisfied' : 'unsatisfied');
  }
  if (checks.length === 0) return 'skipped';
  return checks.every((check) => check === 'satisfied') ? 'satisfied' : 'unsatisfied';
}

/**
 * 闭区间判定.
 *
 * 区间倒挂 (min > max) 判为**不满足** —— 安全方向是"不触发/不推进":
 * 一条写反的配置若被当成满足, 会让剧本在不该推进的轮次推进, 比"永远不触发"危险.
 */
function evaluateRange(value: number, min?: number, max?: number): AtomOutcome {
  if (min !== undefined && !Number.isFinite(min)) return 'unsatisfied';
  if (max !== undefined && !Number.isFinite(max)) return 'unsatisfied';
  if (min !== undefined && max !== undefined && min > max) return 'unsatisfied';
  if (min !== undefined && value < min) return 'unsatisfied';
  if (max !== undefined && value > max) return 'unsatisfied';
  return 'satisfied';
}
