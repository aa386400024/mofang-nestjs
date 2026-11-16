// V2026-11-05 治本 (WP30 · 调试器「剧本轨迹」视图):
//   职责: 把内核的轨迹观测块 (`TrajectoryTrace`) 翻译成调试器面板要的**视图形状** ——
//         剧本 id / 名称 / 走过的路径 / 已触发节点 (带类型与触发时刻).
//   边界: 纯函数; 零 IO / 零 NestJS / 零 prompt. 只读输入, 不改入参.
//
//   为什么需要这一层 (不能把内核出参直接丢给前端):
//     内核 `TrajectoryTrace` 说的是**引擎语义** —— "本轮处理了哪一幕 / 游标走到哪 /
//     访问过哪些幕". 调试器面板要说的是**督导语义** —— "这场戏走到哪了 / 每一幕叫什么 /
//     什么时候触发的". 两者字段名几乎不重叠:
//       · 内核只有 `nodeId` (+ `visitedNodeIds`), **没有 label / 没有触发时刻**;
//       · 触发时刻只存在于**逐轮留痕**里 (哪一轮第一次把这个 nodeId 放进 visited 列表);
//       · 剧本标题 (`title`) 在剧本资产里 (`ETHICAL_TRAJECTORY_SCRIPT_MAP`), 不在 trace 里.
//     于是这层做三件事: ① 找剧本 → 补标题与幕序; ② 回查逐轮留痕 → 补触发时刻;
//     ③ 按幕序给节点派**展示类型** (前端面板只有 4 种图标).
//
//   反双胞胎:
//     - **不改内核出参的形状**: 内核 `TrajectoryTrace` 是规范, 这里只做单向翻译,
//       不在适配层造第二份"轨迹 DTO"给内核用.
//     - 不在这里查 DB / 不在这里读剧本表: 剧本是**纯静态常量** (直接 import 索引表),
//       留痕是 controller 已经读好的数组 —— 这一层只做纯计算.
//     - 不编造触发时刻: 找不到对应轮次就是 `null` (前端显示 '—'), 不用第一轮的时间顶替.
//
//   映射口径 (登记在 WP30 交付记录 §偏差 B2):
//     · 节点**类型**按**幕序**派 (order 0/1/2/3 → entry/crisis/branch/exit) ——
//       用幕序而不是用 nodeId 后缀, 是因为 10 个伦理盲盒里第 2 幕有两个后缀
//       (`_event` 与危机剧本的 `_signal`), 按后缀会漏掉一个剧本.
//     · 节点**名称**按**后缀**派 (`_free`/`_event`/`_signal`/`_expand`/`_settle`) ——
//       名字要的是"这一幕干什么", 后缀才是语义; 认不出就退回 nodeId (不编).
//
//   验证: npx vitest run test/admin-debug/wp30-admin-real-api.spec.ts
//   时间戳: 2026-11-05 GMT+8

import type { TurnTrace } from './trace-recorder.service.js';
import { ETHICAL_TRAJECTORY_SCRIPT_MAP } from '../engine-adapters/wiring/trajectory/ethical-scripts.js';

/**
 * 调试面板的节点类型 (前端 `TrajectoryPanel.vue` 只有 4 种图标).
 *
 * - entry   —— 开场 (●, 绿)
 * - crisis  —— 冲突点 (▲, 红)
 * - branch  —— 分支/展开 (◆, 强调色)
 * - exit    —— 收束 (■, 灰)
 */
export type AdminTrajectoryNodeType = 'entry' | 'branch' | 'crisis' | 'exit';

/**
 * 一个已触发的节点 (面板上的一行).
 */
export interface AdminTrajectoryNode {
  /** 幕 id (内核 `nodeId`). */
  readonly nodeId: string;
  /** 幕的可读名称 (由后缀派生; 认不出时退回 nodeId). */
  readonly label: string;
  /** 展示类型 (由幕序派生). */
  readonly type: AdminTrajectoryNodeType;
  /** 首次触发时刻 (ISO); 找不到对应轮次 → null. */
  readonly triggeredAt: string | null;
  /** 该幕的督导要点首条 (可选; 没有就整个字段不出现). */
  readonly description?: string;
}

/**
 * 一场会话的剧本轨迹视图 (前端 `TrajectoryState` 形状).
 */
export interface AdminTrajectoryState {
  readonly scriptId: string;
  readonly scriptName: string;
  /** 当前所在幕 (内核 `activeNodeId`); 没有 → null. */
  readonly currentNode: string | null;
  /** 已走过的幕 id 路径 (内核 `visitedNodeIds`). */
  readonly path: readonly string[];
  /** 已触发的节点 (按 path 顺序). */
  readonly triggered: readonly AdminTrajectoryNode[];
}

/**
 * 幕序 → 展示类型.
 *
 * 为什么按幕序: 10 个伦理盲盒的幕结构是**同一套** (自由 / 事件 / 展开 / 收束),
 * 幕序天然对应叙事弧 (开场 → 冲突 → 展开 → 收束); 而幕 id 后缀在第 2 幕上分叉
 * (`_event` 与危机剧本的 `_signal`), 按后缀派类型会漏掉一个剧本.
 *
 * 超出 4 幕的剧本 (将来新增) 一律归 'branch' —— 它是"中间的一步", 不硬套进
 * 开场/冲突/收束三个语义位里.
 */
const NODE_TYPE_BY_ORDER: Readonly<Record<number, AdminTrajectoryNodeType>> = {
  0: 'entry',
  1: 'crisis',
  2: 'branch',
  3: 'exit',
};

/**
 * 幕 id 后缀 → 可读名称.
 *
 * 为什么只认这 5 个后缀: 它们是 10 个伦理盲盒**实际在用**的幕后缀
 * (危机剧本的第 2 幕用 `_signal`, 其余用 `_event`). 认不出就退回 nodeId ——
 * 编一个名字出来比显示 nodeId 更糟 (编的名字会被当成剧本真义).
 */
const NODE_LABEL_BY_SUFFIX: Readonly<Record<string, string>> = {
  _free: '自由开场',
  _event: '伦理事件',
  _signal: '危机信号',
  _expand: '事件展开',
  _settle: '收束',
};

/**
 * 由逐轮留痕构造剧本轨迹视图.
 *
 * @param traces 本场逐轮调试快照 (按轮次顺序)
 * @returns 轨迹视图; 本场**没有剧本观测** → null (前端不渲染轨迹面板)
 */
export function buildAdminTrajectoryState(traces: readonly TurnTrace[]): AdminTrajectoryState | null {
  // 只看带轨迹观测的轮次 —— 没有剧本的会话 (BDI 自由运行) 整场都没有这一项.
  const observed = traces.filter(
    (trace): trace is TurnTrace & { readonly trajectoryTrace: NonNullable<TurnTrace['trajectoryTrace']> } =>
      trace.trajectoryTrace !== undefined,
  );
  if (observed.length === 0) return null;

  // 末轮的状态 = 这场戏当前走到哪 (前面几轮的状态是历史, 不是现状).
  const latest = observed.at(-1)!.trajectoryTrace;
  const script = ETHICAL_TRAJECTORY_SCRIPT_MAP[latest.scriptId];
  const visited = latest.visitedNodeIds ?? [];

  const triggered = visited.map((nodeId) => {
    const node = script?.nodes.find((candidate) => candidate.nodeId === nodeId);
    // 幕序缺省取数组下标 (与内核 `orderedTrajectoryNodes` 同款口径); 找不到这一幕 → -1.
    const order = node ? (node.order ?? script?.nodes.indexOf(node) ?? -1) : -1;
    const firstSeen = observed.find((trace) => (trace.trajectoryTrace.visitedNodeIds ?? []).includes(nodeId));
    const description = node?.referenceNotes?.[0];
    return {
      nodeId,
      label: deriveNodeLabel(nodeId),
      type: deriveNodeType(order),
      triggeredAt: firstSeen?.ts ?? null,
      ...(description ? { description } : {}),
    };
  });

  return {
    scriptId: latest.scriptId,
    scriptName: script?.title ?? latest.scriptId,
    currentNode: latest.activeNodeId ?? null,
    path: [...visited],
    triggered,
  };
}

/**
 * 派幕的可读名称 (按 nodeId 后缀; 认不出退回 nodeId).
 *
 * @param nodeId 幕 id
 * @returns 可读名称
 */
function deriveNodeLabel(nodeId: string): string {
  for (const [suffix, label] of Object.entries(NODE_LABEL_BY_SUFFIX)) {
    if (nodeId.endsWith(suffix)) return label;
  }
  return nodeId;
}

/**
 * 派幕的展示类型 (按幕序; 超出 4 幕归 'branch').
 *
 * @param order 有效幕序 (缺省取数组下标; -1 = 剧本里没有这一幕)
 * @returns 展示类型
 */
function deriveNodeType(order: number): AdminTrajectoryNodeType {
  return NODE_TYPE_BY_ORDER[order] ?? 'branch';
}
