import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { UserModule } from '../user/user.module';

import { GoodStateDiaryAiController } from './controllers/good-state-diary-ai.controller';
import { GoodStateDiaryController } from './controllers/good-state-diary.controller';
import { GoodStateDiaryEntry } from './entities/good-state-diary-entry.entity';
import { GoodStateDiaryAiService } from './providers/good-state-diary-ai.service';
import { GoodStateDiaryService } from './providers/good-state-diary.service';

/**
 * V2026-09-11 治本 (好状态日记 · 模块):
 *   范围 (跟前端 lib/features/good_state_diary 一一对应):
 *     - 9 个 REST 端点 (/diary/entries/*): CRUD + 软删/恢复/草稿箱/搜索/物理擦除
 *     - 1 个 AI 端点 (/ai/diary-feedback): metadata-only 生成
 *     - 1 张表 (good_state_diary_entries), 软删 + 30 天物理擦除
 *
 *   依赖:
 *     - UserModule: 提供 JwtAuthGuard (全 controller 用)
 *     - TypeOrmModule.forFeature: 注册 GoodStateDiaryEntry Repository
 *
 *   反双胞胎:
 *     - 不依赖 ai-engine 模块 (P0 用启发式 stub, V3 接 LLM 时注入 LlmOrchestratorService)
 *     - 不依赖 inner-world 模块 (日记流水不参与碎片统计)
 *     - 不依赖 practice 模块 (P0 linked_practice_id 是弱关联字符串, V3 接 practice 后建 FK)
 *
 *   导出:
 *     - GoodStateDiaryService: 给可能的 V3 模块 (e.g. growth / dashboard) 复用查日记的能力
 *     - 不导出 AI service: AI 反馈是日记专属, 不外暴露
 */
@Module({
  imports: [TypeOrmModule.forFeature([GoodStateDiaryEntry]), UserModule],
  controllers: [GoodStateDiaryController, GoodStateDiaryAiController],
  providers: [GoodStateDiaryService, GoodStateDiaryAiService],
  exports: [GoodStateDiaryService],
})
export class GoodStateDiaryModule {}
