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
 *
 * V2026-11-12 治本 (D-2 · 事件类型拆分): 追加两类**在场状态**事件.
 *   · holding_present —— 稳定在场的有效中性 (结构化过渡 / 陪着 / 不评判也不机械).
 *   · cold_absent    —— 实质缺席 (心不在焉 / 敷衍 / 模板化 / 只顾自己).
 *   为什么单独拆: 规则轨把这两类都吞进 neutral, 同乘 ZERO ——
 *   前者临床应微正向、后者临床应零或负向, 两者都测不出来 (台账 I-18).
 *   ⚠️ 这两类是**状态类**而非**行为动作类** —— 与上面十种行为算子不同层.
 *   ⚠️ DELTA_TABLE 里的种子向量 = ZERO (零回归): 临床方向与幅度由标定批次
 *     经 DeltaTableConfig 覆写落地, 基础表不承担临床参数.
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
  | 'neutral'
  /** 稳定在场的有效中性 (D-2 新增; 种子 delta = ZERO, 临床增量待标定). */
  | 'holding_present'
  /** 实质缺席 / 敷衍 (D-2 新增; 种子 delta = ZERO, 临床增量待标定). */
  | 'cold_absent';

/** 一条标准会话事件. */
export interface SessionEvent {
  readonly kind: CounselorEventKind;
  /** 命中的词 / 正则原文 (可观测, 供日志与督导). */
  readonly matchedTerms: readonly string[];
  /** 命中强度 [0,1]; 规则轨本期恒为 1, 预留供模型轨加权. */
  readonly strength: number;
}

/**
 * 分类器上下文 (角色敏感议题词表 + 业务会话 id).
 *
 * V2026-11-12 治本 (D-1 第二段 · 模型轨): 加 `sessionId?`.
 *   为什么需要: 带状态的分类器 (模型轨) 要按**业务会话**分桶持有跨轮状态
 *   (连续缺席计数等). 分桶键必须是业务 sessionId 而不是 handleId ——
 *   handleId 是运行时维度, 会话恢复后会变, 跨轮状态会丢 (状态丢失 / 跨场残留).
 *   缺省 = 不给 (老调用方逐字不变).
 */
export interface ClassifyContext {
  readonly sensitiveTopics?: readonly string[];
  /** 业务会话 id (跨轮状态分桶键; 缺省 = 无状态). */
  readonly sessionId?: string;
}

/**
 * 可替换事件分类器接口.
 * 规则轨 (RuleBasedClassifier) 先实现; 模型微调轨后期实现同接口替换,
 * turn 管线只依赖本接口, 不依赖具体实现.
 *
 * V2026-11-12 治本 (D-1 第二段 · 模型轨): 加**可选**成员 `classifyAsync?`.
 *   · 存在 → 内核 await 它 (模型轨); 不存在 → 走同步 classify (规则轨, 逐字现状);
 *   · 回落 (失败 / 超时 / 非法输出) 由**实现内部**负责 —— 实现失败时返回规则轨结果,
 *     内核不感知回落, 回落代码只有一处 (不会漂).
 *   · 缺省路径逐字不变: 没实现这个成员的分类器, 内核走的那条分支与改造前完全一致.
 */
export interface EventClassifier {
  classify(text: string, context?: ClassifyContext): readonly SessionEvent[];

  /**
   * 可选异步分类 —— 模型轨.
   *
   * @param text 咨询师本轮文本 (判定对象)
   * @param context 分类上下文 (敏感议题词表 + 业务会话 id)
   * @returns 本轮事件; 实现失败时应返回规则轨的等价结果 (回落由实现内部负责)
   */
  classifyAsync?(text: string, context?: ClassifyContext): Promise<readonly SessionEvent[]>;
}
