// V2026-11-11 WP-K (分段配置指纹测试):
//   稳定性 / 分段归因 / 改内容必变 / fail-closed / 真实仓库可算.
//   全 mock 临时文件, 不起 Nest, 不连 DB.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  compareFingerprints,
  computeConfigFingerprint,
  CONFIG_SEGMENT_ORDER,
  type ConfigFingerprintSegments,
} from '../../src/auto-practice/config-fingerprint.js';
import { computePromptVersion } from '../../src/auto-practice/prompt-fingerprint.js';

/** 段 → 相对 baseDir 的文件路径 (无扩展名). */
const SEGMENT_PATHS: Readonly<Record<string, string>> = {
  stateTransition: '../engine-core/cognition/state-transition',
  alliance: '../engine-core/cognition/alliance-config',
  deltaTableConfig: '../engine-core/cognition/delta-table-config',
  lexicon: '../engine-core/domain/events/event-lexicon',
  baselines: '../engine-adapters/wiring/character/character-baseline-calibration',
  acceptance: './metrics/acceptance-thresholds',
};

interface Layout {
  readonly root: string;
  readonly baseDir: string;
}

function makeLayout(): Layout {
  const root = mkdtempSync(join(tmpdir(), 'wpk-fp-'));
  const baseDir = join(root, 'auto-practice');
  for (const relative of Object.values(SEGMENT_PATHS)) {
    const target = join(baseDir, `${relative}.ts`);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, `// seed ${relative}`, 'utf8');
  }
  return { root, baseDir };
}

function compute(baseDir: string, promptVersion = '1234567890abcdef'): ConfigFingerprintSegments {
  return computeConfigFingerprint({ promptVersion, baseDir, extension: '.ts' });
}

describe('WP-K · 分段配置指纹', () => {
  it('同输入两次计算逐段相同 (确定性)', () => {
    const layout = makeLayout();
    try {
      expect(compute(layout.baseDir)).toEqual(compute(layout.baseDir));
    } finally {
      rmSync(layout.root, { recursive: true, force: true });
    }
  });

  it('所有段都是 16 位 hex, 非 unknown', () => {
    const layout = makeLayout();
    try {
      const fp = compute(layout.baseDir);
      for (const segment of CONFIG_SEGMENT_ORDER) {
        expect(fp[segment]).toMatch(/^[0-9a-f]{16}$/);
      }
      expect(fp.combined).toMatch(/^[0-9a-f]{16}$/);
    } finally {
      rmSync(layout.root, { recursive: true, force: true });
    }
  });

  it('改某文件 → 只有对应段 + combined 变, 其余段不变', () => {
    const layout = makeLayout();
    try {
      const before = compute(layout.baseDir);
      writeFileSync(join(layout.baseDir, `${SEGMENT_PATHS.alliance}.ts`), '// changed threshold', 'utf8');
      const after = compute(layout.baseDir);
      expect(after.alliance).not.toBe(before.alliance);
      expect(after.combined).not.toBe(before.combined);
      expect(after.stateTransition).toBe(before.stateTransition);
      expect(after.lexicon).toBe(before.lexicon);
      expect(after.baselines).toBe(before.baselines);
      expect(compareFingerprints(before, after).changed).toEqual(['alliance']);
    } finally {
      rmSync(layout.root, { recursive: true, force: true });
    }
  });

  it('只改注释内容 → 该段仍必变 (文件级哈希的保守方向)', () => {
    const layout = makeLayout();
    try {
      const before = compute(layout.baseDir);
      writeFileSync(join(layout.baseDir, `${SEGMENT_PATHS.lexicon}.ts`), '// 仅加一行注释说明', 'utf8');
      const after = compute(layout.baseDir);
      expect(after.lexicon).not.toBe(before.lexicon);
    } finally {
      rmSync(layout.root, { recursive: true, force: true });
    }
  });

  it('任一段文件缺失 → 该段 unknown 且 combined unknown (fail-closed)', () => {
    const layout = makeLayout();
    try {
      const missing = join(layout.baseDir, `${SEGMENT_PATHS.baselines}.ts`);
      rmSync(missing, { force: true });
      const fp = compute(layout.baseDir);
      expect(fp.baselines).toBe('unknown');
      expect(fp.combined).toBe('unknown');
    } finally {
      rmSync(layout.root, { recursive: true, force: true });
    }
  });

  it('真实仓库: acceptance 文件已建, 所有段可算 (非 unknown)', () => {
    const fp = computeConfigFingerprint({ promptVersion: computePromptVersion() });
    expect(fp.acceptance).not.toBe('unknown');
    expect(fp.combined).not.toBe('unknown');
  });
});
