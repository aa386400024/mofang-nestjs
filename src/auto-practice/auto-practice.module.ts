// V2026-11-08 治本 (Phase2.5 WP-D · 自动对练模块):
//   职责: 把 AI 咨询师 (LLM) + AI 来访者 (现有引擎) 双向自动跑起来 ——
//         单场实时看 (HTTP 同步 + WS 推每轮) / 批量跑 (BullMQ 并发 3).
//
//   依赖方向 (单向 DAG, 无循环):
//     AutoPracticeModule → AdminDebugChatModule (拿 DebugSessionService, 复用调试管道)
//     AutoPracticeModule → LlmModule (拿 LlmRouterService, 咨询师台词生成)
//     AutoPracticeModule → TypeOrm (ap_counselor_modes / ap_practice_sessions / users)
//
//   反双胞胎:
//     - engine-core 零改动: 所有新逻辑在本模块 + 适配层.
//     - 不新写对话循环: 引擎那半边完全复用 DebugSessionService (create/runTurn/close).
//     - 不干扰手动调试: 手动调试面板照旧, 本模块是新增并列模式.
//
//   验证:
//     1. npx tsc -p tsconfig.build.json --noEmit 0 错
//     2. curl POST /admin/api/auto-practice/sessions { characterSlug, counselorModeId } → 跑一场
//     3. WS /auto-practice subscribe → 实时收到每轮

import { MiddlewareConsumer, Module, type NestModule } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AutoPracticeController } from './auto-practice.controller.js';
import { AutoPracticeGateway } from './auto-practice.gateway.js';
import { AdminBasicAuthMiddleware } from '../admin-debug/admin-basic-auth.middleware.js';
import { AdminDebugChatModule } from '../admin-debug/admin-debug-chat.module.js';
import { AdminRoleGuard } from '../admin-debug/guards/admin-role.guard.js';
import { LlmModule } from '../llm/llm.module.js';
import { User } from '../user/entities/user.entity.js';
import { UserModule } from '../user/index.js';
import { DebugTurnEngineAdapter } from './adapters/debug-turn-engine.adapter.js';
import { CounselorAgentService } from './counselor-agent.service.js';
import { CounselorMode } from './entities/counselor-mode.entity.js';
import { PracticeSession } from './entities/practice-session.entity.js';
import { InferenceFingerprintService } from './inference-fingerprint.service.js';
import { TURN_ENGINE_PORT } from './ports/turn-engine.port.js';
import { PracticeQueueService } from './practice-queue.service.js';
import { PracticeRunnerService } from './practice-runner.service.js';

@Module({
  imports: [
    // 本模块的两张表 + User (AdminRoleGuard 要查 admin_role).
    TypeOrmModule.forFeature([CounselorMode, PracticeSession, User]),
    // 复用调试会话管道 (DebugSessionService 已从该模块导出).
    AdminDebugChatModule,
    // LLM 路由层 (咨询师台词生成).
    LlmModule,
    // JwtAuthGuard (AdminBasicAuthMiddleware 的第二个构造参数, 学员身份解析).
    UserModule,
  ],
  controllers: [AutoPracticeController],
  providers: [
    // 端口绑定: TURN_ENGINE_PORT → DebugTurnEngineAdapter (runner 只依赖端口).
    {
      provide: TURN_ENGINE_PORT,
      useClass: DebugTurnEngineAdapter,
    },
    CounselorAgentService,
    InferenceFingerprintService,
    PracticeRunnerService,
    PracticeQueueService,
    AutoPracticeGateway,
    AdminRoleGuard,
  ],
})
export class AutoPracticeModule implements NestModule {
  /**
   * 挂访问控制中间件 (与 debug-session.controller 同款):
   * AdminBasicAuthMiddleware 判身份 (basic / JWT), AdminRoleGuard 判角色.
   */
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(AdminBasicAuthMiddleware).forRoutes(AutoPracticeController);
  }
}
