// V2026-11-14 治本 (TD-16 · C1 试点域仓储端口化 · life-map 域 · P-DEBT-11 / L-1):
//   `GenomeDimensionRepository` 端口的 TypeORM 实现 —— 域内 typeorm 值符号落点之一.
//
//   治本:
//     - 查询口径全部收在本实现内: userId 隔离 + deletedAt 软删过滤 —— 与改前
//       service 里写的条件**逐字一致**
//     - "命中 (userId + key) 则更新、未命中则插入" 与改前逐字一致
//     - **tier 由 service 算好传进来** —— 等级推导是业务规则, 实现不自己算
//     - 实现不写新口径、不加新条件; 不暴露 EntityManager / FindOptions 给上层
//
//   反双胞胎:
//     - 不把 entity 行直接漏给 service —— 端口出参是 Row 领域类型
//     - 不在实现里吞异常 —— 写失败要冒到 service
//
//   如何验证:
//     1. tsc 0 错; module provider 接线后 life-map 的基因盘点端点口径不变
//     2. 单元测试用端口替身驱动 service (不起真 TypeORM / 不连 DB)
//   时间戳: 2026-11-14 GMT+8

import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';

import type {
  GenomeDimensionRepository,
  GenomeDimensionRow,
  SaveGenomeDimensionInput,
} from '../domain/repositories/genome-dimension.repository.js';
import { GenomeDimensionEntity } from '../entities/genome-dimension.entity.js';

/**
 * 心理基因维度仓储 (TypeORM 真库实现).
 */
@Injectable()
export class GenomeDimensionRepositoryTypeorm implements GenomeDimensionRepository {
  /**
   * @param repo 心理基因维度实体仓储
   */
  constructor(
    @InjectRepository(GenomeDimensionEntity)
    private readonly repo: Repository<GenomeDimensionEntity>,
  ) {}

  /**
   * 该用户全部**未软删**的维度行.
   *
   * @param userId 用户隔离
   * @returns 行数组 (无命中返空数组)
   */
  async listActiveByUser(userId: string): Promise<GenomeDimensionRow[]> {
    const rows = await this.repo.find({
      where: { userId, deletedAt: IsNull() },
    });
    return rows.map(toRow);
  }

  /**
   * 该用户**未软删**的维度数.
   *
   * @param userId 用户隔离
   * @returns 命中条数 (无命中返 0)
   */
  async countActiveByUser(userId: string): Promise<number> {
    return this.repo.count({
      where: { userId, deletedAt: IsNull() },
    });
  }

  /**
   * 写维度 —— 命中 (userId + key) 则更新, 未命中则插入.
   *
   * @param input 5 个业务字段
   * @returns 落库后的行
   */
  async saveDimension(input: SaveGenomeDimensionInput): Promise<GenomeDimensionRow> {
    const existing = await this.repo.findOne({
      where: { userId: input.userId, key: input.key },
    });

    const row = existing
      ? Object.assign(existing, {
          score: input.score,
          tier: input.tier,
          source: input.source ?? existing.source ?? null,
          improvement: input.improvement ?? existing.improvement ?? null,
        })
      : this.repo.create({
          userId: input.userId,
          key: input.key,
          score: input.score,
          tier: input.tier,
          source: input.source ?? null,
          improvement: input.improvement ?? null,
        });

    const saved = await this.repo.save(row);
    return toRow(saved);
  }
}

/** entity → Row 映射 (窄字段, 不带 deletedAt). */
function toRow(entity: GenomeDimensionEntity): GenomeDimensionRow {
  return {
    id: entity.id,
    userId: entity.userId,
    key: entity.key,
    score: entity.score,
    tier: entity.tier,
    source: entity.source ?? null,
    improvement: entity.improvement ?? null,
    createdAt: entity.createdAt,
    updatedAt: entity.updatedAt,
  };
}
