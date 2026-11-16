// V2026-11-09 治本 (Phase2.5 闸门 trace 查询接口 · admin 端点模块):
//   职责: 装配闸门决策查询端点 (列表 / 详情 / 按天统计) —— 数据源是 `gate_decisions` 表
//         (MySQL 真相源) 与闸门统计日计数器 (Redis).
//   边界: 只做装配; 口径在 `gate-decision-view.ts` / `gate-decision-stats.ts`.
//
//   为什么**单独成模块** (而不是塞进 `AdminDebugModule`):
//     · `AdminDebugModule` 被 `EngineWiringModule` import (为了 `TraceRecorder`) ——
//       往里塞新的表依赖会让引擎装配层的依赖方向变浑;
//     · 闸门决策表属于 engine-adapters (写侧在那一层), 读侧独立成模块后,
//       引擎侧与 admin 侧都只认**表**, 两边不互相 import 对方的实现.
//
//   中间件 (WP19-R 同款):
//     `AdminBasicAuthMiddleware` 按**控制器**挂载 (`forRoutes(GateTraceController)`)
//     —— 挂控制器而不是路径通配, 新增端点自动继承.
//
//   验证:
//     1. npx tsc -p tsconfig.build.json --noEmit 0 错
//     2. test/admin-debug/wp26-admin-role-guard.spec.ts (路由清单含新端点 + 模块含 guard)
//
//   时间戳: 2026-11-09

import { MiddlewareConsumer, Module, type NestModule } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AdminBasicAuthMiddleware } from './admin-basic-auth.middleware.js';
import { GateTraceController } from './gate-trace.controller.js';
import { AdminRoleGuard } from './guards/admin-role.guard.js';
import { GateDecisionEntity } from '../engine-adapters/deliberation-gate/gate-decision/gate-decision.entity.js';
import { User } from '../user/entities/user.entity.js';
import { UserModule } from '../user/index.js';

/**
 * 闸门决策查询模块.
 */
@Module({
  imports: [
    // 闸门决策表 (只读) —— 真相源.
    TypeOrmModule.forFeature([GateDecisionEntity]),
    // User 实体注册 (autoLoadEntities 已开) —— 供 AdminRoleGuard 注入 Repository<User>.
    TypeOrmModule.forFeature([User]),
    // 学员身份解析依赖 (JwtAuthGuard → JwtService / JwtBlacklistService) —— 中间件要用.
    UserModule,
  ],
  controllers: [GateTraceController],
  providers: [
    // 内部角色判定 (直读 users.admin_role) —— 仓库既有的内部能力守卫.
    AdminRoleGuard,
    AdminBasicAuthMiddleware,
  ],
})
export class GateTraceModule implements NestModule {
  /**
   * 给闸门查询路由挂访问控制中间件.
   *
   * @param consumer 中间件消费者
   */
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(AdminBasicAuthMiddleware).forRoutes(GateTraceController);
  }
}
