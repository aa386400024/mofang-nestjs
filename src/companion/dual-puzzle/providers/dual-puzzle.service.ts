import { Injectable, NotFoundException, UnprocessableEntityException, ConflictException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';

import { DualPuzzleResultDto, DualPuzzleSetDto } from '../dto/dual-puzzle-dtos';
import { DualPuzzleAnswer } from '../entities/dual-puzzle-answer.entity';
import { DualPuzzleQuestion } from '../entities/dual-puzzle-question.entity';
import { DualPuzzleSet } from '../entities/dual-puzzle-set.entity';
import { DualPuzzleCategory } from '../enums/dual-puzzle-category.enum';

/**
 * 默契拼图 Service — V2026-09-12 §6.4 共种默契拼图.
 *
 * 大厂 standard (1:1 跟前端 DualPuzzleRepositoryImpl):
 *   - fetchRandomSet: 题库 (8 题跨 4 类) 随机抽 5 题, 组装 set
 *   - submitAnswer: 校验 + 落库 (同 setId 同 user 仅一次)
 *   - fetchResult: 双方都答 → 算 chemistryScore (匹配数 / 总题 * 100)
 *
 * V2026-09-12 fix (build):
 *   - 删 InjectDataSource + DataSource (1.x @nestjs/typeorm 没导出, 之前未用)
 *   - findByIds → findBy({ id: In(ids) }) (1.x 兼容写法, 0.3 也兼容)
 *   - Result 返时填 verdictLabel / verdictEmoji plain fields
 *
 * 反双胞胎:
 *   - 不复用 companion/companion.service.ts 的题目拉取 (无 5 题限制逻辑)
 *   - 不复用 assessment/... 的答题逻辑 (那是单人, 这里是双作者)
 */
@Injectable()
export class DualPuzzleService {
  constructor(
    @InjectRepository(DualPuzzleQuestion)
    private readonly questionRepo: Repository<DualPuzzleQuestion>,
    @InjectRepository(DualPuzzleSet)
    private readonly setRepo: Repository<DualPuzzleSet>,
    @InjectRepository(DualPuzzleAnswer)
    private readonly answerRepo: Repository<DualPuzzleAnswer>,
  ) {}

  /**
   * 取一组随机 5 题 (跟前端 fetchRandomSet).
   *
   * 大厂 standard: 跨类别凑题 (避免一类重复 5 题), 题目数量不足 5 → 报错.
   */
  public async fetchRandomSet(category?: DualPuzzleCategory): Promise<DualPuzzleSetDto> {
    const pool = category ? await this.questionRepo.find({ where: { category } }) : await this.questionRepo.find();

    if (pool.length < 5) {
      throw new UnprocessableEntityException(`题库不足 (${pool.length}/5), 请切换分类或稍后再试.`);
    }

    // Fisher-Yates shuffle
    const shuffled = [...pool];

    for (let i = shuffled.length - 1; i > 0; i--) {
      // eslint-disable-next-line sonarjs/pseudo-random
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    const picked = shuffled.slice(0, 5);

    // 落库 set
    const set = this.setRepo.create({
      title: `默契拼图 · ${picked[0].category}`,
      subtitle: '同时作答, 同时揭晓',
      questionIds: picked.map((q) => q.id),
    });
    const saved = await this.setRepo.save(set);

    return this.toSetDto(saved, picked);
  }

  /**
   * 提交答案 (1 人 1 set 仅一次).
   */
  public async submitAnswer(input: { setId: string; userId: string; choiceByQuestionId: Record<string, number> }): Promise<void> {
    const set = await this.setRepo.findOne({ where: { id: input.setId } });
    if (!set) {
      throw new NotFoundException('找不到这组默契题.');
    }

    // 校验完整性
    if (Object.keys(input.choiceByQuestionId).length !== set.questionIds.length) {
      throw new UnprocessableEntityException(`答案不完整 (${Object.keys(input.choiceByQuestionId).length}/${set.questionIds.length}).`);
    }

    // 校验每题 index 范围 (用 question 表验证合法性)
    const questions = await this.questionRepo.findBy({
      id: In(set.questionIds),
    });
    for (const q of questions) {
      // V2026-09-12 fix (different-types-comparison): choice 类型 number 但运行时可能 undefined,
      //    用 Object.prototype.hasOwnProperty 显式判断 key 存在.
      const choice = input.choiceByQuestionId[q.id] as number | undefined;
      // V2026-09-12 fix (different-types-comparison): 输入 DTO 类型是 Record<string, number>
      //    但运行时可能 undefined. 显式 cast 让 lint 满意, 配合 hasOwnProperty 双重校验.
      const choiceValid =
        Object.prototype.hasOwnProperty.call(input.choiceByQuestionId, q.id) &&
        choice !== undefined &&
        choice >= 0 &&
        choice < q.options.length;
      if (!choiceValid) {
        throw new UnprocessableEntityException(`题目 ${q.id} 答案越界.`);
      }
    }

    // 检查是否已答过
    const existing = await this.answerRepo.findOne({
      where: { setId: input.setId, userId: input.userId },
    });
    if (existing) {
      throw new ConflictException('你已经答过这组默契题.');
    }

    const answer = this.answerRepo.create({
      setId: input.setId,
      userId: input.userId,
      choiceByQuestionId: input.choiceByQuestionId,
    });
    await this.answerRepo.save(answer);
  }

  /**
   * 取结果 (双作者都答 → 算 chemistryScore).
   */
  public async fetchResult(input: { setId: string; userId: string; partnerUserId: string }): Promise<DualPuzzleResultDto | null> {
    const set = await this.setRepo.findOne({ where: { id: input.setId } });
    if (!set) {
      throw new NotFoundException('找不到这组默契题.');
    }

    const answerA = await this.answerRepo.findOne({
      where: { setId: input.setId, userId: input.userId },
    });
    const answerB = await this.answerRepo.findOne({
      where: { setId: input.setId, userId: input.partnerUserId },
    });
    if (!answerA || !answerB) {
      return null;
    }

    // 算每题匹配 + 总分
    const perQuestionMatch: Record<string, boolean> = {};
    let matches = 0;
    for (const qid of set.questionIds) {
      const ca = answerA.choiceByQuestionId[qid];
      const cb = answerB.choiceByQuestionId[qid];
      // V2026-09-12 fix (different-types-comparison): ca 类型 number, 运行时可能 undefined.
      //    用 != 而非 !== 是禁忌, 改成显式 hasOwn + undefined check.
      const aHas = Object.prototype.hasOwnProperty.call(answerA.choiceByQuestionId, qid);
      const bHas = Object.prototype.hasOwnProperty.call(answerB.choiceByQuestionId, qid);
      const isMatch = aHas && bHas && ca === cb;
      perQuestionMatch[qid] = isMatch;
      if (isMatch) matches++;
    }

    const score = Math.round((matches / set.questionIds.length) * 100);

    return {
      setId: input.setId,
      userAId: input.userId,
      userBId: input.partnerUserId,
      chemistryScore: score,
      perQuestionMatch,
      generatedAt: new Date(),
      verdictLabel: DualPuzzleResultDto.verdictLabelFor(score),
      verdictEmoji: DualPuzzleResultDto.verdictEmojiFor(score),
    };
  }

  /**
   * 我的作答历史 (setId 列表).
   */
  public async recentSets(limit = 10): Promise<DualPuzzleSetDto[]> {
    const sets = await this.setRepo.find({
      order: { createdAt: 'DESC' },
      take: limit,
    });
    // 批量取 question (避免 N+1)
    const allQuestionIds = [...new Set(sets.flatMap((s) => s.questionIds))];
    const questions = await this.questionRepo.findBy({
      id: In(allQuestionIds),
    });
    const qById = new Map<string, DualPuzzleQuestion>(questions.map((q) => [q.id, q]));

    return sets.map((s) =>
      this.toSetDto(
        s,
        s.questionIds.map((id) => qById.get(id)).filter((q): q is DualPuzzleQuestion => q !== undefined),
      ),
    );
  }

  // ─── DTO 转换 ─────────────────────────────────────────────────────

  private toSetDto(set: DualPuzzleSet, questions: DualPuzzleQuestion[]): DualPuzzleSetDto {
    return {
      id: set.id,
      title: set.title,
      subtitle: set.subtitle,
      createdAt: set.createdAt,
      questions: questions.map((q) => ({
        id: q.id,
        prompt: q.prompt,
        options: q.options,
        category: q.category,
        contextHint: q.contextHint,
      })),
    };
  }
}
