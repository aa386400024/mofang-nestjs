import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { CompanionBinding } from '../profile/entities/companion-binding.entity.js';
import { CompanionRecord as ProfileCompanionRecord } from '../profile/entities/companion-record.entity.js';
import { ProfileModule } from '../profile/profile.module.js';
import { UserModule } from '../user/user.module.js';

import { CompanionTreeModule } from './companion-tree/companion-tree.module.js';

import { AiGuideController } from './controllers/ai-guide.controller.js';
import { CompanionPersonsController } from './controllers/companion-persons.controller.js';
import { CompanionRecordsController } from './controllers/companion-records.controller.js';
import { DualExerciseController } from './controllers/dual-exercise.controller.js';
import { RehabController } from './controllers/rehab.controller.js';
import { RelationsController } from './controllers/relations.controller.js';
import { SoothingController } from './controllers/soothing.controller.js';
import { SyncPracticeController } from './controllers/sync-practice.controller.js';
import { DualPuzzleModule } from './dual-puzzle/dual-puzzle.module.js';

import { DualExercise } from './entities/dual-exercise.entity.js';
import { DualSession } from './entities/dual-session.entity.js';
import { RehabItem } from './entities/rehab-item.entity.js';
import { SoothingCard } from './entities/soothing-card.entity.js';
import { SyncPractice } from './entities/sync-practice.entity.js';

import {
  AiGuideService,
  CompanionRecordService,
  CompanionPersonsService,
  DualExerciseService,
  RehabService,
  RelationsService,
  SoothingService,
  SyncPracticeService,
} from './providers/companion.service.js';

/**
 * Companion 模块 — 心塑「陪伴者端」Tab2 陪伴 V2.0 (大厂企业级).
 *
 * 范围 (与前端 lib/features/companion 一一对应):
 *   - 顶部陪伴对象切换 (persons + switch)
 *   - 8 大分区: 安抚卡片 / 同步练习 / 双人协同 / 康复协同(L3) / 陪伴记录 / AI 指引 / 关系管理
 *
 * V2.0 阶段:
 *   - 全部 sample 数据 (跟前端 InMemoryDataSource 对齐)
 *   - 实体 1:1 with TypeORM (后续 V3 接事件总线即可)
 *
 * 反双胞胎 (关键):
 *   - 关系管理复用 profile/CompanionBinding entity — 不重复建 binding 表
 *   - 陪伴记录复用 profile/CompanionRecord entity — 不重复建 records 表
 *   - 双人协同练习库代理 home-companion.service.listDualPractices — 不重写 listDualPractices
 *   - daily-tip / panic-check 复用 home-companion controller, 这里不重复暴露
 *
 * 设计要点:
 *   - ProfileModule + UserModule 注入 (拿 binding / record / user 信息)
 *   - 8 个 controller 独立拆分 (大厂 ≤300 行约束), 共用 1 个 service 树 (按子领域分组)
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      // 本模块自有 entity (5 张表)
      SoothingCard,
      SyncPractice,
      DualExercise,
      DualSession,
      RehabItem,
      // 跨模块 entity — 必须显式 forFeature, NestJS DI 不跨模块传递 repository
      CompanionBinding,
      ProfileCompanionRecord,
    ]),
    UserModule,
    ProfileModule,
    // V6.0 §6.3 共种陪伴树 + §6.4 默契拼图 (新增子模块)
    CompanionTreeModule,
    DualPuzzleModule,
  ],
  controllers: [
    CompanionPersonsController,
    SoothingController,
    SyncPracticeController,
    DualExerciseController,
    RehabController,
    CompanionRecordsController,
    AiGuideController,
    RelationsController,
  ],
  providers: [
    CompanionPersonsService,
    SoothingService,
    SyncPracticeService,
    DualExerciseService,
    RehabService,
    CompanionRecordService,
    AiGuideService,
    RelationsService,
  ],
  exports: [
    CompanionPersonsService,
    SoothingService,
    SyncPracticeService,
    DualExerciseService,
    RehabService,
    CompanionRecordService,
    AiGuideService,
    RelationsService,
  ],
})
export class CompanionModule {}
