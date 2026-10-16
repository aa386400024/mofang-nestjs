// V2026-10-13 治本 (Phase 7.10 P0-2 — counselor.module.ts):
//   心理咨询师学员端 server module. 7.10 P0-2 加 training controller (thin delegate).
//
//   跟 home/ 模块风格一致:
//     - 1 module 容纳 counselor 端 5 Tab 所有 endpoint (V1.x 加 exam/growth/profile)
//     - V0.5 简化: 仅 home + training controller (P0-1 + P0-2 范围), V0.x 阶段不接数据库
//     - V1.x 改造: 接 training-sessions + ai-profile + voice-sessions 表
//
//   反双胞胎:
//     - 不复用 home/ 模块 (业务正交, counselor 端独立)
//     - 不在本模块引 emotion/ai-engine/gamification 跨模块 (V0.5 内聚, V1.x 拆)
//
// V2026-10-15 治本 (V1.x counselor-mode W1-2 — long-term-case 接入 + TypeOrmModule.forFeature):
//   原因: counselor-mode-v1.0 §6.1 拍板 long_term_cases + long_term_case_sessions 2 张表, V0.5
//     counselor module 5 controller 内存 mock, V1.x 接入 long-term-case controller 走真库
//     (V0.5 culture "V1.x 改造" 注释已留口子: "V1.x: TypeOrmModule.forFeature([TrainingSessionEntity, ...])").
//   修法:
//     - 引入 @nestjs/typeorm + LongTermCase / LongTermCaseSession entity
//     - imports 加 TypeOrmModule.forFeature([LongTermCase, LongTermCaseSession])
//     - controllers +1 (CounselorLongTermCaseController)
//     - providers +1 (LongTermCaseService)
//     - exports +1 (LongTermCaseService, 供后续 supervision W3-4 / ability W5-6 复用)
//   反双胞胎:
//     - 不复用 V0.5 5 service (业务正交, 跟 V0.5 culture "1 module 5 service 独立" 一致)
//     - 不引 AnalyticsModule / LlmModule (V1.x 阶段 long-term case 暂不接跨模块依赖,
//       V3.x W3-4 多流派督导接 LLM 时再 import, 防循环 + KISS)
//     - 不改 V0.5 已有 controller / service (1:1 wire 0 破坏 V0.x baseline)
//   验证:
//     1. tsc 0 错 (新加 entity 走 @nestjs/typeorm 注册, 跟 knowledge-base.module 同 pattern)
//     2. pnpm migration:run + curl 验 3 endpoint 端到端
//   时间戳: 2026-10-15

import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuthModule } from '../auth';
import { UserModule } from '../user';

// V2026-10-13 治本 (Phase 7.10 P0-2 — 加 training controller):
//   counselor 端 5 Tab 第 2 个 endpoint (跟 home 共用 CounselorHomeService 数据).
// V2026-10-13 治本 (Phase 7.10 P0-3 — 加 exam controller):
//   counselor 端 5 Tab 第 3 个 endpoint (题库, 跟 home/training 数据正交, 单独 service).
import { CounselorExamController } from './controllers/counselor-exam.controller';
// V2026-10-13 治本 (Phase 7.10 P0-4 — 加 growth controller):
//   counselor 端 5 Tab 第 4 个 endpoint (成长, 4 区块, 复用 home ability + weeklyProgress).
import { CounselorGrowthController } from './controllers/counselor-growth.controller';
import { CounselorHomeController } from './controllers/counselor-home.controller';
// V2026-10-15 治本 (V1.x W1-2 — long-term-case controller):
//   counselor 端第 6 个 controller (长程个案, 跟 home/training/exam/growth/profile 数据正交,
//   单独 service + 真接 TypeOrm 库).
// V2026-10-13 治本 (Phase 7.10 P0-5 — 加 profile controller):
//   counselor 端 5 Tab 第 5 个 endpoint (我的, 训练偏好 + 会员状态).
import { CounselorProfileController } from './controllers/counselor-profile.controller';
import { CounselorTrainingController } from './controllers/counselor-training.controller';
import { CounselorLongTermCaseController } from './controllers/long-term-case.controller';
// V2026-10-15 治本 (V1.x W1-2 — long-term-case entity 注册, 走 TypeOrmModule.forFeature):
//   跟 knowledge-base/knowledge-chunk.entity.ts V0.x 风格一致, 1:1 wire.
import { LongTermCaseSession } from './entities/long-term-case-session.entity';
import { LongTermCase } from './entities/long-term-case.entity';
// V2026-10-13 治本 (Phase 7.10 P0-3 — exam service):
//   跟 home/training 数据正交, 单独 service (4 大分类 + 11 卡片 + 3 KPI).
import { CounselorExamService } from './providers/counselor-exam.service';
// V2026-10-13 治本 (Phase 7.10 P0-4 — growth service):
//   复用 home service ability + weeklyProgress, 加 training records + wrong questions (V0.5 空数组).
import { CounselorGrowthService } from './providers/counselor-growth.service';
import { CounselorHomeService } from './providers/counselor-home.service';
// V2026-10-15 治本 (V1.x W1-2 — long-term-case service):
//   5 method 业务逻辑 (list / createFromPreset / findDetail / appendSession / listTemplates),
//   走真 TypeORM Repository, 跟 V0.5 5 service 内存 mock 区分.
// V2026-10-13 治本 (Phase 7.10 P0-5 — profile service):
//   训练偏好 (3 toggle + defaultDifficulty) + 会员状态 (V0.5 写死 none, V1.x 接 billing).
import { CounselorProfileService } from './providers/counselor-profile.service';
import { LongTermCaseService } from './providers/long-term-case.service';

/**
 * V2026-10-15 (V1.x counselor-mode W1-2 — CounselorModule):
 *   心理咨询师学员端 server module (跟 client counselor_* 5 Tab 1:1 对应).
 *
 *   跟 main_shell_page.dart V6.1 §2 counselorLearner 5 Tab (home/training/growth/exam/profile) 配套.
 *
 *   V0.5 P0-1: home overview 1 endpoint
 *   V0.5 P0-2: + training overview 1 endpoint (thin delegate)
 *   V0.5 P0-3/P0-4/P0-5: + exam / growth / profile 3 controller
 *   V1.x W1-2: + long-term-case controller (真接 TypeOrm, V0.5 5 controller 内存 mock 仍保留)
 *   V1.x W3-4: + supervision controller (待)
 *   V1.x W5-6: + ability-dimension controller (待)
 */
@Module({
  imports: [
    UserModule,
    AuthModule,
    // V0.5: 不接 TypeOrm (内存 mock)
    // V2026-10-15 治本 (V1.x W1-2 — long-term-case TypeOrmModule.forFeature):
    //   跟 knowledge-base.module.ts V0.x 风格一致, 注册 2 entity 供 LongTermCaseService 注入 Repository.
    TypeOrmModule.forFeature([LongTermCase, LongTermCaseSession]),
  ],
  controllers: [
    CounselorHomeController,
    CounselorTrainingController, // V2026-10-13 治本: P0-2 加 training controller
    CounselorExamController, // V2026-10-13 治本: P0-3 加 exam controller
    CounselorGrowthController, // V2026-10-13 治本: P0-4 加 growth controller
    CounselorProfileController, // V2026-10-13 治本: P0-5 加 profile controller
    CounselorLongTermCaseController, // V2026-10-15 治本: V1.x W1-2 加 long-term-case controller
  ],
  providers: [
    CounselorHomeService,
    CounselorExamService, // V2026-10-13 治本: P0-3 exam service
    CounselorGrowthService, // V2026-10-13 治本: P0-4 growth service
    CounselorProfileService, // V2026-10-13 治本: P0-5 profile service
    LongTermCaseService, // V2026-10-15 治本: V1.x W1-2 long-term-case service
  ],
  exports: [CounselorHomeService, CounselorExamService, CounselorGrowthService, CounselorProfileService, LongTermCaseService],
})
export class CounselorModule {}
