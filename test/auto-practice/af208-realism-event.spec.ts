// V2026-11-20 建立 (AF-208 · R2 真人度):
//   覆盖事件计划的确定性、风险轮空计划、active/off/audit 注入边界。
//
//   纯函数 + prompt 拼装；不起容器 / 不连 DB / 不调 LLM。

import { afterEach, describe, expect, it } from 'vitest';

import type { AdaptiveRenderSpec } from '../../src/engine-adapters/rendering/render-risk.js';
import { buildVisitorMessages } from '../../src/engine-adapters/rendering/turn-render-orchestrator.js';
import {
  buildRealismEventPlan,
  buildRealismEventPromptLine,
  buildVisitorRealismProfile,
  buildVisitorRealismPromptBlock,
  type VisitorRealismContext,
} from '../../src/shared/realism/index.js';

afterEach(() => {
  delete process.env['RENDER_REALISM_MODE'];
});

function setMode(mode: string | undefined): void {
  if (mode === undefined) delete process.env['RENDER_REALISM_MODE'];
  else process.env['RENDER_REALISM_MODE'] = mode;
}

function baseContext(overrides: Partial<VisitorRealismContext> = {}): VisitorRealismContext {
  return {
    attachmentStyle: 'secure',
    narrativeStyle: 'structured',
    expressionTone: 'restrained',
    trust: 0.6,
    arousal: 0.4,
    verbalResistance: 0.3,
    depthResistance: 0.3,
    styleResistance: 0.3,
    encounter: { mode: 'in_person' },
    ...overrides,
  };
}

function makeRenderSpec(encounter?: { mode?: string; channel?: string }): AdaptiveRenderSpec {
  return {
    taskKind: 'chat',
    intention: {
      strategy: 'simple_response',
      emotion: { label: 'neutral', valence: 0, arousal: 0.4 },
      resistance: { verbal: 0.3, depth: 0.3, style: 0.3 },
      transference: { positive: 0, negative: 0, dependency: 0 },
      forbiddenBehaviors: [],
    },
    emotion: { label: 'neutral', valence: 0, arousal: 0.4 },
    resistance: { verbal: 0.3, depth: 0.3, style: 0.3 },
    transference: { positive: 0, negative: 0, dependency: 0 },
    trust: 0.6,
    coreBeliefs: [],
    forbiddenBehaviors: [],
    recall: [],
    recentTurns: [],
    tokenBudget: { maxCompletionTokens: 160, contextTokens: 512 },
    ...(encounter === undefined ? {} : { encounter }),
  };
}

describe('AF-208 · 口语事件计划', () => {
  it('同输入永远得到同一份计划，且不强制发生', () => {
    const input = {
      role: 'anxious_seeker' as const,
      state: 'steady' as const,
      scene: 'in_person' as const,
      quotas: { filler: 1, pause: 1, repair: 1, trailoff: 1, repetition: 0, elongation: 0, maxEvents: 3 },
    };
    const first = buildRealismEventPlan(input);
    const second = buildRealismEventPlan(input);

    expect(second).toEqual(first);
    expect(first.maxEvents).toBe(3);
    expect(first.options.map((option) => option.kind)).toEqual(['filler', 'pause', 'repair', 'trailoff']);
    expect(first.options[0]?.token).toBe('那个');
    expect(first.options[0]?.maxCount).toBe(1);
  });

  it('风险轮计划为空：安全信息优先清楚', () => {
    const plan = buildRealismEventPlan({
      role: 'chaotic_disorganized',
      state: 'risk',
      scene: 'in_person',
      quotas: { filler: 0, pause: 0, repair: 0, trailoff: 0, repetition: 0, elongation: 0, maxEvents: 0 },
    });

    expect(plan).toEqual({ maxEvents: 0, options: [] });
    expect(buildRealismEventPromptLine(plan)).toBe('');
  });

  it('计划行带具体词与上限，不含“配额/话轮形态”这类元词', () => {
    const plan = buildRealismEventPlan({
      role: 'restrained',
      state: 'steady',
      scene: 'in_person',
      quotas: { filler: 0, pause: 1, repair: 0, trailoff: 1, repetition: 0, elongation: 0, maxEvents: 2 },
    });
    const line = buildRealismEventPromptLine(plan);

    expect(line).toContain('「……」');
    expect(line).toContain('合计最多 2 处');
    expect(line).not.toContain('配额');
    expect(line).not.toContain('话轮形态');
  });

  it('off / audit 不注入事件层；active 才注入', () => {
    setMode('off');
    const off = buildVisitorRealismPromptBlock(buildVisitorRealismProfile(baseContext(), 'off'));
    setMode('audit');
    const audit = buildVisitorRealismPromptBlock(buildVisitorRealismProfile(baseContext(), 'audit'));
    setMode('active');
    const active = buildVisitorRealismPromptBlock(buildVisitorRealismProfile(baseContext(), 'active'));

    expect(off).toBe('');
    expect(audit).toBe('');
    expect(active).toContain('事件层：');
    expect(active).toContain('口语痕迹候选');
  });

  it('prompt 端到端：默认面对面 + active 时才出现事件候选', () => {
    setMode('active');
    const prompt = (buildVisitorMessages(makeRenderSpec())[0]?.content ?? '') as string;

    expect(prompt).toContain('咨询室里面对面说话');
    expect(prompt).toContain('口语痕迹候选');
    expect(prompt).toContain('优先级：安全约束 > 本场接触方式 > 角色声音 > 话轮形态 > 不流利配额');
  });
});
