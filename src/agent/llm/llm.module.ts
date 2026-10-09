// V2026-10-08 治本 (LLM 子模块):
//   复用: ConfigModule (全局已注入, 不要再 import)
//   导出: LlmService (供 Visitor / Supervisor agent 后续 slice 复用)
//
//   反双胞胎:
//     - 不引入 OTelModule — Phase 1 不引 OTel, 后续 V1.x 加

import { Module } from '@nestjs/common';

import { LlmController } from './llm.controller';
import { LlmService } from './llm.service';

@Module({
  controllers: [LlmController],
  providers: [LlmService],
  exports: [LlmService],
})
export class LlmModule {}
