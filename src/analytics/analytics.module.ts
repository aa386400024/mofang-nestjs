// V2026-10-12 (Phase 8.3 — Analytics 模块 / SPEC §8.1 / §12.5):
//   analytics 模块装配, 跟 src/ai-engine/ai-engine.module.ts 同 pattern (4 层架构).
//
//   V0.x 装配:
//     - 1 entity: AnalyticsEvent
//     - 2 service: AnalyticsService (聚合查询) + AnalyticsEventTrackerService
//                  (业务事件 hook, V0.x 暂未跨模块 wire, V1.x knowledge-base
//                  模块 inject 这个 service 调 recordXxx)
//     - 1 controller: AnalyticsController (GET /admin/analytics/overview?range=week)
//
//   治本:
//     - 不用 @Global() (跟 ai-engine 同 pattern, 不污染全局)
//     - AnalyticsEventTrackerService 暂时不强制跨模块 wire (V0.x dev 内部
//       显式调用, 避免循环依赖), 后续 V1.x knowledge.service 5 workflow
//       action 触发时直接 inject 此 service.

import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AnalyticsController } from './controllers/analytics.controller';
import { AnalyticsEvent } from './entities/analytics-event.entity';
import { AnalyticsEventTrackerService } from './providers/analytics-event-tracker.service';
import { AnalyticsService } from './providers/analytics.service';

@Module({
  imports: [TypeOrmModule.forFeature([AnalyticsEvent])],
  controllers: [AnalyticsController],
  providers: [AnalyticsService, AnalyticsEventTrackerService],
  exports: [AnalyticsService, AnalyticsEventTrackerService],
})
export class AnalyticsModule {}
