// V2026-11-10 治本 (WP-J P2 · 专业级标注工具 · admin 服务层):
//   职责: 端点的业务编排 —— 列表 / 详情 / 保存 / 双盲揭示 / 一致性报告 / 批次清单.
//   边界: 不直接返实体 (走视图对象); 逐字稿**只读** (冻结副本优先, 再活 store).
//
//   ⚠️ **逐字稿复用既有 store, 不自己扫目录** (任务单硬要求):
//     `DebugSessionStore.get(id)` 是仓库唯一的调试会话读路径 —— 它已经处理了
//     会话 id 的白名单校验与坏文件跳过. 自己 `readdir` 等于造第二个真相源.
//
//   ⚠️ **双盲纪律 (reveal)**:
//     自动判定结果**只在本场人工标签已保存后**返回 —— 否则标注员先看自动答案
//     再点标签, 这套校准就白做了.
//
//   ⚠️ **台词不进日志**: 本文件只打 id / 计数 / 错误名, 一律不打台词正文
//     (隐私红线 AGENTS.md §5.4).
//
// V2026-11-11 治本 (WP-N · 标注台批次化):
//   两条读路径并存, **口径互不串**:
//     · 不传 batchId → 全局口径 (已落库行 + 场次表派生未标注场次, done/total 全局);
//     · 传 batchId   → 批次口径 (按批派生, sessions LEFT JOIN annotation, 未建行 id=null).
//   ⚠️ **GET 一律纯读**: 读的时候建行 = 并发 list 造重复行 + 审计找不到"这条是哪来的".
//     写副作用只发生在 PUT.
//
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
// node:path 没有 default export —— unicorn/import-style 对 node: 内置模块误报, 忽略.
//   (仓库既有约定: 见 debug-session-store.ts / prompt-fingerprint.ts 同款豁免)
// eslint-disable-next-line unicorn/import-style
import { join } from 'node:path';
import type { Repository } from 'typeorm';

import type { QualityAnnotationSaveDto } from './dto/quality-annotation.dto.js';
import { computeAutoMetrics, toAutoTraces, type AutoMetrics } from './quality-annotation-auto.js';
import {
  distinctVersions,
  evaluateComparability,
  formatBadTurns,
  isAnnotatableSession,
  parseBadTurns,
  type BatchSessionFact,
} from './quality-annotation-batch.js';
import { QualityAnnotationBatchService } from './quality-annotation-batch.service.js';
import { computeConsistency, type ConsistencyInput } from './quality-annotation-consistency.js';
import {
  ANNOTATION_STATUS,
  ATTACHMENT_STYLE_UNKNOWN,
  FREEZE_FAILED_CODE,
  INVALID_BATCHES_HIDDEN_CODE,
  SESSION_AMBIGUOUS_CODE,
  TRANSCRIPT_MISSING_CODE,
  TRANSCRIPT_SOURCE,
  TURN_NOTE_FORBIDDEN_TOKENS,
  isAnnotationLabel,
  type AnnotationStatus,
  type TranscriptSource,
} from './quality-annotation.constants.js';
import { QualityAnnotationEntity } from './quality-annotation.entity.js';
import { parseAnchorCsv, seedQualityAnnotations } from './quality-annotation.seed.js';
import type {
  AnnotationBatchListResponse,
  AnnotationBatchView,
  AnnotationConsistency,
  AnnotationDetail,
  AnnotationListResponse,
  AnnotationMessageView,
  AnnotationReveal,
  AnnotationRowView,
} from './quality-annotation.view.js';
import type { TranscriptRecord } from './quality-transcript-freeze.js';
import { BizCode } from '../common/exceptions/biz-code.enum.js';
import { BizException } from '../common/exceptions/biz.exception.js';

/**
 * 逐字稿缺失时的自动判定空口径 (与改造前一致: 危机 0 档, 其余 null).
 */
const EMPTY_AUTO: AutoMetrics = { explorationTurn: null, dominantLabel: null, crisisLevel: 0 };

/**
 * 一个 ref 的解析结果.
 */
interface ResolvedRef {
  /** 已落库的标注行 (NULL = 还没落行). */
  readonly row: QualityAnnotationEntity | null;
  /** 对练场次事实 (NULL = 场次表里查不到). */
  readonly fact: BatchSessionFact | null;
  /** 逐字稿会话 id. */
  readonly debugSessionId: string;
  /** 归属批次 id. */
  readonly batchId: string | null;
  /** 依恋风格. */
  readonly attachmentStyle: string;
  /** 解析告警. */
  readonly warnings: readonly string[];
}

/**
 * 质量标注台服务.
 */
@Injectable()
export class QualityAnnotationService implements OnModuleInit {
  private readonly logger = new Logger(QualityAnnotationService.name);

  /**
   * @param repo quality_annotation 仓储
   * @param batch 批次读侧服务 (批次事实 / 逐字稿来源 / 冻结)
   */
  constructor(
    @InjectRepository(QualityAnnotationEntity) private readonly repo: Repository<QualityAnnotationEntity>,
    private readonly batch: QualityAnnotationBatchService,
  ) {}

  /**
   * 启动时幂等导入锚点清单 (30 行).
   *   CSV 缺失 = 没跑过基线分析, 不阻塞启动, 只打 warn.
   */
  async onModuleInit(): Promise<void> {
    try {
      const csvPath = join(process.cwd(), 'data', 'quality', 'anchor-sample-30.csv');
      const content = await readFile(csvPath, 'utf8');
      const rows = parseAnchorCsv(content);
      const result = await seedQualityAnnotations(this.repo, rows);
      this.logger.log(`锚点清单导入: inserted=${result.inserted} updated=${result.updated} unchanged=${result.unchanged}`);
    } catch (e) {
      this.logger.warn(`锚点清单未导入: ${(e as Error).message}`);
    }
  }

  /**
   * 列表 + 标注进度.
   *
   * ⚠️ **`done` / `total` 的口径**: 不传 batchId → 全量口径 (前端左栏进度条不能跳);
   *   传 batchId → 该批口径.
   *
   * @param status 筛选 (pending | done | all)
   * @param batchId 批次 id (省略 → 全局口径)
   * @returns 列表 + 进度
   */
  async list(status: AnnotationStatus, batchId?: string | null): Promise<AnnotationListResponse> {
    const scope = normalizeBatchId(batchId);
    if (scope === null) return this.listLegacy(status);
    return this.listByBatch(scope, status);
  }

  /**
   * 详情 = 标注行 + 该场逐字稿.
   *
   * ⚠️ **逐字稿缺失不报错**: 返回空数组 + transcriptSource='missing' + 告警 ——
   *   归档目录里的老场次可能没有文件, 标注员仍然可以只标数值列.
   *
   * @param ref 标注行 id 或 debug_session_id
   * @returns 详情
   */
  async detail(ref: string): Promise<AnnotationDetail> {
    const resolved = await this.resolveRef(ref);
    const read = await this.batch.readTranscript(resolved.debugSessionId, resolved.batchId);
    const messages: AnnotationMessageView[] = (read.record?.messages ?? []).map((message) => ({
      role: message.role,
      text: message.text,
      turnIndex: message.turnIndex,
    }));
    const warnings = [...resolved.warnings];
    if (read.source === TRANSCRIPT_SOURCE.Missing) warnings.push(TRANSCRIPT_MISSING_CODE);
    const row = resolved.row
      ? toRowView(resolved.row, read.source, warnings)
      : toDerivedView(resolved.fact!, resolved.attachmentStyle, read.source, warnings);
    return {
      row,
      characterLabel: read.record?.characterLabel ?? null,
      messages,
      transcriptSource: read.source,
      warnings,
    };
  }

  /**
   * 保存人工标注.
   *
   * ⚠️ **保存就是覆盖**: 一场会话一行, 重标覆盖旧值 (不堆历史) ——
   *   标注台是"当前结论", 不是流水.
   *
   * ⚠️ **未建行 → 幂等 upsert**: 归属列 (batch_id / 版本列) 从场次表抄一份快照,
   *   唯一键仍是 debug_session_id, 重复 PUT 不产生第二行.
   *
   * @param ref 标注行 id 或 debug_session_id
   * @param body 标注内容
   * @param annotator 标注人 (basic 账号名 / 学员用户名)
   * @returns 保存后的行
   */
  async save(ref: string, body: QualityAnnotationSaveDto, annotator: string | null): Promise<AnnotationRowView> {
    const resolved = await this.resolveRef(ref);
    const warnings = [...resolved.warnings];
    const row = resolved.row ?? (await this.createRow(resolved));

    applyHumanColumns(row, body);
    applyTurnColumns(row, body);
    if (annotator !== null) row.annotator = annotator;
    await this.repo.save(row);

    // 懒冻结: 保存成功即留档一份 —— 逐字稿会被 500 淘汰, 标注结论得留得住.
    const frozen = await this.batch.freezeTranscript(row.debugSessionId, row.batchId);
    if (frozen.reason === 'failed') warnings.push(FREEZE_FAILED_CODE);

    const source = this.batch.transcriptSource(row.debugSessionId, row.batchId);
    return toRowView(row, source, warnings);
  }

  /**
   * 双盲揭示: 返回本场自动判定结果.
   *
   * @param ref 标注行 id 或 debug_session_id
   * @returns 自动判定结果
   */
  async reveal(ref: string): Promise<AnnotationReveal> {
    const resolved = await this.resolveRef(ref);
    if (resolved.row === null || resolved.row.dominantLabel === null) {
      throw new BizException(BizCode.InvalidParameter, '本场还没保存人工标注, 不能揭示自动判定 (双盲口径)');
    }
    const auto = await this.computeAuto(resolved.debugSessionId, resolved.batchId);
    return {
      auto: {
        explorationTurn: auto.explorationTurn,
        dominantLabel: auto.dominantLabel,
        crisisLevel: auto.crisisLevel,
      },
    };
  }

  /**
   * 随时可调用的自动判定 (双盲辅助用).
   *
   * 与 {@link reveal} 的区别: 不要求先保存人工标注, 只返回规则引擎本身的判定.
   *
   * @param ref 标注行 id 或 debug_session_id
   * @returns 自动判定结果
   */
  async auto(ref: string): Promise<AnnotationReveal> {
    const resolved = await this.resolveRef(ref);
    const auto = await this.computeAuto(resolved.debugSessionId, resolved.batchId);
    return {
      auto: {
        explorationTurn: auto.explorationTurn,
        dominantLabel: auto.dominantLabel,
        crisisLevel: auto.crisisLevel,
      },
    };
  }

  /**
   * 一致性报告: 人工标注 vs 自动判定.
   *
   * @param batchId 批次 id (省略 → 全量口径)
   * @returns 一致性报告
   */
  async consistency(batchId?: string | null): Promise<AnnotationConsistency> {
    const scope = normalizeBatchId(batchId);
    if (scope === null) return this.consistencyAll();
    return this.consistencyByBatch(scope);
  }

  /**
   * 可标注批次清单.
   *
   * @param includeInvalid 是否把无效批次也返回
   * @returns 批次清单 + 告警
   */
  async batches(includeInvalid: boolean): Promise<AnnotationBatchListResponse> {
    const grouped = await this.batch.groupedSessions();
    const batchRows = await this.batch.batchRows();
    const annotations = await this.repo.find();

    const annotatedByBatch = new Map<string, number>();
    for (const row of annotations) {
      if (row.batchId === null || row.dominantLabel === null) continue;
      annotatedByBatch.set(row.batchId, (annotatedByBatch.get(row.batchId) ?? 0) + 1);
    }

    const batchRowById = new Map(batchRows.map((row) => [row.batchId, row]));
    const views: AnnotationBatchView[] = [];
    for (const [batchId, facts] of grouped) {
      views.push(this.toBatchView(batchId, facts, batchRowById.get(batchId), annotatedByBatch.get(batchId) ?? 0));
    }

    const visible = includeInvalid ? views : views.filter((view) => view.valid === true);
    const hidden = views.length - visible.length;
    const warnings = hidden > 0 ? [`${INVALID_BATCHES_HIDDEN_CODE}:${hidden}`] : [];
    visible.sort(compareBatchViews);

    return { data: visible, meta: { generatedAt: new Date().toISOString(), total: visible.length }, warnings };
  }

  // ── private ────────────────────────────────────────────────────

  /**
   * 全局口径列表 (已落库行 + 场次表派生的未标注场次; id=null 派生行).
   *
   * 已落库行 (含锚点 seed 行, 场次表里查不到事实也不丢) 排在前;
   * 场次表中未标注的可标注场次补派生行, 避免待标场次在全局队列里隐形.
   *
   * @param status 筛选
   * @returns 列表 + 进度
   */
  private async listLegacy(status: AnnotationStatus): Promise<AnnotationListResponse> {
    const rows = sortByAnchorOrder(await this.repo.find());
    const labeled = rows.filter((row) => row.dominantLabel !== null).length;
    const bySession = new Set(rows.map((row) => row.debugSessionId));
    const facts = await this.batch.allSessions();
    const styles = await this.batch.attachmentStyles();

    let totalDerived = 0;
    const items: AnnotationRowView[] = [];

    // 已落库行保留 (锚点 seed 行即使场次表里没有事实也不丢).
    for (const row of rows) {
      const source = this.batch.transcriptSource(row.debugSessionId, row.batchId);
      const view = toRowView(row, source, []);
      if (matchesStatus(view.dominantLabel !== null, status)) items.push(view);
    }

    // 场次表派生: 已标注行不重复; 未标注的可标注场次补 id=null 派生行.
    const seen = new Set(bySession);
    for (const fact of facts) {
      if (seen.has(fact.debugSessionId)) continue;
      seen.add(fact.debugSessionId);
      const source = this.batch.transcriptSource(fact.debugSessionId, fact.batchId);
      if (!isAnnotatableSession(fact, source !== TRANSCRIPT_SOURCE.Missing)) continue;
      const view = toDerivedView(fact, styles.get(fact.characterSlug) ?? ATTACHMENT_STYLE_UNKNOWN, source, []);
      if (matchesStatus(false, status)) items.push(view);
      totalDerived += 1;
    }

    return { items, done: labeled, total: rows.length + totalDerived };
  }

  /**
   * 批次口径列表 (按批派生: sessions LEFT JOIN annotation).
   *
   * ⚠️ 队列只含**可标注**场次 —— 标不了台词的场次进队列就是制造垃圾数据.
   *
   * @param batchId 批次 id
   * @param status 筛选
   * @returns 列表 + 进度
   */
  private async listByBatch(batchId: string, status: AnnotationStatus): Promise<AnnotationListResponse> {
    const facts = await this.batch.batchSessions(batchId);
    const rows = await this.repo.find({ where: { batchId } });
    const bySession = new Map(rows.map((row) => [row.debugSessionId, row]));
    const styles = await this.batch.attachmentStyles();

    const items: AnnotationRowView[] = [];
    let labeled = 0;
    let total = 0;
    for (const fact of facts) {
      const source = this.batch.transcriptSource(fact.debugSessionId, fact.batchId);
      if (!isAnnotatableSession(fact, source !== TRANSCRIPT_SOURCE.Missing)) continue;
      total += 1;
      const row = bySession.get(fact.debugSessionId);
      const view = row
        ? toRowView(row, source, [])
        : toDerivedView(fact, styles.get(fact.characterSlug) ?? ATTACHMENT_STYLE_UNKNOWN, source, []);
      if (view.dominantLabel !== null) labeled += 1;
      if (!matchesStatus(view.dominantLabel !== null, status)) continue;
      items.push(view);
    }
    return { items, done: labeled, total };
  }

  /**
   * 全量口径一致性 (**向后兼容**: 分母与改造前一致).
   *
   * @returns 一致性报告
   */
  private async consistencyAll(): Promise<AnnotationConsistency> {
    const rows = sortByAnchorOrder(await this.repo.find());
    const inputs: ConsistencyInput[] = [];
    let missing = 0;
    for (const row of rows) {
      const labeled = row.dominantLabel !== null;
      let auto: AutoMetrics | null = null;
      if (labeled) {
        const read = await this.batch.readTranscript(row.debugSessionId, row.batchId);
        if (read.source === TRANSCRIPT_SOURCE.Missing) missing += 1;
        auto = read.record === null ? EMPTY_AUTO : autoMetricsOf(read.record);
      }
      inputs.push({
        labeled,
        humanLabel: isAnnotationLabel(row.dominantLabel) ? row.dominantLabel : null,
        humanCrisisLevel: row.crisisPeakLevel,
        humanExplorationTurn: row.firstExplorationTurn,
        auto,
      });
    }
    const report = computeConsistency(inputs);
    const engineVersions = rows.map((row) => row.engineVersion);
    const promptVersions = rows.map((row) => row.promptVersion);
    const verdict = evaluateComparability({
      labeled: report.labeled,
      engineVersions,
      promptVersions,
      missingTranscriptLabeled: missing,
    });
    return {
      ...report,
      scope: {
        batchId: null,
        sessions: rows.length,
        engineVersions: distinctVersions(engineVersions),
        promptVersions: distinctVersions(promptVersions),
        ...verdict,
      },
    };
  }

  /**
   * 批次口径一致性 (分母 = 该批场次数).
   *
   * @param batchId 批次 id
   * @returns 一致性报告
   */
  private async consistencyByBatch(batchId: string): Promise<AnnotationConsistency> {
    const facts = await this.batch.batchSessions(batchId);
    const rows = await this.repo.find({ where: { batchId } });
    const bySession = new Map(rows.map((row) => [row.debugSessionId, row]));

    const inputs: ConsistencyInput[] = [];
    let missing = 0;
    for (const fact of facts) {
      const row = bySession.get(fact.debugSessionId);
      const labeled = row !== undefined && row.dominantLabel !== null;
      let auto: AutoMetrics | null = null;
      if (labeled) {
        const read = await this.batch.readTranscript(fact.debugSessionId, batchId);
        if (read.source === TRANSCRIPT_SOURCE.Missing) missing += 1;
        auto = read.record === null ? EMPTY_AUTO : autoMetricsOf(read.record);
      }
      inputs.push({
        labeled,
        humanLabel: row !== undefined && isAnnotationLabel(row.dominantLabel) ? row.dominantLabel : null,
        humanCrisisLevel: row?.crisisPeakLevel ?? 0,
        humanExplorationTurn: row?.firstExplorationTurn ?? null,
        auto,
      });
    }

    const report = computeConsistency(inputs);
    const engineVersions = facts.map((fact) => fact.engineVersion);
    const promptVersions = facts.map((fact) => fact.promptVersion);
    const verdict = evaluateComparability({
      labeled: report.labeled,
      engineVersions,
      promptVersions,
      missingTranscriptLabeled: missing,
    });
    return {
      ...report,
      scope: {
        batchId,
        sessions: facts.length,
        engineVersions: distinctVersions(engineVersions),
        promptVersions: distinctVersions(promptVersions),
        ...verdict,
      },
    };
  }

  /**
   * 解析 ref: 先按标注行 id 命中, 再按 debug_session_id 命中, 最后按场次表反查.
   *
   * @param ref 标注行 id 或 debug_session_id
   * @returns 解析结果
   */
  private async resolveRef(ref: string): Promise<ResolvedRef> {
    const byId = await this.repo.findOne({ where: { id: ref } });
    if (byId !== null) return fromRow(byId);
    const bySession = await this.repo.findOne({ where: { debugSessionId: ref } });
    if (bySession !== null) return fromRow(bySession);

    const found = await this.batch.findSessionFact(ref);
    if (found.fact === null) throw new BizException(BizCode.ResourceNotFound, '标注记录不存在');
    const styles = await this.batch.attachmentStyles();
    return {
      row: null,
      fact: found.fact,
      debugSessionId: found.fact.debugSessionId,
      batchId: found.fact.batchId,
      attachmentStyle: styles.get(found.fact.characterSlug) ?? ATTACHMENT_STYLE_UNKNOWN,
      warnings: found.ambiguous ? [SESSION_AMBIGUOUS_CODE] : [],
    };
  }

  /**
   * 建一行新标注 (**幂等 upsert** 的建行半边).
   *
   * ⚠️ 归属列从场次表抄**快照**: 之后批次表变了也不回改 ——
   *   结论必须锚在"标注当时"的那一版上.
   *
   * @param resolved 解析结果
   * @returns 新建的标注行
   */
  private async createRow(resolved: ResolvedRef): Promise<QualityAnnotationEntity> {
    const fact = resolved.fact;
    if (fact === null) throw new BizException(BizCode.ResourceNotFound, '标注记录不存在');
    const anchorOrder = await this.batch.batchAnchorOrder(fact);
    return this.repo.save({
      id: randomUUID(),
      debugSessionId: fact.debugSessionId,
      characterSlug: fact.characterSlug,
      attachmentStyle: resolved.attachmentStyle,
      anchorOrder,
      batchId: fact.batchId,
      counselorModeId: fact.counselorModeId,
      turnCount: fact.turnCount,
      engineVersion: fact.engineVersion,
      promptVersion: fact.promptVersion,
      characterVersion: fact.characterVersion,
      firstExplorationTurn: null,
      dominantLabel: null,
      crisisPeakLevel: 0,
      crisisFirstTurn: null,
      shouldEndTurn: null,
      needsReview: false,
      durationMs: 0,
      annotator: null,
      notes: null,
      firstBadTurn: null,
      badTurns: null,
      turnNote: null,
    });
  }

  /**
   * 现算一场会话的自动判定结果.
   *
   * ⚠️ **逐字稿缺失 → 返回全 NULL / 0 档**, 不是报错: 归档场次可能没有文件,
   *   一致性报告要能继续跑完 (那一场自动跳过对比).
   *
   * @param debugSessionId 调试会话 id
   * @param batchId 归属批次 id
   * @returns 自动判定结果
   */
  private async computeAuto(debugSessionId: string, batchId: string | null): Promise<AutoMetrics> {
    const read = await this.batch.readTranscript(debugSessionId, batchId);
    if (read.record === null) {
      this.logger.warn(`[quality_annotation] 逐字稿缺失, 自动判定按空口径计 session=${debugSessionId}`);
      return EMPTY_AUTO;
    }
    return autoMetricsOf(read.record);
  }

  /**
   * 批次行 → 视图.
   *
   * @param batchId 批次 id
   * @param facts 该批场次事实
   * @param batchRow 批次结论行 (NULL = 没有批次行)
   * @param annotated 已标注场次数
   * @returns 批次视图
   */
  private toBatchView(
    batchId: string,
    facts: readonly BatchSessionFact[],
    batchRow:
      | {
          readonly valid: boolean | null;
          readonly validityFlags: readonly string[];
          readonly engineVersion: string | null;
          readonly promptVersion: string | null;
          readonly configFingerprint: string | null;
        }
      | undefined,
    annotated: number,
  ): AnnotationBatchView {
    let completed = 0;
    let annotatable = 0;
    let transcriptAvailable = 0;
    let createdAt: string | null = null;
    for (const fact of facts) {
      if (fact.status === 'completed') completed += 1;
      const hasTranscript = this.batch.transcriptSource(fact.debugSessionId, fact.batchId) !== TRANSCRIPT_SOURCE.Missing;
      if (hasTranscript) transcriptAvailable += 1;
      if (isAnnotatableSession(fact, hasTranscript)) annotatable += 1;
      const started = fact.startedAt;
      if (started !== null && (createdAt === null || started < createdAt)) createdAt = started;
    }
    return {
      batchId,
      createdAt,
      sessions: facts.length,
      completedSessions: completed,
      annotatableSessions: annotatable,
      annotatedSessions: annotated,
      transcriptAvailableSessions: transcriptAvailable,
      valid: batchRow?.valid ?? null,
      validityFlags: batchRow?.validityFlags ?? [],
      engineVersion: batchRow?.engineVersion ?? firstNonNull(facts.map((fact) => fact.engineVersion)),
      promptVersion: batchRow?.promptVersion ?? firstNonNull(facts.map((fact) => fact.promptVersion)),
      configFingerprint: batchRow?.configFingerprint ?? null,
    };
  }
}

/**
 * 标注行 → 视图.
 *
 * @param row 标注行
 * @param source 逐字稿来源
 * @param warnings 告警
 * @returns 视图对象
 */
function toRowView(row: QualityAnnotationEntity, source: TranscriptSource, warnings: readonly string[]): AnnotationRowView {
  return {
    id: row.id,
    debugSessionId: row.debugSessionId,
    characterSlug: row.characterSlug,
    attachmentStyle: row.attachmentStyle,
    firstExplorationTurn: row.firstExplorationTurn,
    dominantLabel: isAnnotationLabel(row.dominantLabel) ? row.dominantLabel : null,
    crisisPeakLevel: row.crisisPeakLevel,
    crisisFirstTurn: row.crisisFirstTurn,
    shouldEndTurn: row.shouldEndTurn,
    needsReview: row.needsReview,
    durationMs: row.durationMs,
    notes: row.notes,
    updatedAt: row.updatedAt.toISOString(),
    batchId: row.batchId,
    counselorModeId: row.counselorModeId,
    turnCount: row.turnCount,
    engineVersion: row.engineVersion,
    promptVersion: row.promptVersion,
    characterVersion: row.characterVersion,
    firstBadTurn: row.firstBadTurn,
    badTurns: row.badTurns,
    turnNote: row.turnNote,
    transcriptSource: source,
    warnings,
  };
}

/**
 * 场次事实 → 派生视图 (**未落行**).
 *
 * ⚠️ `id` 恒为 null —— 这条还没落库, 前端要拿 debugSessionId 当主键用.
 *
 * @param fact 场次事实
 * @param attachmentStyle 依恋风格
 * @param source 逐字稿来源
 * @param warnings 告警
 * @returns 视图对象
 */
function toDerivedView(
  fact: BatchSessionFact,
  attachmentStyle: string,
  source: TranscriptSource,
  warnings: readonly string[],
): AnnotationRowView {
  return {
    id: null,
    debugSessionId: fact.debugSessionId,
    characterSlug: fact.characterSlug,
    attachmentStyle,
    firstExplorationTurn: null,
    dominantLabel: null,
    crisisPeakLevel: 0,
    crisisFirstTurn: null,
    shouldEndTurn: null,
    needsReview: false,
    durationMs: 0,
    notes: null,
    updatedAt: null,
    batchId: fact.batchId,
    counselorModeId: fact.counselorModeId,
    turnCount: fact.turnCount,
    engineVersion: fact.engineVersion,
    promptVersion: fact.promptVersion,
    characterVersion: fact.characterVersion,
    firstBadTurn: null,
    badTurns: null,
    turnNote: null,
    transcriptSource: source,
    warnings,
  };
}

/**
 * 标注行 → 解析结果.
 *
 * @param row 标注行
 * @returns 解析结果
 */
function fromRow(row: QualityAnnotationEntity): ResolvedRef {
  return {
    row,
    fact: null,
    debugSessionId: row.debugSessionId,
    batchId: row.batchId,
    attachmentStyle: row.attachmentStyle,
    warnings: [],
  };
}

/**
 * 写人工标注列 (口径与改造前一致).
 *
 * @param row 标注行
 * @param body 标注内容
 */
function applyHumanColumns(row: QualityAnnotationEntity, body: QualityAnnotationSaveDto): void {
  row.firstExplorationTurn = body.firstExplorationTurn ?? null;
  row.dominantLabel = body.dominantLabel ?? null;
  row.crisisPeakLevel = body.crisisPeakLevel ?? row.crisisPeakLevel;
  row.crisisFirstTurn = body.crisisFirstTurn ?? null;
  row.shouldEndTurn = body.shouldEndTurn ?? null;
  row.needsReview = body.needsReview ?? false;
  row.durationMs = body.durationMs ?? row.durationMs;
  if (body.notes !== undefined) row.notes = body.notes;
}

/**
 * 写轮级三列 (**非法 → 400, 不静默丢弃**).
 *
 * @param row 标注行
 * @param body 标注内容
 */
function applyTurnColumns(row: QualityAnnotationEntity, body: QualityAnnotationSaveDto): void {
  const turnCount = row.turnCount;
  const firstBadTurn = body.firstBadTurn ?? null;
  if (firstBadTurn !== null && turnCount !== null && firstBadTurn > turnCount) {
    throw new BizException(BizCode.InvalidParameter, `firstBadTurn 超出本场轮数 ${turnCount}`);
  }
  row.firstBadTurn = firstBadTurn;

  const rawTurns = body.badTurns ?? null;
  if (rawTurns === null) {
    row.badTurns = null;
  } else {
    const parsed = parseBadTurns(rawTurns, turnCount);
    if (!parsed.ok) throw new BizException(BizCode.InvalidParameter, parsed.reason ?? 'badTurns 不合法');
    row.badTurns = formatBadTurns(parsed.turns);
  }

  const note = body.turnNote ?? null;
  if (note !== null) {
    const hit = TURN_NOTE_FORBIDDEN_TOKENS.find((token) => note.includes(token));
    if (hit !== undefined) {
      throw new BizException(BizCode.InvalidParameter, `turnNote 不允许评分 / 等级 / 对错语义 (命中 "${hit}")`);
    }
  }
  row.turnNote = note;
}

/**
 * 逐字稿 → 自动判定指标.
 *
 * @param record 逐字稿
 * @returns 自动判定指标
 */
function autoMetricsOf(record: TranscriptRecord): AutoMetrics {
  const visitorTurnCount = record.messages.filter((message) => message.role === 'visitor').length;
  return computeAutoMetrics({ visitorTurnCount, traces: toAutoTraces(record.traces) });
}

/**
 * 筛选是否命中.
 *
 * @param labeled 是否已标
 * @param status 筛选
 * @returns 命中 → true
 */
function matchesStatus(labeled: boolean, status: AnnotationStatus): boolean {
  if (status === ANNOTATION_STATUS.Pending) return !labeled;
  if (status === ANNOTATION_STATUS.Done) return labeled;
  return true;
}

/**
 * 归一化批次 id (空 → null = 历史口径).
 *
 * @param batchId 原始批次 id
 * @returns 批次 id 或 null
 */
function normalizeBatchId(batchId: string | null | undefined): string | null {
  if (batchId === null || batchId === undefined) return null;
  const text = batchId.trim();
  return text.length === 0 ? null : text;
}

/**
 * 取第一个非空值.
 *
 * @param values 候选值
 * @returns 第一个非空值; 全空 → null
 */
function firstNonNull(values: readonly (string | null)[]): string | null {
  for (const value of values) {
    if (value !== null && value.length > 0) return value;
  }
  return null;
}

/**
 * 批次视图排序 (createdAt DESC, batchId ASC 兜底).
 *
 * @param left 左侧
 * @param right 右侧
 * @returns 比较结果
 */
function compareBatchViews(left: AnnotationBatchView, right: AnnotationBatchView): number {
  const leftCreated = left.createdAt ?? '';
  const rightCreated = right.createdAt ?? '';
  if (leftCreated !== rightCreated) return rightCreated.localeCompare(leftCreated);
  return left.batchId.localeCompare(right.batchId);
}

/**
 * 按锚点清单顺序排序 (清单顺序 → id, 保证同序时也稳定).
 *
 * ⚠️ **为什么在代码里排, 不靠 SQL 的 ORDER BY**: 标注台是**队列** ——
 *   "第 12 场"必须永远是同一场, 否则大炮标到一半刷新页面, 顺序就乱了.
 *   口径写在代码里, 不依赖任何一处实现 (驱动 / ORM / 仓储替身) 的排序行为.
 *
 * @param rows 标注行
 * @returns 排好序的副本
 */
function sortByAnchorOrder(rows: readonly QualityAnnotationEntity[]): QualityAnnotationEntity[] {
  return [...rows].toSorted((left, right) => {
    if (left.anchorOrder !== right.anchorOrder) return left.anchorOrder - right.anchorOrder;
    return left.id.localeCompare(right.id);
  });
}
