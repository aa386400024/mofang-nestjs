// V2026-10-13 治本 (V0.2 — billing/billing.module.ts, Phase 8 商业化):
//   商业化 server module (跟 counselor / life_map 模块同 pattern).
//
//   V0.5: 4 endpoint + 内存 mock, 不接 TypeORM, 不用 billing entities 表.
//   V1.x: TypeOrmModule.forFeature([Order, Product, Membership]) + 真支付 (微信/支付宝).

import { Module } from '@nestjs/common';

import { AuthModule } from '../auth';
import { UserModule } from '../user';

import { BillingController } from './controllers/billing.controller';
import { BillingService } from './providers/billing.service';

@Module({
  imports: [UserModule, AuthModule],
  controllers: [BillingController],
  providers: [BillingService],
  exports: [BillingService],
})
export class BillingModule {}
