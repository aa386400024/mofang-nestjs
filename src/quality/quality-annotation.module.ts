// V2026-11-10 治本 (WP-J P2 · 专业级标注工具 · admin 模块):
//   职责: 装配质量标注台端点 (列表 / 详情 / 保存 / 双盲揭示 / 一致性报告).
//   边界: 只做装配; 口径在 quality-annotation-auto.ts / quality-annotation-consistency.ts.
//
//   为什么**单独成模块** (而不是塞进 `AdminDebugModule`):
//     · `AdminDebugModule` 被 `EngineWiringModule` import (为了 `TraceRecorder`) ——
//       往里塞新的表依赖会让引擎装配层的依赖方向变浑 (与 GateTraceModule 同款理由);
//     · 本模块只读一张新表 + 一个文件存储, 与引擎侧没有写侧依赖.
//
//   ⚠️ **`DebugSessionStore` 在本模块自建 provider, 不 import AdminDebugChatModule**:
//     它是后者的私有 provider (没导出), 而后者挂着聊天/引擎装配依赖 ——
//     为了一个只读 store 拖进一整条链不划算, 而且有循环依赖风险.
//     自建实例**仍然是同一份读路径** (同一个类、同一个目录解析口径), 只是不共享写队列.
//
//   中间件 (WP19-R 同款):
//     `AdminBasicAuthMiddleware` 按**控制器**挂载 (`forRoutes(QualityAnnotationController)`)
//     —— 挂控制器而不是路径通配, 新增端点自动继承.
//
//   验证:
//     1. npx tsc -p tsconfig.build.json --noEmit 0 错
//     2. test/quality/quality-annotation-contract.spec.ts (模块含 guard + 仓储注册)
//
//   时间戳: 2026-11-10 GMT+8

import { MiddlewareConsumer, Module, type NestModule } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { QualityAnnotationController } from './quality-annotation.controller.js';
import { QualityAnnotationEntity } from './quality-annotation.entity.js';
import { QualityAnnotationService } from './quality-annotation.service.js';
import { AdminBasicAuthMiddleware } from '../admin-debug/admin-basic-auth.middleware.js';
import { DebugSessionStore } from '../admin-debug/debug-session-store.js';
import { AdminRoleGuard } from '../admin-debug/guards/admin-role.guard.js';
import { User } from '../user/entities/user.entity.js';
import { UserModule } from '../user/index.js';

/**
 * 质量标注台模块.
 */
@Module({
  imports: [
    // 标注表 (读写).
    TypeOrmModule.forFeature([QualityAnnotationEntity]),
    // User 实体注册 (autoLoadEntities 已开) —— 供 AdminRoleGuard 注入 Repository<User>.
    TypeOrmModule.forFeature([User]),
    // 学员身份解析依赖 (JwtAuthGuard → JwtService / JwtBlacklistService) —— 中间件要用.
    UserModule,
  ],
  controllers: [QualityAnnotationController],
  providers: [
    QualityAnnotationService,
    // 逐字稿只读存储 (见文件头说明: 不 import AdminDebugChatModule).
    DebugSessionStore,
    // 内部角色判定 (直读 users.admin_role) —— 仓库既有的内部能力守卫.
    AdminRoleGuard,
    AdminBasicAuthMiddleware,
  ],
})
export class QualityAnnotationModule implements NestModule {
  /**
   * 给标注台路由挂访问控制中间件.
   *
   * @param consumer 中间件消费者
   */
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(AdminBasicAuthMiddleware).forRoutes(QualityAnnotationController);
  }
}
