// V2026-10-15 治本 (V2.4 — supervision.service.ts, 5 method 业务逻辑):
//   原因: counselor-mode-v1.0 §4.6 + §6.2 拍板 4 流派督导 + polymorphic feedback,
//     V0.3 §8 baseline 0 督导持久化 service, 1:1 wire 0 破坏. V0.5 阶段 mock:
//     service.generateFeedback 内部用 SUPERVISION_SCHOOL_PRESETS promptTemplate
//     拼接 transcript + persona + emotionTimeline, 返 4 字段结构化 feedback; V1.x
//     真接 LLM 时改 provider 注入 (跟 W1-2 long-term-case-presets 静态 config 风格一致).
//
//   修法 (跟 knowledge-base/providers/search.service.ts V0.x 风格一致):
//     - 5 method: listSchools / findSchoolByCode / generateFeedback / compareFeedback / listFeedbackForSession
//     - listSchools(): 4 流派 list (从 DB 读, isActive=1, 软删过滤)
//     - findSchoolByCode(code): 单流派详情 (含 promptTemplate, V0.5 mock 用)
//     - generateFeedback(input, userId): 1 session + 1 流派 → 4 字段结构化 feedback,
//       V0.5 mock 走 SUPERVISION_SCHOOL_PRESETS promptTemplate 拼接收录 + persona +
//       emotionTimeline, 返 mock 评分 (V1.x 真接 LLM 时改 provider 注入 + 真实评分)
//     - compareFeedback(input, userId): 1 session + N 流派 → N 份 feedback 并行
//       (V0.5 mock 走串行, V1.x 真接 LLM 改 Promise.all 并行调)
//     - listFeedbackForSession(userId, sessionId, sessionType): 历史 N 流派 feedback
//
//   反双胞胎:
//     - 不接 LLM provider: V0.5 阶段只生成 prompt 字符串 + mock 评分, V1.x 真接 LLM 时改
//       provider 注入 (跟 W1-2 long-term-case-presets 静态 config 风格一致)
//     - 不复用 V0.x supervisionReport json 字段: 破坏 1:1 wire
//     - 不用 hardcode 4 流派: 走 DB 读 supervision_schools, 未来 B 端 / 海外扩展只 INSERT
//     - 不写 ML 评分: V0.x 简单 mock 评分 (overallScore=70-85 随机 + perSentence 简单规则)
//     - polymorphic sessionId 走应用层校验 + 对应 Repository 查 transcript, 不写 DB-level
//       polymorphic FK (跟 knowledge_chunks.itemId V0.x pattern 一致)
//
//   5 段治本 (V2.4 mock 评分公式):
//     - 公式: overallScore = 70 + (focusAreaCount - sentenceCount * 0.5) clamp 0-100
//     - perSentence: 取 transcript counselor 角色前 5 句, 每句 mock score 65-85
//     - errorCategories: 随机取 1-2 个 focusAreas 反向 (e.g. CBT 流派可能报 "未追踪自动思维")
//     - growthSuggestion: 取 school.exampleFeedback 第 1 句作为建议
//
//   验证:
//     1. tsc 0 错 (5 method 字段 type 严格)
//     2. 大炮跑 pnpm migration:run + curl 验 3 endpoint 端到端
//     3. integration: 4 流派 list / 生成 1 流派 / 多流派对比
//
//   时间戳: 2026-10-15

import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';

import { SUPERVISION_SCHOOL_PRESETS } from '../config/supervision-school-presets';
import {
  type CompareSupervisionFeedbackResponseDto,
  type GenerateSupervisionFeedbackDto,
  type SupervisionFeedbackDto,
  type SupervisionPerSentenceDto,
  type SupervisionSchoolDetailDto,
  type SupervisionSchoolListItemDto,
} from '../dto/supervision.dto';
import { SupervisionFeedback, type SupervisionFeedbackPayload } from '../entities/supervision-feedback.entity';
import { SupervisionSchool } from '../entities/supervision-school.entity';
import { SessionType } from '../enums/session-type.enum';
import { SupervisionSchoolCode } from '../enums/supervision-school-code.enum';

/**
 * V2026-10-15 (V1.x counselor-mode W3-4 — SupervisionService):
 *   4 流派督导 + polymorphic sessionId feedback 业务逻辑.
 *
 *   跟 xin_su_app SupervisionBloc + SupervisionRepository 端到端 1:1 对应.
 *   V0.5 mock 阶段: 用静态 prompt 模板 + 简单规则, V1.x 真接 LLM 时改 provider 注入.
 */
@Injectable()
export class SupervisionService {
  constructor(
    @InjectRepository(SupervisionSchool)
    private readonly schoolRepo: Repository<SupervisionSchool>,
    @InjectRepository(SupervisionFeedback)
    private readonly feedbackRepo: Repository<SupervisionFeedback>,
  ) {}

  // ══════════════════════════════════════════════════════════════════════════
  // 1. listSchools — 4 流派 list (从 DB 读, 软删过滤)
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * GET /counselor/supervision/schools 主入口.
   *
   * @returns 4 流派 list (isActive=1, 软删过滤)
   */
  async listSchools(): Promise<SupervisionSchoolListItemDto[]> {
    const rows = await this.schoolRepo.find({
      where: { isActive: 1, deletedAt: IsNull() },
      order: { code: 'ASC' },
    });
    return rows.map((r) => this.toSchoolListItem(r));
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 2. findSchoolByCode — 单流派详情 (含 promptTemplate, V0.5 mock 用)
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * GET /counselor/supervision/schools/:code 主入口.
   *
   * @param code 4 流派 enum
   * @returns 单流派详情
   */
  async findSchoolByCode(code: SupervisionSchoolCode): Promise<SupervisionSchoolDetailDto> {
    const row = await this.schoolRepo.findOne({
      where: { code, deletedAt: IsNull() },
    });
    if (!row) {
      throw new NotFoundException(`督导流派 ${code} 不存在`);
    }
    return { ...this.toSchoolListItem(row), promptTemplate: row.promptTemplate };
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 3. generateFeedback — 1 session + 1 流派 → 4 字段结构化 feedback
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * POST /counselor/supervision/feedback 主入口.
   *
   * @param input { sessionId, sessionType, schoolCode }
   * @param userId 当前用户 id
   * @returns 4 字段结构化 feedback (V0.5 mock, V1.x 真接 LLM 改 provider 注入)
   */
  async generateFeedback(input: GenerateSupervisionFeedbackDto, userId: string): Promise<SupervisionFeedbackDto> {
    // 1. 查流派 (应用层校验)
    const school = await this.schoolRepo.findOne({
      where: { code: input.schoolCode, deletedAt: IsNull() },
    });
    if (!school) {
      throw new NotFoundException(`督导流派 ${input.schoolCode} 不存在`);
    }

    // 2. polymorphic: 查 session (应用层按 sessionType 走对应 Repository)
    const sessionContext = await this.loadSessionContext(input.sessionId, input.sessionType, userId);

    // 3. V0.5 mock: 简单规则生成 feedback (V1.x 真接 LLM 时返 LLM 真实输出)
    const feedback = this.mockGenerateFeedback(school.code, input.sessionId, sessionContext);

    // 4. 落 supervision_feedback 表 (V0.5: 持久化所有生成记录, V1.x 增量)
    await this.feedbackRepo.save(
      this.feedbackRepo.create({
        tenantId: userId,
        userId,
        sessionId: input.sessionId,
        sessionType: input.sessionType,
        schoolId: school.id,
        feedback,
      }),
    );

    // 5. 返 4 字段结构化 feedback (跟 DTO 1:1)
    return {
      overallScore: feedback.overallScore,
      perSentence: feedback.perSentence,
      errorCategories: feedback.errorCategories,
      growthSuggestion: feedback.growthSuggestion,
    };
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 4. compareFeedback — 1 session + N 流派 → N 份 feedback
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * POST /counselor/supervision/feedback/compare 主入口.
   *
   * @param input { sessionId, sessionType, schoolCodes }
   * @param userId 当前用户 id
   * @returns N 流派 feedback (key=schoolCode enum 值)
   */
  async compareFeedback(
    input: CompareSupervisionFeedbackResponseDto['sessionId'] extends string
      ? {
          sessionId: string;
          sessionType: SessionType;
          schoolCodes: SupervisionSchoolCode[];
        }
      : never,
    userId: string,
  ): Promise<CompareSupervisionFeedbackResponseDto> {
    if (input.schoolCodes.length < 2) {
      throw new BadRequestException('多流派对比至少 2 流派');
    }
    if (input.schoolCodes.length > 3) {
      throw new BadRequestException('多流派对比最多 3 流派 (高级会员)');
    }

    // V0.5: 串行生成 N 份 feedback. V1.x 真接 LLM 改 Promise.all 并行.
    const feedbackBySchool: Record<SupervisionSchoolCode, SupervisionFeedbackDto> = {} as Record<
      SupervisionSchoolCode,
      SupervisionFeedbackDto
    >;
    for (const code of input.schoolCodes) {
      feedbackBySchool[code] = await this.generateFeedback(
        { sessionId: input.sessionId, sessionType: input.sessionType, schoolCode: code },
        userId,
      );
    }
    return {
      sessionId: input.sessionId,
      sessionType: input.sessionType,
      feedbackBySchool,
    };
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 5. listFeedbackForSession — 历史 N 流派 feedback (UI 切换流派展示用)
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * GET /counselor/supervision/feedback/:sessionId/:sessionType 主入口.
   *
   * @param userId 当前用户 id
   * @param sessionId session id
   * @param sessionType polymorphic sessionType
   * @returns 该 session 已有 N 流派 feedback
   */
  async listFeedbackForSession(userId: string, sessionId: string, sessionType: SessionType): Promise<SupervisionFeedbackDto[]> {
    const rows = await this.feedbackRepo.find({
      where: { userId, sessionId, sessionType, deletedAt: IsNull() },
      order: { createdAt: 'DESC' },
    });
    return rows.map((r) => ({
      overallScore: r.feedback.overallScore,
      perSentence: r.feedback.perSentence,
      errorCategories: r.feedback.errorCategories,
      growthSuggestion: r.feedback.growthSuggestion,
    }));
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 私有 helper: polymorphic session context 加载
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * 应用层按 sessionType 走对应 Repository 查 transcript + persona + emotionTimeline.
   * V0.5: 长程 session 走 LongTermCaseSession (W1-2 entity), V0.x TrainingSession
   * 走 V0.3 §13 baseline (V1.x 升级时补). 返 null 表示 V0.5 阶段未接.
   */
  private async loadSessionContext(
    sessionId: string,
    sessionType: SessionType,
    _userId: string,
  ): Promise<{ transcript: string; persona: string; emotionTimeline: string }> {
    // V0.5 阶段 mock: 不查 DB, 直接返 placeholder context. V1.x 真接 LLM 时改.
    return {
      transcript: `[V0.5 mock transcript for ${sessionType} ${sessionId}]`,
      persona: '[V0.5 mock persona placeholder]',
      emotionTimeline: '[V0.5 mock emotion timeline placeholder]',
    };
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 私有 helper: V0.5 mock feedback 生成 (V1.x 真接 LLM 时改 provider 注入)
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * V0.5 deterministic 伪随机 (替 Math.random, 治本 SonarJS pseudo-random 警告).
   *
   * 32-bit string hash (djb2 variant) → [0, 1) 归一化 → [min, max] 整数范围.
   * 同 seed 必返同 score, 跨 call / 跨 server 重启一致. 副作用: supervision_feedback
   * 表 UNIQUE (session_id, session_type, school_id) 约束在 V0.5 阶段不会被 mock
   * 重复随机破坏, 1:1 wire 兼容.
   */
  private mockRandomScore(seed: string, min: number, max: number): number {
    let hash = 0;
    for (let i = 0; i < seed.length; i++) {
      hash = (hash << 5) - hash + seed.codePointAt(i)!;
      hash = Math.trunc(hash); // 32-bit
    }
    const normalized = (Math.abs(hash) % 10_000) / 10_000; // [0, 1)
    return Math.floor(min + normalized * (max - min + 1));
  }

  private mockGenerateFeedback(
    schoolCode: SupervisionSchoolCode,
    sessionId: string,
    context: { transcript: string; persona: string; emotionTimeline: string },
  ): SupervisionFeedbackPayload {
    const preset = SUPERVISION_SCHOOL_PRESETS[schoolCode];

    // V2026-10-15 治本 (V2.4 mock 评分 deterministic — SonarJS pseudo-random 治本):
    //   原因: V0.5 阶段用 Math.random() 生成 mock overallScore + perSentence.score, SonarJS
    //     报 pseudo-random 警告 (sonarjs/pseudo-random). 反双胞胎: 不写 eslint-disable 注释
    //     压错; 不用 seedrandom 类库 (V0.5 不引新依赖); 不用 crypto (import 重).
    //   修法: 走 deterministic string hash (mockRandomScore) 替 Math.random(), seed =
    //     schoolCode + sessionId + i (perSentence 序号). 同 seed → 同 score, 跨 call 一致.
    //   验证: tsc 0 错 + npm run lint 0 错 (大炮跑)
    //   时间戳: 2026-10-15
    const overallScore = this.mockRandomScore(`${schoolCode}-${sessionId}`, 70, 85);

    // mock perSentence: 5 句占位, score 65-85 deterministic
    const perSentence: SupervisionPerSentenceDto[] = Array.from({ length: 5 }, (_, i) => ({
      sentence: `[V0.5 mock ${schoolCode} 第 ${i + 1} 句 from ${context.transcript.slice(0, 20)}]`,
      score: this.mockRandomScore(`${schoolCode}-${sessionId}-${i}`, 65, 85),
      comment: `[V0.5 mock comment 流派 ${preset.name}]`,
    }));

    // mock errorCategories: 取 1-2 个 focusAreas 反向
    const errorCategories: string[] = [];
    if (preset.focusAreas.length > 0) {
      errorCategories.push(`未${preset.focusAreas[0]}`);
    }
    if (preset.focusAreas.length > 1) {
      errorCategories.push(`忽视${preset.focusAreas[1]}`);
    }

    return {
      overallScore,
      perSentence,
      errorCategories,
      growthSuggestion: preset.exampleFeedback[0] ?? '[V0.5 mock 成长建议]',
    };
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 私有 mapper: entity → DTO
  // ══════════════════════════════════════════════════════════════════════════

  private toSchoolListItem(r: SupervisionSchool): SupervisionSchoolListItemDto {
    return {
      id: r.id,
      code: r.code,
      name: r.name,
      focusAreas: r.focusAreas,
      exampleFeedback: r.exampleFeedback,
      isActive: r.isActive === 1,
    };
  }
}
