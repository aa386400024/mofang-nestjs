import { Controller, Get, NotFoundException, Param, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../../user/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../user/guards/jwt-auth.guard';

import { PracticeCategoryKey, PracticeToolDto } from '../dto/practice.dto';
import { PracticeToolService } from '../providers/practice.service';

/**
 * 工具元数据 controller — V2.0 §Tab2 工具列表 + 详情.
 *
 *   GET /practice/categories/:categoryId/tools    — 某分类下工具列表
 *   GET /practice/tools/:toolId                   — 单个工具详情
 *
 * 反双胞胎:
 *   - 不重复 practice-categories.controller 的 listCategories 端点
 *   - 工具详情走独立端点 (大厂 RESTful: /resources/:id)
 */
@ApiTags('practice-tools')
@Controller('practice')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class PracticeToolsController {
  constructor(private readonly service: PracticeToolService) {}

  @Get('categories/:categoryId/tools')
  @ApiOperation({ summary: '某分类下工具列表' })
  public async listByCategory(
    @CurrentUser() user: { userId: string },
    @Param('categoryId') categoryId: PracticeCategoryKey,
  ): Promise<PracticeToolDto[]> {
    return this.service.listToolsByCategory(user.userId, categoryId);
  }

  @Get('tools/:toolId')
  @ApiOperation({ summary: '工具详情' })
  public async getTool(@CurrentUser() user: { userId: string }, @Param('toolId') toolId: string): Promise<PracticeToolDto> {
    const tool = await this.service.getTool(user.userId, toolId);
    if (!tool) throw new NotFoundException(`tool ${toolId} 不存在`);
    return tool;
  }
}
