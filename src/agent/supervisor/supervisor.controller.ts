// V2026-10-09 治本 (Phase 6.1 — Supervisor REST 端点 — SPEC §11.2 + V0.5 增量):
//   用途: 前端督导报告展示页 (Phase 6.4) 拉数据用, V0.x 内存 mock (重启丢失)
//   鉴权: 复用 JwtAuthGuard, tenantId 从 JWT 拿, repo.findBySessionId 自动按 tenant 过滤
//   端点:
//     - GET /agent/supervision/:sessionId   查最新报告
//     - GET /agent/supervision?limit=50     列租户最近 (默认 50, 上限 200)
//
//   反双胞胎:
//     - 不返回完整 SupervisionReportRow — 转 DTO 屏蔽 tenantId / userId / rawResponse
//     - 不暴露 rawResponse — 内部 parse 失败 debug 字段, 防 LLM prompt 泄漏
//     - 不分页 — V0.x 内存, 走 listByTenant 上限 200 防 OOM
//     - 不写业务层服务 (SupervisorService) — V0.5 controller 直连 repository
//       (后续 V1.x 业务复杂化再抽 facade)
//
//   如何验证:
//     1. pnpm build 无 type error
//     2. 启动后 curl GET /agent/supervision/<sessionId> (带 Bearer JWT) 返 DTO
//     3. 跨租户 sessionId 返 null (tenant 隔离)
//     4. 不存在 sessionId 返 null, 不抛 404 (REST 风格: list 找元素返 null, 客户端判空)

import { Controller, Get, Inject, Param, Query, UseGuards } from '@nestjs/common';

import type { SupervisionReportDto, SupervisionReportRow } from './supervisor.types';
import { JwtAuthGuard } from '../../auth/guards';
import { TenantId } from '../../common/decorators';
import { SUPERVISION_REPORT_REPOSITORY, type SupervisionReportRepository } from './domain/repositories/supervision-report.repository';

@Controller('agent/supervision')
@UseGuards(JwtAuthGuard)
export class SupervisorController {
  constructor(@Inject(SUPERVISION_REPORT_REPOSITORY) private readonly repos: SupervisionReportRepository) {}

  /**
   * GET /agent/supervision/:sessionId
   * @returns 找到返 DTO, 没找到返 null (REST 风格, 不抛 404)
   */
  @Get(':sessionId')
  async findBySession(@Param('sessionId') sessionId: string, @TenantId() tenantId: string): Promise<SupervisionReportDto | null> {
    const row = await this.repos.findBySessionId(tenantId, sessionId);
    return row ? toDto(row) : null;
  }

  /**
   * GET /agent/supervision?limit=50
   * @param limit 默认 50, 上限 200 (SupervisionReportRepository.listByTenant 内部 cap)
   */
  @Get()
  async listByTenant(@Query('limit') limit: string | undefined, @TenantId() tenantId: string): Promise<readonly SupervisionReportDto[]> {
    const parsed = limit ? Number.parseInt(limit, 10) : Number.NaN;
    const safeLimit = Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
    const rows = await this.repos.listByTenant(tenantId, safeLimit);
    return rows.map(toDto);
  }
}

/** row → DTO, 显式选字段防止内部字段泄漏. */
function toDto(row: SupervisionReportRow): SupervisionReportDto {
  return {
    sessionId: row.sessionId,
    status: row.status,
    personaId: row.personaId,
    personaName: row.personaName,
    difficulty: row.difficulty,
    overallScore: row.overallScore,
    dimensions: row.dimensions,
    annotations: row.annotations,
    errorPatterns: row.errorPatterns,
    growthSuggestions: row.growthSuggestions,
    createdAt: row.createdAt,
  };
}
