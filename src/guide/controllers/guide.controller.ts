import { Body, Controller, Get, HttpCode, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../../user/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../user/guards/jwt-auth.guard';
import {
  type GuideCategoryDto,
  type GuideCategoryKey,
  type GuideCourseDetailDto,
  type GuideCourseListDto,
  type MyLearningOverviewDto,
  type RoleFilterKey,
  SaveCourseNoteDto,
  SaveCourseProgressDto,
  ToggleFavoriteDto,
} from '../dto/guide.dto';
import { GuideService } from '../providers/guide.service';

/**
 * 陪伴者端「指南」Tab Controller — V3.0 §4 Tab3.
 *
 * 端点清单 (V3.0):
 *   GET    /guide/categories                   - 3 大分类
 *   GET    /guide/courses?category=&role=&favorite=  - 课程列表 (带查询参数)
 *   GET    /guide/courses/:id                  - 课程详情 (含 lessons + notes)
 *   POST   /guide/progress                     - 保存学习进度
 *   POST   /guide/favorite                     - 切换收藏
 *   POST   /guide/notes                        - 保存笔记
 *   GET    /guide/my-learning                  - 我的学习总览
 */
@ApiTags('guide')
@Controller('guide')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class GuideController {
  constructor(private readonly service: GuideService) {}

  @Get('categories')
  @ApiOperation({ summary: '3 大分类' })
  listCategories(): GuideCategoryDto[] {
    return this.service.listCategories();
  }

  @Get('courses')
  @ApiOperation({ summary: '课程列表 (支持 category / role / favorite 过滤)' })
  listCourses(
    @CurrentUser() user: { userId: string },
    @Query('category') category?: string,
    @Query('role') role?: string,
    @Query('favorite') favorite?: string,
  ): GuideCourseListDto {
    return this.service.listCourses(user.userId, {
      categoryKey: (category as GuideCategoryKey | undefined) ?? undefined,
      roleFilter: (role as RoleFilterKey | undefined) ?? undefined,
      onlyFavorited: favorite === 'true',
    });
  }

  @Get('courses/:id')
  @ApiOperation({ summary: '课程详情 (含小节 + 笔记)' })
  getCourseDetail(@CurrentUser() user: { userId: string }, @Param('id') id: string): GuideCourseDetailDto {
    return this.service.getCourseDetail(user.userId, id);
  }

  @Post('progress')
  @HttpCode(200)
  @ApiOperation({ summary: '保存学习进度' })
  saveProgress(@CurrentUser() user: { userId: string }, @Body() dto: SaveCourseProgressDto): { courseId: string; progress: number } {
    return this.service.saveProgress(user.userId, dto);
  }

  @Post('favorite')
  @HttpCode(200)
  @ApiOperation({ summary: '切换收藏' })
  toggleFavorite(@CurrentUser() user: { userId: string }, @Body() dto: ToggleFavoriteDto): { courseId: string; favorited: boolean } {
    return this.service.toggleFavorite(user.userId, dto);
  }

  @Post('notes')
  @HttpCode(201)
  @ApiOperation({ summary: '保存笔记' })
  saveNote(
    @CurrentUser() user: { userId: string },
    @Body() body: { courseId: string } & SaveCourseNoteDto,
  ): { id: string; lessonId: string; content: string; createdAt: string } {
    const { courseId, ...dto } = body;
    return this.service.saveNote(user.userId, courseId, dto);
  }

  @Get('my-learning')
  @ApiOperation({ summary: '我的学习总览' })
  getMyLearning(@CurrentUser() user: { userId: string }): MyLearningOverviewDto {
    return this.service.getMyLearning(user.userId);
  }
}
