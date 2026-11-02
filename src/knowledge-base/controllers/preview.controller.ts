// V2026-10-12 (Phase 8.4 — Preview controller / SPEC §12.3):
//   POST /admin/knowledge-items/:id/preview — 1 endpoint, 跟客户端 7.4 PreviewDialog 协议对齐.
//
//   路由路径: '/admin/knowledge-items/:id/preview' (跟 client 7.4 PreviewDialog URL 一致).
//   鉴权: V0.x JwtAuthGuard 单层, 跟 8.1 knowledge controller 风格一致.

import { Body, Controller, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

// V2026-10-12 治本 (Phase 8.4 — import path, 跟 knowledge.controller 同 pattern).
import { JwtAuthGuard } from '../../auth';
import { TenantId } from '../../common';
import { CurrentUser } from '../../user/decorators/current-user.decorator';
import { PreviewRequestDto, PreviewResponseDto } from '../dto/preview.dto';
import { PreviewService } from '../providers/preview.service';

@ApiTags('Admin · Knowledge · Preview')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('admin/knowledge-items')
export class PreviewController {
  constructor(private readonly previewService: PreviewService) {}

  @Post(':id/preview')
  @ApiOperation({ summary: '实时预览 (LLM proxy, 跟客户端 7.4 PreviewDialog 协议对齐)' })
  preview(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @CurrentUser('sub') userId: string,
    @Body() dto: PreviewRequestDto,
  ): Promise<PreviewResponseDto> {
    return this.previewService.preview(tenantId, id, userId, dto);
  }
}
