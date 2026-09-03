import { IsISO8601, IsOptional } from 'class-validator';

import { BadgeStateDto } from './badge.dto';
import { FragmentBalanceItemDto } from './fragment.dto';
import { IslandElementDto } from './island.dto';
import { ThemePackDto, ToolSkinDto } from './skin-pack.dto';

/**
 * 冷启动聚合接口 — 前端打开内心世界时, 1 次拉全量.
 *
 * 设计动机:
 *   - 避免 N 次串行请求 (碎片 + 徽章 + 小岛 + 皮肤 + 主题包...)
 *   - 给前端完整 snapshot, 让 inner_world_sheet 立刻可渲染
 *   - 增量更新走各自专项接口 (grant/consume/unlock...)
 */
export class BootstrapQueryDto {
  /** ISO-8601. 若客户端有旧数据, 只返回增量 (server 比对后跳过未变更). */
  @IsOptional()
  @IsISO8601()
  since?: string;
}

export class BootstrapDto {
  /** 服务端本次响应时间, 客户端用作下次 since. */
  fetchedAt!: string;

  fragments!: {
    balances: FragmentBalanceItemDto[];
    total: number;
  };

  badges!: {
    all: BadgeStateDto[];
    unlockedCount: number;
    pendingUnlockIds: string[];
  };

  islands!: {
    elements: IslandElementDto[];
    byArea: Record<string, { total: number; unlocked: number }>;
  };

  toolSkins!: {
    byTool: Record<string, { skins: ToolSkinDto[]; equippedSkinId: string | null }>;
  };

  themePacks!: {
    packs: ThemePackDto[];
    activePackId: string | null;
  };

  decorations!: {
    owned: {
      decorationId: string;
      title: string;
      emoji: string;
      kind: string;
      placedArea: string | null;
    }[];
  };
}
