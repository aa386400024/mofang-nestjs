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

import { Module } from '@nestjs/common';

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
// V2026-10-13 治本 (Phase 7.10 P0-5 — 加 profile controller):
//   counselor 端 5 Tab 第 5 个 endpoint (我的, 训练偏好 + 会员状态).
import { CounselorProfileController } from './controllers/counselor-profile.controller';
import { CounselorTrainingController } from './controllers/counselor-training.controller';
// V2026-10-13 治本 (Phase 7.10 P0-3 — exam service):
//   跟 home/training 数据正交, 单独 service (4 大分类 + 11 卡片 + 3 KPI).
import { CounselorExamService } from './providers/counselor-exam.service';
// V2026-10-13 治本 (Phase 7.10 P0-4 — growth service):
//   复用 home service ability + weeklyProgress, 加 training records + wrong questions (V0.5 空数组).
import { CounselorGrowthService } from './providers/counselor-growth.service';
import { CounselorHomeService } from './providers/counselor-home.service';
// V2026-10-13 治本 (Phase 7.10 P0-5 — profile service):
//   训练偏好 (3 toggle + defaultDifficulty) + 会员状态 (V0.5 写死 none, V1.x 接 billing).
import { CounselorProfileService } from './providers/counselor-profile.service';

/**
 * V2026-10-13 (Phase 7.10 P0-2 — CounselorModule):
 *   心理咨询师学员端 server module (跟 client counselor_* 5 Tab 1:1 对应).
 *
 *   跟 main_shell_page.dart V6.1 §2 counselorLearner 5 Tab (home/training/growth/exam/profile) 配套.
 *
 *   V0.5 P0-1: home overview 1 endpoint
 *   V0.5 P0-2: + training overview 1 endpoint (thin delegate)
 *   V1.x: 加 exam, growth, profile 3 子 controller + 接数据库
 */
@Module({
  imports: [
    UserModule,
    AuthModule,
    // V0.5: 不接 TypeOrm (内存 mock)
    // V1.x: TypeOrmModule.forFeature([TrainingSessionEntity, ...])
  ],
  controllers: [
    CounselorHomeController,
    CounselorTrainingController, // V2026-10-13 治本: P0-2 加 training controller
    CounselorExamController, // V2026-10-13 治本: P0-3 加 exam controller
    CounselorGrowthController, // V2026-10-13 治本: P0-4 加 growth controller
    CounselorProfileController, // V2026-10-13 治本: P0-5 加 profile controller
  ],
  providers: [
    CounselorHomeService,
    CounselorExamService, // V2026-10-13 治本: P0-3 exam service
    CounselorGrowthService, // V2026-10-13 治本: P0-4 growth service
    CounselorProfileService, // V2026-10-13 治本: P0-5 profile service
  ],
  exports: [CounselorHomeService, CounselorExamService, CounselorGrowthService, CounselorProfileService],
})
export class CounselorModule {}
