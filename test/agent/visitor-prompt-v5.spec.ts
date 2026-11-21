import { describe, expect, it } from 'vitest';

import type { Persona } from '../../src/agent/persona/domain/entities/persona.entity.js';
import { renderSystemPrompt } from '../../src/agent/visitor/visitor.prompts.js';
import type { VisitorSessionMemory } from '../../src/agent/visitor/visitor.types.js';

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

describe('AF-248 V5 生产 prompt 变体', () => {
  it('默认 shared 输出不含 V5 段落，旧链路逐字不变', () => {
    const prompt = renderSystemPrompt(persona(), memory());
    expect(prompt).not.toContain('接触防御与具体情绪');
    expect(prompt).toContain('[emotion:sad]');
  });

  it('seed-v5 追加三条核心约束，但只作为行为约束，不硬枚举 emotion', () => {
    const prompt = renderSystemPrompt(persona(), memory(), [], 'seed-v5');
    expect(prompt).toContain('接触防御与具体情绪');
    expect(prompt).toContain('不配得感');
    expect(prompt).toContain('每 2 轮至少 1 轮回应咨询师');
    expect(prompt).toContain('身体感受或行为冲动');
    expect(prompt).toContain('不设计“防御—领悟—松动”的治疗性弧线');
  });

  it('V5 段落不带影子实验术语，避免生产模型混淆', () => {
    const prompt = renderSystemPrompt(persona(), memory(), [], 'seed-v5');
    expect(prompt).not.toContain('影子来访者');
    expect(prompt).not.toContain('V4');
  });
});
