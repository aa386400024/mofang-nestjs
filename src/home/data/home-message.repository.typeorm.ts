// V2026-11-15 治本 (TD-20 · C2 第四批仓储端口化 · home 域 · P-DEBT-11 / L-1):
//   `HomeMessageRepository` 端口的 TypeORM 实现 —— home 域**唯一**允许出现
//   typeorm 值符号的业务文件 (module 装配层除外).
//
//   治本:
//     - 查询口径全部下沉: 未读计数 (uid + 未读条件) 与已读标记
//       (uid + 未读条件 + 可选 id 集合 + 写已读时刻) 两条口径都在本实现内
//     - 实现不写新口径、不加新条件 —— 本单是结构重构, 不是查询优化
//     - 不暴露 EntityManager / 查询选项给上层
//     - **不吞异常** —— 写失败要冒到 service (service 现有语义逐字保留)
//
//   反双胞胎:
//     - 不把实体行漏给 service —— 本端口**无 Row 出参** (service 只拿计数)
//     - 已读标记不是软删列 —— 本实现只做「标记已读」, 没有恢复 / 擦除路径
//
//   如何验证:
//     1. tsc 0 错; module provider 接线后消息的 2 个端点口径不变
//     2. 单元测试用端口替身驱动 service (不起真 TypeORM / 不连 DB)
//   时间戳: 2026-11-15 GMT+8

import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { FindOptionsWhere, In, IsNull, Repository } from 'typeorm';

import type { HomeMessageRepository } from '../domain/repositories/home-message.repository.js';
import { HomeMessage } from '../entities/home-message.entity.js';

/**
 * 首页消息仓储 (TypeORM 真库实现).
 */
@Injectable()
export class HomeMessageRepositoryTypeorm implements HomeMessageRepository {
  /**
   * @param repo 首页消息实体仓储
   */
  constructor(
    @InjectRepository(HomeMessage)
    private readonly repo: Repository<HomeMessage>,
  ) {}

  /**
   * 统计未读消息数 —— uid + 未读条件.
   *
   * @param uid 用户 id
   * @returns 未读条数
   */
  async countUnread(uid: string): Promise<number> {
    return this.repo.count({
      where: { uid, readAt: IsNull() },
    });
  }

  /**
   * 标记消息已读 —— 返回本次标记条数.
   *
   * 大厂做法: 单条 update 一次性写已读时刻 (避免 N+1); 指定 id 列表时追加
   *   id 集合条件; 不传 / 空列表 = 标记该用户全部未读.
   *
   * @param uid 用户 id
   * @param messageIds 指定消息 id 列表 (不传 / 空数组 = 全部未读)
   * @returns 本次标记条数
   */
  async markRead(uid: string, messageIds: string[] | undefined): Promise<number> {
    const where: FindOptionsWhere<HomeMessage> = {
      uid,
      readAt: IsNull(),
    };
    if (messageIds && messageIds.length > 0) {
      where.id = In(messageIds);
    }

    const result = await this.repo.update(where, { readAt: new Date() });
    return result.affected ?? 0;
  }
}
