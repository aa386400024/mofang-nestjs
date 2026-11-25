import { MiddlewareConsumer, Module, type NestModule } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AdminBasicAuthMiddleware } from '../admin-debug/admin-basic-auth.middleware.js';
import { Membership } from '../profile/entities/membership.entity.js';
import { User } from '../user/entities/user.entity.js';
import { UserModule } from '../user/user.module.js';
import { MembershipAdminController } from './controllers/membership-admin.controller.js';
import { MembershipController } from './controllers/membership.controller.js';
import { MembershipOrder } from './entities/membership-order.entity.js';
import { MembershipPlanGrantTerm } from './entities/membership-plan-grant-term.entity.js';
import { MembershipPromotionRedemption } from './entities/membership-promotion-redemption.entity.js';
import { MembershipPromotion } from './entities/membership-promotion.entity.js';
import { MembershipQuotaLot } from './entities/membership-quota-lot.entity.js';
import { MembershipQuotaReservation } from './entities/membership-quota-reservation.entity.js';
import { MembershipAdminGuard } from './guards/membership-admin.guard.js';
import { DefaultPromotionEngine } from './providers/default-promotion.engine.js';
import { MembershipAccountService } from './providers/membership-account.service.js';
import { MembershipOrderService } from './providers/membership-order.service.js';
import { MembershipPlanGrantService } from './providers/membership-plan-grant.service.js';
import { MembershipPricingService } from './providers/membership-pricing.service.js';
import { MembershipPromotionService } from './providers/membership-promotion.service.js';
import { MembershipQuotaRefreshCron } from './providers/membership-quota-refresh.cron.js';
import { FlexRulesPromotionEngine } from './providers/promotion/flex-rules-promotion.engine.js';
import { PROMOTION_ENGINE } from './providers/promotion-engine.port.js';
import { QuotaLedgerService } from './providers/quota-ledger.service.js';

/**
 * 会员 v2 模块。
 *
 * 依赖 Membership 实体的仓储由本模块注册，ProfileModule 仍保留旧服务；
 * 新逻辑只经本模块，旧端点通过兼容映射读新数据。
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      Membership,
      MembershipQuotaLot,
      MembershipQuotaReservation,
      MembershipOrder,
      MembershipPromotion,
      MembershipPromotionRedemption,
      MembershipPlanGrantTerm,
      User,
    ]),
    UserModule,
  ],
  controllers: [MembershipController, MembershipAdminController],
  providers: [
    QuotaLedgerService,
    MembershipPricingService,
    MembershipPromotionService,
    MembershipPlanGrantService,
    MembershipAccountService,
    MembershipOrderService,
    MembershipQuotaRefreshCron,
    MembershipAdminGuard,
    AdminBasicAuthMiddleware,
    DefaultPromotionEngine,
    FlexRulesPromotionEngine,
    { provide: PROMOTION_ENGINE, useExisting: FlexRulesPromotionEngine },
  ],
  exports: [MembershipAccountService, MembershipOrderService, MembershipPricingService, MembershipPromotionService, QuotaLedgerService],
})
export class MembershipModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(AdminBasicAuthMiddleware).forRoutes(MembershipAdminController);
  }
}
