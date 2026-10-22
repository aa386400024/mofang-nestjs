// V2026-10-22 治本 (首页金句 · 每日一句 — REST 控制器, 1:1 wire spec §2):
//   原因: `xin_su_app/docs/product/home-quote-backend-api.md` §2 拍板 3 组端点契约,
//     前端 (xin_su_app) 已按本地种子写好 UI, 远端就绪后**只换数据源, UI 不动**.
//     本控制器是**契约的实现面**: 只做入参转交 + 出参声明, 业务逻辑全在 service.
//
//   修法: 端点按 spec §2 原文一一对应:
//     GET    /counselor/quotes/today                 §2.1 今日金句
//     GET    /counselor/quotes?cursor=&limit=         §2.2 金句流 (游标分页)
//     GET    /counselor/quotes/favorites              §2.3 补充: 我的收藏 (状态回填)
//     POST   /counselor/quotes/:id/favorite          §2.3 收藏
//     DELETE /counselor/quotes/:id/favorite          §2.3 取消收藏
//
//   反双胞胎:
//     - 不下发任何计数: 出参 DTO 无 likeCount / favoriteCount (spec §2.3 + §4 零压红线).
//       "谁收藏得最多"这类排行榜会把情绪陪伴位变成攀比位.
//     - 不在 controller 里写业务判断 (今日轮换 / 游标推进 / 收藏幂等): 放 controller
//       必然被别的端点复制粘贴而漂移
//     - 不新增 quote 前缀之外的路径: 跟既有 counselor/* 风格一致
//     - 不用 @Param 里的 UUID 管道: 金句 id 是稳定 slug (q_YYYYMMDD_<slug>), 不是 UUID
//
//   验证:
//     1. tsc 0 错
//     2. swagger 页面 /counselor/quotes* 可见 5 个端点, 字段与 spec §2 一致
//     3. 无 token 访问 → 401
//
//   时间戳: 2026-10-22
import { Controller, Delete, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../../user/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../user/guards/jwt-auth.guard';

import type { QuoteDto, QuoteFavoriteResultDto, QuoteListDto, QuoteQueryDto } from '../dto/quote.dto';
import { QuoteService } from '../providers/quote.service';

@ApiTags('counselor-quotes')
@Controller('counselor/quotes')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class CounselorQuoteController {
  constructor(private readonly quoteService: QuoteService) {}

  @Get('today')
  @ApiOperation({
    summary: '今日金句 (同一天内恒定, 跨天自动轮换; 零压 —— 无任何计数与排行)',
  })
  getToday(@CurrentUser() user: { userId: string }): Promise<QuoteDto> {
    return this.quoteService.getToday(user.userId);
  }

  @Get('favorites')
  @ApiOperation({
    summary: '我的收藏 (仅本人状态; 供客户端冷启动回填"已收藏"标记)',
  })
  listFavorites(@CurrentUser() user: { userId: string }): Promise<QuoteListDto> {
    return this.quoteService.listFavorites(user.userId);
  }

  @Get()
  @ApiOperation({
    summary: '金句流 (游标分页: 传上一页的 nextCursor 取更旧一批; 按发布日倒序, 新的在前)',
  })
  list(@CurrentUser() user: { userId: string }, @Query() query: QuoteQueryDto): Promise<QuoteListDto> {
    return this.quoteService.list(user.userId, query);
  }

  @Post(':id/favorite')
  @ApiOperation({ summary: '收藏 (幂等; 重复收藏不产生第二条记录; 不下发任何计数)' })
  favorite(@CurrentUser() user: { userId: string }, @Param('id') id: string): Promise<QuoteFavoriteResultDto> {
    return this.quoteService.favorite(user.userId, id);
  }

  @Delete(':id/favorite')
  @ApiOperation({ summary: '取消收藏 (幂等; 未收藏时调用也不报错)' })
  unfavorite(@CurrentUser() user: { userId: string }, @Param('id') id: string): Promise<QuoteFavoriteResultDto> {
    return this.quoteService.unfavorite(user.userId, id);
  }
}
