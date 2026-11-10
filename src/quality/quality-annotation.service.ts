// V2026-11-10 治本 (WP-J P2 · 专业级标注工具 · admin 服务层):
//   职责: 五个端点的业务编排 —— 列表 / 详情 / 保存 / 双盲揭示 / 一致性报告.
//   边界: 不直接返实体 (走视图对象); 逐字稿**只读** `DebugSessionStore` 的读路径.
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

import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Repository } from 'typeorm';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { QualityAnnotationSaveDto } from './dto/quality-annotation.dto.js';
import { computeAutoMetrics, toAutoTraces, type AutoMetrics } from './quality-annotation-auto.js';
import { computeConsistency, type ConsistencyInput } from './quality-annotation-consistency.js';
import { ANNOTATION_STATUS, isAnnotationLabel, type AnnotationStatus } from './quality-annotation.constants.js';
import { QualityAnnotationEntity } from './quality-annotation.entity.js';
import { parseAnchorCsv, seedQualityAnnotations } from './quality-annotation.seed.js';
import type {
  AnnotationConsistency,
  AnnotationDetail,
  AnnotationListResponse,
  AnnotationMessageView,
  AnnotationReveal,
  AnnotationRowView,
} from './quality-annotation.view.js';
import { DebugSessionStore } from '../admin-debug/debug-session-store.js';
import { BizCode } from '../common/exceptions/biz-code.enum.js';
import { BizException } from '../common/exceptions/biz.exception.js';

/**
 * 质量标注台服务.
 */
@Injectable()
export class QualityAnnotationService implements OnModuleInit {
  private readonly logger = new Logger(QualityAnnotationService.name);

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
   * @param repo quality_annotation 仓储
   * @param store 调试会话文件存储 (只读逐字稿)
   */
  constructor(
    @InjectRepository(QualityAnnotationEntity) private readonly repo: Repository<QualityAnnotationEntity>,
    private readonly store: DebugSessionStore,
  ) {}

  /**
   * 列表 + 标注进度.
   *
   * ⚠️ **`done` / `total` 是全量口径**, 不随 `status` 过滤变化 ——
   *   前端左栏拿它显示"已标 12 / 30"进度条, 按筛选后的条数显示会跳.
   *
   * @param status 筛选 (pending | done | all)
   * @returns 列表 + 进度
   */
  async list(status: AnnotationStatus): Promise<AnnotationListResponse> {
    const rows = sortByAnchorOrder(await this.repo.find());
    const labeled = rows.filter((row) => row.dominantLabel !== null).length;
    const items = rows
      .filter((row) => {
        if (status === ANNOTATION_STATUS.Pending) return row.dominantLabel === null;
        if (status === ANNOTATION_STATUS.Done) return row.dominantLabel !== null;
        return true;
      })
      .map((row) => toRowView(row));
    return { items, done: labeled, total: rows.length };
  }

  /**
   * 详情 = 标注行 + 该场逐字稿.
   *
   * ⚠️ **逐字稿缺失不报错**: 返回空数组 —— 归档目录里的老场次可能没有文件,
   *   标注员仍然可以只标数值列, 不该因为"读不到台词"就打不开这一条.
   *
   * @param id 标注记录 id
   * @returns 详情
   */
  async detail(id: string): Promise<AnnotationDetail> {
    const row = await this.requireRow(id);
    const record = await this.store.get(row.debugSessionId);
    const messages: AnnotationMessageView[] = (record?.messages ?? []).map((message) => ({
      role: message.role,
      text: message.text,
      turnIndex: message.turnIndex,
    }));
    return { row: toRowView(row), characterLabel: record?.characterLabel ?? null, messages };
  }

  /**
   * 保存人工标注.
   *
   * ⚠️ **保存就是覆盖**: 一场会话一行, 重标覆盖旧值 (不堆历史) ——
   *   标注台是"当前结论", 不是流水.
   *
   * @param id 标注记录 id
   * @param body 标注内容
   * @param annotator 标注人 (basic 账号名 / 学员用户名)
   * @returns 保存后的行
   */
  async save(id: string, body: QualityAnnotationSaveDto, annotator: string | null): Promise<AnnotationRowView> {
    const row = await this.requireRow(id);
    row.firstExplorationTurn = body.firstExplorationTurn ?? null;
    row.dominantLabel = body.dominantLabel ?? null;
    row.crisisPeakLevel = body.crisisPeakLevel ?? row.crisisPeakLevel;
    row.crisisFirstTurn = body.crisisFirstTurn ?? null;
    row.shouldEndTurn = body.shouldEndTurn ?? null;
    row.needsReview = body.needsReview ?? false;
    row.durationMs = body.durationMs ?? row.durationMs;
    if (body.notes !== undefined) row.notes = body.notes;
    if (annotator !== null) row.annotator = annotator;
    await this.repo.save(row);
    return toRowView(row);
  }

  /**
   * 双盲揭示: 返回本场自动判定结果.
   *
   * @param id 标注记录 id
   * @returns 自动判定结果
   */
  async reveal(id: string): Promise<AnnotationReveal> {
    const row = await this.requireRow(id);
    if (row.dominantLabel === null) {
      throw new BizException(BizCode.InvalidParameter, '本场还没保存人工标注, 不能揭示自动判定 (双盲口径)');
    }
    const auto = await this.computeAuto(row.debugSessionId);
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
   * 给标注员「拿不准时主动问 AI」用 —— 但调用是主动的, 不主动亮答案, 不破坏双盲.
   *
   * @param id 标注记录 id
   * @returns 自动判定结果
   */
  async auto(id: string): Promise<AnnotationReveal> {
    const row = await this.requireRow(id);
    const auto = await this.computeAuto(row.debugSessionId);
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
   * @returns 一致性报告
   */
  async consistency(): Promise<AnnotationConsistency> {
    const rows = sortByAnchorOrder(await this.repo.find());
    const inputs: ConsistencyInput[] = [];
    for (const row of rows) {
      inputs.push({
        labeled: row.dominantLabel !== null,
        humanLabel: isAnnotationLabel(row.dominantLabel) ? row.dominantLabel : null,
        humanCrisisLevel: row.crisisPeakLevel,
        humanExplorationTurn: row.firstExplorationTurn,
        auto: await this.computeAuto(row.debugSessionId),
      });
    }
    return computeConsistency(inputs);
  }

  /**
   * 取一行 (不存在 → 404).
   *
   * @param id 标注记录 id
   * @returns 标注行
   */
  private async requireRow(id: string): Promise<QualityAnnotationEntity> {
    const row = await this.repo.findOne({ where: { id } });
    if (!row) throw new BizException(BizCode.ResourceNotFound, '标注记录不存在');
    return row;
  }

  /**
   * 现算一场会话的自动判定结果.
   *
   * ⚠️ **逐字稿缺失 → 返回全 NULL / 0 档**, 不是报错: 归档场次可能没有文件,
   *   一致性报告要能继续跑完 (那一场自动跳过对比).
   *
   * @param debugSessionId 调试会话 id
   * @returns 自动判定结果
   */
  private async computeAuto(debugSessionId: string): Promise<AutoMetrics> {
    const record = await this.store.get(debugSessionId);
    if (!record) {
      this.logger.warn(`[quality_annotation] 逐字稿缺失, 自动判定按空口径计 session=${debugSessionId}`);
      return { explorationTurn: null, dominantLabel: null, crisisLevel: 0 };
    }
    const visitorTurnCount = record.messages.filter((message) => message.role === 'visitor').length;
    return computeAutoMetrics({ visitorTurnCount, traces: toAutoTraces(record.traces) });
  }
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

/**
 * 实体 → 列表行视图.
 *
 * @param row 标注行
 * @returns 视图对象
 */
function toRowView(row: QualityAnnotationEntity): AnnotationRowView {
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
  };
}
