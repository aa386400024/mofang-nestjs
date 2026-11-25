import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, Max, Min, MinLength } from 'class-validator';

import {
  BillingPeriod,
  MembershipFeature,
  MembershipOrderStatus,
  MembershipOrderType,
  MembershipSource,
  MembershipStatus,
  MembershipTier,
  PaymentChannel,
  QuotaLotSource,
  TtsModel,
} from '../domain/membership.enums.js';

export class MembershipQuotaDto {
  @ApiProperty({ description: '当期套餐剩余分钟' })
  planMinutes!: number;

  @ApiProperty({ description: '活动赠送剩余分钟' })
  promotionMinutes!: number;

  @ApiProperty({ description: '加包剩余分钟' })
  addonMinutes!: number;

  @ApiProperty({ description: '迁移存量剩余分钟' })
  migrationMinutes!: number;

  @ApiProperty({ description: '总剩余分钟' })
  totalRemainingMinutes!: number;

  @ApiProperty({ description: '当期套餐包含分钟' })
  includedMinutesThisPeriod!: number;

  @ApiProperty({ description: '当期已用分钟' })
  usedMinutesThisPeriod!: number;

  @ApiProperty({ description: '今日已用/预扣分钟' })
  dailyUsedMinutes!: number;

  @ApiProperty({ description: '每日上限分钟' })
  dailyLimitMinutes!: number;

  @ApiProperty({ description: '单场预扣分钟' })
  preDeductMinutes!: number;

  @ApiProperty({ description: '单场上限分钟' })
  singleSessionLimitMinutes!: number;
}

export class MembershipEntitlementDto {
  @ApiProperty({ enum: MembershipFeature })
  feature!: MembershipFeature;

  @ApiProperty()
  title!: string;

  @ApiProperty()
  description!: string;

  @ApiProperty()
  unlocked!: boolean;

  @ApiProperty({ enum: MembershipTier })
  minTier!: MembershipTier;
}

export class MembershipPlanDto {
  @ApiProperty({ enum: MembershipTier })
  id!: MembershipTier;

  @ApiProperty()
  name!: string;

  @ApiProperty()
  description!: string;

  @ApiProperty()
  isPaid!: boolean;

  @ApiProperty({ description: '原价（分/月）' })
  listPriceCents!: number;

  @ApiProperty({ description: '首购活动价（分/月）', nullable: true })
  promoPriceCents!: number | null;

  @ApiProperty({ description: '续费价（分/月）' })
  renewalPriceCents!: number;

  @ApiProperty({ description: '标准年付价（分/年）' })
  annualPriceCents!: number;

  @ApiProperty({ description: '首年活动年付价（分/年）', nullable: true })
  annualPromoPriceCents!: number | null;

  @ApiProperty({ description: '活动底价（分/月）' })
  floorPriceCents!: number;

  @ApiProperty({ description: '首年活动年付底价（分/年）' })
  annualFloorPriceCents!: number;

  @ApiProperty({ description: '每月包含分钟' })
  monthlyMinutes!: number;

  @ApiProperty({ description: '新用户一次性赠送分钟' })
  newUserBonusMinutes!: number;

  @ApiProperty({ enum: TtsModel })
  ttsModel!: TtsModel;

  @ApiProperty()
  concurrentSessions!: number;

  @ApiProperty()
  textDailyLimit!: number;

  @ApiProperty({ enum: MembershipFeature, isArray: true })
  features!: readonly MembershipFeature[];
}

export class MembershipAddonDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty()
  description!: string;

  @ApiProperty({ description: '价格（分）' })
  priceCents!: number;

  @ApiProperty()
  minutes!: number;

  @ApiProperty()
  validMonths!: number;
}

export class MembershipOrderDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  planId!: string;

  @ApiProperty()
  productName!: string;

  @ApiProperty({ enum: MembershipOrderType })
  orderType!: MembershipOrderType;

  @ApiProperty({ enum: BillingPeriod })
  billingPeriod!: BillingPeriod;

  @ApiProperty({ description: '原价快照（分）' })
  listAmountCents!: number;

  @ApiProperty({ description: '优惠金额（分）' })
  discountCents!: number;

  @ApiProperty({ description: '实付金额（分）' })
  amountCents!: number;

  @ApiProperty({ description: '赠送分钟' })
  giftMinutes!: number;

  @ApiProperty({ enum: MembershipOrderStatus })
  status!: MembershipOrderStatus;

  @ApiProperty({ enum: PaymentChannel })
  paymentChannel!: PaymentChannel;

  @ApiProperty({ type: Date })
  createdAt!: Date;

  @ApiProperty({ type: Date, nullable: true })
  paidAt!: Date | null;

  @ApiProperty({ type: Date, nullable: true })
  expiresAt!: Date | null;
}

export class MembershipAccountDto {
  @ApiProperty()
  uid!: string;

  @ApiProperty({ enum: MembershipStatus })
  status!: MembershipStatus;

  @ApiProperty({ enum: MembershipTier })
  tier!: MembershipTier;

  @ApiProperty()
  legacyTier!: string;

  @ApiProperty({ type: Date, nullable: true })
  expiresAt!: Date | null;

  @ApiProperty({ type: Date, nullable: true })
  periodStart!: Date | null;

  @ApiProperty({ type: Date, nullable: true })
  periodEnd!: Date | null;

  @ApiProperty()
  autoRenew!: boolean;

  @ApiProperty({ enum: MembershipSource })
  source!: MembershipSource;

  @ApiProperty({ nullable: true })
  lastOrderId!: string | null;
}

export class MembershipOverviewDto {
  @ApiProperty({ type: MembershipAccountDto })
  account!: MembershipAccountDto;

  @ApiProperty({ type: MembershipQuotaDto })
  quota!: MembershipQuotaDto;

  @ApiProperty({ type: [MembershipEntitlementDto] })
  entitlements!: readonly MembershipEntitlementDto[];

  @ApiProperty({ type: [MembershipPlanDto] })
  availablePlans!: readonly MembershipPlanDto[];

  @ApiProperty({ type: [MembershipAddonDto] })
  availableAddons!: readonly MembershipAddonDto[];

  @ApiProperty({ type: [MembershipOrderDto] })
  recentOrders!: readonly MembershipOrderDto[];

  @ApiProperty({ description: '真实支付通道未接时为 true' })
  paymentReserved!: boolean;

  @ApiProperty({ description: '旧 billing 状态兼容字段' })
  legacyStatus!: string;

  @ApiProperty({ description: '旧 3 档兼容字段' })
  legacyTier!: string;
}

export class MembershipPlansResponseDto {
  @ApiProperty({ type: [MembershipPlanDto] })
  plans!: readonly MembershipPlanDto[];

  @ApiProperty({ type: [MembershipAddonDto] })
  addons!: readonly MembershipAddonDto[];

  @ApiProperty({ description: '真实支付通道未接时为 true' })
  paymentReserved!: boolean;
}

export class PriceQuoteDto {
  @ApiProperty({ enum: MembershipTier })
  tier!: MembershipTier;

  @ApiProperty({ enum: BillingPeriod })
  billingPeriod!: BillingPeriod;

  @ApiProperty()
  listPriceCents!: number;

  @ApiProperty()
  basePriceCents!: number;

  @ApiProperty()
  campaignPriceCents!: number;

  @ApiProperty()
  renewalPriceCents!: number;

  @ApiProperty()
  floorPriceCents!: number;

  @ApiProperty({ nullable: true })
  promotionId!: string | null;

  @ApiProperty({ nullable: true })
  promotionName!: string | null;

  @ApiProperty()
  promotionDiscountCents!: number;

  @ApiProperty()
  couponDiscountCents!: number;

  @ApiProperty()
  amountCents!: number;

  @ApiProperty()
  giftMinutes!: number;

  @ApiProperty()
  currency!: 'CNY';

  @ApiProperty()
  periodMinutes!: number;

  @ApiProperty({ enum: TtsModel })
  ttsModel!: TtsModel;

  @ApiProperty()
  ruleVersion!: string;
}

export class QuoteQueryDto {
  @ApiProperty({ description: '套餐 id (plus/pro/max) 或加包 id' })
  @IsString()
  @MinLength(3)
  productId!: string;

  @ApiProperty({ enum: BillingPeriod, required: false, default: BillingPeriod.Monthly })
  @IsOptional()
  @IsEnum(BillingPeriod)
  billingPeriod?: BillingPeriod;

  @ApiProperty({ required: false, description: '活动码' })
  @IsOptional()
  @IsString()
  promotionCode?: string;

  @ApiProperty({ required: false, deprecated: true, description: '已停用：客户端不得传优惠券金额，非零值返回 50011' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Type(() => Number)
  couponDiscountCents?: number;
}

export class CreateMembershipOrderDto {
  @ApiProperty({ description: '套餐 id (plus/pro/max) 或加包 id (addon_100/addon_300/addon_500)' })
  @IsString()
  @MinLength(3)
  productId!: string;

  @ApiProperty({ enum: BillingPeriod, required: false, default: BillingPeriod.Monthly })
  @IsOptional()
  @IsEnum(BillingPeriod)
  billingPeriod?: BillingPeriod;

  @ApiProperty({ enum: PaymentChannel, required: false, default: PaymentChannel.Reserved })
  @IsOptional()
  @IsEnum(PaymentChannel)
  paymentChannel?: PaymentChannel;

  @ApiProperty({ required: false, description: '活动码；默认首购活动自动命中' })
  @IsOptional()
  @IsString()
  promotionCode?: string;

  @ApiProperty({ required: false, deprecated: true, description: '已停用：客户端不得传优惠券金额，非零值返回 50011' })
  @IsOptional()
  @IsInt()
  @Min(0)
  couponDiscountCents?: number;

  @ApiProperty({ required: false, description: '幂等键；同一 uid 重复提交返回同一订单' })
  @IsOptional()
  @IsString()
  idempotencyKey?: string;
}

export class QuotaReserveDto {
  @ApiProperty({ description: '会话 id，唯一，重复预扣幂等' })
  @IsString()
  @MinLength(1)
  sessionId!: string;

  @ApiProperty({ required: false, default: 10, minimum: 1, maximum: 50 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(50)
  requestedMinutes?: number;
}

export class QuotaSettleDto {
  @ApiProperty()
  @IsString()
  reservationId!: string;

  @ApiProperty({ minimum: 0, maximum: 50 })
  @IsInt()
  @Min(0)
  @Max(50)
  actualMinutes!: number;
}

export class QuotaReleaseDto {
  @ApiProperty()
  @IsString()
  reservationId!: string;
}

export class QuotaReservationDto {
  @ApiProperty()
  reservationId!: string;

  @ApiProperty()
  reservedMinutes!: number;

  @ApiProperty({ type: MembershipQuotaDto })
  balance!: MembershipQuotaDto;

  @ApiProperty()
  idempotent!: boolean;
}

export class QuotaSettleResultDto {
  @ApiProperty()
  reservationId!: string;

  @ApiProperty({ enum: ['held', 'settled', 'released'] })
  status!: 'held' | 'settled' | 'released';

  @ApiProperty()
  settledMinutes!: number;

  @ApiProperty({ description: '实际用量超出可扣余额的差额，余额永不为负' })
  shortfallMinutes!: number;

  @ApiProperty({ type: MembershipQuotaDto })
  balance!: MembershipQuotaDto;
}

export class QuotaLotDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ enum: QuotaLotSource })
  source!: QuotaLotSource;

  @ApiProperty()
  minutesRemaining!: number;

  @ApiProperty({ type: Date })
  expiresAt!: Date;
}
