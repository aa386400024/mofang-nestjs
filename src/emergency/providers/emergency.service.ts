// V2026-09-04 治本 (V6.0 §4.2 + audit P0-3):
//   急救会话上报服务 — 前端 EmergencyBloc 完成时同步上抛, 跨设备同步 + 趋势分析.
//   关键反双胞胎: 不写「急救工具执行」逻辑 (那是前端 EmergencyBloc + 5 工具页),
//             本服务只负责接收上报 + 趋势查询.

import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import type { EmergencySessionDto, EmergencySessionListDto, UpsertEmergencySessionDto } from '../dto/emergency.dto';
import { EmergencySessionEntity } from '../entities/emergency-session.entity';

@Injectable()
export class EmergencyService {
  private readonly logger = new Logger(EmergencyService.name);

  constructor(
    @InjectRepository(EmergencySessionEntity)
    private readonly repo: Repository<EmergencySessionEntity>,
  ) {}

  /**
   * Upsert 单条急救会话 — id 用前端 UUID, 重复 POST 幂等.
   *
   * V2026-09-04 治本 (audit 暴露 TS2345):
   *   原因: 旧实现 `this.repo.upsert({ ..., context: dto.context as unknown as object }, ['id'])`
   *     触发 typeorm 1.x 玄学: context 字段类型 `Record<string, unknown> | null` 跟
   *     `_QueryDeepPartialEntity<EmergencySessionEntity>` 的 json 列类型不兼容,
   *     TS2345 编译失败; 即便绕过 TS, runtime extractUpsertSet 也会丢字段.
   *   修复: 走 raw SQL `INSERT ... ON DUPLICATE KEY UPDATE`. id 来自 dto (前端 UUID),
   *     显式传入; context nullable 列存 NULL 或 JSON.stringify 字符串.
   *   Fallback: dto.context 为 null 时 SQL 列存 NULL, 跟 entity 列 nullable 对齐.
   *   跟 ai_profile.service.ts.upsertRow / game-unlock.service.ts.upsert 同模式,
   *   整个 mofang-nestjs 走统一 raw SQL 治源.
   */
  async upsert(uid: string, dto: UpsertEmergencySessionDto): Promise<EmergencySessionDto> {
    await this.repo.query(
      `INSERT INTO emergency_sessions
         (id, uid, tool_kind, phase, intensity_before, intensity_after,
          stages_completed, started_at_ms, completed_at_ms, notes, context)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         phase = VALUES(phase),
         intensity_before = VALUES(intensity_before),
         intensity_after = VALUES(intensity_after),
         stages_completed = VALUES(stages_completed),
         completed_at_ms = VALUES(completed_at_ms),
         notes = VALUES(notes),
         context = VALUES(context)`,
      [
        dto.id,
        uid,
        dto.toolKind,
        dto.phase,
        dto.intensityBefore,
        dto.intensityAfter,
        dto.stagesCompleted,
        dto.startedAtMs.toString(),
        dto.completedAtMs?.toString() ?? null,
        dto.notes,
        dto.context === null ? null : JSON.stringify(dto.context),
      ],
    );
    const row = await this.repo.findOne({ where: { id: dto.id } });
    if (!row) {
      throw new Error(`Emergency session upsert failed id=${dto.id}`);
    }
    this.logger.debug(`upsert emergency uid=${uid} id=${dto.id} phase=${dto.phase}`);
    return this.toDto(row);
  }

  /**
   * 列出某用户急救会话 — 跨设备同步用.
   */
  async list(uid: string, options?: { sinceMs?: number; limit?: number }): Promise<EmergencySessionListDto> {
    const qb = this.repo.createQueryBuilder('e').where('e.uid = :uid', { uid });
    if (options?.sinceMs !== undefined) {
      qb.andWhere('e.started_at_ms >= :since', { since: options.sinceMs.toString() });
    }
    qb.orderBy('e.started_at_ms', 'DESC').limit(options?.limit ?? 100);
    const rows = await qb.getMany();
    return {
      items: rows.map((r) => this.toDto(r)),
      total: rows.length,
    };
  }

  /**
   * 单条 — 详情面板 / 调试用.
   */
  async getOne(uid: string, id: string): Promise<EmergencySessionDto | null> {
    const row = await this.repo.findOne({ where: { id, uid } });
    return row ? this.toDto(row) : null;
  }

  /**
   * 急救工具效果统计 (§3.4) — AI 解锁引擎降权数据源.
   *
   * 窗口内 (默认 30 天) 按 tool_kind 聚合:
   *   - sampleCount: 会话总数
   *   - avgIntensityDelta: 平均强度差 (intensity_after - intensity_before), null 表示全无评分
   *   - completionRate: 完成率 (phase=completed / total)
   *
   * V2026-09-04 治本 (audit tsc 暴露): 旧 controller 引用 `this.service.getToolStats`,
   *   服务端从未实装, controller 调不到. 补齐 + 大厂 standard SQL 聚合.
   *
   * Fallback: uid 无会话返空数组, 跟其它 list API 行为一致.
   */
  async getToolStats(
    uid: string,
    windowDays = 30,
  ): Promise<
    {
      toolKind: string;
      sampleCount: number;
      avgIntensityDelta: number | null;
      completionRate: number;
    }[]
  > {
    const sinceMs = Date.now() - windowDays * 24 * 60 * 60 * 1000;
    // 大厂 standard SQL 聚合 — 不依赖 typeorm QueryBuilder 玄学, raw query 行为可预测.
    // COALESCE 处理全无评分的 tool_kind (AVG 返 NULL).
    // completion_rate 用 SUM(CASE WHEN ...)/COUNT 避免 AVG(phase='completed') 类型不匹配.
    const rows: {
      tool_kind: string;
      sample_count: number;
      avg_intensity_delta: number | null;
      completion_rate: number;
    }[] = await this.repo.query(
      `SELECT
         tool_kind,
         COUNT(*) AS sample_count,
         AVG(intensity_after - intensity_before) AS avg_intensity_delta,
         SUM(CASE WHEN phase = 'completed' THEN 1 ELSE 0 END) * 1.0 / COUNT(*) AS completion_rate
       FROM emergency_sessions
       WHERE uid = ? AND started_at_ms >= ?
       GROUP BY tool_kind
       ORDER BY tool_kind ASC`,
      [uid, sinceMs.toString()],
    );
    return rows.map((r) => ({
      toolKind: r.tool_kind,
      sampleCount: Number(r.sample_count),
      avgIntensityDelta: r.avg_intensity_delta === null ? null : Number(r.avg_intensity_delta),
      completionRate: Number(r.completion_rate),
    }));
  }

  private toDto(row: EmergencySessionEntity): EmergencySessionDto {
    return {
      id: row.id,
      uid: row.uid,
      toolKind: row.toolKind,
      phase: row.phase,
      intensityBefore: row.intensityBefore,
      intensityAfter: row.intensityAfter,
      stagesCompleted: row.stagesCompleted,
      startedAtMs: Number(row.startedAtMs),
      completedAtMs: row.completedAtMs === null ? null : Number(row.completedAtMs),
      notes: row.notes,
      context: row.context,
      // V2026-09-04 治本: DTO 字段是 `createdAt: Date` (跟 startedAtMs/completedAtMs 的 Ms 命名不一致,
      // 但保持原 DTO 语义, 不擅自改字段名 — 上层若需要 ISO string 由 class-transformer/serialization 负责).
      createdAt: row.createdAt,
    };
  }
}
