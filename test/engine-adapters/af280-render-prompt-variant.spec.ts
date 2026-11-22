import type { ConfigService } from '@nestjs/config';
import { describe, expect, it } from 'vitest';

import type { AdaptiveRenderSpec } from '../../src/engine-adapters/rendering/render-risk.js';
import { buildVisitorMessages } from '../../src/engine-adapters/rendering/turn-render-orchestrator.js';
import { RenderConfigFactory, buildEngineRenderDeps } from '../../src/engine-adapters/wiring/render-config.factory.js';
import type { RenderTokenBudget } from '../../src/engine-core/index.js';
import type { LlmRouterService } from '../../src/llm/registry/llm-router.service.js';
import { SEED_V5_VISITOR_CONSTRAINTS } from '../../src/shared/realism/visitor-prompt-variants.js';

const BUDGET: RenderTokenBudget = { maxCompletionTokens: 160, contextTokens: 512 };

function spec(): AdaptiveRenderSpec {
  return {
    taskKind: 'chat',
    intention: {
      strategy: 'recounting',
      emotion: { label: 'neutral', valence: 0, arousal: 0.3 },
      resistance: { verbal: 0.4, depth: 0.4, style: 0.35 },
      transference: { positive: 0, negative: 0, dependency: 0 },
      forbiddenBehaviors: ['judge'],
    },
    emotion: { label: 'neutral', valence: 0, arousal: 0.3 },
    resistance: { verbal: 0.4, depth: 0.4, style: 0.35 },
    transference: { positive: 0, negative: 0, dependency: 0 },
    trust: 0.3,
    coreBeliefs: [],
    forbiddenBehaviors: ['judge'],
    recall: [],
    recentTurns: [],
    tokenBudget: BUDGET,
  };
}

function systemPrompt(variant?: 'shared' | 'seed-v5'): string {
  return (buildVisitorMessages(spec(), variant)[0]?.content ?? '') as string;
}

function factoryWith(raw?: string): RenderConfigFactory {
  const config = {
    get: (key: string): string | undefined => (key === 'VISITOR_PROMPT_VARIANT' ? raw : undefined),
  } as unknown as ConfigService;
  return new RenderConfigFactory(config, {} as LlmRouterService);
}

describe('AF-281 引擎渲染 V5 prompt 变体', () => {
  it('默认 shared 与显式 shared 逐字一致，且不含 V5 段落', () => {
    const implicit = systemPrompt();
    const explicit = systemPrompt('shared');
    expect(implicit).toBe(explicit);
    expect(implicit).not.toContain('接触防御与具体情绪');
    expect(implicit).not.toContain('不配得感');
  });

  it('seed-v5 只追加共享正文，且位置在硬规则之后', () => {
    const prompt = systemPrompt('seed-v5');
    expect(prompt).toContain(SEED_V5_VISITOR_CONSTRAINTS);
    expect(prompt.indexOf('硬规则：')).toBeGreaterThan(-1);
    expect(prompt.indexOf('接触防御与具体情绪')).toBeGreaterThan(prompt.indexOf('硬规则：'));
    expect(prompt).toContain('不设计“防御—领悟—松动”的治疗性弧线');
  });

  it('空值与 shared 都解析为默认 shared', () => {
    expect(factoryWith().visitorPromptVariant()).toBe('shared');
    expect(factoryWith('  ').visitorPromptVariant()).toBe('shared');
    expect(factoryWith('shared').visitorPromptVariant()).toBe('shared');
  });

  it('seed-v5 正确解析', () => {
    expect(factoryWith('seed-v5').visitorPromptVariant()).toBe('seed-v5');
  });

  it('非法值 fail fast，错误含 key 与允许值', () => {
    expect(() => factoryWith('seed-v6').visitorPromptVariant()).toThrow(/VISITOR_PROMPT_VARIANT/);
    expect(() => factoryWith('seed-v6').visitorPromptVariant()).toThrow(/shared \/ seed-v5/);
  });

  it('shared 路径保持原 buildMessages 引用且关闭舞台说明投影', () => {
    const shared = buildEngineRenderDeps({} as never, {} as never, undefined, undefined, 'shared');
    expect(shared.buildMessages).toBe(buildVisitorMessages);
    expect(shared.stripStageDirections).toBe(false);
  });

  it('seed-v5 路径注入变体并开启舞台说明投影', () => {
    const v5 = buildEngineRenderDeps({} as never, {} as never, undefined, undefined, 'seed-v5');
    expect(v5.buildMessages).not.toBe(buildVisitorMessages);
    expect(v5.buildMessages?.(spec())[0]?.content).toContain(SEED_V5_VISITOR_CONSTRAINTS);
    expect(v5.stripStageDirections).toBe(true);
  });
});
