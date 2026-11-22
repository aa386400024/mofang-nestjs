// V2026-11-10 建立 (WP-J P1d · #7 · 信息增量判据补深度约束 · 单测):
//   覆盖交付记录 §8 #7 的验收:
//     ① 访客 prompt 里含"新细节要往深处走"的方向约束;
//     ② 约束点명了**情感体验 / 认知反思**两个方向 (不是空话);
//     ③ 约束明说"只是把事情重新讲一遍不算推进" (堵住"换个说法复述"这条路);
//     ④ 零回归: 原来那句"每两三轮带一个新细节"仍在 (没被改写掉).
//
//   为什么这条值得单测 (而不是只改文案):
//     WP-J P1c 实测发现, 光有"带出新细节"不够 —— 模型学会**换着法子复述**:
//     同口径基线对照 recounting 53.9% → 80.9%, 表层停留 85.2% → 100%.
//     这条 prompt 是那个退步的直接对策, 它一旦被误删, 没有任何别的测试会红.
//
//   验证: npx vitest run test/engine-adapters/wp-j-p1d-info-increment-depth.spec.ts
//   时间戳: 2026-11-10

import { describe, expect, it, vi } from 'vitest';

import { buildRenderSpec } from '../../src/engine-adapters/rendering/spec-assembler.js';
import { buildVisitorMessages } from '../../src/engine-adapters/rendering/turn-render-orchestrator.js';
import {
  createEmptyBdiSnapshot,
  type EngineTurnOutput,
  type Intention,
  type RenderSpec,
  type RenderTokenBudget,
} from '../../src/engine-core/index.js';

// TD-10 · T-2: 真实 ioredis 不进 import 阶段 (适配层仍是真实现; 替身口径见 test/helpers/sdk-stubs.ts).
vi.mock('ioredis', async () => {
  const { createIoredisStub } = await import('../helpers/sdk-stubs.js');
  return createIoredisStub();
});

const BUDGET: RenderTokenBudget = { maxCompletionTokens: 160, contextTokens: 512 };

/** 构造一个意图. */
function buildIntention(): Intention {
  return {
    strategy: 'recounting',
    emotion: { label: 'neutral', valence: 0, arousal: 0.3 },
    resistance: { verbal: 0.4, depth: 0.4, style: 0.35 },
    transference: { positive: 0, negative: 0, dependency: 0 },
    forbiddenBehaviors: ['judge'],
  };
}

/** 构造内核一轮出参. */
function buildOutput(): EngineTurnOutput {
  return {
    reply: '',
    snapshot: createEmptyBdiSnapshot(),
    turnIndex: 1,
    intention: buildIntention(),
  };
}

/** 取 prompt 的 system 段. */
function systemPromptOf(spec: RenderSpec): string {
  for (const message of buildVisitorMessages(spec)) {
    if (message.role === 'system') return message.content as string;
  }
  return '';
}

describe('WP-J P1d · #7 信息增量判据补深度约束', () => {
  const spec = buildRenderSpec({ output: buildOutput(), recentTurns: [], tokenBudget: BUDGET });
  const prompt = systemPromptOf(spec);

  it('① 含"新细节要往深处走"的方向约束', () => {
    expect(prompt).toContain('要往深处走');
  });

  it('② 约束点明了情感体验 / 认知反思两个方向', () => {
    expect(prompt).toContain('感受');
    expect(prompt).toContain('才发现');
  });

  it('③ 明说"只是把事情重新讲一遍不算推进" (堵住换着法子复述)', () => {
    expect(prompt).toContain('只是把事情重新讲一遍不算推进');
  });

  it('④ 零回归: 原来那句"每两三轮带一个新细节"仍在', () => {
    expect(prompt).toContain('每说两三轮');
    expect(prompt).toContain('新细节');
  });
});
