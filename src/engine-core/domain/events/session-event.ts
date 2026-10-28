// V2026-10-28 WP1 (引擎内核 · 标准会话事件):
//   职责: 把咨询师行为抽象为标准事件 + 可替换的分类器接口 (双轨: 规则轨本期实现,
//         模型微调轨后期替换实现, turn 管线不感知具体实现).
//   边界: 纯 TS. 事件分类只消费咨询师本轮文本, 不从来访输出反推 (避免循环论证).

/**
 * 标准会话事件种类.
 * 正向: 共情 / 接纳 / 正常化 / 开放式探问 / 肯定;
 * 负向: 评判 / 说教 / 淡化 / 越界;
 * 触发: 触碰敏感议题;
 * neutral: 未命中任何规则 (迁移 delta = 0).
 */
export type CounselorEventKind =
  | 'empathy'
  | 'acceptance'
  | 'normalization'
  | 'open_probe'
  | 'affirmation'
  | 'judgment'
  | 'preaching'
  | 'minimizing'
  | 'boundary_cross'
  | 'sensitive_touch'
  | 'neutral';

/** 一条标准会话事件. */
export interface SessionEvent {
  readonly kind: CounselorEventKind;
  /** 命中的词 / 正则原文 (可观测, 供日志与督导). */
  readonly matchedTerms: readonly string[];
  /** 命中强度 [0,1]; 规则轨本期恒为 1, 预留供模型轨加权. */
  readonly strength: number;
}

/** 分类器上下文 (本期只带角色敏感议题词表). */
export interface ClassifyContext {
  readonly sensitiveTopics?: readonly string[];
}

/**
 * 可替换事件分类器接口.
 * 规则轨 (RuleBasedClassifier) 先实现; 模型微调轨后期实现同接口替换,
 * turn 管线只依赖本接口, 不依赖具体实现.
 */
export interface EventClassifier {
  classify(text: string, context?: ClassifyContext): readonly SessionEvent[];
}
