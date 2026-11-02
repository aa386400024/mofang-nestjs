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
