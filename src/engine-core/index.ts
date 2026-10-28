// V2026-10-28 治本 (WP0 · 引擎内核 · 公开出口):
//   职责: 引擎内核的**唯一公开 barrel** —— 只导出公开端口与领域模型.
//         消费方 (NestJS adapter / WS 适配器 / 未来的独立微服务) 统一从这里 import.
//
//   为什么不导出内存实现 (InMemory*):
//     任务单验收条目明确要求「index.ts 只导出公开端口与模型, 内存实现不外露」.
//     道理也直白: 内存实现是**测试替身 / 兜底实现**, 把它放进公开出口等于
//     宣告"内存版是一等公民", 将来换 Qdrant 版时, 已经有业务代码 import 了内存版,
//     换不动. 需要内存实现时从 in-memory/ 显式深路径 import —— 意图写在代码里.
//
//   依赖方向 (单向, 不可逆):
//     adapter  ──▶ engine-core/index.ts ──▶ domain / runtime
//     engine-core ✗─▶ adapter
//     engine-core ✗─▶ @nestjs/* / typeorm / src/agent/visitor / src/voice
//
//   如何验证:
//     1. pnpm build 0 错
//     2. test/engine-core/boundary.spec.ts 断言: index.ts 不出现 'InMemory' / 'in-memory'

// ── 领域模型 (BDI 状态快照) ───────────────────────────────────────
export type { BdiResistance, BdiSnapshot } from './domain/bdi-snapshot';
export { cloneBdiSnapshot, createEmptyBdiSnapshot } from './domain/bdi-snapshot';

// ── 错误契约 ──────────────────────────────────────────────────────
export { EngineCoreError, EngineErrorCode } from './domain/engine-errors';

// ── 会话端口纯 DTO ────────────────────────────────────────────────
export type { EngineSessionHandle, EngineTurnInput, EngineTurnOutput, OpenEngineSessionInput } from './domain/engine-session.types';

// ── 仓储端口 ──────────────────────────────────────────────────────
export type { BdiStateRecord, BdiStateRepository } from './domain/ports/bdi-state.repository';
export type { MemoryEntry, MemoryHit, MemoryRecallQuery, MemoryStore } from './domain/ports/memory.store';
export { MemorySource, MemoryTier } from './domain/ports/memory.store';

// ── 运行时端口 ────────────────────────────────────────────────────
export type { EngineSessionPort } from './runtime/engine-session.port';
