import { Body, Controller, Delete, Get, Param, Put, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../../user/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../user/guards/jwt-auth.guard';

import { AdjustRelationPermissionDto, RelationEntryDto } from '../dto/companion.dto';
import { RelationsService } from '../providers/companion.service';

/**
 * 关系管理 controller — V2.0 §Tab2 关系管理分区.
 *
 *   GET    /companion/relations
 *   PUT    /companion/relations/:id/permission
 *   DELETE /companion/relations/:id
 *
 * 反双胞胎 (关键):
 *   - 复用 profile/CompanionBinding 表, 不重复建 binding 表
 *   - 端点路径挂在 /companion/* 命名空间, 跟前缀 /profile/* 的 ProfileBindingController 解耦
 *
 * 设计:
 *   - 调整权限 L1 <-> L2 <-> L3 走 PUT (大厂 RESTful: 幂等更新)
 *   - 解除绑定走 DELETE, 软删 (status=terminated), 保留审计
 *   - V2.0 不做"双向确认", V3 接 Notification + 双向确认
 */
@ApiTags('companion-relations')
@Controller('companion/relations')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class RelationsController {
  constructor(private readonly service: RelationsService) {}

  @Get()
  @ApiOperation({ summary: '关系列表 (绑定中)' })
  public async listRelations(@CurrentUser() user: { userId: string }): Promise<RelationEntryDto[]> {
    return this.service.listRelations(user.userId);
  }

  @Put(':id/permission')
  @ApiOperation({ summary: '调整关系权限等级' })
  public async adjustPermission(
    @CurrentUser() user: { userId: string },
    @Param('id') id: string,
    @Body() dto: AdjustRelationPermissionDto,
  ): Promise<{ ok: true }> {
    return this.service.adjustPermission(user.userId, id, dto.level);
  }

  @Delete(':id')
  @ApiOperation({ summary: '解除绑定 (软删, 保留审计)' })
  public async unbind(@CurrentUser() user: { userId: string }, @Param('id') id: string): Promise<{ ok: true }> {
    return this.service.unbind(user.userId, id);
  }
}
