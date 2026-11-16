// V2026-10-09 治本 (Voice 根模块 — Phase 3 升级 + Phase 4 修补):
//   V0.x Phase 1.2: 挂 TtsModule
//   V0.x Phase 3: 加 AsrTokenModule + VoiceGateway + VoiceService
//   V0.x Phase 4: VoiceService 注入 VisitorService (agent 转 Persona/Visitor module)
//   V0.x Phase 4 治本: VoiceModule 注册本地 JwtModule (修 Phase 3 JwtService 缺失坑)
//
//   V2026-10-23 治本 (v2.0 语音对语音 — 会话基础设施, spec §2.1):
//     引入 VoiceSessionModule (@Global): 演练登记 + 公共人物模板解析插槽.
//     两侧 (voice / counselor) 都直接注入, 互不 import —— 保持 agent → business 的单向依赖.
//
//   反双胞胎:
//     - 不在 VoiceModule 直接 import **counselor 业务模块** — 单向依赖,
//       业务模块可单独 import VoiceModule
//     - 不在 VoiceModule 挂 counselor 模块 — 那会让"语音链路"反向依赖"咨询业务"
//     - V2026-11-03 (WP26 P2-1) 的例外: import `UserModule` 取
//       `JwtBlacklistService` —— 这是**账号域的通用能力**(与 HTTP 面的
//       `JwtAuthGuard` 共用同一份黑名单口径), 不是"咨询业务".
//       依赖方向 voice → user 仍是单向 (user 侧不 import voice), 不构成环.
//
//   时间戳: 2026-10-23

import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';

import { AgentModule } from '../agent/agent.module.js';
import { AsrTokenModule } from './asr-token/asr-token.module.js';
import { TtsModule } from './tts/tts.module.js';
import { VoiceSessionLimitsService } from './voice-session-limits.service.js';
import { VoiceSessionModule } from './voice-session.module.js';
import { VoiceGateway } from './voice.gateway.js';
import { VoiceService } from './voice.service.js';
import { EngineWiringModule } from '../engine-adapters/wiring/engine.module.js';
import { UserModule } from '../user/index.js';

@Module({
  imports: [
    TtsModule, // TtsService (句级 mp3 流)
    AgentModule, // LlmService (Phase 1.1) + VisitorService (Phase 4) + PersonaRepository (Phase 4)
    AsrTokenModule, // AsrTokenService (Phase 3)
    // V2026-10-23 治本: 演练登记 + 模板解析插槽 (@Global) — counselor 侧也要用, 放这里统一挂载
    VoiceSessionModule,
    // V2026-10-29 治本 (WP8-B): 引擎装配层 — 提供新引擎版对话后端 (VOICE_TURN_BACKEND).
    //   灰度开关关时, voice 侧根本不会用它 (旧链路 100% 原样); 开关开时才有新链路.
    //   依赖方向单向: voice → engine-adapters (引擎不认识语音协议, 只提供窄面).
    EngineWiringModule,
    // V2026-10-09 治本: VoiceGateway 注入 JwtService 校验客户端 token (handleConnection).
    //   跟 AsrTokenModule 同款: 本地注册 JwtModule (空配置, secret 在 verifyAsync 时显式传 jwtSecret).
    //   为什么不直接 import AuthModule:
    //     1. AuthModule 虽然 @Global, 但 @Global 只让 module 自己的 exports 全局可见
    //     2. AuthModule imports JwtModule 但不 re-export, JwtService 不是 global
    //     3. 引 AuthModule 会顺带拉 UserModule + 3 个 Passport strategy, 过度耦合
    //   何时切走: V1.x 如果统一 JWT secret 配置, 在 app.module 全局注册 JwtModule 一次,
    //     所有 module 共享, 删掉本地 register.
    JwtModule.register({}),
    // V2026-11-03 治本 (WP26 §1 P2-1 · WS 握手查 JWT 黑名单):
    //   引入 UserModule 取 `JwtBlacklistService` —— 登出后的 access token
    //   还能连 WS, 是"已登出即失效"这条安全承诺在 WS 面的破口.
    //   为什么复用既有服务而不是自己查 Redis: 黑名单的 **key 口径**必须与
    //   `JwtAuthGuard` 完全一致, 两边各写一份 Redis key 迟早漂移 —— 漂移的方向
    //   恰好是"HTTP 面已登出、WS 面仍可用".
    //   依赖方向: voice → user 是**单向**边 (user 侧不 import voice), 不构成环;
    //   与 `src/admin-debug/admin-debug.module.ts` 同一接法.
    UserModule,
  ],
  providers: [VoiceService, VoiceGateway, VoiceSessionLimitsService],
  exports: [VoiceService],
})
export class VoiceModule {}
