// V2026-11-06 治本 (WP58 · B 层 · 事件 + delta 审计观测 · 窄端口):
//   职责: 声明观测通道的**窄接口** + DI token + 写侧/读侧载荷形状.
//   边界: 纯类型 + 一个 symbol; 零逻辑、零 IO、零 ORM.
//
//   为什么端口在**适配层**而不是内核:
//     观测是 adapter 层的自观测能力 (内核零改动), 引擎装配层 (wiring/) 只认这个窄口,
//     不认 TypeORM 实体 —— 装配层的硬约束是"零 ORM / 零 SDK 包名" (WP8-A §8-9 护栏).
//
//   为什么用显式 token 而不是直接注入实现类:
//     TurnDeltaAuditPort 是 interface —— TypeScript 的 interface 编译后没有运行时值,
//     emitDecoratorMetadata 只能把它降级成 Object. 不给显式 token 的话, Nest 会去
//     容器里找一个叫 Object 的 provider, 找不到就**静默注入 undefined**
//     (症状: 观测静默失效, 但接口 200 —— 与 engine.tokens.ts 里记的同一类坑).
//
//   反双胞胎:
//     - 不在本文件放任何逻辑: 这里只声明"叫什么"、"长什么样".
//     - 不在这里声明 ORM 实体: 实体在同目录的 entity 文件里, 由 module 负责注册.
//
//   验证:
//     1. npx tsc -p tsconfig.build.json --noEmit 0 错
//     2. test/engine-adapters/wp58-turn-delta-audit.spec.ts 覆盖端口贯通与开关行为

import type { CounselorEventKind, DeltaVector } from '../../../engine-core/index.js';

/**
 * 事件 + delta 审计端口 token (实现 = TurnDeltaAuditService).
 */
export const TURN_DELTA_AUDIT = Symbol('TURN_DELTA_AUDIT');

/**
 * 写侧载荷: 一轮 turn 的观测输入.
 *
 * 字段口径:
 *   · tenantId / sessionId —— 会话归属 (来自 EngineSessionRegistry);
 *   · turnIndex           —— 本会话累计轮次 (从 1 起, 与内核出参同口径);
 *   · kernelEventKinds    —— 内核本轮判出的事件种类 —— **审计的唯一事件来源**.
 *
 * V2026-11-12 治本 (D-1 第二段 · C3): **userText 字段已移除**.
 *   审计不再自行跑分类器 (那条并集的前提在模型轨上线后直接失效, 风险 N),
 *   于是它不再需要咨询师原话 —— 心理内容**不再流进审计层** (隐私面收窄).
 */
export interface TurnDeltaAuditInput {
  readonly tenantId: string;
  readonly sessionId: string;
  readonly turnIndex: number;
  /**
   * 内核本轮判出的事件**明细** —— **审计的唯一事件来源**.
   *
   * V2026-11-12 治本 (D-2): 由「事件种类数组」升级为「明细」.
   *   理由: 内核出参新增 `eventDetails` (kind + 命中词 + 强度) —— 审计因此能记回
   *   **内核自己算出的命中词**, 不必再跑一遍分类器 (C3 的口径不变).
   *   ⚠️ 模型轨事件的 matchedTerms 是**空数组** —— 模型轨不产词表命中,
   *     本单**不造词**: 空数组 = 「没有词表证据」, 不是「忘了填」.
   */
  readonly kernelEvents: readonly TurnDeltaAuditEventInput[];
}

/**
 * 单个内核事件的写侧明细 (喂给审计的形状).
 *
 * ⚠️ `matchedTerms` 只装**词表命中词 / 正则原文**, 不是咨询师原话 (隐私红线).
 */
export interface TurnDeltaAuditEventInput {
  readonly kind: CounselorEventKind;
  readonly matchedTerms: readonly string[];
  /** 命中强度; 缺省 = 1 (规则轨与模型轨首版都是 1). */
  readonly strength?: number;
}

/**
 * 写侧窄端口: 记一轮的观测 (fire-and-forget, 永不抛错).
 */
export interface TurnDeltaAuditPort {
  /**
   * 记录一轮的事件 + delta 明细.
   *
   * @param input 本轮观测输入
   */
  record(input: TurnDeltaAuditInput): void;
}

/**
 * 单个事件的明细 (落库形状).
 *
 * ⚠️ 字段可变 (不是 readonly): 这一形状同时是 TypeORM JSON 列的行内结构,
 *   落库前由服务层组装成新数组.
 */
export interface TurnDeltaAuditEventDetail {
  kind: CounselorEventKind;
  matchedTerms: string[];
  strength: number;
}

/**
 * 读侧: 一轮的审计视图 (admin 接口返回形状).
 */
export interface TurnDeltaAuditTurnView {
  readonly turnIndex: number;
  readonly eventKinds: readonly string[];
  readonly eventDetails: readonly TurnDeltaAuditEventDetail[];
  readonly rawDelta: DeltaVector;
  readonly createdAt: string;
}
