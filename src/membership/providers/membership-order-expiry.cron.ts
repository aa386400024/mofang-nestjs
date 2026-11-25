import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';

import { MembershipOrderService } from './membership-order.service.js';

/** 每 10 分钟关闭过期 pending 订单，并释放对应活动预占；支付回调对 closed 订单直接拒绝。 */
@Injectable()
export class MembershipOrderExpiryCron {
  private readonly logger = new Logger(MembershipOrderExpiryCron.name);

  constructor(private readonly orderService: MembershipOrderService) {}

  @Cron(CronExpression.EVERY_10_MINUTES, { name: 'membership-order-expiry', waitForCompletion: true })
  async handle(): Promise<void> {
    const closed = await this.orderService.closeExpired();
    if (closed > 0) this.logger.log(`过期会员订单关闭 rows=${closed}`);
  }
}
