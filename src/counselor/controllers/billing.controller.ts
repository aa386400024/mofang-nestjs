// V2026-10-15 治本 (V4.5 — billing.controller.ts, 4 endpoint 1:1 wire):
//   原因: counselor-mode-v1.0 §7.1 + §7.4 + §7.5 + §7.6 拍板 5 档会员 + 4 SKU +
//     支付通道 mock + 配额, V0.3 §13 baseline 0 5 档 controller, 1:1 wire 0 破坏.
//     V0.5 已有 8 counselor controller (含 A + B + C), 本 V1.x W7-8 改造, billing
//     controller 真接 BillingService.
//
//   修法 (跟 W1-2 + W3-4 + W5-6 controller 风格一致):
//     - @UseGuards(JwtAuthGuard) + @CurrentUser() 注入 uid (V0.5 已有, 复用)
//     - 4 endpoint: GET membership / GET skus / POST orders / POST quota/consume
//     - @ApiBearerAuth() + @ApiTags('counselor-billing') 跟 V0.5 风格一致
//     - controller thin delegate to BillingService (跟 W1-2 + W3-4 + W5-6 风格一致,
//       不在 controller 写业务逻辑, 全部在 service, 大厂 Clean Arch)
//
//   4 endpoint (跟 counselor-mode-v1.0 §7 + handoff §7 W7-8 1:1):
//     - GET  /counselor/billing/membership    - 当前用户 5 档会员状态 + 3 类配额
//     - GET  /counselor/billing/skus          - 4 SKU 加购 list
//     - POST /counselor/billing/orders        - 创建订单 (V0.5 mock 支付 inline, V1.x 续做真接)
//     - POST /counselor/billing/quota/consume - 配额扣减 (内部, V1.x 续做抽 QuotaGuard 拦截器)
//
//   反双胞胎:
//     - 不在 controller 写业务逻辑: 全部 service, 跟 V0.5 8 controller 风格一致
//     - 不复用 W1-2/W3-4/W5-6 service: 业务正交 (商业化 vs 长程 vs 督导 vs 能力), 跟 V0.5
//       culture "1 module 9 service 独立" 一致
//     - 不引 GraphQL: V0.5 REST 风格, 跟 client Dio 风格一致
//     - 不暴露 paymentMethod 真实字段: V0.5 stage 只接 'mock', V1.x 续做接 wechat / alipay
//
//   验证:
//     1. tsc 0 错 (4 endpoint 字段 type 严格)
//     2. 大炮跑 pnpm migration:run + curl 验 4 endpoint 端到端
//     3. integration: 5 档会员状态 / 4 SKU / mock 下单 / 配额扣减 / text fallback
//
//   时间戳: 2026-10-15

import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../../user/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../user/guards/jwt-auth.guard';

import {
  type ConsumeQuotaDto,
  type CreateOrderDto,
  type MembershipStatusDto,
  type OrderDto,
  type SkuListItemDto,
} from '../dto/billing.dto';
import { BillingService } from '../providers/billing.service';

/**
 * V2026-10-15 (V1.x counselor-mode W7-8 — CounselorBillingController):
 *   5 档会员 + 配额扣减 + 4 SKU 加购 + text fallback REST controller.
 *
 *   跟 xin_su_app BillingBloc + BillingRepository 端到端 1:1 对应.
 *   V1.x 真接库, V0.5 内存 mock 阶段已过.
 */
@ApiTags('counselor-billing')
@Controller('counselor/billing')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class CounselorBillingController {
  constructor(private readonly service: BillingService) {}

  /**
   * GET /counselor/billing/membership
   *
   * 当前用户 5 档会员状态 (tier + expiresAt + quotaPeriod) + 3 类配额状态.
   */
  @Get('membership')
  @ApiOperation({ summary: '当前用户 5 档会员状态 + 3 类配额状态 (本月已用 / 上限 / 剩余)' })
  async getMembershipStatus(@CurrentUser() user: { userId: string }): Promise<MembershipStatusDto> {
    return this.service.getMembershipStatus(user.userId);
  }

  /**
   * GET /counselor/billing/skus
   *
   * 4 SKU 加购 list (跟 counselor-mode-v1.0 §7.4 表 1:1).
   */
  @Get('skus')
  @ApiOperation({ summary: '4 SKU 加购 list (语音加场 / 长程加购包 / 语音分析 / 1v1 解读)' })
  async listSkus(): Promise<SkuListItemDto[]> {
    return this.service.listSkus();
  }

  /**
   * POST /counselor/billing/orders
   *
   * 创建订单 (V0.5 stage mock 支付 inline, 返 orderId + paid 立即 success, 同步 +quotaAdded).
   * V1.x 续做: 抽 PaymentChannelService interface, 接 WechatPayChannel + AlipayChannel 真接.
   */
  @Post('orders')
  @ApiOperation({ summary: '创建订单 (V0.5 mock 支付 inline, V1.x 真接 WechatPay / Alipay)' })
  async createOrder(@CurrentUser() user: { userId: string }, @Body() input: CreateOrderDto): Promise<OrderDto> {
    return this.service.createOrder(input, user.userId);
  }

  /**
   * POST /counselor/billing/quota/consume
   *
   * 配额扣减 (内部, V1.x 续做抽 QuotaGuard 拦截器).
   * V0.5 stage: A + B + C 训练 / 督导 / 长程入口直接调 service.consumeQuota, V1.x
   * 续做时改 NestJS Interceptor 拦截.
   */
  @Post('quota/consume')
  @ApiOperation({ summary: '配额扣减 (内部, V1.x 续做抽 QuotaGuard 拦截器)' })
  async consumeQuota(
    @CurrentUser() user: { userId: string },
    @Body() input: ConsumeQuotaDto,
  ): Promise<{ success: boolean; remaining: number }> {
    return this.service.consumeQuota(user.userId, input);
  }
}
