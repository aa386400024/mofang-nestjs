/**
 * 咨询师模块统一类型定义 (Phase2.5 P1f 重构).
 *
 * 为什么单独抽 dto/:
 *   以后微服务化时, 这些类型可以直接搬到独立服务, 不用从 NestJS 代码里捞.
 */

/** 一段对话历史 (一侧发言). */
export interface CounselorHistoryTurn {
  /** 谁说的. */
  readonly role: 'counselor' | 'visitor';
  /** 说的话. */
  readonly text: string;
}

/** 咨询师生成的输出. */
export interface CounselorReply {
  /** 咨询师这一轮说的话. */
  readonly text: string;
  /** 本次 LLM 用的模型名. */
  readonly model: string;
  /** 是否走了兜底 (LLM 失败时). */
  readonly degraded: boolean;
  /** 咨询师是否判断"本次咨询可以自然收尾". */
  readonly closeRequested: boolean;
}

/** 生成咨询师台词的附加上下文. */
export interface CounselorGenerateOptions {
  /**
   * 是否处于危机后置练习窗.
   *
   * true 时追加"危机已披露 → 稳定化"阶段任务.
   */
  readonly crisisMode?: boolean;
}

/** Prompt 纪律块的接口 (开闭原则: 加新块只要实现这个接口). */
export interface PromptSection {
  /** 唯一标识, 用于版本指纹和开关控制. */
  readonly id: string;
  /** 内容文本. */
  readonly content: string;
  /** 是否启用. false 时 builder 会跳过这一块 (A/B 测试用). */
  readonly enabled: boolean;
  /** 排序权重, 数字小的排在前面. */
  readonly order: number;
}

/** 关键事实 (Phase 2 留接口, 现在不实现). */
export interface KeyFact {
  readonly category: 'visitor_statement' | 'counselor_confirmation' | 'key_event';
  readonly text: string;
  readonly turnIndex: number;
}

/** 生成参数策略. */
export interface CounselorGenerationPolicy {
  readonly temperature: number;
  readonly maxCompletionTokens: number;
  readonly reasoningEffort: 'low' | 'medium' | 'high';
}
