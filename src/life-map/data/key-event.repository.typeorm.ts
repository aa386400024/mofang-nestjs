// V2026-11-14 治本 (TD-16 · C1 试点域仓储端口化 · life-map 域 · P-DEBT-11 / L-1):
//   `KeyEventRepository` 端口的 TypeORM 实现 —— 域内 typeorm 值符号落点之一.
//
//   治本:
//     - 查询口径全部收在本实现内: userId 隔离 + deletedAt 软删过滤 + age 升序 ——
//       与改前 service 里写的条件**逐字一致**
//     - 软删是**状态迁移** —— 端口收成 `softDeleteEvent(eventId, deletedAt)`,
//       删除时刻由 service 生成 (端口不自己取"现在"), 实现只落库
//     - 实现不写新口径、不加新条件; 不暴露 EntityManager / FindOptions 给上层
//
//   反双胞胎:
//     - 不把 entity 行直接漏给 service —— 端口出参是 Row 领域类型
//     - 不用 `update(id, patch: Partial<Entity>)` 泛型接口 —— 那会把 entity 类型
//       漏进业务层; 更新走 `saveEvent(input)` (7 个可变字段的最终值)
//     - 不在实现里吞异常 —— 写失败要冒到 service
//
//   如何验证:
//     1. tsc 0 错; module provider 接线后 life-map 的事件 CRUD 端点口径不变
//     2. 单元测试用端口替身驱动 service (不起真 TypeORM / 不连 DB)
//   时间戳: 2026-11-14 GMT+8

import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';

import type {
  CreateKeyEventInput,
  KeyEventRepository,
  KeyEventRow,
  SaveKeyEventInput,
} from '../domain/repositories/key-event.repository.js';
import { KeyEventEntity } from '../entities/key-event.entity.js';

/**
 * 关键事件仓储 (TypeORM 真库实现).
 */
@Injectable()
export class KeyEventRepositoryTypeorm implements KeyEventRepository {
  /**
   * @param repo 关键事件实体仓储
   */
  constructor(
    @InjectRepository(KeyEventEntity)
    private readonly repo: Repository<KeyEventEntity>,
  ) {}

  /**
   * 该用户全部**未软删**的事件行 (按 age 升序).
   *
   * @param userId 用户隔离
   * @returns 行数组 (无命中返空数组)
   */
  async listActiveByUser(userId: string): Promise<KeyEventRow[]> {
    const rows = await this.repo.find({
      where: { userId, deletedAt: IsNull() },
      order: { age: 'ASC' },
    });
    return rows.map(toRow);
  }

  /**
   * 该用户**未软删**的事件数.
   *
   * @param userId 用户隔离
   * @returns 命中条数 (无命中返 0)
   */
  async countActiveByUser(userId: string): Promise<number> {
    return this.repo.count({
      where: { userId, deletedAt: IsNull() },
    });
  }

  /**
   * 单条**未软删**事件 (按 id + userId 定位, 越权查不到).
   *
   * @param userId 用户隔离
   * @param eventId 事件 id
   * @returns 行 (无命中返 null)
   */
  async findActiveById(userId: string, eventId: string): Promise<KeyEventRow | null> {
    const row = await this.repo.findOne({
      where: { id: eventId, userId, deletedAt: IsNull() },
    });
    return row ? toRow(row) : null;
  }

  /**
   * 新增一条事件.
   *
   * @param input 8 个业务字段
   * @returns 落库后的行
   */
  async createEvent(input: CreateKeyEventInput): Promise<KeyEventRow> {
    const saved = await this.repo.save(
      this.repo.create({
        userId: input.userId,
        title: input.title,
        age: input.age,
        type: input.type,
        description: input.description,
        feelings: input.feelings,
        influence: input.influence,
        interpretation: input.interpretation,
        stage: input.stage,
      }),
    );
    return toRow(saved);
  }

  /**
   * 更新一条既有事件 (写入调用方给定的最终值).
   *
   * @param input id + 8 个业务字段的最终值
   * @returns 落库后的行
   */
  async saveEvent(input: SaveKeyEventInput): Promise<KeyEventRow> {
    const saved = await this.repo.save(
      this.repo.create({
        id: input.id,
        userId: input.userId,
        title: input.title,
        age: input.age,
        type: input.type,
        description: input.description,
        feelings: input.feelings,
        influence: input.influence,
        interpretation: input.interpretation,
        stage: input.stage,
      }),
    );
    return toRow(saved);
  }

  /**
   * 软删一条事件 (写 deleted_at, 不物理删).
   *
   * @param eventId 事件 id
   * @param deletedAt 删除时刻 (由 service 生成)
   */
  async softDeleteEvent(eventId: string, deletedAt: Date): Promise<void> {
    await this.repo.update({ id: eventId }, { deletedAt });
  }
}

/** entity → Row 映射 (窄字段, 不带 deletedAt). */
function toRow(entity: KeyEventEntity): KeyEventRow {
  return {
    id: entity.id,
    userId: entity.userId,
    title: entity.title,
    age: entity.age,
    type: entity.type,
    description: entity.description ?? null,
    feelings: entity.feelings ?? null,
    influence: entity.influence ?? null,
    interpretation: entity.interpretation ?? null,
    stage: entity.stage ?? null,
    createdAt: entity.createdAt,
    updatedAt: entity.updatedAt,
  };
}
