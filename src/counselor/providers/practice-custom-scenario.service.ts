// V2026-10-22 治本 (V1.3 §7.2 / §7.4 / §7.5 — 用户私有场景的生成与列表):
//   原因: §7 是本引擎区别于所有题库类竞品的护城河功能 —— 新手咨询师今天现场卡住,
//     当晚 1:1 还原重练. 它的产品动线是:
//       三问表单 → POST /scenarios:generate → 拿到一条**贴合自己真实情况**的场景
//       → 直接进练习页 (还是那三引擎 UI, 0 新页面) → 练完落 practice_attempts
//     这条链路有三个必须治本的点:
//       ① **脱敏**: 输入里出现真实人名/地名/单位名时, 输出必须用代称 (spec §7.3.1).
//          这是隐私红线, 不是体验优化.
//       ② **零压**: 生成失败 / 超时 / 超频, 一律**软降级**, 绝不弹红条 (spec §7.4).
//          §1.4 的留存飞轮怕的就是"练完就没了", 而一个红条就会劝退.
//       ③ **隔离**: 私有场景进 practice_custom_scenarios 独立表 (spec §7.5),
//          跟"每一条都过审"的共享内容库物理分开.
//
//   修法: 本 service 收敛 §7 的**全部**生成入口:
//     - generate()          §7.2 三问表单 (新契约)
//     - createFromSituation() §3.5 旧的"一句话描述"入口 (老契约, 复用同一张表)
//     - listMine()          §7.2 「我的真实场景」列表
//   三个入口**共用同一条落库链路** (同一张表 / 同一份内容结构 / 同一套降级策略),
//   杜绝"两个入口两张表"的后患 (那会让「我的真实场景」列表漏掉 §3.5 生成的场景).
//
//   降级矩阵 (spec §7.4):
//     ┌──────────────────────┬───────────────────────────┬────────────────────────┐
//     │ 触发条件              │ 降级产物                   │ degradedReason          │
//     ├──────────────────────┼───────────────────────────┼────────────────────────┤
//     │ 今日生成次数已用完     │ 标准题库里的一个场景        │ quota_exceeded         │
//     │ 私有场景存量达上限     │ 标准题库里的一个场景        │ storage_limit_reached  │
//     │ LLM 失败 / 超时 / 开关关 │ 确定性模板场景 (用用户原话)  │ generation_unavailable │
//     └──────────────────────┴───────────────────────────┴────────────────────────┘
//   三条降级路径**全部返回 200 + 一条可练的场景**, 不抛异常 ——
//   §7.4 原文「超额时前端不弹『今日已用完』红条, 而是软降级回标准题库」.
//
//   反双胞胎:
//     - 不把私有场景写进 practice_scenarios: §7.5 明确要求隔离 (审核边界);
//       写进主表会让"公共题库里每一条都过审"这条不变式失效
//     - 不在降级时抛 4xx/5xx: 见上 (零压红线在可用性维度上的同一条原则)
//     - 不在生成前先扣配额: 先扣后生成会把"生成失败"也计费;
//       正确顺序是"先扣配额(占位) → 生成 → 失败则退还"里的前者 + 模板兜底,
//       模板兜底不退还 (它确实消耗了一次调用额度, 且用户拿到了可用场景)
//     - 不用 Math.random 选降级场景: 走 node:crypto 的 CSPRNG, 与既有随机口径一致
//     - 不在 service 里做 HTTP 层的事 (不抛 Nest 的 HTTP 异常): 降级是业务分支不是错误
//
//   验证:
//     1. tsc 0 错
//     2. 正常路径 → 落 practice_custom_scenarios 一行, 返回 isCustom=true / source=user_generated
//     3. 配额用尽 → 返回标准题库场景 + degraded=true + degradedReason=quota_exceeded, HTTP 仍 200
//     4. LLM 不可用 → 返回模板场景 (generationMode=template) + degraded=true
//     5. GET scenarios/mine → 只返回本人私有场景, 按最近练过倒序, 不含 content 全文
//     6. §3.5 入口生成的场景能在 §7.2 的 mine 列表里看到 (同一张表)
//
//   时间戳: 2026-10-22
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { randomInt, randomUUID } from 'node:crypto';
import { In, IsNull, type Repository } from 'typeorm';

import { PracticeEvaluatorService } from './practice-evaluator.service';
import { PracticeQuotaService } from './practice-quota.service';
import { PracticeScenarioService } from './practice-scenario.service';
import {
  buildTemplateScenario,
  parsePositiveIntEnv,
  PRACTICE_CUSTOM_SCENARIO_DAILY_LIMIT_DEFAULT,
  PRACTICE_CUSTOM_SCENARIO_DAILY_LIMIT_ENV_KEY,
  PRACTICE_CUSTOM_SCENARIO_MAX_COUNT_DEFAULT,
  PRACTICE_CUSTOM_SCENARIO_MAX_COUNT_ENV_KEY,
  PRACTICE_CUSTOM_SCENARIO_TIMEOUT_DEFAULT_MS,
  PRACTICE_CUSTOM_SCENARIO_TIMEOUT_ENV_KEY,
  templateScenarioToContent,
  PracticeCustomScenarioDegradeReason,
} from '../config/practice-custom-scenario.config';
import { engineOfMode, labelOfMode } from '../config/practice-display-meta';
import type { PracticeCustomScenarioContent } from '../domain/practice/practice.types';
import type {
  CreateCustomPracticeScenarioDto,
  CustomPracticeScenarioListDto,
  CustomPracticeScenarioListItemDto,
  CustomPracticeScenarioResultDto,
  GenerateCustomPracticeScenarioDto,
  GeneratedCustomPracticeScenarioDto,
} from '../dto/practice.dto';
import { PracticeAttempt } from '../entities/practice-attempt.entity';
import { PracticeCustomScenario } from '../entities/practice-custom-scenario.entity';
import { TrainingExercise } from '../entities/training-exercise.entity';
import { PracticeDifficulty } from '../enums/practice-difficulty.enum';
import { PracticeEngine } from '../enums/practice-engine.enum';
import { PracticeQuotaType } from '../enums/practice-quota-type.enum';
import { PracticeScenarioGenerationMode } from '../enums/practice-scenario-generation-mode.enum';
import { PracticeScenarioOrigin } from '../enums/practice-scenario-source.enum';
import { TrainingExerciseMode } from '../enums/training-exercise-mode.enum';

/**
 * 用户私有场景 service.
 */
@Injectable()
export class PracticeCustomScenarioService {
  private readonly logger = new Logger(PracticeCustomScenarioService.name);

  constructor(
    private readonly evaluator: PracticeEvaluatorService,
    private readonly scenarioService: PracticeScenarioService,
    private readonly quotaService: PracticeQuotaService,
    private readonly config: ConfigService,
    @InjectRepository(PracticeCustomScenario)
    private readonly customScenarioRepo: Repository<PracticeCustomScenario>,
    @InjectRepository(PracticeAttempt)
    private readonly attemptRepo: Repository<PracticeAttempt>,
    @InjectRepository(TrainingExercise)
    private readonly exerciseRepo: Repository<TrainingExercise>,
  ) {}

  // ══════════════════════════════════════════════════════════════════════
  // §7.2 POST /counselor/practice/scenarios:generate
  // ══════════════════════════════════════════════════════════════════════

  /**
   * 把用户的三问生成成一条可练的私有场景.
   *
   * 完整流程 (每一步都有降级出口):
   *   1. 存量闸门 (§8.5 B2): 私有场景条数达上限 → 降级到标准题库
   *   2. 配额闸门 (§7.4): 今日次数用尽 → 降级到标准题库
   *   3. hintExerciseId → 基本功 (用户指定) ; 不指定则由模型判断
   *   4. LLM 生成 (§7.3 的 5 条约束) ; 失败 / 超时 → 降级到模板场景
   *   5. 落库 practice_custom_scenarios (§7.5)
   *
   * @param userId 当前用户 id
   * @param dto 三问表单
   * @returns 场景行 (含降级标记)
   */
  async generate(userId: string, dto: GenerateCustomPracticeScenarioDto): Promise<GeneratedCustomPracticeScenarioDto> {
    const hint = await this.resolveHint(dto.hintExerciseId);

    // ── 闸门 1 + 2: 存量上限 (§8.5 B2) / 今日配额 (§7.4) ──
    //   任一不通过 → 软降级回标准题库 (spec §7.4「不弹红条」).
    const gate = await this.checkGates(userId);
    if (gate.reason !== null) {
      return this.buildDegradedToLibrary(userId, hint?.mode ?? null, gate.reason);
    }

    // ── 步骤 3-4: 生成 (失败 → 模板降级) ──
    const generated = await this.evaluator.generateCustomScenario({
      visitorQuote: dto.visitorQuote,
      counselorReply: dto.counselorReply ?? '',
      stuckPoint: dto.stuckPoint ?? '',
      hintMode: hint?.mode ?? null,
      hintModeLabel: hint ? labelOfMode(hint.mode) : null,
      engine: hint ? engineOfMode(hint.mode) : null,
      userId,
      tenantId: userId, // A9 一人一租户
      timeoutMs: this.generationTimeoutMs(),
    });

    if (!generated) {
      this.logger.warn(`[practice_custom_scenario_degraded] reason=generation_unavailable user=${userId}`);
      return this.buildDegradedToTemplate(userId, dto, hint?.mode ?? null);
    }

    // ── 步骤 5: 落库 ──
    const exerciseId = hint?.exerciseId ?? (await this.findExerciseIdByMode(generated.exerciseMode));
    const saved = await this.persist(userId, {
      exerciseId,
      exerciseMode: generated.exerciseMode,
      difficulty: generated.difficulty,
      content: generated,
      payload: {
        visitorQuote: dto.visitorQuote,
        counselorReply: dto.counselorReply ?? '',
        stuckPoint: dto.stuckPoint ?? '',
        hintExerciseId: dto.hintExerciseId ?? null,
      },
      generationMode: PracticeScenarioGenerationMode.LLM,
    });

    return this.buildResponse(saved, generated, false, null);
  }

  // ══════════════════════════════════════════════════════════════════════
  // §3.5 POST /counselor/practice/custom-scenarios (旧契约入口, 同一张表)
  // ══════════════════════════════════════════════════════════════════════
  /**
   * §3.5 的旧入口: 用户指定基本功 + 一段自由描述 → 生成一条私有场景.
   *
   * 与 §7.2 走**同一条落库链路** (同一张表 / 同一份内容结构 / 同一套降级策略),
   * 只是入参形态不同: §3.5 = "mode + situation", §7.2 = "三问表单".
   * 这样 §3.5 生成的场景也会出现在 §7.2 的「我的真实场景」列表里 —— 否则用户
   * 会发现"从两个入口生成的场景, 只在一个列表里能看到".
   *
   * @param userId 当前用户 id
   * @param dto 基本功 + 真实情况描述
   * @returns 新场景 id
   */
  async createFromSituation(userId: string, dto: CreateCustomPracticeScenarioDto): Promise<CustomPracticeScenarioResultDto> {
    // §3.5 的 `mode` 是用户**显式指定**的练习方向, 不能丢:
    //   把它翻译成该基本功对应的 training_exercises id, 复用 §7.2 的 hint 通道,
    //   这样 §3.5 与 §7.2 两条入口对"基本功"的理解完全一致 (同一套 prompt 逻辑).
    const exercise = await this.exerciseRepo.findOne({
      where: { mode: dto.mode, enabled: true, deletedAt: IsNull() },
      order: { createdAt: 'ASC' },
    });

    const result = await this.generate(userId, {
      visitorQuote: dto.situation,
      counselorReply: '',
      stuckPoint: '',
      hintExerciseId: exercise?.id,
    });

    // 降级到标准题库时, 返回的仍是标准题库场景 id —— 客户端拿它照样能进练习页
    // (§3.2 能解析两个来源), 所以契约保持"返回一个可练的场景 id", 不断言成功.
    return { scenarioId: result.id };
  }

  // ══════════════════════════════════════════════════════════════════════
  // §7.2 GET /counselor/practice/scenarios/mine
  // ══════════════════════════════════════════════════════════════════════

  /**
   * 「我的真实场景」列表 (§7.2).
   *
   * 按**最近练过**倒序 (spec §7.2 原文); 从未练过的排在后面, 按生成时间倒序.
   * 不带 content 全文 (§7.2 原文「字段同响应行, 不带 content 全文」) ——
   * 点进去用 §3.2 拉详情, 避免列表接口把 50 条场景的完整 rubric 全量吐出来.
   *
   * @param userId 当前用户 id
   * @returns 私有场景列表
   */
  async listMine(userId: string): Promise<CustomPracticeScenarioListDto> {
    const scenarios = await this.customScenarioRepo.find({
      where: { userId, deletedAt: IsNull(), enabled: true },
      order: { createdAt: 'DESC' },
    });

    if (scenarios.length === 0) {
      return { items: [], total: 0 };
    }

    // 单条查询取该用户在这些场景上的全部作答 (零 N+1).
    const attempts = await this.attemptRepo.find({
      where: { userId, scenarioId: In(scenarios.map((s) => s.id)), deletedAt: IsNull() },
      select: { id: true, scenarioId: true, createdAt: true },
    });

    const stats = new Map<string, { count: number; lastAt: Date | null }>();
    for (const attempt of attempts) {
      const current = stats.get(attempt.scenarioId);
      if (!current) {
        stats.set(attempt.scenarioId, { count: 1, lastAt: attempt.createdAt });
        continue;
      }
      current.count += 1;
      if (current.lastAt === null || attempt.createdAt.getTime() > current.lastAt.getTime()) {
        current.lastAt = attempt.createdAt;
      }
    }

    const items: CustomPracticeScenarioListItemDto[] = scenarios.map((scenario) => {
      const stat = stats.get(scenario.id);
      const engine = engineOfMode(scenario.exerciseMode);
      return {
        id: scenario.id,
        scenarioId: scenario.id,
        exerciseId: scenario.exerciseId,
        mode: scenario.exerciseMode,
        modeLabel: labelOfMode(scenario.exerciseMode),
        difficulty: scenario.difficulty,
        personaName: scenario.generatedScenario.persona.name,
        personaNote: scenario.generatedScenario.persona.background,
        type: engine,
        visitorLine: scenario.generatedScenario.openingLine,
        source: PracticeScenarioOrigin.USER_GENERATED,
        attemptCount: stat?.count ?? 0,
        lastPracticedAt: stat?.lastAt ? stat.lastAt.toISOString() : null,
        createdAt: scenario.createdAt.toISOString(),
      };
    });

    // 排序: 最近练过的在前 (按时间倒序); 未练过的按生成时间倒序垫底.
    items.sort((a, b) => this.compareByLastPracticed(a, b));

    return { items, total: items.length };
  }

  // ══════════════════════════════════════════════════════════════════════
  // 内部实现
  // ══════════════════════════════════════════════════════════════════════

  /**
   * 闸门检查: 存量上限 (§8.5 B2) + 今日配额 (§7.4).
   *
   * 抽成独立 method 的原因: `generate()` 里串了 5 个步骤, 两条闸门各有分支,
   * 全部堆在一个方法里会让圈复杂度超出项目阈值; 而且"能不能生成"本身是一个
   * 完整的业务概念, 独立出来更好读也更好测.
   *
   * @param userId 当前用户 id
   * @returns reason = null 表示通过; 非 null = 被哪个闸门拦下 (对应降级原因)
   */
  private async checkGates(userId: string): Promise<{ reason: PracticeCustomScenarioDegradeReason | null }> {
    // ── 闸门 1: 私有场景存量上限 (§8.5 B2) ──
    const maxCount = this.maxCustomScenarioCount();
    const currentCount = await this.customScenarioRepo.count({ where: { userId, deletedAt: IsNull() } });
    if (currentCount >= maxCount) {
      this.logger.warn(`[practice_custom_scenario_degraded] reason=storage_limit user=${userId} count=${currentCount}`);
      return { reason: PracticeCustomScenarioDegradeReason.STORAGE_LIMIT_REACHED };
    }

    // ── 闸门 2: 今日生成次数 (§7.4) ──
    const dailyLimit = this.dailyLimit();
    const consume = await this.quotaService.consumeToday(userId, PracticeQuotaType.CUSTOM_SCENARIO_GENERATION, dailyLimit);
    if (!consume.success) {
      this.logger.warn(
        `[practice_custom_scenario_degraded] reason=quota_exceeded user=${userId} used=${consume.used} limit=${consume.limit}`,
      );
      return { reason: PracticeCustomScenarioDegradeReason.QUOTA_EXCEEDED };
    }

    return { reason: null };
  }

  /**
   * 列表排序比较器: 最近练过的在前, 未练过的按生成时间倒序垫底.
   *
   * 抽成独立 method 而不是内联在 sort 回调里: 内联版要写嵌套三元,
   * 可读性差且触发 sonarjs/no-nested-conditional; 拆开后每条分支只说一件事.
   *
   * @param a 列表项 a
   * @param b 列表项 b
   * @returns 负数 = a 在前; 正数 = b 在前; 0 = 同序
   */
  private compareByLastPracticed(a: CustomPracticeScenarioListItemDto, b: CustomPracticeScenarioListItemDto): number {
    const aAt = a.lastPracticedAt;
    const bAt = b.lastPracticedAt;

    if (aAt && bAt) {
      if (aAt === bAt) return 0;
      return aAt < bAt ? 1 : -1;
    }
    // 只有一边练过时, 练过的那边排前面.
    if (aAt) return -1;
    if (bAt) return 1;

    // 两边都没练过: 按生成时间倒序 (新的在前).
    if (a.createdAt === b.createdAt) return 0;
    return a.createdAt < b.createdAt ? 1 : -1;
  }

  /**
   * 解析 hintExerciseId → 基本功 + 题目 id.
   *
   * 传入不存在的 id 时**不报错**, 只当没传 (返回 null) —— 因为这个字段的语义是
   * "帮模型对齐方向"的线索, 不是必填的业务主键; 为一个辅助线索把整个请求打成
   * 400 并不划算 (用户拿到的是"生成失败", 而不是"请检查这个 id").
   *
   * @param hintExerciseId 用户指定的题目 id (可空)
   * @returns 基本功 + 题目 id (解析不到时为 null)
   */
  private async resolveHint(hintExerciseId: string | undefined): Promise<{ mode: TrainingExerciseMode; exerciseId: string } | null> {
    if (!hintExerciseId) {
      return null;
    }
    const exercise = await this.exerciseRepo.findOne({
      where: { id: hintExerciseId, enabled: true, deletedAt: IsNull() },
    });
    if (!exercise) {
      this.logger.warn(`[practice_custom_scenario_hint_unresolved] hintExerciseId=${hintExerciseId}`);
      return null;
    }
    return { mode: exercise.mode, exerciseId: exercise.id };
  }

  /**
   * 按基本功找对应的 training_exercises id (用于填充 exerciseId).
   *
   * @param mode 基本功
   * @returns 题目 id; 找不到时返回 null
   */
  private async findExerciseIdByMode(mode: TrainingExerciseMode): Promise<string | null> {
    const exercise = await this.exerciseRepo.findOne({
      where: { mode, enabled: true, deletedAt: IsNull() },
      order: { createdAt: 'ASC' },
    });
    return exercise?.id ?? null;
  }

  /**
   * 落库一条私有场景.
   *
   * @param userId 归属人
   * @param input 待落库内容
   * @returns 落库后的行
   */
  private async persist(
    userId: string,
    input: {
      exerciseId: string | null;
      exerciseMode: TrainingExerciseMode;
      difficulty: PracticeDifficulty;
      content: PracticeCustomScenarioContent;
      payload: PracticeCustomScenario['sourcePayload'];
      generationMode: PracticeScenarioGenerationMode;
    },
  ): Promise<PracticeCustomScenario> {
    // scenario_key 用随机 UUID 派生: 私有场景没有人工 slug, 且必须与共享库的
    // slug 命名空间完全隔离 (共享库是 `emotion_reflection_l1_01` 这种语义化 slug).
    const scenarioKey = `custom_${input.exerciseMode}_${randomUUID()}`;

    return this.customScenarioRepo.save(
      this.customScenarioRepo.create({
        tenantId: userId, // A9 一人一租户
        userId,
        exerciseId: input.exerciseId,
        exerciseMode: input.exerciseMode,
        difficulty: input.difficulty,
        sourcePayload: input.payload,
        generatedScenario: input.content,
        generationMode: input.generationMode,
        scenarioKey,
        enabled: true,
        deletedAt: null,
      }),
    );
  }

  /**
   * 降级 1: 回标准题库 (配额用尽 / 存量达上限).
   *
   * 从可见的共享内容库里挑一个场景 —— 优先挑跟用户指定基本功同档的 (让降级后的
   * 练习内容仍然贴近用户当下的意图), 否则在全部场景里随机取一个.
   *
   * @param userId 当前用户 id
   * @param preferredMode 期望的基本功 (可空)
   * @param reason 降级原因
   * @returns 降级后的场景响应
   */
  private async buildDegradedToLibrary(
    userId: string,
    preferredMode: TrainingExerciseMode | null,
    reason: PracticeCustomScenarioDegradeReason,
  ): Promise<GeneratedCustomPracticeScenarioDto> {
    const scenarios = await this.scenarioService.findVisibleScenarios(userId);
    if (scenarios.length === 0) {
      // 内容库也空了: 无可降级. 此时只能返回一个"空场景"占位, 客户端应走空态.
      return this.buildEmptyDegradedResponse(reason);
    }

    const preferred = preferredMode ? scenarios.filter((s) => s.exerciseMode === preferredMode) : [];
    const pool = preferred.length > 0 ? preferred : scenarios;
    const picked = pool[randomInt(pool.length)];

    const engine = engineOfMode(picked.exerciseMode);
    return {
      id: picked.scenarioId,
      scenarioId: picked.scenarioId,
      exerciseId: null,
      difficulty: picked.difficulty,
      personaName: picked.persona.name,
      personaNote: picked.persona.background,
      type: engine,
      content: {
        visitorLine: picked.openingLine,
        taskPrompt: picked.taskPrompt,
        dimensions: picked.rubric.dimensions.map((dimension) => ({
          key: dimension.key,
          label: dimension.label,
          positiveKeywords: dimension.positiveKeywords,
          antiKeywords: dimension.antiKeywords,
          check: dimension.check,
        })),
        referenceResponses: [picked.referenceResponse],
        commonErrors: picked.commonPitfalls,
      },
      isCustom: false,
      source: PracticeScenarioOrigin.STANDARD_LIBRARY,
      degraded: true,
      degradedReason: reason,
    };
  }

  /**
   * 降级 2: 走确定性模板场景 (LLM 失败 / 超时 / 开关关).
   *
   * 模板场景**照样落库** —— 否则练习记录里的 scenario_id 指向不存在的行,
   * 「我的真实场景」列表也会漏掉它. generation_mode 记为 'template',
   * 事后可查"模型退化比例".
   *
   * @param userId 当前用户 id
   * @param dto 三问表单 (取 visitorQuote 与 hint)
   * @param preferredMode 期望的基本功 (可空)
   * @returns 降级后的场景响应
   */
  private async buildDegradedToTemplate(
    userId: string,
    dto: GenerateCustomPracticeScenarioDto,
    preferredMode: TrainingExerciseMode | null,
  ): Promise<GeneratedCustomPracticeScenarioDto> {
    const mode = preferredMode ?? TrainingExerciseMode.EMOTION_REFLECTION;
    const template = buildTemplateScenario(dto.visitorQuote, mode);
    const templateContent = templateScenarioToContent(template);

    const content: PracticeCustomScenarioContent = {
      exerciseMode: template.exerciseMode,
      difficulty: template.difficulty,
      persona: {
        name: template.personaName,
        age: 28,
        gender: '未知',
        occupation: '未记录',
        defenseStyle: 'cooperative' as PracticeCustomScenarioContent['persona']['defenseStyle'],
        emotionIntensity: 'calm' as PracticeCustomScenarioContent['persona']['emotionIntensity'],
        background: template.personaNote,
      },
      openingLine: template.visitorLine,
      taskPrompt: template.taskPrompt,
      botchedUtterance: null,
      voiceScript: null,
      referenceResponse: templateContent.referenceResponses[0] ?? '',
      commonPitfalls: templateContent.commonErrors,
      rubric: { dimensions: template.dimensions },
    };

    const exerciseId = await this.findExerciseIdByMode(mode);
    const saved = await this.persist(userId, {
      exerciseId,
      exerciseMode: mode,
      difficulty: template.difficulty,
      content,
      payload: {
        visitorQuote: dto.visitorQuote,
        counselorReply: dto.counselorReply ?? '',
        stuckPoint: dto.stuckPoint ?? '',
        hintExerciseId: dto.hintExerciseId ?? null,
      },
      generationMode: PracticeScenarioGenerationMode.TEMPLATE,
    });

    return this.buildResponse(saved, content, true, PracticeCustomScenarioDegradeReason.GENERATION_UNAVAILABLE);
  }

  /**
   * 内容库也为空时的兜底响应 (无场景可降级).
   *
   * @param reason 降级原因
   * @returns 空场景响应
   */
  private buildEmptyDegradedResponse(reason: PracticeCustomScenarioDegradeReason): GeneratedCustomPracticeScenarioDto {
    return {
      id: '',
      scenarioId: '',
      exerciseId: null,
      difficulty: PracticeDifficulty.L1,
      personaName: '',
      personaNote: '',
      type: PracticeEngine.AI_RESPONSE,
      content: {
        visitorLine: '',
        taskPrompt: '',
        dimensions: [],
        referenceResponses: [],
        commonErrors: [],
      },
      isCustom: false,
      source: PracticeScenarioOrigin.STANDARD_LIBRARY,
      degraded: true,
      degradedReason: reason,
    };
  }

  /**
   * 组装成功路径的响应体.
   */
  private buildResponse(
    saved: PracticeCustomScenario,
    content: PracticeCustomScenarioContent,
    degraded: boolean,
    degradedReason: PracticeCustomScenarioDegradeReason | null,
  ): GeneratedCustomPracticeScenarioDto {
    const engine = engineOfMode(saved.exerciseMode);
    return {
      id: saved.id,
      scenarioId: saved.id,
      exerciseId: saved.exerciseId,
      difficulty: saved.difficulty,
      personaName: content.persona.name,
      personaNote: content.persona.background,
      type: engine,
      content: {
        visitorLine: content.openingLine,
        taskPrompt: content.taskPrompt,
        dimensions: content.rubric.dimensions.map((dimension) => ({
          key: dimension.key,
          label: dimension.label,
          positiveKeywords: dimension.positiveKeywords,
          antiKeywords: dimension.antiKeywords,
          check: dimension.check,
        })),
        referenceResponses: [content.referenceResponse],
        commonErrors: content.commonPitfalls,
      },
      isCustom: true,
      source: PracticeScenarioOrigin.USER_GENERATED,
      degraded,
      degradedReason,
    };
  }

  /**
   * 今日生成次数上限 (§7.4 缺省 5, env 可覆盖).
   */
  private dailyLimit(): number {
    return parsePositiveIntEnv(
      this.config.get<string>(PRACTICE_CUSTOM_SCENARIO_DAILY_LIMIT_ENV_KEY),
      PRACTICE_CUSTOM_SCENARIO_DAILY_LIMIT_DEFAULT,
    );
  }

  /**
   * 私有场景存量上限 (§8.5 B2, env 可覆盖).
   */
  private maxCustomScenarioCount(): number {
    return parsePositiveIntEnv(
      this.config.get<string>(PRACTICE_CUSTOM_SCENARIO_MAX_COUNT_ENV_KEY),
      PRACTICE_CUSTOM_SCENARIO_MAX_COUNT_DEFAULT,
      1,
    );
  }

  /**
   * 生成时限 (§7.4 缺省 8s, env 可覆盖).
   *
   * 只用于**超时兜底**的判定; LLM 调用本身用 profile 里的 30s 窗口,
   * 两者的关系见 counselor-llm.config.ts 的说明.
   */
  private generationTimeoutMs(): number {
    return parsePositiveIntEnv(
      this.config.get<string>(PRACTICE_CUSTOM_SCENARIO_TIMEOUT_ENV_KEY),
      PRACTICE_CUSTOM_SCENARIO_TIMEOUT_DEFAULT_MS,
      1,
    );
  }
}
