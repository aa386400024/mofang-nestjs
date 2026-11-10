// V2026-11-10 治本 (WP-J P2 · 专业级标注工具 · 锚点清单幂等导入 · 单测):
//   覆盖:
//     ① 解析真实锚点清单 → 30 行, 顺序按 CSV 行号;
//     ② **只取身份三列** —— CSV 后三列 (自动口径值) 一律不导 (双盲);
//     ③ 幂等: 重跑不新增, 且**不覆盖人工标注列**;
//     ④ 坏清单 (表头不对 / id 不合法 / id 重复) 直接抛, 不静默少导.
//
//   验证: npx vitest run test/quality/quality-annotation-seed.spec.ts
//   时间戳: 2026-11-10 GMT+8
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { QualityAnnotationEntity } from '../../src/quality/quality-annotation.entity.js';
import { parseAnchorCsv, seedQualityAnnotations, type AnchorSeedResult } from '../../src/quality/quality-annotation.seed.js';

/** 锚点清单路径 (相对仓库根). */
const ANCHOR_CSV_PATH = resolve(process.cwd(), 'data/quality/anchor-sample-30.csv');

/**
 * 内存版仓储 (只实现 seed 用到的三个方法).
 */
class StubRepo {
  readonly rows: QualityAnnotationEntity[] = [];
  insertCalls = 0;
  saveCalls = 0;

  async find(): Promise<QualityAnnotationEntity[]> {
    return [...this.rows];
  }

  async insert(row: QualityAnnotationEntity): Promise<void> {
    this.insertCalls += 1;
    this.rows.push(row);
  }

  async save(row: QualityAnnotationEntity): Promise<void> {
    this.saveCalls += 1;
    const index = this.rows.findIndex((item) => item.id === row.id);
    if (index !== -1) this.rows[index] = row;
  }
}

/**
 * 把统计对象摊平成字符串 (便于断言).
 *
 * @param result 导入结果
 * @returns "新增/更新/未变"
 */
function summarize(result: AnchorSeedResult): string {
  return `${result.inserted}/${result.updated}/${result.unchanged}`;
}

describe('WP-J P2 · 锚点清单幂等导入', () => {
  it('① 解析真实清单 → 30 行, 顺序按 CSV 行号', () => {
    const rows = parseAnchorCsv(readFileSync(ANCHOR_CSV_PATH, 'utf8'));

    expect(rows).toHaveLength(30);
    expect(rows[0]?.anchorOrder).toBe(1);
    expect(rows[29]?.anchorOrder).toBe(30);
    expect(rows[0]?.debugSessionId).toMatch(/^[A-Za-z0-9_-]{1,128}$/);
    expect(rows[0]?.characterSlug.length).toBeGreaterThan(0);
    expect(rows[0]?.attachmentStyle.length).toBeGreaterThan(0);
  });

  it('② 只取身份三列 (CSV 后三列是自动口径值, 不导)', () => {
    const rows = parseAnchorCsv(readFileSync(ANCHOR_CSV_PATH, 'utf8'));

    // 解析结果里根本没有"自动口径"字段 —— 结构上就不可能把它们带进来.
    expect(Object.keys(rows[0] ?? {}).toSorted()).toEqual(['anchorOrder', 'attachmentStyle', 'characterSlug', 'debugSessionId']);
  });

  it('③ 幂等: 首次导入 30 行, 重跑不新增也不覆盖人工标注', async () => {
    const repo = new StubRepo();
    const rows = parseAnchorCsv(readFileSync(ANCHOR_CSV_PATH, 'utf8'));

    const first = await seedQualityAnnotations(repo as never, rows);
    expect(summarize(first)).toBe('30/0/0');
    expect(repo.rows).toHaveLength(30);

    // 大炮标了第一场 (主导标签 + 危机档位) —— 重跑 seed 不能冲掉.
    const labeled = repo.rows[0];
    if (!labeled) throw new Error('首行缺失');
    labeled.dominantLabel = 'recounting';
    labeled.crisisPeakLevel = 2;
    labeled.notes = '手标';

    const second = await seedQualityAnnotations(repo as never, rows);
    expect(summarize(second)).toBe('0/0/30');
    expect(repo.rows).toHaveLength(30);
    expect(repo.rows[0]?.dominantLabel).toBe('recounting');
    expect(repo.rows[0]?.crisisPeakLevel).toBe(2);
    expect(repo.rows[0]?.notes).toBe('手标');
  });

  it('③ 身份列变了才算"更新" (清单改了要跟上)', async () => {
    const repo = new StubRepo();
    const rows = parseAnchorCsv(readFileSync(ANCHOR_CSV_PATH, 'utf8'));

    await seedQualityAnnotations(repo as never, rows);
    const changed = rows.map((row, index) => (index === 0 ? { ...row, characterSlug: 'vpt_changed' } : row));

    const result = await seedQualityAnnotations(repo as never, changed);
    expect(summarize(result)).toBe('0/1/29');
    expect(repo.rows[0]?.characterSlug).toBe('vpt_changed');
  });

  it('④ 坏清单直接抛 (表头不对 / id 不合法 / id 重复)', () => {
    expect(() => parseAnchorCsv('wrong_header,a,b\n1,2,3\n')).toThrow(/表头/);
    expect(() => parseAnchorCsv('debug_session_id,character_slug,attachment_style\n../etc/passwd,a,b\n')).toThrow(/会话 id 不合法/);
    expect(() => parseAnchorCsv('debug_session_id,character_slug,attachment_style\ndebug_a,a,secure\ndebug_a,a,secure\n')).toThrow(/重复/);
  });
});
