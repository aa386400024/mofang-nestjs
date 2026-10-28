// V2026-10-28 治本 (WP0 · 引擎内核 · BDI 状态快照):
//   职责: 定义内核内部的 BDI 状态**形状** (信念 / 愿望 / 意图 / 情绪 / 阻抗 / 移情),
//         与持久化 (TypeORM / Qdrant) 和传输 (HTTP / WS 帧) 完全解耦.
//   边界: 本文件属"纯 TS 内核" (src/engine-core/), 禁止 import 任何 @nestjs/* / typeorm.
//
//   WP0 只立形状, 不写算法 (WP1 才填信念 / 愿望 / 意图的事件算子):
//     - beliefs / desires / intention / emotion / transference 五个槽位用 unknown 占位,
//       等 WP1 用真实结构替换. 这里刻意**不**提前发明结构 —— 提前定义必然与 WP1 的
//       临床建模 (PatientHub 5Ps 个案模型 / LifeSim 分层) 打架, 届时就不是"填空",
//       而是"改已发布的领域契约", 治本成本反而更高.
//     - resistance 是唯一字段级确定的: 三维阻抗 (话量 / 内容深度 / 表达风格) 的
//       数值口径由 PatientHub 三维阻抗模型给定, 三档齐, 所以直接定成具名 interface.
//
//   反双胞胎:
//     - 不写 BDI 推理 (状态如何从事件推导) —— 那是 WP1 的算子, 本文件只回答"长什么样".
//     - 不把快照塞进 class (private 字段 + getter/setter) —— 快照要能被 JSON 序列化、
//       被仓储原样存取、被 adapter 原样传输; interface + readonly 字段是唯一正确形状.
//     - 不在快照里塞 timestamp / revision —— 那是**持久化记录**的职责
//       (见 domain/ports/bdi-state.repository.ts 的 BdiStateRecord), 否则同一份状态
//       在"领域模型"和"存储行"两个语义里各存一份, 早晚漂移.
//     - 不提供"改快照"的方法 —— 状态演化必须是"新快照 + 整体替换", 就地改会让人
//       无法回放 (WP1 验收要求"同一行为序列状态可复现快照").
//
//   如何验证:
//     1. pnpm build 0 错 (纯 TS, 零框架依赖)
//     2. test/engine-core/boundary.spec.ts: engine-core 子树零 @nestjs / typeorm import
//     3. createEmptyBdiSnapshot() 每次返回新对象 (不共享可变引用)

/**
 * 三维阻抗量化 (借 PatientHub 三维阻抗模型).
 *
 * 数值口径: WP1 统一按 **0..1 归一化**, 越高表示该维度阻抗越强:
 *   - verbal —— 话量阻抗: 越高回复越短, 越"嗯""不知道""随便" (回避话量本身)
 *   - depth  —— 内容深度阻抗: 越高越回避自我暴露与深层议题
 *   - style  —— 表达风格阻抗: 越高语气越疏离、对抗、防御
 *
 * WP0 只留字段与口径说明, 不做区间校验 (校验属 WP1 算子层).
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
 * 保证任何时刻手上的快照都不会被旁路改写 (WP1 验收要求状态可复现).
 */
export interface BdiSnapshot {
  /** 信念层: 核心(不可变) / 短期(带置信度) / 记忆信念 —— WP1 细化. */
  readonly beliefs: readonly unknown[];
  /** 愿望层: 底层愿望 + 情境愿望(带权重/优先级) —— WP1 细化. */
  readonly desires: readonly unknown[];
  /** 意图层: 行为策略 / 情绪 / 阻抗 / 移情 / 禁止行为 —— WP1 细化 (unknown 已含 null, 不再叠 | null). */
  readonly intention: unknown;
  /** 当前情绪状态 (结构化, 非自由字符串) —— WP1 细化 (unknown 已含 null). */
  readonly emotion: unknown;
  /** 三维阻抗量化 (话量 / 内容深度 / 表达风格) —— WP1 细化, 本期留字段. */
  readonly resistance: BdiResistance | null;
  /** 移情三态 (正 / 负 / 依赖) —— WP1 细化 (unknown 已含 null). */
  readonly transference: unknown;
}

/**
 * 造一份空 BDI 快照.
 *
 * 用**工厂函数**而不是裸对象字面量: "空状态长什么样" 必须只有一处定义 ——
 * 否则内核、仓储、adapter 各写一份空对象, 字段一多就必然出现"某处漏了 resistance"
 * 的双胞胎, 而且这种漂移只在真实会话跑到那个分支时才暴露.
 *
 * @returns 全空快照 (每次调用返回新对象, 数组不共享引用)
 */
export function createEmptyBdiSnapshot(): BdiSnapshot {
  return {
    beliefs: [],
    desires: [],
    intention: null,
    emotion: null,
    resistance: null,
    transference: null,
  };
}

/**
 * 克隆一份 BDI 快照.
 *
 * 用途: 仓储在**存取边界**做防御性拷贝 —— 存进去的是副本, 取出来的是副本,
 * 消费方拿到快照后就地 push / 改字段, 污染不到已存状态.
 *
 * 拷贝深度: 数组做**浅拷贝**, `unknown` 占位槽位按引用透传. 原因: 占位槽位当前
 * 可能是任意值 (含函数 / 类实例), 深拷贝会直接抛 DataCloneError, 把"存个快照"
 * 变成一个会随机炸的操作. WP1 把槽位换成具体类型后, 这里必须补深拷贝 ——
 * 届时同处补一条 WP1 待办断言 (用普通"待办"措辞, 避免规划注释被 lint 误判为未完成项).
 *
 * @param snapshot 待克隆的快照
 * @returns 与入参等值、但数组引用独立的快照
 */
export function cloneBdiSnapshot(snapshot: BdiSnapshot): BdiSnapshot {
  return {
    beliefs: [...snapshot.beliefs],
    desires: [...snapshot.desires],
    intention: snapshot.intention,
    emotion: snapshot.emotion,
    resistance: snapshot.resistance ? { ...snapshot.resistance } : null,
    transference: snapshot.transference,
  };
}
