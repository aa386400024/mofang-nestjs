// V2026-11-21 建立 (AF-229 · Lite 专用真人度评分 prompt 单测):
//   只验证提示词契约：五维清单、评分步骤、专项检查、R1/R2 stance、证据规则、
//   输出契约、场景渲染与 packet 内容落地。
//   边界: 不调用任何模型、不发网络请求、不改既有协议与阈值。

import { describe, expect, it } from 'vitest';

import { LITE_PROMPT_VERSION, buildLiteRaterPrompt } from '../../bin/realism-rater-lite-prompt.js';
import {
  REALISM_DIMENSIONS,
  parseRealismRatingLines,
  type RealismBlindPacket,
} from '../../src/auto-practice/metrics/visitor-realism-rating.js';

const packet: RealismBlindPacket = {
  packetId: 'pkt-lite-001',
  scene: 'in_person',
  turns: [
    { turnIndex: 1, role: 'counselor', text: '你最近睡得怎么样？' },
    { turnIndex: 2, role: 'visitor', text: '嗯……不太好，躺下就开始想工作。' },
    { turnIndex: 3, role: 'counselor', text: '想工作的时候，身体有什么感觉？' },
    { turnIndex: 4, role: 'visitor', text: '胸口闷，有时候会突然坐起来。' },
    { turnIndex: 5, role: 'counselor', text: '这种不舒服持续多久了？' },
    { turnIndex: 6, role: 'visitor', text: '嗯……说不上来，就是不想接他电话。' },
  ],
};

describe('AF-229 · Lite 专用评分 prompt', () => {
  it('版本号固定，便于和 AF-214 主协议版本分开追踪', () => {
    expect(LITE_PROMPT_VERSION).toBe('lite-rubric-v1');
    expect(typeof buildLiteRaterPrompt).toBe('function');
  });

  it('五维齐全：每维都有键名、中文标签与 1/3/5 可观察行为清单', () => {
    const { system } = buildLiteRaterPrompt(packet, 'R1');
    for (const dimension of REALISM_DIMENSIONS) {
      expect(system).toContain(dimension);
      expect(system).toContain('5 分（命中 ≥3 条，且无 1 分档特征）');
      expect(system).toContain('3 分（命中 5 分档 ≤1 条，且无 1 分档特征）');
      expect(system).toContain('1 分（命中 ≥2 条）');
    }
    expect(system).toContain('自然度');
    expect(system).toContain('情绪连续性');
    expect(system).toContain('话轮形态');
    expect(system).toContain('场景一致');
    expect(system).toContain('关系在场');
    // 中间两档给确定性归并规则，避免小模型在 2/4 上乱填。
    expect(system).toContain('2 分 = 命中 1 分档 1 条；4 分 = 命中 5 分档 2 条；5 分 = 命中 5 分档 ≥3 条。');
  });

  it('评分步骤显式成文，且明确反对默认给 3 分', () => {
    const { system } = buildLiteRaterPrompt(packet, 'R1');
    expect(system).toContain('【五步流程】');
    expect(system).toContain('1. 读场景');
    expect(system).toContain('2. 列轮次');
    expect(system).toContain('3. 找证据');
    expect(system).toContain('4. 对清单');
    expect(system).toContain('5. 给分');
    expect(system).toContain('【不要默认给 3 分】');
    expect(system).toContain('不是安全答案');
    expect(system).toContain('3 维以上都是 3 分');
    expect(system).toContain('五维最多 2 维给 5 分');
    expect(system).toContain('5 分要命中 ≥3 条');
  });

  it('三个易滑维度有专项检查步骤', () => {
    const { system } = buildLiteRaterPrompt(packet, 'R1');
    expect(system).toContain('【三个易滑维度的专项检查】');
    expect(system).toContain('必须对比前后两个来访者轮次');
    expect(system).toContain('先找媒介线索');
    expect(system).toContain('必须看咨询师一句话之后');
  });

  it('R1 证据优先、R2 整体叙事，但共用同一套清单与行协议', () => {
    const r1 = buildLiteRaterPrompt(packet, 'R1').system;
    const r2 = buildLiteRaterPrompt(packet, 'R2').system;
    expect(r1).toContain('证据优先');
    expect(r2).toContain('整体叙事');
    expect(r1).not.toBe(r2);
    for (const system of [r1, r2]) {
      expect(system).toContain('【五维行为清单】');
      expect(system).toContain('【输出：行协议】');
      expect(system).toContain('R1/R2 共用清单与行协议');
    }
  });

  it('证据规则：来访者轮次、原文子串、≤120 字符、禁止改写与编造', () => {
    const { system } = buildLiteRaterPrompt(packet, 'R1');
    expect(system).toContain('【证据规则】');
    expect(system).toContain('五维各给一条证据，一条都不能少');
    expect(system).toContain('turnIndex 必须是来访者那一轮的编号，不能填咨询师那一轮');
    expect(system).toContain('quote 必须是该轮台词的原文子串，不超过 120 字符');
    expect(system).toContain('不改写、不拼接、不加省略号、不编造');
    expect(system).toContain('不许省略该维');
  });

  it('输出契约：行协议 + 禁 JSON / markdown / 解释 / <think>', () => {
    const { system } = buildLiteRaterPrompt(packet, 'R1');
    expect(system).toContain('第一行必须是 naturalness=');
    expect(system).toContain('格式：维度=分数|轮次编号|原文短句');
    expect(system).toContain('naturalness=4|2|');
    expect(system).toContain('emotional_continuity=3|4|');
    expect(system).toContain('turn_shape=4|2|');
    expect(system).toContain('scene_congruence=4|4|');
    expect(system).toContain('relational_presence=3|2|');
    expect(system).toContain('overall=4');
    expect(system).toContain('notes=');
    expect(system).toContain('不要 JSON、不要 markdown、不要解释、不要分析过程、不要 <think>');
  });

  it('构造 packet：system/user 非空，且带 packetId、场景与轮次', () => {
    const { system, user } = buildLiteRaterPrompt(packet, 'R1');
    expect(system.length).toBeGreaterThan(0);
    expect(user.length).toBeGreaterThan(0);
    expect(user).toContain('packetId：pkt-lite-001');
    expect(user).toContain('场景：面对面咨询（同一个咨询室，面对面出声说话）');
    expect(user).toContain('第 2 轮 来访者：嗯……不太好，躺下就开始想工作。');
    expect(user).toContain('第 6 轮 来访者：');
    expect(user).toContain('来访者轮次编号：2、4、6');
  });

  it('三种场景标签都渲染进 user', () => {
    const inPerson = buildLiteRaterPrompt({ ...packet, scene: 'in_person' }, 'R1').user;
    const voice = buildLiteRaterPrompt({ ...packet, scene: 'online_voice' }, 'R1').user;
    const text = buildLiteRaterPrompt({ ...packet, scene: 'online_text' }, 'R1').user;
    expect(inPerson).toContain('面对面咨询（同一个咨询室，面对面出声说话）');
    expect(voice).toContain('线上实时语音咨询（能听见彼此声音，不是打字）');
    expect(text).toContain('线上文字咨询（通过文字消息来回交流）');
  });

  it('提示词模板控制在 2500 字以内', () => {
    const { system } = buildLiteRaterPrompt(packet, 'R1');
    expect(system.length).toBeLessThanOrEqual(2500);
  });

  it('按提示词写的行协议输出能被现有解析器直接解析（协议兼容）', () => {
    const raw = [
      'naturalness=4|2|嗯……不太好',
      'emotional_continuity=3|6|说不上来',
      'turn_shape=4|4|胸口闷',
      'scene_congruence=4|4|有时候会突然坐起来',
      'relational_presence=3|2|不太好',
      'overall=4',
      'notes=整体能接住咨询师的话。',
    ].join('\n');
    const parsed = parseRealismRatingLines(raw, packet);
    if (!parsed.ok) throw new Error(`行协议应可解析：${parsed.error}`);
    expect(parsed.rating.overall).toBe(4);
    expect(Object.keys(parsed.rating.dimensions)).toHaveLength(5);
    expect(parsed.rating.dimensions.naturalness.evidence).toEqual({ turnIndex: 2, quote: '嗯……不太好' });
    expect(parsed.rating.dimensions.emotional_continuity.score).toBe(3);
  });

  it('证据落在咨询师轮次会被现有解析器拒绝（证据规则确实生效）', () => {
    const raw = [
      'naturalness=4|1|你最近睡得怎么样',
      'emotional_continuity=3|6|说不上来',
      'turn_shape=4|4|胸口闷',
      'scene_congruence=4|4|有时候会突然坐起来',
      'relational_presence=3|2|不太好',
      'overall=4',
    ].join('\n');
    const parsed = parseRealismRatingLines(raw, packet);
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.error).toContain('evidence_turn_not_visitor');
  });
});
