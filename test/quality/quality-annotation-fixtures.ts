// V2026-11-13 建立 (TD-6 · 观察项 #7 · 标注实体 row builder):
//   职责: 给 `quality_annotation` 表的行造**一份**共享夹具 —— 默认值工厂 + overrides 合并.
//   边界: 纯 TS, 零 IO; 只描述**行**的形状.
//
//   为什么要有这个文件 (而不是每个 spec 各写一份):
//     标注实体 WP-N 加了 9 列 (归属 / 版本锁 / 轮级最小集), 两个 spec 各造一份行,
//     列默认值各自手写 —— 加列时两边各改一次, 漏改的那份仍然绿, 但它测的是**旧形状**的世界.
//     共享一份 = 默认值只有一处真相.
//
//   ⚠️ 它**不是** spec (文件名不含 `.spec`) —— vitest 不会把它当测试收集.
//
//   ⚠️ 默认值口径 (与 `quality-annotation.entity.ts` 的列定义对齐):
//     · WP-N 九列全 **nullable** → 缺省 null;
//     · NOT NULL DEFAULT 列 → 用 DDL 默认值 (anchorOrder=0 / crisisPeakLevel=0 / needsReview=false / durationMs=0);
//     · 人工标注列 (firstExplorationTurn / dominantLabel / crisisFirstTurn / shouldEndTurn / annotator / notes) → null.

import type { QualityAnnotationEntity } from '../../src/quality/quality-annotation.entity.js';

/**
 * 造一行标注 (默认值工厂 + overrides).
 *
 * @param overrides 列覆盖 (缺省 = 全默认)
 * @returns 标注行
 */
export function buildQualityAnnotationRow(overrides: Partial<QualityAnnotationEntity> = {}): QualityAnnotationEntity {
  return {
    id: 'row-1',
    debugSessionId: 'debug_abc',
    characterSlug: 'vpt_general_secure_l1',
    attachmentStyle: 'secure',
    anchorOrder: 1,
    firstExplorationTurn: null,
    dominantLabel: null,
    crisisPeakLevel: 0,
    crisisFirstTurn: null,
    shouldEndTurn: null,
    needsReview: false,
    durationMs: 0,
    annotator: null,
    notes: null,
    createdAt: new Date('2026-11-10T00:00:00.000Z'),
    updatedAt: new Date('2026-11-10T00:00:00.000Z'),
    // WP-N 九列 (归属 / 版本锁 / 轮级最小集) —— 全可空, 缺省 null.
    batchId: null,
    counselorModeId: null,
    turnCount: null,
    engineVersion: null,
    promptVersion: null,
    characterVersion: null,
    firstBadTurn: null,
    badTurns: null,
    turnNote: null,
    ...overrides,
  };
}
