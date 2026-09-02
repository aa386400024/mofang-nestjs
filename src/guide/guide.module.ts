import { Module } from '@nestjs/common';

import { UserModule } from '../user/user.module';

import { GuideController } from './controllers/guide.controller';
import { GuideService } from './providers/guide.service';

/**
 * 陪伴者端「指南」Tab 模块 — V3.0 §4 Tab3.
 *
 * V3.0 范围:
 *   - 静态课程库 (12 门) — 不依赖外部 AI / RAG
 *   - 学习进度 / 笔记 / 收藏 — 内存态 (V3.0 简化)
 *
 * V3.0 治本:
 *   - UserModule 注入 CurrentUser (uid)
 *   - 不依赖 TypeORM (内存态), V3.1 升级再接
 *   - 模块边界独立: 跟 PracticeModule / CompanionModule 解耦
 */
@Module({
  imports: [UserModule],
  controllers: [GuideController],
  providers: [GuideService],
  exports: [GuideService],
})
export class GuideModule {}
