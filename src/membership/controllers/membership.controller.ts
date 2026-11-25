import { Body, Controller, Get, HttpCode, HttpStatus, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { RequirePrivacyLevel } from '../../common/decorators/privacy-level.decorator.js';
import { BizCode } from '../../common/exceptions/biz-code.enum.js';
import { BizException } from '../../common/exceptions/biz.exception.js';
import { PrivacyGuard } from '../../common/guards/privacy.guard.js';
import { PrivacyLevel } from '../../common/privacy/privacy-level.enum.js';
import { CurrentUser } from '../../user/decorators/current-user.decorator.js';
import { JwtAuthGuard } from '../../user/guards/jwt-auth.guard.js';

import { BillingPeriod, PaymentChannel } from '../domain/membership.enums.js';
import {
  CreateMembershipOrderDto,
  MembershipOverviewDto,
  MembershipPlansResponseDto,
  PriceQuoteDto,
  QuotaReleaseDto,
  QuotaReservationDto,
  QuotaReserveDto,
  QuotaSettleDto,
  QuotaSettleResultDto,
  QuoteQueryDto,
} from '../dto/membership.dto.js';
import { MEMBERSHIP_ADDONS, MEMBERSHIP_PLANS } from '../membership.constants.js';
import { MembershipAccountService } from '../providers/membership-account.service.js';
import { MembershipOrderService, SUPPORTED_PAYMENT_CHANNELS } from '../providers/membership-order.service.js';
import {
  QuotaDailyLimitError,
  QuotaInsufficientError,
  QuotaLimitError,
  QuotaReservationNotFoundError,
  QuotaSessionLimitError,
  QuotaLedgerService,
} from '../providers/quota-ledger.service.js';

/**
 * 会员 v2 控制器 — 统一契约入口。
 *
 * 旧 /profile/membership、/billing/* 保留兼容；新客户端走本控制器。
 * 所有端点 L2 内部数据，必须 JWT；真实支付通道未接时订单只落 pending，不伪造 paid。
 */
@ApiTags('Membership')
@Controller('membership')
@UseGuards(JwtAuthGuard, PrivacyGuard)
@RequirePrivacyLevel(PrivacyLevel.L2_INTERNAL)
@ApiBearerAuth()
export class MembershipController {
  constructor(
    private readonly accountService: MembershipAccountService,
    private readonly orderService: MembershipOrderService,
    private readonly quotaLedger: QuotaLedgerService,
  ) {}

  @Get('me')
  @ApiOperation({ summary: '当前会员总览（账号 + 配额 + 权益 + 可售档位）' })
  async getMe(@CurrentUser() user: { userId: string }): Promise<MembershipOverviewDto> {
    return this.accountService.getOverview(user.userId);
  }

  @Get('plans')
  @ApiOperation({ summary: '可售档位与分钟加包' })
  getPlans(): MembershipPlansResponseDto {
    return {
      plans: Object.values(MEMBERSHIP_PLANS),
      addons: MEMBERSHIP_ADDONS,
      paymentReserved: true,
    };
  }

  @Get('quote')
  @ApiOperation({ summary: '价格预览（原价 → 活动价 → 优惠券 → 底价）' })
  async getQuote(@CurrentUser() user: { userId: string }, @Query() query: QuoteQueryDto): Promise<PriceQuoteDto> {
    return this.orderService.quote(
      user.userId,
      query.productId,
      query.billingPeriod ?? BillingPeriod.Monthly,
      query.couponDiscountCents ?? 0,
      query.promotionCode,
    );
  }

  @Post('orders')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: '创建会员/加包订单（幂等；支付通道未接时 pending）' })
  async createOrder(@CurrentUser() user: { userId: string }, @Body() body: CreateMembershipOrderDto) {
    const channel = body.paymentChannel ?? PaymentChannel.Reserved;
    if (!SUPPORTED_PAYMENT_CHANNELS.includes(channel)) {
      throw new BizException(BizCode.MembershipPaymentUnavailable);
    }
    return this.orderService.createOrder(user.userId, {
      productId: body.productId,
      billingPeriod: body.billingPeriod ?? BillingPeriod.Monthly,
      paymentChannel: channel,
      promotionCode: body.promotionCode,
      couponDiscountCents: body.couponDiscountCents,
      idempotencyKey: body.idempotencyKey,
    });
  }

  @Get('orders')
  @ApiOperation({ summary: '当前账号会员订单' })
  async listOrders(@CurrentUser() user: { userId: string }) {
    return { orders: await this.orderService.listOrders(user.userId) };
  }

  @Post('quota/reserve')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '开场上限预扣分钟（默认 10，单场最多 50，每日 180）' })
  async reserve(@CurrentUser() user: { userId: string }, @Body() body: QuotaReserveDto): Promise<QuotaReservationDto> {
    try {
      return await this.quotaLedger.reserve(user.userId, body.sessionId, body.requestedMinutes ?? 10);
    } catch (error) {
      throw this.toBizException(error);
    }
  }

  @Post('quota/settle')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '结束结算：实际用量可少于/多于预扣，余额永不为负' })
  async settle(@CurrentUser() user: { userId: string }, @Body() body: QuotaSettleDto): Promise<QuotaSettleResultDto> {
    try {
      return await this.quotaLedger.settle(user.userId, body.reservationId, body.actualMinutes);
    } catch (error) {
      throw this.toBizException(error);
    }
  }

  @Post('quota/release')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '取消/启动失败释放预扣' })
  async release(@CurrentUser() user: { userId: string }, @Body() body: QuotaReleaseDto): Promise<QuotaSettleResultDto> {
    try {
      return await this.quotaLedger.release(user.userId, body.reservationId);
    } catch (error) {
      throw this.toBizException(error);
    }
  }

  private toBizException(error: unknown): BizException {
    if (error instanceof QuotaInsufficientError) {
      return new BizException(BizCode.MembershipQuotaInsufficient, error.message);
    }
    if (error instanceof QuotaDailyLimitError) {
      return new BizException(BizCode.MembershipQuotaDailyLimit, error.message);
    }
    if (error instanceof QuotaReservationNotFoundError) {
      return new BizException(BizCode.MembershipOrderNotFound, error.message);
    }
    if (error instanceof QuotaSessionLimitError) {
      return new BizException(BizCode.MembershipPlanInvalid, error.message);
    }
    if (error instanceof QuotaLimitError) {
      return new BizException(BizCode.MembershipOrderStateInvalid, error.message);
    }
    if (error instanceof Error) {
      return new BizException(BizCode.UnknownError, error.message);
    }
    return new BizException(BizCode.UnknownError);
  }
}
