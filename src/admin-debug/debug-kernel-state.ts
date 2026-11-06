// V2026-11-06 治本 (WP38 补做 · 调试会话恢复 · 内核状态快照):
//   职责: 定义调试会话的「内核状态快照」形状, 并把持久化文件里的快照**回灌**进内核.
//   边界: 只做「快照形状 + 回灌」; 不做会话编排 (那是 `DebugSessionService` 的事).
//
//   为什么快照要落**文件** (而不是只靠 Redis):
//     · Redis 形态是**部署选择** (`ENGINE_BDI_STATE_STORE`): 缺省就是内存版 ——
//       进程一重启状态全丢, 只靠 Redis 恢复不了"默认部署";
//     · 调试会话本来就有自己的 JSON 文件 (对话 + trace), 把内核快照放进同一份文件,
//       恢复能力就**不依赖任何额外基础设施** —— 把文件拷到另一台机器也能恢复;
//     · 文件已有"每轮都写"的纪律 (中途崩溃不丢), 快照跟着每轮写, 口径一致.
//
//   三块内容 (与"内核句柄里会丢的东西"一一对应):
//     ① BDI 快照 —— 信任 / 安全感 / 纽带 / 情绪 / 阻抗. 恢复它 = "从最后一轮继续"的核心.
//     ② 记忆条目 —— 引擎写过的工作记忆 (咨询师半边 + 来访者半边).
//        恢复它 = 摘要 / 收尾服务还能看到重启前的那些轮次.
//     ③ 轨迹节点 —— 剧本走到哪一幕. 调试会话目前**不注入剧本** → 恒为 null;
//        字段留着, 是为了将来接剧本时不必再改快照格式.
//
//   反双胞胎:
//     - 不自己算 BDI: 快照是内核出参, 这里只做搬运与形状声明;
//     - 不给记忆造两份 id 规则: id 由**轮次 + 角色**唯一确定 (重复恢复幂等);
//     - 不静默吞掉回灌失败: 回灌失败 = 恢复出来的状态对不上, 必须让调用方知道.

import { Inject, Injectable, Logger } from '@nestjs/common';

import { VISITOR_MEMORY_IMPORTANCE } from '../engine-adapters/rendering/turn-render-orchestrator.js';
import { ENGINE_BDI_STATE_REPOSITORY, ENGINE_MEMORY_STORE } from '../engine-adapters/wiring/engine.tokens.js';
import {
  cloneBdiSnapshot,
  createEmptyBdiSnapshot,
  MemorySource,
  MemoryTier,
  type BdiSnapshot,
  type BdiStateRecord,
  type BdiStateRepository,
  type MemoryEntry,
  type MemoryStore,
  type TrajectoryTrace,
} from '../engine-core/index.js';

/**
 * 调试会话的一条内核记忆 (引擎写进记忆仓储的那一条).
 */
export interface DebugKernelMemory {
  /**
   * 记忆 id (**确定性**): 同一会话 + 同一轮 + 同一角色 → 永远是同一个 id.
   *
   * 为什么必须确定: 恢复动作可能重复发生 (用户手滑点两次"继续调试") ——
   *   确定性 id + 仓储的"同 id 后写为准" = 重复恢复**幂等**, 不会写出两条一样的记忆.
   */
  readonly id: string;
  /** 谁说的: `counselor` = 学员 (咨询师), `visitor` = AI 扮演的来访者. */
  readonly role: 'counselor' | 'visitor';
  /** 内容原文. */
  readonly content: string;
  /** 发生时刻 (ms). */
  readonly occurredAt: number;
  /** 重要度 [0,1] (与引擎写入工作记忆时同值). */
  readonly importance: number;
}

/**
 * 调试会话的轨迹观测 (剧本走到哪一幕).
 *
 * ⚠️ 调试会话目前**不注入剧本** → 这个块恒为 `null`.
 *   字段留着是为了将来接剧本时不必再改快照格式 (而不是"以后再说"再改一次).
 */
export interface DebugKernelTrajectory {
  /** 剧本 id. */
  readonly scriptId: string;
  /** 本轮实际处理的幕 id (无则 null). */
  readonly activeNodeId: string | null;
  /** 处理后的游标 (下一个待进入幕的 order). */
  readonly cursor: number;
  /** 已激活过的幕 id 清单. */
  readonly visitedNodeIds: readonly string[];
  /** 终态 (`completed` / `aborted`; 无则 null). */
  readonly outcome: string | null;
}

/**
 * 调试会话的「内核状态快照」 (恢复用的唯一真相).
 */
export interface DebugKernelState {
  /** 内核 BDI 快照 (恢复时**原样**回灌 —— 这是"恢复后与最后一轮一致"的那份状态). */
  readonly snapshot: BdiSnapshot;
  /** BDI 状态版本号 (乐观锁 revision; 恢复时按它写回状态仓储). */
  readonly revision: number;
  /** 快照对应的轮次 (会话累计轮次). */
  readonly turnIndex: number;
  /** 快照落库时刻 (ms). */
  readonly updatedAt: number;
  /** 记忆条目 (恢复时回灌到记忆仓储). */
  readonly memories: readonly DebugKernelMemory[];
  /** 轨迹节点 (调试会话目前无剧本 → 恒为 null). */
  readonly trajectory: DebugKernelTrajectory | null;
}

/**
 * 构造记忆 id (确定性).
 *
 * @param sessionId 调试会话 id
 * @param turnIndex 轮次 (从 1 开始)
 * @param role 谁说的
 * @returns 记忆 id
 */
export function buildDebugMemoryId(sessionId: string, turnIndex: number, role: 'counselor' | 'visitor'): string {
  return `dbgmem:${sessionId}:${turnIndex}:${role}`;
}

/**
 * 从本轮内核出参构造内核状态快照.
 *
 * 快照是**值**: BDI 快照走 `cloneBdiSnapshot` 拷一份, 不与内核手里的那份共享引用.
 *
 * @param input 构造入参
 * @returns 内核状态快照
 */
export function buildDebugKernelState(input: {
  readonly snapshot: BdiSnapshot;
  readonly revision: number;
  readonly turnIndex: number;
  readonly updatedAt: number;
  readonly memories: readonly DebugKernelMemory[];
  readonly trajectoryTrace?: TrajectoryTrace;
}): DebugKernelState {
  return {
    snapshot: cloneBdiSnapshot(input.snapshot),
    revision: input.revision,
    turnIndex: input.turnIndex,
    updatedAt: input.updatedAt,
    memories: [...input.memories],
    trajectory: buildTrajectoryState(input.trajectoryTrace),
  };
}

/**
 * 轨迹观测 → 快照里的轨迹块 (无剧本 → null).
 */
function buildTrajectoryState(trace: TrajectoryTrace | undefined): DebugKernelTrajectory | null {
  if (!trace) return null;
  return {
    scriptId: trace.scriptId,
    activeNodeId: trace.activeNodeId ?? null,
    cursor: trace.cursor,
    visitedNodeIds: [...trace.visitedNodeIds],
    outcome: trace.outcome ?? null,
  };
}

/**
 * 解析持久化文件里的内核状态快照 (形状不对 → null).
 *
 * 为什么要**逐字段兜底**而不是"整个丢掉": 文件可能被手工改过 / 被别的版本写过.
 * 但快照是"恢复后状态对不对"的唯一依据 —— 关键字段缺失时必须**报不可用**,
 * 不能用中性默认值糊过去 (那等于"恢复成功但状态是新的", 比报错更坏).
 *
 * @param value 文件里的原始值
 * @returns 内核状态快照; 形状不对 → null
 */
export function parseDebugKernelState(value: unknown): DebugKernelState | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const snapshot = parseSnapshot(raw['snapshot']);
  if (!snapshot) return null;
  const revision = readFiniteNumber(raw['revision']);
  const turnIndex = readFiniteNumber(raw['turnIndex']);
  const updatedAt = readFiniteNumber(raw['updatedAt']);
  if (revision === null || turnIndex === null || updatedAt === null) return null;
  const memories = parseMemories(raw['memories']);
  if (!memories) return null;
  return {
    snapshot,
    revision,
    turnIndex,
    updatedAt,
    memories,
    trajectory: parseTrajectory(raw['trajectory']),
  };
}

/**
 * 解析 BDI 快照 (关键数值缺失 → null).
 */
function parseSnapshot(value: unknown): BdiSnapshot | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const trust = readFiniteNumber(raw['trust']);
  const safety = readFiniteNumber(raw['safety']);
  const bond = readFiniteNumber(raw['bond']);
  if (trust === null || safety === null || bond === null) return null;
  const emotion = parseEmotion(raw['emotion']);
  const resistance = parseResistance(raw['resistance']);
  if (!emotion || !resistance) return null;
  const base = createEmptyBdiSnapshot();
  return cloneBdiSnapshot({
    ...base,
    coreBeliefs: readArray<BdiSnapshot['coreBeliefs'][number]>(raw['coreBeliefs']) ?? base.coreBeliefs,
    temporaryBeliefs: readArray<BdiSnapshot['temporaryBeliefs'][number]>(raw['temporaryBeliefs']) ?? base.temporaryBeliefs,
    memoryBeliefs: readArray<BdiSnapshot['memoryBeliefs'][number]>(raw['memoryBeliefs']) ?? base.memoryBeliefs,
    coreBeliefActivation: readObject<BdiSnapshot['coreBeliefActivation']>(raw['coreBeliefActivation']) ?? base.coreBeliefActivation,
    underlyingDesires: readArray<BdiSnapshot['underlyingDesires'][number]>(raw['underlyingDesires']) ?? base.underlyingDesires,
    situationalDesires: readArray<BdiSnapshot['situationalDesires'][number]>(raw['situationalDesires']) ?? base.situationalDesires,
    emotion,
    resistance,
    transference: readObject<BdiSnapshot['transference']>(raw['transference']) ?? base.transference,
    trust,
    safety,
    bond,
  });
}

/**
 * 解析情绪块 (valence / arousal 必须是有限数).
 */
function parseEmotion(value: unknown): BdiSnapshot['emotion'] | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const valence = readFiniteNumber(raw['valence']);
  const arousal = readFiniteNumber(raw['arousal']);
  if (valence === null || arousal === null) return null;
  return { ...raw, valence, arousal } as unknown as BdiSnapshot['emotion'];
}

/**
 * 解析阻抗三维 (三个分量都必须是有限数).
 */
function parseResistance(value: unknown): BdiSnapshot['resistance'] | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const verbal = readFiniteNumber(raw['verbal']);
  const depth = readFiniteNumber(raw['depth']);
  const style = readFiniteNumber(raw['style']);
  if (verbal === null || depth === null || style === null) return null;
  return { verbal, depth, style };
}

/**
 * 解析记忆条目列表 (有一条形状不对 → 整份不可用).
 */
function parseMemories(value: unknown): readonly DebugKernelMemory[] | null {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) return null;
  const memories: DebugKernelMemory[] = [];
  for (const item of value) {
    const memory = parseMemory(item);
    if (!memory) return null;
    memories.push(memory);
  }
  return memories;
}

/**
 * 解析单条记忆.
 */
function parseMemory(value: unknown): DebugKernelMemory | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const id = readString(raw['id']);
  const content = readString(raw['content']);
  const role = readMemoryRole(raw['role']);
  const occurredAt = readFiniteNumber(raw['occurredAt']);
  const importance = readFiniteNumber(raw['importance']);
  if (!id || !content || !role || occurredAt === null || importance === null) return null;
  return { id, role, content, occurredAt, importance };
}

/**
 * 读记忆条目的角色 (非法值 → null).
 *
 * 为什么不用嵌套三元: 嵌套三元在两个分支都要人肉判断"哪个是真值" ——
 *   拆成一条条 early-return, 读的人一眼就看完.
 */
function readMemoryRole(value: unknown): 'counselor' | 'visitor' | null {
  if (value === 'counselor') return 'counselor';
  if (value === 'visitor') return 'visitor';
  return null;
}

/**
 * 解析轨迹块 (缺省 = null = 无剧本).
 */
function parseTrajectory(value: unknown): DebugKernelTrajectory | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const scriptId = readString(raw['scriptId']);
  const cursor = readFiniteNumber(raw['cursor']);
  if (!scriptId || cursor === null) return null;
  return {
    scriptId,
    activeNodeId: readString(raw['activeNodeId']),
    cursor,
    visitedNodeIds: readArray<string>(raw['visitedNodeIds']) ?? [],
    outcome: readString(raw['outcome']),
  };
}

/**
 * 读字符串 (非空).
 */
function readString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/**
 * 读有限数.
 */
function readFiniteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * 读数组 (非数组 → null).
 *
 * 泛型只做**类型搬运**: 文件里的数组元素结构由内核定义, 这里不重新校验
 * (逐元素深校验 = 在适配层抄一份内核的形状 —— 那才是双胞胎).
 */
function readArray<T>(value: unknown): readonly T[] | null {
  return Array.isArray(value) ? (value as T[]) : null;
}

/**
 * 读对象 (非对象 → null).
 */
function readObject<T>(value: unknown): T | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as T) : null;
}

/**
 * 内核状态回灌器 (把持久化快照写回内核看得见的地方).
 *
 * 为什么单独一个类 (而不是塞进调试会话服务):
 *   · 它要注入**引擎装配层**的两个端口 (BDI 状态仓储 / 记忆仓储) ——
 *     那是"跟内核打交道"的部分, 与"调试会话怎么编排"是两件事;
 *   · 单测可以只测回灌这一段, 不必起整条会话链路.
 */
@Injectable()
export class DebugKernelStateRestorer {
  private readonly logger = new Logger(DebugKernelStateRestorer.name);

  constructor(
    @Inject(ENGINE_BDI_STATE_REPOSITORY) private readonly bdiStates: BdiStateRepository,
    @Inject(ENGINE_MEMORY_STORE) private readonly memories: MemoryStore,
  ) {}

  /**
   * 回灌 BDI 状态快照.
   *
   * 口径 (**为什么不覆盖已有的**):
   *   状态仓储里已经有这条会话的状态 → 说明它比文件**新** (内核先落库, 后落文件),
   *   那是活着的真相, 覆盖它反而会把状态倒退回去. 只有"仓储里没有"或
   *   "仓储里的版本比文件旧"才写回文件里的快照.
   *
   * @param tenantId 租户 id
   * @param sessionId 会话 id
   * @param state 内核状态快照
   * @returns `restored` = 已回灌; `kept` = 仓储里已有更新的状态, 原样保留
   * @throws Error 底层存储不可达 / 乐观锁冲突 (调用方必须知道恢复没成功)
   */
  async restoreBdiState(tenantId: string, sessionId: string, state: DebugKernelState): Promise<'restored' | 'kept'> {
    const existing = await this.bdiStates.load(tenantId, sessionId);
    if (existing && existing.revision >= state.revision) return 'kept';
    const record: BdiStateRecord = {
      tenantId,
      sessionId,
      revision: Math.max(1, state.revision),
      updatedAt: state.updatedAt,
      snapshot: state.snapshot,
    };
    await this.bdiStates.save(record);
    this.logger.log(`[debug_resume] BDI 状态已回灌 session=${sessionId} revision=${record.revision}`);
    return 'restored';
  }

  /**
   * 回灌记忆条目 (引擎写过的工作记忆).
   *
   * 逐条写, 不做批量: 记忆仓储的端口只有单条 `remember`.
   * id 是确定性的 → 重复恢复幂等 (同 id 后写为准).
   *
   * @param tenantId 租户 id
   * @param visitorId 来访者 id
   * @param sessionId 会话 id
   * @param memories 记忆条目
   * @returns 实际回灌的条数
   * @throws Error 底层存储不可达 (调用方必须知道恢复没成功)
   */
  async restoreMemories(tenantId: string, visitorId: string, sessionId: string, memories: readonly DebugKernelMemory[]): Promise<number> {
    let restored = 0;
    for (const memory of memories) {
      const entry: MemoryEntry = {
        tenantId,
        id: memory.id,
        sessionId,
        tier: MemoryTier.WORKING,
        source: MemorySource.TURN,
        content: memory.content,
        importance: memory.importance,
        occurredAt: memory.occurredAt,
        visitorId,
      };
      await this.memories.remember(entry);
      restored += 1;
    }
    return restored;
  }
}

/**
 * 引擎写工作记忆时用的重要度 (咨询师半边与来访者半边同值).
 *
 * 为什么不各写一个 0.5: 引擎那边的来访者半边用的是这个导出常量,
 * 咨询师半边用的是内核里的私有常量 (同为 0.5, 但没导出) —— 这里跟着**能引用的那份**走,
 * 免得同一个值在两处各写一遍.
 */
export const DEBUG_MEMORY_IMPORTANCE = VISITOR_MEMORY_IMPORTANCE;
