// V2026-11-11 (P1e Phase3 · visitor prompt 语义标记迁移 — 单测):
//   目的: 钉死 "prompt 只教语义标记, 厂商标记零残留" 这条红线 ——
//     ① **渲染出的 prompt 全文**不含任何厂商标记形态 (sighs/laughs/...) 或 <#0.5#>;
//     ② 三档难度都只教语义标记, 且**频率纪律与难度分层一字未动**;
//     ③ 停顿纪律段与情绪纪律段在, 且关键约束 (句中/一轮一个/白名单 7 值) 都在;
//     ④ snippet 白名单内每个标记 parser 都能认领 (认领清单见 §三).
//
//   为什么断言"渲染结果"而不是"文件文本":
//     文件里有历史注释 (记录 WP34 收敛白名单的依据) —— 那是**源码说明**,
//     不是给模型看的 prompt. 红线是"模型不能学到厂商标记", 所以断言的对象
//     必须是真正发给模型的字符串.
//
//   边界: 纯文本渲染, 零 IO / 零 LLM / 零 DB.
//
//   验证: pnpm exec vitest run test/agent/visitor-prompt-semantic-tags.spec.ts

import { describe, expect, it } from 'vitest';

import type { Persona, PersonaDifficulty } from '../../src/agent/persona/domain/entities/persona.entity.js';
import { renderSystemPrompt } from '../../src/agent/visitor/visitor.prompts.js';
import type { VisitorSessionMemory } from '../../src/agent/visitor/visitor.types.js';

/** 造一个最小 persona (只需 prompt 渲染用到的字段). */
function personaOf(difficulty: PersonaDifficulty): Persona {
  return {
    id: 'p-1',
    tenantId: 'default',
    name: '来访者',
    age: 28,
    personality: '敏感',
    complaint: '最近睡不好',
    background: '长期加班',
    difficulty,
    emotionBaseline: 'anxious_open',
    defenseLevel: 2,
    voiceId: 'voice-1',
    knowledgeRefs: [],
    isActive: true,
    createdAt: new Date(0),
    updatedAt: new Date(0),
  };
}

/** 造一份最小 session memory. */
function memoryOf(difficulty: PersonaDifficulty): VisitorSessionMemory {
  return {
    sessionId: 's-1',
    persona: personaOf(difficulty),
    tenantId: 'default',
    createdAt: 0,
    messages: [],
    currentEmotion: 'anxious_open',
    turnCount: 3,
    lastActiveAt: 0,
  };
}

/** 厂商标记形态 (括号词) —— prompt 里一个都不该有. */
const VENDOR_MARKERS = [
  '(sighs)',
  '(breath)',
  '(laughs)',
  '(chuckle)',
  '(sniffs)',
  '(humming)',
  '(emm)',
  '(coughs)',
  '(gasps)',
  '(pant)',
  '(exhale)',
  '(hissing)',
  '(sneezes)',
  '(snorts)',
  '(burps)',
  '(groans)',
  '(lip-smacking)',
  '(clear-throat)',
] as const;

/** 厂商停顿格式 —— prompt 里一个都不该有. */
const VENDOR_PAUSE = /<#[0-9.]+#>/;

const DIFFICULTIES: readonly PersonaDifficulty[] = ['L1', 'L2', 'L3'];

describe('P1e Phase3 · visitor prompt 语义标记迁移', () => {
  describe('① 红线: 渲染出的 prompt 不含厂商标记', () => {
    it('三档难度的 prompt 全文都不含任何厂商括号标记', () => {
      for (const difficulty of DIFFICULTIES) {
        const prompt = renderSystemPrompt(personaOf(difficulty), memoryOf(difficulty));
        for (const marker of VENDOR_MARKERS) {
          expect(prompt, `${difficulty} 的 prompt 不该含厂商标记 ${marker}`).not.toContain(marker);
        }
      }
    });

    it('三档难度的 prompt 全文都不含厂商停顿格式', () => {
      for (const difficulty of DIFFICULTIES) {
        const prompt = renderSystemPrompt(personaOf(difficulty), memoryOf(difficulty));
        expect(VENDOR_PAUSE.test(prompt)).toBe(false);
      }
    });

    it('厂商标记不出现在任何位置 (含难度描述段与情绪段)', () => {
      const prompt = renderSystemPrompt(personaOf('L1'), memoryOf('L1'));
      // 半角括号紧跟小写词 = 厂商标记形态; 语义标记用方括号.
      expect(prompt).not.toMatch(/\([a-z][a-z-]+\)/);
    });
  });

  describe('② 三档只教语义标记, 频率纪律与难度分层未动', () => {
    it('L1 教 [sigh] [breath] [laugh], 且保留每 2-3 轮至少一个纪律', () => {
      const prompt = renderSystemPrompt(personaOf('L1'), memoryOf('L1'));
      expect(prompt).toContain('[sigh] [breath] [laugh]');
      expect(prompt).toContain('每 2-3 轮至少出现一个 tag');
    });

    it('L2 教 [sigh] [breath], 且保留偶尔压抑不住流露一个 [sigh] 纪律', () => {
      const prompt = renderSystemPrompt(personaOf('L2'), memoryOf('L2'));
      expect(prompt).toContain('[sigh] [breath]');
      expect(prompt).toContain('偶尔压抑不住流露一个 [sigh]');
    });

    it('L3 教 [sigh] [emm], 且保留最多 5-8 轮一个纪律', () => {
      const prompt = renderSystemPrompt(personaOf('L3'), memoryOf('L3'));
      expect(prompt).toContain('[sigh] [emm]');
      expect(prompt).toContain('最多 5-8 轮一个');
    });

    it('三档互斥: 每档只出现自己那档的推荐标记集', () => {
      const l1 = renderSystemPrompt(personaOf('L1'), memoryOf('L1'));
      const l3 = renderSystemPrompt(personaOf('L3'), memoryOf('L3'));
      expect(l1).toContain('[laugh]');
      expect(l1).not.toContain('[sigh] [emm]');
      expect(l3).toContain('[emm]');
      expect(l3).not.toContain('[sigh] [breath] [laugh]');
    });
  });

  describe('③ 停顿纪律与情绪纪律段齐备', () => {
    it('停顿段在, 且含句中 / 一轮最多 1 个 / 句尾会被丢弃三条约束', () => {
      const prompt = renderSystemPrompt(personaOf('L1'), memoryOf('L1'));
      expect(prompt).toContain('停顿标记 (可选, 谨慎使用):');
      expect(prompt).toContain('[pause:0.5]');
      expect(prompt).toContain('一轮最多 1 个');
      expect(prompt).toContain('放在**句子中间**');
      expect(prompt).toContain('放在句尾的停顿会被解析层丢弃');
    });

    it('情绪段在, 且含白名单 7 值 + 禁 neutral + 一轮一个', () => {
      const prompt = renderSystemPrompt(personaOf('L1'), memoryOf('L1'));
      expect(prompt).toContain('情绪标记 (可选, 一轮最多 1 个):');
      expect(prompt).toContain('[emotion:sad]');
      expect(prompt).toContain('happy / sad / angry / fearful / disgusted / surprised / calm');
      expect(prompt).toContain('不要写 neutral');
      expect(prompt).toContain('一轮里情绪最多出现一次');
    });

    it('两段都在 tag 频率段之后、硬规则之前 (优先级顺序不乱)', () => {
      const prompt = renderSystemPrompt(personaOf('L1'), memoryOf('L1'));
      const idxTag = prompt.indexOf('情绪 inline tag 频率');
      const idxPause = prompt.indexOf('停顿标记 (可选, 谨慎使用):');
      const idxEmotion = prompt.indexOf('情绪标记 (可选, 一轮最多 1 个):');
      const idxHard = prompt.indexOf('硬规则 (优先级最高):');
      expect(idxTag).toBeGreaterThan(-1);
      expect(idxPause).toBeGreaterThan(idxTag);
      expect(idxEmotion).toBeGreaterThan(idxPause);
      expect(idxHard).toBeGreaterThan(idxEmotion);
    });
  });

  describe('④ parser 对 snippet 白名单的认领清单', () => {
    it('snippet §五 语义标记白名单里的每个标记, 语义层都能表达', () => {
      // snippet §五: [sigh] [breath] [inhale] [emm] [laugh] [pause:x] [emotion:x]
      //   前 5 个是句首语气 (SEMANTIC_PRE_SPEECH_TAGS 全收);
      //   [pause:x] 与 [emotion:x] 是参数型标记 (parser 按名字+值解析).
      // 句首语气: 5 个都要能被 prompt 教出来 —— [sigh] [breath] [laugh] 在 L1 档,
      //   [emm] 在 L3 档 (难度分层决定推荐集, 不是每个标记每档都出现).
      const l1 = renderSystemPrompt(personaOf('L1'), memoryOf('L1'));
      const l3 = renderSystemPrompt(personaOf('L3'), memoryOf('L3'));
      expect(l1).toContain('[sigh]');
      expect(l1).toContain('[breath]');
      expect(l1).toContain('[laugh]');
      expect(l3).toContain('[sigh]');
      expect(l3).toContain('[emm]');
      // 参数型: pause 与 emotion 段各给一个范例 (跨难度通用).
      expect(l1).toContain('[pause:0.5]');
      expect(l1).toContain('[emotion:sad]');
    });

    it('情绪白名单里语义层暂不表达的 2 个值已在 prompt 里注明 (disgusted / surprised)', () => {
      // snippet §四注: disgusted / surprised 官方白名单内但语义层表达不了 —— 会丢弃 + 记 warning.
      //   prompt 仍按官方 7 值写 (避免模型学到一个会被丢的值), 但要留证.
      const prompt = renderSystemPrompt(personaOf('L1'), memoryOf('L1'));
      expect(prompt).toContain('disgusted');
      expect(prompt).toContain('surprised');
    });
  });
});
