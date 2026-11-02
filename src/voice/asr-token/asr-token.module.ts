// V2026-10-08 治本 (ASR token 子模块):
//   复用: AuthModule (JwtAuthGuard), ConfigModule (全局已注入)
//   导出: AsrTokenService (VoiceGateway 不需要, 但 V0.5 加配额时复用)
//
//   反双胞胎:
//     - 不在 Module 里 import VoiceModule — 单向依赖, 业务模块可单独 import AsrTokenModule

import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';

import { AsrTokenController } from './asr-token.controller';
import { AsrTokenService } from './asr-token.service';

@Module({
  imports: [
    JwtModule.register({}), // 给 AsrTokenService 注入 JwtService (用于签短期 token)
  ],
  controllers: [AsrTokenController],
  providers: [AsrTokenService],
  exports: [AsrTokenService],
})
export class AsrTokenModule {}
