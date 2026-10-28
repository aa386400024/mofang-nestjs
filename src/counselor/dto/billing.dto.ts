// V2026-10-15 治本 (V4.3 — billing.dto.ts, 5 DTO 1:1 wire):
//   原因: counselor-mode-v1.0 §7.1 + §7.4 + §7.6 拍板 5 档会员 + 4 SKU 加购 +
//     1v1 督导报告解读, V0.3 §13 baseline 0 5 档 DTO + 0 配额 DTO, 1:1 wire 0 破坏.
//     5 DTO 1:1 对应 xin_su_app BillingBloc entity 字段.
//
//   修法:
//     - 5 DTO 跟 V0.5 已有 counselor-* DTO 风格一致 (ApiProperty + class-validator)
//     - MembershipStatusDto: 当前用户会员状态 (5 档 + 配额剩余 + 周期)
//     - SkuListItemDto: 4 SKU 加购 (跟 §7.4 表 1:1: 全流程加场 / 长程加购包 / 语音分析 / 1v1 解读)
//     - CreateOrderDto: 创建订单输入 (skuCode + paymentMethod)
//     - OrderDto: 订单结果 (mock 支付通道返 orderId + paid 状态 + 配额变更)
//     - QuotaStatusDto: 配额状态 (3 类配额已用 / 上限 / 剩余 / 周期)
//     - 跟 MembershipTier 5 档 + QuotaType 3 类 enum 严格 1:1 wire
//
//   反双胞胎:
//     - 不在 DTO 暴露 paymentMethod 真实接口 (微信/支付宝 字段): V0.5 stage
//       mock payment channel 走 string union, V1.x 续做抽 PaymentChannelService
//     - 不在 DTO 加 vector 字段: V0.x 阶段不接 RAG, V2.x 升级再切
//     - 不用 snake_case wire (用 camelCase 跟 V0.x DTO 风格一致)
//
//   验证:
//     1. tsc 0 错 (5 DTO 字段 type 严格)
//     2. 跟 xin_su_app BillingBloc entity 字段 1:1 wire (V1.x client 端联调时)
//
//   时间戳: 2026-10-15

import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsInt, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';

import { MembershipTier } from '../enums/membership-tier.enum';
import { QuotaType } from '../enums/quota-type.enum';

// ════════════════════════════════════════════════════════════════════════════
// 单类配额状态 (3 类配额都走这结构)
// ════════════════════════════════════════════════════════════════════════════

export class QuotaStatusDto {
  @ApiProperty({ description: '3 类配额 enum', enum: QuotaType })
  quotaType!: QuotaType;

  @ApiProperty({ description: '本月已用配额' })
  used!: number;

  @ApiProperty({ description: '本月配额上限 (-1 表示不限, 跟 membership-tier-presets 一致)' })
  limit!: number;

  @ApiProperty({ description: '本月剩余配额 (limit - used, -1 表示不限)' })
  remaining!: number;

  @ApiProperty({ description: '月度周期 YYYY-MM 格式', example: '2026-10' })
  period!: string;
}

// ════════════════════════════════════════════════════════════════════════════
// 当前用户会员状态 (5 档 + 配额剩余 + 周期)
// ════════════════════════════════════════════════════════════════════════════

export class MembershipStatusDto {
  @ApiProperty({ description: '用户 id (UUID)' })
  userId!: string;

  @ApiProperty({ description: '5 档会员 enum (跟 MembershipTier 1:1)', enum: MembershipTier })
  tier!: MembershipTier;

  @ApiProperty({ description: '会员到期时间 (ISO 8601, lifetime / public_welfare 为 null)', nullable: true })
  expiresAt!: string | null;

  @ApiProperty({ description: '月度周期 YYYY-MM 格式', example: '2026-10' })
  quotaPeriod!: string;

  @ApiProperty({ description: '3 类配额状态 (本月已用 / 上限 / 剩余)', type: [QuotaStatusDto] })
  quotas!: QuotaStatusDto[];

  @ApiProperty({ description: 'text fallback 弱网降级开关 (V0.x 默认 true, V1.x 续做用户可关)' })
  textFallbackEnabled!: boolean;
}

// ════════════════════════════════════════════════════════════════════════════
// 4 SKU 加购 (跟 counselor-mode-v1.0 §7.4 表 1:1)
// ════════════════════════════════════════════════════════════════════════════

export class SkuListItemDto {
  @ApiProperty({
    description: 'SKU code (V0.5 stage: sku_voice_session / sku_long_term_case_pack / sku_voice_analysis / sku_supervision_interpretation)',
  })
  code!: string;

  @ApiProperty({ description: 'SKU 名称' })
  name!: string;

  @ApiProperty({ description: 'SKU 描述' })
  description!: string;

  @ApiProperty({ description: '会员价 (元, 跟 §7.4 表 1:1)' })
  memberPrice!: number;

  @ApiProperty({ description: '非会员价 (元, 跟 §7.4 表 1:1)' })
  nonMemberPrice!: number;

  @ApiProperty({ description: '单价配额数 (1 场 / 5 次 / 1 次 / 1 次, 跟 §7.4 表 1:1)' })
  quotaPerUnit!: number;

  @ApiProperty({ description: '3 类配额 enum (决定加购包扣哪类配额)', enum: QuotaType })
  quotaType!: QuotaType;
}

// ════════════════════════════════════════════════════════════════════════════
// 创建订单输入 (V0.5 stage mock payment channel)
// ════════════════════════════════════════════════════════════════════════════

export class CreateOrderDto {
  @ApiProperty({ description: 'SKU code (4 SKU 之一)' })
  @IsString()
  @MinLength(8)
  @MaxLength(64)
  skuCode!: string;

  @ApiProperty({ description: '支付方式 (V0.5 stage mock, V1.x 续做接 wechat / alipay)', enum: ['mock'] })
  @IsIn(['mock'])
  paymentMethod!: 'mock';
}

// ════════════════════════════════════════════════════════════════════════════
// 订单结果 (V0.5 stage mock 返 paid 立即 success)
// ════════════════════════════════════════════════════════════════════════════

export class OrderDto {
  @ApiProperty({ description: '订单 id (UUID)' })
  orderId!: string;

  @ApiProperty({ description: '订单状态 (V0.5 stage: paid 立即 success, V1.x 续做: pending → paid / failed)' })
  status!: 'pending' | 'paid' | 'failed' | 'refunded';

  @ApiProperty({ description: '订单金额 (元)' })
  amount!: number;

  @ApiProperty({ description: 'SKU code (跟 CreateOrderDto 1:1)' })
  skuCode!: string;

  @ApiProperty({ description: '支付方式' })
  paymentMethod!: string;

  @ApiProperty({ description: '本次加购配额数 (跟 sku.quotaPerUnit 1:1)' })
  quotaAdded!: number;

  @ApiProperty({ description: '3 类配额 enum', enum: QuotaType })
  quotaType!: QuotaType;

  @ApiProperty({ description: '创建时间 (ISO 8601)' })
  createdAt!: string;

  @ApiProperty({ description: '支付完成时间 (ISO 8601)', nullable: true })
  paidAt!: string | null;
}

// ════════════════════════════════════════════════════════════════════════════
// 配额扣减 (V0.5 stage inline 走 service, V1.x 续做抽接口)
// ════════════════════════════════════════════════════════════════════════════

export class ConsumeQuotaDto {
  @ApiProperty({ description: '3 类配额 enum', enum: QuotaType })
  quotaType!: QuotaType;

  @ApiProperty({ description: '扣减数量 (全流程语音 1 场 = 1, 长程 1 次 = 0.5, 文字 0)', minimum: 0 })
  @IsInt()
  @Min(0)
  @Max(10)
  amount!: number;

  @ApiProperty({ description: '扣减场景描述 (audit log 用)' })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  reason!: string;
}
