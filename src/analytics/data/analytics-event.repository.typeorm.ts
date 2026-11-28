// V2026-11-14 治本 (TD-13 · L-1b 仓储端口抽象试点 · analytics 域):
//   `AnalyticsEventRepository` 端口的 TypeORM 实现 —— analytics 域**唯一**允许出现
//   typeorm 值符号 (Repository / Between) 的文件; 端口 / 两个 service / 新 spec
//   三处 typeorm 值符号 0 命中 (grep 复核见交付记录 §五).
//
//   治本:
//     - 查询口径全部收在本实现内: tenantId 隔离 + eventType 过滤 + 时间窗 (Between),
//       与改前 service 里写的条件**逐字一致**
//     - 实现不写新口径、不加新条件 —— 本单是结构重构, 不是查询优化
//     - 不暴露 EntityManager / FindOptions 给上层
//
//   反双胞胎:
//     - 不把 `find` 的原始行数组直接漏给 service —— 端口出参是 `createdAt` 序列,
//       service 只做分桶, 拿不到 metadata 等无关字段
//     - 不在实现里吞异常 —— 写失败要冒到 tracker, 由 tracker 静默 catch + warn
//       (静默失败是 tracker 的契约, 不是仓储的契约)
//     - 不用 `create` + `save` 之外的写法 —— 与改前 `events.save(events.create({...}))`
//       逐字同构, 不引入 upsert / partial update 语义
//
//   如何验证:
//     1. tsc 0 错; module provider 接线后 `GET /admin/analytics/overview` 口径不变
//     2. 单元测试用端口替身驱动 service (不起真 TypeORM / 不连 DB)
//   时间戳: 2026-11-14 GMT+8

import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, Repository } from 'typeorm';

import type { AnalyticsEventRecordInput, AnalyticsEventRepository } from '../domain/repositories/analytics-event.repository.js';
import { AnalyticsEvent } from '../entities/analytics-event.entity.js';
import type { AnalyticsEventType } from '../enums/analytics-event-type.enum.js';

/**
 * Analytics 事件仓储 (TypeORM 真库实现).
 */
@Injectable()
export class AnalyticsEventRepositoryTypeorm implements AnalyticsEventRepository {
  /**
   * @param repo analytics 事件实体仓储
   */
  constructor(
    @InjectRepository(AnalyticsEvent)
    private readonly repo: Repository<AnalyticsEvent>,
  ) {}

  /**
   * 写一行业务事件 (5 个业务字段; id / createdAt 由 DB 填).
   *
   * @param input 5 个业务字段
   */
  async record(input: AnalyticsEventRecordInput): Promise<void> {
    await this.repo.save(
      this.repo.create({
        tenantId: input.tenantId,
        eventType: input.eventType,
        itemId: input.itemId,
        userId: input.userId,
        metadata: input.metadata,
      }),
    );
  }

  /**
   * 按租户 + 事件类型 + 时间窗计数.
   *
   * @param tenantId 租户隔离
   * @param eventType 事件类型
   * @param start 时间窗起点 (含)
   * @param end 时间窗终点 (含)
   * @returns 命中条数
   */
  async countByType(tenantId: string, eventType: AnalyticsEventType, start: Date, end: Date): Promise<number> {
    return this.repo.count({
      where: {
        tenantId,
        eventType,
        createdAt: Between(start, end),
      },
    });
  }

  /**
   * 等宽分桶计数 —— 用 SQL `GROUP BY` 聚合，只回传桶号 + 计数.
   *
   * AF-595: 旧端口返回窗口内全部 `createdAt`，由 service 在 Node 里逐条分桶；
   * `year` 窗口事件多时内存与耗时都随事件量线性增长。现在桶号在 DB 里算：
   * `FLOOR(已过毫秒 / 桶宽)`，末桶 clamp 到 `bucketCount - 1`，口径与旧实现一致.
   *
   * MySQL 方言说明: `TIMESTAMPDIFF(MICROSECOND, ...)` 精度到微秒，再除 1000 得毫秒，
   * 避免 `TIMESTAMPDIFF(SECOND, ...)` 丢精度导致边界桶错位.
   *
   * @param tenantId 租户隔离
   * @param eventType 事件类型
   * @param start 时间窗起点 (含)
   * @param end 时间窗终点 (含)
   * @param bucketCount 桶数
   * @returns 长度恒为 bucketCount 的计数数组
   */
  async countBucketed(tenantId: string, eventType: AnalyticsEventType, start: Date, end: Date, bucketCount: number): Promise<number[]> {
    const counts = Array.from({ length: bucketCount }, () => 0);
    if (bucketCount <= 0) return counts;

    const bucketWidthMs = Math.max(1, Math.floor((end.getTime() - start.getTime()) / bucketCount));
    const rows = await this.repo
      .createQueryBuilder('e')
      .select(`LEAST(FLOOR(TIMESTAMPDIFF(MICROSECOND, :start, e.created_at) / 1000 / :bucketWidthMs), :maxBucket)`, 'bucket')
      .addSelect('COUNT(*)', 'cnt')
      .where('e.tenant_id = :tenantId', { tenantId })
      .andWhere('e.event_type = :eventType', { eventType })
      .andWhere('e.created_at BETWEEN :start AND :end', { start, end })
      .setParameter('bucketWidthMs', bucketWidthMs)
      .setParameter('maxBucket', bucketCount - 1)
      .groupBy('bucket')
      .getRawMany<{ bucket: string | number; cnt: string | number }>();

    for (const row of rows) {
      const idx = Number(row.bucket);
      if (Number.isInteger(idx) && idx >= 0 && idx < bucketCount) {
        counts[idx] = Number(row.cnt);
      }
    }
    return counts;
  }
}
