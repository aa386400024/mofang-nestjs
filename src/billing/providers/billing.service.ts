// V2026-10-13 治本 (V0.2 — billing/providers/billing.service.ts, Phase 8 商业化):
//   商业化业务逻辑服务 (4 档会员 + 4 SKU 单次 + 订单 CRUD).
//
//   V0.5 简化: 全部内存 mock (跟 counselor profile 同 pattern). 微信/支付宝真接未
//   申请, paymentChannel 字段写死 'reserved', 客户端 UI 显 "支付通道预留中".
//   V1.x: 接入微信 V2 商户 / 支付宝 当面付 + 真实 billing.orders 表 + 配额 guard
//   + 自动续费 cron.

import { Injectable } from '@nestjs/common';

import { type CreateOrderDto, type MembershipOverviewDto, type OrderDto, type ProductDto } from '../dto/billing.dto';

@Injectable()
export class BillingService {
  /**
   * GET /billing/membership 主入口.
   *
   * @param userId 当前用户 id (从 JWT @CurrentUser 注入, V0.5 mock 不用, V1.x 改回真用查 billing 表)
   */
  async getMembershipOverview(userId: string): Promise<MembershipOverviewDto> {
    // V2026-10-13 治本 (V0.2 — ESLint naming-convention strictCamelCase 修):
    //   pnpm lint:fix 报 `_userId` 不通过 strictCamelCase, 跟之前 counselor-profile /
    //   counselor-growth 治本同 pattern. 治本: 改回无下划线 `userId` 满足 strictCamelCase,
    //   函数体首行用 `void userId;` 标 "故意保留但未用" 抑制 TS6133. 零 disable 注释,
    //   0 disable 依赖, 跟其它 6 个 service 风格统一.
    void userId;
    return this.buildMockOverview();
  }

  /**
   * GET /billing/products - 4 个单次 SKU (5/19.9/39.9/9.9 元).
   */
  async listAvailableProducts(): Promise<ProductDto[]> {
    return this.buildMockProducts();
  }

  /**
   * POST /billing/orders - 创建订单 (V0.5 走 reserved 通道, status 写死 pending).
   *
   * @param userId 当前用户 id (V0.5 mock 不用, V1.x 真用)
   * @param dto 订单 DTO (V0.5 mock 不用 productId/paymentChannel 实际匹配, 返写死产品)
   */
  async createOrder(userId: string, dto: CreateOrderDto): Promise<OrderDto> {
    // V2026-10-13 治本 (V0.2 — ESLint naming-convention strictCamelCase 修, 同 getMembershipOverview):
    void userId;
    void dto;
    return {
      id: `order_${Date.now()}_mock`,
      userId,
      productId: dto.productId,
      productName: '5 元尝鲜包 (mock)',
      amountCents: 500,
      paymentChannel: 'reserved',
      status: 'pending',
      createdAt: new Date(),
      paidAt: null,
    };
  }

  /**
   * GET /billing/orders - 历史订单 (V0.5 返空数组).
   */
  async listOrders(userId: string): Promise<OrderDto[]> {
    // V2026-10-13 治本 (V0.2 — ESLint naming-convention strictCamelCase 修, 同 getMembershipOverview).
    void userId;
    return [];
  }

  // ══════════════════════════════════════════════════════════════════════════
  // Mock 数据 (V0.5, V1.x 走 TypeORM repository)
  // ══════════════════════════════════════════════════════════════════════════

  private buildMockOverview(): MembershipOverviewDto {
    return {
      membership: {
        status: 'none',
        expiresAt: null,
        autoRenew: false,
        remainingQuota: { sessions: 0, ttsChars: 0 },
      },
      recentOrders: [],
      availableProducts: this.buildMockProducts(),
      currentRole: 'counselor_learner',
      paymentReserved: true, // 提示 UI "支付通道预留中"
    };
  }

  private buildMockProducts(): ProductDto[] {
    return [
      {
        id: 'single_5_session',
        name: '5 元尝鲜包',
        description: '5 元 / 1 次训练 / 7 天',
        priceCents: 500, // 5 元
        durationDays: 7,
        quota: { sessions: 1, ttsChars: 5000 },
      },
      {
        id: 'single_199_session',
        name: '19.9 元标准包',
        description: '19.9 元 / 5 次训练 / 30 天',
        priceCents: 1990, // 19.9 元
        durationDays: 30,
        quota: { sessions: 5, ttsChars: 30_000 },
      },
      {
        id: 'single_399_session',
        name: '39.9 元专业包',
        description: '39.9 元 / 15 次训练 / 90 天',
        priceCents: 3990, // 39.9 元
        durationDays: 90,
        quota: { sessions: 15, ttsChars: 100_000 },
      },
      {
        id: 'single_99_student',
        name: '9.9 元学生包',
        description: '9.9 元 / 2 次训练 / 30 天 (学生半价)',
        priceCents: 990, // 9.9 元
        durationDays: 30,
        quota: { sessions: 2, ttsChars: 15_000 },
      },
    ];
  }
}
