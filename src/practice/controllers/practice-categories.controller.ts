import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../../user/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../user/guards/jwt-auth.guard';

import { PracticeCategoryDto } from '../dto/practice.dto';
import { PracticeCategoryService } from '../providers/practice.service';

/**
 * 8 大分类 controller — V2.0 §Tab2 顶部横向分类.
 *
 *   GET /practice/categories          — 8 大分类(含渐进解锁状态)
 *
 * 大厂做法:
 *   - JwtAuthGuard + @CurrentUser 注入 uid
 *   - 后续 V3 接解锁引擎时, 不动 API 路径, 改 Service 即可
 */
@ApiTags('practice-categories')
@Controller('practice/categories')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class PracticeCategoriesController {
  constructor(private readonly service: PracticeCategoryService) {}

  @Get()
  @ApiOperation({ summary: '8 大分类(含渐进解锁状态)' })
  public async listCategories(@CurrentUser() user: { userId: string }): Promise<PracticeCategoryDto[]> {
    return this.service.listCategories(user.userId);
  }
}
