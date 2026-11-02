// V2026-10-23 治本 (AI 模拟来访池 — 公共供给层 controller):
//   原因: spec `docs/specs/counselor-visitor-pool.md` §3.1-§3.4 要求 6 个公共端点,
//     前端契约 `xin_su_app/docs/product/visitor-pool-design.md` §5 的启动接线直接调它们:
//       图鉴列表 → 模板详情 → 实例化克隆 → 收藏开关.
//     现状 (2026-10-23 扫描) 全仓 grep 'visitor-pool' → 0 命中, 前端无从调用.
//
//   修法: 6 个 endpoint (薄委托, 业务全在 VisitorPoolService):
//     - GET    /counselor/visitor-pool                        图鉴列表 (筛选 + 游标分页)
//     - GET    /counselor/visitor-pool/favorites              我的收藏
//     - GET    /counselor/visitor-pool/:templateId            模板表层详情
//     - POST   /counselor/visitor-pool/:templateId/instantiate 克隆为我的私有副本
//     - POST   /counselor/visitor-pool/:templateId/favorite   收藏 (幂等)
//     - DELETE /counselor/visitor-pool/:templateId/favorite   取消收藏 (幂等)
//
//   反双胞胎:
//     - **路由顺序**: `favorites` 必须注册在 `:templateId` **之前** —— Express 按注册
//       顺序匹配, 反过来的话 GET /visitor-pool/favorites 会被 `:templateId` 吃掉
//       (templateId='favorites' → 404). 这是 Nest 路由最常见的坑之一.
//     - **不在 controller 里判上帝视角 / 角色**: 判定统一在 service 与 guard
//       (唯一真值源, 未来 WS/GraphQL 复用).
//     - **DTO 全部值导入**: 全局 ValidationPipe 开了 transform + whitelist, 靠
//       design:paramtypes 元数据拿 DTO 类; type-only 导入会让元数据退化成 Object →
//       校验静默失效 (与 counselor 既有 controller 同口径).
//     - **不新增"查看完整剧本"端点**: 剧本只走内部管理端点, 公共面永不下发.
//
//   验证:
//     1. tsc 0 错
//     2. 大炮跑 swagger 确认 6 个 endpoint + DTO 字段
//     3. 端到端: 列表 → 详情 → 实例化 → 收藏 → 我的收藏
//
//   时间戳: 2026-10-23
import { Body, Controller, Delete, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../../user/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../user/guards/jwt-auth.guard';

import {
  InstantiateVisitorPoolDto,
  VisitorPoolCardDto,
  VisitorPoolFavoriteResultDto,
  VisitorPoolInstantiateResultDto,
  VisitorPoolListDto,
  VisitorPoolQueryDto,
} from '../dto/visitor-pool.dto';
import { VisitorPoolService } from '../providers/visitor-pool.service';

/**
 * V2026-10-23 (AI 模拟来访池 — CounselorVisitorPoolController):
 *   公共人物图鉴 + 克隆实例化 + 收藏 (普通练习用户可用).
 */
@ApiTags('counselor-visitor-pool')
@Controller('counselor/visitor-pool')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class CounselorVisitorPoolController {
  constructor(private readonly service: VisitorPoolService) {}

  /**
   * GET /counselor/visitor-pool — 公共人物图鉴.
   */
  @Get()
  @ApiOperation({ summary: '公共来访人物图鉴 (按议题/难度/防御类型/训练目标/来源筛选, 游标分页)' })
  async list(@CurrentUser() user: { userId: string }, @Query() query: VisitorPoolQueryDto): Promise<VisitorPoolListDto> {
    return this.service.list(user.userId, query);
  }

  /**
   * GET /counselor/visitor-pool/favorites — 我的收藏.
   *
   * **必须注册在 `:templateId` 之前** (Express 按注册顺序匹配, 见文件头反双胞胎).
   */
  @Get('favorites')
  @ApiOperation({ summary: '我收藏的来访人物 (表层卡片, 仅本人可见)' })
  async listFavorites(@CurrentUser() user: { userId: string }): Promise<VisitorPoolListDto> {
    return this.service.listFavorites(user.userId);
  }

  /**
   * GET /counselor/visitor-pool/:templateId — 模板表层详情.
   */
  @Get(':templateId')
  @ApiOperation({ summary: '来访人物的表层详情 (**不含**底层剧本)' })
  async getCard(@CurrentUser() user: { userId: string }, @Param('templateId') templateId: string): Promise<VisitorPoolCardDto> {
    return this.service.getCard(user.userId, templateId);
  }

  /**
   * POST /counselor/visitor-pool/:templateId/instantiate — 克隆为我的私有副本.
   */
  @Post(':templateId/instantiate')
  @ApiOperation({ summary: '把公共人物克隆为我的私有副本 (可覆盖临场参数; 重复调用生成新副本)' })
  async instantiate(
    @CurrentUser() user: { userId: string },
    @Param('templateId') templateId: string,
    @Body() input: InstantiateVisitorPoolDto,
  ): Promise<VisitorPoolInstantiateResultDto> {
    return this.service.instantiate(user.userId, templateId, input);
  }

  /**
   * POST /counselor/visitor-pool/:templateId/favorite — 收藏.
   */
  @Post(':templateId/favorite')
  @ApiOperation({ summary: '收藏来访人物 (幂等; 不返回任何全站计数)' })
  async favorite(@CurrentUser() user: { userId: string }, @Param('templateId') templateId: string): Promise<VisitorPoolFavoriteResultDto> {
    return this.service.favorite(user.userId, templateId);
  }

  /**
   * DELETE /counselor/visitor-pool/:templateId/favorite — 取消收藏.
   */
  @Delete(':templateId/favorite')
  @ApiOperation({ summary: '取消收藏来访人物 (幂等; 未收藏也返回 200)' })
  async unfavorite(
    @CurrentUser() user: { userId: string },
    @Param('templateId') templateId: string,
  ): Promise<VisitorPoolFavoriteResultDto> {
    return this.service.unfavorite(user.userId, templateId);
  }
}
