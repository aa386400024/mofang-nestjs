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
//     - 不在 VoiceModule 直接 import 业务模块 — 单向依赖, 业务模块可单独 import VoiceModule
//     - 不在 VoiceModule 挂 counselor 模块 — 那会让"语音链路"反向依赖"咨询业务"
//
//   时间戳: 2026-10-23

import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';

import { AgentModule } from '../agent/agent.module';
import { AsrTokenModule } from './asr-token/asr-token.module';
import { TtsModule } from './tts/tts.module';
import { VoiceSessionModule } from './voice-session.module';
import { VoiceGateway } from './voice.gateway';
import { VoiceService } from './voice.service';

@Module({
  imports: [
    TtsModule, // TtsService (句级 mp3 流)
    AgentModule, // LlmService (Phase 1.1) + VisitorService (Phase 4) + PersonaRepository (Phase 4)
    AsrTokenModule, // AsrTokenService (Phase 3)
    // V2026-10-23 治本: 演练登记 + 模板解析插槽 (@Global) — counselor 侧也要用, 放这里统一挂载
    VoiceSessionModule,
    // V2026-10-09 治本: VoiceGateway 注入 JwtService 校验客户端 token (handleConnection).
    //   跟 AsrTokenModule 同款: 本地注册 JwtModule (空配置, secret 在 verifyAsync 时显式传 jwtSecret).
    //   为什么不直接 import AuthModule:
    //     1. AuthModule 虽然 @Global, 但 @Global 只让 module 自己的 exports 全局可见
    //     2. AuthModule imports JwtModule 但不 re-export, JwtService 不是 global
    //     3. 引 AuthModule 会顺带拉 UserModule + 3 个 Passport strategy, 过度耦合
    //   何时切走: V1.x 如果统一 JWT secret 配置, 在 app.module 全局注册 JwtModule 一次,
    //     所有 module 共享, 删掉本地 register.
    JwtModule.register({}),
  ],
  providers: [VoiceService, VoiceGateway],
  exports: [VoiceService],
})
export class VoiceModule {}
