import { describe, expect, it } from 'vitest';

import { replaySessions } from '../../bin/af347-event-classifier-v2-replay.js';

describe('AF-349 回放统计口径', () => {
  const docs = [
    {
      id: 'synthetic-a',
      messages: [
        { role: 'counselor', text: '你觉得呢？', turnIndex: 1 },
        { role: 'visitor', text: '我不知道。', turnIndex: 1 },
        { role: 'counselor', text: '我理解你的感受。', turnIndex: 2 },
      ],
    },
    {
      id: 'synthetic-b',
      messages: [
        { role: 'counselor', text: '这件事可能让你觉得很难开口。', turnIndex: 1 },
        { role: 'counselor', text: '嗯。', turnIndex: 2 },
      ],
    },
  ];

  it('只统计 counselor 轮，并给出旧 vs v2 的翻转计数', () => {
    const stats = replaySessions(docs);
    expect(stats.sessions).toBe(2);
    expect(stats.turns).toBe(4);
    expect(stats.changedTurns).toBe(1);
    expect(stats.removedCounts['empathy']).toBe(1);
    expect(stats.diffSamples[0]?.sessionId).toBe('synthetic-a');
  });

  it('同 kind 但 strength 变化单独计数', () => {
    const stats = replaySessions(docs);
    expect(stats.strengthChangedTurns).toBe(1);
    expect(stats.v2StrengthCounts.some((entry) => entry.strength === 0.6 && entry.count === 1)).toBe(true);
  });

  it('neutral 率按 legacy 口径计算，避免把 v2 修正混进旧基线', () => {
    const stats = replaySessions(docs);
    expect(stats.neutralTurns).toBe(1);
    expect(stats.neutralRate).toBeCloseTo(0.25, 5);
  });
});
