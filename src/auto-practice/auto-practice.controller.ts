// V2026-11-08 治本 (Phase2.5 WP-D · 自动对练 HTTP 接口):
//   职责: admin 面板的写操作入口 —— 启动单场实时对练 / 批量入队 / 查场次 / CRUD 咨询师模式.
//
//   端点:
//     POST   /admin/api/auto-practice/sessions         —— 跑一场实时对练 (同步等它跑完)
//     POST   /admin/api/auto-practice/batch            —— 批量入队 (立即返回 batchId)
//     GET    /admin/api/auto-practice/sessions         —— 列场次 (按 batchId/status 筛)
//     GET    /admin/api/auto-practice/sessions/:id    —— 查单场
//     GET    /admin/api/auto-practice/batches/:id    —— 批量进度汇总
//     GET    /admin/api/auto-practice/modes           —— 列咨询师模式
//     POST   /admin/api/auto-practice/modes           —— 新建模式
//     PUT    /admin/api/auto-practice/modes/:id       —— 改模式
//     DELETE /admin/api/auto-practice/modes/:id       —— 删模式
//
//   鉴权: 与 debug-session.controller 同款 —— AdminRoleGuard (class 级).

import { Body, Controller, Delete, Get, Param, Post, Put, Query, UseGuards, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { nanoid } from 'nanoid';
import type { Repository } from 'typeorm';

import { CounselorMode } from './entities/counselor-mode.entity.js';
import { PracticeBatch } from './entities/practice-batch.entity.js';
import { PracticeSession } from './entities/practice-session.entity.js';
import {
  INTAKE_ACCEPTANCE_VERSION,
  INTAKE_ACCEPTANCE_VERSION_HISTORY,
  INTAKE_EXPECTATIONS,
  INTAKE_TIERS,
} from './metrics/acceptance-thresholds.js';
import { assertBatchMetricsV1, BATCH_METRICS_SCHEMA_VERSION } from './metrics/batch-metrics.schema.js';
import { METRIC_DICTIONARY, METRIC_DICTIONARY_VERSION } from './metrics/metric-dictionary.js';
import { evaluateRegression } from './metrics/regression-evaluator.js';
import { BATCH_INVALID_WARNING, PracticeBatchHealthService } from './practice-batch-health.service.js';
import { PracticeQueueService } from './practice-queue.service.js';
import { PracticeRunnerService } from './practice-runner.service.js';
import { AdminRoleGuard } from '../admin-debug/guards/admin-role.guard.js';

/** 启动单场对练的入参. */
interface StartSessionBody {
  /** 来访者角色 slug. */
  readonly characterSlug?: string;
  /** 咨询师模式 id. */
  readonly counselorModeId?: string;
  /** 最大轮数 (缺省 15). */
  readonly maxTurns?: number;
}

/** 批量入队的入参. */
interface BatchBody {
  /** 来访者角色 slug 列表 (笛卡尔积: 每个角色 × 每个模式). */
  readonly characterSlugs?: readonly string[];
  /** 咨询师模式 id 列表. */
  readonly counselorModeIds?: readonly string[];
  /** 最大轮数. */
  readonly maxTurns?: number;
  /** 每个组合重复几场 (默认 1). */
  readonly repeats?: number;
}

/** 模式 CRUD 的入参. */
interface UpsertModeBody {
  readonly name?: string;
  readonly systemPrompt?: string;
  readonly description?: string;
  readonly enabled?: boolean;
  readonly sortOrder?: number;
}

@Controller('admin/api/auto-practice')
@UseGuards(AdminRoleGuard)
export class AutoPracticeController {
  private readonly logger = new Logger('AutoPracticeController');

  constructor(
    private readonly runner: PracticeRunnerService,
    private readonly queue: PracticeQueueService,
    private readonly batchHealth: PracticeBatchHealthService,
    @InjectRepository(PracticeSession) private readonly sessionRepo: Repository<PracticeSession>,
    @InjectRepository(CounselorMode) private readonly modeRepo: Repository<CounselorMode>,
    @InjectRepository(PracticeBatch) private readonly batchRepo: Repository<PracticeBatch>,
  ) {}

  /**
   * 启动一场实时对练 (立即返回 practiceSessionId, 后台跑循环).
   *
   * 前端连上 WS /auto-practice 并 subscribe 这个 practiceSessionId 后,
   * 会实时收到每轮对话 (ap:turn / ap:session_end).
   */
  @Post('sessions')
  async startSession(@Body() body: StartSessionBody) {
    const characterSlug = (body?.characterSlug ?? '').trim();
    const counselorModeId = (body?.counselorModeId ?? '').trim();
    if (!characterSlug || !counselorModeId) {
      return { error: 'characterSlug 与 counselorModeId 必填' };
    }
    const mode = await this.modeRepo.findOne({ where: { id: counselorModeId, enabled: 1 } });
    if (!mode) {
      return { error: `咨询师模式不存在或未启用: ${counselorModeId}` };
    }
    // 预生成 ID, 立即返回给前端连 WS; 循环在后台跑.
    const practiceSessionId = nanoid();
    // V2026-11-09 P0-1 修复: fire-and-forget 必须有 .catch(), 否则 runner 内部任何
    // 未预期的 throw 都会变成 unhandled rejection 打崩整个 Node 进程.
    // runner 自己已经把失败落库 (status=failed), 这里只兜底记日志.
    void this.runner
      .run({
        characterSlug,
        counselorMode: mode,
        maxTurns: body?.maxTurns,
        batchId: null,
        practiceSessionId,
      })
      .then(async () => {
        // V2026-11-10 (WP-H 新增 12): 单场跑完也写一份逐字稿索引 ——
        //   "只跑了一场就没法核对"是最常见的调试场景, 反而最不能没有索引.
        //   索引写失败只 warn: 它是便利设施, 不该把对练收尾搞挂.
        try {
          await this.batchHealth.refreshSingleSession(practiceSessionId);
        } catch (error) {
          this.logger.warn(
            `[auto_practice] 单场索引写入失败 session=${practiceSessionId}: ${error instanceof Error ? error.message : 'unknown'}`,
          );
        }
      })
      .catch((error: unknown) => {
        this.logger.error(
          `[auto_practice] 后台对练未捕获异常 session=${practiceSessionId}: ${error instanceof Error ? error.message : 'unknown'}`,
        );
      });
    return { practiceSessionId, characterSlug, counselorModeId };
  }

  /**
   * 批量入队 (立即返回 batchId, 不等跑完).
   */
  @Post('batch')
  async enqueueBatch(@Body() body: BatchBody) {
    const characterSlugs = (body?.characterSlugs ?? []).map((s) => String(s).trim()).filter((s) => s.length > 0);
    const counselorModeIds = (body?.counselorModeIds ?? []).map((s) => String(s).trim()).filter((s) => s.length > 0);
    const repeats = Math.max(1, body?.repeats ?? 1);
    if (characterSlugs.length === 0 || counselorModeIds.length === 0) {
      return { error: 'characterSlugs 与 counselorModeIds 不能为空' };
    }
    const batchId = nanoid();
    let enqueued = 0;
    for (const slug of characterSlugs) {
      for (const modeId of counselorModeIds) {
        for (let r = 0; r < repeats; r += 1) {
          await this.queue.enqueue({
            characterSlug: slug,
            counselorModeId: modeId,
            maxTurns: body?.maxTurns ?? 15,
            batchId,
          });
          enqueued += 1;
        }
      }
    }
    return { batchId, enqueued };
  }

  /**
   * 列场次 (按 batchId / status 筛, 分页).
   *
   * ⚠️ **WP-J P1b: 列表默认**不带** 6 个危机练习窗指标** (避免列表膨胀);
   *   要看就显式加 `?include=crisis` —— "显式要的东西才给", 不默认塞一坨指标列.
   *   (单场详情 `GET /sessions/:id` 则**始终**带 —— 详情就是给复盘用的.)
   */
  @Get('sessions')
  async listSessions(
    @Query('batchId') batchId?: string,
    @Query('status') status?: string,
    @Query('page') pageRaw?: string,
    @Query('pageSize') pageSizeRaw?: string,
    @Query('include') include?: string,
  ) {
    const where: Record<string, unknown> = {};
    if (batchId) where['batchId'] = batchId;
    if (status) where['status'] = status;

    const page = Math.max(1, Number(pageRaw ?? '1') || 1);
    const pageSize = Math.min(100, Math.max(1, Number(pageSizeRaw ?? '20') || 20));
    const skip = (page - 1) * pageSize;

    const [items, total] = await this.sessionRepo.findAndCount({
      where,
      order: { createdAt: 'DESC' },
      take: pageSize,
      skip,
    });

    // WP-J P1b: include=crisis 才带危机指标; 否则剥掉这 6 列.
    const includeCrisis = (include ?? '').trim().toLowerCase() === 'crisis';
    return { items: items.map((row) => toListItem(row, includeCrisis)), total, page, pageSize };
  }

  /**
   * 查单场.
   *
   * ⚠️ **WP-J P1b: 详情**始终**带 6 个危机练习窗指标** (crisis_practiced /
   *   crisis_first_turn / crisis_post_turns / crisis_peak_level / crisis_category /
   *   crisis_escalated) —— 详情就是给"复盘这一场"用的, 危机指标是复盘最先要看的东西.
   *   (返的是实体行, 新增的 6 列自动就在里面; 列表才需要显式剥.)
   */
  @Get('sessions/:id')
  async getSession(@Param('id') id: string) {
    const row = await this.sessionRepo.findOne({ where: { id } });
    return row ?? { error: '场次不存在' };
  }

  /**
   * 批量进度汇总 (V2026-11-10 扩: 改动 6 批次级指标 + 改动 9 有效性门禁).
   *
   * 现在返回的不只是"跑了几场", 还有:
   *   · metrics —— 批次级渲染降级率指标 (改动 6: 三项之和 + 兜底率);
   *   · batchHealth —— 有效性门禁判定 (改动 9);
   *   · warning —— 批次不合格时**必须**带上, 否则看的人会拿不可用的数据下结论.
   *
   * ⚠️ 判定是**读时算**的: 每次调用都按当前库里的场次重算 —— 批次跑到一半也能立刻
   *   看出"这批已经废了", 不必等它跑完.
   */
  @Get('batches/:id')
  async batchProgress(@Param('id') batchId: string) {
    const { metrics, health, sessions } = await this.batchHealth.refreshBatch(batchId);
    const byStatus = new Map<string, number>();
    for (const row of sessions) {
      byStatus.set(row.status, (byStatus.get(row.status) ?? 0) + 1);
    }
    return {
      batchId,
      total: sessions.length,
      byStatus: Object.fromEntries(byStatus),
      // WP-B: 版本口径 —— 批次对比时先看这两个数:
      //   engineVersion  = 哪份代码跑的; promptVersion = **prompt 文案**是不是同一版.
      //   取批次内第一个非空值 (同一批理论上同版; 场次级才是逐场真值).
      engineVersion: sessions.find((row) => row.engineVersion)?.engineVersion ?? null,
      promptVersion: sessions.find((row) => row.promptVersion)?.promptVersion ?? null,
      metrics: {
        totalTurns: metrics.totalTurns,
        renderFallbackTurns: metrics.renderFallbackTurns,
        llmCallTurns: metrics.llmCallTurns,
        renderFallbackRatio: metrics.renderFallbackRatio,
        renderFallbackRatioWeighted: metrics.renderFallbackRatioWeighted,
        llmCallRatio: metrics.llmCallRatio,
        degradedTurns: metrics.degradedTurns,
        counselorDegradedTurns: metrics.counselorDegradedTurns,
        visitorDegradedTurns: metrics.visitorDegradedTurns,
        counterConsistent: metrics.counterConsistent,
      },
      batchHealth: health,
      ...(health.valid ? {} : { warning: BATCH_INVALID_WARNING }),
      sessions: sessions.map((r) => ({
        id: r.id,
        characterSlug: r.characterSlug,
        counselorModeId: r.counselorModeId,
        status: r.status,
        turnCount: r.turnCount,
        exitReason: r.exitReason,
        renderFallbackTurns: r.renderFallbackTurns,
        llmCallTurns: r.llmCallTurns,
        renderFallbackRatio: r.renderFallbackRatio,
        // WP-B: 逐场带上两个版本号 (逐场才是真值).
        engineVersion: r.engineVersion,
        promptVersion: r.promptVersion,
      })),
    };
  }

  /** 把批次行投影成轻量列表行 (不含 JSON 大字段; DECIMAL 转 Number). */
  private static toLightRow(batch: PracticeBatch) {
    const num = (value: number | null): number | null => (value === null ? null : Number(value));
    return {
      batchId: batch.batchId,
      totalSessions: batch.totalSessions,
      totalTurns: batch.totalTurns,
      valid: batch.valid,
      createdAt: batch.createdAt,
      configFingerprint: batch.configFingerprint,
      explorationRate: num(batch.explorationRate),
      depthDeltaAvg: num(batch.depthDeltaAvg),
      safetyDeltaAvg: num(batch.safetyDeltaAvg),
      positiveEventRate: num(batch.positiveEventRate),
      note: batch.note,
    };
  }

  /** 从批次表读并校验完整快照; 读不到返回 null (legacy). */
  private async loadSnapshot(batchId: string): Promise<import('./metrics/batch-metrics.schema.js').BatchMetricsV1 | null> {
    const batch = await this.batchRepo.findOne({ where: { batchId } });
    if (!batch || !batch.metricsJson) return null;
    try {
      const parsed: unknown = JSON.parse(batch.metricsJson);
      assertBatchMetricsV1(parsed, batchId);
      return parsed;
    } catch {
      return null;
    }
  }

  /**
   * 字典 + 判据只读投影 (纯常量组装, 便于单测; 不含判定逻辑).
   *
   * intake-v2 起下发**分档结构**: `expectations` 仍是基线档 (= intake-v1 历史口径,
   * 保持与前端旧镜像同源), 新增 `tiers` 逐档给出阈值 + 适用模式 + 是否候选档.
   */
  static buildMetricCatalog() {
    return {
      dictionaryVersion: METRIC_DICTIONARY_VERSION,
      acceptanceVersion: INTAKE_ACCEPTANCE_VERSION,
      acceptanceVersionHistory: INTAKE_ACCEPTANCE_VERSION_HISTORY,
      metrics: METRIC_DICTIONARY,
      expectations: INTAKE_EXPECTATIONS,
      tiers: INTAKE_TIERS.map((tier) => ({
        id: tier.id,
        label: tier.label,
        counselorModeIds: tier.counselorModeIds,
        provisional: tier.provisional,
        note: tier.note,
        expectations: tier.expectations,
      })),
    };
  }

  /**
   * 指标字典 + intake 验收判据只读投影 (前端说明浮层 / 字典卡的真相源).
   * 纯常量下发, 不含判定逻辑; 前端只展示口径与区间, 不复算 pass/fail.
   */
  @Get('metrics/catalog')
  listMetricCatalog() {
    return {
      data: AutoPracticeController.buildMetricCatalog(),
      meta: {
        generatedAt: new Date().toISOString(),
        metricCount: METRIC_DICTIONARY.length,
        expectationCount: INTAKE_EXPECTATIONS.length,
        tierCount: INTAKE_TIERS.length,
      },
      warnings: [],
    };
  }

  /**
   * 批次列表 (分页 / 排序 / 过滤); 返回轻量行, 不带 JSON 大字段.
   */
  @Get('batches')
  async listBatches(
    @Query('page') pageRaw?: string,
    @Query('pageSize') pageSizeRaw?: string,
    @Query('sort') sortRaw?: string,
    @Query('order') orderRaw?: string,
    @Query('valid') valid?: string,
    @Query('since') since?: string,
    @Query('fingerprint') fingerprint?: string,
  ) {
    const page = Math.max(1, Number(pageRaw) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(pageSizeRaw) || 20));
    const sortable = new Set(['createdAt', 'explorationRate', 'depthDeltaAvg', 'safetyDeltaAvg', 'positiveEventRate', 'totalSessions']);
    const sort = sortRaw && sortable.has(sortRaw) ? sortRaw : 'createdAt';
    const direction = orderRaw === 'asc' ? 'ASC' : 'DESC';

    const qb = this.batchRepo.createQueryBuilder('b');
    if (valid === '1' || valid === '0') qb.andWhere('b.valid = :valid', { valid: Number(valid) });
    if (since) qb.andWhere('b.createdAt >= :since', { since: new Date(`${since}T00:00:00`) });
    if (fingerprint) qb.andWhere('b.configFingerprint = :fp', { fp: fingerprint });
    qb.orderBy(`b.${sort}`, direction)
      .skip((page - 1) * pageSize)
      .take(pageSize);

    const [rows, total] = await qb.getManyAndCount();
    return {
      data: rows.map((row) => AutoPracticeController.toLightRow(row)),
      meta: { generatedAt: new Date().toISOString(), schemaVersion: BATCH_METRICS_SCHEMA_VERSION, total, page, pageSize },
      warnings: [],
    };
  }

  /**
   * 单批完整快照; legacy 批次 (metrics_json NULL) 返回 metrics=null + 告警.
   */
  @Get('batches/:id/metrics')
  async batchMetricsEndpoint(@Param('id') batchId: string) {
    const generatedAt = new Date().toISOString();
    const snapshot = await this.loadSnapshot(batchId);
    if (!snapshot) {
      return {
        data: { batchId, metrics: null, legacy: true },
        meta: { generatedAt, schemaVersion: BATCH_METRICS_SCHEMA_VERSION },
        warnings: ['METRICS_NOT_COLLECTED'],
      };
    }
    const batch = await this.batchRepo.findOne({ where: { batchId } });
    return {
      data: { ...snapshot, legacy: false },
      meta: { generatedAt, schemaVersion: BATCH_METRICS_SCHEMA_VERSION },
      warnings: batch && batch.valid === 0 ? [BATCH_INVALID_WARNING] : [],
    };
  }

  /**
   * 批次对比: 一个基线 × 最多 10 个候选, 返回四态 / 差异段 / 逐指标项.
   */
  @Get('batches/compare')
  async compareBatches(@Query('base') baseId: string, @Query('candidates') candidatesRaw?: string) {
    const warnings: string[] = [];
    const candidateIds = (candidatesRaw ?? '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean)
      .slice(0, 10);

    const base = await this.loadSnapshot(baseId ?? '');
    if (!base) warnings.push(`BASE_METRICS_NOT_COLLECTED:${baseId}`);

    const data = [];
    for (const cid of candidateIds) {
      const candidate = await this.loadSnapshot(cid);
      if (!base || !candidate) {
        data.push({ batchId: cid, verdict: 'incomparable', reasons: ['METRICS_NOT_COLLECTED'], changedSegments: [], items: [] });
        continue;
      }
      const report = evaluateRegression({ base, candidate });
      data.push({
        batchId: cid,
        verdict: report.verdict,
        reasons: report.reasons,
        changedSegments: report.changedSegments,
        items: report.items,
      });
    }

    return {
      data,
      meta: { generatedAt: new Date().toISOString(), schemaVersion: BATCH_METRICS_SCHEMA_VERSION, total: data.length },
      warnings,
    };
  }

  /** 列咨询师模式. */
  @Get('modes')
  async listModes() {
    return this.modeRepo.find({ order: { sortOrder: 'ASC', createdAt: 'ASC' } });
  }

  /** 新建咨询师模式. */
  @Post('modes')
  async createMode(@Body() body: UpsertModeBody) {
    const id = (body.name ?? '').trim().toLowerCase().replaceAll(/\s+/g, '-');
    if (!id) return { error: 'name 必填' };
    const row = this.modeRepo.create({
      id,
      name: body.name!,
      systemPrompt: body.systemPrompt ?? '',
      description: body.description ?? '',
      enabled: body.enabled === false ? 0 : 1,
      sortOrder: body.sortOrder ?? 0,
    });
    return this.modeRepo.save(row);
  }

  /** 改咨询师模式. */
  @Put('modes/:id')
  async updateMode(@Param('id') id: string, @Body() body: UpsertModeBody) {
    const patch: Record<string, unknown> = {};
    if (body.name !== undefined) patch['name'] = body.name;
    if (body.systemPrompt !== undefined) patch['systemPrompt'] = body.systemPrompt;
    if (body.description !== undefined) patch['description'] = body.description;
    if (body.enabled !== undefined) patch['enabled'] = body.enabled ? 1 : 0;
    if (body.sortOrder !== undefined) patch['sortOrder'] = body.sortOrder;
    await this.modeRepo.update(id, patch);
    return this.modeRepo.findOne({ where: { id } });
  }

  /** 删咨询师模式. */
  @Delete('modes/:id')
  async deleteMode(@Param('id') id: string) {
    await this.modeRepo.delete(id);
    return { deleted: true };
  }
}

/**
 * 危机练习窗指标的 6 个列名 (列表默认要剥掉的那些).
 */
const CRISIS_METRIC_KEYS: readonly string[] = [
  'crisisPracticed',
  'crisisFirstTurn',
  'crisisPostTurns',
  'crisisPeakLevel',
  'crisisCategory',
  'crisisEscalated',
];

/**
 * 场次列表行 (按需剥掉危机指标列).
 *
 * ⚠️ **只剥这 6 列**: `crisis_ended` (旧列) 一直在列表里 —— 前端
 *   `AutoPractice.vue` 用 `crisisEnded === 1` 判"这场因危机掉线", 剥了它前端就瞎了.
 *
 * @param row 场次行
 * @param includeCrisis 是否带危机指标
 * @returns 列表行
 */
function toListItem(row: PracticeSession, includeCrisis: boolean): Record<string, unknown> {
  const item = { ...row } as Record<string, unknown>;
  if (!includeCrisis) {
    for (const key of CRISIS_METRIC_KEYS) delete item[key];
  }
  return item;
}
