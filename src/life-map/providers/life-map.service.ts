import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';

import { LIFE_STAGES, type LifeStage } from '../../shared/types/practice.types';
import type {
  CreateKeyEventDto,
  ForecastDimensionDto,
  ForecastInputDto,
  ForecastListDto,
  GenomeDimensionDto,
  GenomeDimensionListDto,
  GrowthReportDto,
  KeyEventDto,
  KeyEventListDto,
  LifeForecastDto,
  LifeMapEntryDto,
  LifeMapOverviewDto,
  LifeMapTimelineDto,
  LifeMapTimelineNode,
  LifeStageProgressDto,
  SaveGenomeDimensionDto,
  SaveStageProgressDto,
  StageProgressListDto,
  UpdateKeyEventDto,
} from '../dto/life-map.dto';
import { type GenomeDimensionKey, GenomeDimensionEntity, KeyEventEntity, LifeStageProgressEntity } from '../entities';

/**
 * 人生地图服务 — V3.0 §3 Tab3 完整业务化.
 *
 * V2.0 → V3.0 升级:
 *   - V2.0 全部 sample 占位, 跟前端 ProfileLifeMapPage 一致
 *   - V3.0 真后端: TypeORM + 3 张表 (life_stage_progress / key_events / genome_dimensions)
 *   - 提供阶段梳理 / 关键事件 CRUD / 基因盘点 / 推演 / 综合报告全量业务
 *
 * 命名规范:
 *   - 私有方法 `_xxx`: TypeORM 操作
 *   - 公开方法: 业务编排 + DTO 返回
 *   - 解锁逻辑: `_checkForecastUnlock()` 统一封装, 阶段全填 + 事件 >= 3 视为 unlocked
 *
 * 大厂原则:
 *   - 单 service 不跨 module (assessment / practice 是其他模块, 只读 API 调用)
 *   - 推演结果本地生成 (V3.0 §2.4.2 推演不依赖 AI, 基于心理基因模式 + 历史事件)
 *   - 综合报告: 聚合 5 维度 + 阶段进度, 生成可读 summary (LLM 调用预留, V3.0 用模板)
 */
@Injectable()
export class LifeMapService {
  constructor(
    @InjectRepository(LifeStageProgressEntity)
    private readonly stageRepo: Repository<LifeStageProgressEntity>,
    @InjectRepository(KeyEventEntity)
    private readonly eventRepo: Repository<KeyEventEntity>,
    @InjectRepository(GenomeDimensionEntity)
    private readonly dimensionRepo: Repository<GenomeDimensionEntity>,
  ) {}

  // ═════════════════════════════════════════════════════════════
  // 1. 入口页面 (overview / timeline)
  // ═════════════════════════════════════════════════════════════

  async getOverview(uid: string): Promise<LifeMapOverviewDto> {
    const stages = await this.loadAllStages(uid);
    const eventCount = await this.countActiveEvents(uid);
    const dimensionCount = await this.countActiveDimensions(uid);

    const stageDone = stages.filter((s) => s.completionPct != null).length;
    const totalStages = LIFE_STAGES.length;

    const entries: LifeMapEntryDto[] = [
      {
        emoji: '🧭',
        accent: 'iris',
        title: '人生阶段梳理',
        subtitle: '青春期 / 初显期 / 转型期 / 中期 任务完成度',
        tag: `已梳理 ${stageDone} / ${totalStages} 阶段`,
        progress: stageDone / totalStages,
        unlockStatus: 'unlocked',
      },
      {
        emoji: '📌',
        accent: 'coral',
        title: '关键事件记录',
        subtitle: '标记影响你成长的转折点 · 正向 / 负向 / 中性',
        tag: `已记录 ${eventCount} 个事件`,
        progress: Math.min(1, eventCount / 5),
        unlockStatus: 'unlocked',
      },
      {
        emoji: '🧬',
        accent: 'mint',
        title: '心理基因盘点',
        subtitle: '安全感 · 自尊 · 自主性 · 韧性 · 自我整合',
        tag: `已盘点 ${dimensionCount} / 5 维度`,
        progress: dimensionCount / 5,
        unlockStatus: 'unlocked',
      },
    ];

    const forecastUnlock = this.evaluateForecastUnlock(stageDone, eventCount);
    const reportUnlock = this.evaluateReportUnlock(stageDone, eventCount, dimensionCount);

    return {
      entries,
      reportUnlocked: reportUnlock === 'unlocked',
      forecastUnlocked: forecastUnlock === 'unlocked',
    };
  }

  async getTimeline(uid: string): Promise<LifeMapTimelineDto> {
    const stages = await this.loadAllStages(uid);
    // V3.0 治本: Map 显式泛型 <LifeStage, number>, 避免后续 key 推断成 string
    // (string key 会导致 stageByKey.get(node.stage) 在 strict 模式下报
    //  "string is not assignable to LifeStage" 类型错)
    const stageByKey = new Map<LifeStage, number>(stages.map((s) => [s.stage, s.completionPct ?? 0]));

    // V3.0 治本: seedNodes 显式声明类型, 让每个内联对象字面量按 LifeMapTimelineNode
    // 推断 (stage 自动收敛为 LifeStage union), 后续 .map 里的 node.stage 才是 LifeStage
    // 而非 string, stageByKey.get(node.stage) 才能通过类型检查。
    const seedNodes: LifeMapTimelineNode[] = [
      { stage: 'adolescence', ageRange: '12-18', filled: false, completionPct: 0 },
      {
        stage: 'emerging_adulthood',
        ageRange: '18-28',
        filled: false,
        completionPct: 0,
      },
      { stage: 'transition', ageRange: '28-35', filled: false, completionPct: 0 },
      { stage: 'midlife', ageRange: '35+', filled: false, completionPct: 0 },
    ];

    const nodes = seedNodes.map((node) => {
      const pct = stageByKey.get(node.stage) ?? 0;
      return { ...node, completionPct: pct, filled: pct > 0 };
    });

    return {
      nodes,
      filledCount: nodes.filter((n) => n.filled).length,
    };
  }

  // ═════════════════════════════════════════════════════════════
  // 2. 阶段梳理
  // ═════════════════════════════════════════════════════════════

  async listStageProgress(uid: string): Promise<StageProgressListDto> {
    const stages = await this.loadAllStages(uid);
    return {
      stages,
      allStagesFilled: stages.every((s) => s.completionPct != null),
    };
  }

  async saveStageProgress(uid: string, dto: SaveStageProgressDto): Promise<LifeStageProgressDto> {
    let entity = await this.stageRepo.findOne({
      where: { userId: uid, stage: dto.stage },
    });

    if (entity) {
      entity.completionPct = dto.completionPct;
      entity.stuckPoints = dto.stuckPoints ?? entity.stuckPoints ?? null;
      entity.gains = dto.gains ?? entity.gains ?? null;
    } else {
      entity = this.stageRepo.create({
        userId: uid,
        stage: dto.stage,
        completionPct: dto.completionPct,
        stuckPoints: dto.stuckPoints ?? null,
        gains: dto.gains ?? null,
      });
    }

    const saved = await this.stageRepo.save(entity);
    return this.stageToDto(saved);
  }

  // ═════════════════════════════════════════════════════════════
  // 3. 关键事件 CRUD
  // ═════════════════════════════════════════════════════════════

  async listKeyEvents(uid: string): Promise<KeyEventListDto> {
    const events = await this.eventRepo.find({
      where: { userId: uid, deletedAt: IsNull() },
      order: { age: 'ASC' },
    });
    return {
      events: events.map((e) => this.eventToDto(e)),
      total: events.length,
    };
  }

  async createKeyEvent(uid: string, dto: CreateKeyEventDto): Promise<KeyEventDto> {
    const entity = this.eventRepo.create({
      userId: uid,
      title: dto.title,
      age: dto.age,
      type: dto.type,
      description: dto.description ?? null,
      feelings: dto.feelings ?? null,
      influence: dto.influence ?? null,
      interpretation: dto.interpretation ?? null,
      stage: dto.stage ?? null,
    });
    const saved = await this.eventRepo.save(entity);
    return this.eventToDto(saved);
  }

  async updateKeyEvent(uid: string, eventId: string, dto: UpdateKeyEventDto): Promise<KeyEventDto> {
    const entity = await this.requireActiveEvent(uid, eventId);
    Object.assign(entity, {
      title: dto.title ?? entity.title,
      type: dto.type ?? entity.type,
      description: dto.description ?? entity.description,
      feelings: dto.feelings ?? entity.feelings,
      influence: dto.influence ?? entity.influence,
      interpretation: dto.interpretation ?? entity.interpretation,
      stage: dto.stage ?? entity.stage,
    });
    const saved = await this.eventRepo.save(entity);
    return this.eventToDto(saved);
  }

  async deleteKeyEvent(uid: string, eventId: string): Promise<void> {
    const entity = await this.requireActiveEvent(uid, eventId);
    entity.deletedAt = new Date();
    await this.eventRepo.save(entity);
  }

  // ═════════════════════════════════════════════════════════════
  // 4. 心理基因盘点 (5 维度)
  // ═════════════════════════════════════════════════════════════

  async listGenomeDimensions(uid: string): Promise<GenomeDimensionListDto> {
    const dims = await this.dimensionRepo.find({
      where: { userId: uid, deletedAt: IsNull() },
    });
    return {
      dimensions: dims.map((d) => this.dimToDto(d)),
      filledCount: dims.length,
      allFilled: dims.length >= 5,
    };
  }

  async saveGenomeDimension(uid: string, dto: SaveGenomeDimensionDto): Promise<GenomeDimensionDto> {
    let entity = await this.dimensionRepo.findOne({
      where: { userId: uid, key: dto.key },
    });

    const tier = this.calcTier(dto.score);

    if (entity) {
      entity.score = dto.score;
      entity.tier = tier;
      entity.source = dto.source ?? entity.source ?? null;
      entity.improvement = dto.improvement ?? entity.improvement ?? null;
    } else {
      entity = this.dimensionRepo.create({
        userId: uid,
        key: dto.key,
        score: dto.score,
        tier,
        source: dto.source ?? null,
        improvement: dto.improvement ?? null,
      });
    }

    const saved = await this.dimensionRepo.save(entity);
    return this.dimToDto(saved);
  }

  // ═════════════════════════════════════════════════════════════
  // 5. 人生剧本推演 (本地规则引擎, 无 AI 依赖)
  // ═════════════════════════════════════════════════════════════

  async listForecasts(uid: string): Promise<ForecastListDto> {
    // V3.0 推演结果存于 in-memory (sample), 真实业务化后续接 typeorm + LLM
    // 解锁逻辑从阶段梳理 + 关键事件数派生
    const stages = await this.loadAllStages(uid);
    const eventCount = await this.countActiveEvents(uid);
    const stageDone = stages.filter((s) => s.completionPct != null).length;

    const unlockStatus = this.evaluateForecastUnlock(stageDone, eventCount);
    let lockedReason: string | undefined;
    if (unlockStatus === 'locked') {
      lockedReason = '完成全量阶段梳理 + 记录 ≥3 个关键事件后解锁';
    } else if (unlockStatus === 'locking') {
      lockedReason = `再记录 ${Math.max(0, 3 - eventCount)} 个关键事件即可解锁`;
    }

    return {
      forecasts: [], // V3.0 占位: 推演结果暂存前端 + 后续接 typeorm
      total: 0,
      unlockStatus,
      lockedReason,
    };
  }

  /**
   * 推演本地规则引擎 — V3.0 §3.0 治本:
   *   - 不调 AI / LLM, 避免大厂 V3.0 §7.1 RAG 负担
   *   - 基于心理基因维度 + 关键事件 + 场景, 输出 3 大类 (风险/机会/准备)
   *   - 模板生成, 简单可控, 用户随时可保存多次对比
   */
  async runForecast(uid: string, input: ForecastInputDto): Promise<LifeForecastDto> {
    const dims = await this.dimensionRepo.find({
      where: { userId: uid, deletedAt: IsNull() },
    });
    const events = await this.eventRepo.find({
      where: { userId: uid, deletedAt: IsNull() },
    });

    const securityScore = dims.find((d) => d.key === 'security')?.score ?? 50;
    const selfEsteemScore = dims.find((d) => d.key === 'self_esteem')?.score ?? 50;
    const autonomyScore = dims.find((d) => d.key === 'autonomy')?.score ?? 50;

    const hasNegativeEvent = events.some((e) => e.type === 'negative');

    const risks = this.forecastRisks(input.scenario, {
      securityScore,
      selfEsteemScore,
      autonomyScore,
      hasNegativeEvent,
    });
    const opportunities = this.forecastOpportunities(input.scenario, {
      autonomyScore,
      selfEsteemScore,
    });
    const preparations = this.forecastPreparations(input.scenario, dims.length);

    return {
      id: `forecast_${Date.now()}`,
      scenario: input.scenario,
      description: input.description,
      risks,
      opportunities,
      preparations,
      createdAt: new Date().toISOString(),
    };
  }

  // ═════════════════════════════════════════════════════════════
  // 6. 成长轨迹综合报告
  // ═════════════════════════════════════════════════════════════

  async getGrowthReport(uid: string): Promise<GrowthReportDto> {
    const stages = await this.loadAllStages(uid);
    const dims = await this.dimensionRepo.find({
      where: { userId: uid, deletedAt: IsNull() },
    });
    const eventCount = await this.countActiveEvents(uid);

    const stageDone = stages.filter((s) => s.completionPct != null).length;
    const reportUnlock = this.evaluateReportUnlock(stageDone, eventCount, dims.length);

    if (reportUnlock !== 'unlocked') {
      return {
        id: 'pending',
        stageCompletionCurve: [],
        genomeDimensions: [],
        coreStuckPoints: [],
        stageActionPlan: [],
        recommendedTools: [],
        summary: '',
        generatedAt: new Date().toISOString(),
        canGenerate: false,
        blockedReason: reportUnlock === 'locked' ? '请先完成阶段梳理 + 关键事件记录 + 心理基因盘点' : '再补全 1-2 项基础数据即可生成报告',
      };
    }

    const stageCompletionCurve = stages.map((s) => s.completionPct ?? 0);
    const coreStuckPoints = stages
      .filter((s) => s.stuckPoints && s.stuckPoints.trim().length > 0)
      .map((s) => `${s.stage}: ${s.stuckPoints!.slice(0, 30)}`);

    const stageActionPlan = stages.map((s) => {
      if (s.completionPct == null || s.completionPct < 50) {
        return `${s.stage}: 优先补全任务完成度, 建议回到该阶段做 1 次自我梳理`;
      }
      return `${s.stage}: 完成度良好, 建议巩固收获并向下一阶段延伸`;
    });

    const recommendedTools = this.recommendTools(dims);

    const summary = this.buildReportSummary(stages, dims, eventCount);

    return {
      id: `report_${Date.now()}`,
      stageCompletionCurve,
      genomeDimensions: dims.map((d) => this.dimToDto(d)),
      coreStuckPoints,
      stageActionPlan,
      recommendedTools,
      summary,
      generatedAt: new Date().toISOString(),
      canGenerate: true,
    };
  }

  // ═════════════════════════════════════════════════════════════
  // 私有 helper
  // ═════════════════════════════════════════════════════════════

  private async loadAllStages(uid: string): Promise<LifeStageProgressDto[]> {
    const rows = await this.stageRepo.find({
      where: { userId: uid, deletedAt: IsNull() },
    });
    // V3.0 治本: 返回全 4 阶段, 未填写的为 null completionPct
    const byStage = new Map(rows.map((r) => [r.stage, r]));
    return LIFE_STAGES.map((stageKey) => {
      const r = byStage.get(stageKey);
      if (r) return this.stageToDto(r);
      return {
        stage: stageKey,
        completionPct: null,
        keyEventCount: 0,
        stuckPoints: undefined,
        gains: undefined,
        updatedAt: new Date(0).toISOString(),
      };
    });
  }

  private async countActiveEvents(uid: string): Promise<number> {
    return this.eventRepo.count({
      where: { userId: uid, deletedAt: IsNull() },
    });
  }

  private async countActiveDimensions(uid: string): Promise<number> {
    return this.dimensionRepo.count({
      where: { userId: uid, deletedAt: IsNull() },
    });
  }

  private async requireActiveEvent(uid: string, eventId: string): Promise<KeyEventEntity> {
    const entity = await this.eventRepo.findOne({
      where: { id: eventId, userId: uid, deletedAt: IsNull() },
    });
    if (!entity) {
      throw new NotFoundException(`Key event ${eventId} not found`);
    }
    return entity;
  }

  evaluateForecastUnlock(stageDone: number, eventCount: number): 'unlocked' | 'locking' | 'locked' {
    if (stageDone >= 4 && eventCount >= 3) return 'unlocked';
    if (stageDone >= 2 || eventCount >= 1) return 'locking';
    return 'locked';
  }

  evaluateReportUnlock(stageDone: number, eventCount: number, dimCount: number): 'unlocked' | 'locking' | 'locked' {
    if (stageDone >= 4 && eventCount >= 3 && dimCount >= 5) return 'unlocked';
    if (stageDone >= 2 && eventCount >= 1 && dimCount >= 2) return 'locking';
    return 'locked';
  }

  calcTier(score: number): 'gentle' | 'balanced' | 'stable' | 'strong' {
    if (score < 25) return 'gentle';
    if (score < 55) return 'balanced';
    if (score < 80) return 'stable';
    return 'strong';
  }

  stageToDto(e: LifeStageProgressEntity): LifeStageProgressDto {
    return {
      stage: e.stage,
      completionPct: e.completionPct,
      keyEventCount: 0, // V3.0 简化为 0 (前端独立查询)
      stuckPoints: e.stuckPoints ?? undefined,
      gains: e.gains ?? undefined,
      updatedAt: e.updatedAt.toISOString(),
    };
  }

  eventToDto(e: KeyEventEntity): KeyEventDto {
    return {
      id: e.id,
      title: e.title,
      age: e.age,
      type: e.type,
      description: e.description ?? undefined,
      feelings: e.feelings ?? undefined,
      influence: e.influence ?? undefined,
      interpretation: e.interpretation ?? undefined,
      stage: e.stage ?? undefined,
      createdAt: e.createdAt.toISOString(),
      updatedAt: e.updatedAt.toISOString(),
    };
  }

  dimToDto(d: GenomeDimensionEntity): GenomeDimensionDto {
    return {
      key: d.key,
      label: GENOME_DIMENSION_LABELS[d.key],
      score: d.score,
      tier: d.tier,
      source: d.source ?? undefined,
      improvement: d.improvement ?? undefined,
      updatedAt: d.updatedAt.toISOString(),
    };
  }

  forecastRisks(
    scenario: string,
    ctx: { securityScore: number; selfEsteemScore: number; autonomyScore: number; hasNegativeEvent: boolean },
  ): ForecastDimensionDto[] {
    const risks: ForecastDimensionDto[] = [];
    if (ctx.securityScore < 50) {
      risks.push({
        dimension: '安全感冲击',
        level: ctx.securityScore < 30 ? 'high' : 'medium',
        description: '初始阶段熟悉感下降,预计 1-3 个月逐步重建',
      });
    }
    if (ctx.selfEsteemScore < 50 && (scenario === 'job_change' || scenario === 'startup')) {
      risks.push({
        dimension: '自尊波动风险',
        level: 'medium',
        description: '新环境初期自我评价可能出现波动',
      });
    }
    if (ctx.hasNegativeEvent) {
      risks.push({
        dimension: '过往经历激活',
        level: 'low',
        description: '过往类似情境可能被激活, 注意自我关怀',
      });
    }
    if (risks.length === 0) {
      risks.push({
        dimension: '整体稳定性',
        level: 'low',
        description: '当前心理基础可承受此选择, 注意节奏即可',
      });
    }
    return risks;
  }

  /**
   * @paramscenario 场景标识 (V3.0 保留入参, 当前实现未差异化使用).
   *                  下划线前缀表达 "有意忽略但保留接口语义", 满足 TS strict noUnusedParameters。
   *                  后续 V3.1 可基于 scenario 输出差异化机会维度 (如 job_change 强化能力拓展)。
   */
  forecastOpportunities(_scenario: string, ctx: { autonomyScore: number; selfEsteemScore: number }): ForecastDimensionDto[] {
    const opps: ForecastDimensionDto[] = [
      {
        dimension: '自主性提升',
        level: 'medium',
        description: '重大选择会强化你的主动决策肌肉',
      },
    ];
    if (ctx.autonomyScore >= 60) {
      opps.push({
        dimension: '能力边界拓展',
        level: 'high',
        description: '你的自主性基础好, 这是拓展能力的好时机',
      });
    }
    if (ctx.selfEsteemScore >= 60) {
      opps.push({
        dimension: '自我整合机会',
        level: 'medium',
        description: '挑战成功后自尊会进一步稳固',
      });
    }
    return opps;
  }

  forecastPreparations(scenario: string, dimCount: number): string[] {
    const base = ['做 1 次自我关怀日记, 写下你做这个选择的初衷', '列出 3 个最信任的支持者, 提前告知你的计划'];
    if (dimCount < 5) {
      base.push('建议先完成心理基因盘点, 推演会更精准');
    }
    if (scenario === 'job_change' || scenario === 'startup') {
      base.push('提前调研新环境的日常节奏, 减少未知的消耗');
    }
    return base;
  }

  recommendTools(dims: GenomeDimensionEntity[]): string[] {
    const tools: string[] = [];
    if (dims.some((d) => d.key === 'security' && d.score < 50)) {
      tools.push('安全岛想象练习 (emergency.safe-island)');
    }
    if (dims.some((d) => d.key === 'self_esteem' && d.score < 50)) {
      tools.push('自我接纳冥想 (mindfulness.self-compassion)');
    }
    if (dims.some((d) => d.key === 'autonomy' && d.score < 50)) {
      tools.push('WOOP 思维训练器 (development.woop)');
    }
    return tools;
  }

  buildReportSummary(stages: LifeStageProgressDto[], dims: GenomeDimensionEntity[], eventCount: number): string {
    const filledStages = stages.filter((s) => s.completionPct != null).length;
    const avgScore = dims.length > 0 ? Math.round(dims.reduce((sum, d) => sum + d.score, 0) / dims.length) : 0;
    return `你已完成 ${filledStages} / ${stages.length} 个人生阶段梳理, 记录 ${eventCount} 个关键事件, 心理基因 5 维度平均得分 ${avgScore}。建议从得分较低维度开始针对性训练。`;
  }
}

/**
 * 5 维度显示名 — V3.0 设计文档 §3 心理基因盘点页:
 *   安全感 / 自尊水平 / 自主性 / 心理韧性 / 自我整合
 */
const GENOME_DIMENSION_LABELS: Record<GenomeDimensionKey, string> = {
  security: '安全感',
  self_esteem: '自尊水平',
  autonomy: '自主性与能动性',
  resilience: '心理韧性',
  self_integration: '自我整合',
};
