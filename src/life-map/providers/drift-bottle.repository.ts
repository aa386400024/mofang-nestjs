import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Not, Repository } from 'typeorm';

import { DriftBottleStatsDto } from '../dto/drift-bottle-stats.dto';
import { DriftBottleEntry } from '../entities/drift-bottle-entry.entity';
import { DriftBottleStatus } from '../enums/drift-bottle-status.enum';

/**
 * 漂流瓶 Repository — V2026-09-12 §6.5 心塑 V6.0.
 *
 * 大厂 standard:
 *   - 5 个核心查询方法 (1:1 跟前端 DriftBottleRepository 接口)
 *   - 不冗余查询 (DRIFT 状态独立 + PICKED-for-me 一起塞 sea 列表)
 *   - 索引 (author_id, created_at) + (status, created_at) + picked_by_user_id 全用上
 *
 * 反双胞胎:
 *   - 不复用 companion/companion.service.ts (无关模块)
 *   - 不复用 good_state_diary/.../repository (无关模块)
 *
 * 数据库 row ↔ entity 1:1, DTO 转换在 service 层做.
 */
@Injectable()
export class DriftBottleRepository {
  constructor(
    @InjectRepository(DriftBottleEntry)
    private readonly repo: Repository<DriftBottleEntry>,
  ) {}

  /**
   * 创建新瓶 (postBottle).
   */
  public async create(input: { authorId: string; authorAnonymousName: string; content: string }): Promise<DriftBottleEntry> {
    const entity = this.repo.create({
      authorId: input.authorId,
      authorAnonymousName: input.authorAnonymousName,
      content: input.content,
      status: DriftBottleStatus.DRIFT,
    });
    return this.repo.save(entity);
  }

  /**
   * 按 id 查 (响应写回信时用).
   */
  public async findById(id: string): Promise<DriftBottleEntry | null> {
    return this.repo.findOne({ where: { id } });
  }

  /**
   * 随机捞 1 封 (排除自己的 + 排除最近捞过的).
   *
   * 大厂 standard (对标微信漂流瓶):
   *   - 不重复返回刚捞过的 (业务层做"最近 1 分钟" 冷却)
   *   - 限制同一用户在同一时间窗只能捞一次 (放业务层 cooldownMap)
   *
   * 注: 冷却 / 字符长度校验在 service 层做, 这里只关心 DB 查询.
   */
  public async pickRandomExcluding(currentUserId: string, excludeIds: string[]): Promise<DriftBottleEntry | null> {
    const qb = this.repo
      .createQueryBuilder('b')
      .where('b.authorId != :uid', { uid: currentUserId })
      .andWhere('b.status = :st', { st: DriftBottleStatus.DRIFT });
    if (excludeIds.length > 0) {
      qb.andWhere('b.id NOT IN (:...ids)', { ids: excludeIds });
    }
    qb.orderBy('RAND()').limit(1);
    return qb.getOne();
  }

  /**
   * 海面列表 (DRIFT + 我自己被捞的 PICKED).
   */
  public async findSea(currentUserId: string): Promise<DriftBottleEntry[]> {
    return this.repo
      .createQueryBuilder('b')
      .where('b.authorId != :uid', { uid: currentUserId })
      .andWhere('(b.status = :drift OR (b.status = :picked AND b.pickedByUserId = :uid))', {
        drift: DriftBottleStatus.DRIFT,
        picked: DriftBottleStatus.PICKED,
        uid: currentUserId,
      })
      .orderBy('b.createdAt', 'DESC')
      .getMany();
  }

  /**
   * 我投过的瓶子.
   */
  public async findMine(currentUserId: string): Promise<DriftBottleEntry[]> {
    return this.repo.find({
      where: { authorId: currentUserId },
      order: { createdAt: 'DESC' },
    });
  }

  /**
   * 我收到的回信 (我捞起 + 作者回信 + 关系冻结).
   */
  public async findInbox(currentUserId: string): Promise<DriftBottleEntry[]> {
    return this.repo.find({
      where: {
        pickedByUserId: currentUserId,
        status: DriftBottleStatus.RESPONDED,
      },
      order: { respondedAt: 'DESC' },
    });
  }

  /**
   * 4 个 counter 统计 (大厂 standard: 4 个 count, 不要全表扫).
   *
   * seaCount = 海面别人投的 (排除自己) — 跟 pickRandom 过滤一致
   * myPostedCount = 我投的所有 (drift + picked + responded 全算)
   * myPickedCount = 我捞起来的所有 (有 picked_by_user_id)
   * myRespondedCount = 我给作者写过回信的 (responded_text IS NOT NULL AND picked_by_user_id = me)
   */
  public async getStats(currentUserId: string): Promise<DriftBottleStatsDto> {
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
   * 更新 status (DRIFT → PICKED → RESPONDED).
   */
  public async update(id: string, patch: Partial<DriftBottleEntry>): Promise<DriftBottleEntry> {
    await this.repo.update({ id }, patch);
    const updated = await this.findById(id);
    if (!updated) {
      throw new Error(`DriftBottleEntry ${id} 不存在`);
    }
    return updated;
  }
}
