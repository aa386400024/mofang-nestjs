// V2026-11-22 建立 (AF-251 · 未知 emotion 投影归一化 · 单测):
//   覆盖:
//     ① 常见自由情绪词 → 语义层 5 值的别名映射 (fearful / sad / angry / happy / calm);
//     ② 别名命中后标记被消费、displayText 不含内部标记、不记 TAG_UNKNOWN、不进 unknownTags;
//     ③ 映射不了的情绪值 → 安全消费标记 + EMOTION_VALUE_DROPPED, 不猜情绪、不留正文;
//     ④ 非 emotion 的未知标签保持原行为 (正文保留 + TAG_UNKNOWN), 不回归;
//     ⑤ 模糊拼写纠错保持原行为;
//     ⑥ 流式预处理: [emotion:anxiety] 不向 TTS 输出, 且 detectedEmotion='fearful';
//     ⑦ 隐私: 诊断 meta 只有结构性信息, 不含原始自由词.
//
//   全 mock: 不起 NestJS, 不发网络, 不连 DB, 不打日志.
//   验证: pnpm exec vitest run test/auto-practice/af251-emotion-projection.spec.ts
//   时间戳: 2026-11-22

import { describe, expect, it } from 'vitest';

import type { SemanticEmotion } from '../../src/auto-practice/utils/semantic-tag-parser.js';
import {
  parseSemanticTagFragment,
  parseSemanticTags,
  SEMANTIC_EMOTION_ALIASES,
} from '../../src/auto-practice/utils/semantic-tag-parser.js';
import { StreamingSemanticPreprocessor } from '../../src/auto-practice/utils/streaming-semantic-preprocessor.js';

describe('AF-251 · 未知 emotion 投影归一化', () => {
  it('① [emotion:anxiety] → fearful, 标记被消费, 正文干净', () => {
    const result = parseSemanticTags('[emotion:anxiety]我最近总是睡不着。');
    expect(result.turn.emotion).toBe<SemanticEmotion>('fearful');
    expect(result.turn.text).toBe('我最近总是睡不着。');
    expect(result.turn.unknownTags).toEqual([]);
    expect(result.errors).toHaveLength(0);
    expect(result.level).toBe(1);
    expect(result.warnings.map((item) => item.code)).toContain('EMOTION_ALIAS_MAPPED');
  });

  it('② 别名表按语义族映射到 5 个合法值', () => {
    const cases: readonly (readonly [string, SemanticEmotion])[] = [
      ['nervous', 'fearful'],
      ['panicked', 'fearful'],
      ['depressed', 'sad'],
      ['lonely', 'sad'],
      ['annoyed', 'angry'],
      ['frustrated', 'angry'],
      ['excited', 'happy'],
      ['grateful', 'happy'],
      ['relieved', 'calm'],
      ['neutral', 'calm'],
    ];
    for (const [raw, expected] of cases) {
      const result = parseSemanticTags(`[emotion:${raw}]你好`);
      expect(result.turn.emotion).toBe(expected);
      expect(result.turn.text).toBe('你好');
      expect(result.turn.unknownTags).toEqual([]);
      expect(result.errors).toHaveLength(0);
      expect(SEMANTIC_EMOTION_ALIASES.get(raw)).toBe(expected);
    }
  });

  it('③ 映射不了的情绪值 → 安全消费标记 + warning, 不猜情绪', () => {
    const result = parseSemanticTags('[emotion:bewildered]我不知道该说什么。');
    expect(result.turn.emotion).toBeNull();
    expect(result.turn.text).toBe('我不知道该说什么。');
    expect(result.turn.unknownTags).toEqual([]);
    expect(result.errors).toHaveLength(0);
    expect(result.level).toBe(1);
    expect(result.warnings.map((item) => item.code)).toContain('EMOTION_VALUE_DROPPED');
  });

  it('④ 非 emotion 的未知标签保持正文保留 + TAG_UNKNOWN', () => {
    const result = parseSemanticTags('[xyzzy]你好');
    expect(result.turn.text).toBe('[xyzzy]你好');
    expect(result.turn.unknownTags).toEqual([{ offset: 0, length: 7 }]);
    expect(result.errors[0]?.code).toBe('TAG_UNKNOWN');
  });

  it('⑤ 模糊拼写纠错仍走 TAG_FUZZY_CORRECTED, 不误报别名', () => {
    const result = parseSemanticTags('[emotion:sadd]你好');
    expect(result.turn.emotion).toBe('sad');
    expect(result.warnings.map((item) => item.code)).toContain('TAG_FUZZY_CORRECTED');
    expect(result.warnings.map((item) => item.code)).not.toContain('EMOTION_ALIAS_MAPPED');
  });

  it('⑥ 片段解析与离线扫描同一判定: anxiety → fearful', () => {
    const fragment = parseSemanticTagFragment('[emotion:anxiety]');
    expect(fragment.kind).toBe('tag');
    if (fragment.kind === 'tag') {
      expect(fragment.turn.emotion).toBe('fearful');
      expect(fragment.turn.text).toBe('');
    }
  });

  it('⑦ 流式预处理: anxiety 不进 TTS, detectedEmotion=fearful', () => {
    const pre = new StreamingSemanticPreprocessor();
    expect(pre.pushToken('[emotion:anxiety]就那样吧。')).toBe('就那样吧。');
    expect(pre.detectedEmotion).toBe('fearful');
    expect(pre.stats.tags).toBe(1);
    expect(pre.stats.unknownTags).toBe(0);
  });

  it('⑧ 流式预处理: 不可映射情绪值静默丢弃, 不输出标记', () => {
    const pre = new StreamingSemanticPreprocessor();
    expect(pre.pushToken('[emotion:bewildered]嗯。')).toBe('嗯。');
    expect(pre.detectedEmotion).toBeNull();
    expect(pre.stats.tags).toBe(1);
    expect(pre.stats.unknownTags).toBe(0);
  });

  it('⑨ 隐私: 诊断 meta 不含原始自由词', () => {
    const alias = parseSemanticTags('[emotion:anxiety]你好');
    const dropped = parseSemanticTags('[emotion:bewildered]你好');
    const serialized = JSON.stringify([...alias.warnings, ...alias.errors, ...dropped.warnings, ...dropped.errors]);
    expect(serialized).not.toContain('anxiety');
    expect(serialized).not.toContain('bewildered');
    expect(JSON.stringify(alias.warnings)).toContain('emotion');
  });

  it('⑩ 生产真实样本回归: AF-250 的 anxiety 输出投影为 fearful', () => {
    const result = parseSemanticTags('就那样吧，该睡的时候睡不着，不该睡的时候又困得要死。[emotion:anxiety]');
    expect(result.turn.emotion).toBe('fearful');
    expect(result.turn.text).toBe('就那样吧，该睡的时候睡不着，不该睡的时候又困得要死。');
    expect(result.turn.unknownTags).toEqual([]);
    expect(result.errors).toHaveLength(0);
  });
});
