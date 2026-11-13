// V2026-11-04 WP41 (B 层 · 表达风格渲染接入):
//   覆盖"DB 三列 → 内核契约 → 渲染 prompt"整条通路的口径 ——
//     ① 内核契约: CharacterProfile / RenderSpec 上这 3 个字段是**可选**的 (缺省 = 不传);
//     ② 数据通路: DB 行 → 种子 → 角色基线 → 会话归属 → 规格 → prompt (端到端一行不差);
//     ③ 话量基线修正: 判据一个字没改, 只是把"话量阻抗"按基线挪一点 (中位 0.5 = 不修正);
//     ④ 叙事风格 / 语态倾向: 三档 + 四档各一行;
//     ⑤ 零回归: 没有表达风格时 prompt 逐字不变.
//
//   为什么单开一个文件 (而不是并进 wp7 那份 prompt 用例):
//     本单跨 5 层 (entity → seed → 角色基线 → 归属 → 规格 → prompt), 端到端一条链
//     才是本单的**主断言** —— 分层各测各的, 断在中间那层没人看得出来.
//     而 wp7 那份守的是"渲染层的零回归", 两者口径不同, 混在一起会互相盖住.
//
//   关于话量基线的断言口径 (为什么用"档位边界平移"而不是"乘系数"):
//     修正量 = (基线 - 0.5) × 0.5, 修正在**阻抗这个量**上, 于是"短"的门槛变成
//     0.55 + 修正量、"长"的门槛变成 0.3 + 修正量 —— 即整条档位阶梯随基线平移.
//     用例直接断言"同一份阻抗, 基线不同 → 档位不同", 不去复算内部公式.
//
//   验证: npx vitest run test/engine-adapters/wp41-expression-style-rendering.spec.ts
//   时间戳: 2026-11-04 GMT+8

import { describe, expect, it, vi } from 'vitest';

import { buildCharacterProfileRow } from './character-profile-fixtures.js';
import type { AdaptiveRenderSpec } from '../../src/engine-adapters/rendering/render-risk.js';
import { buildRenderSpec } from '../../src/engine-adapters/rendering/spec-assembler.js';
import { buildVisitorMessages } from '../../src/engine-adapters/rendering/turn-render-orchestrator.js';
import { buildCharacterProfile } from '../../src/engine-adapters/wiring/character/builtin-character-registry.js';
import type { CharacterProfileEntity } from '../../src/engine-adapters/wiring/character/character-profile.entity.js';
import { toCharacterSeed } from '../../src/engine-adapters/wiring/character/db-character-profile.resolver.js';
import { createEmptyBdiSnapshot, type EngineTurnOutput, type RenderTokenBudget } from '../../src/engine-core/index.js';

// TD-10 · T-2: 真实 ioredis 不进 import 阶段 (适配层仍是真实现; 替身口径见 test/helpers/sdk-stubs.ts).
vi.mock('ioredis', async () => {
  const { createIoredisStub } = await import('../helpers/sdk-stubs.js');
  return createIoredisStub();
});

const BUDGET: RenderTokenBudget = { maxCompletionTokens: 160, contextTokens: 512 };

/**
 * 造一份完全可控的渲染规格.
 *
 * 为什么显式给全 (情绪 / 阻抗 / 信任): 断言"话量基线把档位挪了"时, 判定口径里
 * **只能**有阻抗这一个变量 —— 信任低与策略是回避也会判"短", 混进来就分不清是谁
 * 判的.
 */
function buildSpec(overrides: Partial<AdaptiveRenderSpec> = {}): AdaptiveRenderSpec {
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

/** 取 prompt 里的"这一轮怎么说"块. */
function howToSayLines(prompt: string): string[] {
  const lines = prompt.split('\n');
  const start = lines.indexOf('这一轮怎么说：');
  if (start === -1) return [];
  const end = lines.indexOf('说完一两句就停下来，把话头交还给咨询师 —— 真人对话不是独白。');
  return lines.slice(start + 1, end === -1 ? lines.length : end);
}

/** 话量档位指令行 (短 / 中 / 长 三档之一). */
function verbosityInstruction(prompt: string): string {
  return howToSayLines(prompt)[0] ?? '';
}

/**
 * 从 prompt 里**整块**去掉"你说话一贯的样子"那一块 (含它前面那个空行).
 *
 * 为什么连空行一起去: 那一块在 prompt 里是"空行 + 块头 + 内容行", 而缺省版在同一个
 * 位置只有"空行 + 下一段". 不把空行一起扣掉, 扣完就多出一个空行 —— 那就不是
 * "只多了这一块"了.
 */
function stripExpressionStyleBlock(prompt: string): string {
  const lines = prompt.split('\n');
  const headerIdx = lines.findIndex((line) => line.startsWith('你说话一贯的样子'));
  if (headerIdx === -1) return prompt;
  // 块内容到下一个空行为止 (块头 + 若干内容行).
  let end = headerIdx;
  while (end + 1 < lines.length && lines[end + 1] !== '') end += 1;
  return lines.filter((_, index) => index < headerIdx - 1 || index > end).join('\n');
}

/** 渲染整段 system prompt. */
function promptOf(spec: AdaptiveRenderSpec): string {
  return (buildVisitorMessages(spec)[0]?.content ?? '') as string;
}

/** 造一行 DB 角色 (表达风格三列有值). */
function buildRow(overrides: Partial<CharacterProfileEntity> = {}): CharacterProfileEntity {
  // 默认值来自共享夹具 (character-profile-fixtures.ts) —— 本组用例只覆盖表达风格相关的列.
  return buildCharacterProfileRow({
    id: 'row-1',
    templateId: 'vpt_test_l1',
    displayName: '测试角色',
    attachmentStyle: 'avoidant',
    baselineTrust: 0.3,
    baselineSafety: 0.25,
    baselineBond: 0.05,
    baselineResistanceVerbal: 0.62,
    baselineResistanceDepth: 0.68,
    baselineResistanceStyle: 0.6,
    baselineEmotionValence: -0.55,
    baselineEmotionArousal: 0.18,
    speechVolumeBaseline: 0.8,
    narrativeStyle: 'structured',
    expressionTone: 'intellectualizing',
    auditStatus: 'approved',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  });
}

/** 构造内核一轮出参. */
function buildOutput(overrides: Partial<EngineTurnOutput> = {}): EngineTurnOutput {
  return {
    reply: '',
    snapshot: createEmptyBdiSnapshot(),
    turnIndex: 1,
    ...overrides,
  };
}

describe('WP41 · 表达风格渲染接入', () => {
  describe('① 内核契约 (三个可选字段)', () => {
    it('角色基线: 种子给了就带, 没给就**键都不存在** (条件展开)', () => {
      const withStyle = buildCharacterProfile(toCharacterSeed(buildRow()));
      expect(withStyle.speechVolumeBaseline).toBe(0.8);
      expect(withStyle.narrativeStyle).toBe('structured');
      expect(withStyle.expressionTone).toBe('intellectualizing');

      // 种子没说 → 键不存在 (不是 undefined) —— "没说"与"说了 undefined"要分得开.
      const seed = toCharacterSeed(buildRow());
      const withoutStyle = buildCharacterProfile({
        ...seed,
        speechVolumeBaseline: undefined,
        narrativeStyle: undefined,
        expressionTone: undefined,
      });
      expect('speechVolumeBaseline' in withoutStyle).toBe(false);
      expect('narrativeStyle' in withoutStyle).toBe(false);
      expect('expressionTone' in withoutStyle).toBe(false);
    });

    it('渲染规格: 没传表达风格 → 规格里**不带**这三个键 (零回归)', () => {
      const spec = buildRenderSpec({ output: buildOutput(), recentTurns: [], tokenBudget: BUDGET });

      expect('speechVolumeBaseline' in spec).toBe(false);
      expect('narrativeStyle' in spec).toBe(false);
      expect('expressionTone' in spec).toBe(false);
    });

    it('渲染规格: 传了就原样带进去', () => {
      const spec = buildRenderSpec({
        output: buildOutput(),
        recentTurns: [],
        tokenBudget: BUDGET,
        speechVolumeBaseline: 0.8,
        narrativeStyle: 'structured',
        expressionTone: 'intellectualizing',
      });

      expect(spec.speechVolumeBaseline).toBe(0.8);
      expect(spec.narrativeStyle).toBe('structured');
      expect(spec.expressionTone).toBe('intellectualizing');
    });
  });

  describe('② 数据通路 (DB 行 → 种子 → 角色基线)', () => {
    it('DB 列是 NOT NULL DEFAULT → resolver **直接传**, 不做条件展开', () => {
      const seed = toCharacterSeed(buildRow({ speechVolumeBaseline: 0.5, narrativeStyle: 'mixed', expressionTone: 'restrained' }));

      expect(seed.speechVolumeBaseline).toBe(0.5);
      expect(seed.narrativeStyle).toBe('mixed');
      expect(seed.expressionTone).toBe('restrained');
      // 键存在 (不是 undefined) —— "恒有值"在数据源上成立, 所以不需要条件分支.
      expect('speechVolumeBaseline' in seed).toBe(true);
    });

    it('端到端: DB 行 → 角色基线 → 规格 → prompt, 叙事 / 语态两行都在', () => {
      const profile = buildCharacterProfile(toCharacterSeed(buildRow()));

      const spec = buildRenderSpec({
        output: buildOutput(),
        recentTurns: [],
        tokenBudget: BUDGET,
        speechVolumeBaseline: profile.speechVolumeBaseline,
        narrativeStyle: profile.narrativeStyle,
        expressionTone: profile.expressionTone,
      });
      const prompt = promptOf(spec);

      expect(prompt).toContain('你说话一贯的样子');
      expect(prompt).toContain('说话要有条理：先说清楚发生了什么，再说自己的感受，不用东一句西一句。');
      expect(prompt).toContain('习惯用道理代替感受：说到自己的事会讲分析，很少直接说感受。');
    });
  });

  describe('③ 话量基线修正', () => {
    it('话量基线 0.5 (中位) → 不修正, 档位与没给基线时**逐字一致**', () => {
      const withoutBaseline = promptOf(buildSpec({ resistance: { verbal: 0.65, depth: 0.4, style: 0.35 } }));
      const withMidBaseline = promptOf(buildSpec({ resistance: { verbal: 0.65, depth: 0.4, style: 0.35 }, speechVolumeBaseline: 0.5 }));

      expect(verbosityInstruction(withMidBaseline)).toBe(verbosityInstruction(withoutBaseline));
      expect(verbosityInstruction(withoutBaseline)).toContain('这轮你不太想多说');
    });

    it('天生话多 (基线 0.8): 同样的阻抗判不到"短"', () => {
      const resistance = { verbal: 0.65, depth: 0.4, style: 0.35 };

      const withoutBaseline = verbosityInstruction(promptOf(buildSpec({ resistance })));
      const withBaseline = verbosityInstruction(promptOf(buildSpec({ resistance, speechVolumeBaseline: 0.8 })));

      // 没有基线: 阻抗 0.65 >= 0.55 → 短.
      expect(withoutBaseline).toContain('这轮你不太想多说');
      // 基线 0.8 → 阻抗被"看低" 0.15 → 判不到短.
      expect(withBaseline).not.toContain('这轮你不太想多说');
    });

    it('天生话少 (基线 0.3): 同样的阻抗就判"短"', () => {
      const resistance = { verbal: 0.5, depth: 0.4, style: 0.35 };

      const withoutBaseline = verbosityInstruction(promptOf(buildSpec({ resistance })));
      const withBaseline = verbosityInstruction(promptOf(buildSpec({ resistance, speechVolumeBaseline: 0.3 })));

      // 没有基线: 阻抗 0.5 < 0.55 → 中.
      expect(withoutBaseline).toContain('这轮你按平时的样子说话');
      // 基线 0.3 → 阻抗被"看高" 0.1 → 0.60 >= 0.55 → 短.
      expect(withBaseline).toContain('这轮你不太想多说');
    });

    it('天生话多 (基线 0.8): 探索策略下更容易判"长"', () => {
      const intention = {
        strategy: 'cognitive_exploration' as const,
        emotion: { label: 'neutral' as const, valence: 0, arousal: 0.3 },
        resistance: { verbal: 0.4, depth: 0.4, style: 0.35 },
        transference: { positive: 0, negative: 0, dependency: 0 },
        forbiddenBehaviors: [],
      };

      const withoutBaseline = verbosityInstruction(promptOf(buildSpec({ intention, resistance: intention.resistance, trust: 0.7 })));
      const withBaseline = verbosityInstruction(
        promptOf(buildSpec({ intention, resistance: intention.resistance, trust: 0.7, speechVolumeBaseline: 0.8 })),
      );

      // 没有基线: 阻抗 0.4 > 0.3 → 中.
      expect(withoutBaseline).toContain('这轮你按平时的样子说话');
      // 基线 0.8 → 阻抗被"看低" 0.15 → 0.25 <= 0.3 → 长.
      expect(withBaseline).toContain('这轮你愿意多说一点');
    });

    it('基线**不参与**信任与策略的判定 (低信任仍然判"短")', () => {
      const spec = buildSpec({ trust: 0.2, resistance: { verbal: 0.4, depth: 0.4, style: 0.35 }, speechVolumeBaseline: 0.8 });

      expect(verbosityInstruction(promptOf(spec))).toContain('这轮你不太想多说');
    });

    it('脏值 (非有限数) 按"没表态"处理, 不改判定', () => {
      const spec = buildSpec({ resistance: { verbal: 0.65, depth: 0.4, style: 0.35 }, speechVolumeBaseline: Number.NaN });

      expect(verbosityInstruction(promptOf(spec))).toContain('这轮你不太想多说');
    });
  });

  describe('④ 叙事风格 / 语态倾向渲染', () => {
    it('叙事风格三档各渲染一行', () => {
      const expected: Readonly<Record<string, string>> = {
        structured: '说话要有条理：先说清楚发生了什么，再说自己的感受，不用东一句西一句。',
        disorganized: '说话东一句西一句：想到哪说到哪，不用刻意把话理顺。',
        mixed: '说话有时有条理、有时会跳开一点：不用刻意保持一致。',
      };

      for (const [style, instruction] of Object.entries(expected)) {
        const prompt = promptOf(buildSpec({ narrativeStyle: style as 'structured' }));
        expect(prompt).toContain(instruction);
      }
    });

    it('语态倾向四档各渲染一行', () => {
      const expected: Readonly<Record<string, string>> = {
        restrained: '情绪不外露：即使有感受也说得淡淡的，不轻易激动。',
        emotional: '情绪容易外露：话里情绪重，容易一下子激动起来。',
        intellectualizing: '习惯用道理代替感受：说到自己的事会讲分析，很少直接说感受。',
        passive_aggressive: '说话带刺：表面顺着说，实际有点抵触，偶尔阴阳两句。',
      };

      for (const [tone, instruction] of Object.entries(expected)) {
        const prompt = promptOf(buildSpec({ expressionTone: tone as 'restrained' }));
        expect(prompt).toContain(instruction);
      }
    });

    it('只给叙事风格 → 只渲染叙事那一行; 只给语态 → 只渲染语态那一行', () => {
      const narrativeOnly = promptOf(buildSpec({ narrativeStyle: 'structured' }));
      expect(narrativeOnly).toContain('说话要有条理');
      expect(narrativeOnly).not.toContain('情绪不外露');

      const toneOnly = promptOf(buildSpec({ expressionTone: 'emotional' }));
      expect(toneOnly).toContain('情绪容易外露');
      expect(toneOnly).not.toContain('说话要有条理');
    });

    it('这一块与"内在状态"块**分开** (一贯的样子 ≠ 此刻的状态)', () => {
      const prompt = promptOf(buildSpec({ narrativeStyle: 'structured', expressionTone: 'restrained' }));

      const stateIdx = prompt.indexOf('你此刻的内在状态');
      const styleIdx = prompt.indexOf('你说话一贯的样子');
      const howToSayIdx = prompt.indexOf('这一轮怎么说：');

      expect(stateIdx).toBeGreaterThanOrEqual(0);
      expect(styleIdx).toBeGreaterThan(stateIdx);
      expect(howToSayIdx).toBeGreaterThan(styleIdx);
    });
  });

  describe('⑤ 零回归', () => {
    it('没有表达风格 → prompt 逐字不变 (双向断言)', () => {
      const withoutStyle = promptOf(buildSpec());
      const withStyle = promptOf(buildSpec({ narrativeStyle: 'structured', expressionTone: 'restrained' }));

      // 没有表达风格 → 这一块整个不出现.
      expect(withoutStyle).not.toContain('你说话一贯的样子');
      expect(withoutStyle).not.toContain('说话要有条理');
      expect(withoutStyle).not.toContain('情绪不外露');
      // 有表达风格的版本减去这一块 == 没有的版本 —— 证明只多了这一块, 别处一个字没动.
      expect(stripExpressionStyleBlock(withStyle)).toBe(withoutStyle);
    });

    it('没有话量基线 → 话量判定与 WP35 逐字一致', () => {
      const resistance = { verbal: 0.8, depth: 0.4, style: 0.35 };
      const spec = buildSpec({ resistance });

      expect(verbosityInstruction(promptOf(spec))).toContain('这轮你不太想多说');
    });
  });
});
