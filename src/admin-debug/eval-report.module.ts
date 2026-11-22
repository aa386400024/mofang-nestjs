// V2026-11-09 治本 (Phase2.5 WP-E · admin 端点模块):
//   职责: 装配评测报告查询端点 (列表 / 详情).
//   边界: 只做装配; 鉴权中间件挂 controller.
//
//   为什么单独成模块 (跟 GateTraceModule 同款理由):
//     · eval_reports 表属于 engine-adapters (写侧在那一层), 读侧独立成模块后,
//       引擎侧与 admin 侧都只认表, 两边不互相 import 对方的实现;
//     · 不往 AdminDebugModule 里塞新的表依赖, 避免引擎装配层方向变浑.
//
//   时间戳: 2026-11-09

import { MiddlewareConsumer, Module, type NestModule } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AdminBasicAuthMiddleware } from './admin-basic-auth.middleware.js';
import { EvalReportController } from './eval-report.controller.js';
import { AdminRoleGuard } from './guards/admin-role.guard.js';
import { EvalReportEntity } from '../engine-adapters/eval/eval-report.entity.js';
import { User } from '../user/entities/user.entity.js';
import { UserModule } from '../user/index.js';

@Module({
  imports: [TypeOrmModule.forFeature([EvalReportEntity, User]), UserModule],
  controllers: [EvalReportController],
  providers: [AdminRoleGuard, AdminBasicAuthMiddleware],
})
export class EvalReportAdminModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(AdminBasicAuthMiddleware).forRoutes(EvalReportController);
  }
}
