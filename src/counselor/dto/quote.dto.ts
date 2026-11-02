// V2026-10-22 治本 (首页金句 · 每日一句 — API 契约 DTO, 1:1 wire spec §2):
//   原因: `xin_su_app/docs/product/home-quote-backend-api.md` §2 拍板了 3 组端点契约,
//     前端 (xin_su_app) 已按 `quote_seed.dart` / `quote_gallery_page.dart` 写好本地兜底,
//     远端就绪后**只换数据源, UI 不动**. 故本文件是前后端唯一契约面, 字段改名会
//     同时打断客户端与本端.
//
//   修法: 一份 DTO 文件覆盖 3 组端点的入参与出参, 全部标 swagger 注解,
//     便于在 Control UI / swagger 页直接核对契约.
//
//   反双胞胎:
//     - **不下发任何计数**: 出参 DTO 里根本没有 likeCount / favoriteCount / viewCount
//       (spec §2.3 + §4 零压红线「不下发、不展示全站 likeCount」).
//       这一条是**结构级**保证: 契约里没有这个字段, 客户端就不可能渲染出"42 人收藏".
//       有计数就会有排行榜, 排行榜会把情绪陪伴位变成攀比位.
//     - 只下发"本人是否收藏": `favorited` 是**本人状态**, 不是社交数据 ——
//       客户端用它渲染心形实心态, 不含任何他人信息, 零压红线不适用.
//     - 不下发 rubric 之类的内部字段: 金句没有内部结构, 全部字段都是展示字段
//
//   验证:
//     1. tsc 0 错
//     2. swagger 页面 /counselor/quotes* 可见 4 个端点, 字段与 spec §2 逐字段对齐
//     3. 全仓 grep 'likeCount\|favoriteCount\|viewCount' 于本文件 → 0 命中 (零压红线结构级校验)
//
//   时间戳: 2026-10-22
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

import { QUOTE_LIST_DEFAULT_LIMIT, QUOTE_LIST_MAX_LIMIT } from '../config/quote-seeds';

// ════════════════════════════════════════════════════════════════════════════
// GET /counselor/quotes/today
// GET /counselor/quotes
// ════════════════════════════════════════════════════════════════════════════

export class QuoteDto {
  @ApiProperty({ description: '金句唯一 id (同时是游标分页的 cursor 值)', example: 'q_20261022_xinshu_slow_down' })
  id!: string;

  @ApiProperty({ description: '引文正文 (前端不加粗不评分)', example: '慢慢来，先站稳自己，再理解他人。' })
  text!: string;

  @ApiProperty({ description: '署名 (真实作者, 或 "心塑" 表示产品原创; 不伪造名言归属)', example: '心塑' })
  author!: string;

  @ApiProperty({ description: '领域标签', example: '自我接纳' })
  category!: string;

  @ApiProperty({
    description: '满版背景图 CDN 地址 (竖版, 上中部留暗部便于压白字)',
    example: 'https://cdn.xinsu.app/quote/quote_starry_mountain.jpg',
  })
  backgroundUrl!: string;

  @ApiProperty({ description: '发布日期 (ISO 8601)', example: '2026-10-22T00:00:00.000Z' })
  publishedAt!: string;

  @ApiPropertyOptional({
    description: '出处 (作品名); 产品原创为 null. 供"署名真实可考"的合规核对',
    required: false,
    nullable: true,
    example: '活出生命的意义',
  })
  sourceWork!: string | null;

  @ApiProperty({
    description: '本人是否已收藏 (**仅本人状态**, 不含任何他人信息与全站计数)',
    example: false,
  })
  favorited!: boolean;
}

export class QuoteListDto {
  @ApiProperty({ description: '金句列表 (按发布日期倒序, 新的在前)', type: [QuoteDto] })
  items!: QuoteDto[];

  @ApiProperty({
    description: '下一页游标 (传回 GET /counselor/quotes 的 cursor 参数); 已是末页时为 null',
    nullable: true,
    example: 'q_20261018_may_love_and_be_loved',
  })
  nextCursor!: string | null;
}

export class QuoteQueryDto {
  @ApiPropertyOptional({
    description: '游标 (上一页返回的 nextCursor); 传它则取"该条之后"的更旧一批',
    required: false,
    example: 'q_20261018_may_love_and_be_loved',
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  cursor?: string;

  @ApiPropertyOptional({
    description: `单批条数 (默认 ${QUOTE_LIST_DEFAULT_LIMIT}, 上限 ${QUOTE_LIST_MAX_LIMIT})`,
    required: false,
    example: 10,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(QUOTE_LIST_MAX_LIMIT)
  limit?: number;
}

// ════════════════════════════════════════════════════════════════════════════
// POST/DELETE /counselor/quotes/:id/favorite
// ════════════════════════════════════════════════════════════════════════════

export class QuoteFavoriteResultDto {
  @ApiProperty({ description: '金句 id', example: 'q_20261022_xinshu_slow_down' })
  quoteId!: string;

  @ApiProperty({ description: '操作后本人的收藏状态', example: true })
  favorited!: boolean;
}
