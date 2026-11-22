// V2026-11-22 建立 (AF-311 · Lite 评分 prompt V2 契约单测，承接 AF-295/AF-299 两次号段冲突前的 V2 实现):
//   只验证 V2 的评分阶梯、全 4 复核、overall 规则与 V1 保留；
//   不调用模型、不发网络请求、不改共享 prompt 与既有阈值。

import { describe, expect, it } from 'vitest';

import { LITE_PROMPT_VERSION, LITE_PROMPT_VERSION_V2, buildLiteRaterPrompt } from '../../bin/realism-rater-lite-prompt.js';
import {
  REALISM_DIMENSIONS,
  parseRealismRatingLines,
  type RealismBlindPacket,
} from '../../src/auto-practice/metrics/visitor-realism-rating.js';

const packet: RealismBlindPacket = {
  packetId: 'pkt-lite-v2-001',
  scene: 'online_voice',
  turns: [
    { turnIndex: 1, role: 'counselor', text: '你最近睡得怎么样？' },
    { turnIndex: 2, role: 'visitor', text: '嗯……不太好，躺下就开始想工作。' },
    { turnIndex: 3, role: 'counselor', text: '想工作的时候，身体有什么感觉？' },
    { turnIndex: 4, role: 'visitor', text: '胸口闷，有时候会突然坐起来。' },
    { turnIndex: 5, role: 'counselor', text: '这种不舒服持续多久了？' },
    { turnIndex: 6, role: 'visitor', text: '嗯……说不上来，就是不想接他电话。' },
  ],
};

describe('AF-295 · Lite 评分 prompt V2', () => {
  it('V2 版本号独立，默认仍是 V1 以保留 A/B', () => {
    expect(LITE_PROMPT_VERSION_V2).toBe('lite-rubric-v2');
    expect(LITE_PROMPT_VERSION).toBe('lite-rubric-v1');
    const v1 = buildLiteRaterPrompt(packet, 'R1', 'lite-v1').system;
    const v2 = buildLiteRaterPrompt(packet, 'R1', 'lite-v2').system;
    expect(v1).toContain('【不要默认给 3 分】');
    expect(v1).not.toContain('【V2 评分阶梯】');
    expect(v2).toContain('【V2 评分阶梯】');
    expect(v2).not.toContain('【不要默认给 3 分】');
  });

  it('V2 阶梯整体下移：5=4 条、4=恰好 3 条、3=≤2 条、2/1 按 1 分档', () => {
    const { system } = buildLiteRaterPrompt(packet, 'R1', 'lite-v2');
    expect(system).toContain('5 分 = 命中 5 分档 ≥4 条，且无任何 1 分档特征');
    expect(system).toContain('4 分 = 命中 5 分档恰好 3 条，且无任何 1 分档特征');
    expect(system).toContain('3 分 = 命中 5 分档 ≤2 条，且无任何 1 分档特征');
    expect(system).toContain('2 分 = 命中 1 分档 1 条');
    expect(system).toContain('1 分 = 命中 1 分档 ≥2 条');
    expect(system).toContain('覆盖上方清单里的「≥3 条给 5、2 条给 4」旧口径');
    expect(system).toContain('五维最多 2 维给 5 分');
    expect(system).toContain('第 3 维即使命中 ≥4 条，也压到 4 分');
  });

  it('全 4 必须复核最弱维：1 分档压 2/1，≤2 条压 3，仅稳定 3 条保留 4', () => {
    const { system } = buildLiteRaterPrompt(packet, 'R1', 'lite-v2');
    expect(system).toContain('【全 4 必须复核】');
    expect(system).toContain('五维全为 4 时，必须停下来复核最弱的那一维');
    expect(system).toContain('命中任一 1 分档特征：压到 2 分；命中 ≥2 条则压到 1 分');
    expect(system).toContain('最弱维命中 5 分档 ≤2 条：压到 3 分');
    expect(system).toContain('只有最弱维也稳定命中 5 分档 ≥3 条且无 1 分档特征，才保留 4 分');
    expect(system).toContain('复核后至少一维发生变化');
  });

  it('overall 跟最突出维度/最低维度/中位数，不取平均', () => {
    const { system } = buildLiteRaterPrompt(packet, 'R1', 'lite-v2');
    expect(system).toContain('【overall 规则】');
    expect(system).toContain('任一维为 5 且没有维度 ≤2：overall=5');
    expect(system).toContain('任一维 ≤2：overall 取最低的那一维分数');
    expect(system).toContain('overall 取第 3 个（中位数），不取算术平均');
    expect(system).toContain('overall 必须能从五维分数直接复算');
  });

  it('五维清单、证据规则、行协议与 V1 完全共用', () => {
    const { system } = buildLiteRaterPrompt(packet, 'R1', 'lite-v2');
    for (const dimension of REALISM_DIMENSIONS) {
      expect(system).toContain(dimension);
    }
    expect(system).toContain('【证据规则】');
    expect(system).toContain('五维各给一条证据，一条都不能少');
    expect(system).toContain('【输出：行协议】');
    expect(system).toContain('第一行必须是 naturalness=');
    expect(system).toContain('不要 JSON、不要 markdown、不要解释、不要分析过程、不要 <think>');
  });

  it('V2 字数受控，且行协议输出仍可被现有解析器直接解析', () => {
    const { system } = buildLiteRaterPrompt(packet, 'R1', 'lite-v2');
    expect(system.length).toBeLessThanOrEqual(3200);
    const raw = [
      'naturalness=3|2|嗯……不太好',
      'emotional_continuity=3|6|说不上来',
      'turn_shape=3|4|胸口闷',
      'scene_congruence=4|4|有时候会突然坐起来',
      'relational_presence=3|2|不太好',
      'overall=3',
      'notes=全 4 复核后最弱维下调。',
    ].join('\n');
    const parsed = parseRealismRatingLines(raw, packet);
    if (!parsed.ok) throw new Error(`行协议应可解析：${parsed.error}`);
    expect(parsed.rating.overall).toBe(3);
    expect(Object.keys(parsed.rating.dimensions)).toHaveLength(5);
    expect(parsed.rating.dimensions.scene_congruence.score).toBe(4);
  });
});
