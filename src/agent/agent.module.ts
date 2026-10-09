// V2026-10-09 治本 (Agent 根模块):
//   V0.x Phase 1.1: LlmModule
//   V0.x Phase 4:   PersonaModule + VisitorModule (Visitor Agent)
//   V0.x Phase 5:   SupervisorModule (Supervisor Agent, 督导报告异步)
//
//   反双胞胎:
//     - 不在 AgentModule 直接 import VoiceModule / TrainingModule —
//       保持单向依赖, 业务模块可单独 import AgentModule
//     - 不 export AgentModule 内的 service — 让消费方 import 具体子模块, 接口稳定

import { Module } from '@nestjs/common';

import { LlmModule } from './llm/llm.module';
import { PersonaModule } from './persona/persona.module';
import { VisitorModule } from './visitor/visitor.module';

@Module({
  imports: [LlmModule, PersonaModule, VisitorModule],
  // re-export 子模块 — 让 VoiceModule 等消费方 import AgentModule 后
  //   就能拿到 VisitorService / LlmService / PERSONA_REPOSITORY
  //   无需 import 多个子模块, 接口稳定
  exports: [LlmModule, PersonaModule, VisitorModule],
})
export class AgentModule {}
