// V2026-10-13 治本 (V0.2 — billing/dto/billing.dto.ts, Phase 8 商业化):
//   心塑 + 咨询师 商业化 DTO 契约 (4 档会员 + 4 SKU 单次 + 订单).
//
//   V0.5 简化: 微信/支付宝真接未申请, paymentChannel 字段 `reserved` 表示预留中.
//   V1.x: 接入真支付 (微信 V2 商户 / 支付宝 当面付), paymentChannel 改 'wechat' / 'alipay'.
//
//   字段单位: 价格 `priceCents` / `amountCents` (整数, 避免浮点精度), 跟 spec V0.2 §10 一致.

import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsNotEmpty, IsString } from 'class-validator';

// ════════════════════════════════════════════════════════════════════════════════
// 子 DTO: 会员状态
// ════════════════════════════════════════════════════════════════════════════════

// V2026-10-15 治本 (V0.3 整合 — MembershipDto 5 档+none description):
//   原因: V0.2 spec §17 写 "4 档 + none" outdated, 实际 V0.5 拍板 5 档+none.
//         漏写 'lifetime' 档 (B4 #6 MINOR + V3 §8 错位 #9).
//         业务代码 enum 实际值跟 V0.5 1:1, 5 档都对, DTO description 注释 outdated.
//   修法: 改 description "4 档 + none" → "5 档 + none (V0.5 拍板, V0.2 spec
//         §17 漏写 lifetime)", enum 实际值不变.
//   反双胞胎: 不改 enum 实际值 (跟 V0.5 拍板一致); 不删 'lifetime' 档; 不写 V0.4.
//   验证: 大炮跑 pnpm build 验 swagger + curl GET /billing/membership 验 5 档 enum.
//   时间戳: 2026-10-15

export class MembershipDto {
  @ApiProperty({
    description: '会员状态 (5 档 + none, V0.5 拍板, V0.2 spec §17 漏写 lifetime)',
    enum: ['none', 'monthly', 'quarterly', 'yearly', 'lifetime'],
  })
  status!: 'none' | 'monthly' | 'quarterly' | 'yearly' | 'lifetime';

  @ApiProperty({ description: '到期时间 (V0.5 写死 null, V1.x 接 billing 表)', type: Date, nullable: true })
  expiresAt!: Date | null;

  @ApiProperty({ description: '是否自动续费 (V0.5 写死 false, V1.x 接支付)', example: false })
  autoRenew!: boolean;

  @ApiProperty({ description: '剩余配额 (训练 sessions + TTS 字符数, V0.5 写死 0)' })
  remainingQuota!: {
    sessions: number;
    ttsChars: number;
  };
}

// ════════════════════════════════════════════════════════════════════════════════
// 子 DTO: 单次增值 SKU (4 个, 跟新 spec §7 单次增值 5/19.9/39.9/9.9 元)
// ════════════════════════════════════════════════════════════════════════════════

export class ProductDto {
  @ApiProperty({ description: 'SKU id', example: 'single_5_session' })
  id!: string;

  @ApiProperty({ description: 'SKU 名称 (前台显)', example: '5 元尝鲜包' })
  name!: string;

  @ApiProperty({ description: 'SKU 描述', example: '5 元 / 1 次训练 / 7 天' })
  description!: string;

  @ApiProperty({ description: '价格 (分, 避免浮点; 5元=500, 19.9=1990, 39.9=3990, 9.9=990)', example: 500 })
  priceCents!: number;

  @ApiProperty({ description: '有效期 (天, V0.5 写死 7/30/90/30)', example: 7 })
  durationDays!: number;

  @ApiProperty({ description: '配额 (单次内含 session + tts 字符数)' })
  quota!: {
    sessions: number;
    ttsChars: number;
  };
}

// ════════════════════════════════════════════════════════════════════════════════
// 子 DTO: 订单
// ════════════════════════════════════════════════════════════════════════════════

export class OrderDto {
  @ApiProperty({ description: '订单 id', example: 'order_xxx' })
  id!: string;

  @ApiProperty({ description: '购买者 userId' })
  userId!: string;

  @ApiProperty({ description: 'SKU id (跟 ProductDto.id 1:1)' })
  productId!: string;

  @ApiProperty({ description: 'SKU 名称 (下单时 snapshot, 跟 ProductDto.name 1:1)' })
  productName!: string;

  @ApiProperty({ description: '订单金额 (分)', example: 500 })
  amountCents!: number;

  // V2026-10-15 治本 (V0.3 整合 — OrderDto paymentChannel description):
  //   原因: V0.2 spec §17 写 paymentChannel 简化, 实际 V0.5 拍板 4 值
  //         (wechat/alipay/reserved/none), V0.5 写死 'reserved' 永不 completed.
  //         大炮红线: 需先申请支付入口, VS-5 启动前置.
  //   修法: 加 5 段治本注释 + 扩 description 标 "VS-5 P1 启动前置".
  //         需大炮申请 微信 V2 商户 + 支付宝当面付.
  //   反双胞胎: 不改 enum 实际值 (跟 V0.5 拍板一致); 不删 'none' 档 (default).
  //   验证: 大炮跑 pnpm build + curl POST /billing/orders 验 reserved 返 pending.
  //   时间戳: 2026-10-15

  @ApiProperty({
    description: '支付通道 (V0.5 写死 reserved, V1.x 真接 wechat/alipay, VS-5 P1 启动前置: 需大炮申请 微信 V2 商户 + 支付宝当面付 入口)',
    enum: ['wechat', 'alipay', 'reserved', 'none'],
  })
  paymentChannel!: 'wechat' | 'alipay' | 'reserved' | 'none';

  @ApiProperty({ description: '订单状态 (V0.5 写死 pending, V1.x 真接)', enum: ['pending', 'paid', 'failed', 'refunded'] })
  status!: 'pending' | 'paid' | 'failed' | 'refunded';

  @ApiProperty({ description: '下单时间' })
  createdAt!: Date;

  @ApiProperty({ description: '支付完成时间 (V0.5 写死 null, 走 reserved 永不 completed)', type: Date, nullable: true })
  paidAt!: Date | null;
}

// ════════════════════════════════════════════════════════════════════════════════
// 父 DTO: 我的商业化总览 (GET /billing/membership)
// ════════════════════════════════════════════════════════════════════════════════

export class MembershipOverviewDto {
  @ApiProperty({ description: '当前会员状态 (V0.5 写死 none)', type: MembershipDto })
  membership!: MembershipDto;

  @ApiProperty({ description: '最近订单 (V0.5 写死空数组, V1.x 查 billing.orders 表)', type: [OrderDto] })
  recentOrders!: OrderDto[];

  @ApiProperty({ description: '可购买单次 SKU 列表 (V0.5 写死 4 个 mock)', type: [ProductDto] })
  availableProducts!: ProductDto[];

  @ApiProperty({ description: '用户当前角色 (写死 counselor_learner)', enum: ['counselor_learner'] })
  currentRole!: 'counselor_learner';

  @ApiProperty({ description: '支付通道预留状态 (V0.5 写死 true, 提示 UI 显示"支付通道预留中")', example: true })
  paymentReserved!: boolean;
}

// ════════════════════════════════════════════════════════════════════════════════
// 请求 DTO: 创建订单 (POST /billing/orders)
// ════════════════════════════════════════════════════════════════════════════════

export class CreateOrderDto {
  @ApiProperty({ description: 'SKU id (跟 ProductDto.id 1:1)' })
  @IsString()
  @IsNotEmpty()
  productId!: string;

  @ApiProperty({ description: '支付通道 (V0.5 写死 reserved, V1.x 真接 wechat/alipay)', enum: ['wechat', 'alipay', 'reserved'] })
  @IsIn(['wechat', 'alipay', 'reserved'])
  paymentChannel!: 'wechat' | 'alipay' | 'reserved';
}
