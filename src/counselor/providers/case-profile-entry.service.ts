// V2026-10-21 治本 (V1.2 VS-B1 — M1 动态解锁档案 service):
//   原因: v1.2 spec §4.2 视图 B 要求:
//     - 「AI 每轮回复后, 后端跑一个轻量抽取, 命中就写一条 layer=self_disclosed」
//     - 「**未提及的信息保持空白, 绝不提前显示**」
//     - 「咨询师可以在任何时候加 layer=therapist_note 的观察/假设, 跟 self_disclosed 分区展示」
//   修法: CaseProfileEntryService 4 个 method:
//     - list             列档案 (按 layer 分区, 时间线升序)
//     - create           咨询师手写观察 (layer 固定 therapist_note, 用户不能冒充来访者披露)
//     - appendDisclosed  AI 抽取写入 (layer 固定 self_disclosed; VS-B2 的抽取器调它)
//     - remove           软删 (咨询师纠正误记)
//   反双胞胎:
//     - 不让请求方传 layer: 前端传 layer=self_disclosed 就等于"用户能伪造来访者披露",
//       破坏信息分层的可信度 → 层级由**调用入口**决定 (create=手写 / appendDisclosed=AI)
//     - 不用 delete 物理删除: 跟 counselor 其它 entity 一致走软删 deletedAt
//     - 不在 list 里做"未提及信息补空行": spec 明确"空白条目不占位", 缺信息 = 没有行
//   验证:
//     1. tsc 0 错
//     2. POST /counselor/long-term-cases/:caseId/profile-entries → 201, layer=therapist_note
//     3. GET 同 caseId → selfDisclosed / therapistNotes 两组分区
//   时间戳: 2026-10-21

import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';

import { type CaseProfileEntriesDto, type CaseProfileEntryDto, type CreateCaseProfileEntryDto } from '../dto/visitor-persona.dto';
import { CaseProfileEntry } from '../entities/case-profile-entry.entity';
import { LongTermCase } from '../entities/long-term-case.entity';

/**
 * 动态解锁档案 service.
 */
@Injectable()
export class CaseProfileEntryService {
  constructor(
    @InjectRepository(CaseProfileEntry)
    private readonly entryRepo: Repository<CaseProfileEntry>,
    @InjectRepository(LongTermCase)
    private readonly caseRepo: Repository<LongTermCase>,
  ) {}

  // ══════════════════════════════════════════════════════════════════════════
  // 1. list — 列档案 (按 layer 分区)
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * 列出 1 个长程个案的动态解锁档案.
   *
   * @param userId 当前用户 id
   * @param caseId 长程个案 id
   * @returns 两层分区 (来访披露 / 咨询师手写), 各自按时间线升序
   */
  async list(userId: string, caseId: string): Promise<CaseProfileEntriesDto> {
    await this.assertCaseOwned(userId, caseId);
    const rows = await this.entryRepo.find({
      where: { caseId, userId, deletedAt: IsNull() },
      order: { createdAt: 'ASC' },
    });
    const selfDisclosed: CaseProfileEntryDto[] = [];
    const therapistNotes: CaseProfileEntryDto[] = [];
    for (const row of rows) {
      const dto = this.toDto(row);
      if (row.layer === 'self_disclosed') {
        selfDisclosed.push(dto);
      } else {
        therapistNotes.push(dto);
      }
    }
    return { caseId, selfDisclosed, therapistNotes };
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 2. create — 咨询师手写观察
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * 咨询师手写一条观察 / 假设 (layer 固定 therapist_note).
   *
   * @param userId 当前用户 id
   * @param caseId 长程个案 id
   * @param input 条目内容
   * @returns 新建的条目
   */
  async create(userId: string, caseId: string, input: CreateCaseProfileEntryDto): Promise<CaseProfileEntryDto> {
    await this.assertCaseOwned(userId, caseId);
    const saved = await this.entryRepo.save(
      this.entryRepo.create({
        tenantId: userId,
        userId,
        caseId,
        sessionId: input.sessionId ?? null,
        // 层级由入口决定, 不接受调用方指定
        layer: 'therapist_note',
        anchorKey: input.anchorKey ?? '',
        content: input.content,
      }),
    );
    return this.toDto(saved);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 3. appendDisclosed — AI 抽取写入
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * 写入 1 条"来访主动披露" (layer 固定 self_disclosed).
   *
   * 供 VS-B2 的每轮抽取器调用 —— 抽取器判断本轮来访披露了哪一块人设, 命中才写.
   *
   * @param userId 当前用户 id
   * @param caseId 长程个案 id
   * @param input 条目内容
   * @returns 新建的条目
   */
  async appendDisclosed(userId: string, caseId: string, input: CreateCaseProfileEntryDto): Promise<CaseProfileEntryDto> {
    await this.assertCaseOwned(userId, caseId);
    if (!input.anchorKey || input.anchorKey.trim().length === 0) {
      throw new BadRequestException('来访披露条目必须带 anchorKey (指向全量人设的 JSON path)');
    }
    const saved = await this.entryRepo.save(
      this.entryRepo.create({
        tenantId: userId,
        userId,
        caseId,
        sessionId: input.sessionId ?? null,
        layer: 'self_disclosed',
        anchorKey: input.anchorKey.trim(),
        content: input.content,
      }),
    );
    return this.toDto(saved);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 4. remove — 软删
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * 软删 1 条条目 (咨询师纠正误记).
   *
   * @param userId 当前用户 id
   * @param caseId 长程个案 id (归属校验: 条目必须属于该个案)
   * @param entryId 条目 id
   * @throws NotFoundException 条目不存在 / 不属于当前用户 / 不属于该个案
   */
  async remove(userId: string, caseId: string, entryId: string): Promise<void> {
    const row = await this.entryRepo.findOne({
      where: { id: entryId, userId, deletedAt: IsNull() },
    });
    if (!row) {
      throw new NotFoundException(`档案条目 ${entryId} 不存在或不属于当前用户`);
    }
    // V2026-10-21 治本 (V1.2 VS-B1 第 1 轮 build 修复 — TS6133 未使用参数):
    //   原因: DELETE endpoint 的 @Param('caseId') 传进来没被用, tsc 报 TS6133
    //     ('caseId' is declared but its value is never read).
    //   修法: 拿它做**归属校验**, 而不是删掉参数.
    //   反双胞胎:
    //     - 不删 caseId 参数: URL 里带着个案 id 却不校验归属, 等于能用 A 个案的 URL
    //       删掉 B 个案的条目 (只靠 userId 拦, 同一用户的多个案就穿透了)
    //     - 不用 `_caseId` 下划线改名压制: 那是把问题藏起来, 校验本身是应该做的
    if (row.caseId !== caseId) {
      throw new NotFoundException(`档案条目 ${entryId} 不属于个案 ${caseId}`);
    }
    row.deletedAt = new Date();
    await this.entryRepo.save(row);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 私有 helper
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * 校验长程个案属于当前用户 (跨用户访问检测).
   *
   * @param userId 当前用户 id
   * @param caseId 长程个案 id
   * @throws NotFoundException 不存在 / 不属于当前用户
   */
  private async assertCaseOwned(userId: string, caseId: string): Promise<void> {
    const row = await this.caseRepo.findOne({
      where: { id: caseId, userId, isTemplate: 0, deletedAt: IsNull() },
    });
    if (!row) {
      throw new NotFoundException(`长程个案 ${caseId} 不存在或不属于当前用户`);
    }
  }

  /**
   * entity → DTO.
   *
   * @param row case_profile_entries 表行
   */
  private toDto(row: CaseProfileEntry): CaseProfileEntryDto {
    return {
      id: row.id,
      caseId: row.caseId,
      sessionId: row.sessionId,
      layer: row.layer,
      anchorKey: row.anchorKey,
      content: row.content,
      createdAt: row.createdAt,
    };
  }
}
