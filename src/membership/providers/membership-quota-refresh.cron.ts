import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';

import { MembershipPlanGrantService } from './membership-plan-grant.service.js';

/** 每 10 分钟补发年付套餐月份；月边界最多延迟 10 分钟，不影响当日可用性。 */
@Injectable()
export class MembershipQuotaRefreshCron {
  private readonly logger = new Logger(MembershipQuotaRefreshCron.name);

  constructor(private readonly planGrantService: MembershipPlanGrantService) {}

  @Cron(CronExpression.EVERY_10_MINUTES, { name: 'membership-plan-grant-refresh', waitForCompletion: true })
  async handle(): Promise<void> {
    const granted = await this.planGrantService.refreshDue();
    if (granted > 0) this.logger.log(`年付套餐按月补发完成 lots=${granted}`);
  }
}
