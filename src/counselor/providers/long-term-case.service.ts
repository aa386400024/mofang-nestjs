// V2026-10-15 治本 (V1.4 — long-term-case.service.ts, 5 method 业务逻辑):
//   原因: counselor-mode-v1.0 §6.1 + §4.3 拍板长程 4-12 次会话 + 跨会话 memory + 脱落风险,
//     V0.3 §13 baseline 0 长程, 1:1 wire 0 破坏. V0.5 已有 counselor-home/training/exam/
//     growth/profile 5 service 是内存 mock; 本 V1.x 改造, 长程 service 真接 TypeORM 库.
//   修法 (跟 knowledge-base/providers/search.service.ts V0.x 风格一致):
//     - 5 method: list / createFromPreset / findDetail / appendSession / listTemplates
//     - list(userId): 查用户长程 (status != abandoned 优先, 倒序)
//     - createFromPreset(userId, input): 从 LON_TERM_CASE_PRESETS 拿 5 预设, 序列化进
//       long_term_cases (is_template=0, 走应用层 caseType 校验)
//     - findDetail(userId, caseId): 详情含 sessions + visitorPersona + nextSessionContext
//       (最后一 session 拿 nextSessionContext, V1.2 🆕 跨会话 agent memory 入口)
//     - appendSession(userId, caseId, sessionData): 增 1 session + 累加 dropoutRiskScore
//       + 写 nextSessionContext + 自动转 status=completed (currentSession > totalSessions)
//     - listTemplates(): 5 预设模板列表 (is_template=1, UI 选择长程时展示)
//
//   5 段治本 (V1.4 脱落风险公式):
//     - 公式: score < 60 → +0.15 / 60-80 → +0.08 / >= 80 → +0.03 (V0.x 简化线性累加, V2.x LLM 升级)
//     - 阈值: dropoutRiskScore > 0.7 触发 abandonmentSuggestion 提示用户
//     - 简化: V0.x 不写 ML, 简单线性; 跟 V0.2 spec §13.4 风格一致
//
//   反双胞胎:
//     - 不写 5 流派督导 prompt: V1.x W3-4 独立 VS, 本 slice 不蔓延
//     - 不预生成 4-12 次完整对话: 用户每次触发, LLM 实时生成, memory 跨会话累积
//     - 不写 LLM 调用: W1-2 阶段先跑通数据层 + API 层, LLM 接在 W3-4 多流派督导一起做
//     - 不复用 persona table: long-term visitorPersona 比 V0.x persona 多 progressCurve
//
//   验证:
//     1. tsc 0 错 (5 method 字段 type 严格)
//     2. 大炮跑 pnpm migration:run + curl 验 3 endpoint 端到端
//     3. 大炮跑 integration: 5 预设全列 / 创 1 走通 / 详情含 sessions
//
//   时间戳: 2026-10-15

import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';

import { LON_TERM_CASE_PRESETS } from '../config/long-term-case-presets';
import {
  type CreateLongTermCaseDto,
  type LongTermCaseDetailDto,
  type LongTermCaseListItemDto,
  type LongTermCaseSessionListItemDto,
  type NextSessionContextDto,
} from '../dto/long-term-case.dto';
import { LongTermCaseSession, type NextSessionContext } from '../entities/long-term-case-session.entity';
import { LongTermCase } from '../entities/long-term-case.entity';
import { LongTermCaseStatus } from '../enums/long-term-case-status.enum';

/**
 * V2026-10-15 (V1.x counselor-mode W1-2 — LongTermCaseService):
 *   长程个案 4-12 次会话 + 跨会话 agent memory 业务逻辑.
 *
 *   跟 xin_su_app LongTermCaseBloc + LongTermCaseRepository 端到端 1:1 对应.
 *   V1.x 真接库 (V0.5 内存 mock 阶段已过).
 */
@Injectable()
export class LongTermCaseService {
  constructor(
    @InjectRepository(LongTermCase)
    private readonly caseRepo: Repository<LongTermCase>,
    @InjectRepository(LongTermCaseSession)
    private readonly sessionRepo: Repository<LongTermCaseSession>,
  ) {}

  // ══════════════════════════════════════════════════════════════════════════
  // 1. list — 查用户所有长程 (active 优先, 按 currentSession 倒序)
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * GET /counselor/long-term-cases 主入口.
   *
   * @param userId 当前用户 id (从 JWT @CurrentUser 注入)
   * @returns 倒序长程列表 (active 优先, abandoned 末)
   */
  async list(userId: string): Promise<LongTermCaseListItemDto[]> {
    const rows = await this.caseRepo.find({
      where: { userId, isTemplate: 0, deletedAt: IsNull() },
      order: { status: 'ASC', currentSession: 'DESC', createdAt: 'DESC' },
    });
    return rows.map((r) => this.toListItem(r));
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 2. createFromPreset — 从 5 预设创 user instance
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * POST /counselor/long-term-cases 主入口.
   *
   * @param userId 当前用户 id
   * @param input 创建输入 (caseType 5 选 1, customTitle 可选)
   * @returns 新建长程 list item
   */
  async createFromPreset(userId: string, input: CreateLongTermCaseDto): Promise<LongTermCaseListItemDto> {
    const preset = LON_TERM_CASE_PRESETS[input.caseType];
    if (!preset) {
      throw new BadRequestException(`caseType "${input.caseType}" 不在 5 预设之内 (workplace/relationship/parenting/grief/anxiety)`);
    }

    // V0.x: tenantId = userId (一人一租户, A9). V1.x 多租户上线后 backfill.
    const entity = this.caseRepo.create({
      tenantId: userId,
      userId,
      caseType: input.caseType,
      title: input.customTitle ?? preset.title,
      config: {
        progressCurve: preset.progressCurve,
        description: preset.description,
        startedAt: new Date().toISOString(),
      },
      visitorPersona: preset.visitorPersona,
      currentSession: 1,
      totalSessions: preset.totalSessions,
      dropoutRiskScore: 0,
      isTemplate: 0,
      status: LongTermCaseStatus.ACTIVE,
    });

    const saved = await this.caseRepo.save(entity);
    return this.toListItem(saved);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 3. findDetail — 详情含 sessions + visitorPersona + nextSessionContext
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * GET /counselor/long-term-cases/:id 主入口.
   *
   * @param userId 当前用户 id (跨用户访问检测)
   * @param caseId 长程个案 id
   * @returns 详情 (含 sessions 数组 + visitorPersona + 最后一 session nextSessionContext)
   */
  async findDetail(userId: string, caseId: string): Promise<LongTermCaseDetailDto> {
    const row = await this.caseRepo.findOne({
      where: { id: caseId, userId, isTemplate: 0, deletedAt: IsNull() },
    });
    if (!row) {
      throw new NotFoundException(`长程个案 ${caseId} 不存在或不属于当前用户`);
    }

    // 单独查 sessions (不依赖 entity @OneToMany 自动 join, 防 N+1 + 显式 sort).
    const sessions = await this.sessionRepo.find({
      where: { caseId, deletedAt: IsNull() },
      order: { sessionNumber: 'ASC' },
    });

    // 🆕 V1.2 跨会话 agent memory: 拿最后一 session 的 nextSessionContext.
    const lastSession = sessions.at(-1);
    const nextSessionContext: NextSessionContextDto | null = lastSession?.nextSessionContext
      ? this.toNextSessionContextDto(lastSession.nextSessionContext)
      : null;

    // V1.4 脱落建议: dropoutRiskScore > 0.7 触发.
    const abandonmentSuggestion =
      row.dropoutRiskScore > 0.7 ? `本次长程脱落风险已达 ${(row.dropoutRiskScore * 100).toFixed(0)}%, 建议考虑结束咨询或调整方案` : null;

    return {
      ...this.toListItem(row),
      visitorPersona: row.visitorPersona,
      sessions: sessions.map((s) => this.toSessionListItem(s)),
      nextSessionContext,
      abandonmentSuggestion,
    };
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 4. appendSession — 增 1 session + 累加 dropoutRiskScore + 写 nextSessionContext
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * 内部 method: 1 session 完成时调用.
   *
   * @param userId 当前用户 id
   * @param caseId 长程个案 id
   * @param sessionData 1 session 数据 (transcript + overallScore + durationSeconds + nextSessionContext)
   * @returns 新的 sessionNumber
   */
  async appendSession(
    userId: string,
    caseId: string,
    sessionData: {
      transcript: LongTermCaseSession['transcript'];
      overallScore: number | null;
      durationSeconds: number;
      nextSessionContext: NextSessionContext | null;
    },
  ): Promise<{ sessionNumber: number; newStatus: LongTermCaseStatus }> {
    const longTermCase = await this.caseRepo.findOne({
      where: { id: caseId, userId, isTemplate: 0, deletedAt: IsNull() },
    });
    if (!longTermCase) {
      throw new NotFoundException(`长程个案 ${caseId} 不存在或不属于当前用户`);
    }
    if (longTermCase.status !== LongTermCaseStatus.ACTIVE) {
      throw new BadRequestException(`长程个案 ${caseId} 状态为 ${longTermCase.status}, 不能继续追加 session`);
    }
    if (longTermCase.currentSession > longTermCase.totalSessions) {
      throw new BadRequestException(`长程个案 ${caseId} 已完成全部 ${longTermCase.totalSessions} 次会话`);
    }

    // 1. 创 session
    const sessionEntity = this.sessionRepo.create({
      tenantId: userId,
      caseId,
      sessionNumber: longTermCase.currentSession,
      transcript: sessionData.transcript,
      supervisionFeedback: null, // V1.x W3-4 多流派督导接
      overallScore: sessionData.overallScore,
      nextSessionContext: sessionData.nextSessionContext,
      durationSeconds: sessionData.durationSeconds,
    });
    await this.sessionRepo.save(sessionEntity);

    // 2. 累加脱落风险 (V1.4 公式: score 越低累加越多, 简化线性, V2.x 升级 LLM 推理)
    const newDropoutRisk = this.computeNewDropoutRisk(longTermCase.dropoutRiskScore, sessionData.overallScore);
    const newCurrentSession = longTermCase.currentSession + 1;

    // 3. 判断是否完成 (currentSession > totalSessions 走完最后一 session 算 completed)
    const newStatus = newCurrentSession > longTermCase.totalSessions ? LongTermCaseStatus.COMPLETED : LongTermCaseStatus.ACTIVE;

    // 4. 写回 case 元数据
    longTermCase.dropoutRiskScore = newDropoutRisk;
    longTermCase.currentSession = newCurrentSession;
    longTermCase.status = newStatus;
    await this.caseRepo.save(longTermCase);

    return { sessionNumber: longTermCase.currentSession, newStatus };
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 5. listTemplates — 5 预设模板列表 (UI 选择长程时展示)
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * GET /counselor/long-term-cases/templates 内部 method (不暴露给 client, 走 service 内部读).
   *
   * @returns 5 预设模板 list (跟 LON_TERM_CASE_PRESETS 1:1)
   */
  async listTemplates(): Promise<LongTermCaseListItemDto[]> {
    // 5 预设走静态 config, 不查 DB. V1.x V2.x 想真存 DB, 走 seed migration + is_template=1.
    return Object.values(LON_TERM_CASE_PRESETS).map((preset) => ({
      id: `template-${preset.caseType}`,
      caseType: preset.caseType,
      title: preset.title,
      description: preset.description,
      currentSession: 0,
      totalSessions: preset.totalSessions,
      status: LongTermCaseStatus.ACTIVE,
      progressCurve: preset.progressCurve,
      dropoutRiskScore: 0,
      createdAt: new Date(0).toISOString(),
    }));
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 私有 helper: 脱落风险累加 (V1.4 公式)
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * V1.4 脱落风险累加公式 (跟 long-term-case.entity.ts 注释 1:1).
   *
   * 反双胞胎: V0.x 阶段不写 ML 模型, 简单线性累加. V2.x 升级时切 LLM 推理累积权重.
   */
  private computeNewDropoutRisk(currentRisk: number, sessionScore: number | null): number {
    if (sessionScore === null) {
      // 缺评分时保守不累加 (默认信任, 跟 V0.x 5 维度有 N/A 同 pattern).
      return Math.min(currentRisk, 1);
    }
    let delta = 0;
    if (sessionScore < 60) {
      delta = 0.15;
    } else if (sessionScore < 80) {
      delta = 0.08;
    } else {
      delta = 0.03;
    }
    return Math.min(currentRisk + delta, 1);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 私有 mapper: entity → DTO
  // ══════════════════════════════════════════════════════════════════════════

  private toListItem(r: LongTermCase): LongTermCaseListItemDto {
    return {
      id: r.id,
      caseType: r.caseType,
      title: r.title,
      description: r.config.description,
      currentSession: r.currentSession,
      totalSessions: r.totalSessions,
      status: r.status,
      progressCurve: r.config.progressCurve,
      dropoutRiskScore: r.dropoutRiskScore,
      createdAt: r.createdAt.toISOString(),
    };
  }

  private toSessionListItem(s: LongTermCaseSession): LongTermCaseSessionListItemDto {
    return {
      id: s.id,
      sessionNumber: s.sessionNumber,
      overallScore: s.overallScore,
      durationSeconds: s.durationSeconds,
      createdAt: s.createdAt.toISOString(),
    };
  }

  private toNextSessionContextDto(c: NextSessionContext): NextSessionContextDto {
    return {
      currentEmotion: c.currentEmotion,
      topic: c.topic,
      usedTechniques: c.usedTechniques,
      counselorStrengths: c.counselorStrengths,
      counselorWeaknesses: c.counselorWeaknesses,
    };
  }
}
