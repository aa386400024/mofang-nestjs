// V2026-10-15 治本 (V3.5 — ability.service.ts, 4 method 业务逻辑):
//   原因: counselor-mode-v1.0 §6.3 拍板 7 维度 28 子指标 + user 聚合, V0.3 §13 baseline
//     0 子指标 service (V0.x AIProfileSnapshot 7 维度是 json 字段), 1:1 wire 0 破坏.
//     V0.5 阶段 4 method: listDimensions / findDimensionByCode / getUserProfile /
//     upsertScore. V0.5 阶段不接 W3-4 supervision.service 自动累加 (避免 scope 蔓延),
//     V1.x 续做时 W3-4 service.generateFeedback 完成后回调 ability.service.upsertScore.
//
//   修法 (跟 W1-2 long-term-case.service.ts + W3-4 supervision.service.ts 风格一致):
//     - 4 method: listDimensions / findDimensionByCode / getUserProfile / upsertScore
//     - listDimensions(parentDimension?): 28 子指标 list (从 DB 读, isActive=1, 软删过滤,
//       按 displayOrder 升序; 可选按 7 维度 enum 过滤)
//     - findDimensionByCode(code): 单子指标详情 (含 description, UI 详情用)
//     - getUserProfile(userId): user 28 子指标 score 聚合 + 7 维度平均分 + 总体平均分
//       (UI 雷达图 7 主轴 + 28 标签 + 总体分数 3 视图)
//     - upsertScore(userId, input): 手动 upsert (UNIQUE (user_id, dimension_id) upsert,
//       V0.5 阶段不接 W3-4 supervision_feedback 自动累加)
//
//   反双胞胎:
//     - V0.5 阶段不接 W3-4 supervision.service 自动累加: 避免 V0.5 scope 蔓延, V1.x 续做
//       时 W3-4 service.generateFeedback 完成后回调 ability.service.upsertScore
//     - 不复用 V0.x AIProfileSnapshot 7 维度: 28 子指标粒度更细, 1:1 wire 增量
//     - 不用 ML 聚合算法: V0.x 阶段简单算术平均, V2.x 升级 LLM 推理时再切
//     - 不存 vector 字段: V0.x 阶段不接 RAG, V2.x 升级再切
//
//   5 段治本 (V3.5 聚合公式):
//     - 维度平均分 = 该维度所有子指标 score 算术平均 (有 score 的子指标, 没 score 跳过)
//     - 总体平均分 = 28 子指标 score 算术平均
//     - 0 score 表示暂无数据, UI 显示灰色 (跟 V0.x AIProfileSnapshot 0.0 风格一致)
//
//   验证:
//     1. tsc 0 错 (4 method 字段 type 严格)
//     2. 大炮跑 pnpm migration:run + curl 验 3 endpoint 端到端
//     3. integration: 28 子指标 list / 详情含 description / 手动 upsert / 聚合 profile
//
//   时间戳: 2026-10-15

import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository, type FindOptionsWhere } from 'typeorm';

import {
  type AbilityDimensionAvgDto,
  type AbilityDimensionDetailDto,
  type AbilityDimensionListItemDto,
  type AbilityProfileDto,
  type AbilityScoreItemDto,
  type UpsertAbilityScoreDto,
} from '../dto/ability.dto';
import { AbilityDimension } from '../entities/ability-dimension.entity';
import { AbilityScore, type AbilityScoreEvidence } from '../entities/ability-score.entity';
import { AbilityParentDimension } from '../enums/ability-parent-dimension.enum';

/**
 * V2026-10-15 (V1.x counselor-mode W5-6 — AbilityService):
 *   7 维度 28 子指标 + user 聚合 score 业务逻辑.
 *
 *   跟 xin_su_app AbilityBloc + AbilityRepository 端到端 1:1 对应.
 *   V0.5 阶段: 4 method + 手动 upsert, V1.x 续做: 接 W3-4 supervision_feedback 自动累加.
 */
@Injectable()
export class AbilityService {
  constructor(
    @InjectRepository(AbilityDimension)
    private readonly dimensionRepo: Repository<AbilityDimension>,
    @InjectRepository(AbilityScore)
    private readonly scoreRepo: Repository<AbilityScore>,
  ) {}

  // ══════════════════════════════════════════════════════════════════════════
  // 1. listDimensions — 28 子指标 list (从 DB 读, 软删过滤, 按 displayOrder 升序)
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * GET /counselor/ability/dimensions 主入口.
   *
   * @param parentDimension 可选按 7 维度 enum 过滤
   * @returns 28 子指标 list (按 displayOrder 升序, UI 雷达图 28 标签排序)
   */
  async listDimensions(parentDimension?: AbilityParentDimension): Promise<AbilityDimensionListItemDto[]> {
    const where: FindOptionsWhere<AbilityDimension> = {
      isActive: 1,
      deletedAt: IsNull(),
    };
    if (parentDimension) {
      where.parentDimension = parentDimension;
    }
    const rows = await this.dimensionRepo.find({ where, order: { displayOrder: 'ASC' } });
    return rows.map((r) => this.toDimensionListItem(r));
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 2. findDimensionByCode — 单子指标详情 (含 description, UI 详情用)
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * GET /counselor/ability/dimensions/:code 主入口.
   *
   * @param code 28 子指标 code (DB UNIQUE)
   * @returns 单子指标详情 (含 description)
   */
  async findDimensionByCode(code: string): Promise<AbilityDimensionDetailDto> {
    const row = await this.dimensionRepo.findOne({
      where: { subIndicatorCode: code, deletedAt: IsNull() },
    });
    if (!row) {
      throw new NotFoundException(`子指标 ${code} 不存在`);
    }
    return { ...this.toDimensionListItem(row), description: row.description };
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 3. getUserProfile — user 28 子指标 score 聚合 + 7 维度平均分 + 总体平均分
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * GET /counselor/ability/profile 主入口.
   *
   * @param userId 当前用户 id
   * @returns user 聚合 profile (28 子指标 score + 7 维度平均分 + 总体平均分)
   */
  async getUserProfile(userId: string): Promise<AbilityProfileDto> {
    // 1. 查 28 子指标 (从 DB 读, 软删过滤, 按 displayOrder 升序)
    const allDimensions = await this.dimensionRepo.find({
      where: { isActive: 1, deletedAt: IsNull() },
      order: { displayOrder: 'ASC' },
    });

    // 2. 查 user 已有 score (1 user 最多 28 行)
    const userScores = await this.scoreRepo.find({
      where: { userId, deletedAt: IsNull() },
    });

    // 3. 拼成 AbilityScoreItemDto[] (28 行, 没 score 的填 0)
    const scoreMap = new Map<string, AbilityScore>();
    for (const s of userScores) {
      scoreMap.set(s.dimensionId, s);
    }
    const scores: AbilityScoreItemDto[] = allDimensions.map((d) => {
      const s = scoreMap.get(d.id);
      return {
        dimensionId: d.id,
        subIndicatorCode: d.subIndicatorCode,
        subIndicatorName: d.subIndicatorName,
        parentDimension: d.parentDimension,
        score: s?.score ?? 0,
        source: s?.source ?? 'cloud',
        displayOrder: d.displayOrder,
      };
    });

    // 4. 算 7 维度平均分 (有 score 的子指标算平均, 没 score 跳过)
    const dimensionAverages: AbilityDimensionAvgDto[] = this.computeDimensionAverages(scores);

    // 5. 算总体平均分 (28 子指标 score 算术平均, score > 0 才有意义)
    const overallAverage = this.computeOverallAverage(scores);

    return { userId, scores, dimensionAverages, overallAverage };
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 4. upsertScore — 手动 upsert (V0.5 阶段不接 W3-4 supervision.service 自动累加)
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * POST /counselor/ability/score 主入口.
   *
   * @param userId 当前用户 id
   * @param input 手动 upsert 输入 (dimensionId + score + source + evidenceSessionIds)
   * @returns 1 子指标最新 score (跟 upsert 输入 1:1)
   */
  async upsertScore(userId: string, input: UpsertAbilityScoreDto): Promise<{ dimensionId: string; score: number; source: string }> {
    // 1. 校验 dimensionId 存在
    const dimension = await this.dimensionRepo.findOne({
      where: { id: input.dimensionId, isActive: 1, deletedAt: IsNull() },
    });
    if (!dimension) {
      throw new NotFoundException(`子指标 ${input.dimensionId} 不存在或已下线`);
    }

    // 2. 查是否已有 score (UNIQUE (user_id, dimension_id) 配对, 走 upsert)
    const existing = await this.scoreRepo.findOne({
      where: { userId, dimensionId: input.dimensionId, deletedAt: IsNull() },
    });

    // 3. 拼 evidence
    const evidence: AbilityScoreEvidence | null = input.evidenceSessionIds
      ? { sessionIds: input.evidenceSessionIds, lastUpdatedAt: new Date().toISOString() }
      : (existing?.evidence ?? null);

    // 4. upsert: 已有更新, 没新插入
    if (existing) {
      existing.score = input.score;
      existing.source = input.source ?? existing.source;
      existing.evidence = evidence;
      await this.scoreRepo.save(existing);
    } else {
      await this.scoreRepo.save(
        this.scoreRepo.create({
          tenantId: userId,
          userId,
          dimensionId: input.dimensionId,
          score: input.score,
          source: input.source ?? 'cloud',
          evidence,
        }),
      );
    }

    return { dimensionId: input.dimensionId, score: input.score, source: input.source ?? 'cloud' };
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 私有 helper: 7 维度平均分聚合
  // ══════════════════════════════════════════════════════════════════════════

  private computeDimensionAverages(scores: AbilityScoreItemDto[]): AbilityDimensionAvgDto[] {
    const groups = new Map<AbilityParentDimension, number[]>();
    for (const s of scores) {
      if (s.score > 0) {
        // 跳过 0 score (暂无数据)
        const list = groups.get(s.parentDimension) ?? [];
        list.push(s.score);
        groups.set(s.parentDimension, list);
      }
    }
    const averages: AbilityDimensionAvgDto[] = [];
    for (const dim of Object.values(AbilityParentDimension)) {
      const list = groups.get(dim) ?? [];
      const averageScore = list.length > 0 ? Math.round(list.reduce((a, b) => a + b, 0) / list.length) : 0;
      averages.push({ parentDimension: dim, averageScore, subIndicatorCount: list.length });
    }
    return averages;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 私有 helper: 总体平均分聚合
  // ══════════════════════════════════════════════════════════════════════════

  private computeOverallAverage(scores: AbilityScoreItemDto[]): number {
    const valid = scores.filter((s) => s.score > 0);
    if (valid.length === 0) return 0;
    return Math.round(valid.reduce((a, b) => a + b.score, 0) / valid.length);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 私有 mapper: entity → DTO
  // ══════════════════════════════════════════════════════════════════════════

  private toDimensionListItem(r: AbilityDimension): AbilityDimensionListItemDto {
    return {
      id: r.id,
      parentDimension: r.parentDimension,
      subIndicatorCode: r.subIndicatorCode,
      subIndicatorName: r.subIndicatorName,
      displayOrder: r.displayOrder,
      isActive: r.isActive === 1,
    };
  }
}
