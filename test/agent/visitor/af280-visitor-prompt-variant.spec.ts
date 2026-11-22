import { describe, expect, it } from 'vitest';

import type { Persona } from '../../../src/agent/persona/domain/entities/persona.entity.js';
import { renderSystemPrompt } from '../../../src/agent/visitor/visitor.prompts.js';
import { resolveVisitorRuntime } from '../../../src/agent/visitor/visitor.runtime.js';
import type { VisitorSessionMemory } from '../../../src/agent/visitor/visitor.types.js';
import { parseVisitorPromptVariant, SEED_V5_VISITOR_CONSTRAINTS } from '../../../src/shared/realism/visitor-prompt-variants.js';

function persona(): Persona {
  return {
    id: 'p-1',
    tenantId: 'default',
    name: '来访者',
    age: 28,
    personality: '敏感',
    complaint: '最近睡不好',
    background: '长期加班',
    difficulty: 'L2',
    emotionBaseline: 'anxious_open',
    defenseLevel: 3,
    voiceId: 'voice-1',
    knowledgeRefs: [],
    isActive: true,
    createdAt: new Date(0),
    updatedAt: new Date(0),
  };
}

function memory(): VisitorSessionMemory {
  return {
    sessionId: 's-1',
    persona: persona(),
    tenantId: 'default',
    createdAt: 0,
    messages: [],
    currentEmotion: 'anxious_open',
    turnCount: 3,
    lastActiveAt: 0,
  };
}

describe('AF-281 V5 约束单一真相源', () => {
  it('旧 VisitorService 与共享模块使用同一份 V5 正文', () => {
    const prompt = renderSystemPrompt(persona(), memory(), [], 'seed-v5');
    expect(prompt).toContain(SEED_V5_VISITOR_CONSTRAINTS);
    expect(prompt.indexOf('接触防御与具体情绪')).toBeGreaterThan(prompt.indexOf('硬规则：'));
  });

  it('默认 shared 不含 V5 段落，旧链路行为不变', () => {
    const prompt = renderSystemPrompt(persona(), memory());
    expect(prompt).not.toContain('接触防御与具体情绪');
  });

  it('共享解析函数严格拒绝非法变体', () => {
    expect(parseVisitorPromptVariant(null)).toBe('shared');
    expect(parseVisitorPromptVariant('seed-v5')).toBe('seed-v5');
    expect(() => parseVisitorPromptVariant('seed-v6')).toThrow(/VISITOR_PROMPT_VARIANT/);
  });

  it('VisitorRuntime 非法变体错误保留 VisitorRuntimeConfig 前缀', () => {
    expect(() => resolveVisitorRuntime({ provider: 'minimax', promptVariant: 'seed-v6' })).toThrow(
      /VisitorRuntimeConfig: VISITOR_PROMPT_VARIANT=seed-v6 非法/,
    );
  });
});
