// V2026-11-14 治本 (TD-16 · C1 试点域仓储端口化 · life-map 域 · P-DEBT-11 / L-1):
//   抽象: `LifeMapService` 的关键事件表访问收进本端口 (interface + Symbol token),
//     TypeORM 实现收进 `data/key-event.repository.typeorm.ts`.
//
//   模板先例: `src/analytics/domain/repositories/analytics-event.repository.ts` (TD-13).
//
//   关键方法 (方法面只收 service 现有的 6 类调用, 不泛化成通用代理):
//     - listActiveByUser(userId): 未软删事件行 (按 age 升序) —— 列表 + 推演共用
//     - countActiveByUser(userId): 未软删事件数 (解锁口径用)
//     - findActiveById(userId, eventId): 单条未软删事件 (更新 / 软删前的存在性校验)
//     - createEvent(input): 新增事件
//     - saveEvent(input): 更新事件 (7 个可变字段的最终值)
//     - softDeleteEvent(eventId, deletedAt): 软删 (写 deleted_at, 不物理删)
//
//   反双胞胎:
//     - 不用泛型 typeorm 仓储代理 (同上); 面窄才守得住
//     - 不暴露 typeorm 值符号 / 查询选项 / 区间操作符
//     - 不暴露 entity 类 —— 出参用 Row 领域类型
//     - 不给软删留"先查后改"两个口子 —— 软删是**状态迁移**, 端口收成一个方法,
//       由 service 决定迁移时刻 (删除时间戳由 service 生成, 实现只落库)
//
//   如何验证:
//     1. 单元测试用端口替身驱动 service (test/life-map/td16-life-map-port-pilot.spec.ts)
//     2. grep 复核: 端口 / 两个 service / 新 spec 里 typeorm 值符号 0 命中
//   时间戳: 2026-11-14 GMT+8

import type { LifeStage } from '../../../shared/types/practice.types.js';
import type { KeyEventType } from '../../entities/key-event.entity.js';

/** 关键事件类型 (positive / negative / turning) —— 端口重导出, 业务层不必碰 entity 目录. */
export type { KeyEventType };

/**
 * 关键事件行 —— 端口出参 (窄领域类型, 不含 entity 类).
 *
 * 不含 `deletedAt`: 查询口径已过滤软删, 该字段对业务层无用, 不进 Row.
 */
export interface KeyEventRow {
  id: string;
  userId: string;
  title: string;
  /** 事件发生年龄. */
  age: number;
  type: KeyEventType;
  description: string | null;
  feelings: string | null;
  influence: string | null;
  interpretation: string | null;
  stage: LifeStage | null;
  createdAt: Date;
  updatedAt: Date;
}

/** 关键事件新增入参 (8 个业务字段). */
export interface CreateKeyEventInput {
  userId: string;
  title: string;
  age: number;
  type: KeyEventType;
  description: string | null;
  feelings: string | null;
  influence: string | null;
  interpretation: string | null;
  stage: LifeStage | null;
}

/** 关键事件更新入参 —— 在新增入参基础上带 id (7 个可变字段的最终值). */
export interface SaveKeyEventInput extends CreateKeyEventInput {
  id: string;
}

/** 仓储接口契约 —— life-map 域关键事件存储的唯一真相源. */
export interface KeyEventRepository {
  /** 该用户全部**未软删**的事件行 (按 age 升序). */
  listActiveByUser(userId: string): Promise<KeyEventRow[]>;

  /** 该用户**未软删**的事件数. */
  countActiveByUser(userId: string): Promise<number>;

  /** 单条**未软删**事件 (按 id + userId 定位, 越权查不到). */
  findActiveById(userId: string, eventId: string): Promise<KeyEventRow | null>;

  /** 新增一条事件. */
  createEvent(input: CreateKeyEventInput): Promise<KeyEventRow>;

  /** 更新一条既有事件 (写入调用方给定的最终值). */
  saveEvent(input: SaveKeyEventInput): Promise<KeyEventRow>;

  /**
   * 软删一条事件 (写 deleted_at, 不物理删).
   *
   * @param eventId 事件 id
   * @param deletedAt 删除时刻 (由 service 生成 —— 端口不自己取"现在")
   */
  softDeleteEvent(eventId: string, deletedAt: Date): Promise<void>;
}

/** DI token —— NestJS 注入用. */
export const KEY_EVENT_REPOSITORY = Symbol('KEY_EVENT_REPOSITORY');
