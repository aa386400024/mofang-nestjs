// V2026-11-14 治本 (TD-16 · C1 试点域仓储端口化 · life-map 域 · P-DEBT-11 / L-1):
//   抽象: `LifeMapService` 的心理基因维度表访问收进本端口 (interface + Symbol token),
//     TypeORM 实现收进 `data/genome-dimension.repository.typeorm.ts`.
//
//   模板先例: `src/analytics/domain/repositories/analytics-event.repository.ts` (TD-13).
//
//   关键方法 (方法面只收 service 现有的 4 处调用, 不泛化成通用代理):
//     - listActiveByUser(userId): 未软删维度行 (列表 + 推演 + 报告共用)
//     - countActiveByUser(userId): 未软删维度数 (解锁口径用)
//     - saveDimension(input): 维度写入 —— 命中 (userId + key) 则更新, 未命中则插入
//
//   反双胞胎:
//     - 不用泛型 typeorm 仓储代理 (同上); 面窄才守得住
//     - 不暴露 typeorm 值符号 / 查询选项 / 区间操作符
//     - 不暴露 entity 类 —— 出参用 Row 领域类型
//     - **等级 (tier) 由 service 算** —— `calcTier` 是业务规则不是持久化规则,
//       端口只负责落库给定的 tier, 不自己推导
//
//   如何验证:
//     1. 单元测试用端口替身驱动 service (test/life-map/td16-life-map-port-pilot.spec.ts)
//     2. grep 复核: 端口 / 两个 service / 新 spec 里 typeorm 值符号 0 命中
//   时间戳: 2026-11-14 GMT+8

import type { GenomeDimensionKey } from '../../entities/genome-dimension.entity.js';

/** 心理基因维度标识 (security / self_esteem / autonomy / resilience / self_integration) —— 端口重导出. */
export type { GenomeDimensionKey };

/** 心理基因维度等级 (score 0-100 对应的四档). */
export type GenomeDimensionTier = 'gentle' | 'balanced' | 'stable' | 'strong';

/**
 * 心理基因维度行 —— 端口出参 (窄领域类型, 不含 entity 类).
 *
 * 不含 `deletedAt`: 查询口径已过滤软删, 该字段对业务层无用, 不进 Row.
 */
export interface GenomeDimensionRow {
  id: string;
  userId: string;
  key: GenomeDimensionKey;
  /** 维度得分 0-100. */
  score: number;
  tier: GenomeDimensionTier;
  source: string | null;
  improvement: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/** 心理基因维度写入入参 (5 个业务字段). */
export interface SaveGenomeDimensionInput {
  userId: string;
  key: GenomeDimensionKey;
  score: number;
  tier: GenomeDimensionTier;
  /** 缺省 undefined = 命中已有行时**保留原值** (与改前口径逐字一致). */
  source?: string | null;
  improvement?: string | null;
}

/** 仓储接口契约 —— life-map 域心理基因维度存储的唯一真相源. */
export interface GenomeDimensionRepository {
  /** 该用户全部**未软删**的维度行. */
  listActiveByUser(userId: string): Promise<GenomeDimensionRow[]>;

  /** 该用户**未软删**的维度数. */
  countActiveByUser(userId: string): Promise<number>;

  /** 写维度 —— 命中 (userId + key) 则更新, 未命中则插入. */
  saveDimension(input: SaveGenomeDimensionInput): Promise<GenomeDimensionRow>;
}

/** DI token —— NestJS 注入用. */
export const GENOME_DIMENSION_REPOSITORY = Symbol('GENOME_DIMENSION_REPOSITORY');
