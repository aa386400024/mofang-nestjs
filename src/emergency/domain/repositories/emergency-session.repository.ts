// V2026-11-15 治本 (TD-19 · C2 第三批仓储端口化 · emergency 域 · P-DEBT-11 / L-1):
//   抽象: `EmergencyService` 不再注入 typeorm 的泛型仓储对象, 只依赖本端口
//     interface + `EMERGENCY_SESSION_REPOSITORY` DI token —— TypeORM 实现收进
//     `data/emergency-session.repository.typeorm.ts`, 两条原生 SQL (upsert / 聚合统计)
//     与全部查询口径封在实现里, service 只看到业务语义的方法.
//
//   模板先例: `src/good_state_diary/domain/repositories/diary-entry.repository.ts`
//     (TD-18 · 单端口 · 实体工厂在实现层) + `src/consent/domain/repositories/consent.repository.ts`
//     (TD-17 · 最小单端口) + `src/life-map/domain/repositories/` (TD-16 · 无软删 Row 口径)
//     + `src/analytics/domain/repositories/` (TD-13).
//
//   端口划分粒度 (TD-19 判定): **单端口** —— 本域只有 1 张表 / 1 个 service /
//     5 处仓储调用全部落在同一张表上; 方法面虽只有 4 个, 但拆成多端口只会把同一张表的
//     查询口径切碎, 面反而变宽 (对齐 TD-13 D-2「面窄才守得住」).
//
//   关键方法 (方法面只收 service 现有的 5 处调用, 不泛化成通用代理):
//     - upsert(input): 原生 SQL upsert + 按 id 回读 —— 回读未命中返 null, 抛错留 service
//     - findById(id, uid?): 按 id 取行 —— 传 uid 则加 uid 隔离条件, 不传则按 id 单条件
//     - list(uid, query?): uid 过滤 + sinceMs 过滤 + started_at_ms DESC + limit (默认 100)
//     - aggregateToolStats(uid, sinceMs): 原生 GROUP BY 聚合 + snake_case→camelCase 映射
//
//   反双胞胎:
//     - 不用泛型 typeorm 仓储代理 —— 那等于把 typeorm 的 API 面原样漏给业务层
//     - 不暴露 typeorm 的管理句柄 / 查询选项 / 操作符 / 原生查询句柄 —— 只允许出现在实现文件内
//     - 不写 SQL —— 端口只说「要什么」, 怎么说由实现决定 (本域两条 raw SQL 全在实现层)
//     - 不暴露 entity 类 —— 出参用 Row 领域类型, 业务层不碰实体
//     - **本域无软删** —— Row 不含 deletedAt 列 (对齐 life-map 口径, 区别于 TD-18 diary)
//
//   如何验证:
//     1. 单元测试用端口替身驱动 service (test/emergency/td19-emergency-port-c2-batch3.spec.ts),
//        不起真 TypeORM / 不连 DB / 不 vi.mock('typeorm')
//     2. grep 复核: 端口 / service / 新 spec 里 typeorm 值符号 0 命中
//   时间戳: 2026-11-15 GMT+8

import { EmergencyToolKind, SessionPhase } from '../../enums/emergency.enums.js';

/**
 * 急救会话行 —— 端口出参 (窄领域类型, 不含 entity 类).
 *
 * V2026-11-15 治本 (TD-19 · 与 TD-18 的差异): **不含 deletedAt 列** —— 本域 entity
 *   没有软删列, 也没有软删 / 恢复 / 擦除路径 (口径对齐 life-map 先例).
 *
 * startedAtMs / completedAtMs 保持 entity 的 **bigint 原生字符串**形态;
 * 响应层的 Number(...) 转换留 service 的 toDto (DTO 契约不变).
 */
export interface EmergencySessionRow {
  id: string;
  uid: string;
  toolKind: EmergencyToolKind;
  phase: SessionPhase;
  intensityBefore: number | null;
  intensityAfter: number | null;
  stagesCompleted: number;
  /** bigint 原生类型 (entity 即 string) —— 响应层 Number 转换留 service. */
  startedAtMs: string;
  /** bigint 原生类型 (可空). */
  completedAtMs: string | null;
  notes: string | null;
  context: Record<string, unknown> | null;
  createdAt: Date;
}

/**
 * 工具效果统计行 —— 端口第二出参 (聚合结果, 无对应 entity / 无表行映射).
 */
export interface EmergencyToolStatRow {
  toolKind: string;
  sampleCount: number;
  /** 全无评分时为 null (AVG 返 NULL 的兜底口径). */
  avgIntensityDelta: number | null;
  completionRate: number;
}

/**
 * 急救会话写入入参 —— 行由 service 以纯对象构造 (不依赖仓储工厂方法).
 *
 * startedAtMs / completedAtMs 在入参里是 **number** (前端毫秒时间戳);
 * bigint 字符串化在实现层完成.
 */
export interface UpsertEmergencySessionInput {
  id: string;
  uid: string;
  toolKind: EmergencyToolKind;
  phase: SessionPhase;
  intensityBefore: number | null;
  intensityAfter: number | null;
  stagesCompleted: number;
  startedAtMs: number;
  completedAtMs: number | null;
  notes: string | null;
  context: Record<string, unknown> | null;
}

/**
 * 会话列表查询入参 —— 过滤与上限口径由实现层执行.
 */
export interface EmergencySessionListQuery {
  /** 起始毫秒时间戳 —— 不传 = 不过滤. */
  sinceMs?: number;
  /** 条数上限 —— 不传 = 实现层默认 100. */
  limit?: number;
}

/**
 * 急救会话仓储契约 —— emergency 域会话存储的唯一真相源.
 *
 * 唯一调用方: `EmergencyService` (providers/emergency.service.ts).
 */
export interface EmergencySessionRepository {
  /**
   * 写入一行 (upsert 语义) 并按 id 回读.
   *
   * @param input 写入入参 (纯对象)
   * @returns 回读到的行; **回读未命中返 null** (抛错判定留 service)
   */
  upsert(input: UpsertEmergencySessionInput): Promise<EmergencySessionRow | null>;

  /**
   * 按 id 取行 —— 传 uid 则加 uid 隔离条件 (越权隔离口径), 不传则按 id 单条件.
   *
   * @param id 会话 id
   * @param uid 作者 id (可选)
   * @returns 行 (无命中返 null)
   */
  findById(id: string, uid?: string): Promise<EmergencySessionRow | null>;

  /**
   * 列出会话 —— uid 过滤 + sinceMs 过滤 + started_at_ms 倒序 + limit.
   *
   * @param uid 作者 id
   * @param query 查询入参 (可选)
   * @returns 行列表
   */
  list(uid: string, query?: EmergencySessionListQuery): Promise<EmergencySessionRow[]>;

  /**
   * 工具效果聚合 —— 按 tool_kind 分组统计.
   *
   * @param uid 作者 id
   * @param sinceMs 窗口起点 (毫秒时间戳) —— 窗口长度换算留 service
   * @returns 统计行列表 (snake_case→camelCase + 数值化已在实现层完成)
   */
  aggregateToolStats(uid: string, sinceMs: number): Promise<EmergencyToolStatRow[]>;
}

/** DI token —— NestJS 注入用. */
export const EMERGENCY_SESSION_REPOSITORY = Symbol('EMERGENCY_SESSION_REPOSITORY');
