import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { ReconciliationService } from './reconciliation.service';
import { IslandElementDto, IslandElementsDto, GrowElementDto } from '../dto/island.dto';
import { IslandElement } from '../entities/island-element.entity';
import { ISLAND_ELEMENT_DEFS, IslandArea } from '../enums/island-area.enum';

/**
 * 小岛元素服务 — V4.0 §3.1.
 *
 * 行为:
 *   - list(userId): 返回全部 10 个元素 + 用户解锁/成长状态
 *   - unlock(userId, elementId): 解锁 (未解锁则插入, 已解锁幂等)
 *   - grow(userId, elementId, delta): 成长值 += delta, 自动 cap 到 growthMax
 *
 * 注意:
 *   - 解锁后会触发 reconciliation (IslandGardener 徽章)
 *   - 不做软删除, 元素是用户级持久化资产
 */
@Injectable()
export class IslandsService {
  constructor(
    @InjectRepository(IslandElement)
    private readonly repo: Repository<IslandElement>,
    private readonly reconciliationService: ReconciliationService,
  ) {}

  async list(userId: string): Promise<IslandElementsDto> {
    const rows = await this.repo.find({ where: { userId } });
    const map = new Map<string, IslandElement>(rows.map((r) => [r.elementId, r]));

    const elements: IslandElementDto[] = ISLAND_ELEMENT_DEFS.map((def) => {
      const state = map.get(def.elementId);
      return {
        elementId: def.elementId,
        area: def.area,
        title: def.title,
        emoji: def.emoji,
        kind: def.kind,
        growthValue: state?.growthValue ?? 0,
        growthMax: def.growthMax,
        unlockedAt: state?.unlockedAt.toISOString() ?? null,
      };
    });

    const byArea: Record<IslandArea, { total: number; unlocked: number }> = {
      [IslandArea.Beach]: { total: 0, unlocked: 0 },
      [IslandArea.Forest]: { total: 0, unlocked: 0 },
      [IslandArea.Foothill]: { total: 0, unlocked: 0 },
      [IslandArea.MountainTop]: { total: 0, unlocked: 0 },
    };

    for (const el of elements) {
      byArea[el.area].total += 1;
      if (el.unlockedAt) byArea[el.area].unlocked += 1;
    }

    return { elements, byArea };
  }

  async unlock(userId: string, elementId: string): Promise<IslandElementDto> {
    const def = ISLAND_ELEMENT_DEFS.find((d) => d.elementId === elementId);
    if (!def) {
      throw new NotFoundException(`unknown elementId: ${elementId}`);
    }

    const existing = await this.repo.findOne({ where: { userId, elementId } });
    if (!existing) {
      await this.repo.insert({
        userId,
        elementId,
        unlockedAt: new Date(),
        growthValue: 0,
        placedX: null,
        placedY: null,
      });
      // 触发 reconciliation (IslandGardener 徽章检查)
      await this.reconciliationService.reconcile(userId);
    }

    return this.mapDto(def, await this.repo.findOneOrFail({ where: { userId, elementId } }));
  }

  async grow(userId: string, elementId: string, dto: GrowElementDto): Promise<IslandElementDto> {
    const def = ISLAND_ELEMENT_DEFS.find((d) => d.elementId === elementId);
    if (!def) {
      throw new NotFoundException(`unknown elementId: ${elementId}`);
    }

    const delta = dto.delta ?? 10;
    const existing = await this.repo.findOne({ where: { userId, elementId } });
    if (!existing) {
      throw new NotFoundException(`element ${elementId} 尚未解锁`);
    }

    existing.growthValue = Math.min(existing.growthValue + delta, def.growthMax);
    await this.repo.save(existing);

    return this.mapDto(def, existing);
  }

  private mapDto(def: (typeof ISLAND_ELEMENT_DEFS)[number], row: IslandElement): IslandElementDto {
    return {
      elementId: def.elementId,
      area: def.area,
      title: def.title,
      emoji: def.emoji,
      kind: def.kind,
      growthValue: row.growthValue,
      growthMax: def.growthMax,
      unlockedAt: row.unlockedAt.toISOString(),
    };
  }
}
