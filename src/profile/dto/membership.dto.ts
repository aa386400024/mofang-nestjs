import { ApiProperty } from '@nestjs/swagger';

/**
 * 单个权益项 DTO — 会员中心列表渲染.
 *
 * V2.0 §Tab4 会员中心 (5 个权益):
 *   - 高级成长报告 / 全套循证练习库 / AI 心塑助手无限次 / 高级陪伴权限 / 专家答疑
 */
export class MembershipBenefitDto {
  @ApiProperty({ description: 'Material icon name', example: 'insights_outlined' })
  icon!: string;

  @ApiProperty({ description: '权益标题', example: '高级成长报告' })
  title!: string;

  @ApiProperty({ description: '权益说明', example: '月度深度报告 + 周趋势曲线' })
  description!: string;

  @ApiProperty({ description: '当前是否解锁', example: false })
  unlocked!: boolean;
}

/**
 * 响应 DTO — GET /profile/membership.
 *
 * V2.0 占位: status=inactive, 全部 unlocked=false.
 * V3 接订单 + 支付后, 真实填 status / expiresAt / unlocked.
 */
export class MembershipDto {
  @ApiProperty({ description: '状态', enum: ['inactive', 'active', 'expired', 'trial'] })
  status!: 'inactive' | 'active' | 'expired' | 'trial';

  @ApiProperty({ description: '等级', enum: ['free', 'plus', 'pro'] })
  tier!: 'free' | 'plus' | 'pro';

  @ApiProperty({ description: '过期时间', nullable: true })
  expiresAt!: Date | null;

  @ApiProperty({ description: '权益列表', type: [MembershipBenefitDto] })
  benefits!: MembershipBenefitDto[];
}
