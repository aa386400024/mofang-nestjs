import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';

import { FragmentsService } from './fragments.service';
import { ToolSkinDto, ToolSkinsListDto, UnlockSkinDto, UnlockSkinResponseDto } from '../dto/skin-pack.dto';
import { ToolSkinState } from '../entities/tool-skin-state.entity';
import { FragmentType } from '../enums/fragment-type.enum';
import { TOOL_SKIN_DEFS, ToolId, SkinRarity } from '../enums/skin-rarity.enum';

/**
 * 工具皮肤服务 — V4.0 §3.4.
 *
 * 行为:
 *   - listAvailable(userId, toolId): 该工具的全部皮肤 + 用户状态
 *   - unlock(userId, skinId): 碎片扣减 + 状态写
 *   - equip(userId, skinId): 同工具其他皮肤先 unequip, 再 equip 当前 (单事务)
 */
@Injectable()
export class ToolSkinsService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(ToolSkinState)
    private readonly repo: Repository<ToolSkinState>,
    private readonly fragmentsService: FragmentsService,
  ) {}

  async listAvailable(userId: string, toolId: ToolId): Promise<ToolSkinsListDto> {
    const defs = TOOL_SKIN_DEFS.filter((d) => d.toolId === toolId);
    const states = await this.repo.find({ where: { userId } });
    const stateMap = new Map<string, ToolSkinState>(states.map((s) => [s.skinId, s]));

    const skins: ToolSkinDto[] = defs.map((def) => {
      const state = stateMap.get(def.skinId);
      const unlocked = state !== undefined;
      const equipped = state?.equippedAt !== undefined && state?.equippedAt !== null;
      const available = !def.requiresMember; // V4.0 暂不做会员校验, 一律放开

      return {
        skinId: def.skinId,
        toolId: def.toolId,
        title: def.title,
        emoji: def.emoji,
        rarity: def.rarity,
        unlockCostFragments: def.unlockCostFragments,
        available,
        unlocked,
        equipped,
      };
    });

    const equippedSkin = skins.find((s) => s.equipped);
    return {
      toolId,
      skins,
      equippedSkinId: equippedSkin?.skinId ?? null,
    };
  }

  async unlock(userId: string, skinId: string, dto: UnlockSkinDto): Promise<UnlockSkinResponseDto> {
    const def = TOOL_SKIN_DEFS.find((d) => d.skinId === skinId);
    if (!def) {
      throw new NotFoundException(`unknown skinId: ${skinId}`);
    }
    if (def.rarity === SkinRarity.Default) {
      throw new BadRequestException('默认皮肤无需解锁');
    }

    const existing = await this.repo.findOne({ where: { userId, skinId } });
    if (existing) {
      throw new BadRequestException(`skin ${skinId} 已解锁`);
    }

    // 碎片扣减 (走 calm 默认池, V3.1 待办: 按 rarity 分池).
    const result = await this.fragmentsService.consume(
      userId,
      FragmentType.Calm,
      def.unlockCostFragments,
      'shop.skin.consume',
      { skinId, toolId: def.toolId },
      dto.idempotencyKey,
    );

    await this.repo.insert({
      userId,
      skinId,
      unlockedAt: new Date(),
      equippedAt: null,
      unlockSource: def.rarity,
    });

    return {
      skinId,
      spentFragments: def.unlockCostFragments,
      balances: result.balances,
    };
  }

  async equip(userId: string, skinId: string): Promise<ToolSkinDto> {
    const def = TOOL_SKIN_DEFS.find((d) => d.skinId === skinId);
    if (!def) {
      throw new NotFoundException(`unknown skinId: ${skinId}`);
    }

    return this.dataSource.transaction(async (tx) => {
      const repo = tx.getRepository(ToolSkinState);

      const state = await repo.findOne({ where: { userId, skinId } });
      if (!state) {
        throw new BadRequestException(`skin ${skinId} 未解锁`);
      }

      // 同工具下, 把其他装备的全部 unequip.
      const siblingSkins = TOOL_SKIN_DEFS.filter((d) => d.toolId === def.toolId).map((d) => d.skinId);
      await repo
        .createQueryBuilder()
        .update()
        .set({ equippedAt: null })
        .where('user_id = :userId', { userId })
        .andWhere('skin_id IN (:...siblingSkins)', { siblingSkins })
        .andWhere('equipped_at IS NOT NULL')
        .execute();

      state.equippedAt = new Date();
      await repo.save(state);

      return {
        skinId: def.skinId,
        toolId: def.toolId,
        title: def.title,
        emoji: def.emoji,
        rarity: def.rarity,
        unlockCostFragments: def.unlockCostFragments,
        available: true,
        unlocked: true,
        equipped: true,
      };
    });
  }
}
