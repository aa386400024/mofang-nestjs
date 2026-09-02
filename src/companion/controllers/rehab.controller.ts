import { Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../../user/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../user/guards/jwt-auth.guard';

import { RehabItemDto } from '../dto/companion.dto';
import { RehabService } from '../providers/companion.service';

/**
 * 康复协同 controller — V2.0 §Tab2 陪伴者端 (仅 L3 权限).
 *
 *   GET  /companion/rehab/items?activePersonId=
 *   POST /companion/rehab/items/:id/complete
 *
 * 设计:
 *   - L3 权限校验走前端 (rehab_bloc 根据 activePerson.permissionLevel 决定是否请求),
 *     后端 V2.0 占位不强制 (V3 接 PermissionGuard 校验 active_person_id L3)
 *   - 完成端点幂等, 已完成时静默 ok=true
 *
 * 反双胞胎:
 *   - 不走 /home-companion/rehab, 走独立 /companion/rehab 命名空间 (跟 profile 维度解耦)
 */
@ApiTags('companion-rehab')
@Controller('companion/rehab')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class RehabController {
  constructor(private readonly service: RehabService) {}

  @Get('items')
  @ApiOperation({ summary: '康复协同项列表 (L3 权限)' })
  public async listItems(
    @CurrentUser() user: { userId: string },
    @Query('activePersonId') activePersonId = 'person-1',
  ): Promise<RehabItemDto[]> {
    return this.service.listItems(user.userId, activePersonId);
  }

  @Post('items/:id/complete')
  @ApiOperation({ summary: '标记康复项已完成' })
  public async completeItem(@CurrentUser() user: { userId: string }, @Param('id') id: string): Promise<{ ok: true }> {
    return this.service.completeItem(user.userId, id);
  }
}
