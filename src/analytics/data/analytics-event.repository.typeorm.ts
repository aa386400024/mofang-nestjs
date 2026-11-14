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
   * 取时间窗内该租户该类型事件的 `createdAt` 序列.
   *
   * V2026-10-12 治本 (Phase 8.3 — TypeORM select 类型) 随端口化一并下沉到本实现:
   *   TypeORM FindOptions select 是对象形式 { field: true }, 不是 string[].
   *   string[] 走 createQueryBuilder().select() 合法 (跟 src/ai-engine
   *   providers/ai-effect.service.ts getHistory 同 pattern), 但 Repository.find
   *   的 select 必须是对象. 治本: 改对象形式.
   *
   * @param tenantId 租户隔离
   * @param eventType 事件类型
   * @param start 时间窗起点 (含)
   * @param end 时间窗终点 (含)
   * @returns createdAt 序列
   */
  async findCreatedAtBetween(tenantId: string, eventType: AnalyticsEventType, start: Date, end: Date): Promise<readonly Date[]> {
    const rows = await this.repo.find({
      where: { tenantId, eventType, createdAt: Between(start, end) },
      select: { createdAt: true },
    });
    return rows.map((row) => row.createdAt);
  }
}
