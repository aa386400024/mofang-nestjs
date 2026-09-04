// V2026-09-04 治本 (V6.0 §3.1 + audit P0-1):
//   AI 用户画像服务 — 7 维度单维度快照 upsert + 批量拉取.
//   关键反双胞胎: 不写「用户画像评估」逻辑 (那是 V3 由行为数据触发,
//             走 cron + LLM 聚合, 本服务只负责读 + 写).

import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import { Repository } from 'typeorm';

import type { AIProfileDimensionDto, AIProfileDto, UpsertAIProfileDimensionDto } from '../dto/ai-profile.dto';
import { AIProfileCache } from '../entities/ai-profile-cache.entity';
import { AIProfileSource } from '../enums/ai-profile.enums';

/**
 * AI 用户画像服务 — §3.1.
 *
 * 行为:
 *   - getProfile(uid): 一次拉 7 维度 (LEFT JOIN 7 row per uid).
 *   - upsertDimension(uid, dto): 单维度 upsert (on duplicate update payload + source + updated_at).
 *   - batchUpsert(uid, dtos): 多维度 upsert, 内部循环调 upsertRow (DRY).
 *   - 用于: 端侧启动 → 拉服务端权威画像 → 跟本地画像 diff 同步;
 *           端侧评估完成 → 单维度上报; 用户在偏好面板改 → user_override 写.
 */
@Injectable()
export class AIProfileService {
  private readonly logger = new Logger(AIProfileService.name);

  constructor(
    @InjectRepository(AIProfileCache)
    private readonly repo: Repository<AIProfileCache>,
  ) {}

  /**
   * 拉取某用户 7 维度画像 — 端侧冷启动用.
   *
   * 大厂 standard: 即使数据库无该用户, 也要返回空数组 (供前端 0..1 类型保证).
   */
  async getProfile(uid: string): Promise<AIProfileDto> {
    const rows = await this.repo.find({ where: { uid } });
    const dimensions: AIProfileDimensionDto[] = rows.map((row) => ({
      dimension: row.dimension,
      payload: row.payload,
      source: row.source,
      updatedAtMs: row.updatedAt.getTime(),
    }));
    return {
      uid,
      dimensions,
      fetchedAtMs: Date.now(),
    };
  }

  /**
   * 单维度 upsert — (uid, dimension) 唯一约束兜底, 并发写不重复行.
   *
   * V2026-09-04 治本 (smoke 修 x2): typeorm 1.1.1 在 `ai_profile_cache` 实体的
   *   json/enum 字段上有 2 个层叠 bug:
   *     1. `repo.upsert(data, conflictPaths)` 丢字段 (extractUpsertSet 严格按 metadata);
   *     2. `createQueryBuilder().insert().into().values()` 的 metadata 路径
   *        `column.getEntityValue(valueSet)` 对 json/enum 类型返 undefined,
   *        退化成 DEFAULT, 即使 values 对象里有该字段.
   *   表现: SQL 只填 `id` + `uid`, dimension / payload / source 全 DEFAULT,
   *     报 `Field 'payload' doesn't have a default value` (ER_NO_DEFAULT_FOR_FIELD 1364).
   *   修复: 走 raw SQL `INSERT ... ON DUPLICATE KEY UPDATE`, 1 SQL 完成, 行为可预测,
   *     彻底绕开 typeorm 1.x QueryBuilder metadata 玄学. 抽出 upsertRow 复用, 单行
   *     和批量路径走同一治源 (DRY + 行为一致).
   */
  async upsertDimension(uid: string, dto: UpsertAIProfileDimensionDto): Promise<AIProfileDimensionDto> {
    await this.upsertRow(uid, dto);

    const row = await this.repo.findOne({
      where: { uid, dimension: dto.dimension },
    });
    if (!row) {
      this.logger.warn(`upsertDimension: row not found after upsert uid=${uid} dim=${dto.dimension}`);
      return {
        dimension: dto.dimension,
        payload: dto.payload,
        source: dto.source,
        updatedAtMs: Date.now(),
      };
    }

    return {
      dimension: row.dimension,
      payload: row.payload,
      source: row.source,
      updatedAtMs: row.updatedAt.getTime(),
    };
  }

  /**
   * 批量 upsert — 端侧整组画像同步 (冷启动或周维度同步).
   *
   * 反双胞胎: 不写「merge 7 维度」逻辑 — 调用方自己控制覆盖策略
   * (e.g. cloud > local > 旧值). 服务端只负责写库.
   *
   * V2026-09-04 治本 (audit 暴露 TS2345):
   *   原因: 旧实现 `this.repo.upsert(records, ['uid', 'dimension'])` 触发 typeorm 1.x
   *     玄学, payload 字段类型 `Record<string, unknown>` 跟 `_QueryDeepPartialEntity<AIProfileCache>`
   *     的 json 类型 `(() => string) | _QueryDeepPartialEntity<...> | undefined` 不兼容,
   *     TS2345 编译失败; 即便绕过 TS, runtime 也会因 extractUpsertSet 丢字段抛 ER_NO_DEFAULT.
   *   修复: 循环调私有 upsertRow (raw SQL), 7 维度走 7 次 INSERT (并发安全, 单维度
   *     (uid, dimension) 唯一约束兜底). 比单条 batch raw SQL 简单可读, N≤7 完全可接受.
   *   Fallback: dtos 为空时走 getProfile, 行为跟旧实现一致.
   */
  async batchUpsert(uid: string, dtos: UpsertAIProfileDimensionDto[]): Promise<AIProfileDto> {
    if (dtos.length === 0) return this.getProfile(uid);
    for (const d of dtos) {
      await this.upsertRow(uid, d);
    }
    return this.getProfile(uid);
  }

  /**
   * 重置某维度为 user_override (admin 后台或偏好面板改完触发).
   */
  async setUserOverride(
    uid: string,
    dimension: UpsertAIProfileDimensionDto['dimension'],
    payload: Record<string, unknown>,
  ): Promise<AIProfileDimensionDto> {
    return this.upsertDimension(uid, {
      dimension,
      payload,
      source: AIProfileSource.USER_OVERRIDE,
    });
  }

  /**
   * 单维度 raw SQL upsert — 私有治源, 单行/批量路径共享.
   *
   * 设计要点:
   *   - 显式 randomUUID() 生成 id (绕开 typeorm @PrimaryGeneratedColumn('uuid')
   *     在 raw query 路径下不触发的问题).
   *   - JSON.stringify(payload) 是因为 mysql2 driver 不会自动序列化 js 对象;
   *     entity 列类型 `json` 接受 string, driver 端透传 (5.7+ 原生 json 类型).
   *   - ON DUPLICATE KEY UPDATE 只更新 payload + source 两列, 保持跟旧实现语义一致
   *     (updated_at 由 MySQL ON UPDATE CURRENT_TIMESTAMP 列定义托管).
   *   - 不引入 connection.transaction: 单维度独立失败不影响其它维度 (前端可单独重试).
   */
  private async upsertRow(uid: string, dto: UpsertAIProfileDimensionDto): Promise<void> {
    await this.repo.query(
      `INSERT INTO ai_profile_cache (id, uid, dimension, payload, source)
       VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE payload = VALUES(payload), source = VALUES(source)`,
      [randomUUID(), uid, dto.dimension, JSON.stringify(dto.payload), dto.source],
    );
  }
}
