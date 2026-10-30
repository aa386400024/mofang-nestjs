// V2026-10-09 治本 (Supervisor 子模块 — SPEC §11.2):
//   导出: SupervisorService (供 BullMQ worker 注入, 编排 transcript + LLM + 写库)
//   依赖: LlmModule (LlmService) + 自管 SUPERVISION_REPORT_REPOSITORY provider
//   复用: ConfigModule (全局已注入, 不要再 import)
//
//   反双胞胎:
//     - 不在 Module 里 import VoiceModule — 单向依赖, VoiceService 主动 import AgentModule
//     - 不让外部跨模块直连实体: 消费方只拿到**接口** (SupervisionReportRepository)
//
// V2026-10-26 治本 (spec 任务 6 — 报告落库):
//   ① 仓储从**内存**切真库 (`SupervisionReportRepositoryTypeorm`): 复盘报告是"训练完之后
//      才看"的东西, 放进程内存里 = 进程一重启就没了, 这个功能等于不成立.
//      内存实现保留 (单测用), 两者实现同一接口, 可互换.
//   ② **导出仓储 token** (原注释说"不 export 仓储 token — 不让外部跨模块直连"):
//      复盘报告的查询出口在 counselor 侧 (GET /counselor/supervision/report/:sessionId),
//      它要读的是**同一份**报告 —— 让 counselor 另写一套查询就是双份实现, 口径必然漂移.
//      导出的是**接口 token**, 消费方拿不到 entity / Repository, 跨模块边界仍然干净
//      (counselor → agent 是仓库允许的方向, 反向才成环).
//   ③ 引入 TypeOrmModule: 表由手写 DDL migration 建 (ADR-0003 禁用 synchronize).
//
//   如何验证:
//     1. pnpm build 无 type error
//     2. 启动后 AgentModule 包含 SupervisorService provider
//     3. 单元测试可 override SUPERVISION_REPORT_REPOSITORY provider 注入 mock

import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';

import { SupervisionReportRepositoryTypeorm } from './data/supervision-report.repository.typeorm';
import { SupervisionReportEntity } from './domain/entities/supervision-report.entity';
import { SUPERVISION_REPORT_REPOSITORY } from './domain/repositories/supervision-report.repository';
import { SUPERVISOR_LLM_PROFILE, readSupervisorLlmProfile } from './supervisor-llm.config';
import { SupervisorController } from './supervisor.controller';
import { SupervisorProcessor } from './supervisor.processor';
import { SupervisorService } from './supervisor.service';
// V2026-10-09 治本 (ESLint import/order 误报): sibling 全在前 + parent 在后, 跟 visitor.module.ts
//   风格一致. 但 ESLint 在 sibling/parent 混合 + alphabetize asc 场景下 cyclically 报不同 violation
//   (试过 4 种排序, 每种都报一条 sibling/parent 边界矛盾). 沿用 visitor.module.ts 风格, 单 import
//   inline disable 抑制. Fallback: ESLint 升级或换 import/resolver 修复后可删 disable 重 lint 验证.

import { LlmModule } from '../llm/llm.module';

@Module({
  // V2026-10-26 治本 (spec 任务 6): 注册督导报告实体 (表由手写 DDL migration 建).
  imports: [LlmModule, TypeOrmModule.forFeature([SupervisionReportEntity])],
  controllers: [SupervisorController],
  providers: [
    SupervisorService,
    SupervisorProcessor,
    {
      // V2026-10-26 治本: 内存 → 真库 (报告落库). 内存实现保留在 data/ 目录供单测替换.
      provide: SUPERVISION_REPORT_REPOSITORY,
      useClass: SupervisionReportRepositoryTypeorm,
    },
    {
      // V2026-10-29 治本 (WP18): 主报告专属 LLM 参数档 (思考深度 / 长度上限 / 超时).
      //   为什么走 useFactory 而不是类 provider: 档位来自 env (运维可调), 且**非法值要回落
      //   默认而不是让服务起不来** —— 报告生成是收尾环节, 不该成为启动的硬依赖.
      provide: SUPERVISOR_LLM_PROFILE,
      useFactory: (config: ConfigService) => readSupervisorLlmProfile(config),
      inject: [ConfigService],
    },
  ],
  exports: [SupervisorService, SupervisorProcessor, SUPERVISION_REPORT_REPOSITORY],
})
export class SupervisorModule {}
