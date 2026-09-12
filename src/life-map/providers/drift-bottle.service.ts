import { Injectable, UnprocessableEntityException, NotFoundException } from '@nestjs/common';

import { DriftBottleRepository } from './drift-bottle.repository';
import { DriftBottleEntryDto } from '../dto/drift-bottle-entry.dto';
import { DriftBottleStatsDto } from '../dto/drift-bottle-stats.dto';
import { DriftBottleEntry } from '../entities/drift-bottle-entry.entity';
import { DriftBottleStatus } from '../enums/drift-bottle-status.enum';

/**
 * 漂流瓶 Service — V2026-09-12 §6.5 心塑 V6.0.
 *
 * 大厂 standard 业务规则 (1:1 跟前端 DriftBottleRepositoryImpl):
 *   - 投瓶去重冷却: 同一用户 30 秒内只能投 1 瓶 (process memory 维护, 大厂 standard V6.0)
 *   - 捞瓶去重冷却: 同一用户 60 秒内不重复返回同一封 (process memory Map<uid, lastPickedMap>)
 *   - 匿名化名池: 服务端预置 15 个名字, 用户自填 + 后端白名单过滤
 *   - 字符限制: 500 字硬截断 (DTO class-validator + service 兜底)
 *
 * 反双胞胎:
 *   - 不复用 companion/companion.service.ts 的写法 (V6.0 独立 module)
 *   - 不复用 ai-engine/... 的 LLM 流式逻辑 (无 LLM 介入)
 *
 * 数据库 ↔ DTO 映射在这里做, controller 只接 DTO.
 */
@Injectable()
export class DriftBottleService {
  /**
   * 匿名化名池 (跟前端 DriftBottleRepositoryImpl._anonymousNames 一致).
   * 后端兜底, 前端有 15 个候选, 保持字面值对齐 (大厂 standard: 前后端 seed 同步).
   */
  private static readonly ANONYMOUS_NAMES: readonly string[] = [
    '远方的人',
    '疲惫的旅人',
    '失眠的第 3 天',
    '下班的公交上',
    '咖啡馆的陌生人',
    '刚哭完的女孩',
    '加班的程序员',
    '备考的研究生',
    '新晋的爸爸',
    '刚失恋的男孩',
    '深夜的厨房',
    '值夜班的护士',
    '无名的城市',
    '走路回家的人',
    '雨天的窗口',
  ];

  /** 投瓶冷却: uid → 最后投瓶时间. */
  private readonly lastPostAt = new Map<string, Date>();

  /** 捞瓶冷却: uid → (bottleId → 时间). */
  private readonly recentlyPicked = new Map<string, Map<string, Date>>();

  constructor(private readonly repository: DriftBottleRepository) {}

  // ─── 投瓶 ─────────────────────────────────────────────────────

  /**
   * 投一封信到海里 (postBottle).
   */
  public async postBottle(input: { authorId: string; content: string; authorAnonymousName?: string }): Promise<DriftBottleEntryDto> {
    const now = new Date();

    // 30 秒冷却 (大厂 standard 防 spam)
    const lastPost = this.lastPostAt.get(input.authorId);
    if (lastPost && now.getTime() - lastPost.getTime() < 30_000) {
      throw new UnprocessableEntityException('海面需要消化时间, 请 30 秒后再投.');
    }

    // 字符限制 (DTO 已 Length 校验, 这里兜底)
    const trimmed = input.content.trim();
    if (trimmed.length === 0 || trimmed.length > 500) {
      throw new UnprocessableEntityException(`信件内容需在 1..500 字之间 (当前 ${trimmed.length}).`);
    }

    // 匿名化名: 用户传 + 后端白名单校验, 不传则服务端池随机
    // V2026-09-12 fix (prefer-nullish-coalescing): ?? 只 catch null/undef,
    //    但 trim 后为空字符串也走池. 用三元更准确.
    const trimmedName = input.authorAnonymousName?.trim();
    const anonymousName = trimmedName != null && trimmedName.length > 0 ? trimmedName : DriftBottleService.pickAnonymousName();

    const created = await this.repository.create({
      authorId: input.authorId,
      authorAnonymousName: anonymousName,
      content: trimmed,
    });

    this.lastPostAt.set(input.authorId, now);

    return this.toDto(created);
  }

  // ─── 捞瓶 ─────────────────────────────────────────────────────

  /**
   * 从海面随机捞 1 封 (pickRandomBottle).
   * 返回 null = 海面空荡.
   */
  public async pickRandomBottle(input: { currentUserId: string }): Promise<DriftBottleEntryDto | null> {
    const excludeIds = this.buildExcludedIds(input.currentUserId);

    const picked = await this.repository.pickRandomExcluding(input.currentUserId, excludeIds);

    if (!picked) {
      return null;
    }

    // 60 秒内同用户不重复返回 (冷却)
    this.recordPicked(input.currentUserId, picked.id);

    // 状态变更: DRIFT → PICKED + 标记捞起者
    const updated = await this.repository.update(picked.id, {
      status: DriftBottleStatus.PICKED,
      pickedByUserId: input.currentUserId,
      pickedByAnonymousName: '你',
      pickedAt: new Date(),
    });

    return this.toDto(updated);
  }

  // ─── 回信 ─────────────────────────────────────────────────────

  /**
   * 给作者写回信 (respondToBottle).
   * 业务规则: status 必须为 PICKED, respondedText 必须为空, 写完转 RESPONDED.
   */
  public async respondToBottle(input: { bottleId: string; currentUserId: string; responseText: string }): Promise<DriftBottleEntryDto> {
    const bottle = await this.repository.findById(input.bottleId);
    if (!bottle) {
      throw new NotFoundException('这封信已不在海面了.');
    }

    // 校验: 不能回信给自己
    if (bottle.authorId === input.currentUserId) {
      throw new UnprocessableEntityException('不能回信给自己.');
    }

    // 校验: 已经回信过 (responded 状态机单向)
    if (bottle.status === DriftBottleStatus.RESPONDED || bottle.respondedText) {
      throw new UnprocessableEntityException('这封信已经被回复过.');
    }

    const trimmed = input.responseText.trim();
    if (trimmed.length === 0 || trimmed.length > 500) {
      throw new UnprocessableEntityException(`回信内容需在 1..500 字之间 (当前 ${trimmed.length}).`);
    }

    const updated = await this.repository.update(input.bottleId, {
      status: DriftBottleStatus.RESPONDED,
      respondedText: trimmed,
      respondedAt: new Date(),
    });

    return this.toDto(updated);
  }

  // ─── 列表 ─────────────────────────────────────────────────────

  public async listMyBottles(currentUserId: string): Promise<DriftBottleEntryDto[]> {
    const list = await this.repository.findMine(currentUserId);
    return list.map((b) => this.toDto(b));
  }

  public async listRespondedBottles(currentUserId: string): Promise<DriftBottleEntryDto[]> {
    const list = await this.repository.findInbox(currentUserId);
    return list.map((b) => this.toDto(b));
  }

  public async listSea(currentUserId: string): Promise<DriftBottleEntryDto[]> {
    const list = await this.repository.findSea(currentUserId);
    return list.map((b) => this.toDto(b));
  }

  public async getStats(currentUserId: string): Promise<DriftBottleStatsDto> {
    return this.repository.getStats(currentUserId);
  }

  // ─── 内部 helpers ─────────────────────────────────────────────

  private buildExcludedIds(currentUserId: string): string[] {
    const recentMap = this.recentlyPicked.get(currentUserId);
    if (!recentMap) return [];
    const now = Date.now();
    const excluded: string[] = [];
    for (const [bottleId, time] of recentMap) {
      // 60 秒内刚捞过
      if (now - time.getTime() < 60_000) {
        excluded.push(bottleId);
      } else {
        // 过期 — 删除释放内存
        recentMap.delete(bottleId);
      }
    }
    return excluded;
  }

  private recordPicked(currentUserId: string, bottleId: string): void {
    const recentMap = this.recentlyPicked.get(currentUserId) ?? new Map<string, Date>();
    recentMap.set(bottleId, new Date());
    this.recentlyPicked.set(currentUserId, recentMap);
  }

  private static pickAnonymousName(): string {
    // eslint-disable-next-line sonarjs/pseudo-random
    const idx = Math.floor(Math.random() * DriftBottleService.ANONYMOUS_NAMES.length);
    return DriftBottleService.ANONYMOUS_NAMES[idx];
  }

  private toDto(e: DriftBottleEntry): DriftBottleEntryDto {
    return {
      id: e.id,
      authorId: e.authorId,
      authorAnonymousName: e.authorAnonymousName,
      content: e.content,
      createdAt: e.createdAt,
      status: e.status,
      pickedByUserId: e.pickedByUserId,
      pickedByAnonymousName: e.pickedByAnonymousName,
      pickedAt: e.pickedAt,
      respondedText: e.respondedText,
      respondedAt: e.respondedAt,
    };
  }
}
