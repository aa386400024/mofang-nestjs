// V2026-10-21 治本 (V1.2 VS-B2 — 档案抽取落库 + 信任度推进 service):
//   原因: v1.2 §4.2 视图 B 要求「AI 每轮回复后, 后端跑一个轻量抽取, 命中就写一条
//     layer=self_disclosed」; §4.1 的信息暴露节奏又由「咨访信任度」驱动 —— 也就是说
//     **每轮的新披露必须同时推进信任度**, 否则暴露节奏永远停在第一档.
//   修法: ProfileExtractionService 1 个核心 method:
//     - persistDisclosures: 披露落库 (case_profile_entries, layer=self_disclosed)
//       + 去重更新 + 按披露深度加权推进信任度 (visitor_full_personas.trust_level)
//       + SSE 推送 profile_entry 事件 (前端卷宗"新解锁"动效)
//   反双胞胎:
//     - **不按"每条 +0.05"一刀切**: 浅层事实披露跟深层创伤披露权重一样, 跟临床现实不符
//       (深层的自我暴露才真正建立信任) → 按锚点所在人设块分档 (见 domain 的
//       trustWeightForAnchor), 权重是**服务端规则**, 可复算可解释
//     - **重复披露同一锚点不重复加信任度**: 同一件事说第二遍不构成新的信任建设;
//       但内容要更新 (后一次通常更完整) → update 而非 insert
//     - 不在 LLM 里让模型自己给信任度打分: 不可校准 + 两次判定可能不同
//     - 不给单次训练建档案: 动态解锁档案是**长程卷宗**的概念 (spec §4.2), 单次训练
//       没有 case, 也没有跨会话的信任积累 → caseId 为 null 时直接跳过
//   验证:
//     1. tsc 0 错
//     2. 大炮跑一轮带披露的会话 → case_profile_entries 新增条目 + trust_level 上升
//     3. 重复披露同一锚点 → 条目数不变, trust_level 不再涨
//   时间戳: 2026-10-21

import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';

import { SessionCoreEventsService } from './session-core-events.service';
import { trustWeightForAnchor, type LiveTurnDisclosure } from '../domain/session-core/session-core.types';
import { CaseProfileEntry } from '../entities/case-profile-entry.entity';
import { VisitorFullPersona } from '../entities/visitor-full-persona.entity';

/**
 * 披露落库结果.
 */
export interface DisclosurePersistResult {
  /** 新增的条目数 */
  readonly addedCount: number;
  /** 更新的已有条目数 */
  readonly updatedCount: number;
  /** 推进前的信任度 */
  readonly trustBefore: number;
  /** 推进后的信任度 */
  readonly trustAfter: number;
}

/**
 * 档案抽取落库 service.
 */
@Injectable()
export class ProfileExtractionService {
  private readonly logger = new Logger(ProfileExtractionService.name);

  constructor(
    @InjectRepository(CaseProfileEntry)
    private readonly entryRepo: Repository<CaseProfileEntry>,
    @InjectRepository(VisitorFullPersona)
    private readonly personaRepo: Repository<VisitorFullPersona>,
    private readonly events: SessionCoreEventsService,
  ) {}

  /**
   * 落库本轮披露 + 推进信任度.
   *
   * @param input 落库入参
   * @returns 落库结果 (未落库时各项为 0)
   */
  async persistDisclosures(input: {
    readonly userId: string;
    readonly sessionId: string;
    readonly caseId: string | null;
    readonly turnIndex: number;
    readonly disclosures: readonly LiveTurnDisclosure[];
  }): Promise<DisclosurePersistResult> {
    const empty: DisclosurePersistResult = { addedCount: 0, updatedCount: 0, trustBefore: 0, trustAfter: 0 };
    // 单次训练没有长程个案 → 无档案 / 无信任积累 (spec §4.2 的档案是长程卷宗概念)
    if (!input.caseId || input.disclosures.length === 0) {
      return empty;
    }

    const existing = await this.entryRepo.find({
      where: { caseId: input.caseId, userId: input.userId, deletedAt: IsNull() },
    });
    const byAnchor = new Map(existing.map((e) => [e.anchorKey, e]));

    let addedCount = 0;
    let updatedCount = 0;
    let trustDelta = 0;
    const addedEntries: CaseProfileEntry[] = [];

    for (const disclosure of input.disclosures) {
      const found = byAnchor.get(disclosure.anchorKey);
      if (found) {
        // 重复披露: 更新内容 (后一次通常更完整), 但**不重复加信任度**
        found.content = disclosure.content;
        found.sessionId = input.sessionId;
        await this.entryRepo.save(found);
        updatedCount++;
        continue;
      }
      const entry = await this.entryRepo.save(
        this.entryRepo.create({
          tenantId: input.userId,
          userId: input.userId,
          caseId: input.caseId,
          sessionId: input.sessionId,
          layer: 'self_disclosed',
          anchorKey: disclosure.anchorKey,
          content: disclosure.content,
        }),
      );
      byAnchor.set(disclosure.anchorKey, entry);
      addedEntries.push(entry);
      addedCount++;
      trustDelta += trustWeightForAnchor(disclosure.anchorKey);
    }

    // 推进信任度 (只按**新增**披露计)
    const trustBefore = await this.readTrustLevel(input.userId, input.caseId);
    const trustAfter = Math.min(1, Number((trustBefore + trustDelta).toFixed(4)));
    if (trustDelta > 0) {
      await this.writeTrustLevel(input.userId, input.caseId, trustAfter);
    }

    // SSE 推送新解锁条目 (前端卷宗"新解锁"动效)
    for (const entry of addedEntries) {
      this.events.publish(input.sessionId, {
        event: 'profile_entry',
        data: {
          id: entry.id,
          caseId: entry.caseId,
          sessionId: entry.sessionId,
          layer: entry.layer,
          anchorKey: entry.anchorKey,
          content: entry.content,
          createdAt: entry.createdAt,
        },
      });
    }

    this.logger.log(
      `[disclosures_persisted] case=${input.caseId} turn=${input.turnIndex} ` +
        `added=${addedCount} updated=${updatedCount} trust ${trustBefore.toFixed(2)}→${trustAfter.toFixed(2)}`,
    );
    return { addedCount, updatedCount, trustBefore, trustAfter };
  }

  /**
   * 读当前信任度 (无全量人设 → 0.2 初始值).
   *
   * @param userId 当前用户 id
   * @param caseId 长程个案 id
   */
  private async readTrustLevel(userId: string, caseId: string): Promise<number> {
    const persona = await this.personaRepo.findOne({
      where: { caseId, userId, deletedAt: IsNull() },
    });
    return persona?.trustLevel ?? 0.2;
  }

  /**
   * 写回信任度.
   *
   * @param userId 当前用户 id
   * @param caseId 长程个案 id
   * @param trustLevel 新信任度
   */
  private async writeTrustLevel(userId: string, caseId: string, trustLevel: number): Promise<void> {
    const persona = await this.personaRepo.findOne({
      where: { caseId, userId, deletedAt: IsNull() },
    });
    if (!persona) {
      return;
    }
    persona.trustLevel = trustLevel;
    await this.personaRepo.save(persona);
  }
}
