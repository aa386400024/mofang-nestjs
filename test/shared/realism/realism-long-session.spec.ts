import { describe, expect, it } from 'vitest';

import {
  COUNSELOR_TURN_SETS,
  LONG_COUNSELOR_TURNS,
  getCounselorTurns,
  parseCounselorTurnSet,
} from '../../../src/shared/realism/realism-long-session.js';
import { REALISM_AB_COUNSELOR_TURNS } from '../../../src/shared/realism/realism-prompt-ab.js';

describe('realism-long-session', () => {
  it('固定 short / long 两个 turn set', () => {
    expect(COUNSELOR_TURN_SETS).toEqual(['short', 'long']);
  });

  it('short 逐字等于原有 6 轮', () => {
    expect(getCounselorTurns('short')).toBe(REALISM_AB_COUNSELOR_TURNS);
    expect(getCounselorTurns('short')).toHaveLength(6);
  });

  it('long 共 12 轮且前 6 轮与 short 逐字一致', () => {
    expect(LONG_COUNSELOR_TURNS).toHaveLength(12);
    expect(LONG_COUNSELOR_TURNS.slice(0, 6)).toEqual(REALISM_AB_COUNSELOR_TURNS);
  });

  it('long 的 12 轮互不重复', () => {
    expect(new Set(LONG_COUNSELOR_TURNS).size).toBe(12);
  });

  it('long 后 6 轮是 short 之外的新句子', () => {
    for (const turn of LONG_COUNSELOR_TURNS.slice(6)) {
      expect(REALISM_AB_COUNSELOR_TURNS).not.toContain(turn);
    }
  });

  it('所有轮次非空, 后 6 轮以问号结尾', () => {
    for (const turn of LONG_COUNSELOR_TURNS) {
      expect(turn.trim().length).toBeGreaterThan(0);
    }
    for (const turn of LONG_COUNSELOR_TURNS.slice(6)) {
      expect(turn.endsWith('？')).toBe(true);
    }
  });

  it('parse 默认 short, 显式 long 生效', () => {
    expect(parseCounselorTurnSet(null)).toBe('short');
    expect(parseCounselorTurnSet('  ')).toBe('short');
    expect(parseCounselorTurnSet('long')).toBe('long');
    expect(parseCounselorTurnSet('short')).toBe('short');
  });

  it('未知 turn set 抛错', () => {
    expect(() => getCounselorTurns('medium' as never)).toThrow(/未知轮次集合/);
    expect(() => parseCounselorTurnSet('medium')).toThrow(/未知轮次集合/);
  });
});
