// AF-427 · 行为算子 delta 台账单测
//   钉四件事：
//     ① 解析器从内核源码真取到 13 算子 × 11 维，且不把注释/属性访问里的数字当系数；
//     ② cap 镜像与内核 DEFAULT_DELTA_CAP_CONFIG 逐维一致（与 AF-422 同口径，第二份拷贝靠断言兜住）；
//     ③ 语料统计在多算子同轮、缺失 deltaDetail 时行为正确；
//     ④ 端到端台账对真实仓库跑通，零语料算子清单与覆盖缺口一致。
//   边界：真实仓库只读；夹具写系统临时目录，不碰 data/。

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { DEFAULT_DELTA_CAP_CONFIG } from '../../../src/engine-core/index.js';

import {
  CAP_BOUNDS,
  DELTA_DIMS,
  OPERATOR_ORDER,
  buildLedger,
  loadOperatorCorpusStats,
  operatorCapUsage,
  parseDeltaTable,
  renderLedgerMarkdown,
} from '../../../scripts/ops/quality/af427-operator-delta-ledger.mjs';

const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const SOURCE_TEXT = fs.readFileSync(path.join(REPO_ROOT, 'src/engine-core/cognition/state-transition.ts'), 'utf8');

// data/debug-sessions 被 .gitignore 忽略 —— CI 检出里没有语料，端到端用例必须跳过而不是红。
const CORPUS_DIR = path.join(REPO_ROOT, 'data/debug-sessions');
const HAS_CORPUS = fs.existsSync(CORPUS_DIR);

/** 造一个临时语料目录，返回目录路径。 */
function writeSyntheticSessions(sessions) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'af427-corpus-'));
  for (const [index, session] of sessions.entries()) {
    fs.writeFileSync(path.join(dir, `debug_syn_${index}.json`), JSON.stringify(session), 'utf8');
  }
  return dir;
}

describe('AF-427 · 算子 delta 台账', () => {
  it('① 解析出 13 算子 × 11 维，顺序与声明一致', () => {
    const table = parseDeltaTable(SOURCE_TEXT);
    expect(Object.keys(table)).toEqual([...OPERATOR_ORDER]);
    for (const kind of OPERATOR_ORDER) {
      expect(Object.keys(table[kind]).sort()).toEqual([...DELTA_DIMS].sort());
    }
  });

  it('① 注释与嵌套不污染系数：empathy 取 0.100 / 0.060，不是注释里的百分比', () => {
    const table = parseDeltaTable(SOURCE_TEXT);
    expect(table.empathy.trust).toBe(0.1);
    expect(table.empathy.safety).toBe(0.06);
    expect(table.empathy.bond).toBe(0.02);
  });

  it('① neutral 是 ZERO 别名，展开成全 0 的 11 维', () => {
    const table = parseDeltaTable(SOURCE_TEXT);
    expect(table.neutral).toEqual(Object.fromEntries(DELTA_DIMS.map((dim) => [dim, 0])));
  });

  it('① 缺维度 / 未知维度 / 空文本都显式抛错，不静默补 0', () => {
    expect(() => parseDeltaTable('')).toThrow(/源码文本为空/);

    const sourceWithMissingDim = `const DELTA_TABLE: X = {
  empathy: {
    trust: 0.1,
    safety: 0.2,
  },
};`;
    expect(() => parseDeltaTable(sourceWithMissingDim)).toThrow(/缺维度/);

    const sourceWithUnknownDim = `const DELTA_TABLE: X = {
  empathy: {
    ${DELTA_DIMS.map((dim) => `${dim}: 0`).join(',\n    ')},
    mystery: 0.5,
  },
};`;
    expect(() => parseDeltaTable(sourceWithUnknownDim)).toThrow(/未知维度 mystery/);
  });

  it('② cap 镜像与内核 DEFAULT_DELTA_CAP_CONFIG 逐维一致', () => {
    for (const [dim, bounds] of Object.entries(DEFAULT_DELTA_CAP_CONFIG)) {
      expect(CAP_BOUNDS[dim]).toEqual({ up: bounds.up, down: bounds.down });
    }
    expect(Object.keys(CAP_BOUNDS).sort()).toEqual(Object.keys(DEFAULT_DELTA_CAP_CONFIG).sort());
  });

  it('② cap 占用取绝对值最大维：empathy=50% trust、boundary_cross=75% style、neutral=0', () => {
    const usage = operatorCapUsage(parseDeltaTable(SOURCE_TEXT));
    expect(usage.empathy.max).toBeCloseTo(0.5, 4);
    expect(usage.empathy.maxDim).toBe('trust');
    expect(usage.boundary_cross.max).toBeCloseTo(0.75, 4);
    expect(usage.boundary_cross.maxDim).toBe('style');
    expect(usage.sensitive_touch.max).toBeCloseTo(0.75, 4);
    expect(usage.sensitive_touch.maxDim).toBe('arousal');
    expect(usage.neutral.max).toBe(0);
    expect(usage.neutral.maxDim).toBeNull();
  });

  it('③ 语料统计：多算子同轮分别计数、无 deltaDetail 仍计命中轮、零语料算子进 uncovered', () => {
    const dir = writeSyntheticSessions([
      {
        traces: [
          {
            turnIndex: 1,
            deltaDetail: {
              trust: 0.1,
              safety: 0.06,
              bond: 0.02,
              valence: 0.03,
              arousal: -0.02,
              verbal: -0.03,
              depth: -0.02,
              style: -0.01,
              events: ['empathy'],
            },
          },
          {
            turnIndex: 2,
            deltaDetail: {
              trust: 0.2,
              safety: 0,
              bond: 0,
              valence: 0,
              arousal: 0,
              verbal: 0.1,
              depth: 0.1,
              style: 0.2,
              events: ['empathy', 'boundary_cross'],
            },
          },
          { turnIndex: 3, deltaDetail: null, delta: { trust: -0.12 } },
        ],
      },
      {
        traces: [{ turnIndex: 1, deltaDetail: { events: ['neutral'] } }],
      },
    ]);

    const stats = loadOperatorCorpusStats({ dir });
    expect(stats.sessions).toBe(2);
    expect(stats.turns).toBe(4);
    expect(stats.byOperator.empathy.turns).toBe(2);
    expect(stats.byOperator.empathy.singleEventTurns).toBe(1);
    expect(stats.byOperator.empathy.multiEventTurns).toBe(1);
    expect(stats.byOperator.boundary_cross.turns).toBe(1);
    expect(stats.byOperator.boundary_cross.singleEventTurns).toBe(0);
    expect(stats.byOperator.neutral.turns).toBe(1);
    expect(stats.byOperator.empathy.realizedMean.trust).toBeCloseTo(0.15, 6);
    // 单算子轮只取第 1 轮，多算子轮不并入，避免幅度被合并向量放大
    expect(stats.byOperator.empathy.realizedSingleMean.trust).toBeCloseTo(0.1, 6);
    expect(stats.uncovered).toContain('preaching');
    expect(stats.uncovered).toContain('holding_present');
  });

  it('④ 端到端：真实仓库解析 + 真实语料，台账结构完整', () => {
    if (!HAS_CORPUS) return; // CI 无语料（data/debug-sessions 被 gitignore），跳过
    const ledger = buildLedger({ rootDir: REPO_ROOT });
    expect(ledger.operators).toEqual([...OPERATOR_ORDER]);
    expect(ledger.dims).toEqual([...DELTA_DIMS]);
    expect(ledger.source).toBe('src/engine-core/cognition/state-transition.ts');
    expect(ledger.corpus.sessions).toBeGreaterThan(0);
    expect(ledger.corpus.turns).toBeGreaterThan(0);
    // 规则轨刻意不扩：在场两类事件在本批语料里没有命中，必须出现在零语料清单里
    expect(ledger.corpus.uncovered).toEqual(expect.arrayContaining(['holding_present', 'cold_absent']));
    expect(Object.keys(ledger.table)).toHaveLength(13);
  });

  it('④ 渲染含三张表标题与关键结论行', () => {
    if (!HAS_CORPUS) return; // 同上：渲染断言依赖真实语料覆盖数字
    const ledger = buildLedger({ rootDir: REPO_ROOT });
    const markdown = renderLedgerMarkdown(ledger);
    expect(markdown).toContain('表一 · 13 算子 × 11 维系数');
    expect(markdown).toContain('表二 · 单事件 cap 占用');
    expect(markdown).toContain('表三 · 语料覆盖');
    expect(markdown).toMatch(/\| empathy \| 50\.0% \| trust \|/);
    expect(markdown).toContain('实测/系数比');
    expect(markdown).toMatch(/\| empathy \| 34 \| 31 \| 3 \| 0\.2\d+ \| \d+\.\d% \|/);
    expect(markdown).toContain(`零语料算子=${ledger.corpus.uncovered.join(', ')}`);
  });
});
