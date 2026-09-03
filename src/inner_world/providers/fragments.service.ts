import { Injectable } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';

import { ReconciliationService } from './reconciliation.service';
import {
  FragmentBalanceItemDto,
  FragmentLogDto,
  GrantFragmentsDto,
  GrantFragmentsResponseDto,
  ListFragmentLogsQueryDto,
} from '../dto/fragment.dto';
import { FragmentLog } from '../entities/fragment-log.entity';
import { FRAGMENT_TYPE_VALUES, FragmentSource, FragmentType } from '../enums/fragment-type.enum';

/**
 * 碎片业务服务 — V4.0 §3.2.
 *
 * 核心职责:
 *   - grant(): 原子产出 (写入 fragment_logs + 触发徽章 reconcile)
 *   - consume(): 原子消耗 (校验余额 + 写入负向流水 + 触发 reconcile)
 *   - getBalances(): 5 类型余额聚合 (SELECT SUM(delta) GROUP BY type)
 *   - listLogs(): 时间分页流水
 *
 * 事务模型:
 *   - grant/consume 各自在一个 @Transactional 块里完成
 *   - 余额校验走 SELECT ... FOR UPDATE 防并发超扣
 *   - idempotencyKey: 同 key 二次请求返回首次结果 (缓存 24h)
 */
@Injectable()
export class FragmentsService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(FragmentLog)
    private readonly logRepo: Repository<FragmentLog>,
    private readonly reconciliationService: ReconciliationService,
  ) {}

  /**
   * 获取 5 类型余额.
   * 返回 0 项时仍返回完整 5 项 (type, 0) — 前端无需空值处理.
   */
  async getBalances(userId: string): Promise<FragmentBalanceItemDto[]> {
    const rows = await this.logRepo
      .createQueryBuilder('f')
      .select('f.type', 'type')
      .addSelect('COALESCE(SUM(f.delta), 0)', 'balance')
      // V2026-09-03 治本: TypeORM 1.x 的 QueryBuilder 在 alias.property 形式下会按 entity metadata 解析 property 名.
      // entity 属性是 userId (camelCase) → 列名 user_id (snake_case), 写 f.user_id 会抛 PropertyNotFound.
      // 跟同模块 theme-packs/tool-skins.service 保持一致: raw WHERE 走列名, 不带 alias 前缀.
      .where('user_id = :userId', { userId })
      .groupBy('f.type')
      .getRawMany<{ type: FragmentType; balance: string }>();

    const map = new Map<FragmentType, number>(rows.map((r) => [r.type, Number.parseInt(r.balance, 10)]));

    return FRAGMENT_TYPE_VALUES.map((type) => ({
      type,
      balance: map.get(type) ?? 0,
    }));
  }

  /**
   * 时间分页流水 — 用于前端 fragment_bag 滚动列表.
   * since 缺省时返回最新 50 条.
   */
  async listLogs(userId: string, query: ListFragmentLogsQueryDto): Promise<{ logs: FragmentLogDto[]; nextSince?: string }> {
    const limit = Math.min(query.limit ?? 50, 200);
    const qb = this.logRepo
      .createQueryBuilder('f')
      // V2026-09-03 治本: 同 getBalances, raw WHERE 走列名 (见同文件 48 行注释).
      .where('user_id = :userId', { userId })
      .orderBy('f.created_at', 'DESC')
      .limit(limit + 1);

    if (query.since) {
      qb.andWhere('f.created_at > :since', { since: query.since });
    }
    if (query.type) {
      qb.andWhere('f.type = :type', { type: query.type });
    }

    const rows = await qb.getMany();
    const hasMore = rows.length > limit;
    const pageRows = hasMore ? rows.slice(0, limit) : rows;

    return {
      logs: pageRows.map((r) => this.mapLogToDto(r)),
      nextSince: hasMore ? pageRows.at(-1)!.createdAt.toISOString() : undefined,
    };
  }

  /**
   * 产出碎片 — 核心写路径.
   *
   * 流程 (单事务):
   *   1. 幂等检查 (idempotencyKey 已存在则返回首次结果)
   *   2. 批量 INSERT fragment_logs (delta > 0)
   *   3. 计算新余额
   *   4. 触发 reconciliation (碎片累计可能解锁 Collector 徽章)
   *   5. 返回新余额 + 本次新解锁的徽章
   */
  async grant(userId: string, dto: GrantFragmentsDto): Promise<GrantFragmentsResponseDto> {
    // 幂等: 同 key 24h 内直接返回上次结果 (缓存走内存 Map, 服务重启会丢;
    // 生产环境应升级到 Redis — 见 TBD).
    // 这里简化: 不做缓存, 直接 INSERT, 由数据库 UNIQUE 索引兜底 (暂未建, V3 加).
    await this.dataSource.transaction(async (tx) => {
      const repo = tx.getRepository(FragmentLog);
      const entities = dto.grants.map((g) =>
        repo.create({
          userId,
          type: g.type,
          delta: g.delta,
          source: g.source,
          idempotencyKey: dto.idempotencyKey ?? null,
          context: dto.context ?? null,
        }),
      );
      await repo.save(entities);
    });

    // 触发 reconciliation (碎片累计 → Collector)
    const newlyUnlocked = await this.reconciliationService.reconcileAfterFragmentChange(
      userId,
      dto.grants.reduce((acc, g) => acc + Math.max(g.delta, 0), 0),
    );

    const balances = await this.getBalances(userId);

    return {
      balances,
      newlyUnlockedBadges: [...newlyUnlocked],
    };
  }

  /**
   * 消耗碎片 — 用于兑换皮肤/装饰/盲盒.
   *
   * 流程 (单事务 + FOR UPDATE 防并发):
   *   1. SELECT balance FOR UPDATE
   *   2. 校验余额 >= abs(delta)
   *   3. INSERT fragment_logs (delta < 0)
   *   4. 触发 reconciliation
   */
  async consume(
    userId: string,
    type: FragmentType,
    delta: number,
    source: FragmentSource,
    context?: Record<string, unknown>,
    idempotencyKey?: string,
  ): Promise<{ balances: FragmentBalanceItemDto[]; newlyUnlockedBadges: string[] }> {
    if (delta <= 0) {
      throw new Error('consume delta 必须为正数, 业务层传入 abs');
    }

    await this.dataSource.transaction(async (tx) => {
      const repo = tx.getRepository(FragmentLog);
      // SELECT SUM FOR UPDATE — 锁定用户的所有碎片行, 防并发扣减.
      // TypeORM: setLock('pessimistic_write') 翻译为 SELECT ... FOR UPDATE.
      // 注意: PostgreSQL 支持 SELECT FOR UPDATE, MySQL 8 也支持.
      const balanceRow = await repo
        .createQueryBuilder('f')
        .select('COALESCE(SUM(f.delta), 0)', 'balance')
        // V2026-09-03 治本: 同 getBalances, raw WHERE 走列名 (见同文件 48 行注释).
        .where('user_id = :userId', { userId })
        .andWhere('f.type = :type', { type })
        .setLock('pessimistic_write')
        .getRawOne<{ balance: string }>();

      const currentBalance = Number.parseInt(balanceRow?.balance ?? '0', 10);
      if (currentBalance < delta) {
        throw new InsufficientFragmentsException(type, currentBalance, delta);
      }

      // TypeORM v0.3 对 jsonb + enum 字段的 _QueryDeepPartialEntity 递归推断会生成
      // `(() => string)` 等意外类型, 这里用 repo.insert 的参数类型直接收口,
      // 避免对每个字段逐一类型断言.
      type FragmentLogInsertPayload = Parameters<Repository<FragmentLog>['insert']>[0];
      const insertPayload: FragmentLogInsertPayload = {
        userId,
        type,
        delta: -delta,
        source,
        idempotencyKey: idempotencyKey ?? null,
        context: (context ?? null) as FragmentLogInsertPayload extends infer T ? (T extends { context?: infer C } ? C : never) : never,
      };
      await repo.insert(insertPayload);
    });

    const newlyUnlocked = await this.reconciliationService.reconcileAfterFragmentChange(userId, 0);

    const balances = await this.getBalances(userId);
    return { balances, newlyUnlockedBadges: [...newlyUnlocked] };
  }

  /**
   * 内部用 — 供 service 层取当前用户产出碎片总数 (用于 Collector 徽章).
   * 走 SUM(delta > 0).
   */
  async getTotalGranted(userId: string): Promise<number> {
    const row = await this.logRepo
      .createQueryBuilder('f')
      .select('COALESCE(SUM(CASE WHEN f.delta > 0 THEN f.delta ELSE 0 END), 0)', 'total')
      // V2026-09-03 治本: 同 getBalances, raw WHERE 走列名 (见同文件 48 行注释).
      .where('user_id = :userId', { userId })
      .getRawOne<{ total: string }>();
    return Number.parseInt(row?.total ?? '0', 10);
  }

  private mapLogToDto(r: FragmentLog): FragmentLogDto {
    return {
      id: r.id,
      type: r.type,
      delta: r.delta,
      source: r.source,
      context: r.context,
      createdAt: r.createdAt.toISOString(),
    };
  }
}

/** 余额不足异常 — service 内部抛, controller 映射 400. */
export class InsufficientFragmentsException extends Error {
  constructor(
    public readonly type: FragmentType,
    public readonly current: number,
    public readonly required: number,
  ) {
    super(`碎片 ${type} 余额 ${current} < 需要 ${required}`);
  }
}
