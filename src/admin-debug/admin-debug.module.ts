// V2026-10-29 (WP19 · AdminDebugModule):
//   职责: 调试器 SPA 的只读 API + 每轮 trace 记录服务.
//
//   V2026-10-30 治本 (WP19-R · admin/api 收口):
//     · 接入 `AdminBasicAuthMiddleware` (basic auth + 学员身份) —— 整条路由
//       不再零鉴权 (原来 module 头明写"不做鉴权", 是 audit D2 的实锤);
//     · 注册 `character_profiles` 实体 —— `characters` 端点改查引擎角色池;
//     · 引入 UserModule —— 复用仓库既有 `JwtAuthGuard` 解析学员身份
//       (不自己解 JWT, 不造第 4 套鉴权).
//
//   反双胞胎:
//     - 不新造鉴权体系: 管理员 = basic auth (env), 学员 = 既有 JWT;
//       不引入角色表 / 权限系统.
//     - 不把 TraceRecorder 只留在本模块里: 它**导出**给引擎装配层
//       (EngineWiringModule 注入进 EngineStreamBackend) —— 否则"留痕"又是一条
//       恒 undefined 的断链 (WP19 交付时的实锤).

import { MiddlewareConsumer, Module, type NestModule } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AdminBasicAuthMiddleware } from './admin-basic-auth.middleware.js';
import { AdminDebugController } from './admin-debug.controller.js';
import { TraceRecorder } from './trace-recorder.service.js';
import { TrainingSession } from '../counselor/entities/training-session.entity.js';
import { CharacterProfileEntity } from '../engine-adapters/wiring/character/character-profile.entity.js';
import { UserModule } from '../user/index.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([TrainingSession, CharacterProfileEntity]),
    // 学员身份解析依赖 (JwtAuthGuard → JwtService / JwtBlacklistService).
    UserModule,
  ],
  controllers: [AdminDebugController],
  providers: [TraceRecorder, AdminBasicAuthMiddleware],
  exports: [TraceRecorder],
})
export class AdminDebugModule implements NestModule {
  /**
   * 给 `/admin/api/*` 挂访问控制中间件.
   *
   * 用 `forRoutes(AdminDebugController)` 而不是路径通配: Express 5 的通配符
   * 语法变了 ('*' 不再合法), 路径写法容易在启动期炸; 按控制器挂载则**新增端点
   * 自动继承**, 不会漏.
   *
   * @param consumer 中间件消费者
   */
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(AdminBasicAuthMiddleware).forRoutes(AdminDebugController);
  }
}
