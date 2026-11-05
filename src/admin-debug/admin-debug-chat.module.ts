// V2026-11-05 治本 (WP58 · 引擎调试面板 · 模块):
//   职责: 装配调试面板的写操作接口 (controller + service + 中间件 + 守卫).
//   边界: 只做装配; 不含业务逻辑.
//
//   为什么**单独成模块** (而不是塞进 `AdminDebugModule`):
//     依赖方向天然是"调试面板 → 引擎":
//       · 调试接口要调引擎门面 (`EngineTurnService`) 与角色解析端口;
//       · 而 `EngineWiringModule` **反过来 import 了** `AdminDebugModule`
//         (为了 `TraceRecorder` —— 每轮 BDI 快照落库).
//     若把调试接口放进 `AdminDebugModule`, 它就得 import `EngineWiringModule`,
//     于是变成 `EngineWiringModule ⇄ AdminDebugModule` —— **模块循环依赖**,
//     Nest 启动期就炸 (provider 互相等对方实例化).
//     拆出本模块后依赖是**单向 DAG**:
//       AppModule → AdminDebugChatModule → EngineWiringModule → AdminDebugModule
//       AppModule → AdminDebugChatModule → CharacterPoolModule
//
//   为什么**不用 forwardRef**:
//     仓库里 `forwardRef` 的使用次数是 **0** —— 它是 Nest 处理循环依赖的**兜底**,
//     不是首选. 本单能不制造循环就不制造 (少一个"启动期才炸"的雷).
//
//   为什么要 `TypeOrmModule.forFeature([User])`:
//     `AdminRoleGuard` 直读 `users.admin_role` 一列 (判"是不是管理员"),
//     它是 class 级守卫 → 实例化在**本模块**的注入上下文里, 所以本模块要自己
//     注册一次 User 实体 (与 `AdminDebugModule` 同款做法).
//
//   中间件 (WP19-R 同款):
//     `AdminBasicAuthMiddleware` 判"这次请求是谁" (运维 basic 凭据 / 学员 JWT).
//     它按**控制器**挂载 (`forRoutes(DebugSessionController)`) —— 挂控制器而不是
//     挂路径通配, 新增端点自动继承, 也不会踩 Express 5 的通配符语法变更.
//
//   反双胞胎:
//     - 不新造鉴权体系: 复用仓库既有的 basic auth 中间件 + admin 角色守卫.
//     - 不把调试会话写进 `training_sessions`: 会话状态只在内存 Map 里 (服务层).
//     - 不在这里注册 `EngineTurnService`: 它由 `EngineWiringModule` 提供, 本模块只 import.
//
//   验证:
//     1. npx tsc -p tsconfig.build.json --noEmit 0 错
//     2. 启动后 curl POST /admin/api/debug/session → /turn → DELETE 能跑通一轮
//     3. test/admin-debug/wp58-debug-session.spec.ts

import { MiddlewareConsumer, Module, type NestModule } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AdminBasicAuthMiddleware } from './admin-basic-auth.middleware.js';
import { DebugSessionController } from './debug-session.controller.js';
import { DebugSessionService } from './debug-session.service.js';
import { AdminRoleGuard } from './guards/admin-role.guard.js';
import { CharacterPoolModule } from '../engine-adapters/wiring/character/character-pool.module.js';
import { EngineWiringModule } from '../engine-adapters/wiring/engine.module.js';
import { User } from '../user/entities/user.entity.js';
import { UserModule } from '../user/index.js';

@Module({
  imports: [
    // User 实体注册 (autoLoadEntities 已开) —— 供 AdminRoleGuard 注入 Repository<User>.
    TypeOrmModule.forFeature([User]),
    // 学员身份解析依赖 (JwtAuthGuard → JwtService / JwtBlacklistService) —— 中间件要用.
    UserModule,
    // 引擎装配层 (EngineTurnService: 调试会话要真跑引擎, 不是 mock).
    // ⚠️ 单向依赖: 引擎**不** import 本模块 (否则就是循环依赖, 见文件头).
    EngineWiringModule,
    // 角色池 (CHARACTER_PROFILE_RESOLVER: 把 characterSlug 解析成内核角色基线).
    CharacterPoolModule,
  ],
  controllers: [DebugSessionController],
  providers: [
    // 调试会话逻辑 (内存会话表 + 角色解析 + delta + 审议 trace 读取).
    DebugSessionService,
    // 内部角色判定 (直读 users.admin_role) —— 仓库既有的内部能力守卫.
    AdminRoleGuard,
  ],
})
export class AdminDebugChatModule implements NestModule {
  /**
   * 给调试会话路由挂访问控制中间件.
   *
   * 按控制器挂载: 新增端点自动继承, 不会漏.
   *
   * @param consumer 中间件消费者
   */
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(AdminBasicAuthMiddleware).forRoutes(DebugSessionController);
  }
}
