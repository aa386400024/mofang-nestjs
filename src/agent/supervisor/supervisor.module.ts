// V2026-10-09 治本 (Supervisor 子模块 — SPEC §11.2):
//   导出: SupervisorService (供 BullMQ worker 注入, 编排 transcript + LLM + 写库)
//   依赖: LlmModule (LlmService) + 自管 SUPERVISION_REPORT_REPOSITORY provider
//   复用: ConfigModule (全局已注入, 不要再 import)
//
//   反双胞胎:
//     - 不在 Module 里 import VoiceModule — 单向依赖, VoiceService 主动 import AgentModule
//     - 不引入 TypeOrmModule — V0.x 纯内存, V1.x 才接 supervision_reports 表
//     - 不 export 仓储 token — 仓储是 SupervisorService 内部依赖, 不让外部跨模块直连
//
//   如何验证:
//     1. pnpm build 无 type error
//     2. 启动后 AgentModule 包含 SupervisorService provider
//     3. 单元测试可 override SUPERVISION_REPORT_REPOSITORY provider 注入 mock

import { Module } from '@nestjs/common';

import { SupervisionReportRepositoryMemory } from './data/supervision-report.repository.memory';
import { SUPERVISION_REPORT_REPOSITORY } from './domain/repositories/supervision-report.repository';
import { SupervisorProcessor } from './supervisor.processor';
import { SupervisorService } from './supervisor.service';
// V2026-10-09 治本 (ESLint import/order 误报): sibling 全在前 + parent 在后, 跟 visitor.module.ts
//   风格一致. 但 ESLint 在 sibling/parent 混合 + alphabetize asc 场景下 cyclically 报不同 violation
//   (试过 4 种排序, 每种都报一条 sibling/parent 边界矛盾). 沿用 visitor.module.ts 风格, 单 import
//   inline disable 抑制. Fallback: ESLint 升级或换 import/resolver 修复后可删 disable 重 lint 验证.

import { LlmModule } from '../llm/llm.module';

@Module({
  imports: [LlmModule],
  providers: [
    SupervisorService,
    SupervisorProcessor,
    {
      provide: SUPERVISION_REPORT_REPOSITORY,
      useClass: SupervisionReportRepositoryMemory,
    },
  ],
  exports: [SupervisorService, SupervisorProcessor],
})
export class SupervisorModule {}
