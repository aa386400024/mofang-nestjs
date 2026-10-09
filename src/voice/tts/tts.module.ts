// V2026-10-08 治本 (TTS 子模块):
//   导出: TtsService (供 VoiceGateway 复用)
//   复用: ConfigModule (全局已注入, 不要再 import)
//
//   反双胞胎:
//     - 不在 Module 里 import VoiceGateway — 单向依赖, 业务模块主动 import TtsModule

import { Module, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { TtsBidiPoolService } from './tts-bidi-pool.service';
import { TtsService } from './tts.service';

@Module({
  providers: [TtsService, TtsBidiPoolService],
  exports: [TtsService, TtsBidiPoolService],
})
export class TtsModule implements OnApplicationBootstrap {
  constructor(
    private readonly pool: TtsBidiPoolService,
    private readonly config: ConfigService,
  ) {}

  /** V0.x: 显式注入 ConfigService 给 Pool (TtsBidiClient 是手动 new, 不走 DI). */
  onApplicationBootstrap(): void {
    this.pool.init(this.config);
  }
}
