// V2026-10-21 治本 (V1.2 VS-B1 — M1 分层人设 service):
//   原因: v1.2 spec §4.2 定义了两层视图的读写契约:
//     - 视图 A (表层配置): 可见可编辑"来访初次见面愿意主动呈现的内容"
//     - 全量视图 (上帝视角): **默认关闭**, 开启才返回完整 7 大块
//     - 视图 B (动态解锁档案): 按 layer 分区
//   修法: VisitorPersonaService 6 个 method:
//     - generate        「随机生成个案」→ LLM 出 7 大块剧本 → 落库
//     - getSurface      读表层视图 (视图 A)
//     - getFull         读全量视图 (上帝视角, 需 godViewEnabled=true)
//     - updateSurface   改表层字段 (**只改暴露字段**, 深层字段不进 DTO 也无从改)
//     - attachToCase    转长程时绑定 (caseId 回填)
//     - listByUser      我的全部人设
//   反双胞胎:
//     - 不在 getFull 里直接返回全量: 上帝视角默认关闭 (spec §2.2 原则 1/2), 不开就 403
//     - 不用 PartialType 让前端能改深层字段: 那等于把 7 大块暴露成可写, 直接破防信息分层
//     - 不用 spread 合并表层字段: 会把未提供的深层键覆盖成 undefined; 本 service 只做
//       "逐字段白名单拷贝", 未提及的键原样保留
//     - 不在 service 里调 LlmService 直连: 统一走 VS-A 的 CounselorLlmJsonClient
//       (收流 → 剥 think → JSON.parse → 业务校验 → 错误当数据), 只有 1 条结构化输出链
//   验证:
//     1. tsc 0 错
//     2. POST /counselor/visitor-personas → 201, 返回表层视图 (不含 innerWorkingModel)
//     3. GET /:id/full (上帝视角关) → 403; 打开偏好后 → 200 返回 7 大块
//     4. PATCH /:id/surface { basics: { age: 30 } } → 200, innerWorkingModel 原样不动
//   时间戳: 2026-10-21

import { BadRequestException, ForbiddenException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';

import { CounselorUiPreferenceService } from './counselor-ui-preference.service';
import { CounselorLlmJsonClient } from './llm-json.client';
import { COUNSELOR_LLM_PROFILES } from '../config/counselor-llm.config';
import {
  buildPersonaGenerationUserPrompt,
  VISITOR_PERSONA_SCHEMA_DESCRIPTION,
  VISITOR_PERSONA_SYSTEM_PROMPT,
} from '../config/visitor-persona-prompts';
import type {
  DevelopmentalStage,
  VisitorFullPersonaScript,
  VisitorPersonaBasics,
  VisitorPersonaCoping,
  VisitorPersonaDevelopmentalStage,
  VisitorPersonaInnerWorkingModel,
  VisitorPersonaPresentingIssue,
  VisitorPersonaSocialRelation,
  VisitorPersonaTherapyExpectation,
} from '../domain/visitor-persona/visitor-persona.types';
import {
  type GenerateVisitorPersonaDto,
  type UpdateVisitorPersonaBasicsDto,
  type UpdateVisitorPersonaPresentingIssueDto,
  type UpdateVisitorPersonaRelationDto,
  type UpdateVisitorPersonaSurfaceDto,
  type VisitorPersonaFullDto,
  type VisitorPersonaSurfaceDto,
} from '../dto/visitor-persona.dto';
import { VisitorFullPersona } from '../entities/visitor-full-persona.entity';
import { CounselorUiPreferenceKey } from '../enums/counselor-ui-preference-key.enum';

// ════════════════════════════════════════════════════════════════════════════
// 手写校验器 (结构化输出的业务校验回调)
// ════════════════════════════════════════════════════════════════════════════

/** 取字符串数组; 非数组返回 null. */
function readStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string') {
      return null;
    }
    out.push(item);
  }
  return out.length > 0 ? out : null;
}

/** 取字符串; 非字符串返回 null. */
function readString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/** 取受限枚举值. */
function readEnum<T extends string>(value: unknown, allowed: readonly T[]): T | null {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : null;
}

/**
 * 校验 LLM 生成的 7 大块人设.
 *
 * 严格模式: 任一大块结构不符 → 整个 payload 判非法 (返回 null), 由 client 转成
 * schema_validation_failed. 理由: 人设是 AI 行为基准, 缺一块就会出现"AI 依据不存在的事实
 * 做反应"的幻觉, 比直接报错更糟.
 *
 * @param raw JSON.parse 后的未知值
 */
export function validateFullPersona(raw: unknown): VisitorFullPersonaScript | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return null;
  }
  const obj = raw as Record<string, unknown>;

  // V2026-10-21 治本 (V1.2 VS-B1 第 3 轮 lint 修复 — complexity 61 → 8):
  //   原因: 原 validateFullPersona 一个函数里塞了 7 大块的解析 + 校验, ESLint complexity
  //     报 61 (上限 20) / sonarjs cognitive-complexity 报 30 (上限 25) —— 超限 3 倍.
  //   修法: 按「分解 + 组合」范式拆成 7 个单块 check 函数 (各管 1 块, 复杂度 ≤ 8),
  //     主函数只做 "逐块取值 + 任一为 null 即整体非法".
  //   反双胞胎:
  //     - 不写 `// eslint-disable-next-line complexity`: 那是把味道藏起来, 函数还会继续长;
  //       仓库既有 src/agent/supervisor/supervisor.service.ts 的 validateReportShape
  //       就是同款分解范式 (33 → 4), 照它走
  //     - 不用「check 返回错误描述 + ?? 链」那一版: 我们的 check 还必须把**解析后的值**带出来,
  //       错误描述版要么校验两遍, 要么把值塞进模块级变量 (共享可变状态, 明确禁止),
  //       所以用「返回 T | null」+ 逐块早退 —— 语义等价且不踩任何反模式
  //     - 不放宽 eslint 的 complexity 上限: 函数确实太复杂, 放宽只是推迟下次重构
  //   验证: 1. lint 0 错  2. 同一份非法 payload 修复前后判定一致 (都是 null)
  //   时间戳: 2026-10-21 15:35 GMT+8
  const basics = checkBasics(obj);
  if (basics === null) {
    return null;
  }
  const developmentalTimeline = checkDevelopmentalTimeline(obj);
  if (developmentalTimeline === null) {
    return null;
  }
  const innerWorkingModel = checkInnerWorkingModel(obj);
  if (innerWorkingModel === null) {
    return null;
  }
  const socialMap = checkSocialMap(obj);
  if (socialMap === null) {
    return null;
  }
  const coping = checkCoping(obj);
  if (coping === null) {
    return null;
  }
  const therapyExpectation = checkTherapyExpectation(obj);
  if (therapyExpectation === null) {
    return null;
  }
  const presentingIssue = checkPresentingIssue(obj);
  if (presentingIssue === null) {
    return null;
  }
  return { basics, developmentalTimeline, innerWorkingModel, socialMap, coping, therapyExpectation, presentingIssue };
}

// ════════════════════════════════════════════════════════════════════════════
// 7 个单块 check 函数 (每个只管 1 块, 复杂度 ≤ 8)
// ════════════════════════════════════════════════════════════════════════════

/** 成长阶段取值 (5 段, 顺序固定). */
const DEVELOPMENTAL_STAGES = ['0-6', '7-12', '13-18', '19-25', '26+'] as const;

/** 依恋类型取值. */
const ATTACHMENT_TYPES = ['secure', 'anxious', 'avoidant', 'disorganized'] as const;

/** 关系类型取值. */
const SOCIAL_RELATION_TYPES = ['parent', 'intimate', 'workplace', 'peer'] as const;

/** 关系资源/消耗取值. */
const SOCIAL_RESOURCE_DRAINS = ['resource', 'drain', 'neutral'] as const;

/** 自述风险取值. */
const SELF_REPORTED_RISKS = ['low', 'medium', 'high', 'concealed'] as const;

/**
 * 1. 基础信息.
 *
 * @param obj 人设 payload
 */
function checkBasics(obj: Record<string, unknown>): VisitorPersonaBasics | null {
  const raw = obj['basics'];
  if (typeof raw !== 'object' || raw === null) {
    return null;
  }
  const b = raw as Record<string, unknown>;
  const age = b['age'];
  if (typeof age !== 'number' || !Number.isFinite(age)) {
    return null;
  }
  const roundedAge = Math.round(age);
  if (roundedAge < 12 || roundedAge > 100) {
    return null;
  }
  const gender = readString(b['gender']);
  const occupation = readString(b['occupation']);
  const education = readString(b['education']);
  const livingStatus = readString(b['livingStatus']);
  const somaticHistory = readString(b['somaticHistory']);
  const psychHistory = readString(b['psychHistory']);
  if (!gender || !occupation || !education || !livingStatus || !somaticHistory || !psychHistory) {
    return null;
  }
  return { age: roundedAge, gender, occupation, education, livingStatus, somaticHistory, psychHistory };
}

/**
 * 2. 成长时间线 (恰好 5 段, 顺序固定).
 *
 * @param obj 人设 payload
 */
function checkDevelopmentalTimeline(obj: Record<string, unknown>): VisitorPersonaDevelopmentalStage[] | null {
  const raw = obj['developmentalTimeline'];
  if (!Array.isArray(raw) || raw.length !== DEVELOPMENTAL_STAGES.length) {
    return null;
  }
  // Array.isArray 会把 unknown 收窄成 any[] → 显式转成 unknown[] 避免 no-unsafe-assignment.
  const items = raw as unknown[];
  const result: VisitorPersonaDevelopmentalStage[] = [];
  for (let i = 0; i < DEVELOPMENTAL_STAGES.length; i++) {
    const stage = checkOneDevelopmentalStage(items[i], DEVELOPMENTAL_STAGES[i]);
    if (stage === null) {
      return null;
    }
    result.push(stage);
  }
  return result;
}

/**
 * 2.1 单个成长阶段.
 *
 * @param item 阶段元素
 * @param expected 该位置应有的阶段 (顺序固定)
 */
function checkOneDevelopmentalStage(item: unknown, expected: DevelopmentalStage): VisitorPersonaDevelopmentalStage | null {
  if (typeof item !== 'object' || item === null) {
    return null;
  }
  const s = item as Record<string, unknown>;
  const stage = readEnum(s['stage'], DEVELOPMENTAL_STAGES);
  // 先判 null 再判顺序: TS 只能通过显式 null 检查把 `DevelopmentalStage | null` 收窄成
  // `DevelopmentalStage`; 若把两个条件合并成 `stage !== expected`, 编译器无法排除 null,
  // 后面 push 进强类型数组会报 TS2345.
  if (stage === null) {
    return null;
  }
  if (stage !== expected) {
    return null;
  }
  const parentingStyle = readString(s['parentingStyle']);
  const keyEvents = readStringArray(s['keyEvents']);
  const tabooTopics = readStringArray(s['tabooTopics']);
  if (!parentingStyle || !keyEvents || !tabooTopics) {
    return null;
  }
  return { stage, parentingStyle, keyEvents, tabooTopics };
}

/**
 * 3. 内在工作模型.
 *
 * @param obj 人设 payload
 */
function checkInnerWorkingModel(obj: Record<string, unknown>): VisitorPersonaInnerWorkingModel | null {
  const raw = obj['innerWorkingModel'];
  if (typeof raw !== 'object' || raw === null) {
    return null;
  }
  const i = raw as Record<string, unknown>;
  const attachmentType = readEnum(i['attachmentType'], ATTACHMENT_TYPES);
  const coreBeliefs = readStringArray(i['coreBeliefs']);
  const hiddenTrauma = readStringArray(i['hiddenTrauma']);
  const unfinishedBusiness = readStringArray(i['unfinishedBusiness']);
  const defenseMechanisms = readStringArray(i['defenseMechanisms']);
  if (!attachmentType || !coreBeliefs || !hiddenTrauma || !unfinishedBusiness || !defenseMechanisms) {
    return null;
  }
  return { attachmentType, coreBeliefs, hiddenTrauma, unfinishedBusiness, defenseMechanisms };
}

/**
 * 4. 社会关系图谱 (3-5 条, 至少 1 条 parent).
 *
 * @param obj 人设 payload
 */
function checkSocialMap(obj: Record<string, unknown>): VisitorPersonaSocialRelation[] | null {
  const raw = obj['socialMap'];
  if (!Array.isArray(raw)) {
    return null;
  }
  const items = raw as unknown[];
  if (items.length < 3 || items.length > 5) {
    return null;
  }
  const result: VisitorPersonaSocialRelation[] = [];
  for (const item of items) {
    const relation = checkOneSocialRelation(item);
    if (relation === null) {
      return null;
    }
    result.push(relation);
  }
  if (!result.some((r) => r.relationType === 'parent')) {
    return null;
  }
  return result;
}

/**
 * 4.1 单条社会关系.
 *
 * @param item 关系元素
 */
function checkOneSocialRelation(item: unknown): VisitorPersonaSocialRelation | null {
  if (typeof item !== 'object' || item === null) {
    return null;
  }
  const r = item as Record<string, unknown>;
  const relationType = readEnum(r['relationType'], SOCIAL_RELATION_TYPES);
  const currentStatus = readString(r['currentStatus']);
  const conflictPattern = readString(r['conflictPattern']);
  const resourceOrDrain = readEnum(r['resourceOrDrain'], SOCIAL_RESOURCE_DRAINS);
  if (!relationType || !currentStatus || !conflictPattern || !resourceOrDrain) {
    return null;
  }
  return { relationType, currentStatus, conflictPattern, resourceOrDrain };
}

/**
 * 5. 应对模式.
 *
 * @param obj 人设 payload
 */
function checkCoping(obj: Record<string, unknown>): VisitorPersonaCoping | null {
  const raw = obj['coping'];
  if (typeof raw !== 'object' || raw === null) {
    return null;
  }
  const c = raw as Record<string, unknown>;
  const adaptiveResources = readStringArray(c['adaptiveResources']);
  const maladaptiveStrategies = readStringArray(c['maladaptiveStrategies']);
  const emotionTriggers = readStringArray(c['emotionTriggers']);
  if (!adaptiveResources || !maladaptiveStrategies || !emotionTriggers) {
    return null;
  }
  return { adaptiveResources, maladaptiveStrategies, emotionTriggers };
}

/**
 * 6. 咨询预设.
 *
 * @param obj 人设 payload
 */
function checkTherapyExpectation(obj: Record<string, unknown>): VisitorPersonaTherapyExpectation | null {
  const raw = obj['therapyExpectation'];
  if (typeof raw !== 'object' || raw === null) {
    return null;
  }
  const t = raw as Record<string, unknown>;
  const biases = readStringArray(t['biases']);
  const expectations = readStringArray(t['expectations']);
  const transferenceTrend = readString(t['transferenceTrend']);
  const resistancePattern = readString(t['resistancePattern']);
  if (!biases || !expectations || !transferenceTrend || !resistancePattern) {
    return null;
  }
  return { biases, expectations, transferenceTrend, resistancePattern };
}

/**
 * 7. 当前主诉.
 *
 * @param obj 人设 payload
 */
function checkPresentingIssue(obj: Record<string, unknown>): VisitorPersonaPresentingIssue | null {
  const raw = obj['presentingIssue'];
  if (typeof raw !== 'object' || raw === null) {
    return null;
  }
  const p = raw as Record<string, unknown>;
  const selfReport = readString(p['selfReport']);
  const duration = readString(p['duration']);
  const sleepAppetite = readString(p['sleepAppetite']);
  const selfReportedRisk = readEnum(p['selfReportedRisk'], SELF_REPORTED_RISKS);
  if (!selfReport || !duration || !sleepAppetite || !selfReportedRisk) {
    return null;
  }
  return { selfReport, duration, sleepAppetite, selfReportedRisk };
}

// ════════════════════════════════════════════════════════════════════════════
// Service
// ════════════════════════════════════════════════════════════════════════════

/** 视图 A 允许暴露的关系类型 (spec §4.2: 只取 intimate / parent). */
const SURFACE_RELATION_TYPES = ['intimate', 'parent'] as const;

/**
 * 分层人设 service.
 */
@Injectable()
export class VisitorPersonaService {
  constructor(
    @InjectRepository(VisitorFullPersona)
    private readonly personaRepo: Repository<VisitorFullPersona>,
    private readonly llmJson: CounselorLlmJsonClient,
    private readonly uiPreference: CounselorUiPreferenceService,
  ) {}

  // ══════════════════════════════════════════════════════════════════════════
  // 1. generate — 「随机生成个案」
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * 生成 1 份全量人设 (AI 底层剧本) 并落库.
   *
   * @param userId 当前用户 id
   * @param input 种子 (代号 / 主诉方向 / 性别 / 年龄 / 可选绑定 caseId)
   * @returns 表层视图 (刚生成时深层内容不给用户看, 除非开了上帝视角)
   */
  async generate(userId: string, input: GenerateVisitorPersonaDto): Promise<VisitorPersonaSurfaceDto> {
    const profile = COUNSELOR_LLM_PROFILES.personaGeneration;
    const result = await this.llmJson.requestJson<VisitorFullPersonaScript>({
      systemPrompt: VISITOR_PERSONA_SYSTEM_PROMPT,
      userPrompt: buildPersonaGenerationUserPrompt({
        displayName: input.displayName,
        complaintSeed: input.complaintSeed,
        gender: input.gender,
        age: input.age,
      }),
      schemaDescription: VISITOR_PERSONA_SCHEMA_DESCRIPTION,
      validate: validateFullPersona,
      maxCompletionTokens: profile.maxCompletionTokens,
      reasoningEffort: profile.reasoningEffort,
      timeoutMs: profile.timeoutMs,
      tenantId: userId,
      userId,
    });

    if (!result.ok || result.data === null) {
      // 不落脏数据: 半套人设会让 AI 依据不存在的事实做反应
      // 用 503 (Service Unavailable) 而不是 400: 400 是"请求错了", 503 是"上游不可用",
      // 跟 supervision.service.ts 的真接 LLM 路径保持同一口径.
      throw new ServiceUnavailableException(`全量人设生成失败 (${result.errorCode ?? 'unknown'}): ${result.errorMessage ?? 'LLM 不可用'}`);
    }

    // V2026-10-21 治本 (V1.2 VS-B1 第 3 轮 lint 修复 — prefer-nullish-coalescing):
    //   原因: 原写法 `input.displayName?.trim() || fallback` 被 ESLint 报
    //     "Prefer using nullish coalescing operator (??)".
    //   修法: 拆成两步 —— 先 `?? ''` 消掉 undefined, 再用显式 length 判断空串.
    //   反双胞胎: 不直接改成 `input.displayName?.trim() ?? fallback`:
    //     `??` 只挡 undefined/null, **挡不住空字符串** —— 而空串恰好是"用户传了空白代号"
    //     的场景, 那样会生成一个没有名字的来访者. 语义必须保留"空 → fallback".
    const trimmedName = input.displayName?.trim() ?? '';
    const displayName = trimmedName.length > 0 ? trimmedName : await this.nextDefaultDisplayName(userId);
    const entity = this.personaRepo.create({
      tenantId: userId,
      userId,
      caseId: input.caseId ?? null,
      displayName,
      basics: result.data.basics,
      developmentalTimeline: result.data.developmentalTimeline,
      innerWorkingModel: result.data.innerWorkingModel,
      socialMap: result.data.socialMap,
      coping: result.data.coping,
      therapyExpectation: result.data.therapyExpectation,
      presentingIssue: result.data.presentingIssue,
      trustLevel: 0.2,
    });
    const saved = await this.personaRepo.save(entity);
    return this.toSurface(saved);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 2. getSurface — 读表层视图
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * 读表层视图 (视图 A).
   *
   * @param userId 当前用户 id
   * @param personaId 人设 id
   */
  async getSurface(userId: string, personaId: string): Promise<VisitorPersonaSurfaceDto> {
    const row = await this.load(userId, personaId);
    return this.toSurface(row);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 3. getFull — 读全量视图 (上帝视角)
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * 读全量视图 (上帝视角).
   *
   * @param userId 当前用户 id
   * @param personaId 人设 id
   * @throws ForbiddenException 上帝视角开关未开启
   */
  async getFull(userId: string, personaId: string): Promise<VisitorPersonaFullDto> {
    const prefs = await this.uiPreference.getPreferences(userId);
    if (!prefs[CounselorUiPreferenceKey.GOD_VIEW_ENABLED]) {
      throw new ForbiddenException('上帝视角未开启: 请先在偏好设置中开启 godViewEnabled (默认关闭, 避免跳过信息探索环节)');
    }
    const row = await this.load(userId, personaId);
    return this.toFull(row);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 4. updateSurface — 改表层字段
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * 更新表层字段.
   *
   * 只改**暴露字段**: 代号 / basics 的 3 个键 / presentingIssue 的 4 个键 / socialMap 中
   * intimate+parent 的 currentStatus. 其余 (成长时间线 / 内在工作模型 / 应对模式 / 咨询预设)
   * 连 DTO 都不存在, 从 API 层面就改不了 —— 这才是 spec §4.2「不改未暴露字段」的强保证.
   *
   * @param userId 当前用户 id
   * @param personaId 人设 id
   * @param input 待改表层字段
   */
  async updateSurface(userId: string, personaId: string, input: UpdateVisitorPersonaSurfaceDto): Promise<VisitorPersonaSurfaceDto> {
    const row = await this.load(userId, personaId);

    if (input.displayName !== undefined) {
      row.displayName = input.displayName;
    }
    this.applySurfaceBasics(row, input.basics);
    this.applySurfacePresentingIssue(row, input.presentingIssue);
    this.applySurfaceRelations(row, input.relations);

    const saved = await this.personaRepo.save(row);
    return this.toSurface(saved);
  }

  /**
   * 表层 basics 打补丁 (逐键白名单拷贝).
   *
   * V2026-10-21 治本 (V1.2 VS-B1 第 3 轮 lint 修复 — cognitive-complexity 29 → 25):
   //   原因: updateSurface 原本把 3 段表层字段的拷贝逻辑全内联, sonarjs/cognitive-complexity
   //     报 29 (上限 25).
   //   修法: 拆成 3 个 private helper, 主函数只做 "load → 分派 → save".
   //   反双胞胎: 不用 `// eslint-disable-next-line sonarjs/cognitive-complexity`:
   //     那是把味道藏起来, 下一轮再加一个字段又会超; 拆开是治本
   *
   * @param row 人设行 (原地修改)
   * @param patch basics 补丁 (可空)
   */
  private applySurfaceBasics(row: VisitorFullPersona, patch: UpdateVisitorPersonaBasicsDto | undefined): void {
    if (!patch) {
      return;
    }
    // 逐键白名单拷贝: 未提供的键原样保留 (不 spread 覆盖成 undefined)
    const next: VisitorPersonaBasics = { ...row.basics };
    if (patch.age !== undefined) next.age = patch.age;
    if (patch.gender !== undefined) next.gender = patch.gender;
    if (patch.occupation !== undefined) next.occupation = patch.occupation;
    row.basics = next;
  }

  /**
   * 表层 presentingIssue 打补丁.
   *
   * @param row 人设行 (原地修改)
   * @param patch 主诉补丁 (可空)
   */
  private applySurfacePresentingIssue(row: VisitorFullPersona, patch: UpdateVisitorPersonaPresentingIssueDto | undefined): void {
    if (!patch) {
      return;
    }
    const next: VisitorPersonaPresentingIssue = { ...row.presentingIssue };
    if (patch.selfReport !== undefined) next.selfReport = patch.selfReport;
    if (patch.duration !== undefined) next.duration = patch.duration;
    if (patch.sleepAppetite !== undefined) next.sleepAppetite = patch.sleepAppetite;
    if (patch.selfReportedRisk !== undefined) next.selfReportedRisk = patch.selfReportedRisk;
    row.presentingIssue = next;
  }

  /**
   * 表层关系打补丁 (只改 intimate / parent 的 currentStatus).
   *
   * @param row 人设行 (原地修改)
   * @param patches 关系补丁 (可空)
   */
  private applySurfaceRelations(row: VisitorFullPersona, patches: UpdateVisitorPersonaRelationDto[] | undefined): void {
    if (!patches || patches.length === 0) {
      return;
    }
    const next: VisitorPersonaSocialRelation[] = row.socialMap.map((r) => ({ ...r }));
    for (const edit of patches) {
      const target = next.find((r) => r.relationType === edit.relationType);
      if (target) {
        target.currentStatus = edit.currentStatus;
        continue;
      }
      // 表层关系只有 intimate / parent 2 类展示口径, 其余关系不进表层
      if (SURFACE_RELATION_TYPES.includes(edit.relationType)) {
        next.push({
          relationType: edit.relationType,
          currentStatus: edit.currentStatus,
          conflictPattern: '',
          resourceOrDrain: 'neutral',
        });
      }
    }
    row.socialMap = next;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 5. attachToCase — 转长程时绑定
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * 把人设绑定到长程个案 (1:1, 应用层校验, 不加 DB FK).
   *
   * @param userId 当前用户 id
   * @param personaId 人设 id
   * @param caseId 长程个案 id
   * @returns 绑定后的表层视图
   * @throws BadRequestException 该个案已绑定其它人设
   */
  async attachToCase(userId: string, personaId: string, caseId: string): Promise<VisitorPersonaSurfaceDto> {
    const row = await this.load(userId, personaId);
    if (row.caseId !== null && row.caseId !== caseId) {
      throw new BadRequestException(`人设 ${personaId} 已绑定个案 ${row.caseId}, 不能改绑到 ${caseId}`);
    }
    const occupied = await this.personaRepo.findOne({
      where: { caseId, userId, deletedAt: IsNull() },
    });
    if (occupied && occupied.id !== row.id) {
      throw new BadRequestException(`个案 ${caseId} 已绑定人设 ${occupied.id}, 每个个案只能有 1 份全量人设`);
    }
    row.caseId = caseId;
    const saved = await this.personaRepo.save(row);
    return this.toSurface(saved);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 6. listByUser — 我的全部人设
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * 列出当前用户的全部人设 (表层视图).
   *
   * @param userId 当前用户 id
   */
  async listByUser(userId: string): Promise<VisitorPersonaSurfaceDto[]> {
    const rows = await this.personaRepo.find({
      where: { userId, deletedAt: IsNull() },
      order: { createdAt: 'DESC' },
    });
    return rows.map((r) => this.toSurface(r));
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 私有 helper
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * 取 1 条属于当前用户的人设 (软删过滤).
   *
   * @param userId 当前用户 id
   * @param personaId 人设 id
   * @throws NotFoundException 不存在 / 不属于当前用户
   */
  private async load(userId: string, personaId: string): Promise<VisitorFullPersona> {
    const row = await this.personaRepo.findOne({
      where: { id: personaId, userId, deletedAt: IsNull() },
    });
    if (!row) {
      throw new NotFoundException(`来访者人设 ${personaId} 不存在或不属于当前用户`);
    }
    return row;
  }

  /**
   * 生成默认代号 (来访者 A / B / C ...).
   *
   * 按当前用户已有人设数量取字母, 稳定可预期 (同一用户连续建案 → A, B, C);
   * 不用时间戳/随机数, 避免出现 "来访者 3F2A" 这种对用户无意义的名字.
   *
   * @param userId 当前用户 id
   */
  private async nextDefaultDisplayName(userId: string): Promise<string> {
    const count = await this.personaRepo.count({ where: { userId, deletedAt: IsNull() } });
    // V2026-10-21 治本 (V1.2 VS-B1 第 3 轮 lint 修复 — unicorn/prefer-code-point):
    //   原因: `String.fromCharCode` 被 ESLint 报 "Prefer String.fromCodePoint()".
    //   修法: 改用 fromCodePoint (Unicode 感知的 API, 语义与此处 ASCII 场景完全一致).
    //   反双胞胎: 不加 eslint-disable 注释: 这是纯粹的标准库 API 偏好, 直接换掉成本最低.
    const letter = String.fromCodePoint(65 + (count % 26));
    return `来访者 ${letter}`;
  }

  /**
   * entity → 表层视图 (只暴露"来访初次见面愿意主动呈现的内容").
   *
   * @param row visitor_full_personas 表行
   */
  private toSurface(row: VisitorFullPersona): VisitorPersonaSurfaceDto {
    return {
      id: row.id,
      displayName: row.displayName,
      basics: {
        age: row.basics.age,
        gender: row.basics.gender,
        occupation: row.basics.occupation,
      },
      presentingIssue: row.presentingIssue,
      relations: row.socialMap
        .filter((r) => r.relationType === 'intimate' || r.relationType === 'parent')
        .map((r) => ({ relationType: r.relationType, currentStatus: r.currentStatus })),
      caseId: row.caseId,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  /**
   * entity → 全量视图 (上帝视角).
   *
   * @param row visitor_full_personas 表行
   */
  private toFull(row: VisitorFullPersona): VisitorPersonaFullDto {
    return {
      id: row.id,
      displayName: row.displayName,
      basics: row.basics,
      developmentalTimeline: row.developmentalTimeline,
      innerWorkingModel: row.innerWorkingModel,
      socialMap: row.socialMap,
      coping: row.coping,
      therapyExpectation: row.therapyExpectation,
      presentingIssue: row.presentingIssue,
      trustLevel: row.trustLevel,
      caseId: row.caseId,
    };
  }
}
