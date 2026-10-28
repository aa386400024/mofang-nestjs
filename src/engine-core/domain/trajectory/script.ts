// V2026-10-28 治本 (WP3 · 引擎内核 · 轨迹剧本契约):
//   职责: 定义"会话轨迹控制"的全部**数据形状** —— 模式 / 剧本 / 幕 / 触发条件 /
//         行为目标 / 状态偏移 / 完成与异常 / 出参 trace, 并提供开工前的形状校验.
//   边界: 纯 TS, 零 @nestjs/* / typeorm, 不含任何 IO. 剧本是**纯对象**,
//         由 adapter 解析后注入 (内核不感知剧本存在哪), 游标与终态只在进程内存.
//
//   为什么剧本用 interface 而不是 class:
//     剧本是**数据**不是行为 —— 它要能被 JSON 序列化、跨进程传递、被 adapter
//     从 MySQL 行直接构造. 与内核既有风格 (BdiSnapshot / Intention / MemoryEntry)
//     完全一致: 数据形状用 interface, 行为用纯函数.
//
//   反双胞胎:
//     - **幕序 (order) 的"有效值"只有一处算法** (orderedTrajectoryNodes):
//       缺省取数组下标. 校验 / 选幕 / 运行时记账三处必须用同一份 —— 否则会出现
//       "校验说合法"与"推进时找到的不是同一幕"在同一份剧本上同时成立.
//     - 不把模式做成 enum: 与 WP2 的 MemoryRecallScope 同理 —— 它是纯控制流判别式,
//       字符串联合可让内核保持"零运行时导出", 整包搬走不必附带常量表.
//     - **不在类型上留"跳转"口子** (无 goto / next / branch): 本期是线性游标,
//       一旦类型允许跳转, 就会出现"剧本写了 goto 但内核不认"的静默失效 ——
//       静默失效比编译期报错危险得多.
//
//   如何验证:
//     1. npx tsc -p tsconfig.build.json --noEmit 0 错
//     2. test/engine-core/wp3-trajectory.spec.ts 覆盖校验分支与幕序解析

import type { BdiResistance } from '../bdi-snapshot';
import type { EmotionLabel, EmotionState } from '../emotion';
import { EngineCoreError, EngineErrorCode } from '../engine-errors';
import type { CounselorEventKind } from '../events/session-event';
import type { BehaviorStrategy } from '../intention';
import type { TransferenceState } from '../transference';

/**
 * 轨迹控制模式.
 *
 * - force_override  强覆盖: 标准化考核 / 伦理盲盒, 来访严格按幕推进, BDI 输出被替换;
 * - weighted_correct 修正: 专项训练包, 主线不偏但保留 BDI 灵活度, 数值加权混合;
 * - trigger         触发: 平时 BDI 自由运行, 走到该幕且满足条件才激活 (隐藏伦理坑 / 突发危机).
 */
export type TrajectoryMode = 'force_override' | 'weighted_correct' | 'trigger';

/** 合法模式清单 (校验与文档共用一份, 不在多处罗列字符串). */
const TRAJECTORY_MODES: readonly TrajectoryMode[] = ['force_override', 'weighted_correct', 'trigger'];

/**
 * 触发条件原子 (同一幕内各原子 AND; 跨原子 OR 用多幕表达).
 *
 * 未声明的原子**不参与判定** —— 不是"必须为空", 也不是"必须满足".
 */
export interface TrajectoryTrigger {
  /** 咨询师事件命中任一即满足 (复用 CounselorEventKind: empathy/judgment/boundary_cross/...). */
  readonly onEvents?: readonly CounselorEventKind[];
  /** 咨询师本轮文本小写子串命中任一即满足; 空白关键词跳过. */
  readonly onKeywords?: readonly string[];
  /** 到达该轮次 (turnIndex >= afterTurns) 即满足. */
  readonly afterTurns?: number;
  /** 快照谓词, 列出项全部满足即满足 (未列项不约束). */
  readonly state?: {
    readonly minTrust?: number;
    readonly maxTrust?: number;
    /** 三维阻抗均值 (verbal+depth+style)/3 的下界. */
    readonly minResistanceAgg?: number;
    /** 三维阻抗均值 (verbal+depth+style)/3 的上界. */
    readonly maxResistanceAgg?: number;
    /** 与当前 resolveEmotionLabel 结果相等. */
    readonly emotionLabel?: EmotionLabel;
  };
}

/**
 * 幕行为目标: 有值的字段参与合成, 缺省字段回退/透传 (按模式定).
 */
export interface TrajectoryNodeTarget {
  readonly strategy?: BehaviorStrategy;
  /** 显式给 label 沿用, 否则由双轴重算. */
  readonly emotion?: Partial<EmotionState>;
  readonly resistance?: Partial<BdiResistance>;
  readonly transference?: Partial<TransferenceState>;
  readonly forbiddenBehaviors?: readonly string[];
}

/**
 * 幕状态偏移量: 仅在「进入新幕那一轮」一次性增量叠加 (不是覆盖, 不重复滚).
 */
export interface SnapshotDelta {
  readonly trust?: number;
  readonly resistance?: Partial<BdiResistance>;
  readonly emotion?: { readonly valence?: number; readonly arousal?: number };
  readonly transference?: Partial<TransferenceState>;
}

/**
 * 单个幕 (线性序列中的一步).
 *
 * - order:   幕序, 缺省取数组下标; 全剧本内唯一, 游标按它单向推进;
 * - trigger: 进入/激活本幕的条件 (force 模式=推进条件; weighted/trigger 模式=激活条件);
 * - delta:   只在本幕被推进进入那一轮叠加一次; force 等待轮不重复叠加.
 */
export interface TrajectoryNode {
  readonly nodeId: string;
  /** 幕序 (缺省=数组下标), 唯一, 游标据此推进. */
  readonly order?: number;
  readonly trigger: TrajectoryTrigger;
  readonly target?: TrajectoryNodeTarget;
  readonly delta?: SnapshotDelta;
  /** 修正模式下本幕目标权重 w∈(0,1], 缺省 DEFAULT_CORRECT_WEIGHT=0.6; 强覆盖/触发忽略. */
  readonly correctWeight?: number;
  /** 激活后只保留给督导/WP5 的结构化参考要点, 不是台词, 不渲染. */
  readonly referenceNotes?: readonly string[];
}

/**
 * 正常完成判定: 条件命中即落 completed; 不自动关闭会话.
 */
export interface TrajectoryCompletion {
  readonly when: TrajectoryTrigger;
  readonly outcome: 'completed';
}

/**
 * 一份确定性剧本 (adapter 解析后注入, 内核不关心存储).
 */
export interface TrajectoryScript {
  readonly scriptId: string;
  readonly title: string;
  readonly mode: TrajectoryMode;
  /** 难度 1/2/3 (仅排序/展示, 不参与决策). */
  readonly difficulty: 1 | 2 | 3;
  /** 训练目标一句话 (观测用, 不口语). */
  readonly goal: string;
  /** 按序幕序列 (order 缺省=下标). */
  readonly nodes: readonly TrajectoryNode[];
  readonly completion: TrajectoryCompletion;
  /**
   * 全局异常分支: 每轮最先判定, 命中即 aborted 并停止推进 (如危机恶化 / 严重越界).
   * 省略=无异常分支.
   */
  readonly abort?: TrajectoryTrigger;
}

/**
 * 本轮轨迹观测块 (纯督导/WP5 观测, 不含口语).
 *
 * 口径: 每一项都描述**本轮**发生了什么 —— outcome 也是本轮事件,
 * 终态后的后续轮次不再写 outcome (会话已进入终态, 本轮没有新的终态事件).
 */
export interface TrajectoryTrace {
  readonly scriptId: string;
  readonly mode: TrajectoryMode;
  /** 本轮是否有幕被激活/施加. */
  readonly activated: boolean;
  /** 本轮实际处理的幕 id (等待轮也可能是当前幕; 无则省略). */
  readonly activeNodeId?: string;
  /** 本轮游标是否前进到下一幕. */
  readonly advanced: boolean;
  /** 处理后的游标 (下一个待进入幕的 order), 供督导看剧本走到哪. */
  readonly cursor: number;
  /** 已激活过的幕 id 清单 (含本轮), 供督导看推进轨迹. */
  readonly visitedNodeIds: readonly string[];
  /** 终态 (命中 completion.when / abort 时携带), 只写一次. */
  readonly outcome?: 'completed' | 'aborted';
}

/**
 * 带**有效幕序**的一幕 (order 已由 orderedTrajectoryNodes 解析).
 *
 * 为什么要这层包装: 幕序缺省取数组下标, 而"取下标"这件事必须只有一处实现.
 * 直接在各处写 `node.order ?? index` 的话, 校验用下标、推进用另一个下标,
 * 就会出现"校验说 order 唯一"但"推进时两幕撞在同一 order"的分裂.
 */
export interface OrderedTrajectoryNode {
  readonly node: TrajectoryNode;
  /** 有效幕序 (显式 order 优先, 缺省取数组下标). */
  readonly order: number;
}

/**
 * 解析剧本的幕序, 返回**按有效幕序升序**排列的幕列表.
 *
 * 幕序缺省取数组下标 (任务单 §6). 排序用 toSorted (ES2023 不可变排序) ——
 * 不就地改入参, 剧本是注入进来的共享对象, 就地排序会污染调用方的数据.
 *
 * @param script 剧本
 * @returns 按有效幕序升序的幕列表 (不修改入参)
 */
export function orderedTrajectoryNodes(script: TrajectoryScript): readonly OrderedTrajectoryNode[] {
  const nodes = isTrajectoryNodeArray(script.nodes) ? script.nodes : [];
  return nodes.map((node, index) => ({ node, order: node.order ?? index })).toSorted((a, b) => a.order - b.order);
}

/**
 * 判断值是否为幕数组.
 *
 * 为什么不直接用内置 `Array.isArray`: 它的类型守卫是 `arg is any[]` ——
 * 用在已声明类型的字段上会把类型收窄成 `any[]`, 元素随之变成 `any`,
 * 于是整条链路的类型安全被静默掏空 (而且 lint 报 unsafe assignment 才发现).
 * 自带守卫把类型守住, 运行期校验(是否为数组)照样做.
 *
 * @param value 待判断值
 * @returns 是否为幕数组
 */
function isTrajectoryNodeArray(value: unknown): value is readonly TrajectoryNode[] {
  return Array.isArray(value);
}

/**
 * 判断值是否为合法模式.
 *
 * @param value 待判断值
 * @returns 是否合法模式
 */
export function isTrajectoryMode(value: unknown): value is TrajectoryMode {
  return typeof value === 'string' && (TRAJECTORY_MODES as readonly string[]).includes(value);
}

/**
 * 开工前校验剧本形状; 非法抛 EngineCoreError(INVALID_INPUT), 供 openSession 复用.
 *
 * 校验项: scriptId 非空串; mode 合法; nodes 为数组 (可空); 每幕 nodeId 非空且
 * 有效幕序唯一; completion.when 存在.
 *
 * 不校验的: correctWeight 越界 —— 按任务单 §6 **clamp 不抛** (工程宽容,
 * 避免一条脏配置炸掉整场对练); 幕的 target/delta 数值越界同理, 由合成层的
 * clamp 兜住.
 *
 * @param script 待校验剧本
 * @throws EngineCoreError code=INVALID_INPUT 形状非法
 */
export function validateTrajectoryScript(script: TrajectoryScript): void {
  if (!script || typeof script !== 'object') {
    throw invalidTrajectory('validateTrajectoryScript: script 必须是对象');
  }
  if (typeof script.scriptId !== 'string' || script.scriptId.trim() === '') {
    throw invalidTrajectory('validateTrajectoryScript: scriptId 不能为空');
  }
  if (!isTrajectoryMode(script.mode)) {
    throw invalidTrajectory(`validateTrajectoryScript: mode 非法, 合法值=${TRAJECTORY_MODES.join('/')}`);
  }
  if (!isTrajectoryNodeArray(script.nodes)) {
    throw invalidTrajectory('validateTrajectoryScript: nodes 必须是数组');
  }
  const seenOrders = new Set<number>();
  for (const [index, node] of script.nodes.entries()) {
    if (!node || typeof node !== 'object') {
      throw invalidTrajectory('validateTrajectoryScript: 幕必须是对象');
    }
    if (typeof node.nodeId !== 'string' || node.nodeId.trim() === '') {
      throw invalidTrajectory('validateTrajectoryScript: 幕 nodeId 不能为空');
    }
    const order = node.order ?? index;
    if (seenOrders.has(order)) {
      throw invalidTrajectory(`validateTrajectoryScript: 幕 order 重复 = ${order}`);
    }
    seenOrders.add(order);
  }
  if (!script.completion || !script.completion.when || typeof script.completion.when !== 'object') {
    throw invalidTrajectory('validateTrajectoryScript: completion.when 不能为空');
  }
}

/** 抛非法剧本错误 (统一出口, 保证错误码与消息前缀一致). */
function invalidTrajectory(message: string): EngineCoreError {
  return new EngineCoreError(EngineErrorCode.INVALID_INPUT, message);
}
