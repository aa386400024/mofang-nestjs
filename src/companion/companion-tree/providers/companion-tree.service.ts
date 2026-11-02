import { Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { CompanionTreeDto } from '../dto/tree-stage.dto';
import { CompanionTree, deriveStage, TreeStageMeta } from '../entities/companion-tree.entity';
import { TreeWaterLog } from '../entities/tree-water-log.entity';
import { WaterAction, WaterActionMeta } from '../enums/water-action.enum';

/**
 * 共种陪伴树 Service — V2026-09-12 §6.3 共种陪伴树.
 *
 * 大厂 standard 业务规则 (1:1 跟前端 CompanionTreeRepositoryImpl):
 *   - 双作者校验: actor 必须是 ownerA 或 ownerB
 *   - 冷却校验: water 60s / fertilize 3600s / prune 86400s (大厂 standard 数值)
 *   - 阶段派生: waterCount 累计, 阶段从 TreeStageMeta 派生
 *   - 里程碑: 50/200/500 触发, 触发过的存 milestonesTriggered (前端 UI 高亮)
 *
 * 反双胞胎:
 *   - 不复用 companion/companion.service.ts (独立业务)
 *   - 不复用 rehab-item / sync-practice 的写法 (跨模块不同语义)
 */
@Injectable()
export class CompanionTreeService {
  /**
   * 冷却: actorUserId → (action → 最后时间).
   */
  private readonly cooldowns = new Map<string, Map<WaterAction, Date>>();

  constructor(
    @InjectRepository(CompanionTree)
    private readonly treeRepo: Repository<CompanionTree>,
    @InjectRepository(TreeWaterLog)
    private readonly logRepo: Repository<TreeWaterLog>,
  ) {}

  /**
   * 取当前活跃树 (单人 / 双人).
   * 不存在 → 自动 create.
   */
  public async getOrCreateActiveTree(input: { userAId: string; userBId?: string | null }): Promise<CompanionTreeDto> {
    const candidates = await this.treeRepo
      .createQueryBuilder('t')
      .where('t.ownerAId = :a', { a: input.userAId })
      .andWhere(input.userBId ? 't.ownerBId = :b' : 't.ownerBId IS NULL', { b: input.userBId ?? null })
      .andWhere('t.waterCount < :max', {
        max: TreeStageMeta.at(-1)!.waterThreshold,
      })
      .orderBy('t.createdAt', 'DESC')
      .getMany();

    if (candidates.length > 0) {
      return this.toDto(candidates[0]);
    }

    // 不存在 → 自动 create
    const created = this.treeRepo.create({
      ownerAId: input.userAId,
      ownerBId: input.userBId ?? null,
      waterCount: 0,
      milestonesTriggered: [],
    });
    const saved = await this.treeRepo.save(created);
    return this.toDto(saved);
  }

  /**
   * 取最近 N 条浇水日志.
   */
  public async recentLogs(input: { treeId: string; limit?: number }): Promise<TreeWaterLog[]> {
    return this.logRepo.find({
      where: { treeId: input.treeId },
      order: { createdAt: 'DESC' },
      take: input.limit ?? 30,
    });
  }

  /**
   * 浇水 / 施肥 / 修剪.
   */
  public async waterTree(input: {
    treeId: string;
    actorUserId: string;
    action: WaterAction;
    actorAnonymousName?: string;
  }): Promise<CompanionTreeDto> {
    const tree = await this.treeRepo.findOne({ where: { id: input.treeId } });
    if (!tree) {
      throw new NotFoundException('树不在了.');
    }

    // 双作者校验
    if (input.actorUserId !== tree.ownerAId && input.actorUserId !== tree.ownerBId) {
      throw new UnprocessableEntityException('只有双作者可以照顾这棵树.');
    }

    const meta = WaterActionMeta[input.action];

    // 冷却校验
    const userCooldown = this.cooldowns.get(input.actorUserId) ?? new Map<WaterAction, Date>();
    const last = userCooldown.get(input.action);
    const now = new Date();
    if (last && now.getTime() - last.getTime() < meta.cooldownSeconds * 1000) {
      const remainSec = meta.cooldownSeconds - Math.floor((now.getTime() - last.getTime()) / 1000);
      const remainMin = Math.ceil(remainSec / 60);
      throw new UnprocessableEntityException(`${meta.label}冷却中, 还差 ${remainMin} 分钟.`);
    }

    // 累加 waterCount + 触发 milestone
    const newCount = tree.waterCount + meta.delta;
    const triggered = new Set<number>(tree.milestonesTriggered);
    for (const m of [50, 200, 500]) {
      if (newCount >= m) triggered.add(m);
    }

    tree.waterCount = newCount;
    tree.lastWaterAt = now;
    tree.milestonesTriggered = Array.from(triggered);
    const saved = await this.treeRepo.save(tree);

    // 写日志
    const log = this.logRepo.create({
      treeId: tree.id,
      actorUserId: input.actorUserId,
      action: input.action,
      actorAnonymousName: input.actorAnonymousName ?? null,
    });
    await this.logRepo.save(log);

    // 更新冷却
    userCooldown.set(input.action, now);
    this.cooldowns.set(input.actorUserId, userCooldown);

    return this.toDto(saved);
  }

  /**
   * 我所有的树 (历史).
   */
  public async myTrees(userId: string): Promise<CompanionTreeDto[]> {
    const trees = await this.treeRepo
      .createQueryBuilder('t')
      .where('t.ownerAId = :uid OR t.ownerBId = :uid', { uid: userId })
      .orderBy('t.createdAt', 'DESC')
      .getMany();
    return trees.map((t) => this.toDto(t));
  }

  // ─── 内部 helpers ─────────────────────────────────────────────

  private toDto(t: CompanionTree): CompanionTreeDto {
    const stage = deriveStage(t.waterCount);
    const stageMeta = TreeStageMeta[stage];
    const nextStageMeta = TreeStageMeta[stage + 1];
    const daysSinceCreated = Math.max(0, Math.floor((Date.now() - t.createdAt.getTime()) / (1000 * 60 * 60 * 24)));
    const daysSinceLastWater = t.lastWaterAt ? Math.floor((Date.now() - t.lastWaterAt.getTime()) / (1000 * 60 * 60 * 24)) : null;

    // 阶段进度 0..1
    const prevThreshold = stage === 0 ? 0 : TreeStageMeta[stage].waterThreshold;
    const nextThreshold = nextStageMeta?.waterThreshold ?? prevThreshold;
    const span = Math.max(1, nextThreshold - prevThreshold);
    const stageProgress = stage >= TreeStageMeta.length - 1 ? 1 : Math.min(1, Math.max(0, (t.waterCount - prevThreshold) / span));

    return {
      id: t.id,
      ownerAId: t.ownerAId,
      ownerBId: t.ownerBId,
      waterCount: t.waterCount,
      milestonesTriggered: t.milestonesTriggered,
      lastWaterAt: t.lastWaterAt,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
      stage,
      stageLabel: stageMeta.label,
      stageEmoji: stageMeta.emoji,
      waterToNextStage: nextStageMeta ? nextStageMeta.waterThreshold - t.waterCount : 0,
      stageProgress,
      daysSinceCreated,
      daysSinceLastWater,
      isWilting: daysSinceLastWater !== null && daysSinceLastWater >= 7,
      isDualMode: t.ownerBId !== null,
    };
  }
}
