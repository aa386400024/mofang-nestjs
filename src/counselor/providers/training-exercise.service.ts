// V2026-10-20 治本 (专项技能训练中心改版 — 训练题 Service: 幂等 seed + 聚合进度 + 确定性评分):
//   原因: 三个真实缺陷一次性根治 ——
//     (1) training_exercises 为空表, 改版后详情页首屏无内容可渲染;
//     (2) 原客户端 mock 评分为「正确 80 + 随机 0-20」, 同一答案两次得分不同,
//         违反设计规格 §8「专业反馈」与可复盘要求, 且随机分让训练失去意义;
//     (3) 进度需要 summary + 10 项明细, 若按 mode 逐个查会产生 N+1 往返,
//         违反设计规格 §10 性能预算.
//   修复:
//     - ensureSeeds(): 启动期按 (type, mode) 幂等 upsert, 内容以代码内基线为单一事实源
//     - grade(): 确定性评分 (命中 90 / 未命中 45), 维度分同源派生, 零随机
//     - getProgress(): 单条聚合 SQL 取全部 graded/inProgress 记录, 内存分组后一次返回
//   反双胞胎:
//     - 不用 synchronize: true (ADR-0003 已定, schema 走 migration)
//     - 不在 seed 里写随机或时间相关内容 (否则 upsert 每次都产生 diff)
//     - 不把 correctOptionIndex 返回给列表接口 (防答案泄漏)
//   验证:
//     1. 首次启动 → SELECT COUNT(*) FROM training_exercises → 10
//     2. 重启两次 → COUNT(*) 仍为 10 (幂等)
//     3. 同一 exerciseId + 同一 selectedOptionIndex 提交两次 → score 恒等
//     4. GET progress 返回 items.length === 10 且 summary.totalItems === 10
//   时间戳: 2026-10-20
import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Repository } from 'typeorm';

import { TRAINING_EXERCISE_MODE_META } from '../config/training-exercise-display-meta';
import type {
  SubmitTrainingExerciseAttemptDto,
  TrainingExerciseAttemptResultDto,
  TrainingExerciseDto,
  TrainingExerciseListDto,
  TrainingExerciseProgressDto,
  TrainingExerciseProgressItemDto,
  TrainingExerciseQueryDto,
} from '../dto/training-exercise.dto';
import { TrainingExerciseAttempt } from '../entities/training-exercise-attempt.entity';
import { TrainingExercise } from '../entities/training-exercise.entity';
import { TrainingAttemptStatus } from '../enums/training-attempt-status.enum';

/**
 * 训练题服务 —— 内容来自 DB, 本类**不含任何内容灌入逻辑**.
 *
 * V2026-10-20 治本 (内容来源治理):
 *   原因: 原实现在 onModuleInit 里调 ensureSeeds(), 每次应用启动都把 10 道
 *   训练题内容(情景陈述/选项/专家反馈)从**应用代码**写进库. 这有三个问题:
 *     1. 内容与应用二进制同版本 —— 内容改动必须改代码 + 重启 + 重新灌, 运营改不动
 *        (大炮拍板: 「训练题先数据库 mock, 回头有专门知识库从那里面弄」)
 *     2. 启动期写库是隐藏副作用: 多副本部署时每个实例启动都触发一次写, 且
 *        DB 不可达时会把「题库为空」这个局部问题升级成「服务启动受阻」
 *     3. 内容无法与 schema 分离演进, 知识库接入后会被迫回填历史
 *   修复: 灌入逻辑迁出至 seeds/training-exercises.seed.ts + 独立脚本
 *         (npm run seed:training), 按稳定 id 幂等 upsert.
 *         本服务只负责**读取与评分**, 读取不到就是读取不到 —— 返回空集让前端
 *         走设计规格 §5 S5 错误态, 而不是用代码内容假装有数据.
 *   反双胞胎:
 *     - 不保留 ensureSeeds 兜底 (那等于把内容又绑回代码)
 *     - 不在 service 内 import seed 数据 (会造成循环依赖且掩盖内容来源)
 *   验证:
 *     1. 不跑 seed 直接启动 → 列表端点返回空集, 应用正常启动
 *     2. npm run seed:training → 10 行入库, 连跑两次无重复
 * 时间戳: 2026-10-20
 */
@Injectable()
export class TrainingExerciseService {
  constructor(
    @InjectRepository(TrainingExercise)
    private readonly exerciseRepo: Repository<TrainingExercise>,
    @InjectRepository(TrainingExerciseAttempt)
    private readonly attemptRepo: Repository<TrainingExerciseAttempt>,
  ) {}

  // ═══════════════ 查询 ═══════════════

  async listExercises(query: TrainingExerciseQueryDto): Promise<TrainingExerciseListDto> {
    const qb = this.exerciseRepo.createQueryBuilder('e').where('e.deletedAt IS NULL').andWhere('e.enabled = :enabled', { enabled: true });

    if (query.type) {
      qb.andWhere('e.type = :type', { type: query.type });
    }
    if (query.mode) {
      qb.andWhere('e.mode = :mode', { mode: query.mode });
    }
    if (query.difficulty) {
      qb.andWhere('e.difficulty = :difficulty', { difficulty: query.difficulty });
    }

    const rows = await qb.orderBy('e.type', 'ASC').addOrderBy('e.mode', 'ASC').getMany();

    return { items: rows.map((e) => this.toDto(e)), total: rows.length };
  }

  async findOneExercise(id: string): Promise<TrainingExercise> {
    const exercise = await this.exerciseRepo.findOne({
      // V2026-10-20 修正 (tsc TS2322): deletedAt 是 Date 列, FindOptionsWhere 里
      //   不接受 null (类型为 Date | FindOperator<Date>), 必须用 IsNull() 表达
      //   「未软删」. 写 null 会被 TS 拒绝; 若强转则运行时语义错误.
      where: { id, enabled: true, deletedAt: IsNull() },
    });
    if (!exercise) {
      throw new NotFoundException(`训练题不存在或已停用: ${id}`);
    }
    return exercise;
  }

  /**
   * 单题 DTO — 对外暴露而非让调用方索引私有 toDto。
   *
   * V2026-10-20 治本: controller 曾用 `service['toDto'](e)` 绕过 private,
   * 属黑盒魔法代码 (违反 AGENTS 可追溯性要求), 且 TS 无法校验调用正确性.
   * 改为公开入口后, 编译期即可发现签名漂移.
   */
  async getExerciseDto(id: string): Promise<TrainingExerciseDto> {
    return this.toDto(await this.findOneExercise(id));
  }

  // ═══════════════ 进度聚合 (单请求, 零 N+1) ═══════════════

  async getProgress(userId: string, query: TrainingExerciseQueryDto): Promise<TrainingExerciseProgressDto> {
    // 1) 先取题目全集 (过滤条件在此处统一应用, 保证 items 长度 = 可练训练项数)
    const listDto = await this.listExercises(query);
    const exercises = listDto.items;

    if (exercises.length === 0) {
      return {
        summary: { totalItems: 0, completedItems: 0, averageScore: null, activeDaysLast7d: 0 },
        items: [],
      };
    }

    // 2) 单条聚合查询取该用户在这些题目上的全部评分/进行中记录
    const exerciseIds = exercises.map((e) => e.id);
    const attempts = await this.attemptRepo.find({
      where: {
        userId,
        exerciseId: In(exerciseIds),
        status: In([TrainingAttemptStatus.GRADED, TrainingAttemptStatus.IN_PROGRESS]),
      },
      order: { completedAt: 'DESC' },
    });

    // 3) 内存分组: exerciseId → 记录列表 (已在 SQL 层完成筛选, 无 N+1)
    const byExercise = new Map<string, TrainingExerciseAttempt[]>();
    for (const attempt of attempts) {
      const bucket = byExercise.get(attempt.exerciseId);
      if (bucket) {
        bucket.push(attempt);
      } else {
        byExercise.set(attempt.exerciseId, [attempt]);
      }
    }

    const items: TrainingExerciseProgressItemDto[] = exercises.map((e) => {
      const bucket = byExercise.get(e.id) ?? [];
      const graded = bucket.filter((a) => a.status === TrainingAttemptStatus.GRADED);
      const inProgress = bucket.some((a) => a.status === TrainingAttemptStatus.IN_PROGRESS);

      // attempts 已按 completedAt DESC 排序 → 桶内 [0] 即最近一次
      const lastPracticedAt = bucket[0]?.completedAt ?? null;
      const lastScore = graded.length > 0 ? graded[0].score : null;

      return {
        type: e.type,
        mode: e.mode,
        exerciseId: e.id,
        completed: graded.length > 0,
        inProgress,
        lastScore,
        lastPracticedAt: lastPracticedAt ? lastPracticedAt.toISOString() : null,
        attemptCount: bucket.length,
        durationMinutes: e.durationMinutes,
      };
    });

    return { summary: this.buildSummary(items), items };
  }

  private buildSummary(items: TrainingExerciseProgressItemDto[]): TrainingExerciseProgressDto['summary'] {
    const completedItems = items.filter((i) => i.completed).length;

    // 平均分只统计已完成项; 无完成项返回 null (不返回 0 —— 设计规格 §5 S0:
    // 显示 0 会被用户误读为「练了但很差」)
    const averageScore =
      completedItems === 0
        ? null
        : Math.round(
            items.filter((i) => i.completed && i.lastScore !== null).reduce((sum, i) => sum + (i.lastScore ?? 0), 0) / completedItems,
          );

    // 最近 7 天活跃自然天数 (非连续 streak —— PRD §2.4-3 反对打卡施压, 设计规格 §8 已拍板)
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setHours(0, 0, 0, 0);
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);

    const activeDays = new Set<string>();
    for (const item of items) {
      if (!item.lastPracticedAt) continue;
      const d = new Date(item.lastPracticedAt);
      if (d >= sevenDaysAgo) {
        activeDays.add(`${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`);
      }
    }

    return { totalItems: items.length, completedItems, averageScore, activeDaysLast7d: activeDays.size };
  }

  // ═══════════════ 答题 ═══════════════

  /**
   * V2026-10-20 治本: tenantId 不再由 controller 传入.
   *
   * 原因: JwtAuthGuard 注入 request.user 仅为 { userId, username, roles } (见
   *   jwt-auth.guard.ts V2026-08-27 注释), payload 里根本没有 tenantId. 原 controller
   *   写 user.tenantId 恒为 undefined, 写库时 tenant_id 会退化成 NULL 触发 NOT NULL 报错,
   *   或在宽松驱动下静默写入脏值 —— 属"看起来能跑"的隐性故障.
   * 修复: 按 A9「一人一租户」约定在 service 内部派生 tenantId = userId,
   *   调用方无法再传错, 也无需知道租户约定.
   */
  async submitAttempt(
    userId: string,
    exerciseId: string,
    dto: SubmitTrainingExerciseAttemptDto,
  ): Promise<TrainingExerciseAttemptResultDto> {
    const tenantId = userId; // A9 一人一租户
    const exercise = await this.findOneExercise(exerciseId);

    if (dto.selectedOptionIndex >= exercise.options.length) {
      throw new NotFoundException(`候选项索引越界: ${dto.selectedOptionIndex} (共 ${exercise.options.length} 项)`);
    }

    const isCorrect = dto.selectedOptionIndex === exercise.correctOptionIndex;
    const { score, dimensionScores } = this.grade(exercise, isCorrect);

    const completedAt = new Date();
    const saved = await this.attemptRepo.save(
      this.attemptRepo.create({
        tenantId,
        userId,
        exerciseId,
        selectedOptionIndex: dto.selectedOptionIndex,
        isCorrect,
        score,
        dimensionScores,
        aiFeedback: isCorrect ? exercise.expertFeedback : (exercise.rubric.improvementHints[0] ?? exercise.expertFeedback),
        attemptDurationSeconds: dto.attemptDurationSeconds,
        realTimeCorrectionUsed: dto.realTimeCorrectionUsed ?? exercise.realTimeCorrectionEnabled,
        status: TrainingAttemptStatus.GRADED,
        completedAt,
      }),
    );

    return {
      id: saved.id,
      isCorrect,
      score,
      dimensionScores,
      feedback: saved.aiFeedback,
      improvementHints: isCorrect ? [] : exercise.rubric.improvementHints,
      status: saved.status,
      completedAt: completedAt.toISOString(),
    };
  }

  /**
   * 确定性评分 —— 治本: 移除原 mock 的「随机 0-20」。
   *
   * 规则 (可复盘, 对用户完全可解释):
   *   - 命中专业示范选项 → 90 分, 各维度 100
   *   - 未命中 → 45 分, 各维度 35
   * 同一份答案任意次提交结果恒等, 用户能据此判断自己的进步来自技术而非运气。
   */
  private grade(exercise: TrainingExercise, isCorrect: boolean): { score: number; dimensionScores: Record<string, number> } {
    const perDimension = isCorrect ? 100 : 35;
    const dimensionScores: Record<string, number> = {};
    for (const dim of exercise.rubric.dimensions) {
      dimensionScores[dim.name] = perDimension;
    }
    return { score: isCorrect ? 90 : 45, dimensionScores };
  }

  // ═══════════════ 映射 ═══════════════

  private toDto(e: TrainingExercise): TrainingExerciseDto {
    const meta = TRAINING_EXERCISE_MODE_META[e.mode];
    return {
      id: e.id,
      type: e.type,
      mode: e.mode,
      modeLabel: meta.label,
      modeSummary: meta.summary,
      difficulty: e.difficulty,
      scenarioContext: e.scenarioContext,
      options: e.options,
      durationMinutes: e.durationMinutes,
      personaName: e.personaName,
      personaBackground: e.personaBackground,
      realTimeCorrectionEnabled: e.realTimeCorrectionEnabled,
    };
  }
}
