// V2026-11-11 治本 (WP-N · 标注台批次化 — 批次读侧服务):
//   职责: 批次事实 / 批内派生队列所需的场次数据 / 逐字稿来源与冻结.
//   边界: 只读 ap_practice_sessions / ap_practice_batches / character_profiles;
//         标注行 (quality_annotation) 的读写仍在 quality-annotation.service.ts.
//
//   为什么**单独成服务**: 标注台有两条读路径 ——
//     · 全局口径 (已落库行 + 场次表派生) —— 批次事实供全局派生复用;
//     · 批次口径 (按批派生) —— 读三张表.
//   混在一个服务里, "批次" 这套新口径会渗进老路径 —— 那是回归的温床.

import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { existsSync } from 'node:fs';
import path from 'node:path';
import type { Repository } from 'typeorm';

import { sortBatchSessions, type BatchSessionFact } from './quality-annotation-batch.js';
import { TRANSCRIPT_SOURCE, type TranscriptSource } from './quality-annotation.constants.js';
import { QualityTranscriptFreeze, type FreezeResult, type TranscriptReadResult } from './quality-transcript-freeze.js';
import { DebugSessionStore } from '../admin-debug/debug-session-store.js';
import { PracticeBatch } from '../auto-practice/entities/practice-batch.entity.js';
import { PracticeSession } from '../auto-practice/entities/practice-session.entity.js';
import { CharacterProfileEntity } from '../engine-adapters/wiring/character/character-profile.entity.js';

/**
 * 批次结论行 (批次表 → 视图, 实体类型不出这个服务).
 */
export interface BatchFactRow {
  /** 批次 id. */
  readonly batchId: string;
  /** 有效性 (NULL = 没有批次行, 无法判定). */
  readonly valid: boolean | null;
  /** 不达标原因码. */
  readonly validityFlags: readonly string[];
  /** 引擎版本. */
  readonly engineVersion: string | null;
  /** prompt 版本. */
  readonly promptVersion: string | null;
  /** 配置指纹. */
  readonly configFingerprint: string | null;
}

/**
 * 批次读侧服务.
 */
@Injectable()
export class QualityAnnotationBatchService {
  private readonly logger = new Logger(QualityAnnotationBatchService.name);

  /**
   * @param sessionRepo 对练场次仓储
   * @param batchRepo 批次仓储
   * @param profileRepo 角色基线仓储
   * @param store 逐字稿只读存储
   * @param freeze 逐字稿冻结留档器
   */
  constructor(
    @InjectRepository(PracticeSession) private readonly sessionRepo: Repository<PracticeSession>,
    @InjectRepository(PracticeBatch) private readonly batchRepo: Repository<PracticeBatch>,
    @InjectRepository(CharacterProfileEntity) private readonly profileRepo: Repository<CharacterProfileEntity>,
    private readonly store: DebugSessionStore,
    private readonly freeze: QualityTranscriptFreeze,
  ) {}

  /**
   * 某批的场次事实 (批内确定性排序后).
   *
   * @param batchId 批次 id
   * @returns 场次事实
   */
  async batchSessions(batchId: string): Promise<BatchSessionFact[]> {
    const rows = await this.sessionRepo.find({ where: { batchId } });
    return sortBatchSessions(rows.map(toSessionFact));
  }

  /**
   * 全部批次按 batch_id 分组 (只收有批次归属的场次).
   *
   * @returns 批次 id → 场次事实
   */
  async groupedSessions(): Promise<Map<string, BatchSessionFact[]>> {
    const rows = await this.sessionRepo.find();
    const grouped = new Map<string, BatchSessionFact[]>();
    for (const row of rows) {
      if (row.batchId === null) continue;
      const list = grouped.get(row.batchId) ?? [];
      list.push(toSessionFact(row));
      grouped.set(row.batchId, list);
    }
    for (const [batchId, list] of grouped) {
      grouped.set(batchId, sortBatchSessions(list));
    }
    return grouped;
  }

  /**
   * 全部场次事实 (跨批次, 含 batchId=null 的单场; 全局确定性排序).
   *
   * @returns 场次事实
   */
  async allSessions(): Promise<BatchSessionFact[]> {
    const rows = await this.sessionRepo.find();
    return sortBatchSessions(rows.map(toSessionFact));
  }

  /**
   * 按 debug_session_id 反查场次事实.
   *
   * ⚠️ 命中多行时取 **created_at 最新**的一行, 并回报 ambiguous ——
   *   同一场次被重跑过, 哪一行才是"这一场"不该由代码悄悄定.
   *
   * @param debugSessionId 会话 id
   * @returns 事实 + 是否有多行命中
   */
  async findSessionFact(debugSessionId: string): Promise<{ fact: BatchSessionFact | null; ambiguous: boolean }> {
    const rows = await this.sessionRepo.find({ where: { debugSessionId } });
    if (rows.length === 0) return { fact: null, ambiguous: false };
    const sorted = [...rows].toSorted((left, right) => toTime(right.createdAt) - toTime(left.createdAt));
    const newest = sorted.at(0);
    if (newest === undefined) return { fact: null, ambiguous: false };
    return { fact: toSessionFact(newest), ambiguous: rows.length > 1 };
  }

  /**
   * 批内序号 (1 起) —— 派生行落库时的 anchor_order.
   *
   * @param fact 场次事实
   * @returns 批内序号; 无批次 → 0
   */
  async batchAnchorOrder(fact: BatchSessionFact): Promise<number> {
    if (fact.batchId === null) return 0;
    const facts = await this.batchSessions(fact.batchId);
    const index = facts.findIndex((item) => item.debugSessionId === fact.debugSessionId);
    return index === -1 ? 0 : index + 1;
  }

  /**
   * 依恋风格表 (template_id → attachment_style).
   *
   * ⚠️ 唯一来源是 character_profiles —— 场次表里没有这一列, 现编就是编造.
   *
   * @returns 风格表
   */
  async attachmentStyles(): Promise<Map<string, string>> {
    const rows = await this.profileRepo.find();
    const map = new Map<string, string>();
    for (const row of rows) map.set(row.templateId, row.attachmentStyle);
    return map;
  }

  /**
   * 批次结论行 (全部).
   *
   * @returns 批次结论行
   */
  async batchRows(): Promise<BatchFactRow[]> {
    const rows = await this.batchRepo.find();
    return rows.map((row) => ({
      batchId: row.batchId,
      valid: toValidFlag(row.valid),
      validityFlags: splitFlags(row.validityFlags),
      engineVersion: row.engineVersion,
      promptVersion: row.promptVersion,
      configFingerprint: row.configFingerprint,
    }));
  }

  /**
   * 逐字稿来源 (**冻结优先**).
   *
   * ⚠️ 这里只做**存在性**判定 (不读文件): 列表要给几十行判来源, 读文件太贵.
   *   真正读的时候走 {@link readTranscript} (冻结优先 → 活文件 → missing).
   *
   * @param debugSessionId 会话 id
   * @param batchId 批次 id
   * @returns 来源
   */
  transcriptSource(debugSessionId: string, batchId: string | null): TranscriptSource {
    if (this.freeze.hasFrozen(debugSessionId, batchId)) return TRANSCRIPT_SOURCE.Frozen;
    if (this.hasLiveFile(debugSessionId)) return TRANSCRIPT_SOURCE.Live;
    return TRANSCRIPT_SOURCE.Missing;
  }

  /**
   * 读逐字稿 (**冻结优先**).
   *
   * @param debugSessionId 会话 id
   * @param batchId 批次 id
   * @returns 来源 + 记录
   */
  async readTranscript(debugSessionId: string, batchId: string | null): Promise<TranscriptReadResult> {
    return this.freeze.read(debugSessionId, batchId);
  }

  /**
   * 冻结逐字稿 (懒冻结; 已存在则不重复写).
   *
   * @param debugSessionId 会话 id
   * @param batchId 批次 id
   * @returns 冻结结果
   */
  async freezeTranscript(debugSessionId: string, batchId: string | null): Promise<FreezeResult> {
    return this.freeze.freeze(debugSessionId, batchId);
  }

  /**
   * 活逐字稿文件是否在场.
   *
   * ⚠️ 路径解析走 `DebugSessionStore.directory()` —— 那是**唯一**的目录口径
   *   (env ADMIN_DEBUG_SESSION_DIR / 缺省 data/debug-sessions), 不自己拼.
   *
   * @param debugSessionId 会话 id
   * @returns 存在 → true
   */
  private hasLiveFile(debugSessionId: string): boolean {
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(debugSessionId)) return false;
    try {
      return existsSync(path.join(this.store.directory(), `${debugSessionId}.json`));
    } catch (error) {
      this.logger.warn(`[quality_annotation] 活逐字稿存在性判定失败 session=${debugSessionId}: ${errorName(error)}`);
      return false;
    }
  }
}

/**
 * 场次实体 → 场次事实.
 *
 * @param row 场次实体
 * @returns 场次事实
 */
function toSessionFact(row: PracticeSession): BatchSessionFact {
  return {
    practiceSessionId: row.id,
    debugSessionId: row.debugSessionId,
    characterSlug: row.characterSlug,
    counselorModeId: row.counselorModeId,
    turnCount: row.turnCount,
    status: row.status,
    engineVersion: row.engineVersion,
    promptVersion: row.promptVersion,
    characterVersion: row.characterVersion,
    startedAt: toIso(row.startedAt),
    batchId: row.batchId,
  };
}

/**
 * tinyint 有效性位 → 三态布尔.
 *
 * @param value 原始值
 * @returns true / false / null (不是 0/1 的值 → null, 表示判不了)
 */
function toValidFlag(value: number): boolean | null {
  if (value === 1) return true;
  if (value === 0) return false;
  return null;
}

/**
 * 拆开逗号分隔的原因码串.
 *
 * @param raw 原始串 (NULL → 空数组)
 * @returns 原因码数组
 */
export function splitFlags(raw: string | null | undefined): string[] {
  if (raw === null || raw === undefined) return [];
  return raw
    .split(',')
    .map((flag) => flag.trim())
    .filter((flag) => flag.length > 0);
}

/**
 * 时间戳 → epoch 毫秒 (拿不到 → 0).
 *
 * @param value 时间戳
 * @returns epoch 毫秒
 */
function toTime(value: Date | string | null | undefined): number {
  if (value === null || value === undefined) return 0;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? 0 : value.getTime();
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

/**
 * 时间戳 → ISO 字符串 (拿不到 → null).
 *
 * @param value 时间戳
 * @returns ISO 字符串或 null
 */
function toIso(value: Date | string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  return value;
}

/**
 * 取错误名 (日志只打错误名, 不打堆栈里的内容).
 *
 * @param error 错误
 * @returns 错误名
 */
export function errorName(error: unknown): string {
  return error instanceof Error ? error.name : 'UnknownError';
}
