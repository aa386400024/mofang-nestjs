import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { FragmentsService } from './fragments.service';
import { DecorationDto, PlaceDecorationDto, PurchaseDecorationDto, PurchaseDecorationResponseDto } from '../dto/island.dto';
import { IslandDecoration } from '../entities/island-decoration.entity';
import { FragmentType } from '../enums/fragment-type.enum';
import { DECORATION_DEFS } from '../enums/island-area.enum';

/**
 * 装饰服务 — V4.0 §3.2.
 *
 * 业务规则:
 *   - purchase: 校验定义存在 → 调用 fragments.consume 扣减 → 插入 user_decoration 行
 *   - place: 校验已拥有 → 更新 placed_area + placed_x/y
 *   - remove: 清空 placed_area (保留 purchased_at)
 *
 * 定价 (V4.0 §3.2): 摆件 5, 植物 10/15, 季节 15 碎片.
 */
@Injectable()
export class DecorationsService {
  constructor(
    @InjectRepository(IslandDecoration)
    private readonly repo: Repository<IslandDecoration>,
    private readonly fragmentsService: FragmentsService,
  ) {}

  async list(userId: string): Promise<DecorationDto[]> {
    const owned = await this.repo.find({ where: { userId } });
    const ownedMap = new Map<string, IslandDecoration>(owned.map((r) => [r.decorationId, r]));

    return DECORATION_DEFS.map((def) => {
      const row = ownedMap.get(def.decorationId);
      return {
        decorationId: def.decorationId,
        title: def.title,
        emoji: def.emoji,
        kind: def.kind,
        priceFragments: def.priceFragments,
        owned: row !== undefined,
        placedArea: row?.placedArea ?? null,
        placedX: row?.placedX ?? null,
        placedY: row?.placedY ?? null,
      };
    });
  }

  async purchase(userId: string, dto: PurchaseDecorationDto): Promise<PurchaseDecorationResponseDto> {
    const def = DECORATION_DEFS.find((d) => d.decorationId === dto.decorationId);
    if (!def) {
      throw new NotFoundException(`unknown decorationId: ${dto.decorationId}`);
    }

    const existing = await this.repo.findOne({ where: { userId, decorationId: def.decorationId } });
    if (existing) {
      throw new BadRequestException(`decoration ${def.decorationId} 已拥有, 不可重复购买`);
    }

    // 跨碎片混合扣减: 优先按"成本价"等价, 任意类型总和够就扣.
    // 简化策略: 走 balances 总和 (不限类型), 由 fragments.consume 走 calm 通用池.
    // V3.1 待办: 改成 5 类型按比例扣 (V4.0 §3.2 没明确比例, 这里走 calm 默认)
    const result = await this.fragmentsService.consume(
      userId,
      FragmentType.Calm,
      def.priceFragments,
      'shop.decoration.consume',
      { decorationId: def.decorationId },
      dto.idempotencyKey,
    );

    await this.repo.insert({
      userId,
      decorationId: def.decorationId,
      purchasedAt: new Date(),
      placedArea: null,
      placedX: null,
      placedY: null,
      spentFragments: def.priceFragments,
    });

    return {
      decorationId: def.decorationId,
      spentFragments: def.priceFragments,
      balances: result.balances,
    };
  }

  async place(userId: string, decorationId: string, dto: PlaceDecorationDto): Promise<DecorationDto> {
    const def = DECORATION_DEFS.find((d) => d.decorationId === decorationId);
    if (!def) {
      throw new NotFoundException(`unknown decorationId: ${decorationId}`);
    }
    const row = await this.repo.findOne({ where: { userId, decorationId } });
    if (!row) {
      throw new BadRequestException(`decoration ${decorationId} 尚未购买`);
    }

    row.placedArea = dto.area;
    row.placedX = dto.x ?? null;
    row.placedY = dto.y ?? null;
    await this.repo.save(row);

    return this.mapDto(def, row);
  }

  async remove(userId: string, decorationId: string): Promise<DecorationDto> {
    const def = DECORATION_DEFS.find((d) => d.decorationId === decorationId);
    if (!def) {
      throw new NotFoundException(`unknown decorationId: ${decorationId}`);
    }
    const row = await this.repo.findOne({ where: { userId, decorationId } });
    if (!row) {
      throw new BadRequestException(`decoration ${decorationId} 尚未购买`);
    }
    row.placedArea = null;
    row.placedX = null;
    row.placedY = null;
    await this.repo.save(row);

    return this.mapDto(def, row);
  }

  private mapDto(def: (typeof DECORATION_DEFS)[number], row: IslandDecoration): DecorationDto {
    return {
      decorationId: def.decorationId,
      title: def.title,
      emoji: def.emoji,
      kind: def.kind,
      priceFragments: def.priceFragments,
      owned: true,
      placedArea: row.placedArea,
      placedX: row.placedX,
      placedY: row.placedY,
    };
  }
}
