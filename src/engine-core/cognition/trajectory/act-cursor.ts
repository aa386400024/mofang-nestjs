// V2026-10-28 治本 (WP3 · 引擎内核 · 线性游标推进):
//   职责: 持有当前游标, 按模式决定「本轮激活哪一幕、游标是否前进、是否进入异常分支」,
//         输出 ActPlan; 单向推进, 不跳幕, 不回退.
//   边界: 纯函数, 无状态, 无 IO, 无随机. 不改入参 (脚本与游标都不被就地修改).
//
//   游标语义:
//     cursor = **下一个待进入幕**的有效 order, 初始 0, 只增不减.
//     幕序缺省取数组下标 (有效值由 orderedTrajectoryNodes 唯一计算).
//
//   三种模式的选幕差异 (模式是"怎么合成", 选幕是公共骨架 —— 任务单 M2):
//     force_override   只看 order === cursor 的当前幕; 条件不满足就**停在该幕等待**,
//                      持续施加其 target 基调, 但不叠加 delta.
//     weighted_correct 只在 order >= cursor 的幕里匹配, 取**升序首个命中**;
//     trigger          同上. 两者选幕逻辑完全一致, 差别只在合成方式 (见 trajectory-applier).
//
//   为什么"跳过中间的幕"在 weighted/trigger 下是允许的:
//     这两类模式本就是"条件触发", 命中哪一幕取决于来访行为 —— 来访没按剧本走,
//     剧本就不该硬按. 但一旦命中, 游标直接落到该幕之后 (§5.2), 前面的幕被关闭,
//     绝不回头 —— 否则同一幕会被反复激活, delta 反复滚.
//
//   反双胞胎:
//     - **不自己算幕序**: 全部走 orderedTrajectoryNodes, 与校验层同一份算法.
//     - 不把"选幕"与"合成"混在一起: 本文件只回答"哪一幕", 怎么合并由
//       trajectory-applier 回答. 两件事耦合 = 换一种模式要读两套逻辑.
//     - 不就地排序脚本的 nodes: 剧本是调用方注入的共享对象, 就地排序会污染它.
//
//   如何验证:
//     1. npx tsc -p tsconfig.build.json --noEmit 0 错
//     2. test/engine-core/wp3-trajectory.spec.ts 覆盖步进/等待/不跳幕/abort 优先

import { evaluateTrigger, type MatchContext } from './trigger-evaluate';
import type { TrajectoryNode, TrajectoryScript } from '../../domain/trajectory/script';
import { orderedTrajectoryNodes } from '../../domain/trajectory/script';

/**
 * 推进器本轮决策结果.
 */
export interface ActPlan {
  /** 本轮要合成的幕; 无 (trigger/weighted 未命中、abort、越过末幕) 时为 null → 透传 BDI. */
  readonly node: TrajectoryNode | null;
  /** 是否进入新幕 (true 时叠加 delta; force 等待轮为 false, 不重复叠加). */
  readonly enterNewAct: boolean;
  /** 推进后的游标 (下一幕 order); 未前进则等于入参 cursor. */
  readonly nextCursor: number;
  /** 本轮是否命中全局异常分支. */
  readonly aborted: boolean;
}

/**
 * 线性游标推进 (纯函数, 不改入参, 无随机).
 *
 * @param script 剧本
 * @param cursor 当前游标 (下一个待进入幕的 order, 初始 0)
 * @param ctx 本轮上下文
 * @param activatedOrders 已激活过的幕 order 集合 (观测/去重)
 * @returns 本轮决策结果
 */
export function planAct(script: TrajectoryScript, cursor: number, ctx: MatchContext, activatedOrders: ReadonlySet<number>): ActPlan {
  // 1. 全局异常分支最先判: 命中即终止, 本轮不推进、不叠加.
  if (script.abort && evaluateTrigger(script.abort, ctx)) {
    return { node: null, enterNewAct: false, nextCursor: cursor, aborted: true };
  }

  const ordered = orderedTrajectoryNodes(script);
  if (script.mode === 'force_override') {
    return planForcedAct(ordered, cursor, ctx, activatedOrders);
  }
  return planMatchedAct(ordered, cursor, ctx, activatedOrders);
}

/**
 * 强覆盖模式的选幕: 只看当前幕 (order === cursor).
 *
 * 条件不满足 → 停在该幕等待: target 基调每轮持续施加, 但 delta **不叠加**
 * (等待轮重复叠加会把信任/阻抗滚高, 这是 M5 要防的事).
 */
function planForcedAct(
  ordered: readonly { readonly node: TrajectoryNode; readonly order: number }[],
  cursor: number,
  ctx: MatchContext,
  activatedOrders: ReadonlySet<number>,
): ActPlan {
  const current = ordered.find((item) => item.order === cursor);
  // 游标已越过末幕: 透传 BDI.
  if (!current) return passthrough(cursor);
  // 防御: 已进入过的幕不再进入. 游标单调保证这条不可达, 但契约层不假设"不可能".
  if (activatedOrders.has(current.order)) return passthrough(cursor);
  if (!evaluateTrigger(current.node.trigger, ctx)) {
    return { node: current.node, enterNewAct: false, nextCursor: cursor, aborted: false };
  }
  return { node: current.node, enterNewAct: true, nextCursor: nextCursorAfter(ordered, current.order), aborted: false };
}

/**
 * 修正/触发模式的选幕: 在 order >= cursor 的幕里取**升序首个命中**.
 *
 * 命中即把游标推到该幕之后 —— 前面的幕被关闭, 不回头.
 */
function planMatchedAct(
  ordered: readonly { readonly node: TrajectoryNode; readonly order: number }[],
  cursor: number,
  ctx: MatchContext,
  activatedOrders: ReadonlySet<number>,
): ActPlan {
  const matched = ordered.find(
    (item) => item.order >= cursor && !activatedOrders.has(item.order) && evaluateTrigger(item.node.trigger, ctx),
  );
  if (!matched) return passthrough(cursor);
  return { node: matched.node, enterNewAct: true, nextCursor: nextCursorAfter(ordered, matched.order), aborted: false };
}

/**
 * 某幕之后的下一个游标位置.
 *
 * 取"下一个幕的实际 order"; 没有下一幕时取 order+1.
 * 幕序连续 (0,1,2…) 时本函数等价于 `order + 1`; 幕序稀疏 (0,5,9…) 时它仍指向
 * 真正的下一幕 —— 写死 `+1` 会让稀疏幕序的剧本在第一幕之后就永远推进不动.
 */
function nextCursorAfter(ordered: readonly { readonly order: number }[], order: number): number {
  const next = ordered.find((item) => item.order > order);
  return next ? next.order : order + 1;
}

/** 透传 BDI 的空计划 (不推进、不激活). */
function passthrough(cursor: number): ActPlan {
  return { node: null, enterNewAct: false, nextCursor: cursor, aborted: false };
}
