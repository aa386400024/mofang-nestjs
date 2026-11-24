// AF-459: 句级韵律注入的合法性与上限.
import { applyProsodyToSentence, buildProsodyPlan } from '../../../src/shared/prosody/index.js';
import type { ProsodySentenceResult, ProsodyTurnPlan } from '../../../src/shared/prosody/index.js';

/** 收集多个 seed 的结果（确定性哈希下总能覆盖到三种事件）. */
function collect(style: string, sentence: string, sentenceIndex: number): ProsodySentenceResult[] {
  const out: ProsodySentenceResult[] = [];
  for (let index = 0; index < 60; index += 1) {
    const plan = buildProsodyPlan({ enabled: true, sessionId: `seed-${index}`, turnIndex: 2, style });
    out.push(applyProsodyToSentence(sentence, plan, { sentenceIndex, appliedEvents: 0, lastEventSentenceIndex: -1 }));
  }
  return out;
}

describe('AF-459 · prosody inject', () => {
  const longSentence = '我最近，工作压力挺大的，晚上也睡不好。';

  it('off 计划逐字不改', () => {
    const plan = buildProsodyPlan({ enabled: false, sessionId: 's', turnIndex: 1 });
    const result = applyProsodyToSentence(longSentence, plan, { sentenceIndex: 0, appliedEvents: 0, lastEventSentenceIndex: -1 });
    expect(result.speechText).toBe(longSentence);
    expect(result.displayText).toBe(longSentence);
    expect(result.events).toHaveLength(0);
  });

  it('事件最多一条/句，且不会同时出现两种标记', () => {
    const results = collect('avoidant', longSentence, 0);
    for (const result of results) {
      expect(result.events.length).toBeLessThanOrEqual(1);
      if (result.speechText.includes('[pause:')) expect(result.events[0]?.kind).toBe('pause');
      if (result.events[0]?.kind === 'filler') expect(result.speechText).not.toContain('[pause:');
    }
  });

  it('思考垫只出现在本轮第 0 句句首（不会出现在后续句）', () => {
    const firstSentence = collect('avoidant', longSentence, 0).filter((result) => result.events[0]?.kind === 'filler');
    const laterSentence = collect('avoidant', longSentence, 1).filter((result) => result.events[0]?.kind === 'filler');
    expect(firstSentence.length).toBeGreaterThan(0);
    expect(laterSentence).toHaveLength(0);
    for (const result of firstSentence) {
      expect(result.speechText.startsWith('嗯，') || result.speechText.startsWith('呃，') || result.speechText.startsWith('那个，')).toBe(
        true,
      );
    }
  });

  it('停顿只落在句内次级标点之后，不在句首/句尾', () => {
    const paused = collect('avoidant', longSentence, 1).filter((result) => result.events[0]?.kind === 'pause');
    expect(paused.length).toBeGreaterThan(0);
    for (const result of paused) {
      expect(result.speechText).not.toMatch(/^\[pause:/);
      expect(result.speechText).not.toMatch(/\[pause:[^\]]+\]$/);
      expect(result.speechText).toMatch(/[，、：,;:]\[pause:/);
      // 展示正文永远不含标记
      expect(result.displayText).toBe(longSentence);
    }
  });

  it('拖音只从第 2 句起、只改句号', () => {
    const early = collect('avoidant', longSentence, 0).filter((result) => result.events[0]?.kind === 'trailoff');
    expect(early).toHaveLength(0);
    const later = collect('avoidant', longSentence, 2).filter((result) => result.events[0]?.kind === 'trailoff');
    expect(later.length).toBeGreaterThan(0);
    for (const result of later) {
      expect(result.speechText.endsWith('……')).toBe(true);
      expect(result.displayText.endsWith('。')).toBe(true);
    }
  });

  it('本轮配额用尽后不再注入', () => {
    const plan = buildProsodyPlan({ enabled: true, sessionId: 'quota', turnIndex: 1, style: 'avoidant' });
    const result = applyProsodyToSentence(longSentence, plan, {
      sentenceIndex: 0,
      appliedEvents: plan.limits.maxEventsPerTurn,
      lastEventSentenceIndex: -1,
    });
    expect(result.events).toHaveLength(0);
    expect(result.speechText).toBe(longSentence);
  });

  it('间隔约束：两次事件之间至少隔 minSentenceGap 句', () => {
    const plan: ProsodyTurnPlan = {
      level: 'medium',
      seed: 'gap#1',
      style: 'avoidant',
      limits: { maxEventsPerTurn: 9, minSentenceGap: 2, filler: true, pause: true, trailoff: true },
    };
    for (let index = 0; index < 20; index += 1) {
      const result = applyProsodyToSentence(longSentence, plan, {
        sentenceIndex: index,
        appliedEvents: 1,
        lastEventSentenceIndex: index,
      });
      expect(result.events).toHaveLength(0);
    }
  });
});
