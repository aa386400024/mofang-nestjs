// V2026-11-11 治本 (WP-N · 标注台批次化 — 批次口径纯函数单测):
//   覆盖:
//     ① 可标注判定: 四个条件逐个不满足 → false; 混合数据 → 计数正确;
//     ② 批内确定性排序: 两次排出来一样;
//     ③ 可比性守卫: 4 个 incomparableReasons 各造一组命中;
//        SMALL_SAMPLE / ENGINE_VERSION_DIRTY **只进 warnings 不进 reasons**;
//     ④ 轮级轮次解析: 合法 / 去重升序 / 非法一律 ok=false (不静默丢弃).
//
//   纯函数, 不连 DB / 不起容器.
//
//   验证: pnpm exec vitest run test/quality/quality-annotation-batch.spec.ts
//   时间戳: 2026-11-11 GMT+8

import { describe, expect, it } from 'vitest';

import {
  distinctVersions,
  evaluateComparability,
  formatBadTurns,
  isAnnotatableSession,
  isValidBatchId,
  parseBadTurns,
  sortBatchSessions,
  type BatchSessionFact,
} from '../../src/quality/quality-annotation-batch.js';
import { COMPARABILITY_REASON, COMPARABILITY_WARNING } from '../../src/quality/quality-annotation.constants.js';

/**
 * 造一场批次事实.
 *
 * @param overrides 覆盖字段
 * @returns 场次事实
 */
function makeFact(overrides: Partial<BatchSessionFact> = {}): BatchSessionFact {
  return {
    practiceSessionId: 'ps-1',
    debugSessionId: 'debug_1',
    characterSlug: 'vpt_a',
    counselorModeId: 'expert',
    turnCount: 12,
    status: 'completed',
    engineVersion: 'e3b0680-dirty',
    promptVersion: 'f1fdb4f90a5e622a',
    characterVersion: '1.0.0',
    startedAt: '2026-11-11T00:00:00.000Z',
    batchId: 'batch-1',
    ...overrides,
  };
}

describe('WP-N · 批次口径纯函数', () => {
  describe('① 可标注判定', () => {
    it('四个条件全满足 → 可标注', () => {
      expect(isAnnotatableSession(makeFact(), true)).toBe(true);
    });

    it('status 不是 completed → 不可标注', () => {
      expect(isAnnotatableSession(makeFact({ status: 'failed' }), true)).toBe(false);
    });

    it('turn_count 为 0 → 不可标注', () => {
      expect(isAnnotatableSession(makeFact({ turnCount: 0 }), true)).toBe(false);
    });

    it('debug_session_id 为空 → 不可标注', () => {
      expect(isAnnotatableSession(makeFact({ debugSessionId: '' }), true)).toBe(false);
    });

    it('逐字稿不可取 → 不可标注', () => {
      expect(isAnnotatableSession(makeFact(), false)).toBe(false);
    });

    it('混合数据 → 计数正确', () => {
      const facts = [
        makeFact({ practiceSessionId: 'a' }),
        makeFact({ practiceSessionId: 'b', status: 'failed' }),
        makeFact({ practiceSessionId: 'c', turnCount: 0 }),
        makeFact({ practiceSessionId: 'd' }),
      ];
      const count = facts.filter((fact) => isAnnotatableSession(fact, true)).length;
      expect(count).toBe(2);
    });
  });

  describe('② 批内确定性排序', () => {
    it('按 character_slug → counselor_mode_id → started_at → practice_session_id 排', () => {
      const facts = [
        makeFact({ practiceSessionId: 'z', characterSlug: 'vpt_b' }),
        makeFact({ practiceSessionId: 'y', characterSlug: 'vpt_a', counselorModeId: 'expert' }),
        makeFact({ practiceSessionId: 'x', characterSlug: 'vpt_a', counselorModeId: 'cold' }),
      ];
      const sorted = sortBatchSessions(facts);
      expect(sorted.map((fact) => fact.practiceSessionId)).toEqual(['x', 'y', 'z']);
    });

    it('同一输入排两次结果完全一样', () => {
      const facts = [
        makeFact({ practiceSessionId: 'z', characterSlug: 'vpt_b' }),
        makeFact({ practiceSessionId: 'y', characterSlug: 'vpt_a', counselorModeId: 'expert' }),
        makeFact({ practiceSessionId: 'x', characterSlug: 'vpt_a', counselorModeId: 'cold' }),
      ];
      expect(sortBatchSessions(facts)).toEqual(sortBatchSessions(facts));
    });

    it('不改动入参', () => {
      const facts = [makeFact({ practiceSessionId: 'z' }), makeFact({ practiceSessionId: 'a' })];
      const before = facts.map((fact) => fact.practiceSessionId);
      sortBatchSessions(facts);
      expect(facts.map((fact) => fact.practiceSessionId)).toEqual(before);
    });
  });

  describe('③ 可比性守卫', () => {
    it('全部条件干净 → comparable=true, 无 reason', () => {
      const verdict = evaluateComparability({
        labeled: 10,
        engineVersions: ['e3b0680'],
        promptVersions: ['f1fdb4f9'],
        missingTranscriptLabeled: 0,
      });
      expect(verdict.comparable).toBe(true);
      expect(verdict.incomparableReasons).toEqual([]);
    });

    it('engine_version 去重 > 1 → MIXED_ENGINE_VERSION', () => {
      const verdict = evaluateComparability({
        labeled: 10,
        engineVersions: ['e3b0680', 'd72c68e'],
        promptVersions: ['f1fdb4f9'],
        missingTranscriptLabeled: 0,
      });
      expect(verdict.comparable).toBe(false);
      expect(verdict.incomparableReasons).toContain(COMPARABILITY_REASON.MixedEngineVersion);
    });

    it('prompt_version 去重 > 1 → MIXED_PROMPT_VERSION', () => {
      const verdict = evaluateComparability({
        labeled: 10,
        engineVersions: ['e3b0680'],
        promptVersions: ['f1fdb4f9', '33bb150f'],
        missingTranscriptLabeled: 0,
      });
      expect(verdict.comparable).toBe(false);
      expect(verdict.incomparableReasons).toContain(COMPARABILITY_REASON.MixedPromptVersion);
    });

    it('labeled = 0 → NO_LABELED_SESSION', () => {
      const verdict = evaluateComparability({
        labeled: 0,
        engineVersions: ['e3b0680'],
        promptVersions: ['f1fdb4f9'],
        missingTranscriptLabeled: 0,
      });
      expect(verdict.comparable).toBe(false);
      expect(verdict.incomparableReasons).toContain(COMPARABILITY_REASON.NoLabeledSession);
    });

    it('已标场次有逐字稿缺失 → TRANSCRIPT_MISSING_PARTIAL', () => {
      const verdict = evaluateComparability({
        labeled: 10,
        engineVersions: ['e3b0680'],
        promptVersions: ['f1fdb4f9'],
        missingTranscriptLabeled: 1,
      });
      expect(verdict.comparable).toBe(false);
      expect(verdict.incomparableReasons).toContain(COMPARABILITY_REASON.TranscriptMissingPartial);
    });

    it('SMALL_SAMPLE 只进 warnings, 不进 reasons, 也不影响 comparable', () => {
      const verdict = evaluateComparability({
        labeled: 3,
        engineVersions: ['e3b0680'],
        promptVersions: ['f1fdb4f9'],
        missingTranscriptLabeled: 0,
      });
      expect(verdict.warnings).toContain(COMPARABILITY_WARNING.SmallSample);
      expect(verdict.incomparableReasons).not.toContain(COMPARABILITY_WARNING.SmallSample);
      expect(verdict.comparable).toBe(true);
    });

    it('ENGINE_VERSION_DIRTY 只进 warnings, 不影响 comparable', () => {
      const verdict = evaluateComparability({
        labeled: 10,
        engineVersions: ['e3b0680-dirty'],
        promptVersions: ['f1fdb4f9'],
        missingTranscriptLabeled: 0,
      });
      expect(verdict.warnings).toContain(COMPARABILITY_WARNING.EngineVersionDirty);
      expect(verdict.comparable).toBe(true);
    });

    it('版本为 null → 记成 <unknown> (不与空串混淆)', () => {
      expect(distinctVersions([null, null])).toEqual(['<unknown>']);
      expect(distinctVersions([null, 'e3b0680'])).toEqual(['<unknown>', 'e3b0680']);
    });
  });

  describe('④ 轮级轮次解析', () => {
    it('合法清单 → 去重升序', () => {
      const parsed = parseBadTurns('5,3,3,1', 12);
      expect(parsed.ok).toBe(true);
      expect(parsed.turns).toEqual([1, 3, 5]);
    });

    it('空串 → 合法 (表示清空)', () => {
      const parsed = parseBadTurns('  ', 12);
      expect(parsed.ok).toBe(true);
      expect(parsed.turns).toEqual([]);
    });

    it('非整数 → ok=false (不静默丢弃)', () => {
      expect(parseBadTurns('1,x', 12).ok).toBe(false);
    });

    it('0 或负数 → ok=false', () => {
      expect(parseBadTurns('0', 12).ok).toBe(false);
    });

    it('超出本场轮数 → ok=false', () => {
      expect(parseBadTurns('13', 12).ok).toBe(false);
    });

    it('超过 10 个 → ok=false', () => {
      const many = Array.from({ length: 11 }, (_, index) => index + 1).join(',');
      expect(parseBadTurns(many, 20).ok).toBe(false);
    });

    it('轮数未知时不做上界校验', () => {
      expect(parseBadTurns('99', null).ok).toBe(true);
    });

    it('序列化 → 逗号分隔升序; 空 → null', () => {
      expect(formatBadTurns([3, 1, 2])).toBe('1,2,3');
      expect(formatBadTurns([])).toBeNull();
    });
  });

  describe('⑤ 批次 id 形状', () => {
    it('nanoid / 人工命名批次都合法', () => {
      expect(isValidBatchId('p1d-r3-intake-2026-11-11')).toBe(true);
      expect(isValidBatchId('XhkRkyS0NFJp-4EXDQZVx')).toBe(true);
    });

    it('含路径分隔符 / 空格的非法', () => {
      expect(isValidBatchId('../etc')).toBe(false);
      expect(isValidBatchId('a b')).toBe(false);
      expect(isValidBatchId('')).toBe(false);
    });
  });
});
