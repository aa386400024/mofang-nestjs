// V2026-09-04 治本 (V6.0 §3.4 + audit P0-1):
//   AI 干预效果服务 — 短 / 中 / 长 3 维效果追踪.
//   关键反双胞胎:
//     - 短效: 客户端 POST 上报 (单条 record).
//     - 中效 / 长效: cron 周期聚合 (本服务 V3 接 cron 写入, V2 占位).
//     - 不重复 dashboard 模块的 weekly / milestones 聚合.

import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import type { AIEffectHistoryDto, AIEffectRecordDto, RecordImmediateEffectDto } from '../dto/ai-effect.dto';
import { AIEffectRecordEntity } from '../entities/ai-effect-record.entity';
import { AIEffectHorizon } from '../enums/ai-effect.enums';

/**
 * AI 干预效果服务 — §3.4.
 *
 * 大厂 standard:
 *   - 短效 (immediate): 上报即写, 单 row.
 *   - 中效 / 长效 (weekly / monthly): cron 周期聚合, 一次 UPDATE 多 row.
 *   - 客户端不能直接写 weekly / monthly 字段 (API 不暴露) — 防止作弊.
 */
@Injectable()
export class AIEffectService {
  constructor(
    @InjectRepository(AIEffectRecordEntity)
    private readonly repo: Repository<AIEffectRecordEntity>,
  ) {}

  /**
   * 短效上报 — 端侧练习结束后调用.
   */
  async recordImmediate(uid: string, dto: RecordImmediateEffectDto): Promise<AIEffectRecordDto> {
    const row = this.repo.create({
      uid,
      toolId: dto.toolId,
      sessionId: dto.sessionId,
      horizon: AIEffectHorizon.IMMEDIATE,
      intensityBefore: dto.intensityBefore,
      intensityAfter: dto.intensityAfter,
      moodScore: dto.moodScore?.toFixed(2) ?? null,
      context: dto.context ?? null,
    });
    const saved = await this.repo.save(row);
    return this.toDto(saved);
  }

  /**
   * 查询用户效果历史 — §3.4 趋势面板 + unlock 算法底层数据源.
   *
   * 支持按工具 / 按时间窗口过滤. V2 默认返回近 30 天.
   */
  async getHistory(uid: string, options?: { toolId?: string; sinceMs?: number; limit?: number }): Promise<AIEffectHistoryDto> {
    const qb = this.repo.createQueryBuilder('r').where('r.uid = :uid', { uid });

    if (options?.toolId) {
      qb.andWhere('r.tool_id = :toolId', { toolId: options.toolId });
    }
    if (options?.sinceMs) {
      qb.andWhere('r.recorded_at >= :since', {
        since: new Date(options.sinceMs),
      });
    }

    qb.orderBy('r.recorded_at', 'DESC').limit(options?.limit ?? 100);

    const rows = await qb.getMany();
    return {
      items: rows.map((r) => this.toDto(r)),
      total: rows.length,
    };
  }

  /**
   * 工具效果统计 — §3.4 同类推荐降权 / 切换方案 / 专业转介数据源.
   *
   * 返回: 工具 id → { sampleCount, avgImmediateDelta, positiveRate }.
   * V3 接 cron 周期调用, V2 实时聚合 (30 天数据).
   */
  async getToolEffectStats(
    uid: string,
    toolId: string,
    windowDays = 30,
  ): Promise<{
    toolId: string;
    sampleCount: number;
    avgImmediateDelta: number | null;
    positiveRate: number | null;
  }> {
    const since = new Date(Date.now() - windowDays * 24 * 3600 * 1000);
    const rows = await this.repo
      .createQueryBuilder('r')
      .where('r.uid = :uid', { uid })
      .andWhere('r.tool_id = :toolId', { toolId })
      .andWhere('r.recorded_at >= :since', { since })
      .andWhere('r.horizon = :horizon', { horizon: AIEffectHorizon.IMMEDIATE })
      .andWhere('r.intensity_before IS NOT NULL')
      .andWhere('r.intensity_after IS NOT NULL')
      .getMany();

    if (rows.length === 0) {
      return { toolId, sampleCount: 0, avgImmediateDelta: null, positiveRate: null };
    }

    const deltas = rows.map((r) => (r.intensityBefore ?? 0) - (r.intensityAfter ?? 0));
    const avgDelta = deltas.reduce((s, d) => s + d, 0) / deltas.length;
    const positiveCount = deltas.filter((d) => d > 0).length;

    return {
      toolId,
      sampleCount: rows.length,
      avgImmediateDelta: Math.round(avgDelta * 100) / 100,
      positiveRate: Math.round((positiveCount / rows.length) * 100) / 100,
    };
  }

  private toDto(row: AIEffectRecordEntity): AIEffectRecordDto {
    return {
      horizon: row.horizon,
      toolId: row.toolId,
      sessionId: row.sessionId,
      intensityBefore: row.intensityBefore,
      intensityAfter: row.intensityAfter,
      moodScore: row.moodScore ? Number.parseFloat(row.moodScore) : null,
      weeklyDelta: row.weeklyDelta ? Number.parseFloat(row.weeklyDelta) : null,
      monthlyDelta: row.monthlyDelta ? Number.parseFloat(row.monthlyDelta) : null,
      gamificationEngagement: row.gamificationEngagement ? Number.parseFloat(row.gamificationEngagement) : null,
      recordedAtMs: row.recordedAt.getTime(),
    };
  }
}
