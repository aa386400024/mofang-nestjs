// V2026-09-04 治本 (V6.0 §4.2 + audit P0-3):
//   急救会话上报服务 — 前端 EmergencyBloc 完成时同步上抛, 跨设备同步 + 趋势分析.
//   关键反双胞胎: 不写「急救工具执行」逻辑 (那是前端 EmergencyBloc + 5 工具页),
//             本服务只负责接收上报 + 趋势查询.

import { Inject, Injectable, Logger } from '@nestjs/common';

import {
  EMERGENCY_SESSION_REPOSITORY,
  type EmergencySessionRepository,
  type EmergencySessionRow,
} from '../domain/repositories/emergency-session.repository.js';
import type { EmergencySessionDto, EmergencySessionListDto, UpsertEmergencySessionDto } from '../dto/emergency.dto.js';

/**
 * V2026-11-15 治本 (TD-19 · C2 第三批仓储端口化 · emergency 域 · P-DEBT-11 / L-1):
 *   - 仓储访问改走**端口** (`domain/repositories/emergency-session.repository.js` 的
 *     interface + `EMERGENCY_SESSION_REPOSITORY` DI token), typeorm 值符号全部收进
 *     `data/` 的 TypeORM 实现; service 不再出现 entity 类名, 不再值位置 import entity
 *   - **两条原生 SQL 下沉实现层** —— upsert 的 INSERT ... ON DUPLICATE KEY UPDATE 与
 *     stats 的 SELECT ... GROUP BY tool_kind 聚合: 全文 / 参数占位 / context 的
 *     JSON.stringify 与 null 兜底 / AVG 的 NULL 处理 / completion_rate 的除法口径
 *     **逐字不变** (本单只搬位置, 不改语义)
 *   - **留本层的口径** (刻意不下沉): windowDays → sinceMs 窗口换算 / items+total 组装 /
 *     响应层 Number(...) 时间戳转换 / upsert 回读未命中抛错 —— 对齐 TD-18「判定留 service」
 *   - 公共签名 (`upsert` / `list` / `getOne` / `getToolStats`) 与返回 DTO 形状**逐字不变**
 */
@Injectable()
export class EmergencyService {
  private readonly logger = new Logger(EmergencyService.name);

  constructor(
    @Inject(EMERGENCY_SESSION_REPOSITORY)
    private readonly repo: EmergencySessionRepository,
  ) {}

  /**
   * Upsert 单条急救会话 — id 用前端 UUID, 重复 POST 幂等.
   *
   * V2026-09-04 治本 (audit 暴露 TS2345):
   *   原因: 旧实现 `this.repo.upsert({ ..., context: dto.context as unknown as object }, ['id'])`
   *     触发 typeorm 1.x 玄学: context 字段类型 `Record<string, unknown> | null` 跟
   *     `_QueryDeepPartialEntity<…>` 的 json 列类型不兼容 (实体类名不入业务层),
   *     TS2345 编译失败; 即便绕过 TS, runtime extractUpsertSet 也会丢字段.
   *   修复: 走 raw SQL `INSERT ... ON DUPLICATE KEY UPDATE`. id 来自 dto (前端 UUID),
   *     显式传入; context nullable 列存 NULL 或 JSON.stringify 字符串.
   *   Fallback: dto.context 为 null 时 SQL 列存 NULL, 跟 entity 列 nullable 对齐.
   *   跟 ai_profile.service.ts.upsertRow / game-unlock.service.ts.upsert 同模式,
   *   整个 mofang-nestjs 走统一 raw SQL 治源.
   *
   * V2026-11-15 治本 (TD-19): 那条 raw SQL 与「按 id 回读」整体下沉到 `data/` 实现层 ——
   *   本层只构造纯对象入参; 回读未命中仍在本层抛错 (判定留 service, 对齐 TD-18 口径).
   */
  async upsert(uid: string, dto: UpsertEmergencySessionDto): Promise<EmergencySessionDto> {
    const row = await this.repo.upsert({
      id: dto.id,
      uid,
      toolKind: dto.toolKind,
      phase: dto.phase,
      intensityBefore: dto.intensityBefore,
      intensityAfter: dto.intensityAfter,
      stagesCompleted: dto.stagesCompleted,
      startedAtMs: dto.startedAtMs,
      completedAtMs: dto.completedAtMs,
      notes: dto.notes,
      context: dto.context,
    });
    if (!row) {
      throw new Error(`Emergency session upsert failed id=` + dto.id);
    }
    this.logger.debug(`upsert emergency uid=` + uid + ` id=` + dto.id + ` phase=` + dto.phase);
    return this.toDto(row);
  }

  /**
   * 列出某用户急救会话 — 跨设备同步用.
   */
  async list(uid: string, options?: { sinceMs?: number; limit?: number }): Promise<EmergencySessionListDto> {
    // V2026-11-15 治本 (TD-19): uid / sinceMs / limit 的过滤与上限口径下沉 data/ 实现层;
    //   items + total 组装留本层 (total = 行数, 属 DTO 层语义).
    const rows = await this.repo.list(uid, { sinceMs: options?.sinceMs, limit: options?.limit });
    return {
      items: rows.map((r) => this.toDto(r)),
      total: rows.length,
    };
  }

  /**
   * 单条 — 详情面板 / 调试用.
   */
  async getOne(uid: string, id: string): Promise<EmergencySessionDto | null> {
    // V2026-11-15 治本 (TD-19): id + uid 双条件越权隔离口径下沉 data/ 实现层.
    const row = await this.repo.findById(id, uid);
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
   *
   * V2026-11-15 治本 (TD-19): 原生聚合 SQL 与 snake_case→camelCase + 数值化映射下沉
   *   `data/` 实现层 (对齐先例 Row 映射下沉口径); 窗口换算留本层 (口径不动).
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
    return this.repo.aggregateToolStats(uid, sinceMs);
  }

  private toDto(row: EmergencySessionRow): EmergencySessionDto {
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
      //   但保持原 DTO 语义, 不擅自改字段名 — 上层若需要 ISO string 由 class-transformer/serialization 负责).
      createdAt: row.createdAt,
    };
  }
}
