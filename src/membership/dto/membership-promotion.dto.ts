import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsDate, IsEnum, IsInt, IsObject, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';

import { BillingPeriod, MembershipPromotionAudience, MembershipPromotionStatus, MembershipTier } from '../domain/membership.enums.js';

export class CreateMembershipPromotionDto {
  @ApiProperty({ description: '活动码，大写字母/数字/下划线', example: 'FIRST_MONTHLY' })
  @IsString()
  @Matches(/^[A-Z0-9_]{3,64}$/)
  code!: string;

  @ApiProperty({ description: '活动名称', example: '新用户首期活动' })
  @IsString()
  @MaxLength(128)
  name!: string;

  @ApiPropertyOptional({ description: '活动说明' })
  @IsOptional()
  @IsString()
  @MaxLength(512)
  description?: string;

  @ApiPropertyOptional({ enum: MembershipPromotionStatus, default: MembershipPromotionStatus.Draft })
  @IsOptional()
  @IsEnum(MembershipPromotionStatus)
  status?: MembershipPromotionStatus;

  @ApiProperty({ enum: BillingPeriod })
  @IsEnum(BillingPeriod)
  billingPeriod!: BillingPeriod;

  @ApiPropertyOptional({ enum: MembershipPromotionAudience, default: MembershipPromotionAudience.FirstPurchase })
  @IsOptional()
  @IsEnum(MembershipPromotionAudience)
  audience?: MembershipPromotionAudience;

  @ApiPropertyOptional({ description: '未传活动码时是否自动命中', default: true })
  @IsOptional()
  @IsBoolean()
  autoApply?: boolean;

  @ApiProperty({ description: '开始时间（ISO 8601）' })
  @Type(() => Date)
  @IsDate()
  startsAt!: Date;

  @ApiProperty({ description: '结束时间（ISO 8601）' })
  @Type(() => Date)
  @IsDate()
  endsAt!: Date;

  @ApiProperty({ description: '分档活动价（分）', example: { plus: 6800, pro: 16_800, max: 32_800 } })
  @IsObject()
  prices!: Partial<Record<MembershipTier, number>>;

  @ApiPropertyOptional({ description: '分档底价（分）；缺省用会员档底价' })
  @IsOptional()
  @IsObject()
  floors?: Partial<Record<MembershipTier, number>>;

  @ApiPropertyOptional({ description: '分档赠送分钟' })
  @IsOptional()
  @IsObject()
  giftMinutes?: Partial<Record<MembershipTier, number>>;

  @ApiPropertyOptional({ description: '活动总预算（分）；null 表示不限额' })
  @IsOptional()
  @IsInt()
  @Min(0)
  budgetCents?: number | null;

  @ApiPropertyOptional({ description: '单用户可兑换次数', default: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1000)
  perUserLimit?: number;

  @ApiPropertyOptional({ description: '优先级，数字越大越先命中', default: 100 })
  @IsOptional()
  @IsInt()
  @Min(0)
  priority?: number;

  @ApiPropertyOptional({ description: '规则版本号', default: 'membership-promotion-v1' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  ruleVersion?: string;
}

export class UpdateMembershipPromotionDto extends PartialType(CreateMembershipPromotionDto) {}

export class ListMembershipPromotionQueryDto {
  @ApiPropertyOptional({ enum: MembershipPromotionStatus })
  @IsOptional()
  @IsEnum(MembershipPromotionStatus)
  status?: MembershipPromotionStatus;

  @ApiPropertyOptional({ enum: BillingPeriod })
  @IsOptional()
  @IsEnum(BillingPeriod)
  billingPeriod?: BillingPeriod;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;
}

export class MembershipPromotionDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  code!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty()
  description!: string;

  @ApiProperty({ enum: MembershipPromotionStatus })
  status!: MembershipPromotionStatus;

  @ApiProperty({ enum: BillingPeriod })
  billingPeriod!: BillingPeriod;

  @ApiProperty({ enum: MembershipPromotionAudience })
  audience!: MembershipPromotionAudience;

  @ApiProperty()
  autoApply!: boolean;

  @ApiProperty()
  startsAt!: string;

  @ApiProperty()
  endsAt!: string;

  @ApiProperty()
  prices!: Partial<Record<MembershipTier, number>>;

  @ApiProperty()
  floors!: Partial<Record<MembershipTier, number>>;

  @ApiProperty()
  giftMinutes!: Partial<Record<MembershipTier, number>>;

  @ApiProperty()
  budgetCents!: number | null;

  @ApiProperty()
  perUserLimit!: number;

  @ApiProperty()
  priority!: number;

  @ApiProperty()
  ruleVersion!: string;

  @ApiProperty()
  createdAt!: string;

  @ApiProperty()
  updatedAt!: string;
}

export class MembershipPromotionStatsDto {
  @ApiProperty()
  promotionId!: string;

  @ApiProperty()
  redemptionCount!: number;

  @ApiProperty()
  discountCents!: number;

  @ApiProperty()
  grantedMinutes!: number;

  @ApiProperty()
  budgetCents!: number | null;

  @ApiProperty()
  budgetRemainingCents!: number | null;

  @ApiProperty()
  perUserLimit!: number;

  @ApiProperty()
  reservedCount!: number;

  @ApiProperty()
  reservedCents!: number;
}
