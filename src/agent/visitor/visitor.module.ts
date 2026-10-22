// V2026-10-09 治本 (Visitor 子模块 — SPEC §11.1):
//   导出: VisitorService (供 VoiceService 注入, 编排 persona + LLM + history)
//   依赖: LlmModule (LlmService) + PersonaModule (PERSONA_REPOSITORY)
//   复用: ConfigModule (全局已注入)
//
//   反双胞胎:
//     - 不在 Module 里 import VoiceModule — 单向依赖, VoiceService 主动 import AgentModule
//     - 不引入 TypeOrmModule — V0.x 纯内存, V1.x 才接 persona 库
//
//   如何验证:
//     1. pnpm build 无 type error
//     2. VoiceService 注入 VisitorService 成功
//     3. VisitorService 注入 LlmService + PERSONA_REPOSITORY 成功

import { Module } from '@nestjs/common';

import { VisitorContextModule } from './visitor-context.module';
import { VisitorService } from './visitor.service';
import { LlmModule } from '../llm/llm.module';
import { PersonaModule } from '../persona/persona.module';

@Module({
  // V2026-10-21 治本 (V1.2 VS-B2 — 引入 @Global 上下文注册表模块):
  //   业务模块 (counselor) 靠它把会话级上下文挂进 visitor prompt, 而 agent 侧 0 处 import business.
  imports: [LlmModule, PersonaModule, VisitorContextModule],
  providers: [VisitorService],
  exports: [VisitorService],
})
export class VisitorModule {}
