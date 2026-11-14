// V2026-11-15 治本 (TD-19 · C2 第三批仓储端口化 · emergency 域 · P-DEBT-11 / L-1):
//   `EmergencySessionRepository` 端口的 TypeORM 实现 —— emergency 域**唯一**允许出现
//   typeorm 值符号的业务文件 (module 装配层除外).
//
//   治本:
//     - **两条原生 SQL 全部收在本实现内** —— upsert 的 INSERT ... ON DUPLICATE KEY UPDATE
//       与 stats 的 SELECT ... GROUP BY tool_kind 聚合: 全文 / 参数占位 /
//       context 的 JSON.stringify 与 null 兜底 / AVG 的 NULL 处理 / completion_rate
//       的除法口径**逐字**保留在改前 service 里 (本单只搬位置, 不改语义)
//     - 查询口径全部下沉: uid 过滤 / sinceMs 过滤 / started_at_ms DESC / limit 默认 100 /
//       id 单条件与 id+uid 双条件两种读法
//     - 实现不写新口径、不加新条件 —— 本单是结构重构, 不是查询优化
//     - 不暴露 EntityManager / FindOptions 给上层
//     - **不吞异常** —— 写失败要冒到 service (service 现有语义逐字保留)
//
//   反双胞胎:
//     - 不把 entity 行直接漏给 service —— 端口出参是 Row 领域类型
//     - 聚合统计行不是表行映射 —— 单独一个窄出参类型 (无对应 entity)
//
//   如何验证:
//     1. tsc 0 错; module provider 接线后急救的 4 个端点口径不变
//     2. 单元测试用端口替身驱动 service (不起真 TypeORM / 不连 DB)
//   时间戳: 2026-11-15 GMT+8

import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import type {
  EmergencySessionListQuery,
  EmergencySessionRepository,
  EmergencySessionRow,
  EmergencyToolStatRow,
  UpsertEmergencySessionInput,
} from '../domain/repositories/emergency-session.repository.js';
import { EmergencySessionEntity } from '../entities/emergency-session.entity.js';

/** 列表默认条数上限 (前端无强制分页参数, 防御性 cap). */
const DEFAULT_LIST_LIMIT = 100;

/** 原生聚合 SQL 的原始行形状 (snake_case, 数值列在 mysql 驱动下可能是字符串). */
interface RawToolStatRow {
  tool_kind: string;
  sample_count: number;
  avg_intensity_delta: number | null;
  completion_rate: number;
}

/**
 * 急救会话仓储 (TypeORM 真库实现).
 */
@Injectable()
export class EmergencySessionRepositoryTypeorm implements EmergencySessionRepository {
  /**
   * @param repo 急救会话实体仓储
   */
  constructor(
    @InjectRepository(EmergencySessionEntity)
    private readonly repo: Repository<EmergencySessionEntity>,
  ) {}

  /**
   * 写入一行 (upsert) 并按 id 回读.
   *
   * V2026-09-04 治本 (audit 暴露 TS2345): 旧实现走 typeorm 1.x 的 upsert 助手时,
   *   context 字段类型跟 json 列的深部分类型不兼容, TS2345 编译失败, 即便绕过 TS
   *   runtime 也会丢字段 —— 故走原生 SQL INSERT ... ON DUPLICATE KEY UPDATE.
   *   本单**只把这条 SQL 搬到实现层**, 字段集 / 刷新集 / 序列化口径逐字不变.
   *
   * @param input 写入入参 (纯对象)
   * @returns 回读到的行 (未命中返 null, 抛错判定留 service)
   */
  async upsert(input: UpsertEmergencySessionInput): Promise<EmergencySessionRow | null> {
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
        input.id,
        input.uid,
        input.toolKind,
        input.phase,
        input.intensityBefore,
        input.intensityAfter,
        input.stagesCompleted,
        input.startedAtMs.toString(),
        input.completedAtMs?.toString() ?? null,
        input.notes,
        input.context === null ? null : JSON.stringify(input.context),
      ],
    );
    return this.findById(input.id);
  }

  /**
   * 按 id 取行 —— 传 uid 则加 uid 隔离条件 (越权隔离口径), 不传则按 id 单条件.
   *
   * @param id 会话 id
   * @param uid 作者 id (可选)
   * @returns 行 (无命中返 null)
   */
  async findById(id: string, uid?: string): Promise<EmergencySessionRow | null> {
    const row = uid === undefined ? await this.repo.findOne({ where: { id } }) : await this.repo.findOne({ where: { id, uid } });
    return row ? toRow(row) : null;
  }

  /**
   * 列出会话 —— uid 过滤 + sinceMs 过滤 + started_at_ms 倒序 + limit (默认 100).
   *
   * @param uid 作者 id
   * @param query 查询入参 (可选)
   * @returns 行列表
   */
  async list(uid: string, query?: EmergencySessionListQuery): Promise<EmergencySessionRow[]> {
    const qb = this.repo.createQueryBuilder('e').where('e.uid = :uid', { uid });
    if (query?.sinceMs !== undefined) {
      qb.andWhere('e.started_at_ms >= :since', { since: query.sinceMs.toString() });
    }
    qb.orderBy('e.started_at_ms', 'DESC').limit(query?.limit ?? DEFAULT_LIST_LIMIT);
    const rows = await qb.getMany();
    return rows.map((row) => toRow(row));
  }

  /**
   * 工具效果聚合 —— 原生 GROUP BY SQL + snake_case→camelCase 映射.
   *
   * 大厂 standard SQL 聚合 — 不依赖 typeorm QueryBuilder 玄学, raw query 行为可预测.
   * COALESCE 处理全无评分的 tool_kind (AVG 返 NULL).
   * completion_rate 用 SUM(CASE WHEN ...)/COUNT 避免 AVG(phase='completed') 类型不匹配.
   *
   * @param uid 作者 id
   * @param sinceMs 窗口起点 (毫秒时间戳)
   * @returns 统计行列表
   */
  async aggregateToolStats(uid: string, sinceMs: number): Promise<EmergencyToolStatRow[]> {
    const rows: RawToolStatRow[] = await this.repo.query(
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
}

/** entity → Row 映射 (窄字段, 本域无软删列). */
function toRow(entity: EmergencySessionEntity): EmergencySessionRow {
  return {
    id: entity.id,
    uid: entity.uid,
    toolKind: entity.toolKind,
    phase: entity.phase,
    intensityBefore: entity.intensityBefore,
    intensityAfter: entity.intensityAfter,
    stagesCompleted: entity.stagesCompleted,
    startedAtMs: entity.startedAtMs,
    completedAtMs: entity.completedAtMs,
    notes: entity.notes,
    context: entity.context,
    createdAt: entity.createdAt,
  };
}
