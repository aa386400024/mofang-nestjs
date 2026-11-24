// AF-450 · 台账语料分组（synthetic 标记 + kernelRef 版本指纹）单测
//   钉四件事：
//     ① scope=real 排除 synthetic 会话、scope=synthetic 只留合成会话、all 不过滤；
//     ② 分组不影响单会话内部的命中/幅度统计口径；
//     ③ kernelRef 分桶：缺指纹归 none，合成会话单独计数；
//     ④ 端到端渲染：表三只含真实会话、表三附只在有合成语料时出现、表四给出指纹分布。
//   边界：真实仓库只读；夹具写系统临时目录，不碰 data/。

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  buildLedger,
  loadCorpusStatsByKernelRef,
  loadOperatorCorpusStats,
  renderLedgerMarkdown,
} from '../../../scripts/ops/quality/af427-operator-delta-ledger.mjs';

const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const CORPUS_DIR = path.join(REPO_ROOT, 'data/debug-sessions');
const HAS_CORPUS = fs.existsSync(CORPUS_DIR);

/** 写一批夹具会话到临时目录。 */
function writeSessions(sessions) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'af450-ledger-'));
  for (const [index, session] of sessions.entries()) {
    fs.writeFileSync(path.join(dir, `debug_case_${index}.json`), JSON.stringify(session), 'utf8');
  }
  return dir;
}

/** 一个真实会话（带 kernelRef，单算子轮 empathy）。 */
const REAL_SESSION = {
  kernelRef: 'kr1-aaaaaaaaaaaaaaaa',
  traces: [{ turnIndex: 1, deltaDetail: { trust: 0.1, safety: 0.06, bond: 0.02, events: ['empathy'] } }],
};

/** 一个合成会话（无 kernelRef，两轮：boundary_cross 单算子 + neutral）。 */
const SYNTHETIC_SESSION = {
  synthetic: true,
  generationMethod: 'rule-track-scripted-replay',
  traces: [
    { turnIndex: 1, deltaDetail: { trust: -0.15, safety: -0.05, events: ['boundary_cross'] } },
    { turnIndex: 2, deltaDetail: { events: ['neutral'] } },
  ],
};

/** 另一个真实会话（另一版 kernelRef，与 REAL_SESSION 同算子）。 */
const REAL_SESSION_OTHER_KERNEL = {
  kernelRef: 'kr1-bbbbbbbbbbbbbbbb',
  traces: [{ turnIndex: 1, deltaDetail: { trust: 0.1, safety: 0.06, bond: 0.02, events: ['empathy'] } }],
};

describe('AF-450 · 台账语料分组', () => {
  it('① scope=real 排除合成会话，scope=synthetic 只留合成会话，all 全量', () => {
    const dir = writeSessions([REAL_SESSION, SYNTHETIC_SESSION, REAL_SESSION_OTHER_KERNEL]);

    const all = loadOperatorCorpusStats({ dir });
    expect(all.sessions).toBe(3);
    expect(all.turns).toBe(4);
    expect(all.scope).toBe('all');
    expect(all.realSessions).toBe(2);
    expect(all.syntheticSessions).toBe(1);

    const real = loadOperatorCorpusStats({ dir, scope: 'real' });
    expect(real.sessions).toBe(2);
    expect(real.turns).toBe(2);
    expect(real.byOperator.empathy.turns).toBe(2);
    // 合成会话里的 boundary_cross 不得混入真实口径
    expect(real.byOperator.boundary_cross.turns).toBe(0);
    expect(real.uncovered).toContain('boundary_cross');

    const synthetic = loadOperatorCorpusStats({ dir, scope: 'synthetic' });
    expect(synthetic.sessions).toBe(1);
    expect(synthetic.turns).toBe(2);
    expect(synthetic.byOperator.boundary_cross.turns).toBe(1);
    expect(synthetic.byOperator.empathy.turns).toBe(0);
    // 全量计数与 scope 无关，仍是目录里的真实 / 合成分布
    expect(synthetic.realSessions).toBe(2);
    expect(synthetic.syntheticSessions).toBe(1);
  });

  it('① 未知 scope 显式抛错，不静默退化成 all', () => {
    const dir = writeSessions([REAL_SESSION]);
    expect(() => loadOperatorCorpusStats({ dir, scope: 'bogus' })).toThrow(/未知 scope bogus/);
  });

  it('② 分组不改变幅度口径：真实口径与全量口径的 empathy 单轮幅度一致', () => {
    const dir = writeSessions([REAL_SESSION, SYNTHETIC_SESSION]);
    const all = loadOperatorCorpusStats({ dir });
    const real = loadOperatorCorpusStats({ dir, scope: 'real' });
    if (all.byOperator.empathy.turns === 0 || real.byOperator.empathy.turns === 0) {
      throw new Error('夹具没有 empathy 命中，断言无意义');
    }
    // 合成会话不含 empathy，因此两者必须完全相同
    expect(real.byOperator.empathy.realizedSingleMean).toEqual(all.byOperator.empathy.realizedSingleMean);
    expect(real.byOperator.empathy.singleEventTurns).toBe(all.byOperator.empathy.singleEventTurns);
  });

  it('③ kernelRef 分桶：版本分组、缺指纹归 none、合成会话单独计数', () => {
    const dir = writeSessions([REAL_SESSION, SYNTHETIC_SESSION, REAL_SESSION_OTHER_KERNEL]);
    const { byKernelRef, totalSessions } = loadCorpusStatsByKernelRef({ dir });

    expect(totalSessions).toBe(3);
    expect(Object.keys(byKernelRef).sort()).toEqual(['kr1-aaaaaaaaaaaaaaaa', 'kr1-bbbbbbbbbbbbbbbb', 'none'].sort());
    expect(byKernelRef['kr1-aaaaaaaaaaaaaaaa']).toEqual({ sessions: 1, turns: 1, syntheticSessions: 0 });
    expect(byKernelRef['kr1-bbbbbbbbbbbbbbbb']).toEqual({ sessions: 1, turns: 1, syntheticSessions: 0 });
    expect(byKernelRef.none).toEqual({ sessions: 1, turns: 2, syntheticSessions: 1 });
  });

  it('③ kernelRef 为空白字符串时同样归 none，不造出空键', () => {
    const dir = writeSessions([{ ...REAL_SESSION, kernelRef: '   ' }]);
    const { byKernelRef } = loadCorpusStatsByKernelRef({ dir });
    expect(Object.keys(byKernelRef)).toEqual(['none']);
  });

  it('④ 端到端：真实仓库渲染出表三 / 表三附 / 表四，且表三只算真实会话', () => {
    if (!HAS_CORPUS) return; // CI 无语料（data/debug-sessions 被 gitignore），跳过
    const ledger = buildLedger({ rootDir: REPO_ROOT });
    expect(ledger.updatedBy).toBe('AF-450');
    expect(ledger.corpus.scope).toBe('real');
    expect(ledger.corpus.sessions).toBeLessThanOrEqual(ledger.kernelRefDistribution.totalSessions);

    const markdown = renderLedgerMarkdown(ledger);
    expect(markdown).toContain(`表三 · 语料覆盖（${ledger.corpus.sessions} 场真实 debug 会话）`);
    expect(markdown).toContain('表四 · 语料 kernelRef 分布');
    expect(markdown).toContain(`语料总数=${ledger.kernelRefDistribution.totalSessions}`);
    if (ledger.syntheticCorpus.sessions > 0) {
      expect(markdown).toContain('表三附 · 合成语料覆盖');
    }
  });
});
