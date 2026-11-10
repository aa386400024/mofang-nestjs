// V2026-11-10 建立 (WP-J P1d · #4 · 来访者行为词表 · 单测):
//   覆盖交付记录 §8 #4 的验收:
//     ① anxious 三维度 (求证 / 讨好 / 怕被抛弃) 都有词表, 且三组互不相同;
//     ② 四行为标签与三维度都有**规模下限** (防"以后被人清空"而无告警);
//     ③ 代表语料能命中对应维度 (词表不是摆设);
//     ④ labelOf: 命中词最多的标签; 一个都没命中 = neutral;
//     ⑤ isCoveredTurn: 四标签 ∪ 三维度 的并集覆盖;
//     ⑥ **真实语料覆盖率 ≥15%** (仓库里有基线逐字稿时实测, 跳过则不算失败).
//
//   关于 ⑥ 为什么要读真实语料:
//     覆盖率是"词表能不能把行为打出来"的**经验量**, 合成语料证明不了它.
//     所以这里直接读 data/debug-sessions 里的基线逐字稿算一遍 ——
//     没有语料时跳过 (CI 上不该因为缺数据而红).
//
//   验证: npx vitest run test/quality/p1d-visitor-quality-lexicon.spec.ts
//   时间戳: 2026-11-10

import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  ANXIOUS_CHANNEL_LEXICON,
  LABEL_LEXICON,
  anxiousDimensionsOf,
  hitsAny,
  isCoveredTurn,
  labelOf,
} from '../../scripts/ops/quality/visitor-quality-lexicon.js';

/** 基线逐字稿目录 (仓库自带; 没有就跳过覆盖率那条). */
const TRANSCRIPT_DIR = path.resolve(__dirname, '..', '..', 'data', 'debug-sessions');

/** 覆盖率下限 (任务单要求 ≥15%). */
const COVERAGE_FLOOR = 0.15;

/**
 * 读基线逐字稿里**没有降级轮**的场次的来访者台词.
 *
 * ⚠️ 为什么按"逐字稿自带 traces[].degraded"筛 (而不是查 DB):
 *   单测不该依赖 DB —— DB 口径是 runner 落库侧的事 (#5 已单独处理).
 *   这里只要一个"不含兜底句"的语料, 逐字稿自带信息就够.
 *
 * @returns 来访者台词列表 (可能为空)
 */
function loadValidVisitorTexts(): string[] {
  if (!fs.existsSync(TRANSCRIPT_DIR)) return [];
  const texts: string[] = [];
  for (const name of fs.readdirSync(TRANSCRIPT_DIR)) {
    if (!name.endsWith('.json')) continue;
    const doc = JSON.parse(fs.readFileSync(path.join(TRANSCRIPT_DIR, name), 'utf8')) as {
      messages?: { role?: string; text?: string }[];
      traces?: { degraded?: boolean }[];
    };
    const degraded = (doc.traces ?? []).some((t) => t.degraded === true);
    if (degraded) continue;
    for (const m of doc.messages ?? []) if (m.role === 'visitor') texts.push(String(m.text ?? ''));
  }
  return texts;
}

describe('WP-J P1d · #4 来访者行为词表', () => {
  describe('① 三维度词表', () => {
    it('求证 / 讨好 / 怕被抛弃 各有非空词表', () => {
      // 断言写成"列出不合规的维度" —— 失败时 diff 里能直接看到是哪一维.
      expect(Object.entries(ANXIOUS_CHANNEL_LEXICON).filter(([, words]) => words.length === 0)).toEqual([]);
    });

    it('三组词互不相同 (维度之间不能串味)', () => {
      const seek = new Set(ANXIOUS_CHANNEL_LEXICON.seekReassure);
      const appease = new Set(ANXIOUS_CHANNEL_LEXICON.appease);
      const abandon = new Set(ANXIOUS_CHANNEL_LEXICON.abandonment);
      expect([...seek].filter((w) => appease.has(w))).toEqual([]);
      expect([...seek].filter((w) => abandon.has(w))).toEqual([]);
      expect([...appease].filter((w) => abandon.has(w))).toEqual([]);
    });
  });

  describe('② 规模下限 (防"以后被人清空")', () => {
    it('四行为标签每组 ≥15 个词', () => {
      expect(Object.entries(LABEL_LEXICON).filter(([, words]) => words.length < 15)).toEqual([]);
    });

    it('anxious 三维度每组 ≥10 个词', () => {
      expect(Object.entries(ANXIOUS_CHANNEL_LEXICON).filter(([, words]) => words.length < 10)).toEqual([]);
    });
  });

  describe('③ 代表语料命中对应维度', () => {
    it('求证句命中 seekReassure', () => {
      const hits = anxiousDimensionsOf('你不会觉得我很麻烦吧');
      expect(hits.seekReassure).toBe(1);
    });

    it('讨好句命中 appease', () => {
      const hits = anxiousDimensionsOf('你忙就先忙，我没事');
      expect(hits.appease).toBe(1);
    });

    it('怕被抛弃句命中 abandonment', () => {
      const hits = anxiousDimensionsOf('你会不会不要我');
      expect(hits.abandonment).toBe(1);
    });

    it('neutral 句三个维度都不命中', () => {
      const hits = anxiousDimensionsOf('今天开会迟到了半小时');
      expect(hits.seekReassure + hits.appease + hits.abandonment).toBe(0);
    });
  });

  describe('④ labelOf', () => {
    it('命中词最多的那个标签', () => {
      expect(labelOf('我不想说，也不太想说')).toBe('avoid');
      expect(labelOf('你根本不懂我的意思')).toBe('attack');
      expect(labelOf('对不起，是我不好')).toBe('appease');
      expect(labelOf('我想跟你说说最近的事')).toBe('approach');
    });

    it('一个都没命中 = neutral', () => {
      expect(labelOf('今天开会迟到了半小时')).toBe('neutral');
    });
  });

  describe('⑤ isCoveredTurn', () => {
    it('四标签命中 → 覆盖', () => {
      expect(isCoveredTurn('我不想说')).toBe(true);
    });

    it('只有 anxious 三维度命中 → 也算覆盖', () => {
      expect(isCoveredTurn('你会不会不要我')).toBe(true);
    });

    it('都没命中 → 不覆盖', () => {
      expect(isCoveredTurn('今天开会迟到了半小时')).toBe(false);
    });
  });

  describe('⑥ 真实语料覆盖率', () => {
    const texts = loadValidVisitorTexts();

    it.skipIf(texts.length === 0)('并集覆盖率 ≥15%', () => {
      const covered = texts.filter((t) => isCoveredTurn(t)).length;
      const rate = covered / texts.length;
      expect(rate).toBeGreaterThanOrEqual(COVERAGE_FLOOR);
    });

    it('hitsAny: 命中任一即 true', () => {
      expect(hitsAny('abc', ['zzz', 'b'])).toBe(true);
      expect(hitsAny('abc', ['zzz', 'yyy'])).toBe(false);
    });
  });
});
