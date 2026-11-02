import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { PracticeModule } from '../practice/practice.module';
import { UserModule } from '../user/user.module';

import { BadgesController } from './controllers/badges.controller';
import { BootstrapController } from './controllers/bootstrap.controller';
import { DecorationsController } from './controllers/decorations.controller';
import { FragmentsController } from './controllers/fragments.controller';
import { IslandsController } from './controllers/islands.controller';
import { ThemePacksController } from './controllers/theme-packs.controller';
import { ToolSkinsController } from './controllers/tool-skins.controller';

import { BadgeState } from './entities/badge-state.entity';
import { FragmentLog } from './entities/fragment-log.entity';
import { IslandDecoration } from './entities/island-decoration.entity';
import { IslandElement } from './entities/island-element.entity';
import { ThemePackState } from './entities/theme-pack-state.entity';
import { ToolSkinState } from './entities/tool-skin-state.entity';

import { BadgesService } from './providers/badges.service';
import { DecorationsService } from './providers/decorations.service';
import { FragmentsService } from './providers/fragments.service';
import { IslandsService } from './providers/islands.service';
import { ReconciliationService } from './providers/reconciliation.service';
import { ThemePacksService } from './providers/theme-packs.service';
import { ToolSkinsService } from './providers/tool-skins.service';

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
