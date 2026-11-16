// V2026-11-14 治本 (TD-18 · C2 第二批仓储端口化 · good_state_diary 域 · P-DEBT-11 / L-1):
//   `DiaryEntryRepository` 端口的 TypeORM 实现 —— good_state_diary 域**唯一**允许出现
//   typeorm 值符号的业务文件 (module 装配层除外).
//
//   治本:
//     - 查询口径全部收在本实现内: 双游标分页 (createdAt + id DESC) / limit + 1 取行 /
//       LIKE 检索 / tag AND 的 comma-padding LIKE / 草稿 take 200 / 软删过滤与 withDeleted /
//       到期软删物理擦除 —— 与改前 service 里写的条件**逐字一致**
//     - 实现不写新口径、不加新条件 —— 本单是结构重构, 不是查询优化
//     - 不暴露 EntityManager / FindOptions 给上层
//     - **不吞异常** —— 写失败要冒到 service (service 现有语义逐字保留)
//     - **实体工厂在本实现内** —— service 只构造纯对象, 不依赖仓储工厂方法
//
//   反双胞胎:
//     - 不把 entity 行直接漏给 service —— 端口出参是 Row 领域类型
//     - 行不由本实现构造 —— 行的字段集合由 service 决定 (纯对象),
//       本实现只负责落库 + 回填
//
//   如何验证:
//     1. tsc 0 错; module provider 接线后日记的 9 个端点口径不变
//     2. 单元测试用端口替身驱动 service (不起真 TypeORM / 不连 DB)
//   时间戳: 2026-11-14 GMT+8

import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import type {
  CreateDiaryEntryInput,
  DiaryEntryRepository,
  DiaryRow,
  ListRecentEntriesQuery,
  SearchEntriesQuery,
} from '../domain/repositories/diary-entry.repository.js';
import { GoodStateDiaryEntry } from '../entities/good-state-diary-entry.entity.js';
import { DiaryEntryStatus } from '../enums/diary-entry-status.enum.js';

/** 草稿箱上限 (前端无分页参数, 防御性 cap). */
const DRAFTS_LIMIT = 200;

/**
 * 日记仓储 (TypeORM 真库实现).
 */
@Injectable()
export class DiaryEntryRepositoryTypeorm implements DiaryEntryRepository {
  /**
   * @param repo 日记实体仓储
   */
  constructor(
    @InjectRepository(GoodStateDiaryEntry)
    private readonly repo: Repository<GoodStateDiaryEntry>,
  ) {}

  /**
   * 新增一行 —— 实体工厂在实现层 (service 只给纯对象).
   *
   * @param input 新增入参
   * @returns 落库后的行
   */
  async create(input: CreateDiaryEntryInput): Promise<DiaryRow> {
    const saved = await this.repo.save(this.repo.create(input));
    return toRow(saved);
  }

  /**
   * 更新既有行 —— 整行落库 (id / createdAt / updatedAt / deletedAt 一并带上).
   *
   * @param row 整行
   * @returns 落库后的行
   */
  async save(row: DiaryRow): Promise<DiaryRow> {
    const saved = await this.repo.save(this.repo.create(row));
    return toRow(saved);
  }

  /**
   * 按 id + authorId 取单行 —— 默认排除软删, includeDeleted 时含软删行.
   *
   * @param uid 作者 id
   * @param entryId 日记 id
   * @param opts includeDeleted = true 时含软删行
   * @returns 行 (无命中返 null)
   */
  async findById(uid: string, entryId: string, opts?: { includeDeleted?: boolean }): Promise<DiaryRow | null> {
    const row = await this.repo.findOne({
      where: { id: entryId, authorId: uid },
      withDeleted: opts?.includeDeleted === true,
    });
    return row ? toRow(row) : null;
  }

  /**
   * 草稿箱 —— status=draft, createdAt + id 倒序, 取 200 条.
   *
   * @param uid 作者 id
   * @returns 行列表
   */
  async findDrafts(uid: string): Promise<DiaryRow[]> {
    const rows = await this.repo.find({
      where: { authorId: uid, status: DiaryEntryStatus.Draft },
      order: { createdAt: 'DESC', id: 'DESC' },
      take: DRAFTS_LIMIT,
    });
    return rows.map((row) => toRow(row));
  }

  /**
   * 最近列表 —— author_id + status IN + 双游标倒序 + limit + 1 取行.
   *
   * @param query 查询入参
   * @returns 行列表 (最多 limit + 1 行)
   */
  async listRecent(query: ListRecentEntriesQuery): Promise<DiaryRow[]> {
    const qb = this.repo
      .createQueryBuilder('e')
      .where('e.author_id = :uid', { uid: query.uid })
      .andWhere('e.status IN (:...statuses)', { statuses: query.statuses })
      .orderBy('e.created_at', 'DESC')
      .addOrderBy('e.id', 'DESC')
      .limit(query.limit + 1);

    if (query.cursor) {
      // DESC 排序 → 下一批取「更老」的行: created_at < cursorT, 同时间戳取 id 更小
      qb.andWhere('(e.created_at < :cursorT OR (e.created_at = :cursorT AND e.id < :cursorI))', {
        cursorT: query.cursor.t,
        cursorI: query.cursor.i,
      });
    }

    const rows = await qb.getMany();
    return rows.map((row) => toRow(row));
  }

  /**
   * 全文检索 —— LIKE 模糊 + tag AND (comma-padding) + 双游标倒序 + limit + 1 取行.
   *
   * @param query 查询入参
   * @returns 行列表 (最多 limit + 1 行)
   */
  async searchEntries(query: SearchEntriesQuery): Promise<DiaryRow[]> {
    const qb = this.repo
      .createQueryBuilder('e')
      .where('e.author_id = :uid', { uid: query.uid })
      .andWhere('(e.title LIKE :like OR e.body LIKE :like)', { like: query.likePattern })
      .orderBy('e.created_at', 'DESC')
      .addOrderBy('e.id', 'DESC')
      .limit(query.limit + 1);

    if (query.cursor) {
      qb.andWhere('(e.created_at < :cursorT OR (e.created_at = :cursorT AND e.id < :cursorI))', {
        cursorT: query.cursor.t,
        cursorI: query.cursor.i,
      });
    }

    // Tag AND 过滤 —— comma-padding LIKE 防子串误匹配.
    for (const [idx, tag] of query.tagFilters.entries()) {
      qb.andWhere("CONCAT(',', IFNULL(e.tags, ''), ',') LIKE CONCAT('%,', :tagFilter" + idx + ", ',%')", {
        [`tagFilter${idx}`]: tag as string,
      });
    }

    const rows = await qb.getMany();
    return rows.map((row) => toRow(row));
  }

  /**
   * 软删 —— 按 id + author_id 打删除时间戳.
   *
   * @param uid 作者 id
   * @param entryId 日记 id
   * @returns 受影响行数
   */
  async softDelete(uid: string, entryId: string): Promise<{ affected: number }> {
    const result = await this.repo.softDelete({ id: entryId, authorId: uid });
    return { affected: result.affected ?? 0 };
  }

  /**
   * 恢复软删 —— 按 id + author_id 清删除时间戳.
   *
   * @param uid 作者 id
   * @param entryId 日记 id
   * @returns 受影响行数
   */
  async restore(uid: string, entryId: string): Promise<{ affected: number }> {
    const result = await this.repo.restore({ id: entryId, authorId: uid });
    return { affected: result.affected ?? 0 };
  }

  /**
   * 物理擦除某作者全部日记 —— 硬删 (软删列不影响 delete 语义).
   *
   * @param uid 作者 id
   * @returns 受影响行数
   */
  async deleteByAuthor(uid: string): Promise<{ affected: number }> {
    const result = await this.repo.delete({ authorId: uid });
    return { affected: result.affected ?? 0 };
  }

  /**
   * 物理擦除到期软删条目 —— QB 走列名, 不带 alias (同 fragment-log 治本笔记).
   *
   * @param cutoff 擦除截止时间
   * @returns 受影响行数
   */
  async purgeExpiredSoftDeletes(cutoff: Date): Promise<{ affected: number }> {
    const result = await this.repo
      .createQueryBuilder()
      .delete()
      .where('deleted_at IS NOT NULL')
      .andWhere('deleted_at < :cutoff', { cutoff })
      .execute();
    return { affected: result.affected ?? 0 };
  }
}

/** entity → Row 映射 (窄字段, 保留 deletedAt). */
function toRow(entity: GoodStateDiaryEntry): DiaryRow {
  return {
    id: entity.id,
    authorId: entity.authorId,
    status: entity.status,
    title: entity.title,
    body: entity.body,
    moodLevel: entity.moodLevel,
    moodSnapshottedAt: entity.moodSnapshottedAt,
    moodNote: entity.moodNote,
    sourceEmotionLogId: entity.sourceEmotionLogId,
    tags: entity.tags,
    linkedPracticeId: entity.linkedPracticeId,
    aiFeedback: entity.aiFeedback,
    aiFeedbackGeneratedAt: entity.aiFeedbackGeneratedAt,
    isPrivate: entity.isPrivate,
    createdAt: entity.createdAt,
    updatedAt: entity.updatedAt,
    deletedAt: entity.deletedAt,
  };
}
