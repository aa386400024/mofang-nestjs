// V2026-10-22 治本 (V1.3 §3.1 / §3.2 / §3.4 — 场景读取侧 service):
//   原因: 微技能练习引擎的读侧有 3 个契约 (§3.1 进度聚合 / §3.2 取场景 / §3.4 随机抽练),
//     它们的共同难点是**可见性**: 场景现在有**两个物理来源** (V1.3 §7.5 拆表之后):
//       - practice_scenarios        共享内容库 (user_id IS NULL) + 旧口径的自建场景
//       - practice_custom_scenarios 用户私有场景 (user_id = 本人, §7 新增)
//     一旦可见性写错, 就会出现两种事故:
//       (1) 泄露: A 用户的自建场景出现在 B 用户的列表里
//       (2) 漏读: 共享场景因为租户过滤被挡掉, 全站 60 条内容一条都读不到
//     故本 service 收敛**唯一一处**可见性谓词 (shared OR own), 3 个端点共用,
//     杜绝"每个端点各写一遍过滤条件"导致的漂移.
//
//   修法 (跟 V1.1 §5.2 training-exercise.service.ts 风格一致):
//     - getProgress(): 单条 SQL 取可见场景全集 + 单条 SQL 取该用户全部作答,
//       内存分组后一次返回 (零 N+1, spec §3.1「一次返回全量」)
//     - getScenarioDetail(): 复用同一可见性谓词, 并带出 attemptOrdinal
//     - pickRandom(): 服务端混洗, 优先未练过的场景 (spec §1.4「随机一题」零决策负担)
//
//   V2026-10-22 治本 (V1.3 §7.5 — 场景视图化):
//     本 service 的所有对外方法现在返回 `PracticeScenarioView` (领域视图) 而不是
//     TypeORM entity. 原因: 场景有两个物理来源, 上层 (evaluator / attempt service)
//     只该关心"场景内容", 不该关心它存在哪张表. 投影逻辑集中在
//     domain/practice/practice-scenario-view.ts 一处, 本 service 只做"找哪一行".
//
//   反双胞胎:
//     - 不用 tenant_id 做可见性过滤: 共享内容库挂在系统租户哨兵值下, 按 tenant
//       过滤会把全站内容库挡光; 可见性由 user_id 语义表达 (见 PRACTICE_SYSTEM_TENANT_ID)
//     - 不在 controller 里拼过滤条件: 过滤是业务语义, 放 controller 必然漂移
//     - 不返回 rubric 原文: rubric 是评判内部锚点, 下发等于把判定依据交给客户端
//     - 不硬锁 L3 场景: spec §1.2「不做硬锁定」, 高负荷场景由前端轻提示兜底
//     - 不把私有场景混进共享内容库: §7.5 要求物理隔离 (审核边界), 本 service
//       只负责"按 id 找到它", 不负责"把它搬进主表"
//
//   验证:
//     1. tsc 0 错
//     2. GET progress → modes.length === 10, 每个 mode 的 variants 合计 = 可见场景数
//     3. GET progress → summary.totalAttempts === 该用户 practice_attempts 总行数
//     4. 换一个用户调 GET progress → 看不到别人的自建场景
//     5. POST random → 返回的 scenarioId 一定能被 §3.2 取到
//     6. 生成一条私有场景后 → GET progress 的 variants 里能看到它, 且 §3.2 能取到详情
//
//   时间戳: 2026-10-22
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomInt } from 'node:crypto';
import { IsNull, type Repository } from 'typeorm';

import { BizCode } from '../../common/exceptions/biz-code.enum';
import { BizException } from '../../common/exceptions/biz.exception';
import { PRACTICE_MODE_ENGINE_META, engineOfMode, labelOfMode, typeOfMode } from '../config/practice-display-meta';
import { TRAINING_EXERCISE_MODES_BY_TYPE } from '../config/training-exercise-display-meta';
import { toCustomScenarioView, toScenarioView } from '../domain/practice/practice-scenario-view';
import type { PracticeScenarioView } from '../domain/practice/practice.types';
import type {
  PracticeModeProgressDto,
  PracticeProgressDto,
  PracticeProgressSummaryDto,
  PracticeScenarioDetailDto,
  PracticeScenarioVariantDto,
} from '../dto/practice.dto';
import { PracticeAttempt } from '../entities/practice-attempt.entity';
import { PracticeCustomScenario } from '../entities/practice-custom-scenario.entity';
import { PracticeScenario } from '../entities/practice-scenario.entity';
import { PRACTICE_DIFFICULTY_LABELS, PracticeDifficulty } from '../enums/practice-difficulty.enum';
import { PRACTICE_HIGH_LOAD_NOTICE } from '../enums/practice-emotion-intensity.enum';
import { PRACTICE_ENGINE_INTROS, PRACTICE_ENGINE_LABELS } from '../enums/practice-engine.enum';
import { PracticeScenarioOrigin, PracticeScenarioSource } from '../enums/practice-scenario-source.enum';
import { TrainingExerciseMode } from '../enums/training-exercise-mode.enum';

/**
 * 单个场景的练习统计 (内存分组产物).
 */
interface ScenarioPracticeStat {
  /** 累计练习次数 */
  attemptCount: number;
  /** 最近一次练习时间 */
  lastPracticedAt: Date | null;
}

/**
 * 微技能练习 —— 场景读取侧 service.
 */
@Injectable()
export class PracticeScenarioService {
  constructor(
    @InjectRepository(PracticeScenario)
    private readonly scenarioRepo: Repository<PracticeScenario>,
    @InjectRepository(PracticeCustomScenario)
    private readonly customScenarioRepo: Repository<PracticeCustomScenario>,
    @InjectRepository(PracticeAttempt)
    private readonly attemptRepo: Repository<PracticeAttempt>,
  ) {}

  // ══════════════════════════════════════════════════════════════════════
  // §3.1 进度聚合 (单请求, 零 N+1)
  // ══════════════════════════════════════════════════════════════════════

  /**
   * 取该用户可见的全部场景 (共享内容库 + 本人自建场景).
   *
   * 可见性谓词 (**全仓唯一一处**):
   *   - practice_scenarios:        (user_id IS NULL OR user_id = 本人) AND enabled = 1
   *   - practice_custom_scenarios: (user_id = 本人)            AND enabled = 1
   *   私有表**没有** user_id IS NULL 这一档 —— 它是私有表, 不存在共享行.
   *
   * @param userId 当前用户 id
   * @returns 可见场景视图列表 (按基本功 → 难度 → slug 排序)
   */
  async findVisibleScenarios(userId: string): Promise<PracticeScenarioView[]> {
    const [seedScenarios, customScenarios] = await Promise.all([
      this.scenarioRepo
        .createQueryBuilder('s')
        .where('s.deletedAt IS NULL')
        .andWhere('s.enabled = :enabled', { enabled: true })
        .andWhere('(s.userId IS NULL OR s.userId = :userId)', { userId })
        .orderBy('s.exerciseMode', 'ASC')
        .addOrderBy('s.difficulty', 'ASC')
        .addOrderBy('s.scenarioKey', 'ASC')
        .getMany(),
      this.customScenarioRepo
        .createQueryBuilder('c')
        .where('c.deletedAt IS NULL')
        .andWhere('c.enabled = :enabled', { enabled: true })
        .andWhere('c.userId = :userId', { userId })
        .orderBy('c.exerciseMode', 'ASC')
        .addOrderBy('c.difficulty', 'ASC')
        .addOrderBy('c.createdAt', 'ASC')
        .getMany(),
    ]);

    const views = [...seedScenarios.map(toScenarioView), ...customScenarios.map(toCustomScenarioView)];

    // 统一排序: 基本功 → 难度 → 场景键. 私有场景的键是随机派生的, 排在同难度的
    // 共享场景之后, 保证列表顺序稳定 (刷新不会跳来跳去).
    views.sort((a, b) => {
      if (a.exerciseMode !== b.exerciseMode) {
        return a.exerciseMode < b.exerciseMode ? -1 : 1;
      }
      if (a.difficulty !== b.difficulty) {
        return a.difficulty - b.difficulty;
      }
      if (a.source !== b.source) {
        // 共享内容库排前面 (它是默认练习路径), 私有场景排后面.
        return a.source === PracticeScenarioSource.SEED ? -1 : 1;
      }
      return this.compareScenarioKey(a, b);
    });

    return views;
  }

  /**
   * 场景排序比较器 (同一基本功 + 同一难度 + 同一来源时, 按场景键排).
   *
   * 抽成独立 method 而不是内联在 sort 回调里: 内联版要写嵌套三元,
   * 可读性差且触发 sonarjs/no-nested-conditional.
   *
   * @param a 场景视图 a
   * @param b 场景视图 b
   * @returns 负数 = a 在前; 正数 = b 在前; 0 = 同序
   */
  private compareScenarioKey(a: PracticeScenarioView, b: PracticeScenarioView): number {
    if (a.scenarioKey === b.scenarioKey) return 0;
    return a.scenarioKey < b.scenarioKey ? -1 : 1;
  }

  /**
   * 进度聚合 (§3.1).
   *
   * 一次返回: 汇总 + 10 个基本功的全部场景变体 + 弱项推荐 + 随机入口的下一个场景.
   *
   * @param userId 当前用户 id
   * @returns 进度聚合结果
   */
  async getProgress(userId: string): Promise<PracticeProgressDto> {
    const [scenarios, attempts] = await Promise.all([
      this.findVisibleScenarios(userId),
      this.attemptRepo.find({
        where: { userId, deletedAt: IsNull() },
        // 只取统计需要的列: 用户作答量级会随时间增长, 全列读进内存是浪费.
        select: { id: true, scenarioId: true, createdAt: true },
      }),
    ]);

    // 内存分组: scenarioId → 统计 (SQL 层已按 user 过滤, 无 N+1)
    const stats = new Map<string, ScenarioPracticeStat>();
    for (const attempt of attempts) {
      const current = stats.get(attempt.scenarioId);
      if (!current) {
        stats.set(attempt.scenarioId, { attemptCount: 1, lastPracticedAt: attempt.createdAt });
        continue;
      }
      current.attemptCount += 1;
      const lastAt = current.lastPracticedAt;
      if (lastAt === null || attempt.createdAt.getTime() > lastAt.getTime()) {
        current.lastPracticedAt = attempt.createdAt;
      }
    }

    const modes = this.buildModeProgress(scenarios, stats);
    const summary = this.buildSummary(scenarios, stats, attempts.length);

    return {
      summary,
      modes,
      weakModes: this.pickWeakModes(modes),
      nextRandomScenarioId: this.pickNextRandomScenarioId(scenarios, stats),
    };
  }

  // ══════════════════════════════════════════════════════════════════════
  // §3.2 取场景开练
  // ══════════════════════════════════════════════════════════════════════

  /**
   * 取单个场景详情 (§3.2).
   *
   * @param userId 当前用户 id
   * @param scenarioId 场景 id
   * @returns 场景详情 (含 attemptOrdinal)
   */
  async getScenarioDetail(userId: string, scenarioId: string): Promise<PracticeScenarioDetailDto> {
    const scenario = await this.findVisibleScenario(userId, scenarioId);
    const attemptOrdinal = await this.countAttempts(userId, scenarioId);
    const engine = engineOfMode(scenario.exerciseMode);

    return {
      scenarioId: scenario.scenarioId,
      exerciseMode: scenario.exerciseMode,
      modeLabel: labelOfMode(scenario.exerciseMode),
      type: typeOfMode(scenario.exerciseMode),
      engine,
      engineLabel: PRACTICE_ENGINE_LABELS[engine],
      engineIntro: PRACTICE_ENGINE_INTROS[engine],
      difficulty: scenario.difficulty,
      difficultyLabel: PRACTICE_DIFFICULTY_LABELS[scenario.difficulty],
      persona: scenario.persona,
      openingLine: scenario.openingLine,
      taskPrompt: scenario.taskPrompt,
      botchedUtterance: scenario.botchedUtterance,
      voiceScript: scenario.voiceScript,
      attemptOrdinal,
      expectedTurns: scenario.expectedTurns,
      // V1.3 §7.5: 场景来源表 (客户端据此区分标准题库 / 我的真实场景).
      scenarioSource: scenario.source,
      isCustom: scenario.source === PracticeScenarioSource.CUSTOM,
      // V1.3 §7.2: 内容出处 (跟 scenarioSource 语义不同 —— 一个说存在哪张表, 一个说谁写的).
      origin:
        scenario.source === PracticeScenarioSource.CUSTOM ? PracticeScenarioOrigin.USER_GENERATED : PracticeScenarioOrigin.STANDARD_LIBRARY,
      // L3 高情绪负荷场景: 下发知情同意式铺垫文案 (spec §1.2, 前端弹轻提示不阻挡).
      highLoadNotice: scenario.difficulty === PracticeDifficulty.L3 ? PRACTICE_HIGH_LOAD_NOTICE : null,
    };
  }

  /**
   * 取单个可见场景 (内部用, 供写入侧复用可见性判定).
   *
   * V1.3 §7.5: 场景有两个物理来源, 这里按"先共享库后私有库"的顺序解析:
   *   1. practice_scenarios        (共享 + 旧口径自建)
   *   2. practice_custom_scenarios (§7 私有场景, 仅本人)
   * 两个来源的 id 都是 UUID, 碰撞概率可忽略; 且即便碰撞, 解析顺序固定 = 行为确定.
   *
   * @param userId 当前用户 id
   * @param scenarioId 场景 id
   * @returns 场景视图
   * @throws BizException(PracticeScenarioNotFound) 场景不存在 / 已停用 / 无权访问
   */
  async findVisibleScenario(userId: string, scenarioId: string): Promise<PracticeScenarioView> {
    const seed = await this.scenarioRepo.findOne({
      where: [
        { id: scenarioId, userId: IsNull(), enabled: true, deletedAt: IsNull() },
        { id: scenarioId, userId, enabled: true, deletedAt: IsNull() },
      ],
    });
    if (seed) {
      return toScenarioView(seed);
    }

    const custom = await this.customScenarioRepo.findOne({
      where: { id: scenarioId, userId, enabled: true, deletedAt: IsNull() },
    });
    if (custom) {
      return toCustomScenarioView(custom);
    }

    throw new BizException(BizCode.PracticeScenarioNotFound, `练习场景不存在或不可用: ${scenarioId}`);
  }

  // ══════════════════════════════════════════════════════════════════════
  // §3.4 随机抽练
  // ══════════════════════════════════════════════════════════════════════

  /**
   * 随机抽一个场景 (§3.4).
   *
   * 优先在**未练过**的场景里抽 (spec §1.4「随机一题: 跨全部场景随机, 零决策负担」),
   * 全部练过时退化为在全部场景里抽.
   *
   * @param userId 当前用户 id
   * @param exceptMode 需要避开的基本功 (可选)
   * @returns 场景 id
   * @throws BizException(PracticeScenarioPoolEmpty) 内容库为空
   */
  async pickRandomScenarioId(userId: string, exceptMode?: TrainingExerciseMode): Promise<string> {
    const scenarios = await this.findVisibleScenarios(userId);
    const pool = exceptMode ? scenarios.filter((s) => s.exerciseMode !== exceptMode) : scenarios;

    if (pool.length === 0) {
      // §8.5 E2 治本: 「内容库为空」与「无权访问」必须能被前端分开处理.
      //   之前这里抛 NotFoundException, 前端只能看到 404, 于是把"还没灌 seed"
      //   显示成"你的场景被删了" —— 两种完全不同的用户沟通.
      //   现在用专用的 PoolEmpty code, 前端可以据此显示"题库正在补充中"的空态.
      throw new BizException(BizCode.PracticeScenarioPoolEmpty);
    }

    const attempts = await this.attemptRepo.find({
      where: { userId, deletedAt: IsNull() },
      select: { id: true, scenarioId: true, createdAt: true },
    });
    const practiced = new Set(attempts.map((attempt) => attempt.scenarioId));

    const fresh = pool.filter((scenario) => !practiced.has(scenario.scenarioId));
    const candidates = fresh.length > 0 ? fresh : pool;
    // randomInt 而非 Math.random: 熵源走 CSPRNG (node:crypto), 避免可预测的伪随机
    // (sonarjs/pseudo-random); 随机只用于"抽一个场景", 不影响任何判定结果.
    const picked = candidates[randomInt(candidates.length)];

    return picked.scenarioId;
  }

  // ══════════════════════════════════════════════════════════════════════
  // 内部组装
  // ══════════════════════════════════════════════════════════════════════

  /**
   * 组装逐基本功进度.
   *
   * 固定返回 10 个基本功 (未练过的基本功也返回, variants 为空数组),
   * 客户端列表页据此渲染完整结构, 不需要自己补齐缺失项.
   */
  private buildModeProgress(scenarios: PracticeScenarioView[], stats: Map<string, ScenarioPracticeStat>): PracticeModeProgressDto[] {
    const byMode = new Map<TrainingExerciseMode, PracticeScenarioView[]>();
    for (const scenario of scenarios) {
      const bucket = byMode.get(scenario.exerciseMode);
      if (bucket) {
        bucket.push(scenario);
      } else {
        byMode.set(scenario.exerciseMode, [scenario]);
      }
    }

    // 固定顺序: 倾听共情 3 → 提问技术 4 → 语音微训练 3 (跟既有 display-meta 同序)
    const orderedModes: TrainingExerciseMode[] = [
      ...TRAINING_EXERCISE_MODES_BY_TYPE.listening,
      ...TRAINING_EXERCISE_MODES_BY_TYPE.questioning,
      ...TRAINING_EXERCISE_MODES_BY_TYPE.voiceMicro,
    ];

    return orderedModes.map((mode) => {
      const variants: PracticeScenarioVariantDto[] = (byMode.get(mode) ?? []).map((scenario) => {
        const stat = stats.get(scenario.scenarioId);
        return {
          scenarioId: scenario.scenarioId,
          scenarioKey: scenario.scenarioKey,
          difficulty: scenario.difficulty,
          difficultyLabel: PRACTICE_DIFFICULTY_LABELS[scenario.difficulty],
          personaName: scenario.persona.name,
          personaNote: scenario.persona.background,
          openingLine: scenario.openingLine,
          completed: (stat?.attemptCount ?? 0) > 0,
          attemptCount: stat?.attemptCount ?? 0,
          lastPracticedAt: stat?.lastPracticedAt ? stat.lastPracticedAt.toISOString() : null,
          // V1.3 §7.5: 客户端据此区分标准题库 / 我的真实场景.
          scenarioSource: scenario.source,
        };
      });

      return {
        mode,
        modeLabel: labelOfMode(mode),
        type: typeOfMode(mode),
        engine: PRACTICE_MODE_ENGINE_META[mode],
        variants,
      };
    });
  }

  /**
   * 组装汇总指标.
   */
  private buildSummary(
    scenarios: PracticeScenarioView[],
    stats: Map<string, ScenarioPracticeStat>,
    totalAttempts: number,
  ): PracticeProgressSummaryDto {
    const completedScenarios = scenarios.filter((scenario) => (stats.get(scenario.scenarioId)?.attemptCount ?? 0) > 0).length;

    // 最近 7 天活跃自然天数 (非连续 streak —— PRD §2.4-3 反对打卡施压)
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setHours(0, 0, 0, 0);
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);

    const seenDays = new Set<string>();
    const threshold = sevenDaysAgo.getTime();
    for (const stat of stats.values()) {
      const lastAt = stat.lastPracticedAt;
      if (!lastAt || lastAt.getTime() < threshold) continue;
      seenDays.add(`${lastAt.getFullYear()}-${lastAt.getMonth() + 1}-${lastAt.getDate()}`);
    }
    const activeDaysLast7d = seenDays.size;

    return {
      totalScenarios: scenarios.length,
      completedScenarios,
      totalAttempts,
      activeDaysLast7d,
    };
  }

  /**
   * 弱项推荐: 练习次数最少的 3 个基本功 (含从未练的).
   *
   * 排序键 = (练习次数, 基本功在固定顺序里的位次) —— 次数相同时按固定顺序兜底,
   * 保证同一份数据每次返回的 weakModes 完全一致 (前端不会"每次刷新置顶项都变").
   */
  private pickWeakModes(modes: PracticeModeProgressDto[]): TrainingExerciseMode[] {
    const ordered = modes.map((mode, index) => ({
      mode: mode.mode,
      index,
      attempts: mode.variants.reduce((sum, variant) => sum + variant.attemptCount, 0),
    }));

    ordered.sort((a, b) => (a.attempts === b.attempts ? a.index - b.index : a.attempts - b.attempts));
    return ordered.slice(0, 3).map((item) => item.mode);
  }

  /**
   * 随机入口的下一个场景 id (服务端混洗, 优先未练过的).
   *
   * 与 pickRandomScenarioId 同口径, 但不抛异常 —— 内容库为空时返回空串,
   * 让前端走空态而不是 500.
   */
  private pickNextRandomScenarioId(scenarios: PracticeScenarioView[], stats: Map<string, ScenarioPracticeStat>): string {
    if (scenarios.length === 0) {
      return '';
    }
    const fresh = scenarios.filter((scenario) => (stats.get(scenario.scenarioId)?.attemptCount ?? 0) === 0);
    const candidates = fresh.length > 0 ? fresh : scenarios;
    // randomInt 而非 Math.random: 熵源走 CSPRNG (node:crypto), 避免可预测的伪随机
    // (sonarjs/pseudo-random); 随机只用于"抽一个场景", 不影响任何判定结果.
    const picked = candidates[randomInt(candidates.length)];
    return picked.scenarioId;
  }

  /**
   * 数该用户在某场景上的已练次数 (§3.2 的 attemptOrdinal 用).
   */
  async countAttempts(userId: string, scenarioId: string): Promise<number> {
    return this.attemptRepo.count({ where: { userId, scenarioId, deletedAt: IsNull() } });
  }
}
