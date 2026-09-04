// V2026-09-04 治本 (V6.0 §4.2 + audit P0-3):
//   急救会话服务 — 服务端镜像端侧 SQLCipher 本地表.
//   关键反双胞胎:
//     - 不写急救工具本身逻辑 (那是端侧 + LLMClient, 不在服务端).
//     - 不写 panic alert 上报 (那是 §11.2 crisisEvent + 端侧立即弹层).
//     - 不写 thought_bubble 内容审查 (V2 仅加密存储, V3 接 LLM 离线审查).

import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import type { EmergencySessionDto, EmergencySessionListDto, UpsertEmergencySessionDto } from '../dto/emergency.dto';
import { EmergencySessionEntity } from '../entities/emergency-session.entity';

/**
 * 急救会话服务 — §4.2.
 *
 * 设计: 客户端 → 上报 (含前端 UUID id) → 服务端 upsert (幂等).
 * 重复 POST 同一 id 不新增行, 更新 phase + stages_completed + intensity_after.
 * 跨设备同步: 客户端启动 → 拉服务端列表 → 跟本地 SQLCipher 表合并.
 */
@Injectable()
export class EmergencyService {
  private readonly logger = new Logger(EmergencyService.name);

  constructor(
    @InjectRepository(EmergencySessionEntity)
    private readonly repo: Repository<EmergencySessionEntity>,
  ) {}

  /**
   * Upsert 单条会话 — id 是前端 UUID, 重复 POST 幂等.
   *
   * V2026-09-04 治本: 用 repo.upsert 走 ON DUPLICATE KEY UPDATE,
   * 1 SQL 完成. 不先 findOne 后 save (2 SQL + 写竞态).
   */
  async upsert(uid: string, dto: UpsertEmergencySessionDto): Promise<EmergencySessionDto> {
    await this.repo.upsert(
      {
        id: dto.id,
        uid,
        toolKind: dto.toolKind,
        phase: dto.phase,
        intensityBefore: dto.intensityBefore,
        intensityAfter: dto.intensityAfter,
        stagesCompleted: dto.stagesCompleted,
        startedAtMs: dto.startedAtMs.toString(),
        completedAtMs: dto.completedAtMs?.toString() ?? null,
        notes: dto.notes,
        context: dto.context as unknown as object,
      },
      ['id'],
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
   * 趋势聚合 — §3.4 工具效果统计.
   *
   * 返回: 工具 → { sampleCount, avgIntensityDelta, completionRate }.
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
    const sinceMs = Date.now() - windowDays * 24 * 3600 * 1000;
    const rows = await this.repo
      .createQueryBuilder('e')
      .where('e.uid = :uid', { uid })
      .andWhere('e.started_at_ms >= :since', { since: sinceMs.toString() })
      .getMany();

    const byTool = new Map<string, EmergencySessionEntity[]>();
    for (const r of rows) {
      const arr = byTool.get(r.toolKind) ?? [];
      arr.push(r);
      byTool.set(r.toolKind, arr);
    }

    return Array.from(byTool.entries()).map(([toolKind, items]) => {
      const completed = items.filter((i) => i.phase === 'completed');
      const withDelta = items.filter((i) => i.intensityBefore !== null && i.intensityAfter !== null);
      const avgDelta =
        withDelta.length > 0
          ? withDelta.reduce((s, i) => s + ((i.intensityBefore ?? 0) - (i.intensityAfter ?? 0)), 0) / withDelta.length
          : null;
      return {
        toolKind,
        sampleCount: items.length,
        avgIntensityDelta: avgDelta === null ? null : Math.round(avgDelta * 100) / 100,
        completionRate: items.length > 0 ? Math.round((completed.length / items.length) * 100) / 100 : 0,
      };
    });
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
      completedAtMs: row.completedAtMs ? Number(row.completedAtMs) : null,
      notes: row.notes,
      context: row.context,
      createdAt: row.createdAt,
    };
  }
}
