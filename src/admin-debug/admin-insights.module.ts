// V2026-11-05 治本 (Admin Dashboard 剩余三页切真 API · 洞察模块):
//   职责: 装配 admin 调试面的"洞察"一侧 —— 仪表盘 / 记忆浏览器 / PsyGUARD 监控.
//   边界: 只做装配; 口径在 `insights-view.ts`, 取数在 `admin-insights.controller.ts`.
//
//   为什么**单独成模块** (而不是塞进 `AdminDebugModule`):
//     · `AdminDebugModule` 被 `EngineWiringModule` import (为了 `TraceRecorder`) ——
//       往里塞 `AIEngineModule` (向量库) 会让依赖方向变浑;
//     · 洞察面要的依赖与 `AdminDebugModule` **没有交集**: 那边是"会话 + 角色",
//       这边是"会话聚合 + 记忆 + 风险探测".
//     拆开后: `AdminDebugModule` 零改动, 洞察面自带鉴权与依赖.
//
//   依赖说明:
//     · `AIEngineModule` —— 只为 `QdrantService` (长时记忆的真存储);
//       它 export 了 QdrantService, 不另造一份 (仓库对 Qdrant 的既有纪律).
//     · `PsyGuardHealthModule` —— 与引擎装配层**共用同一个**探针实例
//       (见该模块文件头: 两份实例 = 启动探两次 + 两份结论可能不一致).
//     · `UserModule` —— `AdminRoleGuard` 要直读 `users.admin_role`.
//
//   中间件 (WP19-R 同款):
//     `AdminBasicAuthMiddleware` 按**控制器**挂载 (`forRoutes(AdminInsightsController)`)
//     —— 挂控制器而不是路径通配, 新增端点自动继承, 也不会踩 Express 5 的通配符语法变更.
//
//   验证:
//     1. npx tsc -p tsconfig.build.json --noEmit 0 错
//     2. test/admin-debug/admin-insights.spec.ts
//     3. test/admin-debug/wp26-admin-role-guard.spec.ts (路由清单含新端点)

import { MiddlewareConsumer, Module, type NestModule } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AdminBasicAuthMiddleware } from './admin-basic-auth.middleware.js';
import { AdminInsightsController } from './admin-insights.controller.js';
import { AdminRoleGuard } from './guards/admin-role.guard.js';
import { AIEngineModule } from '../ai-engine/ai-engine.module.js';
import { TrainingSession } from '../counselor/entities/training-session.entity.js';
import { PsyGuardHealthModule } from '../engine-adapters/wiring/risk/psyguard-health.module.js';
import { User } from '../user/entities/user.entity.js';
import { UserModule } from '../user/index.js';

@Module({
  imports: [
    // 会话表 (仪表盘聚合用) —— 只读.
    TypeOrmModule.forFeature([TrainingSession]),
    // User 实体注册 (autoLoadEntities 已开) —— 供 AdminRoleGuard 注入 Repository<User>.
    TypeOrmModule.forFeature([User]),
    // 学员身份解析依赖 (JwtAuthGuard → JwtService / JwtBlacklistService) —— 中间件要用.
    UserModule,
    // 向量库 (QdrantService) —— 长时记忆的真存储.
    AIEngineModule,
    // PsyGUARD 探针 (与引擎装配层同一个实例).
    PsyGuardHealthModule,
  ],
  controllers: [AdminInsightsController],
  providers: [
    // 内部角色判定 (直读 users.admin_role) —— 仓库既有的内部能力守卫.
    AdminRoleGuard,
    AdminBasicAuthMiddleware,
  ],
})
export class AdminInsightsModule implements NestModule {
  /**
   * 给洞察路由挂访问控制中间件.
   *
   * 按控制器挂载: 新增端点自动继承, 不会漏.
   *
   * @param consumer 中间件消费者
   */
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(AdminBasicAuthMiddleware).forRoutes(AdminInsightsController);
  }
}
