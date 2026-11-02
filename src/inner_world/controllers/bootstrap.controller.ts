import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../../user/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../user/guards/jwt-auth.guard';

import { BootstrapDto, BootstrapQueryDto } from '../dto/bootstrap.dto';
import { ToolId } from '../enums/skin-rarity.enum';
import { BadgesService } from '../providers/badges.service';
import { DecorationsService } from '../providers/decorations.service';
import { FragmentsService } from '../providers/fragments.service';
import { IslandsService } from '../providers/islands.service';
import { ThemePacksService } from '../providers/theme-packs.service';
import { ToolSkinsService } from '../providers/tool-skins.service';

/**
 * 冷启动聚合接口 — V4.0 §3 整体.
 *
 *   GET /inner-world/bootstrap?since=ISO
 *
 * 设计动机:
 *   - 避免前端打开内心世界时 N 次串行请求
 *   - 给前端完整 snapshot, inner_world_sheet 立即可渲染
 *   - 后续增量走专项接口
 *
 * 性能:
 *   - V4.0 阶段: 6 个 service 串行调用 (实现简单), 后续接 Promise.all
 *   - 客户端带 since 时可走"服务端比对后跳过未变更字段" (V3 优化, 现在先全量)
 */
@ApiTags('inner-world/bootstrap')
@Controller('inner-world/bootstrap')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class BootstrapController {
  constructor(
    private readonly fragmentsService: FragmentsService,
    private readonly badgesService: BadgesService,
    private readonly islandsService: IslandsService,
    private readonly decorationsService: DecorationsService,
    private readonly toolSkinsService: ToolSkinsService,
    private readonly themePacksService: ThemePacksService,
  ) {}

  @Get()
  @ApiOperation({ summary: '内心世界冷启动聚合数据' })
  async bootstrap(@CurrentUser() user: { userId: string }, @Query() _query: BootstrapQueryDto): Promise<BootstrapDto> {
    const userId = user.userId;

    // 并行拉 6 个域 (互不依赖)
    const [fragmentBalances, badges, islands, decorations, themePacks] = await Promise.all([
      this.fragmentsService.getBalances(userId),
      this.badgesService.list(userId),
      this.islandsService.list(userId),
      this.decorationsService.list(userId),
      this.themePacksService.list(userId),
    ]);

    // 工具皮肤按工具枚举 (已知 6 个工具)
    const toolIds = Object.values(ToolId) as ToolId[];
    const toolSkinLists = await Promise.all(toolIds.map((toolId) => this.toolSkinsService.listAvailable(userId, toolId)));
    const byTool: Record<string, { skins: (typeof toolSkinLists)[0]['skins']; equippedSkinId: string | null }> = {};
    for (const list of toolSkinLists) {
      byTool[list.toolId] = {
        skins: list.skins,
        equippedSkinId: list.equippedSkinId,
      };
    }

    return {
      fetchedAt: new Date().toISOString(),
      fragments: {
        balances: fragmentBalances,
        total: fragmentBalances.reduce((s, b) => s + b.balance, 0),
      },
      badges: {
        all: badges.badges,
        unlockedCount: badges.unlockedCount,
        pendingUnlockIds: badges.pendingUnlockIds,
      },
      islands: {
        elements: islands.elements,
        byArea: islands.byArea,
      },
      toolSkins: { byTool },
      themePacks: {
        packs: themePacks.packs,
        activePackId: themePacks.activePackId,
      },
      decorations: {
        owned: decorations
          .filter((d) => d.owned)
          .map((d) => ({
            decorationId: d.decorationId,
            title: d.title,
            emoji: d.emoji,
            kind: d.kind,
            placedArea: d.placedArea,
          })),
      },
    };
  }
}
