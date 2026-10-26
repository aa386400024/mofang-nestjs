// V2026-10-26 治本 (SupervisionReport TypeORM 仓储 — V1.x 切真库, spec 任务 6):
//   原因: 任务 6 要求「结束督导生成的结构化报告**持久化**到该 training_sessions 记录」——
//     而现状是**纯内存**: `SupervisorModule` 注入的是 `SupervisionReportRepositoryMemory`,
//     进程一重启报告就没了, 且换实例就查不到. 复盘报告是"训练完之后才看"的东西,
//     放内存里等于这个功能不成立.
//     实体 (`SupervisionReportEntity`) 早就按 TypeORM 装饰器写好了 (原注释: "V0.x 内存 mock,
//     entity 仍按 TypeORM 装饰器写, V1.x 一键切 DB"), 本次就是那"一键".
//   修法: 本文件是 `SupervisionReportRepository` 接口的**真库实现**, 语义与内存实现严格一致:
//     - save        同 (tenantId, sessionId) 覆盖最新一份 (内存实现是 Map 覆盖, 这里 find→update)
//     - findBySessionId  取该 session 最新一份, 跨租户返回 null
//     - listByTenant     列租户最近 N 份, 默认 50 上限 200
//   反双胞胎:
//     - 不改 `SupervisionReportRepository` 接口: 内存实现仍留着 (单测用), 两者可互换
//     - 不新建 `vpt_reports` 表: 督导报告是**跨场景**的 (vpt / 单次训练 / 长程共用一套),
//       另开 vpt 专用表 = 两份报告结构 + 两套查询
//     - 不用 `synchronize: true` 自动建表 (ADR-0003): 走手写 DDL migration
//   验证:
//     1. tsc 0 错
//     2. 大炮跑 pnpm migration:run 后 SHOW TABLES LIKE 'supervision_reports'; # 1 张表
//     3. 跑完一场 vpt 会话 → 该表出现 1 行, session_id = 落库 id
//   时间戳: 2026-10-26

import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { SupervisionReportEntity } from '../domain/entities/supervision-report.entity';
import type { SupervisionReportRepository } from '../domain/repositories/supervision-report.repository';
import type { SupervisionReportRow } from '../supervisor.types';

/** 单租户单次查询默认上限. */
const DEFAULT_LIST_LIMIT = 50;
/** listByTenant 硬上限, 防 OOM. */
const HARD_LIMIT_CAP = 200;

/**
 * 督导报告仓储 (TypeORM 真库实现).
 */
@Injectable()
export class SupervisionReportRepositoryTypeorm implements SupervisionReportRepository {
  private readonly logger = new Logger(SupervisionReportRepositoryTypeorm.name);

  /**
   * @param repo 督导报告实体仓储
   */
  constructor(
    @InjectRepository(SupervisionReportEntity)
    private readonly repo: Repository<SupervisionReportEntity>,
  ) {}

  /**
   * 写一行督导报告 (同 tenant + session 覆盖最新一份).
   *
   * @param row 完整报告行
   * @returns 写库后的行 (含数据库生成的 id)
   */
  async save(row: SupervisionReportRow): Promise<SupervisionReportRow> {
    const existing = await this.repo.findOne({
      where: { tenantId: row.tenantId, sessionId: row.sessionId },
      order: { createdAt: 'DESC' },
    });
    const entity = existing ?? this.repo.create({});
    entity.tenantId = row.tenantId;
    entity.sessionId = row.sessionId;
    entity.userId = row.userId;
    entity.personaId = row.personaId;
    entity.personaName = row.personaName;
    entity.difficulty = row.difficulty;
    entity.status = row.status;
    entity.overallScore = row.overallScore;
    entity.dimensions = row.dimensions;
    entity.annotations = row.annotations;
    entity.errorPatterns = row.errorPatterns;
    entity.growthSuggestions = row.growthSuggestions;
    entity.rawResponse = row.rawResponse;
    // created_at 是 CreateDateColumn: 插入时由 TypeORM 填, 更新时保持原值 (报告写完即终态).

    const saved = await this.repo.save(entity);
    this.logger.log(
      `[save] tenant=${saved.tenantId} session=${saved.sessionId} ` +
        `status=${saved.status} score=${saved.overallScore} annotations=${saved.annotations.length}`,
    );
    return this.toRow(saved);
  }

  /**
   * 按 sessionId 查最新一份报告.
   *
   * @param tenantId 租户隔离
   * @param sessionId voice session id
   * @returns 找不到返回 null
   */
  async findBySessionId(tenantId: string, sessionId: string): Promise<SupervisionReportRow | null> {
    const row = await this.repo.findOne({
      where: { tenantId, sessionId },
      order: { createdAt: 'DESC' },
    });
    return row ? this.toRow(row) : null;
  }

  /**
   * 列租户最近报告, 按 createdAt 倒序.
   *
   * @param tenantId 租户隔离
   * @param limit 默认 50, 上限 200
   * @returns 报告列表
   */
  async listByTenant(tenantId: string, limit?: number): Promise<readonly SupervisionReportRow[]> {
    const effectiveLimit = Math.min(Math.max(limit ?? DEFAULT_LIST_LIMIT, 1), HARD_LIMIT_CAP);
    const rows = await this.repo.find({
      where: { tenantId },
      order: { createdAt: 'DESC' },
      take: effectiveLimit,
    });
    return rows.map((r) => this.toRow(r));
  }

  /**
   * entity → 行 (domain 类型).
   *
   * `createdAt` 在行里是**毫秒数** (number), 在 entity 里是 Date —— 这里做一次显式转换,
   * 不让两种形状泄漏到上层.
   *
   * @param entity 实体行
   * @returns domain 行
   */
  private toRow(entity: SupervisionReportEntity): SupervisionReportRow {
    return {
      id: entity.id,
      sessionId: entity.sessionId,
      overallScore: entity.overallScore,
      dimensions: entity.dimensions,
      annotations: entity.annotations,
      errorPatterns: entity.errorPatterns,
      growthSuggestions: entity.growthSuggestions,
      status: entity.status,
      tenantId: entity.tenantId,
      userId: entity.userId,
      personaId: entity.personaId,
      personaName: entity.personaName,
      difficulty: entity.difficulty,
      rawResponse: entity.rawResponse,
      createdAt: entity.createdAt.getTime(),
    };
  }
}
