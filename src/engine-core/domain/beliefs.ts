// V2026-10-28 WP1 (引擎内核 · 信念层):
//   职责: 定义信念层三类信念的**形状** —— 核心 / 短期 / 记忆信念.
//   边界: 纯 TS, 零 @nestjs/* / typeorm. 本文件只回答"信念长什么样",
//         不写"信念如何被事件改变" (那是 cognition/state-transition.ts 的职责).
//
//   三层分工 (对齐 roadmap WP1 信念层):
//     - CoreBelief     核心信念: 源自角色内核, 本场永久不可变, 事件只"激活"它不改写它;
//     - TemporaryBelief短期信念: 会话中形成, 带置信度, 可被咨询师干预提升/削弱;
//     - MemoryBelief   记忆信念: 长时召回用, 带时效; 本期只定义类型, 不接召回 (WP2).
//
//   反双胞胎:
//     - 不把信念塞进 class (无 getter/setter) —— 信念要能被仓储原样存取、被快照克隆;
//     - 不在本文件写置信度增减算法 —— 那是算子层, 避免形状与规则双胞胎化.

/** 核心信念: 源自角色内核, 本场永久不可变. */
export interface CoreBelief {
  /** 信念主题: unlovable / worthless / helpless / 或角色自定义字符串. */
  readonly theme: string;
  /** 第一人称陈述, 如"我是不值得被爱的". */
  readonly statement: string;
  /** 命中后会激活该信念的议题标签 (与敏感议题 / 记忆激活标签对照). */
  readonly activationTags: readonly string[];
}

/** 短期信念: 会话中形成, 带置信度, 可被干预改变. */
export interface TemporaryBelief {
  readonly id: string;
  readonly statement: string;
  /** 置信度 [0,1]. */
  readonly confidence: number;
  /** observed=来访自发形成, introduced=咨询师引入. */
  readonly source: 'observed' | 'introduced';
}

/** 记忆信念: 长时召回用, 带时效. 本期仅类型占位, 召回属 WP2. */
export interface MemoryBelief {
  readonly id: string;
  readonly statement: string;
  /** 置信度 [0,1]. */
  readonly confidence: number;
  /** 过期时刻 (ms timestamp); null = 不过期. */
  readonly expiresAt: number | null;
}

/**
 * 核心信念的**激活强度** (WP57).
 *
 * key = `CoreBelief.theme`, value = 激活强度 [0,1].
 *
 * 为什么激活强度**不在 `CoreBelief` 结构里**:
 *   `CoreBelief` 是**角色内核**的一部分 —— 同一个角色, 不同场次会话, 激活状态
 *   应该是**独立**的 (A 场被激活过不代表 B 场也带着这份强度).
 *   把动态状态放进静态结构 = 角色种子被运行时状态污染, 换场就串味.
 *   所以激活强度是**会话级动态状态**, 与快照同生命周期 (见 `BdiSnapshot`).
 *
 * 为什么用 `Record<theme, number>` 而不是数组:
 *   快照是**值语义** (readonly), 数组要靠下标寻址, 而"哪个信念被激活了"这个问题
 *   的天然主键是 theme. 用 theme 寻址后, 激活强度可以 O(1) 查, 也不受信念数组
 *   重排影响.
 *
 * ⚠️ theme 重复时**共享同一个键** (后者覆盖前者) —— theme 唯一是**角色配置的
 *   责任**, 引擎不做校验也不抛错 (见交付记录 §2.4).
 */
export type CoreBeliefActivation = Readonly<Record<string, number>>;
