// V2026-11-10 治本 (WP-J P2 · 专业级标注工具 — 锚点清单导入):
//   职责: 把 `data/quality/anchor-sample-30.csv` 的 30 行**幂等**导进 quality_annotation.
//   边界: 只导**身份三列** (会话 id / 角色代号 / 依恋风格) + 清单顺序;
//         标注列一律**不导** (保持双盲).
//
//   ⚠️ **CSV 后三列是自动口径值, 不是人工标注** (与任务单 §1 的说法有出入,
//     见交付记录偏差 B1):
//     `first_exploration_turn` / `dominant_label` / `crisis_peak_level` 是
//     `visitor-quality-audit.ts` 产出的**自动值** (dominant_label 30 行全是
//     `neutral`, 那套词表 approach/avoid/attack/appease 与人工词表根本不是一套).
//     导入它们 = 标注员打开就看到"答案" → 双盲没了, 这套校准就白做.
//
//   ⚠️ **重跑不覆盖人工标注**: 幂等 upsert 只更新身份三列与清单顺序,
//     标注列 (dominant_label 等) 原样保留 —— 大炮标了 20 场再重跑 seed,
//     那 20 场不能被冲掉.
//
//   验证: npx vitest run test/quality/quality-annotation-seed.spec.ts
//   时间戳: 2026-11-10 GMT+8

import { randomUUID } from 'node:crypto';

import type { Repository } from 'typeorm';

import { QualityAnnotationEntity } from './quality-annotation.entity.js';

/**
 * 调试会话 id 的合法形状 —— 与 `debug-session-store.ts` 的 SESSION_ID_PATTERN 同口径.
 *
 * 为什么**在这里重写一份**而不是 import: store 里那个常量是模块私有的,
 * 为一个只读校验去改既有文件不值得; 两处口径必须一致 (改了要一起改).
 */
const SESSION_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

/**
 * 锚点清单的一行 (只取身份列).
 */
export interface AnchorSeedRow {
  /** 清单顺序 (CSV 行号, 从 1 起). */
  readonly anchorOrder: number;
  /** 逐字稿会话 id. */
  readonly debugSessionId: string;
  /** 角色代号. */
  readonly characterSlug: string;
  /** 依恋风格. */
  readonly attachmentStyle: string;
}

/**
 * 导入结果.
 */
export interface AnchorSeedResult {
  /** 新增行数. */
  readonly inserted: number;
  /** 更新行数 (身份列有变). */
  readonly updated: number;
  /** 未变行数. */
  readonly unchanged: number;
}

/**
 * 解析锚点清单 CSV (只取身份三列 + 清单顺序).
 *
 * ⚠️ **解析失败就抛**, 不静默跳过: 少导 3 场 = 标注员以为 30 场标完了,
 *   实际有 3 场根本没进队列 —— 一致性报告的分母就错了.
 *
 * @param content CSV 全文
 * @returns 逐行锚点
 */
export function parseAnchorCsv(content: string): AnchorSeedRow[] {
  const lines = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (lines.length === 0) throw new Error('锚点清单为空');
  const header = lines[0].split(',').map((cell) => cell.trim());
  if (header[0] !== 'debug_session_id') throw new Error(`锚点清单表头不对: "${header[0]}" (要 debug_session_id)`);

  const rows: AnchorSeedRow[] = [];
  const seen = new Set<string>();
  for (let index = 1; index < lines.length; index += 1) {
    const cells = lines[index].split(',').map((cell) => cell.trim());
    const debugSessionId = cells[0] ?? '';
    if (!SESSION_ID_PATTERN.test(debugSessionId)) {
      throw new Error(`锚点清单第 ${index} 行的会话 id 不合法: "${debugSessionId}"`);
    }
    if (seen.has(debugSessionId)) {
      throw new Error(`锚点清单里会话 id 重复: "${debugSessionId}"`);
    }
    seen.add(debugSessionId);
    rows.push({
      anchorOrder: index,
      debugSessionId,
      characterSlug: cells[1] ?? '',
      attachmentStyle: cells[2] ?? '',
    });
  }
  return rows;
}

/**
 * 幂等导入锚点清单.
 *
 * ⚠️ **只更新身份列**: 人工标注列一律保留 —— 重跑 seed 不能冲掉大炮的标注.
 *
 * @param repo 标注表仓储
 * @param rows 逐行锚点
 * @returns 导入结果
 */
export async function seedQualityAnnotations(
  repo: Repository<QualityAnnotationEntity>,
  rows: readonly AnchorSeedRow[],
): Promise<AnchorSeedResult> {
  const existing = await repo.find();
  const bySessionId = new Map(existing.map((row) => [row.debugSessionId, row]));

  let inserted = 0;
  let updated = 0;
  let unchanged = 0;

  for (const row of rows) {
    const current = bySessionId.get(row.debugSessionId);
    if (!current) {
      await repo.insert({
        id: randomUUID(),
        debugSessionId: row.debugSessionId,
        characterSlug: row.characterSlug,
        attachmentStyle: row.attachmentStyle,
        anchorOrder: row.anchorOrder,
        firstExplorationTurn: null,
        dominantLabel: null,
        crisisPeakLevel: 0,
        crisisFirstTurn: null,
        shouldEndTurn: null,
        needsReview: false,
        durationMs: 0,
        annotator: null,
        notes: null,
      });
      inserted += 1;
      continue;
    }

    const changed =
      current.characterSlug !== row.characterSlug ||
      current.attachmentStyle !== row.attachmentStyle ||
      current.anchorOrder !== row.anchorOrder;
    if (!changed) {
      unchanged += 1;
      continue;
    }
    current.characterSlug = row.characterSlug;
    current.attachmentStyle = row.attachmentStyle;
    current.anchorOrder = row.anchorOrder;
    await repo.save(current);
    updated += 1;
  }

  return { inserted, updated, unchanged };
}
