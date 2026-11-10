// V2026-11-10 建立 (Phase2.5 WP-J P1e · TTS 语义标记解析层 · 单测):
//   覆盖交付记录 §验收 的全部边界:
//     ① 基础解析 (Level 0): 无标记 / 语气 / 停顿 / 情绪 / 控制标记 / 组合 / 标签连用;
//     ② 模糊匹配 (±1 字符纠正) 与形近数字纠正;
//     ③ 全角/半角归一化 (且不破坏中文正文标点);
//     ④ 停顿规则: 句尾丢弃 / 时长夹取 / 同位合并 / 超量只留最长 / 偏移升序;
//     ⑤ 未知标签 / 非标签形态方括号 / 未闭合标记 (可恢复与不可恢复);
//     ⑥ 厂商格式混入: 可转换 / 不可转换 / 畸形 / 普通括号;
//     ⑦ 三级降级: Level 0 / 1 / 2, 以及"控制面不随语音面降级";
//     ⑧ 隐私: 诊断与统计里没有原文;
//     ⑨ 偏移口径: 纯文本偏移 + UTF-16 (emoji 占 2 个 code unit);
//     ⑩ MiniMax 适配器: 标记映射 / 情绪映射 / 角色基线合并 / 未知标记剥离.
//
//   全 mock: 不起 NestJS, 不发网络, 不连 DB, 不打日志.
//   验证: npx vitest run test/auto-practice/wp-j-p1e-semantic-tag-parser.spec.ts
//   时间戳: 2026-11-10

import { describe, expect, it } from 'vitest';

import { formatPauseDuration, MiniMaxTtsAdapter } from '../../src/auto-practice/adapters/minimax-tts-adapter.js';
import type { SemanticDiagnostic, SemanticTagDiagnosticSink } from '../../src/auto-practice/utils/semantic-tag-parser.js';
import { parseSemanticTags, sanitizeTagName, withinOneEdit } from '../../src/auto-practice/utils/semantic-tag-parser.js';

/**
 * 收集诊断的假 sink (验证"诊断确实被推出去", 且推出去的内容里没有原文).
 *
 * @returns sink + 两个收集数组
 */
function makeCollector(): {
  readonly sink: SemanticTagDiagnosticSink;
  readonly warnings: SemanticDiagnostic[];
  readonly errors: SemanticDiagnostic[];
} {
  const warnings: SemanticDiagnostic[] = [];
  const errors: SemanticDiagnostic[] = [];
  return {
    sink: {
      warn: (diagnostic) => warnings.push(diagnostic),
      error: (diagnostic) => errors.push(diagnostic),
    },
    warnings,
    errors,
  };
}

describe('WP-J P1e · TTS 语义标记解析层', () => {
  describe('① 基础解析 (Level 0)', () => {
    it('无标记文本 → 原样保留, 零诊断', () => {
      const result = parseSemanticTags('你最近还好吗？');
      expect(result.level).toBe(0);
      expect(result.turn.text).toBe('你最近还好吗？');
      expect(result.displayText).toBe('你最近还好吗？');
      expect(result.rawText).toBe('你最近还好吗？');
      expect(result.warnings).toHaveLength(0);
      expect(result.errors).toHaveLength(0);
      expect(result.stats.totalTags).toBe(0);
    });

    it('[sigh] → 句首语气 sigh, 标记不留在正文', () => {
      const result = parseSemanticTags('[sigh]我最近有点累。');
      expect(result.level).toBe(0);
      expect(result.turn.preSpeech).toBe('sigh');
      expect(result.turn.text).toBe('我最近有点累。');
      expect(result.stats.preSpeechTags).toBe(1);
    });

    it('[pause:0.5] → 一个停顿, 偏移 0, 时长 0.5', () => {
      const result = parseSemanticTags('[pause:0.5]我最近有点累。');
      expect(result.level).toBe(0);
      expect(result.turn.pauses).toEqual([{ offset: 0, durationSec: 0.5 }]);
      expect(result.turn.text).toBe('我最近有点累。');
      expect(result.stats.pauseTags).toBe(1);
    });

    it('[emotion:sad] → 情绪 sad, 不留在正文', () => {
      const result = parseSemanticTags('[emotion:sad]我最近有点累。');
      expect(result.level).toBe(0);
      expect(result.turn.emotion).toBe('sad');
      expect(result.turn.text).toBe('我最近有点累。');
      expect(result.stats.emotionTags).toBe(1);
    });

    it('[[STATE:END]] → 控制标记 END, 正文里不留', () => {
      const result = parseSemanticTags('谢谢你。\n\n[[STATE:END]]');
      expect(result.level).toBe(0);
      expect(result.turn.controlTags).toEqual(['END']);
      expect(result.turn.text).toBe('谢谢你。');
      expect(result.stats.controlTags).toBe(1);
    });

    it('[[STATE:MORE]] → 控制标记 MORE', () => {
      const result = parseSemanticTags('我们接着说。[[STATE:MORE]]');
      expect(result.turn.controlTags).toEqual(['MORE']);
      expect(result.turn.text).toBe('我们接着说。');
    });

    it('多个标记组合 → 各自归位, 停顿偏移按纯文本算', () => {
      const result = parseSemanticTags('我最近[sigh]有点累[pause:0.3]。');
      expect(result.level).toBe(0);
      expect(result.turn.preSpeech).toBe('sigh');
      expect(result.turn.pauses).toEqual([{ offset: 6, durationSec: 0.3 }]);
      expect(result.turn.text).toBe('我最近有点累。');
    });

    it('标签连用 ([sigh][pause:0.3]) → 合法, 偏移同为 0', () => {
      const result = parseSemanticTags('[sigh][pause:0.3]你好');
      expect(result.level).toBe(0);
      expect(result.turn.preSpeech).toBe('sigh');
      expect(result.turn.pauses).toEqual([{ offset: 0, durationSec: 0.3 }]);
      expect(result.turn.text).toBe('你好');
    });

    it('首尾空白被裁掉, 停顿偏移同步平移', () => {
      const result = parseSemanticTags('  [pause:0.5]你好  ');
      expect(result.turn.text).toBe('你好');
      expect(result.turn.pauses).toEqual([{ offset: 0, durationSec: 0.5 }]);
    });

    it('空字符串 → 空文本, Level 0', () => {
      const result = parseSemanticTags('');
      expect(result.level).toBe(0);
      expect(result.turn.text).toBe('');
      expect(result.turn.pauses).toEqual([]);
      expect(result.turn.preSpeech).toBeNull();
      expect(result.turn.emotion).toBeNull();
    });
  });

  describe('② 模糊匹配 (±1 字符) 与形近数字', () => {
    it('[sighs] → 纠正为 sigh, 记 warning, Level 1', () => {
      const result = parseSemanticTags('[sighs]你好');
      expect(result.level).toBe(1);
      expect(result.turn.preSpeech).toBe('sigh');
      expect(result.stats.correctedTags).toBe(1);
      expect(result.warnings[0]?.code).toBe('TAG_FUZZY_CORRECTED');
    });

    it('[sigm] → 等长替换也认 (sigh)', () => {
      const result = parseSemanticTags('[sigm]你好');
      expect(result.turn.preSpeech).toBe('sigh');
      expect(result.level).toBe(1);
    });

    it('[paus:0.5] → 纠正为 pause, 时长正确', () => {
      const result = parseSemanticTags('[paus:0.5]你好');
      expect(result.turn.pauses).toEqual([{ offset: 0, durationSec: 0.5 }]);
      expect(result.warnings[0]?.code).toBe('TAG_FUZZY_CORRECTED');
    });

    it('[emotion:sadd] → 情绪值纠正为 sad', () => {
      const result = parseSemanticTags('[emotion:sadd]你好');
      expect(result.turn.emotion).toBe('sad');
      expect(result.level).toBe(1);
    });

    it('[emm] → 精确命中, 不报纠正', () => {
      const result = parseSemanticTags('[emm]你好');
      expect(result.turn.preSpeech).toBe('emm');
      expect(result.level).toBe(0);
    });

    it('[pause:o.5] → 形近数字 o→0, 时长 0.5', () => {
      const result = parseSemanticTags('[pause:o.5]你好');
      expect(result.turn.pauses).toEqual([{ offset: 0, durationSec: 0.5 }]);
    });

    it('编辑距离 2 的拼写不纠正 (宁可不改, 不可改错)', () => {
      const result = parseSemanticTags('[saaa]你好');
      expect(result.turn.preSpeech).toBeNull();
      expect(result.errors[0]?.code).toBe('TAG_UNKNOWN');
    });

    it('withinOneEdit: 等长替换/多一字/少一字都算 1 次编辑', () => {
      expect(withinOneEdit('sigh', 'sign')).toBe(true);
      expect(withinOneEdit('sigh', 'sighs')).toBe(true);
      expect(withinOneEdit('sigh', 'sig')).toBe(true);
      expect(withinOneEdit('sigh', 'signn')).toBe(false);
      expect(withinOneEdit('sad', 'aid')).toBe(false);
    });
  });

  describe('③ 全角 / 半角归一化', () => {
    it('［pause：0.5］ → 全角方括号 + 全角冒号都能解析', () => {
      const result = parseSemanticTags('［pause：0.5］你好');
      expect(result.turn.pauses).toEqual([{ offset: 0, durationSec: 0.5 }]);
      expect(result.turn.text).toBe('你好');
    });

    it('［sigh］ → 全角语气标签', () => {
      const result = parseSemanticTags('［sigh］你好');
      expect(result.turn.preSpeech).toBe('sigh');
    });

    it('［emotion：sad］ → 全角情绪标签', () => {
      const result = parseSemanticTags('［emotion：sad］你好');
      expect(result.turn.emotion).toBe('sad');
    });

    it('[pause:０.５] → 全角数字', () => {
      const result = parseSemanticTags('[pause:０.５]你好');
      expect(result.turn.pauses).toEqual([{ offset: 0, durationSec: 0.5 }]);
    });

    it('中文正文标点不被半角化 (只有标记影子才转)', () => {
      const result = parseSemanticTags('你好，世界。［sigh］');
      expect(result.turn.text).toBe('你好，世界。');
      expect(result.turn.preSpeech).toBe('sigh');
    });

    it('中文引号归一化 (1:1, 长度不变)', () => {
      const result = parseSemanticTags('「我最近不太好」');
      expect(result.turn.text).toBe('“我最近不太好”');
      expect(result.turn.text).toHaveLength(8);
    });
  });

  describe('④ 停顿规则', () => {
    it('句尾停顿 → 自动丢弃, 记 warning', () => {
      const result = parseSemanticTags('你好[pause:0.5]');
      expect(result.turn.pauses).toEqual([]);
      expect(result.level).toBe(1);
      expect(result.warnings.map((item) => item.code)).toContain('PAUSE_TRAILING_DROPPED');
    });

    it('时长 0 → 夹取到下限 0.01', () => {
      const result = parseSemanticTags('[pause:0]你好');
      expect(result.turn.pauses).toEqual([{ offset: 0, durationSec: 0.01 }]);
      expect(result.warnings.map((item) => item.code)).toContain('PAUSE_DURATION_CLAMPED');
    });

    it('时长 200 → 夹取到上限 99.99', () => {
      const result = parseSemanticTags('[pause:200]你好');
      expect(result.turn.pauses).toEqual([{ offset: 0, durationSec: 99.99 }]);
      expect(result.warnings.map((item) => item.code)).toContain('PAUSE_DURATION_CLAMPED');
    });

    it('负时长 → 夹取到下限', () => {
      const result = parseSemanticTags('[pause:-1]你好');
      expect(result.turn.pauses).toEqual([{ offset: 0, durationSec: 0.01 }]);
    });

    it('同位置的相邻停顿 → 合并成最长的那个', () => {
      const result = parseSemanticTags('[pause:0.3][pause:0.5]你好');
      expect(result.turn.pauses).toEqual([{ offset: 0, durationSec: 0.5 }]);
      expect(result.warnings.map((item) => item.code)).toContain('PAUSE_MERGED');
    });

    it('超过 5 个停顿 → 只留最长的那个', () => {
      const result = parseSemanticTags('a[pause:0.1]b[pause:0.2]c[pause:0.3]d[pause:0.4]e[pause:0.5]f[pause:0.6]g');
      expect(result.turn.pauses).toHaveLength(1);
      expect(result.turn.pauses[0]?.durationSec).toBe(0.6);
      expect(result.warnings.map((item) => item.code)).toContain('PAUSE_TOO_MANY');
    });

    it('超量时保留的是最长停顿自己的偏移', () => {
      const result = parseSemanticTags('a[pause:0.9]b[pause:0.1]c[pause:0.1]d[pause:0.1]e[pause:0.1]f[pause:0.1]g');
      expect(result.turn.pauses).toEqual([{ offset: 1, durationSec: 0.9 }]);
    });

    it('停顿按偏移升序排列', () => {
      const result = parseSemanticTags('甲[pause:0.1]乙丙丁[pause:0.2]戊');
      const offsets = result.turn.pauses.map((item) => item.offset);
      expect(offsets).toEqual([...offsets].sort((a, b) => a - b));
      expect(offsets).toHaveLength(2);
    });
  });

  describe('⑤ 未知标签 / 非标签方括号 / 未闭合标记', () => {
    it('不认识的标签 → 当普通文本保留 + 记 error, 并给出区间', () => {
      const result = parseSemanticTags('[xyzzy]你好');
      expect(result.turn.text).toBe('[xyzzy]你好');
      expect(result.errors[0]?.code).toBe('TAG_UNKNOWN');
      expect(result.stats.unknownTags).toBe(1);
      expect(result.turn.unknownTags).toEqual([{ offset: 0, length: 7 }]);
    });

    it('非标签形态的方括号 → 原样保留, 不记诊断', () => {
      const result = parseSemanticTags('他说[1]和[你好]');
      expect(result.turn.text).toBe('他说[1]和[你好]');
      expect(result.errors).toHaveLength(0);
      expect(result.warnings).toHaveLength(0);
    });

    it('未闭合但能认出标签名 → 剥掉标签名, 剩下当正文', () => {
      const result = parseSemanticTags('[sigh你好');
      expect(result.turn.text).toBe('你好');
      expect(result.level).toBe(1);
      expect(result.warnings.map((item) => item.code)).toContain('TAG_UNCLOSED_RECOVERED');
    });

    it('未闭合且认不出 → 整段当正文 + Level 2', () => {
      const result = parseSemanticTags('[xyzzy你好');
      expect(result.turn.text).toBe('[xyzzy你好');
      expect(result.level).toBe(2);
      expect(result.errors.map((item) => item.code)).toContain('TAG_UNCLOSED');
    });

    it('未知的 [[STATE:XXX]] → 当普通文本保留 + error', () => {
      const result = parseSemanticTags('你好[[STATE:FOO]]');
      expect(result.turn.controlTags).toEqual([]);
      expect(result.turn.text).toBe('你好[[STATE:FOO]]');
      expect(result.errors[0]?.code).toBe('TAG_UNKNOWN');
    });
  });

  describe('⑥ 厂商格式混入 (LLM 直接吐 MiniMax 标记)', () => {
    it('(sighs) → 转换回语义层的 sigh', () => {
      const result = parseSemanticTags('(sighs)你好');
      expect(result.turn.preSpeech).toBe('sigh');
      expect(result.turn.text).toBe('你好');
      expect(result.stats.convertedVendorTags).toBe(1);
      expect(result.warnings.map((item) => item.code)).toContain('VENDOR_FORMAT_CONVERTED');
    });

    it('<#0.5#> → 转换回语义层的停顿', () => {
      const result = parseSemanticTags('<#0.5#>你好');
      expect(result.turn.pauses).toEqual([{ offset: 0, durationSec: 0.5 }]);
      expect(result.turn.text).toBe('你好');
    });

    it('语义层表达不了的厂商标记 → 丢弃, 不入正文', () => {
      const result = parseSemanticTags('(coughs)你好');
      expect(result.turn.text).toBe('你好');
      expect(result.stats.droppedVendorMarkers).toBe(1);
      expect(result.warnings.map((item) => item.code)).toContain('VENDOR_MARKER_DROPPED');
    });

    it('畸形的 <#abc#> → 丢弃, 不入正文', () => {
      const result = parseSemanticTags('<#abc#>你好');
      expect(result.turn.text).toBe('你好');
      expect(result.stats.droppedVendorMarkers).toBe(1);
    });

    it('普通括号不是厂商标记 → 原样保留', () => {
      const result = parseSemanticTags('(这是括号)你好');
      expect(result.turn.text).toBe('(这是括号)你好');
      expect(result.stats.droppedVendorMarkers).toBe(0);
    });
  });

  describe('⑦ 三级降级', () => {
    it('Level 0 → 干净解析', () => {
      const result = parseSemanticTags('[sigh]我最近有点累[pause:0.5]，想找人聊聊。');
      expect(result.level).toBe(0);
      expect(result.warnings).toHaveLength(0);
      expect(result.errors).toHaveLength(0);
    });

    it('Level 1 → 有 warning, 语义字段仍然可用', () => {
      const result = parseSemanticTags('[sighs]你好');
      expect(result.level).toBe(1);
      expect(result.turn.preSpeech).toBe('sigh');
    });

    it('Level 2 → 非法字符超 10%, 语义字段全部作废', () => {
      const result = parseSemanticTags('[aaaaaa][bbbbbb][cccccc]' + 'x'.repeat(60));
      expect(result.level).toBe(2);
      expect(result.turn.preSpeech).toBeNull();
      expect(result.turn.pauses).toEqual([]);
      expect(result.turn.emotion).toBeNull();
      expect(result.errors.map((item) => item.code)).toContain('ILLEGAL_RATIO_EXCEEDED');
    });

    it('Level 2 → 控制面不受影响 (控制标记保留)', () => {
      const result = parseSemanticTags('[[STATE:END]][aaaaaa][bbbbbb][cccccc]' + 'x'.repeat(60));
      expect(result.level).toBe(2);
      expect(result.turn.controlTags).toEqual(['END']);
    });

    it('标签数超上限 → Level 2', () => {
      const result = parseSemanticTags('[sigh][breath][emm]你好', { maxTags: 2 });
      expect(result.level).toBe(2);
      expect(result.errors.map((item) => item.code)).toContain('TOO_MANY_TAGS');
    });

    it('非法占比阈值可调 (调高后同一段文本不再降级)', () => {
      const text = '[aaaaaa][bbbbbb][cccccc]' + 'x'.repeat(60);
      expect(parseSemanticTags(text).level).toBe(2);
      expect(parseSemanticTags(text, { illegalRatioLimit: 0.9 }).level).toBe(1);
    });

    it('END 与 MORE 同时出现 → 记冲突 warning', () => {
      const result = parseSemanticTags('你好[[STATE:END]][[STATE:MORE]]');
      expect(result.turn.controlTags).toEqual(['END', 'MORE']);
      expect(result.warnings.map((item) => item.code)).toContain('CONTROL_TAG_CONFLICT');
    });

    it('重复的语气 / 情绪 → 第一个说了算, 后面的记 warning', () => {
      const result = parseSemanticTags('[sigh][breath][emotion:sad][emotion:happy]你好');
      expect(result.turn.preSpeech).toBe('sigh');
      expect(result.turn.emotion).toBe('sad');
      const codes = result.warnings.map((item) => item.code);
      expect(codes).toContain('PRE_SPEECH_DUPLICATE');
      expect(codes).toContain('EMOTION_DUPLICATE');
    });
  });

  describe('⑧ 隐私: 诊断与统计不含原文', () => {
    it('诊断里不出现对话原文', () => {
      const result = parseSemanticTags('[unknown_tag]我想死');
      const dumped = JSON.stringify([...result.warnings, ...result.errors]);
      expect(dumped).not.toContain('我想死');
      expect(JSON.stringify(result.stats)).not.toContain('我想死');
    });

    it('标签名脱敏: 非字母数字下划线一律 <redacted>', () => {
      expect(sanitizeTagName('sigh')).toBe('sigh');
      expect(sanitizeTagName('我想死')).toBe('<redacted>');
      expect(sanitizeTagName('a'.repeat(30))).toBe('<redacted>');
      expect(sanitizeTagName('')).toBe('<redacted>');
    });

    it('诊断通过 sink 推出去 (带严重度)', () => {
      const collector = makeCollector();
      parseSemanticTags('[sighs]你好', { sink: collector.sink });
      expect(collector.warnings).toHaveLength(1);
      expect(collector.warnings[0]?.severity).toBe('warning');
      expect(collector.errors).toHaveLength(0);
    });

    it('未知标签走 error 通道', () => {
      const collector = makeCollector();
      // 正文足够长 → 非法字符占比不超阈值 → 只报"未知标记"这一条.
      parseSemanticTags('这是一段比较长的正文'.repeat(20) + '[xyzzy]', { sink: collector.sink });
      expect(collector.errors).toHaveLength(1);
      expect(collector.errors[0]?.severity).toBe('error');
      expect(collector.errors[0]?.code).toBe('TAG_UNKNOWN');
    });
  });

  describe('⑨ 偏移口径 (纯文本 + UTF-16)', () => {
    it('偏移按纯文本算, 不是带标记原文', () => {
      const result = parseSemanticTags('我最近[pause:0.5]有点累');
      expect(result.turn.pauses[0]?.offset).toBe(3);
      expect(result.turn.text).toBe('我最近有点累');
    });

    it('emoji 占 2 个 code unit (口径写死 UTF-16)', () => {
      const result = parseSemanticTags('😀[pause:0.5]你好');
      expect(result.turn.pauses[0]?.offset).toBe(2);
      expect(result.turn.text).toBe('😀你好');
    });

    it('多个停顿时偏移随正文增长', () => {
      const result = parseSemanticTags('甲[pause:0.1]乙丙[pause:0.2]丁');
      expect(result.turn.pauses.map((item) => item.offset)).toEqual([1, 3]);
    });
  });

  describe('⑩ MiniMax 适配器', () => {
    const adapter = new MiniMaxTtsAdapter();

    it('句首语气 → MiniMax 语气标签', () => {
      const result = adapter.render({
        text: '你好',
        preSpeech: 'sigh',
        pauses: [],
        controlTags: [],
        emotion: null,
        unknownTags: [],
      });
      expect(result.ttsText).toBe('(sighs)你好');
    });

    it('停顿 → 插在对应偏移处', () => {
      const result = adapter.render({
        text: '我最近有点累。',
        preSpeech: null,
        pauses: [{ offset: 3, durationSec: 0.5 }],
        controlTags: [],
        emotion: null,
        unknownTags: [],
      });
      expect(result.ttsText).toBe('我最近<#0.5#>有点累。');
    });

    it('情绪 → 进 voice_setting, 不进文本', () => {
      const result = adapter.render({
        text: '你好',
        preSpeech: null,
        pauses: [],
        controlTags: [],
        emotion: 'sad',
        unknownTags: [],
      });
      expect(result.voiceParams.emotion).toBe('sad');
      expect(result.ttsText).not.toContain('sad');
    });

    it("情绪 'calm' → MiniMax 的 'neutral' (MiniMax 没有 calm)", () => {
      const result = adapter.render({
        text: '你好',
        preSpeech: null,
        pauses: [],
        controlTags: [],
        emotion: 'calm',
        unknownTags: [],
      });
      expect(result.voiceParams.emotion).toBe('neutral');
    });

    it('角色基线参数保留, 本轮情绪覆盖情绪位', () => {
      const result = adapter.render(
        {
          text: '你好',
          preSpeech: null,
          pauses: [],
          controlTags: [],
          emotion: 'happy',
          unknownTags: [],
        },
        { baseVoiceParams: { speed: 0.9, pitch: -2 } },
      );
      expect(result.voiceParams).toEqual({ speed: 0.9, pitch: -2, emotion: 'happy' });
    });

    it('控制标记不进 ttsText', () => {
      const result = adapter.render({
        text: '谢谢你。',
        preSpeech: null,
        pauses: [],
        controlTags: ['END'],
        emotion: null,
        unknownTags: [],
      });
      expect(result.ttsText).toBe('谢谢你。');
      expect(result.ttsText).not.toContain('STATE');
    });

    it('不认识的标记 → ttsText 剥离, displayText 保留', () => {
      const parsed = parseSemanticTags('这是一段足够长的正文用来把非法占比压到阈值以下[xyzzy]后面还有内容继续凑长度');
      const rendered = adapter.render(parsed.turn);
      expect(rendered.ttsText).not.toContain('xyzzy');
      expect(parsed.displayText).toContain('[xyzzy]');
    });

    it('Level 2 → ttsText 里没有任何标记', () => {
      const parsed = parseSemanticTags('[aaaaaa][bbbbbb][cccccc]' + 'x'.repeat(60));
      expect(parsed.level).toBe(2);
      const rendered = adapter.renderParsed(parsed);
      expect(rendered.ttsText).not.toContain('[');
      expect(rendered.ttsText).toBe('x'.repeat(60));
    });

    it('多个停顿按偏移顺序插入', () => {
      const result = adapter.render({
        text: '甲乙丙丁',
        preSpeech: null,
        pauses: [
          { offset: 1, durationSec: 0.1 },
          { offset: 3, durationSec: 0.2 },
        ],
        controlTags: [],
        emotion: null,
        unknownTags: [],
      });
      expect(result.ttsText).toBe('甲<#0.1#>乙丙<#0.2#>丁');
    });

    it('时长文本化: 去掉多余的零', () => {
      expect(formatPauseDuration(0.5)).toBe('0.5');
      expect(formatPauseDuration(1)).toBe('1');
      expect(formatPauseDuration(0.05)).toBe('0.05');
      expect(formatPauseDuration(99.99)).toBe('99.99');
    });

    it('端到端: 解析 → 渲染, 停顿与语气都进了 MiniMax 文本', () => {
      const parsed = parseSemanticTags('[sigh]我最近有点累[pause:0.5]，想找人聊聊。');
      const rendered = adapter.renderParsed(parsed);
      expect(rendered.ttsText).toBe('(sighs)我最近有点累<#0.5#>，想找人聊聊。');
      expect(rendered.voiceParams).toEqual({});
    });
  });
});
