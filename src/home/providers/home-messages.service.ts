import { Inject, Injectable, Logger } from '@nestjs/common';

import { HOME_MESSAGE_REPOSITORY, type HomeMessageRepository } from '../domain/repositories/home-message.repository.js';
import type { MarkMessagesReadResponseDto, UnreadMessageCountDto } from '../dto/home-overview.dto.js';

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
 *   - 已读隐藏: read_at 不为空 → 不显示 (保留审计; 已读标记不是软删列)
 *
 * V2026-11-15 治本 (TD-20 · C2 第四批仓储端口化 · P-DEBT-11 / L-1):
 *   仓储依赖改为端口 (`HOME_MESSAGE_REPOSITORY`) —— 查询口径下沉 data/ 实现,
 *   service 只保留业务语义 (计数 → DTO / 标记 → 重算剩余 → DTO).
 */
@Injectable()
export class HomeMessagesService {
  private readonly logger = new Logger(HomeMessagesService.name);

  constructor(
    @Inject(HOME_MESSAGE_REPOSITORY)
    private readonly repo: HomeMessageRepository,
  ) {}

  /**
   * 读未读消息数.
   */
  async getUnreadCount(uid: string): Promise<UnreadMessageCountDto> {
    const count = await this.repo.countUnread(uid);
    return { count };
  }

  /**
   * 标记消息已读.
   *
   * V2.0: 全量 = 传 messageIds=null; 部分 = 传 messageIds=[...]
   * V3: 加 idempotency key 防双击 (e.g. requestUuid)
   *
   * 大厂做法:
   *   - update + 1 query 重算剩余 — 比 save + count 2 步省 1 次 DB roundtrip.
   */
  async markRead(uid: string, messageIds: string[] | undefined): Promise<MarkMessagesReadResponseDto> {
    const markedCount = await this.repo.markRead(uid, messageIds);

    // 重算剩余未读
    const remaining = await this.repo.countUnread(uid);

    this.logger.log(`markRead uid=${uid} marked=${markedCount} remaining=${remaining}`);
    return {
      count: remaining,
      markedCount,
    };
  }
}
