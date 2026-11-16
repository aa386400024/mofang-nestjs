// V2026-11-09 治本 (Phase2.5 WP-E · admin 只读端点):
//   职责: 把 `eval_reports` 表 (离线批量评测质量报告) 暴露给 admin 后台.
//   边界: 全部 GET, 无写操作; 不做学员隔离 (评测报告是全局审计数据).
//
//   端点:
//     GET /admin/api/eval/reports        — 报告列表 (分页 + 状态筛选)
//     GET /admin/api/eval/reports/:id    — 单条详情 (完整 report_json 快照)
//
//   数据源: MySQL `eval_reports` 表 (真相源, 长期可查).
//
//   鉴权: AdminBasicAuthMiddleware (class 级) + AdminRoleGuard.
//
//   时间戳: 2026-11-09

import { Controller, Get, Injectable, Param, Query, UseGuards } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Repository } from 'typeorm';

import { AdminRoleGuard } from './guards/admin-role.guard.js';
import { EvalReportEntity } from '../engine-adapters/eval/eval-report.entity.js';

/**
 * 报告列表行 (扁平, 不嵌套 JSON).
 */
export interface EvalReportListItem {
  readonly id: string;
  readonly reportId: string;
  readonly createdAt: string;
  readonly datasetVersion: string;
  readonly mode: string;
  /** 触发 F1 (历史行可能为 null). */
  readonly triggerF1: number | null;
  /** 建议方向准确率 macro F1 (不可算时为 null). */
  readonly directionAccuracy: number | null;
  /** 报告状态: ok / degraded / failed (从 metrics_json 取). */
  readonly status: string;
  /** 告警条数. */
  readonly warningCount: number;
  /** 成本 (元, 从 metrics_json.cost 取). */
  readonly costCny: number | null;
}

export interface EvalReportListResponse {
  readonly total: number;
  readonly page: number;
  readonly pageSize: number;
  readonly items: readonly EvalReportListItem[];
}

/**
 * 从 metricsJson 里安全取一个字段 (点号路径).
 */
function readMetric(source: unknown, path: string): unknown {
  let cursor = source;
  for (const seg of path.split('.')) {
    if (typeof cursor !== 'object' || cursor === null) return undefined;
    cursor = (cursor as Record<string, unknown>)[seg];
  }
  return cursor;
}

function toListItem(row: EvalReportEntity): EvalReportListItem {
  const metrics = row.metricsJson ?? {};
  const report = row.reportJson ?? {};
  const warnings = (report['warnings'] as unknown[]) ?? [];
  const cost = readMetric(metrics, 'cost');
  let costCny: number | null = null;
  if (typeof cost === 'object' && cost !== null) {
    const c = cost as Record<string, unknown>;
    const v = c['totalCny'] ?? c['total'] ?? c['cny'];
    if (typeof v === 'number') costCny = v;
  }
  return {
    id: row.id,
    reportId: row.reportId,
    createdAt: row.createdAt.toISOString(),
    datasetVersion: row.datasetVersion,
    mode: row.mode,
    triggerF1: typeof readMetric(metrics, 'triggerQuality.f1') === 'number' ? (readMetric(metrics, 'triggerQuality.f1') as number) : null,
    directionAccuracy:
      typeof readMetric(metrics, 'suggestionQuality.macroAverage') === 'number'
        ? (readMetric(metrics, 'suggestionQuality.macroAverage') as number)
        : null,
    status: (readMetric(metrics, 'status') as string) ?? 'unknown',
    warningCount: warnings.length,
    costCny,
  };
}

/**
 * 评测报告只读 controller.
 */
@Controller('admin/api/eval')
@UseGuards(AdminRoleGuard)
@Injectable()
export class EvalReportController {
  constructor(@InjectRepository(EvalReportEntity) private readonly repo: Repository<EvalReportEntity>) {}

  /**
   * 报告列表 (分页 + 状态筛选).
   *
   * @param page 页码 (1-based)
   * @param pageSize 每页条数 (上限 100)
   * @param status 状态筛选 (ok / degraded / failed)
   */
  @Get('reports')
  async list(
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('status') status?: string,
  ): Promise<EvalReportListResponse> {
    const p = Math.max(1, Number.parseInt(page ?? '1', 10) || 1);
    const ps = Math.min(100, Math.max(1, Number.parseInt(pageSize ?? '20', 10) || 20));

    const qb = this.repo.createQueryBuilder('r').orderBy('r.createdAt', 'DESC');

    if (status) {
      // metrics_json 是 JSON 列, 用 JSON_EXTRACT 筛选 status.
      qb.andWhere("JSON_EXTRACT(r.metrics_json, '$.status') = :status", { status });
    }

    const total = await qb.getCount();
    const rows = await qb
      .skip((p - 1) * ps)
      .take(ps)
      .getMany();

    return {
      total,
      page: p,
      pageSize: ps,
      items: rows.map(toListItem),
    };
  }

  /**
   * 单条报告详情 (返回完整 report_json 快照).
   *
   * @param id 主键 (uuid)
   */
  @Get('reports/:id')
  async detail(@Param('id') id: string): Promise<Record<string, unknown>> {
    const row = await this.repo.findOne({ where: { id } });
    if (!row) {
      return { error: 'not_found', id };
    }
    return {
      id: row.id,
      reportId: row.reportId,
      datasetVersion: row.datasetVersion,
      mode: row.mode,
      createdAt: row.createdAt.toISOString(),
      config: row.configJson,
      metrics: row.metricsJson,
      dataQuality: row.dataQualityJson,
      report: row.reportJson,
    };
  }
}
