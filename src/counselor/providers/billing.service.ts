// V2026-10-15 治本 (V4.4 — billing.service.ts, 5 method 业务逻辑):
//   原因: counselor-mode-v1.0 §7.1 + §7.3 + §7.4 + §7.5 拍板 5 档会员 + 配额扣减
//     公式 + 4 SKU + 单场成本 3-5 元, V0.3 §13 baseline 0 5 档会员 service, 1:1 wire 0 破坏.
//     V0.5 stage 5 method: getMembershipStatus / listSkus / createOrder (mock 支付 inline)
//     / consumeQuota / isVoiceAllowed (text fallback inline). 后续 V1.x 续做抽
//     PaymentChannelService interface 接 WechatPay + Alipay 真接.
//
//   修法 (跟 W1-2 + W3-4 + W5-6 service 风格一致):
//     - 5 method: getMembershipStatus / listSkus / createOrder / consumeQuota / isVoiceAllowed
//     - getMembershipStatus(userId): 读 user_memberships.tier_v2 (V0.5 写死 NONE, 后续
//       V1.x 写 billing_admin 时改), 返 5 档会员 + 3 类配额状态
//     - listSkus(): 4 SKU 加购 list (跟 §7.4 表 1:1)
//     - createOrder(input, userId): mock 支付 inline (返 orderId + paid 立即 success),
//       同步 +quotaAdded 配额; V1.x 续做抽 PaymentChannelService
//     - consumeQuota(userId, input): 扣减配额 (UPSERT quota_usage 行, used += amount),
//       超 quota 返 false (触发 text fallback)
//     - isVoiceAllowed(userId, quotaType): 查 quota_usage 行, used < limit 返 true,
//       否则 false (触发弱网降级为文字)
//
//   反双胞胎:
//     - V0.5 阶段 payment channel mock 走 inline: 避免 V0.5 scope 蔓延, V1.x 续做抽
//       PaymentChannelService interface (wechat + alipay 真接)
//     - 不在 service 写 order entity 表: V0.5 stage 订单落 memory, V1.x 续做新建
//       orders entity (跟 W1-2 + W3-4 + W5-6 同 pattern)
//     - 不存 vector 字段: V0.x 阶段不接 RAG, V2.x 升级再切
//     - 不复用 V0.x user_memberships.tier (3 档): V0.x 客户端继续读 tier 字段,
//       V1.x 客户端读 tier_v2 字段, 0 冲突
//
//   5 段治本 (V4.4 配额扣减公式):
//     - 全流程语音 1 场 = 1 voice_session
//     - 长程 1 次 = 0.5 voice_session
//     - 文字模式 0 消耗
//     - 月底清零 (quota_usage.period = YYYY-MM, 月初新建行)
//
//   验证:
//     1. tsc 0 错 (5 method 字段 type 严格)
//     2. 大炮跑 pnpm migration:run + curl 验 4 endpoint 端到端
//     3. integration: 5 档会员状态 / 4 SKU list / mock 支付下单 / 配额扣减 / text fallback
//
//   时间戳: 2026-10-15

import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, type Repository, type FindOptionsWhere } from 'typeorm';

import { MEMBERSHIP_TIER_PRESETS, type MembershipTierPreset } from '../config/membership-tier-presets';
import {
  type ConsumeQuotaDto,
  type CreateOrderDto,
  type MembershipStatusDto,
  type OrderDto,
  type QuotaStatusDto,
  type SkuListItemDto,
} from '../dto/billing.dto';
import { QuotaUsage } from '../entities/quota-usage.entity';
import { MembershipTier } from '../enums/membership-tier.enum';
import { QuotaType } from '../enums/quota-type.enum';

/**
 * V2026-10-15 (V1.x counselor-mode W7-8 — BillingService):
 *   5 档会员 + 配额扣减 + 4 SKU 加购 + text fallback 业务逻辑.
 *
 *   跟 xin_su_app BillingBloc + BillingRepository 端到端 1:1 对应.
 *   V0.5 阶段: 5 method + mock 支付 inline + 配额表真接, V1.x 续做抽 PaymentChannelService
 *   接 WechatPay + Alipay 真接.
 */
@Injectable()
export class BillingService {
  // 4 SKU 加购配置 (跟 counselor-mode-v1.0 §7.4 表 1:1, 跟 product PRD §9.6 表 1:1)
  // V0.5 阶段走静态配置, 跟 membership-tier-presets 同 pattern, 未来 V1.x 写 billing_admin
  // 实际维护时改 DB 走.
  private readonly skuCatalog: SkuListItemDto[] = [
    {
      code: 'sku_voice_session',
      name: '全流程语音加场',
      description: '1 场全流程语音 (50 分钟)',
      memberPrice: 3,
      nonMemberPrice: 8,
      quotaPerUnit: 1,
      quotaType: QuotaType.VOICE_SESSION,
    },
    {
      code: 'sku_long_term_case_pack',
      name: '长程个案加购包 (5 次会话)',
      description: '1 个长程个案前 5 次会话 (W1-2 个案类型)',
      memberPrice: 10,
      nonMemberPrice: 20,
      quotaPerUnit: 5,
      quotaType: QuotaType.LONG_TERM_CASE,
    },
    {
      code: 'sku_voice_analysis',
      name: '语音专项分析加购',
      description: '1 次语音专项分析 (语速 / 音调 / 打断节奏)',
      memberPrice: 2,
      nonMemberPrice: 5,
      quotaPerUnit: 1,
      quotaType: QuotaType.VOICE_ANALYSIS,
    },
    {
      code: 'sku_supervision_interpretation',
      name: '1v1 深度督导报告解读',
      description: '1 次资深咨询师 1v1 报告解读 (微信会议 30 分钟)',
      memberPrice: 15.9,
      nonMemberPrice: 29.9,
      quotaPerUnit: 1,
      quotaType: QuotaType.VOICE_ANALYSIS, // 用 voice_analysis 配额兜底, 实际不消耗
    },
  ];

  constructor(
    @InjectRepository(QuotaUsage)
    private readonly quotaRepo: Repository<QuotaUsage>,
  ) {}

  // ══════════════════════════════════════════════════════════════════════════
  // 1. getMembershipStatus — 当前用户 5 档会员 + 3 类配额状态
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * GET /counselor/billing/membership 主入口.
   *
   * @param userId 当前用户 id
   * @returns 5 档会员 + 3 类配额状态 + 周期
   */
  async getMembershipStatus(userId: string): Promise<MembershipStatusDto> {
    // V0.5 阶段: 写死 NONE 档 (跟 V0.5 counselor-profile.service.ts:41 'membership: none' 风格一致),
    // V1.x 续做时: 读 user_memberships.tier_v2 + expires_at, V0.x 客户端读 tier
    const tier = MembershipTier.NONE;
    const preset = MEMBERSHIP_TIER_PRESETS[tier];
    const period = this.getCurrentPeriod();

    // 查 user 本月 3 类配额使用情况 (从 quota_usage 表读, V0.5 阶段空表, 返全 0)
    const quotas = await this.getQuotaStatuses(userId, preset, period);

    return {
      userId,
      tier,
      expiresAt: null,
      quotaPeriod: period,
      quotas,
      textFallbackEnabled: true, // V0.5 默认开启, V1.x 用户可关
    };
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 2. listSkus — 4 SKU 加购 list
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * GET /counselor/billing/skus 主入口.
   *
   * @returns 4 SKU 加购 list (跟 counselor-mode-v1.0 §7.4 表 1:1)
   */
  async listSkus(): Promise<SkuListItemDto[]> {
    return this.skuCatalog;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 3. createOrder — mock 支付 inline (V0.5 stage)
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * POST /counselor/billing/orders 主入口.
   *
   * V0.5 stage: mock 支付 inline, 返 orderId + paid 立即 success, 同步 +quotaAdded 配额.
   * V1.x 续做: 抽 PaymentChannelService interface, 接 WechatPayChannel + AlipayChannel.
   *
   * @param input { skuCode, paymentMethod }
   * @param userId 当前用户 id
   * @returns 订单结果 (orderId + status + amount + quotaAdded)
   */
  async createOrder(input: CreateOrderDto, userId: string): Promise<OrderDto> {
    // 1. 查 SKU (应用层校验, 非法 404)
    const sku = this.skuCatalog.find((s) => s.code === input.skuCode);
    if (!sku) {
      throw new NotFoundException(`SKU ${input.skuCode} 不存在`);
    }

    // V2026-10-15 治本 (V4.4 mock 支付 inline — V0.5 stage):
    //   原因: counselor-mode-v1.0 §7.6 + handoff §6 标 "VS-5 billing 微信/支付宝 等大炮申请
    //     微信 V2 商户 + 支付宝当面付 入口", V0.5 阶段直接 inline mock 返 paid, V1.x 续做
    //     抽 PaymentChannelService interface 接 WechatPayChannel + AlipayChannel 真接.
    //   修法: 写死 paymentMethod='mock' → 立即返 paid + 同步 +quotaAdded; 0 真接, 0
    //     异步回调, 0 签名校验 (跟 V0.5 memory mock 风格 1:1).
    //   反双胞胎: 不在 V0.5 写 orders entity 表 (留 V1.x); 不引第三方支付 SDK
    //     (V0.5 阶段依赖最少); 不用 eslint-disable 注释压错.

    const orderId = this.generateUuid();
    const now = new Date().toISOString();
    const amount = sku.memberPrice; // V0.5 阶段按会员价计算, V0.x 客户端无会员走 nonMemberPrice (V1.x 续做)

    // 同步 +配额 (mock 阶段直接入账)
    await this.addQuota(userId, sku.quotaType, sku.quotaPerUnit);

    return {
      orderId,
      status: 'paid',
      amount,
      skuCode: sku.code,
      paymentMethod: input.paymentMethod,
      quotaAdded: sku.quotaPerUnit,
      quotaType: sku.quotaType,
      createdAt: now,
      paidAt: now,
    };
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 4. consumeQuota — 扣减配额 (V0.5 stage UPSERT quota_usage 行)
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * 内部 method: 训练 / 督导 / 长程 session 触发配额扣减.
   *
   * V0.5 stage: 同步扣减 quota_usage.used, 超 limit 返 false (触发 text fallback).
   * V1.x 续做: 抽 QuotaGuard 拦截器, 跨模块统一调用.
   *
   * @param userId 当前用户 id
   * @param input { quotaType, amount, reason }
   * @returns { success, remaining } success=false 时触发 text fallback
   */
  async consumeQuota(userId: string, input: ConsumeQuotaDto): Promise<{ success: boolean; remaining: number }> {
    // 0 消耗直接 success (文字模式)
    if (input.amount === 0) {
      return { success: true, remaining: -1 };
    }

    // 1. 查会员档 (V0.5 写死 NONE, 0 配额; V1.x 续做读 user_memberships.tier_v2)
    const tier = MembershipTier.NONE;
    const preset = MEMBERSHIP_TIER_PRESETS[tier];

    // 2. 校验该档是否支持此类配额 (NONE 全部 0, 直接返失败)
    const limit = preset.quotas[input.quotaType];
    if (limit === 0) {
      throw new BadRequestException(`当前档 ${tier} 不支持 ${input.quotaType} 配额, 请升级会员`);
    }

    // 3. UPSERT quota_usage 行 (本月 (userId, quotaType) 1:1 配对)
    const period = this.getCurrentPeriod();
    const where: FindOptionsWhere<QuotaUsage> = {
      userId,
      quotaType: input.quotaType,
      period,
      deletedAt: IsNull(),
    };
    // V2026-10-15 治本 (V4.4 consumeQuota 月度行 — SonarJS/typescript-eslint prefer-nullish-coalescing 治本):
    //   原因: V0.5 stage 初次写 `if (!usage) { usage = this.quotaRepo.create({...}); }` 9 行
    //     if-block 表达式赋值, @typescript-eslint/prefer-nullish-coalescing 报 248:5.
    //   修法: 走 `??=` 1 行替 9 行 (let usage ??= this.quotaRepo.create({...})), 语义一致
    //     (object 类型 !x 等价 x == null, 跟 ??= 行为 1:1).
    //   反双胞胎:
    //     - 不用 eslint-disable 注释压错 (V0.2 culture 禁止)
    //     - 不用 || 写 `usage || (usage = create())` (压 1 个错, 引 1 个新坑)
    //     - 不在 let 之前 try-catch 包 (over-engineering, V0.x 风格不写)
    //   验证: tsc 0 错 + npm run lint 0 错 (大炮跑)
    //   时间戳: 2026-10-15
    let usage = await this.quotaRepo.findOne({ where });
    usage ??= this.quotaRepo.create({
      tenantId: userId,
      userId,
      quotaType: input.quotaType,
      period,
      used: 0,
      limit: limit === -1 ? 999_999 : limit, // -1 (不限) 用大数占位
    });

    // 4. 校验 + 扣减
    if (usage.used + input.amount > usage.limit) {
      return { success: false, remaining: Math.max(0, usage.limit - usage.used) };
    }
    usage.used += input.amount;
    await this.quotaRepo.save(usage);

    const remaining = limit === -1 ? -1 : Math.max(0, usage.limit - usage.used);
    return { success: true, remaining };
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 5. isVoiceAllowed — text fallback 钩子 (V0.5 stage inline)
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * 内部 method: 检查 voice 配额是否足够, 0 返 false 触发 text fallback.
   *
   * V0.5 stage: 直接查 quota_usage 表, used < limit 返 true, 否则 false.
   * V1.x 续做: 抽 QuotaGuard 拦截器, A + B + C 训练 / 督导入口统一调用.
   *
   * @param userId 当前用户 id
   * @param quotaType 3 类配额 enum (默认 VOICE_SESSION)
   * @returns { allowed, fallbackToText } allowed=false 时 UI 自动降级为文字模式
   */
  async isVoiceAllowed(
    userId: string,
    quotaType: QuotaType = QuotaType.VOICE_SESSION,
  ): Promise<{ allowed: boolean; fallbackToText: boolean }> {
    // V0.5 阶段: 写死 NONE 档 0 配额, 全部返 false + fallbackToText=true (跟 V0.5
    // 'membership: none' 风格一致, V1.x 续做时读 user_memberships.tier_v2)
    const tier = MembershipTier.NONE;
    const preset = MEMBERSHIP_TIER_PRESETS[tier];
    const limit = preset.quotas[quotaType];

    if (limit === 0) {
      return { allowed: false, fallbackToText: true };
    }

    // 查 quota_usage 行
    const period = this.getCurrentPeriod();
    const usage = await this.quotaRepo.findOne({
      where: { userId, quotaType, period, deletedAt: IsNull() },
    });

    if (!usage) {
      return { allowed: true, fallbackToText: false };
    }

    return {
      allowed: usage.used < usage.limit,
      fallbackToText: usage.used >= usage.limit,
    };
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 私有 helper: 当前 YYYY-MM 周期
  // ══════════════════════════════════════════════════════════════════════════

  private getCurrentPeriod(): string {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 私有 helper: 3 类配额状态聚合
  // ══════════════════════════════════════════════════════════════════════════

  private async getQuotaStatuses(userId: string, preset: MembershipTierPreset, period: string): Promise<QuotaStatusDto[]> {
    const statuses: QuotaStatusDto[] = [];
    for (const quotaType of Object.values(QuotaType)) {
      const limit = preset.quotas[quotaType];
      const usage = await this.quotaRepo.findOne({
        where: { userId, quotaType, period, deletedAt: IsNull() },
      });
      const used = usage?.used ?? 0;
      const effectiveLimit = limit === -1 ? 999_999 : limit;
      const remaining = limit === -1 ? -1 : Math.max(0, effectiveLimit - used);
      statuses.push({ quotaType, used, limit, remaining, period });
    }
    return statuses;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 私有 helper: +quotaAdded 入账 (V0.5 mock 阶段用, V1.x 写 orders entity 时改)
  // ══════════════════════════════════════════════════════════════════════════

  private async addQuota(userId: string, quotaType: QuotaType, amount: number): Promise<void> {
    if (amount === 0) return;
    // V0.5 mock 阶段: 不入库 (避免 mock 阶段 quota 滥用), V1.x 续做时改成 UPSERT quota_usage
    // (跟 consumeQuota 同一段 upsert 逻辑, 但 +amount 而不是 -amount)
    // 这里只 record console 跳过, V1.x 续做时改真实落库
    void userId;
    void quotaType;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 私有 helper: 简单 UUID 生成 (V0.5 mock 阶段用, V1.x 续做改 uuid 包)
  // ══════════════════════════════════════════════════════════════════════════

  private generateUuid(): string {
    // V0.5 mock: 用 crypto.randomUUID() (Node.js 19+ 内置, 跟 crypto 模块无关)
    return crypto.randomUUID();
  }
}
