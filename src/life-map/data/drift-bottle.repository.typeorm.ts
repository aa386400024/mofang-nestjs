// V2026-11-14 治本 (TD-16 · C1 试点域仓储端口化 · life-map 域 · P-DEBT-11 / L-1):
//   `DriftBottleRepository` 端口的 TypeORM 实现 —— 由改前的手写 `@Injectable()`
//   仓储类 (`providers/drift-bottle.repository.ts`) 迁到本文件并提为端口实现.
//
//   治本:
//     - 查询口径全部收在本实现内 (作者隔离 / 状态机过滤 / 排序 / 随机捞瓶的
//       QueryBuilder 口径) —— 与改前逐字一致
//     - **状态迁移收成两段具名方法** (markPicked / markResponded) —— 改前的
//       `update(id, patch: Partial<DriftBottleEntry>)` 把 entity 类型漏进了
//       业务层, 端口化时收窄; 状态机的目标态由实现落库, service 只说"迁移到哪"
//     - 4 个 counter 仍在实现里算 (海面 / 我投的 / 我捞的 / 我回的) ——
//       service 只拿数, 不做查询拼接
//
//   反双胞胎:
//     - 不把 entity 行直接漏给 service —— 端口出参是 Row 领域类型
//     - 不复用 companion/companion.service.ts (无关模块)
//     - 不复用 good_state_diary/.../repository (无关模块)
//
//   如何验证:
//     1. tsc 0 错; module provider 接线后 life-map 的 6 个漂流瓶端点口径不变
//     2. 单元测试用端口替身驱动 service (不起真 TypeORM / 不连 DB)
//   时间戳: 2026-11-14 GMT+8

import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Not, Repository } from 'typeorm';

import type {
  CreateDriftBottleInput,
  DriftBottleRepository,
  DriftBottleRow,
  DriftBottleStats,
  MarkBottlePickedInput,
  MarkBottleRespondedInput,
} from '../domain/repositories/drift-bottle.repository.js';
import { DriftBottleEntry } from '../entities/drift-bottle-entry.entity.js';
import { DriftBottleStatus } from '../enums/drift-bottle-status.enum.js';

/**
 * 漂流瓶仓储 (TypeORM 真库实现).
 *
 * 大厂 standard:
 *   - 5 个核心查询方法 (1:1 跟前端 DriftBottleRepository 接口)
 *   - 不冗余查询 (DRIFT 状态独立 + PICKED-for-me 一起塞 sea 列表)
 *   - 索引 (author_id, created_at) + (status, created_at) + picked_by_user_id 全用上
 *
 * 数据库 row ↔ 领域 Row 1:1, DTO 转换在 service 层做.
 */
@Injectable()
export class DriftBottleRepositoryTypeorm implements DriftBottleRepository {
  /**
   * @param repo 漂流瓶实体仓储
   */
  constructor(
    @InjectRepository(DriftBottleEntry)
    private readonly repo: Repository<DriftBottleEntry>,
  ) {}

  /**
   * 创建新瓶 (postBottle).
   *
   * @param input 3 个业务字段
   * @returns 落库后的行
   */
  async create(input: CreateDriftBottleInput): Promise<DriftBottleRow> {
    const entity = this.repo.create({
      authorId: input.authorId,
      authorAnonymousName: input.authorAnonymousName,
      content: input.content,
      status: DriftBottleStatus.DRIFT,
    });
    const saved = await this.repo.save(entity);
    return toRow(saved);
  }

  /**
   * 按 id 查 (响应写回信时用).
   *
   * @param id 瓶 id
   * @returns 行 (无命中返 null)
   */
  async findById(id: string): Promise<DriftBottleRow | null> {
    const row = await this.repo.findOne({ where: { id } });
    return row ? toRow(row) : null;
  }

  /**
   * 随机捞 1 封 (排除自己的 + 排除最近捞过的).
   *
   * 大厂 standard (对标微信漂流瓶):
   *   - 不重复返回刚捞过的 (业务层做"最近 1 分钟" 冷却)
   *   - 限制同一用户在同一时间窗只能捞一次 (放业务层 cooldownMap)
   *
   * 注: 冷却 / 字符长度校验在 service 层做, 这里只关心 DB 查询.
   *
   * @param currentUserId 当前用户 (排除自己的瓶)
   * @param excludeIds 冷却期内刚捞过的瓶 id
   * @returns 行 (海面空返 null)
   */
  async pickRandomExcluding(currentUserId: string, excludeIds: string[]): Promise<DriftBottleRow | null> {
    const qb = this.repo
      .createQueryBuilder('b')
      .where('b.authorId != :uid', { uid: currentUserId })
      .andWhere('b.status = :st', { st: DriftBottleStatus.DRIFT });
    if (excludeIds.length > 0) {
      qb.andWhere('b.id NOT IN (:...ids)', { ids: excludeIds });
    }
    qb.orderBy('RAND()').limit(1);
    const row = await qb.getOne();
    return row ? toRow(row) : null;
  }

  /**
   * 海面列表 (DRIFT + 我自己被捞的 PICKED).
   *
   * @param currentUserId 当前用户
   * @returns 行数组
   */
  async findSea(currentUserId: string): Promise<DriftBottleRow[]> {
    const rows = await this.repo
      .createQueryBuilder('b')
      .where('b.authorId != :uid', { uid: currentUserId })
      .andWhere('(b.status = :drift OR (b.status = :picked AND b.pickedByUserId = :uid))', {
        drift: DriftBottleStatus.DRIFT,
        picked: DriftBottleStatus.PICKED,
        uid: currentUserId,
      })
      .orderBy('b.createdAt', 'DESC')
      .getMany();
    return rows.map(toRow);
  }

  /**
   * 我投过的瓶子.
   *
   * @param currentUserId 当前用户
   * @returns 行数组
   */
  async findMine(currentUserId: string): Promise<DriftBottleRow[]> {
    const rows = await this.repo.find({
      where: { authorId: currentUserId },
      order: { createdAt: 'DESC' },
    });
    return rows.map(toRow);
  }

  /**
   * 我收到的回信 (我捞起 + 作者回信 + 关系冻结).
   *
   * @param currentUserId 当前用户
   * @returns 行数组
   */
  async findInbox(currentUserId: string): Promise<DriftBottleRow[]> {
    const rows = await this.repo.find({
      where: {
        pickedByUserId: currentUserId,
        status: DriftBottleStatus.RESPONDED,
      },
      order: { respondedAt: 'DESC' },
    });
    return rows.map(toRow);
  }

  /**
   * 4 个 counter 统计 (大厂 standard: 4 个 count, 不要全表扫).
   *
   * seaCount = 海面别人投的 (排除自己) — 跟 pickRandom 过滤一致
   * myPostedCount = 我投的所有 (drift + picked + responded 全算)
   * myPickedCount = 我捞起来的所有 (有 picked_by_user_id)
   * myRespondedCount = 我给作者写过回信的 (responded_text IS NOT NULL AND picked_by_user_id = me)
   *
   * @param currentUserId 当前用户
   * @returns 4 个 counter
   */
  async getStats(currentUserId: string): Promise<DriftBottleStats> {
    const seaCount = await this.repo.count({
      // V2026-09-12 fix (no-unsafe-assignment): typeorm 1.x Not() 返回 error-typed FindOperator,
      //    count.where object 推导不出精确类型. as any 兜住, 业务逻辑不变.
      where: {
        authorId: Not(currentUserId),
        status: DriftBottleStatus.DRIFT,
      },
    });

    const myPostedCount = await this.repo.count({
      where: { authorId: currentUserId },
    });

    const myPickedCount = await this.repo.count({
      where: { pickedByUserId: currentUserId },
    });

    // V2026-09-12 fix (typeorm 1.x): Not(IsNull()) 移除, 改用 QueryBuilder + IS NOT NULL 字符串.
    //    1.x Repository.find/count 不支持 Not operator, 用 Qb 才稳.
    const myRespondedCount = await this.repo
      .createQueryBuilder('b')
      .where('b.pickedByUserId = :uid', { uid: currentUserId })
      .andWhere('b.respondedText IS NOT NULL')
      .getCount();

    return {
      seaCount,
      myPostedCount,
      myPickedCount,
      myRespondedCount,
    };
  }

  /**
   * 状态迁移: DRIFT → PICKED (标记捞起者).
   *
   * @param id 瓶 id
   * @param input 捞起者信息
   * @returns 迁移后的行
   */
  async markPicked(id: string, input: MarkBottlePickedInput): Promise<DriftBottleRow> {
    await this.repo.update(
      { id },
      {
        status: DriftBottleStatus.PICKED,
        pickedByUserId: input.pickedByUserId,
        pickedByAnonymousName: input.pickedByAnonymousName,
        pickedAt: input.pickedAt,
      },
    );
    const updated = await this.findById(id);
    if (!updated) {
      throw new Error(`DriftBottleEntry ${id} 不存在`);
    }
    return updated;
  }

  /**
   * 状态迁移: PICKED → RESPONDED (写回信).
   *
   * @param id 瓶 id
   * @param input 回信内容与时刻
   * @returns 迁移后的行
   */
  async markResponded(id: string, input: MarkBottleRespondedInput): Promise<DriftBottleRow> {
    await this.repo.update(
      { id },
      {
        status: DriftBottleStatus.RESPONDED,
        respondedText: input.respondedText,
        respondedAt: input.respondedAt,
      },
    );
    const updated = await this.findById(id);
    if (!updated) {
      throw new Error(`DriftBottleEntry ${id} 不存在`);
    }
    return updated;
  }
}

/** entity → Row 映射. */
function toRow(entity: DriftBottleEntry): DriftBottleRow {
  return {
    id: entity.id,
    authorId: entity.authorId,
    authorAnonymousName: entity.authorAnonymousName,
    content: entity.content,
    status: entity.status,
    pickedByUserId: entity.pickedByUserId,
    pickedByAnonymousName: entity.pickedByAnonymousName,
    pickedAt: entity.pickedAt,
    respondedText: entity.respondedText,
    respondedAt: entity.respondedAt,
    createdAt: entity.createdAt,
    updatedAt: entity.updatedAt,
  };
}
