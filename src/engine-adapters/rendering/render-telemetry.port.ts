/**
 * 渲染链路遥测窄面 (AF-278).
 *
 * 为什么单独抽一个纯接口:
 *   - `engine-adapters` 不该直接依赖 `MetricsService` / prom-client; 适配器只声明
 *     "我关心哪些事件", 由 wiring 注入具体实现 (日志 / Prometheus / 测试 fake).
 *   - 回调只带候选 id、模型名、耗时、封闭枚举原因 —— 不携带 prompt、台词、会话内容,
 *     从类型上就没有把心理内容送进指标的路径.
 *   - 全部方法可选: 单测与未接遥测的调用方不必实现空壳.
 */
export type RenderStreamTimeoutPhase = 'first-delta' | 'idle';

/**
 * 候选失败原因 (封闭枚举, 直接作为指标标签值).
 *
 * 为什么不用上游原始错误消息: 那个基数不可控, 且可能夹带请求 id / 内容片段;
 * 枚举值让看板能聚合, 也让错误分类口径只有一处.
 */
export type RenderFailureCause =
  | 'auth'
  | 'rate-limit'
  | 'server'
  | 'timeout'
  | 'first-delta'
  | 'idle'
  | 'empty'
  | 'truncated'
  | 'config'
  | 'guard'
  | 'exhausted'
  | 'cancelled'
  | 'other';

/** 单次候选尝试的终局 (用于 attempts 计数). */
export type RenderAttemptOutcome = 'success' | 'retry' | 'degrade';

/**
 * 渲染遥测端口.
 *
 * 所有方法都必须**永不抛错**: 遥测实现故障不能反向影响渲染主流程.
 * 适配器侧调用点用 `safeNotify` 包一层, 实现侧也应自行吞掉异常.
 */
export interface RenderTelemetryPort {
  /** 一次候选尝试开始. */
  onAttempt?(candidateId: string, model: string): void;
  /** 候选尝试结束 (success / retry / degrade). */
  onAttemptOutcome?(candidateId: string, model: string, outcome: RenderAttemptOutcome): void;
  /** 首个可见增量到达, 带 TTFT. */
  onFirstDelta?(candidateId: string, model: string, ttftMs: number): void;
  /** 流式超时: 首包等待超时或块间空闲超时. */
  onStreamTimeout?(candidateId: string, phase: RenderStreamTimeoutPhase): void;
  /** 鉴权失败 (401/403). */
  onAuthFailure?(candidateId: string): void;
  /**
   * 候选级失败 (每次失败尝试记一次, 含末次候选).
   *
   * 与 `onAttemptOutcome` 分开: attempts 是"候选尝试"的分母, failure 保留
   * 失败原因; 单候选部署与末次候选的 429/5xx/超时不再塌缩成 exhausted.
   */
  onFailure?(candidateId: string, model: string, cause: RenderFailureCause): void;
  /** 外部取消 (barge-in / 暂停), 不是渲染降级, 单独计数. */
  onCancelled?(candidateId: string, model: string): void;
  /** 从 from 候选切到 to 候选. */
  onFallback?(from: string, to: string, cause: RenderFailureCause): void;
  /** 本轮最终降级兜底. */
  onDegraded?(cause: RenderFailureCause): void;
}
