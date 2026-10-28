// V2026-10-21 治本 (V1.2 VS-C — M2 知情同意 service):
//   原因: v1.2 spec §5.2 模拟层双重授权「用户必须在对话中跟 AI 来访完成知情同意 4 要素,
//     缺失任意 1 项 AI 来访会主动追问, 督导报告记为『知情同意缺失』」+ §5.4 两个 API:
//     - PATCH /counselor/training-sessions/:id/consent/mark  判定 4 要素覆盖
//     - GET  /counselor/training-sessions/:id/consent        查当前进度
//   修法: InformedConsentService 2 method:
//     - getStatus 读进度 (4 要素逐项 covered + 已讲全计数)
//     - judge     调 LLM 判定 → 落 informed_consent_transcript + informed_consent_passed
//   反双胞胎:
//     - 不写进 user_consent 表: spec §5.3 明确 src/consent 是**产品合规层**
//       (真人用户 ↔ 产品), M2 是**训练业务层** (受训咨询师 ↔ AI 来访), 两者完全正交不复用表.
//       若把训练结果写进 user_consents, 会污染产品的隐私协议同意记录 (法律语义完全不同)
//     - 不用 rule-based 关键词判定: "讲全没讲全" 是语义判断 (讲了一半 ≠ 讲全), 关键词必然误判;
//       LLM 判定 + 严格 schema 校验是当前唯一靠谱做法
//     - 不在 getStatus 里调 LLM: 读进度是高频前端轮询, 每次都调 LLM 是不必要的成本
//     - 判定失败不写库: 半份判定结果比没有更糟 (前端会按它显示"已讲 2/4", 实际是错的)
//   验证:
//     1. tsc 0 错
//     2. 大炮 PATCH /consent/mark 传一段"只讲了保密原则"的转录 → 4 要素里只有 confidentiality covered
//     3. 再 GET /consent → 元素进度与判定结果一致
//   时间戳: 2026-10-21

import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';

import { CounselorLlmJsonClient } from './llm-json.client';
import { COUNSELOR_LLM_PROFILES } from '../config/counselor-llm.config';
import { buildConsentJudgeUserPrompt, CONSENT_JUDGE_SCHEMA_DESCRIPTION, CONSENT_JUDGE_SYSTEM_PROMPT } from '../config/session-core-prompts';
import { type InformedConsentEntry, validateInformedConsentEntries } from '../domain/session-core/session-core.types';
import { type InformedConsentMarkDto, type InformedConsentMarkResultDto, type InformedConsentStatusDto } from '../dto/session-core.dto';
import { TrainingSession } from '../entities/training-session.entity';
import { InformedConsentElement } from '../enums/informed-consent-element.enum';

/**
 * 知情同意 service (M2).
 */
@Injectable()
export class InformedConsentService {
  private readonly logger = new Logger(InformedConsentService.name);

  constructor(
    @InjectRepository(TrainingSession)
    private readonly sessionRepo: Repository<TrainingSession>,
    private readonly llmJson: CounselorLlmJsonClient,
  ) {}

  // ══════════════════════════════════════════════════════════════════════════
  // 1. getStatus — 查 4 要素进度
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * GET /counselor/training-sessions/:id/consent.
   *
   * @param userId 当前用户 id
   * @param sessionId 会话 id
   * @throws NotFoundException 会话不存在 / 不属于当前用户
   */
  async getStatus(userId: string, sessionId: string): Promise<InformedConsentStatusDto> {
    const session = await this.loadSession(userId, sessionId);
    const required = session.informedConsentRequired === 1;
    const elements = session.informedConsentTranscript ?? [];

    return {
      sessionId,
      required,
      // 不需要走知情同意环节 → 视为"无需通过" (否则前端会显示"未通过", 用户困惑).
      // 督导报告侧的"知情同意缺失"判定用的是 (required && !passed), 两者口径一致.
      passed: required ? session.informedConsentPassed === 1 : true,
      elements: elements.map((e) => ({
        element: e.element,
        covered: e.covered,
        visitorResponse: e.visitorResponse,
        coveredAtTurn: e.coveredAtTurn,
      })),
      coveredCount: `${elements.filter((e) => e.covered).length}/${Object.keys(InformedConsentElement).length}`,
    };
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 2. judge — LLM 判定 4 要素覆盖
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * PATCH /counselor/training-sessions/:id/consent/mark.
   *
   * @param userId 当前用户 id
   * @param sessionId 会话 id
   * @param input 同意阶段转录
   * @returns 判定结果
   * @throws BadRequestException 判定失败 (不落库)
   */
  async judge(userId: string, sessionId: string, input: InformedConsentMarkDto): Promise<InformedConsentMarkResultDto> {
    const session = await this.loadSession(userId, sessionId);

    const profile = COUNSELOR_LLM_PROFILES.consentJudgement;
    const result = await this.llmJson.requestJson<InformedConsentEntry[]>({
      systemPrompt: CONSENT_JUDGE_SYSTEM_PROMPT,
      userPrompt: buildConsentJudgeUserPrompt(input.turns),
      schemaDescription: CONSENT_JUDGE_SCHEMA_DESCRIPTION,
      validate: validateInformedConsentEntries,
      maxCompletionTokens: profile.maxCompletionTokens,
      reasoningEffort: profile.reasoningEffort,
      timeoutMs: profile.timeoutMs,
      tenantId: session.tenantId,
      userId,
    });

    if (!result.ok || result.data === null) {
      // 判定失败不写库: 半份判定比没有更糟 (前端会按它显示"已讲 2/4", 实际是错的)
      this.logger.error(
        `[consent_judge_failed] session=${sessionId} code=${result.errorCode ?? 'unknown'} ` +
          `msg=${(result.errorMessage ?? '').slice(0, 200)}`,
      );
      throw new BadRequestException(`知情同意判定失败 (${result.errorCode ?? 'unknown'}): ${result.errorMessage ?? 'LLM 不可用'}`);
    }

    // 4 要素必须齐全 (模型漏一个就补一条 uncovered, 不让前端出现"3/4"这种错位计数)
    const entries = this.ensureAllElements(result.data);
    const passed = entries.every((e) => e.covered);

    session.informedConsentTranscript = entries;
    session.informedConsentPassed = passed ? 1 : 0;
    await this.sessionRepo.save(session);

    return {
      sessionId,
      passed,
      elements: entries.map((e) => ({
        element: e.element,
        covered: e.covered,
        visitorResponse: e.visitorResponse,
        coveredAtTurn: e.coveredAtTurn,
      })),
    };
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 私有 helper
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * 取 1 个属于当前用户的会话 (软删过滤).
   *
   * @param userId 当前用户 id
   * @param sessionId 会话 id
   * @throws NotFoundException 不存在 / 不属于当前用户
   */
  private async loadSession(userId: string, sessionId: string): Promise<TrainingSession> {
    const row = await this.sessionRepo.findOne({
      where: { id: sessionId, userId, deletedAt: IsNull() },
    });
    if (!row) {
      throw new NotFoundException(`训练会话 ${sessionId} 不存在或不属于当前用户`);
    }
    return row;
  }

  /**
   * 补齐缺失的要素 (模型漏判某要素 → 补一条 covered=false).
   *
   * 为什么要补: 前端按数组长度算"已讲 N/4", 漏一个元素会让计数错位;
   * 且"模型没提到某要素"在业务上就等于"没讲全".
   *
   * @param entries 模型判定的要素
   */
  private ensureAllElements(entries: InformedConsentEntry[]): InformedConsentEntry[] {
    const byElement = new Map(entries.map((e) => [e.element, e]));
    const result: InformedConsentEntry[] = [];
    for (const element of Object.values(InformedConsentElement)) {
      const found = byElement.get(element);
      result.push(
        found ?? {
          element,
          covered: false,
          visitorResponse: '来访未追问',
          coveredAtTurn: null,
        },
      );
    }
    return result;
  }
}
