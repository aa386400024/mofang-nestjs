// V2026-10-13 治本 (V0.2 — billing/controllers/billing.controller.ts, Phase 8 商业化):
//   心塑 + 咨询师 商业化 controller (4 档会员 + 4 SKU 单次 + 订单 CRUD).
//
//   端点 (V0.5 简化):
//     GET    /billing/membership  - 我的商业化总览 (会员 + 订单 + 4 SKU + paymentReserved)
//     GET    /billing/products    - 4 个单次 SKU (V0.5 写死, 跟 membership 重复)
//     POST   /billing/orders      - 创建订单 (V0.5 走 reserved, 返 pending)
//     GET    /billing/orders      - 历史订单 (V0.5 返空数组)
//
//   反双胞胎 (跟 counselor-home / life_map controller 风格一致):
//     - @UseGuards(JwtAuthGuard) + @CurrentUser() 注入 uid
//     - 1 endpoint 聚合 (membership 包含 4 SKU, 减少瀑布流)
//     - 不复用 home-overview.controller (业务正交, 商业化独立)

import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../../user/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../user/guards/jwt-auth.guard';

import { type CreateOrderDto, type MembershipOverviewDto, type OrderDto, type ProductDto } from '../dto/billing.dto';
import { BillingService } from '../providers/billing.service';

/**
 * V2026-10-13 (V0.2 — BillingController):
 *   商业化 controller (跟 counselor 同 pattern: @UseGuards(JwtAuthGuard) + @CurrentUser).
 */
@ApiTags('billing')
@Controller('billing')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class BillingController {
  constructor(private readonly service: BillingService) {}

  /**
   * GET /billing/membership
   *
   * 返 MembershipOverviewDto: 会员 + 最近订单 + 4 SKU + paymentReserved 标记.
   */
  @Get('membership')
  @ApiOperation({ summary: '我的商业化总览 (会员 + 订单 + 4 SKU + paymentReserved 标记)' })
  async getMembershipOverview(@CurrentUser() user: { userId: string }): Promise<MembershipOverviewDto> {
    return this.service.getMembershipOverview(user.userId);
  }

  /**
   * GET /billing/products
   *
   * 返 4 个单次 SKU 列表 (跟 membership.availableProducts 重复, 单独 endpoint 方便客户端缓存).
   */
  @Get('products')
  @ApiOperation({ summary: '4 个单次 SKU 列表 (5/19.9/39.9/9.9 元)' })
  async listProducts(): Promise<ProductDto[]> {
    return this.service.listAvailableProducts();
  }

  /**
   * POST /billing/orders
   *
   * 创建订单 (V0.5 走 reserved 通道, status 写死 pending, V1.x 真接微信/支付宝).
   */
  @Post('orders')
  @ApiOperation({ summary: '创建订单 (V0.5 走 reserved, V1.x 真接 wechat/alipay)' })
  async createOrder(@CurrentUser() user: { userId: string }, @Body() dto: CreateOrderDto): Promise<OrderDto> {
    return this.service.createOrder(user.userId, dto);
  }

  /**
   * GET /billing/orders
   *
   * 历史订单 (V0.5 返空数组, V1.x 真接 billing.orders 表).
   */
  @Get('orders')
  @ApiOperation({ summary: '历史订单 (V0.5 返空数组, V1.x 真接 billing.orders 表)' })
  async listOrders(@CurrentUser() user: { userId: string }): Promise<OrderDto[]> {
    return this.service.listOrders(user.userId);
  }
}
