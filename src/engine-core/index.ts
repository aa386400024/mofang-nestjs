// V2026-10-28 WP1 (引擎内核 · 公开出口):
//   职责: 引擎内核的**唯一公开 barrel** —— 只导出公开端口、领域模型与算子接口.
//         消费方 (NestJS adapter / WS 适配器 / 未来的独立微服务) 统一从这里 import.
//
//   为什么不导出内存实现 (InMemory*):
//     内存实现是**测试替身 / 兜底实现**, 放进公开出口等于宣告它是一等公民,
//     将来换 Qdrant 版时已有业务 import 了内存版, 换不动. 需要时从 in-memory/
//     显式深路径 import —— 意图写在代码里.
//
//   为什么不导出算子纯函数 / 默认常量:
//     它们是内部实现细节; 默认基线由内核内部装配, 不外露常量避免被旁路改值.
//
//   V2026-11-06 (WP58) 例外: **导出 RuleBasedClassifier** ——
//     事件 + delta 审计观测 (adapter 层自观测) 需要 matchedTerms (命中词明细),
//     而内核出参 EngineTurnOutput.events 只有事件种类、不带命中词. 分类器是纯函数
//     (词典匹配), 观测侧另写一套 = 与内核真值漂移 (记下来的 delta 对不上实际),
//     所以这里导出内核那一份.
//     ⚠️ 这是公开面的**临时扩展**: 模型轨替换分类器后, 本导出可退役 (观测改读模型输出).
//
//   依赖方向 (单向, 不可逆):
//     adapter  ──▶ engine-core/index.ts ──▶ domain / runtime / cognition 接口
//     engine-core ✗─▶ adapter
//     engine-core ✗─▶ @nestjs/* / typeorm / src/agent/visitor / src/voice

// ── 领域模型 (BDI 状态快照) ───────────────────────────────────────
export type { BdiResistance, BdiSnapshot } from './domain/bdi-snapshot.js';
export { cloneBdiSnapshot, createEmptyBdiSnapshot } from './domain/bdi-snapshot.js';

// ── 信念层 ────────────────────────────────────────────────────────
export type { CoreBelief, CoreBeliefActivation, MemoryBelief, TemporaryBelief } from './domain/beliefs.js';

// ── 愿望层 ────────────────────────────────────────────────────────
export type { SituationalDesire, UnderlyingDesire } from './domain/desires.js';

// ── 情绪 / 移情 ────────────────────────────────────────────────────
export type { EmotionLabel, EmotionState } from './domain/emotion.js';
// V2026-11-08 (WP62): 数值夹取纯函数 —— 适配层此前各自自带一份 (角色种子映射 /
//   Qdrant 分数夹取), 副本之间在 ±Infinity / NaN 口径上已经分叉. 收进公开出口
//   = 全仓只有一份口径, 由边界断言 ⑥ 双向白名单守住.
export { clamp01, clampValence } from './domain/emotion.js';
export type { TransferenceState } from './domain/transference.js';

// ── 意图层 (本轮派生输出) ──────────────────────────────────────────
export type { BehaviorStrategy, Intention } from './domain/intention.js';

// ── 角色内核注入 ───────────────────────────────────────────────────
export type { AttachmentStyle, CharacterProfile, PersonalityTraits, UnderlyingDesireSeed } from './domain/character-profile.js';

// ── 标准会话事件 / 分类器接口 (双轨可替换) ────────────────────────
export type { ClassifyContext, CounselorEventKind, EventClassifier, SessionEvent } from './domain/events/session-event.js';
// V2026-11-06 (WP58): 规则分类器**实现** —— 只给观测通道用 (要 matchedTerms).
//   公开面的临时扩展, 模型轨替换后可退役; 详见文件头.
export { RuleBasedClassifier } from './cognition/rule-based-classifier.js';

// ── 错误契约 ──────────────────────────────────────────────────────
export { EngineCoreError, EngineErrorCode } from './domain/engine-errors.js';

// ── 会话端口纯 DTO ────────────────────────────────────────────────
export type {
  EngineSessionHandle,
  EngineTurnInput,
  EngineTurnOutput,
  OpenEngineSessionInput,
  WorkingWindowOverflowEvent,
} from './domain/engine-session.types.js';

// ── 仓储端口 ──────────────────────────────────────────────────────
export type { BdiStateRecord, BdiStateRepository } from './domain/ports/bdi-state.repository.js';
export type { MemoryEntry, MemoryHit, MemoryRecallQuery, MemoryRecallScope, MemoryStore } from './domain/ports/memory.store.js';
export { MemorySource, MemoryTier } from './domain/ports/memory.store.js';
// 契约级共享 helper —— B 层实现 (Qdrant 版) 必须用**同一份**校验与上限口径,
// 否则两版实现各写一套 = 迟早漂移, 且漂移方向恰好是"某版放过了另一版拦住的脏数据".
export { assertValidMemoryEntry, assertValidMemoryRecallQuery, resolveMemoryRecallLimit } from './domain/ports/memory.store.js';

// ── 向量化端口 (WP2) ──────────────────────────────────────────────
export type { Embedder } from './domain/ports/embedder.js';

// ── 记忆策略算子 (WP2 · 纯函数) ────────────────────────────────────
export { trimWorkingWindow, overflowedWorkingWindowLines, WORKING_MEMORY_WINDOW_TURNS } from './memory/working-window.js';
export {
  decayImportance,
  effectiveImportance,
  DEFAULT_DECAY_HALF_LIFE_MS,
  RECALL_MIN_EFFECTIVE_IMPORTANCE,
} from './memory/importance-decay.js';
export type { ConflictRecord, ConflictResolution } from './memory/conflict-resolution.js';
export { applyConflictResolution, markSuperseded, resolveConflict } from './memory/conflict-resolution.js';
export { promoteShortTermToLongTerm } from './memory/promotion.js';
// V2026-11-08 (WP62): RecallPolicyOptions (召回策略端口) 一起公开 ——
//   适配层装配端口时需要引用内核那个类型, 否则只能写结构化类型 (两份签名迟早漂移).
export type { RecallEvaluation, RecallPolicyOptions } from './memory/recall-policy.js';
export { evaluateRecallCandidate } from './memory/recall-policy.js';

// ── 轨迹控制 (WP3 · 纯函数) ─────────────────────────────────────────
//   剧本是纯对象注入, 游标/终态只在进程内存; 内核不感知剧本存哪.
export type {
  OrderedTrajectoryNode,
  SnapshotDelta,
  TrajectoryCompletion,
  TrajectoryMode,
  TrajectoryNode,
  TrajectoryNodeTarget,
  TrajectoryScript,
  TrajectoryTrace,
  TrajectoryTrigger,
} from './domain/trajectory/script.js';
export { orderedTrajectoryNodes, validateTrajectoryScript } from './domain/trajectory/script.js';
export type { MatchContext } from './cognition/trajectory/trigger-evaluate.js';
export { evaluateTrigger } from './cognition/trajectory/trigger-evaluate.js';
export type { ActPlan } from './cognition/trajectory/act-cursor.js';
export { planAct } from './cognition/trajectory/act-cursor.js';
export type { TrajectoryApplication } from './cognition/trajectory/trajectory-applier.js';
export {
  applyTrajectory,
  DEFAULT_CORRECT_WEIGHT,
  MIN_CORRECT_WEIGHT,
  resolveCorrectWeight,
} from './cognition/trajectory/trajectory-applier.js';

// ── 伦理安全 (WP4 · 纯函数 + 可选探测端口) ─────────────────────────
//   内核只判定不拦截: block 只是给 adapter 的信号, 是否拦下由表现层决定.
export type {
  CounselorSafetyCategory,
  SafetyCategory,
  SafetyEvent,
  SafetyLevel,
  SafetyReport,
  SafetySide,
  SafetyVerdict,
  VisitorRiskCategory,
} from './domain/safety/safety-types.js';
export { isSafetyLevel, maxSafetyLevel, PSYGUARD_LEVEL_MAP } from './domain/safety/safety-types.js';
export type { RiskProbePort, RiskProbeResult } from './domain/ports/risk-probe.js';
export type { SafetyRule } from './cognition/safety/rule-engine.js';
export { evaluateSafety } from './cognition/safety/rule-engine.js';
export type { AssessSafetyInput } from './cognition/safety/assess-safety.js';
export { assessSafety, DEFAULT_PROBE_TIMEOUT_MS } from './cognition/safety/assess-safety.js';

// ── 渲染契约层 (WP5 · 纯类型 + 纯策略, 内核不调 LLM) ────────────────
//   规格只装"要什么", 不装模型名 / 温度 / prompt —— 那些属适配层.
export type { RenderContextTurn, RenderResult, RenderSpec, RenderTaskKind, RenderTokenBudget } from './domain/rendering/render-types.js';
export type { RenderPort } from './domain/ports/render-port.js';
export {
  CHARS_PER_TOKEN,
  DEFAULT_COMPLETION_TOKENS,
  estimateTokens,
  fitContextToBudget,
  resolveCompletionTokens,
} from './cognition/rendering/token-budget.js';
export type { FailoverCandidate, FailoverState } from './cognition/rendering/failover.js';
export { selectFailoverTarget } from './cognition/rendering/failover.js';
export { guardVisitorOutput } from './cognition/rendering/output-guard.js';

// ── 运行时端口 ────────────────────────────────────────────────────
export type { EngineSessionPort } from './runtime/engine-session.port.js';

// ── 状态迁移与单回合 delta cap (WP1 + WP15 + WP26) ─────────────────
//   WP15 的 cap 符号原先只在 cognition/state-transition.ts 里, adapter 只能深路径
//   import —— 那条路径**不在** boundary.spec.ts 断言⑥ (barrel 双向白名单) 的守卫
//   视野内: 内核改文件名/目录, adapter 直接断, 没有任何断言会红.
//   WP26 P2-16 把它们收进公开出口, 并由 boundary 断言守住.
export type {
  CapBounds,
  CapDim,
  BeliefOperatorConfig,
  DeltaCapConfig,
  DeltaCapContext,
  DeltaCapEntry,
  DeltaCapObserver,
  DeltaVector,
  TransitionStateOptions,
  TurnDeltaCapReport,
} from './cognition/state-transition.js';
export {
  addDeltaVectors,
  aggregateTurnDelta,
  applyBeliefActivationDelta,
  applyBeliefEvolution,
  applyDeltaVector,
  applyTemporaryBeliefDecay,
  buildDeltaCapReport,
  capTurnDelta,
  DEFAULT_BELIEF_ACTIVATION_DELTA,
  DEFAULT_BELIEF_DECAY_RATE,
  DEFAULT_BELIEF_OPERATOR_CONFIG,
  DEFAULT_DELTA_CAP_CONFIG,
  DEFAULT_INTRODUCED_BELIEF_DECAY_RATE,
  DEFAULT_OBSERVED_BELIEF_DECAY_RATE,
  DEFAULT_TEMPORARY_BELIEF_REMOVE_THRESHOLD,
  transitionState,
  transitionStateDetailed,
} from './cognition/state-transition.js';

// ── 人格调节算子 (WP34 · P1 依恋调节 + 人格特质调节) ───────────────
//   WP26 P2-16 的同款理由: 新符号若只住在内核内部, adapter 就得深路径 import ——
//   那条路径不在 boundary 断言⑥ (barrel 双向白名单) 的守卫视野内, 内核改文件名
//   adapter 直接断且没有任何断言会红. 收进公开出口, 由断言守住.
export type {
  AgreeablenessModulation,
  AttachmentModulation,
  PersonalityModulationInput,
  PersonalityModulatorConfig,
} from './cognition/personality-modulator.js';
export { DEFAULT_PERSONALITY_MODULATOR_CONFIG, modulateDeltaByPersonality } from './cognition/personality-modulator.js';

// ── 咨询同盟三维端口 (WP42 · trust / safety / bond 独立建模) ─────────
//   同款理由: 新符号若只住在内核内部, adapter 就得深路径 import —— 那条路径不在
//   boundary 断言⑥ (barrel 双向白名单) 的守卫视野内, 内核改文件名 adapter 直接断
//   且没有任何断言会红. 收进公开出口, 由断言守住.
export type { AllianceConfig, AllianceDeltaOverride, AllianceDeltaOverrides, AllianceThresholds } from './cognition/alliance-config.js';
export { DEFAULT_ALLIANCE_CONFIG } from './cognition/alliance-config.js';

// ── delta 规则表端口 (WP60 · 事件 → 增量逐维度覆写) ─────────────────
//   同款理由: 新符号若只住在内核内部, adapter 就得深路径 import —— 那条路径不在
//   boundary 断言⑥ (barrel 双向白名单) 的守卫视野内. 收进公开出口, 由断言守住.
//   维度名单 (DELTA_DIMENSIONS) 也一起公开: 适配层要按它校验 env 里的 JSON 键,
//   两处各写一份名单 = 两张会漂的清单.
export type { DeltaDimension, DeltaDimensionOverride, DeltaTableConfig, DeltaTableOverrides } from './cognition/delta-table-config.js';
export { DELTA_DIMENSIONS, DEFAULT_DELTA_TABLE_CONFIG, resolveDeltaVector } from './cognition/delta-table-config.js';

// ── 跨会话间隔自然衰减 (WP36 · 情绪 / 阻抗 / 同盟差异化半衰期) ─────────
//   同款理由: 新符号若只住在内核内部, adapter 就得深路径 import —— 那条路径不在
//   boundary 断言⑥ (barrel 双向白名单) 的守卫视野内, 内核改文件名 adapter 直接断
//   且没有任何断言会红. 收进公开出口, 由断言守住.
//   端口 (半衰期) 与纯函数 (applySessionDecay) 一起公开: 适配层要装配端口,
//   内核会话要调纯函数 —— 两者都是跨层契约.
export type { SessionDecayConfig } from './cognition/session-decay.js';
export { applySessionDecay, DEFAULT_SESSION_DECAY_CONFIG } from './cognition/session-decay.js';
