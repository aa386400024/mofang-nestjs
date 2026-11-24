// AF-462: 旧 VisitorService 链路 — 可选语域块只在提供时出现, 缺省 prompt 不变.
import type { Persona } from '../../src/agent/persona/domain/entities/persona.entity.js';
import type { VisitorContextBlock } from '../../src/agent/visitor/visitor-context.js';
import { renderSystemPrompt } from '../../src/agent/visitor/visitor.prompts.js';
import type { VisitorSessionMemory } from '../../src/agent/visitor/visitor.types.js';
import { getVisitorSpeechRegister } from '../../src/shared/speech-register/index.js';

const PERSONA = {
  id: 'p1',
  tenantId: 't1',
  name: '测试来访',
  age: 30,
  personality: '谨慎',
  complaint: '最近睡不好',
  background: '独居，工作忙',
  emotionBaseline: 'anxious_open',
  defenseLevel: 1,
  difficulty: 'L1',
  voiceId: 'voice',
  knowledgeRefs: null,
  isActive: true,
  createdAt: new Date(0),
  updatedAt: new Date(0),
} as Persona;

const MEMORY: VisitorSessionMemory = {
  sessionId: 's1',
  persona: PERSONA,
  tenantId: 't1',
  createdAt: 0,
  messages: [],
  currentEmotion: '焦虑',
  turnCount: 1,
  lastActiveAt: 0,
};

describe('AF-462 · legacy visitor prompt', () => {
  it('没有 speechRegister 块时不出现语域段', () => {
    expect(renderSystemPrompt(PERSONA, MEMORY, [])).not.toContain('你说话的样子');
  });

  it('提供语域块时插在人格画像之后, 且不泄露角色 key', () => {
    const speechRegister = getVisitorSpeechRegister('vpt_intimate_avoidance_l1');
    const block: VisitorContextBlock = { content: '本次设定', speechRegister };
    const prompt = renderSystemPrompt(PERSONA, MEMORY, [block]);
    expect(prompt).toContain('## 你说话的样子');
    expect(prompt).toContain('只影响用词，不改内容和情绪');
    expect(prompt).not.toContain('vpt_intimate_avoidance_l1');
    expect(prompt.indexOf('## 你说话的样子')).toBeLessThan(prompt.indexOf('## 行为模式'));
  });
});
