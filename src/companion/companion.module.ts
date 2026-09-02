import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { CompanionBinding } from '../profile/entities/companion-binding.entity';
import { CompanionRecord as ProfileCompanionRecord } from '../profile/entities/companion-record.entity';
import { ProfileModule } from '../profile/profile.module';
import { UserModule } from '../user/user.module';

import { AiGuideController } from './controllers/ai-guide.controller';
import { CompanionPersonsController } from './controllers/companion-persons.controller';
import { CompanionRecordsController } from './controllers/companion-records.controller';
import { DualExerciseController } from './controllers/dual-exercise.controller';
import { RehabController } from './controllers/rehab.controller';
import { RelationsController } from './controllers/relations.controller';
import { SoothingController } from './controllers/soothing.controller';
import { SyncPracticeController } from './controllers/sync-practice.controller';

import { DualExercise } from './entities/dual-exercise.entity';
import { DualSession } from './entities/dual-session.entity';
import { RehabItem } from './entities/rehab-item.entity';
import { SoothingCard } from './entities/soothing-card.entity';
import { SyncPractice } from './entities/sync-practice.entity';

import {
  AiGuideService,
  CompanionRecordService,
  CompanionPersonsService,
  DualExerciseService,
  RehabService,
  RelationsService,
  SoothingService,
  SyncPracticeService,
} from './providers/companion.service';

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
