// V2026-10-21 治本 (V1.2 VS-C — M3.2 逐字稿打点 service):
//   原因: v1.2 spec §6.2 会谈录音与逐字稿打点标记 —— 咨询师在逐字稿上打点 (good / improve /
//     key_node), 「督导报告可锚定到 bookmark 位置, 前端点击跳转逐字稿对应时间戳」.
//   修法: TranscriptBookmarkService 2 method:
//     - create  打点 (归属校验)
//     - list    查该 session 的全部打点 (按时间线升序)
//   反双胞胎:
//     - 不落音频二进制: 延续 v1.0 §10.1 隐私承诺 (录音仅本地存储, 后端只落 transcript + bookmark)
//     - 不在打点上做权限分级: 打点只有咨询师本人会写也会看, 按 session 归属校验就够
//     - 不加"取消打点"接口: 咨询师改主意直接换 markType 覆盖? 不行 —— 打点有教学价值历史,
//       保留软删接口由 controller 走 DELETE (同 case_profile_entries 的处理)
//     - 不校验 turnIndex 是否真实存在: 打点可能落在"还没写入逐字稿"的位置 (用户手动跳到某处打点),
//       强校验会打断用户操作
//   验证:
//     1. tsc 0 错
//     2. 大炮 POST 一个打点 → GET 能查到, 按 turnIndex 升序
//   时间戳: 2026-10-21

import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';

import { type CreateTranscriptBookmarkDto, type TranscriptBookmarkDto } from '../dto/session-core.dto';
import { TrainingSession } from '../entities/training-session.entity';
import { TranscriptBookmark } from '../entities/transcript-bookmark.entity';

/**
 * 逐字稿打点 service.
 */
@Injectable()
export class TranscriptBookmarkService {
  constructor(
    @InjectRepository(TranscriptBookmark)
    private readonly bookmarkRepo: Repository<TranscriptBookmark>,
    @InjectRepository(TrainingSession)
    private readonly sessionRepo: Repository<TrainingSession>,
  ) {}

  /**
   * 新增 1 个打点.
   *
   * @param userId 当前用户 id
   * @param sessionId 会话 id
   * @param input 打点内容
   * @returns 新建的打点
   * @throws NotFoundException 会话不存在 / 不属于当前用户
   */
  async create(userId: string, sessionId: string, input: CreateTranscriptBookmarkDto): Promise<TranscriptBookmarkDto> {
    const session = await this.assertSessionOwned(userId, sessionId);
    const saved = await this.bookmarkRepo.save(
      this.bookmarkRepo.create({
        tenantId: session.tenantId,
        userId,
        sessionId,
        turnIndex: input.turnIndex,
        offsetMs: input.offsetMs,
        markType: input.markType,
        note: input.note ?? null,
      }),
    );
    return this.toDto(saved);
  }

  /**
   * 查该 session 的全部打点 (按时间线升序).
   *
   * @param userId 当前用户 id
   * @param sessionId 会话 id
   */
  async list(userId: string, sessionId: string): Promise<TranscriptBookmarkDto[]> {
    const rows = await this.bookmarkRepo.find({
      where: { sessionId, userId, deletedAt: IsNull() },
      order: { turnIndex: 'ASC', createdAt: 'ASC' },
    });
    return rows.map((r) => this.toDto(r));
  }

  /**
   * 软删 1 个打点.
   *
   * @param userId 当前用户 id
   * @param sessionId 会话 id (归属校验)
   * @param bookmarkId 打点 id
   * @throws NotFoundException 打点不存在 / 不属于当前用户 / 不属于该会话
   */
  async remove(userId: string, sessionId: string, bookmarkId: string): Promise<void> {
    const row = await this.bookmarkRepo.findOne({
      where: { id: bookmarkId, userId, deletedAt: IsNull() },
    });
    if (!row) {
      throw new NotFoundException(`打点 ${bookmarkId} 不存在或不属于当前用户`);
    }
    if (row.sessionId !== sessionId) {
      throw new NotFoundException(`打点 ${bookmarkId} 不属于会话 ${sessionId}`);
    }
    row.deletedAt = new Date();
    await this.bookmarkRepo.save(row);
  }

  /**
   * 校验会话归属 (跨用户访问检测).
   *
   * @param userId 当前用户 id
   * @param sessionId 会话 id
   * @throws NotFoundException 不存在 / 不属于当前用户
   */
  private async assertSessionOwned(userId: string, sessionId: string): Promise<TrainingSession> {
    const session = await this.sessionRepo.findOne({
      where: { id: sessionId, userId, deletedAt: IsNull() },
    });
    if (!session) {
      throw new NotFoundException(`训练会话 ${sessionId} 不存在或不属于当前用户`);
    }
    return session;
  }

  /**
   * entity → DTO.
   *
   * @param row transcript_bookmarks 表行
   */
  private toDto(row: TranscriptBookmark): TranscriptBookmarkDto {
    return {
      id: row.id,
      sessionId: row.sessionId,
      turnIndex: row.turnIndex,
      offsetMs: row.offsetMs,
      markType: row.markType,
      note: row.note,
      createdAt: row.createdAt,
    };
  }
}
