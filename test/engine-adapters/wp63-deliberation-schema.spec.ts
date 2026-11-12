// V2026-11-05 治本 (WP63 · B 层 · 审议输出 Schema 与可解释性):
//   覆盖任务单 §6.3 的五条要求 + 若干防漂移用例:
//     1. DeliberationDim 枚举值数量正确 (11 个)
//     2. DeliberationOperatorTag 枚举值数量正确 (规则对齐 10 + LLM 独有 3)
//     3. 两个枚举与内核口径的一致性检查 (维度 = DeltaVector 的键; 对齐标签 ⊆ CounselorEventKind)
//     4. system prompt 两种模式的差异
//     5. user prompt 组装正确 (快照 JSON / 咨询师的话 / 来访的反应都在里面)
//   额外覆盖: schema 描述里的枚举清单与常量一致 / 空发言写占位不写空串 /
//             两种模式都不产出分数 (零压红线) / 硬安全维度被明确排除.
//
//   边界: 不起 Nest 容器 / 不触网 / 不调 LLM; 全部是纯函数断言.

import { describe, expect, it } from 'vitest';

import { buildTestStructuredInput } from './deliberation-fixtures.js';
import {
  buildDeliberationSchemaDescription,
  buildDeliberationSystemPrompt,
  buildDeliberationUserPrompt,
} from '../../src/engine-adapters/deliberation/deliberation-prompt.js';
import {
  DELIBERATION_DIMS,
  DELIBERATION_LLM_ONLY_TAGS,
  DELIBERATION_MAX_ABS_DELTA,
  DELIBERATION_OPERATOR_TAGS,
  DELIBERATION_REASON_MAX_CHARS,
  DELIBERATION_RULE_ALIGNED_TAGS,
  DELIBERATION_SUMMARY_MAX_CHARS,
  type DeliberationDeltaEntry,
  type DeliberationDim,
  type DeliberationOutput,
  type DeliberationOperatorTag,
} from '../../src/engine-adapters/deliberation/deliberation-types.js';
import type { CounselorEventKind, DeltaVector } from '../../src/engine-core/index.js';

/**
 * 内核 `DeltaVector` 的键 (运行时基线).
 *
 * `satisfies DeltaVector` 让这份字面量在**类型层**就是内核的 delta 形状 ——
 * 少一个键 TS 会报错, 多一个键 (excess property) 也会报错.
 * ⚠️ 注意: 闸门里的 `tsc -p tsconfig.build.json` **排除** test/ (见 tsconfig.build.json),
 *   所以这份 `satisfies` 的类型保证由 IDE / `tsc -p tsconfig.json` 兜底, 不在闸门里;
 *   闸门内的真保证是下面这条**运行时**的键集合比对 —— 两边都要有, 不能只靠一边.
 */
const DELTA_VECTOR_KEYS: readonly string[] = Object.keys({
  trust: 0,
  safety: 0,
  bond: 0,
  valence: 0,
  arousal: 0,
  verbal: 0,
  depth: 0,
  style: 0,
  positive: 0,
  negative: 0,
  dependency: 0,
} satisfies DeltaVector);

/**
 * 内核 `CounselorEventKind` 的全部取值 (运行时基线).
 *
 * 显式列出来不是为了"重新定义一遍内核枚举", 而是为了**锁住契约**:
 * 内核哪天加了新事件类型, 这条断言立刻变红 → 逼着人显式决定"审议标签要不要跟着加",
 * 而不是让审议契约在无人察觉的情况下与内核脱节.
 */
const KERNEL_EVENT_KINDS: readonly CounselorEventKind[] = [
  'empathy',
  'acceptance',
  'normalization',
  'open_probe',
  'affirmation',
  'judgment',
  'preaching',
  'minimizing',
  'boundary_cross',
  'sensitive_touch',
  'neutral',
  // V2026-11-12 (D-2): 两类**在场状态**事件进 core 联合 —— 本列表是「内核枚举的运行时基线」,
  //   不跟着改就会让下面的断言与内核脱节 (那正是这份清单存在的理由).
  'holding_present',
  'cold_absent',
];

describe('WP63 · 审议输出 Schema 与可解释性', () => {
  describe('① DeliberationDim —— 与内核 DeltaVector 逐字一致', () => {
    it('枚举值数量正确 (11 个)', () => {
      expect(DELIBERATION_DIMS).toHaveLength(11);
    });

    it('维度集合 = 内核 DeltaVector 的键集合 (不多不少)', () => {
      expect([...DELIBERATION_DIMS].sort()).toEqual([...DELTA_VECTOR_KEYS].sort());
    });

    it('每个维度都是内核 DeltaVector 的键 (逐字, 不差一个字母)', () => {
      for (const dim of DELIBERATION_DIMS) {
        expect(DELTA_VECTOR_KEYS).toContain(dim);
      }
    });

    it('维度值无重复', () => {
      expect(new Set(DELIBERATION_DIMS).size).toBe(DELIBERATION_DIMS.length);
    });
  });

  describe('② DeliberationOperatorTag —— 规则对齐 + LLM 独有', () => {
    it('规则对齐的一组 = 内核事件类型去掉 neutral 与两类在场状态事件 (10 个)', () => {
      expect(DELIBERATION_RULE_ALIGNED_TAGS).toHaveLength(10);
      expect([...DELIBERATION_RULE_ALIGNED_TAGS].sort()).toEqual(
        KERNEL_EVENT_KINDS.filter((kind) => kind !== 'neutral' && kind !== 'holding_present' && kind !== 'cold_absent')
          .slice()
          .sort(),
      );
    });

    it('D-2: 两类新 kind **刻意不在**规则对齐组 (规则轨词表不扩 → 产不出)', () => {
      // 任务单 §3.1-9 的显式决定: 规则对齐组 = 「规则算子也会打」的标签.
      //   两类新 kind 是模型轨独有的在场状态判定, 规则轨**产不出** (词表不扩),
      //   纳入本组 = 把模型独有标签误算成规则可覆盖 (风险 T6).
      expect(KERNEL_EVENT_KINDS).toContain('holding_present');
      expect(KERNEL_EVENT_KINDS).toContain('cold_absent');
      expect(DELIBERATION_RULE_ALIGNED_TAGS).not.toContain('holding_present');
      expect(DELIBERATION_RULE_ALIGNED_TAGS).not.toContain('cold_absent');
    });

    it('中性事件 (neutral) 不进标签枚举 —— 它在 DELTA_TABLE 里是全零 delta', () => {
      expect(DELIBERATION_RULE_ALIGNED_TAGS).not.toContain('neutral');
      expect(DELIBERATION_OPERATOR_TAGS).not.toContain('neutral');
    });

    it('敏感议题触碰 (sensitive_touch) **在**标签枚举里 —— 它有真实非零 delta', () => {
      // 内核 DELTA_TABLE: sensitive_touch → arousal +0.15 / safety -0.01 …
      // 漏掉它 = 规则侧能打、审议侧不能打 → 影子模式对比永远匹配不上.
      expect(DELIBERATION_RULE_ALIGNED_TAGS).toContain('sensitive_touch');
    });

    it('LLM 独有的一组 = 3 个, 且都不是内核事件类型', () => {
      expect(DELIBERATION_LLM_ONLY_TAGS).toHaveLength(3);
      for (const tag of DELIBERATION_LLM_ONLY_TAGS) {
        expect(KERNEL_EVENT_KINDS).not.toContain(tag);
      }
    });

    it('全集 = 对齐 10 + 独有 3 = 13, 且无重复', () => {
      expect(DELIBERATION_OPERATOR_TAGS).toHaveLength(13);
      expect(new Set(DELIBERATION_OPERATOR_TAGS).size).toBe(13);
      expect([...DELIBERATION_OPERATOR_TAGS].sort()).toEqual([...DELIBERATION_RULE_ALIGNED_TAGS, ...DELIBERATION_LLM_ONLY_TAGS].sort());
    });
  });

  describe('③ 两种模式的 system prompt', () => {
    it('考核模式有"严格"相关的措辞', () => {
      const prompt = buildDeliberationSystemPrompt('exam');

      expect(prompt).toContain('严格');
      expect(prompt).toContain('保守');
      expect(prompt).toContain('考核');
    });

    it('自由模式有"灵活"相关的措辞', () => {
      const prompt = buildDeliberationSystemPrompt('freeform');

      expect(prompt).toContain('灵活');
      expect(prompt).toContain('细微');
      expect(prompt).toContain('自由练习');
    });

    it('两种模式的措辞确实不同 (不是同一个模板换了个标题)', () => {
      const exam = buildDeliberationSystemPrompt('exam');
      const freeform = buildDeliberationSystemPrompt('freeform');

      expect(exam).not.toBe(freeform);
      expect(exam).not.toContain('可以更灵活');
      expect(freeform).not.toContain('判定标准更严格');
    });

    it('两种模式都声明了 11 个软状态维度', () => {
      for (const prompt of [buildDeliberationSystemPrompt('exam'), buildDeliberationSystemPrompt('freeform')]) {
        for (const dim of DELIBERATION_DIMS) {
          expect(prompt).toContain(dim);
        }
      }
    });

    it('两种模式都**禁止**输出硬安全维度 (自杀倾向 / 危机等级)', () => {
      for (const prompt of [buildDeliberationSystemPrompt('exam'), buildDeliberationSystemPrompt('freeform')]) {
        expect(prompt).toContain('硬安全维度');
        expect(prompt).toContain('自杀倾向');
        expect(prompt).toContain('危机等级');
        expect(prompt).toContain('规则引擎');
      }
    });

    it('两种模式都要求带 operatorTags + 理由 (可解释性是这层的存在理由)', () => {
      for (const prompt of [buildDeliberationSystemPrompt('exam'), buildDeliberationSystemPrompt('freeform')]) {
        expect(prompt).toContain('operatorTags');
        expect(prompt).toContain('reason');
        expect(prompt).toContain('为什么');
      }
    });

    it('两种模式都不让模型输出分数 / 评级 (零压红线)', () => {
      for (const prompt of [buildDeliberationSystemPrompt('exam'), buildDeliberationSystemPrompt('freeform')]) {
        expect(prompt).toContain('不要输出分数');
        expect(prompt).toContain('评级');
      }
    });

    it('delta 幅度上限写进了 prompt (与内核单回合 cap 同档)', () => {
      expect(buildDeliberationSystemPrompt('exam')).toContain(String(DELIBERATION_MAX_ABS_DELTA));
    });
  });

  describe('④ user prompt 组装 (WP-A · 结构化输入, 零原文)', () => {
    const input = {
      turnIndex: 7,
      structured: buildTestStructuredInput({
        counselorText: '听起来你这段时间压力挺大的。',
        visitorText: '嗯…也谈不上，就是夜里老醒。',
        characterBrief: '回避型依恋 / 高神经质',
        ruleStrategy: 'recounting' as const,
      }),
    };

    it('事件分类 / 状态对比 / 角色基线 / 轮次 都在里面', () => {
      const prompt = buildDeliberationUserPrompt(input);

      // 内核事件词典里 "听起来你" 命中 empathy —— 走**真实的**分类器.
      expect(prompt).toContain('empathy');
      expect(prompt).toContain('回避型依恋 / 高神经质');
      expect(prompt).toContain('第 7 轮');
    });

    it('六个区块的标题固定 (模型每次看到的位置一样)', () => {
      const prompt = buildDeliberationUserPrompt(input);

      expect(prompt).toContain('【本轮事件分类】');
      expect(prompt).toContain('【状态变化对比】');
      expect(prompt).toContain('【角色基线】');
      // WP68: "当前行为策略"区块 —— 模型要知道现在在做什么, 才谈得上要不要换.
      expect(prompt).toContain('【当前行为策略】');
      expect(prompt).toContain('【风险等级】');
      expect(prompt).toContain('【会话轮次】');
    });

    it('⚠️ 零对话原文: 咨询师与来访者说过的话都不在 prompt 里 (WP-A 硬红线)', () => {
      const prompt = buildDeliberationUserPrompt(input);

      expect(prompt).not.toContain('听起来你这段时间压力挺大的。');
      expect(prompt).not.toContain('嗯…也谈不上，就是夜里老醒。');
      // 旧版 prompt 的两个原文区块**必须整个消失** (改一半 = 还在漏).
      expect(prompt).not.toContain('【本轮咨询师发言】');
      expect(prompt).not.toContain('【本轮来访者反应】');
    });

    it('状态对比逐维给出"前值 → 后值 (变化量)" (11 维全给)', () => {
      const prompt = buildDeliberationUserPrompt(input);

      for (const dim of DELIBERATION_DIMS) {
        expect(prompt).toContain(dim);
      }
      expect(prompt).toMatch(/trust: -?\d+\.\d{3} → -?\d+\.\d{3} \(-?\d+\.\d{3}\)/);
    });

    it('角色简述为空时仍然给阻抗基线 (留空 = 模型会脑补)', () => {
      const prompt = buildDeliberationUserPrompt({
        turnIndex: 1,
        structured: buildTestStructuredInput({ characterBrief: '' }),
      });

      expect(prompt).toContain('阻抗基线');
    });
  });

  describe('⑤ schema 描述 (拼到 system prompt 尾部)', () => {
    it('包含全部维度名与全部标签名 (枚举清单从常量生成, 不手写)', () => {
      const schema = buildDeliberationSchemaDescription();

      for (const dim of DELIBERATION_DIMS) {
        expect(schema).toContain(dim);
      }
      for (const tag of DELIBERATION_OPERATOR_TAGS) {
        expect(schema).toContain(tag);
      }
    });

    it('包含 JSON 结构的全部字段名', () => {
      const schema = buildDeliberationSchemaDescription();

      for (const key of ['deltas', 'dimension', 'delta', 'operatorTags', 'reason', 'summary', 'confidence']) {
        expect(schema).toContain(key);
      }
    });

    it('写明了枚举数量 (与常量一致)', () => {
      const schema = buildDeliberationSchemaDescription();

      expect(schema).toContain(`${DELIBERATION_DIMS.length} 个`);
      expect(schema).toContain(`${DELIBERATION_OPERATOR_TAGS.length} 个`);
    });

    it('写明了字数上限与 delta 幅度上限', () => {
      const schema = buildDeliberationSchemaDescription();

      expect(schema).toContain(String(DELIBERATION_REASON_MAX_CHARS));
      expect(schema).toContain(String(DELIBERATION_SUMMARY_MAX_CHARS));
      expect(schema).toContain(String(DELIBERATION_MAX_ABS_DELTA));
    });

    it('明确"没变就放空数组" (增量语义)', () => {
      expect(buildDeliberationSchemaDescription()).toContain('空数组');
    });

    it('拼到 system prompt 尾部后是一份完整的提问 (两个零件合起来自洽)', () => {
      const full = `${buildDeliberationSystemPrompt('exam')}\n\n${buildDeliberationSchemaDescription()}`;

      expect(full).toContain('严格');
      expect(full).toContain('"deltas"');
      expect(full).toContain('"confidence"');
    });
  });

  describe('⑥ 输出契约形状 (类型级 + 运行时)', () => {
    it('DeliberationOutput 是 { deltas, summary, confidence } 三件套', () => {
      const output: DeliberationOutput = {
        deltas: [
          {
            dimension: 'trust',
            delta: 0.08,
            operatorTags: ['empathy'],
            reason: '咨询师先复述了来访的情绪, 属于共情回应',
          },
        ],
        summary: '来访者仍保持戒备, 但语气比上一轮软了一点',
        confidence: 0.62,
      };

      expect(Object.keys(output).sort()).toEqual(['confidence', 'deltas', 'summary']);
      expect(output.deltas[0]?.dimension).toBe('trust');
      expect(output.deltas[0]?.operatorTags).toContain('empathy');
    });

    it('DeliberationDeltaEntry 的 dimension 只能是合法审议维度', () => {
      const entry: DeliberationDeltaEntry = {
        dimension: 'safety' satisfies DeliberationDim,
        delta: -0.03,
        operatorTags: ['implicit_resistance'] satisfies readonly DeliberationOperatorTag[],
        reason: '来访者把话题岔开了, 可能是隐性阻抗',
      };

      expect(DELIBERATION_DIMS).toContain(entry.dimension);
      expect(DELIBERATION_OPERATOR_TAGS).toContain(entry.operatorTags[0]);
    });

    it('"没变化"= 空数组 (不是 delta=0 的条目)', () => {
      const output: DeliberationOutput = { deltas: [], summary: '本轮没有显著变化', confidence: 0.4 };

      expect(output.deltas).toHaveLength(0);
    });
  });
});
