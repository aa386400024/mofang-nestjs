import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { HomeCompanionOverviewController } from './controllers/home-companion-overview.controller';
import { CompanionBinding } from '../profile/entities/companion-binding.entity';
import { UserProfile } from '../profile/entities/user-profile.entity';
import { ProfileModule } from '../profile/profile.module';
import { User } from '../user/entities/user.entity';
import { UserModule } from '../user/user.module';

import { HomeCompanionController } from './controllers/home-companion.controller';
import { HomeMessagesController } from './controllers/home-messages.controller';
import { HomeMicroInterventionController } from './controllers/home-micro-intervention.controller';
import { HomeOverviewController } from './controllers/home-overview.controller';
import { HomeMessage } from './entities/home-message.entity';
import { MicroInterventionConfig } from './entities/micro-intervention-config.entity';
import { MicroInterventionHistory } from './entities/micro-intervention-history.entity';
import { MoodLog } from './entities/mood-log.entity';
import { HomeCompanionService } from './providers/home-companion.service';
import { HomeMessagesService } from './providers/home-messages.service';
import { HomeMicroInterventionService } from './providers/home-micro-intervention.service';
import { HomeMoodLogService } from './providers/home-mood-log.service';
import { HomeOverviewService } from './providers/home-overview.service';
import { HomeRecommendationEngine } from './providers/home-recommendation.engine';

/**
 * Home module — 心塑「首页」V2.0 模块 (大厂企业级).
 *
 * 范围:
 *   - 成长用户端 Tab1 (greeting / 情绪 / 微干预 / 推荐 / 陪伴者 / 消息)
 *   - 陪伴者端 Tab1 (小贴士 / 被陪伴者状态 / 工具箱 / 自我关怀 / 双人协同)
 *   - 共享后端基建 (recommendation engine / mood logs / message count)
 *
 * 设计要点:
 *   - 1 module 容纳双角色首页 (大厂: 业务相关性 > 角色分类)
 *   - 全 entity 走 TypeOrmModule.forFeature (V3 升级零结构改动)
 *   - ProfileModule / UserModule 提供 binding + user + profile 数据
 *   - 12 endpoint 全部 JwtAuthGuard + @CurrentUser 注入 uid
 *   - 决策树 100% 服务端 (微干预触发 / 推荐匹配 / 权限过滤)
 *
 * V3 计划:
 *   - 接入 LLM 个性化推荐 + 微干预文案
 *   - 接 WS 推送: 双人协同 ready 握手 / 微干预实时同步
 *   - 频控去重: 1 分钟内同 trigger 不重复弹
 *   - A/B test: 多套 recommendation engine 切换
 */
@Module({
  imports: [
    /**
     * 大厂治本 (NestJS DI 关键点):
     *   `TypeOrmModule.forFeature()` 注册的 repository 是 **模块私有** 的 —
     *   即使 HomeModule imports 了 ProfileModule, ProfileModule 内的 repository
     *   也不能直接注入到 HomeModule 的 service 里.
     *
     *   解法 2 选 1:
     *     (A) 在本模块 `forFeature` 里重新声明需要的 entity (本代码采用)
     *     (B) ProfileModule `exports` 这些 entity 的 service (但这层封装过重)
     *
     *   大厂 standard (NestJS 官方): 选 A — 显式声明本模块依赖的 entity,
     *   让 DI 关系明确, 方便后续单独测试.
     *
     *   注意: `User` entity 也得加, 因为 HomeOverviewService 用 `UserRepository`
     *   拿 user.phone / user.email 兜底昵称.
     */
    TypeOrmModule.forFeature([
      // 本模块自有 entity (4 张表)
      MoodLog,
      MicroInterventionConfig,
      MicroInterventionHistory,
      HomeMessage,
      // 跨模块 entity — 必须显式 forFeature, NestJS DI 不会跨模块传递 repository
      CompanionBinding,
      UserProfile,
      User,
    ]),
    UserModule,
    ProfileModule,
  ],
  controllers: [
    HomeOverviewController,
    HomeMicroInterventionController,
    HomeMessagesController,
    HomeCompanionOverviewController,
    HomeCompanionController,
  ],
  providers: [
    HomeOverviewService,
    HomeMoodLogService,
    HomeMicroInterventionService,
    HomeMessagesService,
    HomeCompanionService,
    HomeRecommendationEngine,
  ],
  exports: [
    HomeOverviewService,
    HomeMoodLogService,
    HomeMicroInterventionService,
    HomeMessagesService,
    HomeCompanionService,
    HomeRecommendationEngine,
  ],
})
export class HomeModule {}
