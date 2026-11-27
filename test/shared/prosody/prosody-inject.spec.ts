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
      expect(result.speechText).toMatch(/^(嗯，|呃，|我想想，|其实，|就是，|这么说吧，)/);
      expect(result.speechText).not.toMatch(/^那个，/);
    }
  });

  it('AF-565: 同一场相邻两轮的填充词不撞同一个', () => {
    const sentence = '我最近，工作压力挺大的，晚上也睡不好。';
    let compared = 0;
    for (let index = 0; index < 120 && compared === 0; index += 1) {
      const sessionId = `rotate-${index}`;
      const firstPlan = buildProsodyPlan({ enabled: true, sessionId, turnIndex: 1, style: 'cooperative' });
      const secondPlan = buildProsodyPlan({ enabled: true, sessionId, turnIndex: 2, style: 'cooperative' });
      const first = applyProsodyToSentence(sentence, firstPlan, {
        sentenceIndex: 0,
        appliedEvents: 0,
        lastEventSentenceIndex: -1,
      });
      const second = applyProsodyToSentence(sentence, secondPlan, {
        sentenceIndex: 0,
        appliedEvents: 0,
        lastEventSentenceIndex: -1,
      });
      if (first.events[0]?.kind !== 'filler' || second.events[0]?.kind !== 'filler') continue;
      compared += 1;
      expect(first.events[0]?.text).not.toBe(second.events[0]?.text);
    }
    expect(compared).toBeGreaterThan(0);
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

describe('AF-460 · 思考段 / 长沉默 / 副语言', () => {
  /** 在多个 seed 上收集某类事件（确定性哈希下覆盖到目标事件）. */
  function collectKind(kind: string, sentence: string, sentenceIndex: number): ProsodySentenceResult[] {
    const out: ProsodySentenceResult[] = [];
    for (let index = 0; index < 120; index += 1) {
      const plan = buildProsodyPlan({ enabled: true, sessionId: `af460-${index}`, turnIndex: 2, style: 'avoidant' });
      out.push(applyProsodyToSentence(sentence, plan, { sentenceIndex, appliedEvents: 0, lastEventSentenceIndex: -1 }));
    }
    return out.filter((result) => result.events[0]?.kind === kind);
  }

  const sentence = '我最近，工作压力挺大的，晚上也睡不好。';

  it('思考段只在本轮第 0 句，且带口头语与 [beat:]', () => {
    const early = collectKind('thinking', sentence, 0);
    expect(early.length).toBeGreaterThan(0);
    for (const result of early) {
      expect(result.speechText).toMatch(/^(嗯……|呃……|我想想……|怎么说呢……).*\[beat:\d+(?:\.\d+)?\]/);
      expect(result.speechText).not.toMatch(/^那个……/);
      expect(result.displayText).toBe(sentence);
    }
    expect(collectKind('thinking', sentence, 1)).toHaveLength(0);
  });

  it('AF-565: 长沉默从第 2 句起、时长在 medium 区间、只挂在句末', () => {
    const later = collectKind('silence', sentence, 2);
    expect(later.length).toBeGreaterThan(0);
    for (const result of later) {
      expect(result.speechText).toMatch(/\[silence:\d+(?:\.\d+)?\]$/);
      const ms = result.events[0]?.durationMs ?? 0;
      expect(ms).toBeGreaterThanOrEqual(2000);
      expect(ms).toBeLessThanOrEqual(3500);
      expect(result.displayText).toBe(sentence);
    }
    expect(collectKind('silence', sentence, 0)).toHaveLength(0);
  });

  it('AF-565: 长沉默只静默前半段，后半段用隐藏思考声接住', () => {
    const later = collectKind('silence', sentence, 2);
    expect(later.length).toBeGreaterThan(0);
    for (const result of later) {
      const event = result.events[0];
      expect(event?.kind).toBe('silence');
      const lead = event?.leadMs ?? 0;
      expect(lead).toBeGreaterThanOrEqual(900);
      expect(lead).toBeLessThanOrEqual(1600);
      expect(lead).toBeLessThan(event?.durationMs ?? 0);
      expect(event?.thinkingText).toMatch(/^(嗯……|呃……|我想想……)$/);
      // 思考声只挂在事件上，不污染字幕/展示正文.
      expect(result.displayText).toBe(sentence);
      expect(result.speechText).not.toContain(event?.thinkingText ?? '');
    }
  });

  it('副语言只在 medium 句首，且不污染展示正文', () => {
    const results = collectKind('breath', sentence, 1).concat(collectKind('sigh', sentence, 1));
    expect(results.length).toBeGreaterThan(0);
    for (const result of results) {
      expect(result.speechText).toMatch(/^\[(breath|sigh)\]/);
      expect(result.displayText).toBe(sentence);
    }
  });

  it('light 档不打开长沉默/副语言', () => {
    const plan = buildProsodyPlan({ enabled: true, sessionId: 'light', turnIndex: 2, style: 'cooperative' });
    expect(plan.limits.longSilence).not.toBe(true);
    expect(plan.limits.paralinguistic).not.toBe(true);
    expect(plan.limits.longSilenceMs).toEqual([0, 0]);
  });
});
