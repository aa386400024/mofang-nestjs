// V2026-10-21 治本 (V1.2 VS-C — M3.2 逐字稿打点 controller):
//   原因: v1.2 spec §6.2 逐字稿打点标记 —— 咨询师在逐字稿上打点, 督导报告可锚定到 bookmark 位置.
//   修法: 3 个 endpoint (薄委托, 业务全在 TranscriptBookmarkService):
//     - POST   /counselor/training-sessions/:sessionId/bookmarks        打点
//     - GET    /counselor/training-sessions/:sessionId/bookmarks        查全部打点
//     - DELETE /counselor/training-sessions/:sessionId/bookmarks/:id    软删打点
//   反双胞胎:
//     - 不合并进 training-session.controller: 打点是独立资源 (有独立的表 + service + 前端交互),
//       混进去会让那个 controller 变成"什么都管"
//     - 不用 PUT 改打点: 打点有教学价值历史, 改标型 = 删了重建 (走 DELETE + POST),
//       保留历史才能看出"当时我怎么标错的"
//     - DTO **值导入**: ValidationPipe 靠 design:paramtypes 元数据拿 DTO 类
//   验证:
//     1. tsc 0 错
//     2. 大炮 POST 一个打点 → GET 能查到 (按 turnIndex 升序)
//   时间戳: 2026-10-21

import { Body, Controller, Delete, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../../user/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../user/guards/jwt-auth.guard';

import { CreateTranscriptBookmarkDto, TranscriptBookmarkDto } from '../dto/session-core.dto';
import { TranscriptBookmarkService } from '../providers/transcript-bookmark.service';

/**
 * V2026-10-21 (V1.2 VS-C — CounselorTranscriptBookmarkController):
 *   M3.2 逐字稿打点标记.
 */
@ApiTags('counselor-transcript-bookmarks')
@Controller('counselor/training-sessions/:sessionId/bookmarks')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class CounselorTranscriptBookmarkController {
  constructor(private readonly service: TranscriptBookmarkService) {}

  /**
   * POST /counselor/training-sessions/:sessionId/bookmarks — 打点.
   */
  @Post()
  @ApiOperation({ summary: '新增逐字稿打点 (good / improve / key_node)' })
  async create(
    @CurrentUser() user: { userId: string },
    @Param('sessionId') sessionId: string,
    @Body() input: CreateTranscriptBookmarkDto,
  ): Promise<TranscriptBookmarkDto> {
    return this.service.create(user.userId, sessionId, input);
  }

  /**
   * GET /counselor/training-sessions/:sessionId/bookmarks — 查全部打点.
   */
  @Get()
  @ApiOperation({ summary: '该会话的全部逐字稿打点 (按轮次升序)' })
  async list(@CurrentUser() user: { userId: string }, @Param('sessionId') sessionId: string): Promise<TranscriptBookmarkDto[]> {
    return this.service.list(user.userId, sessionId);
  }

  /**
   * DELETE /counselor/training-sessions/:sessionId/bookmarks/:bookmarkId — 软删打点.
   */
  @Delete(':bookmarkId')
  @ApiOperation({ summary: '软删 1 个打点 (纠正误标)' })
  async remove(
    @CurrentUser() user: { userId: string },
    @Param('sessionId') sessionId: string,
    @Param('bookmarkId') bookmarkId: string,
  ): Promise<{ success: boolean }> {
    await this.service.remove(user.userId, sessionId, bookmarkId);
    return { success: true };
  }
}
