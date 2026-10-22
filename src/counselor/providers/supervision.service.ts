// V2026-10-15 治本 (V2.4 — supervision.service.ts, 5 method 业务逻辑):
//   原因: counselor-mode-v1.0 §4.6 + §6.2 拍板 4 流派督导 + polymorphic feedback,
//     V0.3 §8 baseline 0 督导持久化 service, 1:1 wire 0 破坏. V0.5 阶段 mock:
//     service.generateFeedback 内部用 SUPERVISION_SCHOOL_PRESETS promptTemplate
//     拼接 transcript + persona + emotionTimeline, 返 4 字段结构化 feedback.
//
//   修法 (跟 knowledge-base/providers/search.service.ts V0.x 风格一致):
//     - 5 method: listSchools / findSchoolByCode / generateFeedback / compareFeedback / listFeedbackForSession
//     - listSchools(): 4 流派 list (从 DB 读, isActive=1, 软删过滤)
//     - findSchoolByCode(code): 单流派详情 (含 promptTemplate)
//
//   反双胞胎:
//     - 不复用 V0.x supervisionReport json 字段: 破坏 1:1 wire
//     - 不用 hardcode 4 流派: 走 DB 读 supervision_schools, 未来 B 端 / 海外扩展只 INSERT
//     - polymorphic sessionId 走应用层校验 + 对应 Repository 查 transcript, 不写 DB-level
//       polymorphic FK (跟 knowledge_chunks.itemId V0.x pattern 一致)
//
//   验证:
//     1. tsc 0 错 (5 method 字段 type 严格)
//     2. 大炮跑 pnpm migration:run + curl 验 3 endpoint 端到端
//     3. integration: 4 流派 list / 生成 1 流派 / 多流派对比
//
//   时间戳: 2026-10-15
//
// ─────────────────────────────────────────────────────────────────────────────
// V2026-10-21 治本 (V1.2 VS-A — 督导反馈从 mock 切真接 LLM):
//   原因: v1.2 的 5 个功能全部依赖 LLM 分析 (知情同意 4 要素判定 / 实时轻提示 /
//     techStats 技术统计 / 亮点+替代回应+风险点评 / case_profile_entries 抽取),
//     但本 service 至今仍是 **0 次 LLM 调用** 的纯规则 mock: generateFeedback 走
//     mockGenerateFeedback, overallScore 是 `70 + (focusAreaCount - sentenceCount * 0.5)`
//     的伪随机数, perSentence 是 5 条 `[V0.5 mock ...]` 占位串.
//     后果: 学员拿到的"督导结论"全是假的, 而 v1.2 的 M5 还要在这上面叠加风险点评.
//     同时 loadSessionContext 也是 placeholder, 根本没查库.
//   修法 (本轮 4 改):
//     - generateFeedback: 真接 CounselorLlmJsonClient, prompt 用 DB 里 supervision_schools
//       的 promptTemplate (4 流派差异化模板, 占位符 {persona}/{transcript}/{emotionTimeline}
//       由 SessionContext 渲染块填充), schema 用 4 字段契约, 校验失败即报错
//     - loadSessionContext: 删 placeholder, 改走 SessionContextBuilder (polymorphic,
//       TRAINING_SESSION / LONG_TERM_CASE_SESSION 各走各的表, 统一成 SessionContext)
//     - 重复生成改 upsert: supervision_feedback 上有 UNIQUE (session_id, session_type, school_id),
//       旧代码每次都 insert → 同一 (session, 流派) 第二次生成必撞唯一索引. 改为
//       "存在则更新 feedback 字段, 不存在则插入", 顺带解决 client 重试 / BullMQ 重试
//     - compareFeedback 改 Promise.all 并行: 真接 LLM 后单流派 30-120s, 串行 3 流派 = 6 分钟,
//       HTTP 必超时. 官方文档口径下 2-3 个并发是安全的 (上游限流阈值远高于此)
//   反双胞胎:
//     - 不保留 mock 兜底: 假分数会被当成真实督导结论误导学员 (V0.5 阶段 mock 是因为本来就没接
//       LLM, 现在接了还兜底就是压错). LLM 失败 → ServiceUnavailableException, 客户端重试
//     - 不把 prompt 模板写死在本 service: 走 supervision_schools.promptTemplate (DB 可运营可改)
//     - 不用 temperature 控确定性: 官方文档明确 M3.1-Flash 忽略 temperature/top_p (固定 1/0.95),
//       确定性靠 prompt 约束 + reasoning_effort 分档 (见 config/counselor-llm.config.ts)
//   验证:
//     1. tsc 0 错
//     2. 大炮跑 POST /counselor/supervision/feedback → 返真 LLM 评分 (不再是 70-85 伪随机)
//     3. 同一 (session, 流派) 连续生成 2 次 → 第二次不报唯一索引冲突 (upsert 生效)
//     4. 故意把 MINIMAX_COUNSELOR_LLM_MODEL 设成不存在的模型 → 返 503 且不落脏数据
//   时间戳: 2026-10-21

import { BadRequestException, Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';

import { CounselorLlmJsonClient } from './llm-json.client';
import { SessionContextBuilder } from './session-context.builder';
import { COUNSELOR_LLM_PROFILES } from '../config/counselor-llm.config';
import {
  buildSupervisionContextBlock,
  renderPersonaBlock,
  renderTranscriptBlock,
  type SessionContext,
} from '../domain/session-context/session-context';
import { validateSessionTechStats, type SessionTechStats } from '../domain/session-core/session-core.types';
import {
  type CompareSupervisionFeedbackResponseDto,
  type GenerateSupervisionFeedbackDto,
  type SupervisionFeedbackDto,
  type SupervisionSchoolDetailDto,
  type SupervisionSchoolListItemDto,
} from '../dto/supervision.dto';
import { LongTermCaseSession } from '../entities/long-term-case-session.entity';
import { SupervisionFeedback, type SupervisionFeedbackPayload } from '../entities/supervision-feedback.entity';
import { SupervisionSchool } from '../entities/supervision-school.entity';
import { TrainingSession } from '../entities/training-session.entity';
import { SessionType } from '../enums/session-type.enum';
import { SupervisionSchoolCode } from '../enums/supervision-school-code.enum';

/**
 * 4 字段输出契约 (给模型看的 JSON schema 描述).
 *
 * 跟 SupervisionFeedbackPayload 1:1, 跟 V0.5 client SupervisionFeedback entity 1:1.
 */
const SUPERVISION_SCHEMA_DESCRIPTION = `输出 JSON 结构 (必须严格符合, 字段名不可改):
{
  "overallScore": 0-100 的整数,
  "perSentence": [{ "sentence": "咨询师原句", "score": 0-100 的整数, "comment": "1-2 句点评" }],
  "errorCategories": ["问题分类 1", "问题分类 2"],
  "growthSuggestion": "1-3 句成长建议",
  "techStats": {
    "questionTypes": { "open": 0, "closed": 0, "semi": 0 },
    "interventions": { "reflection": 0, "paraphrase": 0, "summary": 0, "confrontation": 0, "interpretation": 0, "advice": 0 },
    "behavior": { "interruptions": 0, "silenceMs": 0, "topicJumps": 0 },
    "commentary": "技术统计的一句话点评"
  }
}
要求: perSentence 最多 8 条, 优先标注最有教学价值的咨询师发言; errorCategories 最多 5 个,
无明显问题可给空数组; growthSuggestion 必须是可执行的下次具体做法, 不要泛泛而谈.

techStats 是会谈技术统计仪表盘的原始数据 (spec §6.3):
- questionTypes: 开放式 / 封闭式 / 半开放式提问的**次数**
- interventions: 共情/释义/总结/面质/解释/建议 各自**次数**
- behavior: 打断来访次数 / 沉默总时长(毫秒) / 议题跳转次数
- commentary: 一句话点评技术统计里最值得注意的倾向
只统计逐字稿里**真实出现**的, 不要推测; 没把握就填 0.`;

/**
 * 校验 LLM 输出的 4 字段 payload.
 *
 * @param raw JSON.parse 后的未知值
 * @returns 合法返回规范化后的 payload; 非法返回 null (由 client 转成 schema_validation_failed)
 */
// V2026-10-21 治本 (V1.2 VS-A 第 1 轮 tsc 修复 — TS4111 索引签名属性访问):
//   原因: 本函数把 LLM 返回的 JSON 当 `Record<string, unknown>` 处理, 用点号取字段
//     (obj.overallScore). 但项目 tsconfig.json 开了 `noPropertyAccessFromIndexSignature: true`
//     —— 索引签名来源的属性**必须**用方括号访问, 否则 tsc 报 TS4111.
//     本轮 build 实测 11 处 TS4111 (obj.overallScore / obj.perSentence / turn.sentence /
//     turn.comment / turn.score / obj.errorCategories / obj.growthSuggestion).
//     根因是写代码时没预判这个编译开关 (其余 13 个改动文件都过了, 说明只有"对 unknown
//     做字典取值"这一种写法触发).
//   修法: 全部改方括号取值 obj['overallScore'] / turn['sentence'] / ...
//     运行时行为完全不变 (JS 里 obj.x 与 obj['x'] 等价), 只为满足编译期约束.
//   反双胞胎:
//     - 不写 `// @ts-expect-error` 或 `// @ts-ignore` 压错: 那是把编译期约束藏起来, 下一个人
//       复制这段代码会再踩一次; 方括号是本项目的正确写法
//     - 不把 Record<string, unknown> 改成 any: any 会连带关掉后续所有类型检查
//     - 不用类型守卫函数包一层 (getString(obj, 'x')): 本函数只 7 处取值, 包一层反而多一层
//       间接, 且要额外处理"字段缺失"的返回值分支
//   验证:
//     1. npx tsc -p tsconfig.build.json --noEmit → 本文件 0 错
//     2. 大炮跑 curl 生成督导反馈 → 返真 LLM 评分 (校验逻辑行为未变)
//   时间戳: 2026-10-21 14:40 GMT+8
export function validateSupervisionPayload(raw: unknown): SupervisionFeedbackPayload | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return null;
  }
  const obj = raw as Record<string, unknown>;

  const overallScore = obj['overallScore'];
  if (typeof overallScore !== 'number' || !Number.isFinite(overallScore)) {
    return null;
  }

  const perSentenceRaw = obj['perSentence'];
  if (!Array.isArray(perSentenceRaw)) {
    return null;
  }
  const perSentence: SupervisionFeedbackPayload['perSentence'] = [];
  for (const item of perSentenceRaw) {
    if (typeof item !== 'object' || item === null) {
      continue;
    }
    const turn = item as Record<string, unknown>;
    const sentence = turn['sentence'];
    const comment = turn['comment'];
    if (typeof sentence !== 'string' || typeof comment !== 'string') {
      continue;
    }
    const rawScore = turn['score'];
    const score = typeof rawScore === 'number' && Number.isFinite(rawScore) ? rawScore : 0;
    perSentence.push({
      sentence,
      score: Math.min(100, Math.max(0, Math.round(score))),
      comment,
    });
  }

  const errorCategoriesRaw = obj['errorCategories'];
  if (!Array.isArray(errorCategoriesRaw)) {
    return null;
  }
  const errorCategories = errorCategoriesRaw
    .filter((c): c is string => typeof c === 'string')
    .map((c) => c.trim())
    .filter((c) => c.length > 0);

  const growthSuggestion = obj['growthSuggestion'];
  if (typeof growthSuggestion !== 'string') {
    return null;
  }

  return {
    overallScore: Math.min(100, Math.max(0, Math.round(overallScore))),
    perSentence,
    errorCategories,
    growthSuggestion,
  };
}

/**
 * 督导分析的完整结果 (4 字段反馈 + 技术统计).
 */
export interface SupervisionAnalysisResult {
  /** 督导反馈正文 (落 supervision_feedback.feedback, 契约不变) */
  readonly feedback: SupervisionFeedbackPayload;
  /** 技术统计 (落 session 表的 tech_stats 列; 模型没给就 null) */
  readonly techStats: SessionTechStats | null;
}

/**
 * 校验督导分析的完整输出 (4 字段反馈 + techStats).
 *
 * V2026-10-21 治本 (V1.2 VS-C — M3.3 技术统计同一次 LLM 调用产出):
 *   原因: spec §6.3「督导 LLM 在生成 supervision_feedback 时, 额外输出一个 techStats JSON
 *     (复用同一次 LLM 调用, 不额外花钱)」—— 所以校验要从"4 字段"扩到"4 字段 + techStats".
 *   修法: 复用已有的 validateSupervisionPayload (4 字段契约**完全不变**, 0 破坏),
 *     再叠加 validateSessionTechStats.
 *   反双胞胎:
 *     - techStats 非法**不**让整份督导失败: 督导反馈是主产物, 技术统计是副产物;
 *       副产物畸形不该把主产物一起丢掉 → techStats 降级为 null, 报告照常出
 *     - 不把 techStats 塞进 supervision_feedback.feedback json: 那是"督导反馈正文"契约,
 *       塞进去会污染 4 字段的 1:1 wire (前端 DTO 读不到但数据在, 以后排查会踩坑);
 *       spec §6.3 也明确它落在 session 表的**新字段**上
 *     - 不额外调一次 LLM 专门算 techStats: spec 明确"复用同一次调用, 不额外花钱"
 *   验证: 1. tsc 0 错  2. 跑一次督导 → session 表 tech_stats 有值, 4 字段反馈不受影响
 *   时间戳: 2026-10-21
 */
export function validateSupervisionAnalysis(raw: unknown): SupervisionAnalysisResult | null {
  const feedback = validateSupervisionPayload(raw);
  if (!feedback) {
    return null;
  }
  const rawObj = raw as Record<string, unknown>;
  const techStats = validateSessionTechStats(rawObj['techStats']);
  return { feedback, techStats };
}

/**
 * V2026-10-15 (V1.x counselor-mode W3-4 — SupervisionService):
 *   4 流派督导 + polymorphic sessionId feedback 业务逻辑.
 *
 *   V2026-10-21 (V1.2 VS-A): 真接 LLM, 详见文件头治本注释.
 */
@Injectable()
export class SupervisionService {
  private readonly logger = new Logger(SupervisionService.name);

  constructor(
    @InjectRepository(SupervisionSchool)
    private readonly schoolRepo: Repository<SupervisionSchool>,
    @InjectRepository(SupervisionFeedback)
    private readonly feedbackRepo: Repository<SupervisionFeedback>,
    // V2026-10-21 治本 (V1.2 VS-C — tech_stats 回写):
    //   原因: spec §6.3 要求技术统计写在 **session 表**的 tech_stats 列
    //     (training_sessions / long_term_case_sessions), 而督导反馈写在 supervision_feedback 表,
    //     两者是不同的表 → 需要能写 session 表的 Repository.
    @InjectRepository(TrainingSession)
    private readonly trainingSessionRepo: Repository<TrainingSession>,
    @InjectRepository(LongTermCaseSession)
    private readonly longTermSessionRepo: Repository<LongTermCaseSession>,
    private readonly llmJson: CounselorLlmJsonClient,
    private readonly contextBuilder: SessionContextBuilder,
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
  // 2. findSchoolByCode — 单流派详情 (含 promptTemplate)
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
  // 3. generateFeedback — 1 session + 1 流派 → 4 字段结构化 feedback (真接 LLM)
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * POST /counselor/supervision/feedback 主入口.
   *
   * @param input { sessionId, sessionType, schoolCode }
   * @param userId 当前用户 id
   * @returns 4 字段结构化 feedback (真接 LLM)
   * @throws BadRequestException 会话没有对话记录 / 流派不存在
   * @throws ServiceUnavailableException LLM 调用失败 (不落脏数据, 客户端可重试)
   */
  async generateFeedback(input: GenerateSupervisionFeedbackDto, userId: string): Promise<SupervisionFeedbackDto> {
    // 1. 查流派 (应用层校验)
    const school = await this.schoolRepo.findOne({
      where: { code: input.schoolCode, deletedAt: IsNull() },
    });
    if (!school) {
      throw new NotFoundException(`督导流派 ${input.schoolCode} 不存在`);
    }

    // 2. polymorphic: 查 session 上下文 (真实 transcript, 不再是 placeholder)
    const ctx = await this.contextBuilder.build(userId, input.sessionId, input.sessionType);
    if (ctx.transcript.length === 0) {
      throw new BadRequestException(`会话 ${input.sessionId} 没有对话记录, 无法生成督导反馈`);
    }

    // 3. 真接 LLM: 4 流派 prompt 模板 (DB) + 会话上下文块 → 结构化 4 字段
    const profile = COUNSELOR_LLM_PROFILES.supervision;
    const result = await this.llmJson.requestJson<SupervisionAnalysisResult>({
      systemPrompt: this.buildSchoolSystemPrompt(school.promptTemplate, ctx),
      userPrompt: buildSupervisionContextBlock(ctx),
      schemaDescription: SUPERVISION_SCHEMA_DESCRIPTION,
      validate: validateSupervisionAnalysis,
      maxCompletionTokens: profile.maxCompletionTokens,
      reasoningEffort: profile.reasoningEffort,
      timeoutMs: profile.timeoutMs,
      tenantId: ctx.tenantId,
      userId,
    });

    if (!result.ok || result.data === null) {
      // 不落脏数据: 假督导结论比报错更糟 (学员会当成真实反馈去改技术动作)
      throw new ServiceUnavailableException(`督导反馈生成失败 (${result.errorCode ?? 'unknown'}): ${result.errorMessage ?? 'LLM 不可用'}`);
    }
    const { feedback, techStats } = result.data;

    // 4. 落 supervision_feedback 表 (upsert: UNIQUE (session_id, session_type, school_id))
    const existing = await this.feedbackRepo.findOne({
      where: {
        sessionId: input.sessionId,
        sessionType: input.sessionType,
        schoolId: school.id,
        deletedAt: IsNull(),
      },
    });
    if (existing) {
      existing.feedback = feedback;
      await this.feedbackRepo.save(existing);
    } else {
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
    }

    // 5. 回写技术统计到 session 表 (spec §6.3「写在 session 的新字段上」)
    //
    // V2026-10-21 治本 (V1.2 VS-C — M3.3 tech_stats 落 session 表):
    //   原因: 技术统计的落点是 **session 表** (training_sessions / long_term_case_sessions
    //     的 tech_stats 列), 不是 supervision_feedback.feedback (那是督导反馈正文契约).
    //   反双胞胎:
    //     - 不把 techStats 塞进 feedback json: 会污染 4 字段的 1:1 wire (前端 DTO 读不到
    //       但数据在, 以后排查会踩坑)
    //     - techStats 为 null 时不写: 模型没给统计 → 不覆盖已有值 (宁缺勿错)
    //     - 写失败不阻断督导反馈: 统计是副产物, 督导报告才是主产物
    if (techStats) {
      try {
        await this.writeTechStats(userId, input.sessionId, input.sessionType, techStats);
      } catch (err) {
        this.logger.warn(
          `[tech_stats_writeback_failed] sessionId=${input.sessionId} ` + `err=${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    // 6. 返 4 字段结构化 feedback (跟 DTO 1:1)
    return {
      overallScore: feedback.overallScore,
      perSentence: feedback.perSentence,
      errorCategories: feedback.errorCategories,
      growthSuggestion: feedback.growthSuggestion,
    };
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 4. compareFeedback — 1 session + N 流派 → N 份 feedback (并行)
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * POST /counselor/supervision/feedback/compare 主入口.
   *
   * @param input { sessionId, sessionType, schoolCodes }
   * @param userId 当前用户 id
   * @returns N 流派 feedback (key=schoolCode enum 值)
   */
  async compareFeedback(
    input: {
      sessionId: string;
      sessionType: SessionType;
      schoolCodes: SupervisionSchoolCode[];
    },
    userId: string,
  ): Promise<CompareSupervisionFeedbackResponseDto> {
    if (input.schoolCodes.length < 2) {
      throw new BadRequestException('多流派对比至少 2 流派');
    }
    if (input.schoolCodes.length > 3) {
      throw new BadRequestException('多流派对比最多 3 流派 (高级会员)');
    }

    // V2026-10-21 治本 (V1.2 VS-A — 真接 LLM 后改并行): 单流派 30-120s, 串行 3 流派 = 6 分钟,
    //   HTTP 必超时. 2-3 路并发在官方限流阈值内, 直接 Promise.all.
    const results = await Promise.all(
      input.schoolCodes.map((code) =>
        this.generateFeedback({ sessionId: input.sessionId, sessionType: input.sessionType, schoolCode: code }, userId),
      ),
    );
    const feedbackBySchool = {} as Record<SupervisionSchoolCode, SupervisionFeedbackDto>;
    for (const [idx, code] of input.schoolCodes.entries()) {
      feedbackBySchool[code] = results[idx];
    }
    return {
      sessionId: input.sessionId,
      sessionType: input.sessionType,
      feedbackBySchool,
    };
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 5. listFeedbackForSession — 历史 N 流派 feedback
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
  // 私有 helper
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * 把技术统计写回 session 表的 tech_stats 列.
   *
   * @param userId 当前用户 id
   * @param sessionId 会话 id
   * @param sessionType session 类型 (polymorphic)
   * @param techStats 技术统计
   */
  private async writeTechStats(userId: string, sessionId: string, sessionType: SessionType, techStats: SessionTechStats): Promise<void> {
    if (sessionType === SessionType.TRAINING_SESSION) {
      const row = await this.trainingSessionRepo.findOne({
        where: { id: sessionId, userId, deletedAt: IsNull() },
      });
      if (row) {
        row.techStats = techStats;
        await this.trainingSessionRepo.save(row);
      }
      return;
    }
    if (sessionType === SessionType.LONG_TERM_CASE_SESSION) {
      // long_term_case_sessions 无 user_id 列 (V0.x 一人一租户: tenant_id 即 user_id)
      const row = await this.longTermSessionRepo.findOne({
        where: { id: sessionId, tenantId: userId, deletedAt: IsNull() },
      });
      if (row) {
        row.techStats = techStats;
        await this.longTermSessionRepo.save(row);
      }
    }
  }

  /**
   * 用 4 流派 prompt 模板 (DB) + 会话上下文渲染出 system prompt.
   *
   * 模板占位符 (supervision_schools.promptTemplate):
   *   {persona}        → 来访者画像块
   *   {transcript}     → 逐字稿块
   *   {emotionTimeline} → 当前无独立情绪时间线数据, 明确说明让模型改从逐字稿推断
   *
   * 替换一律用**函数形式**的 String.replace: 渲染块内容里可能含 `$&` / `$1` 等
   * 特殊替换模式, 字符串形式会被当成替换模式吃掉, 导致画像/逐字稿内容被篡改.
   *
   * @param template DB 里的 4 流派 prompt 模板
   * @param ctx 会话上下文
   */
  // V2026-10-21 治本 (V1.2 VS-A 第 1 轮 tsc 修复 — TS2345 nullable 入参):
  //   原因: SupervisionSchool.promptTemplate 的实体声明是 `string | null` (DB 列可空,
  //     运营侧还没填模板的流派就是 null). 我把 buildSchoolSystemPrompt 的入参写成了
  //     `template: string`, 本轮 build 实测 TS2345: 'string | null' 不能赋给 'string'.
  //   修法: 入参类型改成 `string | null`, 内部用 `template?.trim()` 判空 —
  //     null / 空串 / 纯空白 统一走内置的通用督导 system prompt 兼底.
  //   反双胞胎:
  //     - 不在调用处 `school.promptTemplate ?? ''`: 那样会把 "没有模板" 和 "模板是空串"
  //       混成同一情况, 丢失 "该流派尚未配置模板" 这个运营信号
  //     - 不改 entity 声明为非空: DB 里真有 null 行, 改声明会把脏数据变成运行时崩溃
  //   验证: 1. tsc 0 错  2. 某流派 promptTemplate 为 null 时, 督导仍能用通用 prompt 出报告
  //   时间戳: 2026-10-21 14:40 GMT+8
  private buildSchoolSystemPrompt(template: string | null, ctx: SessionContext): string {
    const base = template && template.trim().length > 0 ? template : '你是一位资深心理咨询督导, 负责给实习咨询师做单节会谈复盘.';
    return [
      base
        .replaceAll('{persona}', () => renderPersonaBlock(ctx.persona))
        .replaceAll('{transcript}', () => renderTranscriptBlock(ctx.transcript))
        .replaceAll('{emotionTimeline}', () => '(本次会话未采集独立情绪时间线, 请依据逐字稿中的情绪线索自行推断)'),
      '',
      '通用要求: 反馈只针对咨询师的技术动作, 不评判来访者; 不给标准答案话术, 只指方向;',
      '语气鼓励 + 建设性, 避免挫败式评价; 只依据逐字稿中真实出现的内容, 不编造未发生的对话.',
    ].join('\n');
  }

  /**
   * 私有 mapper: entity → DTO
   */
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
