import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import type { AdminDebugRequest } from '../../admin-debug/admin-basic-auth.middleware.js';
import {
  CreateMembershipPromotionDto,
  ListMembershipPromotionQueryDto,
  MembershipPromotionDto,
  MembershipPromotionStatsDto,
  UpdateMembershipPromotionDto,
} from '../dto/membership-promotion.dto.js';
import { MembershipAdminGuard } from '../guards/membership-admin.guard.js';
import { MembershipPromotionService } from '../providers/membership-promotion.service.js';

/** 会员活动运营 API（后端只读/写接口；admin-dashboard 前端不在本任务范围）。 */
@ApiTags('admin-membership')
@ApiBearerAuth()
@Controller('admin/membership/promotions')
@UseGuards(MembershipAdminGuard)
export class MembershipAdminController {
  constructor(private readonly promotionService: MembershipPromotionService) {}

  @Get()
  list(
    @Query() query: ListMembershipPromotionQueryDto,
  ): Promise<{ items: MembershipPromotionDto[]; total: number; page: number; pageSize: number }> {
    return this.promotionService.list(query);
  }

  @Post()
  create(@Req() req: AdminDebugRequest, @Body() dto: CreateMembershipPromotionDto): Promise<MembershipPromotionDto> {
    return this.promotionService.create(req.user?.userId ?? null, dto);
  }

  @Get(':id')
  get(@Param('id') id: string): Promise<MembershipPromotionDto> {
    return this.promotionService.get(id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateMembershipPromotionDto): Promise<MembershipPromotionDto> {
    return this.promotionService.update(id, dto);
  }

  @Post(':id/activate')
  activate(@Param('id') id: string): Promise<MembershipPromotionDto> {
    return this.promotionService.activate(id);
  }

  @Post(':id/pause')
  pause(@Param('id') id: string): Promise<MembershipPromotionDto> {
    return this.promotionService.pause(id);
  }

  @Delete(':id')
  async remove(@Param('id') id: string): Promise<{ removed: true }> {
    await this.promotionService.remove(id);
    return { removed: true };
  }

  @Get(':id/stats')
  stats(@Param('id') id: string): Promise<MembershipPromotionStatsDto> {
    return this.promotionService.stats(id);
  }
}
