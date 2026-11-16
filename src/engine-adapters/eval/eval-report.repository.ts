// V2026-11-09 治本 (Phase2.5 WP-E · 自动评测 · eval_reports 仓储实现):
//   职责: 把报告写进 MySQL / 读回历史报告 (TypeORM 实现).
//   边界: 只做持久化 —— 判定与指标计算一律不在这里.
//
//   为什么单独一个文件 (而不是塞进 eval.report.ts):
//     eval.report.ts 是**纯**的 (零 IO), CLI 要在**没有数据库**的机器上跑评测.
//     TypeORM / @nestjs/typeorm 一旦混进那个文件, CLI 就得先起 MySQL ——
//     "离线评测零成本"的意义就没了. 于是纯层与持久化层分文件, 用端口接口连接.
//
//   反双胞胎:
//     - 不在仓储里做任何判定 (比如"该不该存") —— 存不存由入口层决定.
//     - 不加 DB-level FK (ADR-0003).
//
//   时间戳: 2026-11-09

import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Repository } from 'typeorm';

import { EvalReportEntity } from './eval-report.entity.js';
import type { EvalReportRepository } from './eval.report.js';
import type { EvalReport, EvalReportSummary } from './eval.types.js';

/**
 * eval_reports 表仓储 (TypeORM 实现).
 */
@Injectable()
export class TypeOrmEvalReportRepository implements EvalReportRepository {
  constructor(@InjectRepository(EvalReportEntity) private readonly repository: Repository<EvalReportEntity>) {}

  /**
   * 存一份报告.
   *
   * ⚠️ report_json 存的是**完整快照** —— 跨版本对比要的是"当时那一版"的事实.
   *
   * @param report 报告
   */
  async save(report: EvalReport): Promise<void> {
    await this.repository.save(
      this.repository.create({
        reportId: report.reportId,
        datasetVersion: report.config.datasetVersion,
        mode: report.config.mode,
        configJson: report.config as unknown as Record<string, unknown>,
        metricsJson: {
          triggerQuality: report.triggerQuality,
          suggestionQuality: report.suggestionQuality,
          baselineComparison: report.baselineComparison,
          runs: report.runs,
          cost: report.cost,
          durationSec: report.durationSec,
          status: report.status,
        } as unknown as Record<string, unknown>,
        dataQualityJson: report.dataQuality as unknown as Record<string, unknown>,
        reportJson: report as unknown as Record<string, unknown>,
      }),
    );
  }

  /**
   * 列出最近的报告摘要.
   *
   * @param limit 条数
   * @returns 摘要列表
   */
  async list(limit: number): Promise<EvalReportSummary[]> {
    const rows = await this.repository.find({ order: { createdAt: 'DESC' }, take: limit });
    return rows.map((row) => ({
      reportId: row.reportId,
      createdAt: row.createdAt.toISOString(),
      datasetVersion: row.datasetVersion,
      mode: row.mode === 'full' ? 'full' : 'offline',
      triggerF1: this.readNumber(row.metricsJson, 'triggerQuality.f1'),
      directionAccuracy: this.readNumber(row.metricsJson, 'suggestionQuality.macroAverage'),
    }));
  }

  /**
   * 取上一版报告 (同数据集版本).
   *
   * @param datasetVersion 数据集版本 (缺省 = 任意版本最近一份)
   * @returns 上一版报告 (没有则为 null)
   */
  async latest(datasetVersion?: string): Promise<EvalReport | null> {
    const rows = await this.repository.find({
      where: datasetVersion ? { datasetVersion } : {},
      order: { createdAt: 'DESC' },
      take: 1,
    });
    if (rows.length === 0) return null;
    return rows[0].reportJson as unknown as EvalReport;
  }

  /**
   * 从指标 JSON 里取一个数值 (点号路径).
   *
   * @param source 源对象
   * @param path 点号路径
   * @returns 数值 (取不到则为 null)
   */
  private readNumber(source: Record<string, unknown>, path: string): number | null {
    let cursor: unknown = source;
    for (const segment of path.split('.')) {
      if (typeof cursor !== 'object' || cursor === null) return null;
      cursor = (cursor as Record<string, unknown>)[segment];
    }
    return typeof cursor === 'number' ? cursor : null;
  }
}
