import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { FindOptionsWhere, In, IsNull, Repository } from 'typeorm';

import type { MarkMessagesReadResponseDto, UnreadMessageCountDto } from '../dto/home-overview.dto';
import { HomeMessage } from '../entities/home-message.entity';

/**
 * 心塑首页「消息未读」核心服务.
 *
 * 职责:
 *   - getUnreadCount(uid): 顶部红点用
 *   - markRead(uid, messageIds?): 标记已读 (支持批量 + 全量)
 *
 * 大厂做法:
 *   - 单 query: WHERE uid=? AND read_at IS NULL
 *   - 标记: 走 update 一次性写 read_at (避免 N+1)
 *   - 软删: read_at 不为空 → 不显示 (保留审计)
 */
@Injectable()
export class HomeMessagesService {
  private readonly logger = new Logger(HomeMessagesService.name);

  constructor(
    @InjectRepository(HomeMessage)
    private readonly repo: Repository<HomeMessage>,
  ) {}

  /**
   * 读未读消息数.
   */
  async getUnreadCount(uid: string): Promise<UnreadMessageCountDto> {
    const count = await this.repo.count({
      where: { uid, readAt: IsNull() },
    });
    return { count };
  }

  /**
   * 标记消息已读.
   *
   * V2.0: 全量 = 传 messageIds=null; 部分 = 传 messageIds=[...]
   * V3: 加 idempotency key 防双击 (e.g. requestUuid)
   *
   * 大厂做法:
   *   - 用 FindOptionsWhere<HomeMessage> 显式声明 where 类型, 避开 IsNull() / In()
   *     在 union 类型下的 type widening 问题.
   *   - update + 1 query 重算剩余 — 比 save + count 2 步省 1 次 DB roundtrip.
   */
  async markRead(uid: string, messageIds: string[] | undefined): Promise<MarkMessagesReadResponseDto> {
    const now = new Date();
    const where: FindOptionsWhere<HomeMessage> = {
      uid,
      readAt: IsNull(),
    };
    if (messageIds && messageIds.length > 0) {
      where.id = In(messageIds);
    }

    const result = await this.repo.update(where, { readAt: now });

    // 重算剩余未读
    const remaining = await this.repo.count({
      where: { uid, readAt: IsNull() } as FindOptionsWhere<HomeMessage>,
    });

    this.logger.log(`markRead uid=${uid} marked=${result.affected ?? 0} remaining=${remaining}`);
    return {
      count: remaining,
      markedCount: result.affected ?? 0,
    };
  }
}
