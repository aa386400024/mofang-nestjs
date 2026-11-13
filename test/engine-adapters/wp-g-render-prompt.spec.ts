// V2026-11-09 治本 (Phase2.5 WP-G · 渲染层 prompt 修复单测):
//   覆盖任务单第二波三项:
//     ⑥ VARIATION_INSTRUCTION 从"可以有一点变化"升级为硬约束 (禁止重复最近几轮句式);
//     ⑦ buildVisitorSystemPrompt() 硬规则加第 5 条 (不要重复你之前说过的句式);
//     ⑧ STRATEGY_LABEL.resistance 细化 (话少 / 不愿深入 / 转移话题).
//
//   另外钉住**零回归底线**: 缺省参数 (没登记表达风格 / 没 safety / bond / 没 recall)
//   时, prompt 里不能多出任何一行 —— 本期只改常量文案, 不动条件渲染结构.
//
//   验证: npx vitest run test/engine-adapters/wp-g-render-prompt.spec.ts

import { describe, expect, it, vi } from 'vitest';

import type { AdaptiveRenderSpec } from '../../src/engine-adapters/rendering/render-risk.js';
import { buildVisitorMessages } from '../../src/engine-adapters/rendering/turn-render-orchestrator.js';
import type { RenderTokenBudget } from '../../src/engine-core/index.js';

// TD-10 · T-2: 真实 ioredis 不进 import 阶段 (适配层仍是真实现; 替身口径见 test/helpers/sdk-stubs.ts).
vi.mock('ioredis', async () => {
  const { createIoredisStub } = await import('../helpers/sdk-stubs.js');
  return createIoredisStub();
});

const BUDGET: RenderTokenBudget = { maxCompletionTokens: 160, contextTokens: 512 };

/** 造一份**缺省**规格 (刻意不带 safety / bond / 表达风格 / recall). */
function buildBareSpec(overrides: Partial<AdaptiveRenderSpec> = {}): AdaptiveRenderSpec {
  return {
    taskKind: 'chat',
    intention: {
      strategy: 'simple_response',
      emotion: { label: 'neutral', valence: 0, arousal: 0.3 },
      resistance: { verbal: 0.4, depth: 0.4, style: 0.35 },
      transference: { positive: 0, negative: 0, dependency: 0 },
      forbiddenBehaviors: [],
    },
    emotion: { label: 'neutral', valence: 0, arousal: 0.3 },
    resistance: { verbal: 0.4, depth: 0.4, style: 0.35 },
    transference: { positive: 0, negative: 0, dependency: 0 },
    trust: 0.5,
    coreBeliefs: [],
    forbiddenBehaviors: [],
    recall: [],
    recentTurns: [],
    tokenBudget: BUDGET,
    ...overrides,
  };
}

/** 取系统提示词. */
function systemPrompt(spec: AdaptiveRenderSpec): string {
  return (buildVisitorMessages(spec)[0]?.content ?? '') as string;
}

/** 取"硬规则"块的全部条目. */
function hardRules(text: string): string[] {
  const lines = text.split('\n');
  const start = lines.indexOf('硬规则：');
  if (start === -1) return [];
  const rules: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (/^\d+\. /.test(line)) rules.push(line);
  }
  return rules;
}

describe('WP-G 改动 6 · VARIATION_INSTRUCTION 升级为硬约束', () => {
  it('prompt 里是"不要重复最近几轮用过的句式", 不再是"你可以有一点变化"', () => {
    const text = systemPrompt(buildBareSpec());

    expect(text).toContain('不要重复最近几轮用过的句式：换个角度、换个措辞表达同一个意思');
    expect(text).not.toContain('你可以有一点变化');
  });

  it('变化提示仍在"这一轮怎么说"块里, 且在硬规则之前', () => {
    const text = systemPrompt(buildBareSpec());

    expect(text.indexOf('不要重复最近几轮用过的句式')).toBeLessThan(text.indexOf('硬规则：'));
  });
});

describe('WP-G 改动 7 · 硬规则加第 5 条', () => {
  it('硬规则恰好 5 条, 第 5 条是"不要重复你之前说过的句式和表达"', () => {
    const rules = hardRules(systemPrompt(buildBareSpec()));

    expect(rules).toHaveLength(5);
    expect(rules[4]).toBe('5. 不要重复你之前说过的句式和表达，根据当前对话内容灵活组织语言。');
  });

  it('前 4 条硬规则一字未改 (只追加, 不动旧条目)', () => {
    const rules = hardRules(systemPrompt(buildBareSpec()));

    expect(rules[0]).toContain('只回应咨询师刚说的那一句');
    expect(rules[1]).toContain('不给建议');
    expect(rules[2]).toContain('一个字都不要说出来');
    expect(rules[3]).toContain('一次最多说一到三句');
  });
});

describe('WP-G 改动 8 · STRATEGY_LABEL.resistance 细化', () => {
  it('resistance 策略 → 标签带具体表现 (话少 / 不愿深入 / 转移话题)', () => {
    const text = systemPrompt(
      buildBareSpec({
        intention: {
          strategy: 'resistance',
          emotion: { label: 'neutral', valence: 0, arousal: 0.3 },
          resistance: { verbal: 0.6, depth: 0.6, style: 0.5 },
          transference: { positive: 0, negative: 0, dependency: 0 },
          forbiddenBehaviors: [],
        },
      }),
    );

    expect(text).toContain('回避与抵抗（话少、不愿深入、转移话题）');
  });
});

describe('零回归底线 · 缺省参数下不多出任何一行', () => {
  it('没有 safety / bond / recall / 表达风格 → 不渲染对应的行', () => {
    const text = systemPrompt(buildBareSpec());

    expect(text).not.toContain('安全感：');
    expect(text).not.toContain('联结感：');
    expect(text).not.toContain('你还记得这些事');
    expect(text).not.toContain('你说话一贯的样子');
  });

  it('缺省时 prompt 的块顺序不变 (说话方式 → 内在状态 → 这一轮怎么说 → 硬规则)', () => {
    const text = systemPrompt(buildBareSpec());

    expect(text.indexOf('说话方式：')).toBeLessThan(text.indexOf('你此刻的内在状态'));
    expect(text.indexOf('你此刻的内在状态')).toBeLessThan(text.indexOf('这一轮怎么说：'));
    expect(text.indexOf('这一轮怎么说：')).toBeLessThan(text.indexOf('硬规则：'));
  });
});
