// V2026-11-14 治本 (TD-16 · C1 试点域仓储端口化 · life-map 域 · P-DEBT-11 / L-1):
//   抽象: V6.0 漂流瓶仓储 —— 把原先手写的 `@Injectable()` 仓储类提为**独立端口**
//     (interface + Symbol token), TypeORM 实现收进
//     `data/drift-bottle.repository.typeorm.ts`; `DriftBottleService` 只依赖端口,
//     不再值位置 import entity 类.
//
//   模板先例: `src/analytics/domain/repositories/analytics-event.repository.ts` (TD-13).
//
//   端口划分粒度 (TD-16 判定): 漂流瓶**独立端口** —— 它是 V6.0 的独立业务域
//     (自己的三态状态机 + 自己的实体 + 无跨模块消费), 与 V3.0 心理地图三张表
//     没有共享查询口径, 合进一个端口只会让方法面变宽.
//
//   关键方法 (方法面只收 service 现有的 8 处调用, 不泛化成通用代理):
//     - create(input): 投瓶 (status 由实现置为 DRIFT)
//     - findById(id): 按 id 查 (回信前校验用)
//     - pickRandomExcluding(currentUserId, excludeIds): 随机捞 1 封
//     - findSea(currentUserId): 海面列表
//     - findMine(currentUserId): 我投过的
//     - findInbox(currentUserId): 我收到的回信
//     - getStats(currentUserId): 4 个 counter
//     - markPicked(id, input) / markResponded(id, input): 两段状态迁移
//
//   反双胞胎:
//     - **不暴露 `update(id, patch: Partial<...>)`** —— 改前那个泛型 patch 接口把
//       entity 类型漏进了业务层 (Partial<DriftBottleEntry>), 端口化时收成两段
//       **具名状态迁移** (markPicked / markResponded): 面更窄, 状态机写死在端口上
//     - 不用泛型 typeorm 仓储代理; 不暴露 typeorm 值符号 / 查询选项
//     - 不暴露 entity 类 —— 出参用 Row 领域类型
//     - **计数口径不外泄** —— 4 个 counter 由实现算好, service 拿数不做查询拼接
//
//   如何验证:
//     1. 单元测试用端口替身驱动 service (test/life-map/td16-life-map-port-pilot.spec.ts)
//     2. grep 复核: 端口 / 两个 service / 新 spec 里 typeorm 值符号 0 命中
//   时间戳: 2026-11-14 GMT+8

import type { DriftBottleStatus } from '../../enums/drift-bottle-status.enum.js';

/** 漂流瓶状态 (DRIFT / PICKED / RESPONDED) —— 端口重导出, 业务层不必碰 enum 目录. */
export type { DriftBottleStatus };

/** 漂流瓶行 —— 端口出参 (窄领域类型, 不含 entity 类). */
export interface DriftBottleRow {
  id: string;
  authorId: string;
  authorAnonymousName: string;
  content: string;
  status: DriftBottleStatus;
  pickedByUserId: string | null;
  pickedByAnonymousName: string | null;
  pickedAt: Date | null;
  respondedText: string | null;
  respondedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/** 投瓶入参 (3 个业务字段; status 由实现置为 DRIFT). */
export interface CreateDriftBottleInput {
  authorId: string;
  authorAnonymousName: string;
  content: string;
}

/** 捞起迁移入参 (状态迁移由实现落 PICKED). */
export interface MarkBottlePickedInput {
  pickedByUserId: string;
  pickedByAnonymousName: string;
  pickedAt: Date;
}

/** 回信迁移入参 (状态迁移由实现落 RESPONDED). */
export interface MarkBottleRespondedInput {
  respondedText: string;
  respondedAt: Date;
}

/** 漂流瓶 4 个 counter —— 端口出参 (窄领域类型, 不复用 DTO 类). */
export interface DriftBottleStats {
  /** 海面飘着的瓶数 (别人投的, drift 状态). */
  seaCount: number;
  /** 我投出的总数 (drift + picked + responded 全算). */
  myPostedCount: number;
  /** 我捞起来读过的数. */
  myPickedCount: number;
  /** 我给作者写过回信的数. */
  myRespondedCount: number;
}

/** 仓储接口契约 —— life-map 域 V6.0 漂流瓶存储的唯一真相源. */
export interface DriftBottleRepository {
  /** 投一个新瓶 (status 落 DRIFT). */
  create(input: CreateDriftBottleInput): Promise<DriftBottleRow>;

  /** 按 id 查一瓶 (无命中返 null). */
  findById(id: string): Promise<DriftBottleRow | null>;

  /** 随机捞 1 封 (排除自己的 + 排除最近捞过的; 海面空返 null). */
  pickRandomExcluding(currentUserId: string, excludeIds: string[]): Promise<DriftBottleRow | null>;

  /** 海面列表 (DRIFT + 我自己被捞的 PICKED, 按 createdAt 倒序). */
  findSea(currentUserId: string): Promise<DriftBottleRow[]>;

  /** 我投过的瓶子 (按 createdAt 倒序). */
  findMine(currentUserId: string): Promise<DriftBottleRow[]>;

  /** 我收到的回信 (按 respondedAt 倒序). */
  findInbox(currentUserId: string): Promise<DriftBottleRow[]>;

  /** 4 个 counter 统计. */
  getStats(currentUserId: string): Promise<DriftBottleStats>;

  /** 状态迁移: DRIFT → PICKED (标记捞起者). */
  markPicked(id: string, input: MarkBottlePickedInput): Promise<DriftBottleRow>;

  /** 状态迁移: PICKED → RESPONDED (写回信). */
  markResponded(id: string, input: MarkBottleRespondedInput): Promise<DriftBottleRow>;
}

/** DI token —— NestJS 注入用. */
export const DRIFT_BOTTLE_REPOSITORY = Symbol('DRIFT_BOTTLE_REPOSITORY');
