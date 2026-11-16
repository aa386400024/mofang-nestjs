import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { PracticeModule } from '../practice/practice.module.js';
import { UserModule } from '../user/user.module.js';

import { BadgesController } from './controllers/badges.controller.js';
import { BootstrapController } from './controllers/bootstrap.controller.js';
import { DecorationsController } from './controllers/decorations.controller.js';
import { FragmentsController } from './controllers/fragments.controller.js';
import { IslandsController } from './controllers/islands.controller.js';
import { ThemePacksController } from './controllers/theme-packs.controller.js';
import { ToolSkinsController } from './controllers/tool-skins.controller.js';

import { BadgeState } from './entities/badge-state.entity.js';
import { FragmentLog } from './entities/fragment-log.entity.js';
import { IslandDecoration } from './entities/island-decoration.entity.js';
import { IslandElement } from './entities/island-element.entity.js';
import { ThemePackState } from './entities/theme-pack-state.entity.js';
import { ToolSkinState } from './entities/tool-skin-state.entity.js';

import { BadgesService } from './providers/badges.service.js';
import { DecorationsService } from './providers/decorations.service.js';
import { FragmentsService } from './providers/fragments.service.js';
import { IslandsService } from './providers/islands.service.js';
import { ReconciliationService } from './providers/reconciliation.service.js';
import { ThemePacksService } from './providers/theme-packs.service.js';
import { ToolSkinsService } from './providers/tool-skins.service.js';

/**
 * Inner World 模块 — V4.0 §3 完整游戏化核心层.
 *
 * 范围 (与前端 lib/features/inner_world 一一对应):
 *   - §3.1 内心小岛成长系统 — 4 区 × 10 元素 (IslandsService)
 *   - §3.2 心理碎片收集系统 — 5 类型 + 流水 + 兑换 (FragmentsService)
 *   - §3.3 里程碑徽章系统 — 9 个核心 + reconcile 自动检测 (BadgesService)
 *   - §3.4 工具皮肤 + 主题包 — 定义内置 + 用户状态 (ToolSkinsService / ThemePacksService)
 *
 * 跨模块:
 *   - FragmentsService 是核心, 其他 service 调它的 grant/consume
 *   - ReconciliationService 调 BadgesService bulkInsertUnlocks + 拉 PracticeSession
 *   - 主题包/皮肤/装饰的兑换都走 FragmentsService.consume
 *
 * 依赖:
 *   - PracticeModule — ReconciliationService 读 practice_sessions 表判徽章规则
 *   - JwtAuthGuard — 由 base/auth 提供, 全 controller 用
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([FragmentLog, BadgeState, IslandElement, IslandDecoration, ToolSkinState, ThemePackState]),
    // V2026-09-03 治本: UserModule 提供 JwtAuthGuard + JwtService + JwtBlacklistService
    // (注册在 UserModule 的 providers, 且 UserModule 已经导出 JwtModule).
    // 所有 controller 用了 @UseGuards(JwtAuthGuard), 不 import 拿不到依赖.
    UserModule,
    PracticeModule, // 注入 ReconciliationService 读 PracticeSession
  ],
  controllers: [
    FragmentsController,
    BadgesController,
    IslandsController,
    DecorationsController,
    ToolSkinsController,
    ThemePacksController,
    BootstrapController,
  ],
  providers: [
    FragmentsService,
    BadgesService,
    IslandsService,
    DecorationsService,
    ToolSkinsService,
    ThemePacksService,
    ReconciliationService,
  ],
  exports: [
    FragmentsService,
    BadgesService,
    IslandsService,
    DecorationsService,
    ToolSkinsService,
    ThemePacksService,
    ReconciliationService,
  ],
})
export class InnerWorldModule {}
