// V2026-10-28 WP1 (引擎内核 · BDI 状态快照):
//   职责: 定义内核内部 BDI 状态**形状** (信念 / 愿望 / 情绪 / 阻抗 / 移情 / 信任),
//         与持久化 (TypeORM / Qdrant) 和传输 (HTTP / WS 帧) 完全解耦.
//   边界: 纯 TS, 零 @nestjs/* / typeorm.
//
//   WP1 把 WP0 的 unknown 占位槽位落地为具体类型, 并新增关系变量 trust.
//   意图 (Intention) 不落快照 —— 它是每轮派生输出 (见 domain/intention.ts).
//
//   V2026-11-03 WP42 (咨询同盟三维):
//     trust 拆成三个**独立**维度: trust / safety / bond (临床上这是三件事).
//     它们各走各的 delta (见 cognition/state-transition.ts) 与各走各的决策门槛
//     (见 cognition/intention-planner.ts), 合成仍然是一个快照、值语义不变.
//     反双胞胎: 三个维度**不合成一个数**再存 —— 合成就再也分不开"信任高但
//     不敢说话"和"真的信任"这两种完全不同的状态了.
//
//   反双胞胎:
//     - 不把快照塞进 class (无 getter/setter) —— 快照要能被 JSON 序列化、被仓储
//       原样存取、被 adapter 原样传输; interface + readonly 是唯一正确形状.
//     - 不在快照里塞 timestamp / revision —— 那是持久化记录的职责
//       (见 ports/bdi-state.repository.ts 的 BdiStateRecord).
//     - 不提供"改快照"的方法 —— 状态演化必须"造新快照 + 整体替换", 就地改会让人
//       无法回放 (WP1 验收要求同一行为序列状态可复现).
//
//   如何验证:
//     1. npm run build 0 错 (纯 TS, 零框架依赖)
//     2. boundary.spec.ts: engine-core 子树零 @nestjs / typeorm import
//     3. createEmptyBdiSnapshot() 每次返回新对象 (不共享可变引用)

import type { CoreBelief, MemoryBelief, TemporaryBelief } from './beliefs.js';
import { buildInitialSnapshot } from './bootstrap.js';
import type { SituationalDesire, UnderlyingDesire } from './desires.js';
import type { EmotionState } from './emotion.js';
import type { TransferenceState } from './transference.js';

/**
 * 三维阻抗量化 (借 PatientHub 三维阻抗模型).
 *
 * 数值口径: 统一按 **0..1 归一化**, 越高表示该维度阻抗越强:
 *   - verbal —— 话量阻抗: 越高回复越短, 越"嗯""不知道""随便" (回避话量本身)
 *   - depth  —— 内容深度阻抗: 越高越回避自我暴露与深层议题
 *   - style  —— 表达风格阻抗: 越高语气越疏离、对抗、防御
 */
export interface BdiResistance {
  /** 话量阻抗 [0,1]. */
  readonly verbal: number;
  /** 内容深度阻抗 [0,1]. */
  readonly depth: number;
  /** 表达风格阻抗 [0,1]. */
  readonly style: number;
}

/**
 * BDI 状态快照: 内核内部状态, 与持久化 / 传输解耦.
 *
 * 全部字段 readonly —— 快照是**值语义**: 状态演化一律"造新快照 + 整体替换",
 * 保证任何时刻手上的快照都不会被旁路改写 (状态可复现).
 */
export interface BdiSnapshot {
  /** 信念层 · 核心信念 (永久不可变). */
  readonly coreBeliefs: readonly CoreBelief[];
  /** 信念层 · 短期信念 (会话形成, 带置信度, 可被干预). */
  readonly temporaryBeliefs: readonly TemporaryBelief[];
  /** 信念层 · 记忆信念 (长时召回, 带时效; 本期仅类型, 召回属 WP2). */
  readonly memoryBeliefs: readonly MemoryBelief[];
  /** 愿望层 · 底层愿望 (稳定, 带权重). */
  readonly underlyingDesires: readonly UnderlyingDesire[];
  /** 愿望层 · 情境愿望 (本轮具体诉求, 带优先级). */
  readonly situationalDesires: readonly SituationalDesire[];
  /** 当前情绪 (离散标签 + 效价 + 唤醒). */
  readonly emotion: EmotionState;
  /** 三维阻抗 (话量 / 内容深度 / 表达风格), 总有基线, 不再可空. */
  readonly resistance: BdiResistance;
  /** 移情三态强度 (正 / 负 / 依赖). */
  readonly transference: TransferenceState;
  /**
   * 关系信任 [0,1], 开放度 / 披露深度的总闸门.
   *
   * WP42: 信任是同盟三维之一, 但**不**再是唯一的闸门 ——
   *   临床上"信任" / "安全感" / "纽带感"是三件事:
   *     · trust  —— 来访相信咨询师是专业的、不会评判自己;
   *     · safety —— 来访在这段关系里感到安全, 可以敞开心扉;
   *     · bond   —— 来访与咨询师有情感连接, 不是冷冰冰的问诊.
   *   一个来访可能 trust 高 (相信你专业) 但 safety 低 (不敢说真话) ——
   *   旧模型一律按 trust 高处理, 于是直接进探索模式, 效果不对.
   */
  readonly trust: number;
  /** 安全感 [0,1]: 来访在这段关系里敢不敢敞开心扉 (WP42). */
  readonly safety: number;
  /** 纽带感 [0,1]: 来访与咨询师的情感连接强度 (WP42). */
  readonly bond: number;
}

/**
 * 造一份中性默认空快照 (无角色 profile 的全新会话基线).
 *
 * 用工厂函数而不是裸对象字面量: "空状态长什么样" 必须只有一处定义 (bootstrap),
 * 否则内核 / 仓储 / adapter 各写一份, 字段一多就出现"某处漏了 trust"的双胞胎.
 * 每次调用返回新对象, 数组不共享引用.
 */
export function createEmptyBdiSnapshot(): BdiSnapshot {
  return buildInitialSnapshot();
}

/**
 * 克隆一份 BDI 快照 (仓储存取边界的防御性拷贝).
 *
 * 数组浅拷贝 + 嵌套对象展开; 消费方就地改字段 / push 污染不到已存状态.
 * 所有槽位已是具体值类型, 不再按 unknown 引用透传.
 */
export function cloneBdiSnapshot(snapshot: BdiSnapshot): BdiSnapshot {
  return {
    coreBeliefs: snapshot.coreBeliefs.map((b) => ({ ...b })),
    temporaryBeliefs: snapshot.temporaryBeliefs.map((b) => ({ ...b })),
    memoryBeliefs: snapshot.memoryBeliefs.map((b) => ({ ...b })),
    underlyingDesires: snapshot.underlyingDesires.map((d) => ({ ...d })),
    situationalDesires: snapshot.situationalDesires.map((d) => ({ ...d })),
    emotion: { ...snapshot.emotion },
    resistance: { ...snapshot.resistance },
    transference: { ...snapshot.transference },
    trust: snapshot.trust,
    safety: snapshot.safety,
    bond: snapshot.bond,
  };
}
