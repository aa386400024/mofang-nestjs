import { Module } from '@nestjs/common';

import { UserModule } from '../user/user.module';

import { DashboardController } from './controllers/dashboard.controller';
import { DashboardService } from './providers/dashboard.service';

/**
 * 仪表板模块 — V2.0 §Tab4 「我的数据」心理健身数据.
 *
 * V2.0 范围: 4 个聚合端点 (overview/weekly/modules/milestones), 全部 sample.
 * V3 接真实事件后, 加 PracticeSessionEvent / AssessmentScoreEvent 表 + 聚合查询.
 *
 * 注意: V2.0 阶段无 entity (全 sample 数据), 不需要 TypeOrmModule.forFeature.
 *   - 保留 Module 形态 (vs 直接 inline service) 是为了 V3 加 entity 时零结构改动.
 */
@Module({
  imports: [UserModule],
  controllers: [DashboardController],
  providers: [DashboardService],
  exports: [DashboardService],
})
export class DashboardModule {}
