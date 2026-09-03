import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { EmbodiedModule } from '../embodied/embodied.module';
import { UserModule } from '../user/user.module';

import { PracticeCategoriesController } from './controllers/practice-categories.controller';
import { PracticeEmbodiedController } from './controllers/practice-embodied.controller';
import { PracticeGymController } from './controllers/practice-gym.controller';
import { PracticeRecordsController } from './controllers/practice-records.controller';
import { PracticeSessionsController } from './controllers/practice-sessions.controller';
import { PracticeToolsController } from './controllers/practice-tools.controller';

import { GymCurrentPlan } from './entities/gym-plan.entity';
import { PracticeRecord } from './entities/practice-record.entity';
import { PracticeSession } from './entities/practice-session.entity';
import { PracticeTool } from './entities/practice-tool.entity';
import { TargetedReshape } from './entities/targeted-reshape.entity';

import {
  PracticeCategoryService,
  PracticeToolService,
  PracticeSessionService,
  PracticeRecordService,
  PracticeGymService,
  TargetedReshapeService,
  PracticeEmbodiedService,
} from './providers/practice.service';

/**
 * Practice 模块 — 心塑「成长用户端」Tab2 练习 V2.0 (大厂企业级).
 *
 * 范围 (与前端 lib/features/practice 一一对应):
 *   - 8 大分类 (情绪急救/CBT/ACT/正念/DBT/发展/心理健身/具身)
 *   - 工具元数据 (30+ tools)
 *   - 心理健身房 (当前计划 / 进阶地图 / 基因报告 / 靶向重塑 / 训练记录)
 *   - 具身认知 (授权 + 工具列表 + 实时数据代理 /profile/embodied-data)
 *   - 练习会话生命周期 (start / complete + 反馈)
 *
 * V2.0 阶段:
 *   - 数据 99% sample (跟前端 InMemoryDataSource 对齐, 保证前后端走通)
 *   - 真实持久化字段已建好 (created_at / completed_at / duration 等), V3 接事件总线即可
 *   - 实体已声明 1:1 with TypeORM, Repository 注入标准大厂做法
 *
 * 反双胞胎:
 *   - 具身认知走 /practice/embodied/* 命名空间, 内部代理到 EmbodiedModule Service,
 *     不重复实现设备/权限管理逻辑 (复用 profile/embodied-data/* 实体)
 *   - 训练记录走 /practice/gym/records, 复用同一张 practice_records 表
 *     (不分 V1/V2 表 — 单源真相, 大厂 dashboard standard)
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([PracticeTool, PracticeSession, PracticeRecord, GymCurrentPlan, TargetedReshape]),
    UserModule,
    /**
     * V2026-09-01 治本 (反双胞胎):
     *   EmbodiedModule import 让 PracticeModule 可以复用 EmbodiedService
     *   (设备/权限 CRUD + V2 占位实时数据), 不重复实现.
     */
    EmbodiedModule,
  ],
  controllers: [
    PracticeCategoriesController,
    PracticeToolsController,
    PracticeSessionsController,
    PracticeGymController,
    PracticeRecordsController,
    PracticeEmbodiedController,
  ],
  providers: [
    PracticeCategoryService,
    PracticeToolService,
    PracticeSessionService,
    PracticeRecordService,
    PracticeGymService,
    TargetedReshapeService,
    PracticeEmbodiedService,
  ],
  exports: [
    PracticeCategoryService,
    PracticeToolService,
    PracticeSessionService,
    PracticeRecordService,
    PracticeGymService,
    TargetedReshapeService,
    PracticeEmbodiedService,
    // V2026-09-03 治本: 导出 TypeOrmModule 让下游模块 (如 InnerWorldModule 的
    // ReconciliationService) 可以注入 PracticeSession / PracticeRecord / 等
    // Repository — NestJS 跨模块共享 Repository 的标准模式 (Shared Modules).
    TypeOrmModule,
  ],
})
export class PracticeModule {}
