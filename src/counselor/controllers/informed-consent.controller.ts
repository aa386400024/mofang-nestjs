// V2026-10-21 治本 (V1.2 VS-C — M2 知情同意 controller):
//   原因: v1.2 spec §5.4 拍板 2 个 API:
//     - PATCH /counselor/training-sessions/:id/consent/mark  判定 4 要素覆盖
//     - GET  /counselor/training-sessions/:id/consent        查当前进度
//   修法: 2 个 endpoint (薄委托, 业务全在 InformedConsentService):
//     - GET   /counselor/training-sessions/:sessionId/consent
//     - PATCH /counselor/training-sessions/:sessionId/consent/mark
//   反双胞胎:
//     - 不写在 training-session.controller 里: 知情同意是**独立的训练环节** (有独立的
//       业务语义 + 独立的 LLM 判定), 混进会话 controller 会让那个文件变成什么都管
//     - 路由用 :sessionId 而不是 :id: 同级路由 (bookmarks / marks / hints) 都用 sessionId,
//       命名统一, 前端不用记哪个端点用 id 哪个用 sessionId
//     - DTO **值导入**: 全局 ValidationPipe 靠 design:paramtypes 元数据拿 DTO 类,
//       type-only 导入会让元数据退化成 Object → 校验静默失效
//   验证:
//     1. tsc 0 错
//     2. 大炮跑 swagger 确认 2 个 endpoint
//   时间戳: 2026-10-21

import { Body, Controller, Get, Param, Patch, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../../user/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../user/guards/jwt-auth.guard';

import { InformedConsentMarkDto, InformedConsentMarkResultDto, InformedConsentStatusDto } from '../dto/session-core.dto';
import { InformedConsentService } from '../providers/informed-consent.service';

/**
 * V2026-10-21 (V1.2 VS-C — CounselorInformedConsentController):
 *   M2 知情同意 — 4 要素判定 + 进度查询.
 */
@ApiTags('counselor-informed-consent')
@Controller('counselor/training-sessions/:sessionId/consent')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class CounselorInformedConsentController {
  constructor(private readonly service: InformedConsentService) {}

  /**
   * GET /counselor/training-sessions/:sessionId/consent — 查 4 要素进度.
   */
  @Get()
  @ApiOperation({ summary: '知情同意 4 要素当前进度 (哪几项已讲 / 来访反应)' })
  async getStatus(@CurrentUser() user: { userId: string }, @Param('sessionId') sessionId: string): Promise<InformedConsentStatusDto> {
    return this.service.getStatus(user.userId, sessionId);
  }

  /**
   * PATCH /counselor/training-sessions/:sessionId/consent/mark — 判定 4 要素覆盖.
   */
  @Patch('mark')
  @ApiOperation({ summary: '用 LLM 判定知情同意 4 要素覆盖情况 (写入 informed_consent_transcript)' })
  async mark(
    @CurrentUser() user: { userId: string },
    @Param('sessionId') sessionId: string,
    @Body() input: InformedConsentMarkDto,
  ): Promise<InformedConsentMarkResultDto> {
    return this.service.judge(user.userId, sessionId, input);
  }
}
