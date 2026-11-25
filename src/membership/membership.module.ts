import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { MembershipController } from './controllers/membership.controller.js';
import { MembershipOrder } from './entities/membership-order.entity.js';
import { MembershipPromotionRedemption } from './entities/membership-promotion-redemption.entity.js';
import { MembershipQuotaLot } from './entities/membership-quota-lot.entity.js';
import { MembershipQuotaReservation } from './entities/membership-quota-reservation.entity.js';
import { DefaultPromotionEngine } from './providers/default-promotion.engine.js';
import { MembershipAccountService } from './providers/membership-account.service.js';
import { MembershipOrderService } from './providers/membership-order.service.js';
import { MembershipPricingService } from './providers/membership-pricing.service.js';
import { PROMOTION_ENGINE } from './providers/promotion-engine.port.js';
import { QuotaLedgerService } from './providers/quota-ledger.service.js';
import { Membership } from '../profile/entities/membership.entity.js';

/**
 * 会员 v2 模块。
 *
 * 依赖 Membership 实体的仓储由本模块注册，ProfileModule 仍保留旧服务；
 * 新逻辑只经本模块，旧端点通过兼容映射读新数据。
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([Membership, MembershipQuotaLot, MembershipQuotaReservation, MembershipOrder, MembershipPromotionRedemption]),
  ],
  controllers: [MembershipController],
  providers: [
    QuotaLedgerService,
    MembershipPricingService,
    MembershipAccountService,
    MembershipOrderService,
    DefaultPromotionEngine,
    { provide: PROMOTION_ENGINE, useExisting: DefaultPromotionEngine },
  ],
  exports: [MembershipAccountService, MembershipOrderService, MembershipPricingService, QuotaLedgerService],
})
export class MembershipModule {}
