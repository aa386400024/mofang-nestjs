import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';

import { MembershipPromotionReservationService } from './membership-promotion-reservation.service.js';

/** 每 10 分钟释放过期活动预占；订单最长 12 小时，超时后额度回到活动池。 */
@Injectable()
export class MembershipPromotionReservationCleanupCron {
  private readonly logger = new Logger(MembershipPromotionReservationCleanupCron.name);

  constructor(private readonly reservationService: MembershipPromotionReservationService) {}

  @Cron(CronExpression.EVERY_10_MINUTES, { name: 'membership-promotion-reservation-cleanup', waitForCompletion: true })
  async handle(): Promise<void> {
    const released = await this.reservationService.cleanupExpired();
    if (released > 0) this.logger.log(`活动预占超时释放 rows=${released}`);
  }
}
