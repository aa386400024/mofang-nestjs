// V2026-11-21 建立 (AF-211 · R4 批次基线):
//   只验证聚合口径与“不泄漏台词”，不绑定任何真实批次数字。

import { describe, expect, it } from 'vitest';

import {
  aggregateRealismBaseline,
  baselineCategories,
  inferRealismSceneFromPrompt,
} from '../../src/auto-practice/metrics/visitor-realism-baseline.js';

describe('AF-211 · 批次基线聚合', () => {
  const sentinel = 'SENTINEL_DO_NOT_LEAK';
  const longTurn = `${sentinel}${'这是一段很长的内容，'.repeat(30)}`;

  const baseline = aggregateRealismBaseline([
    {
      sessionId: 'session-in-person',
      scene: 'in_person',
      visitorTurns: ['（沉默）我打开聊天框看看。', '关键事件：最近工作压力大。'],
    },
    {
      sessionId: 'session-online-text',
      scene: 'online_text',
      visitorTurns: ['我打开聊天框又看了一遍。', longTurn],
    },
    {
      sessionId: 'session-empty',
      scene: 'online_voice',
      visitorTurns: [' '.repeat(3), ''],
    },
  ]);

  it('按会话与台词计数，空白台词不计入', () => {
    expect(baseline.sessions).toBe(3);
    expect(baseline.turns).toBe(4);
    expect(baseline.scenes.online_voice.turns).toBe(0);
  });

  it('硬违约按类型与场景分开统计', () => {
    expect(baseline.hardViolations).toBe(2);
    expect(baseline.byViolation).toEqual({ prompt_echo: 1, non_spoken_text: 1 });
    expect(baseline.rawAudit.hardViolations).toBe(2);
    expect(baseline.scenes.in_person).toMatchObject({ sessions: 1, turns: 2, hardViolations: 2 });
    expect(baseline.scenes.online_text).toMatchObject({ sessions: 1, turns: 2, hardViolations: 0 });
  });

  it('过长台词按共享阈值统计', () => {
    expect(baseline.tooLongTurns).toBe(1);
    expect(baseline.tooLongRatePer100Turns).toBe(25);
    expect(baseline.scenes.online_text.tooLongTurns).toBe(1);
  });

  it('报告只含数字，不含任何台词原文', () => {
    expect(JSON.stringify(baseline)).not.toContain(sentinel);
    expect(JSON.stringify(baseline)).not.toContain('聊天框');
  });

  it('分类全集与审计枚举一致', () => {
    expect(baselineCategories().violations).toEqual(['prompt_echo', 'non_spoken_text']);
    expect(baselineCategories().signals).toHaveLength(4);
  });
});

describe('AF-211 · 场景推断', () => {
  it('旧批次没有场景层时回落面对面', () => {
    expect(inferRealismSceneFromPrompt()).toBe('in_person');
    expect(inferRealismSceneFromPrompt('你正在扮演一位来访者。')).toBe('in_person');
  });

  it('只认场景层固定标记，不做语义猜测', () => {
    expect(inferRealismSceneFromPrompt('场景层：保持同步语音感：像在电话里说话。')).toBe('online_voice');
    expect(inferRealismSceneFromPrompt('场景层：保持文字咨询感：像两条短消息。')).toBe('online_text');
  });
});
