import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';

import { FragmentsService } from './fragments.service';
import { ThemePackDto, ThemePacksListDto } from '../dto/skin-pack.dto';
import { ThemePackState } from '../entities/theme-pack-state.entity';
import { FragmentType } from '../enums/fragment-type.enum';
import { THEME_PACK_DEFS, ThemePackDef, SkinRarity } from '../enums/skin-rarity.enum';

/**
 * 主题包服务 — V4.0 §3.4.
 *
 * 跟 tool-skins 不同:
 *   - 主题包是 app 全局 (一次只 1 个 active)
 *   - 同一用户对同一 pack 只有一行 (unique)
 */
@Injectable()
export class ThemePacksService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(ThemePackState)
    private readonly repo: Repository<ThemePackState>,
    private readonly fragmentsService: FragmentsService,
  ) {}

  async list(userId: string): Promise<ThemePacksListDto> {
    const states = await this.repo.find({ where: { userId } });
    const stateMap = new Map<string, ThemePackState>(states.map((s) => [s.packId, s]));

    const packs: ThemePackDto[] = THEME_PACK_DEFS.map((def) => {
      const state = stateMap.get(def.packId);
      return {
        packId: def.packId,
        title: def.title,
        emoji: def.emoji,
        rarity: def.rarity,
        unlockCostFragments: def.unlockCostFragments,
        available: !def.requiresMember,
        unlocked: state !== undefined,
        active: state?.activeAt !== undefined && state?.activeAt !== null,
        previewTokens: def.previewTokens,
      };
    });

    const active = packs.find((p) => p.active);
    return {
      packs,
      activePackId: active?.packId ?? null,
    };
  }

  async unlock(userId: string, packId: string): Promise<ThemePackDto> {
    if (!THEME_PACK_DEFS.some((d) => d.packId === packId)) {
      throw new NotFoundException(`unknown packId: ${packId}`);
    }
    const def = THEME_PACK_DEFS.find((d) => d.packId === packId)!;
    if (def.rarity === SkinRarity.Default) {
      throw new BadRequestException('默认主题无需解锁');
    }
    const existing = await this.repo.findOne({ where: { userId, packId } });
    if (existing) {
      throw new BadRequestException(`pack ${packId} 已解锁`);
    }

    await this.fragmentsService.consume(userId, FragmentType.Calm, def.unlockCostFragments, 'shop.theme.consume', { packId });

    await this.repo.insert({
      userId,
      packId,
      unlockedAt: new Date(),
      activeAt: null,
      unlockSource: def.rarity,
    });

    return this.mapDto(def, await this.repo.findOneOrFail({ where: { userId, packId } }));
  }

  async activate(userId: string, packId: string): Promise<ThemePacksListDto> {
    if (!THEME_PACK_DEFS.some((d) => d.packId === packId)) {
      throw new NotFoundException(`unknown packId: ${packId}`);
    }

    await this.dataSource.transaction(async (tx) => {
      const repo = tx.getRepository(ThemePackState);

      // 1. 校验已解锁
      const state = await repo.findOne({ where: { userId, packId } });
      if (!state) {
        throw new BadRequestException(`pack ${packId} 未解锁`);
      }

      // 2. 把所有已激活的清掉
      await repo
        .createQueryBuilder()
        .update()
        .set({ activeAt: null })
        .where('user_id = :userId', { userId })
        .andWhere('active_at IS NOT NULL')
        .execute();

      // 3. 当前包激活
      state.activeAt = new Date();
      await repo.save(state);
    });

    return this.list(userId);
  }

  private mapDto(def: ThemePackDef, row: ThemePackState): ThemePackDto {
    return {
      packId: def.packId,
      title: def.title,
      emoji: def.emoji,
      rarity: def.rarity,
      unlockCostFragments: def.unlockCostFragments,
      available: !def.requiresMember,
      unlocked: true,
      active: row.activeAt !== null,
      previewTokens: def.previewTokens,
    };
  }
}
