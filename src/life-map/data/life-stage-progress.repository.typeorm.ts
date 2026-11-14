// V2026-11-14 治本 (TD-16 · C1 试点域仓储端口化 · life-map 域 · P-DEBT-11 / L-1):
//   `LifeStageProgressRepository` 端口的 TypeORM 实现 —— life-map 域**唯一**允许出现
//   typeorm 值符号 (Repository / IsNull) 的文件之一; 端口 / 两个 service / 新 spec
//   四处 typeorm 值符号 0 命中 (grep 复核见交付记录 §五).
//
//   治本:
//     - 查询口径全部收在本实现内: userId 隔离 + deletedAt 软删过滤 +
//       "命中 (userId + stage) 则更新、未命中则插入" —— 与改前 service 里写的
//       条件**逐字一致**
//     - 实现不写新口径、不加新条件 —— 本单是结构重构, 不是查询优化
//     - 不暴露 EntityManager / FindOptions 给上层
//
//   反双胞胎:
//     - 不把 entity 行直接漏给 service —— 端口出参是 Row 领域类型
//     - **upsert 的命中判定不带 deletedAt 过滤** —— 与改前 `findOne({ where:
//       { userId, stage } })` 逐字一致 (软删行命中后仍走更新分支, 这是既有口径,
//       本单不改)
//     - 不在实现里吞异常 —— 写失败要冒到 service
//
//   如何验证:
//     1. tsc 0 错; module provider 接线后 life-map 的 12 个 V3.0 端点口径不变
//     2. 单元测试用端口替身驱动 service (不起真 TypeORM / 不连 DB)
//   时间戳: 2026-11-14 GMT+8

import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';

import type {
  LifeStageProgressRepository,
  LifeStageProgressRow,
  SaveStageProgressInput,
} from '../domain/repositories/life-stage-progress.repository.js';
import { LifeStageProgressEntity } from '../entities/life-stage-progress.entity.js';

/**
 * 人生阶段完成度仓储 (TypeORM 真库实现).
 */
@Injectable()
export class LifeStageProgressRepositoryTypeorm implements LifeStageProgressRepository {
  /**
   * @param repo 阶段完成度实体仓储
   */
  constructor(
    @InjectRepository(LifeStageProgressEntity)
    private readonly repo: Repository<LifeStageProgressEntity>,
  ) {}

  /**
   * 该用户全部**未软删**的阶段完成度行.
   *
   * @param userId 用户隔离
   * @returns 行数组 (无命中返空数组)
   */
  async listActiveByUser(userId: string): Promise<LifeStageProgressRow[]> {
    const rows = await this.repo.find({
      where: { userId, deletedAt: IsNull() },
    });
    return rows.map(toRow);
  }

  /**
   * 写阶段完成度 —— 命中 (userId + stage) 则更新, 未命中则插入.
   *
   * @param input 4 个业务字段
   * @returns 落库后的行
   */
  async saveProgress(input: SaveStageProgressInput): Promise<LifeStageProgressRow> {
    const existing = await this.repo.findOne({
      where: { userId: input.userId, stage: input.stage },
    });

    const row = existing
      ? Object.assign(existing, {
          completionPct: input.completionPct,
          stuckPoints: input.stuckPoints ?? existing.stuckPoints ?? null,
          gains: input.gains ?? existing.gains ?? null,
        })
      : this.repo.create({
          userId: input.userId,
          stage: input.stage,
          completionPct: input.completionPct,
          stuckPoints: input.stuckPoints ?? null,
          gains: input.gains ?? null,
        });

    const saved = await this.repo.save(row);
    return toRow(saved);
  }
}

/** entity → Row 映射 (窄字段, 不带 deletedAt). */
function toRow(entity: LifeStageProgressEntity): LifeStageProgressRow {
  return {
    id: entity.id,
    userId: entity.userId,
    stage: entity.stage,
    completionPct: entity.completionPct,
    stuckPoints: entity.stuckPoints ?? null,
    gains: entity.gains ?? null,
    createdAt: entity.createdAt,
    updatedAt: entity.updatedAt,
  };
}
