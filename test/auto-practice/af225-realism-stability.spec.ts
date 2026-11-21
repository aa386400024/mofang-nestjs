// V2026-11-21 建立 (AF-225 · R6-B 评分稳定性):
//   只验证稳定性契约：思考块整包无效可诊断、缺维仍可定位、compact 重试仍是行协议、
//   packetId 精确筛选不改变盲评包内容。

import { describe, expect, it } from 'vitest';

import { filterPacketsByIds } from '../../src/auto-practice/metrics/visitor-realism-packet-filter.js';
import {
  REALISM_DIMENSIONS,
  buildRealismRaterCompactPrompt,
  parseRealismRatingLines,
  type RealismBlindPacket,
} from '../../src/auto-practice/metrics/visitor-realism-rating.js';

const packet: RealismBlindPacket = {
  packetId: 'pkt-af225',
  scene: 'in_person',
  turns: [
    { turnIndex: 1, role: 'counselor', text: '你最近睡得怎么样？' },
    { turnIndex: 2, role: 'visitor', text: '嗯……不太好，躺下就开始想工作。' },
    { turnIndex: 3, role: 'counselor', text: '想工作的时候，身体有什么感觉？' },
    { turnIndex: 4, role: 'visitor', text: '胸口闷，有时候会突然坐起来。' },
  ],
};

function lines(omit?: string): string {
  const rows = [
    'naturalness=4|2|嗯……不太好',
    'emotional_continuity=3|4|胸口闷',
    'turn_shape=4|2|躺下就开始想工作',
    'scene_congruence=4|4|有时候会突然坐起来',
    'relational_presence=3|2|不太好',
    'overall=4',
  ];
  return rows.filter((row) => (omit ? !row.startsWith(`${omit}=`) : true)).join('\n');
}

describe('AF-225 · 输出诊断', () => {
  it('只有思考块、没有任何维度行 → no_protocol_lines', () => {
    const raw = '<think>我在想这个来访者是不是自然……'.repeat(80);
    expect(parseRealismRatingLines(raw, packet)).toMatchObject({ ok: false, error: 'no_protocol_lines' });
  });

  it('已有维度行但缺自然度 → dimension_missing:naturalness', () => {
    expect(parseRealismRatingLines(lines('naturalness'), packet)).toMatchObject({
      ok: false,
      error: 'dimension_missing:naturalness',
    });
  });

  it('五维齐全仍按行协议解析，quote 必须可定位', () => {
    expect(parseRealismRatingLines(lines(), packet).ok).toBe(true);
  });
});

describe('AF-225 · compact 重试提示词', () => {
  it('仍是行协议、五维齐全、明确禁止思考与 JSON', () => {
    const prompt = buildRealismRaterCompactPrompt(packet, 'R1', 'truncated:no_protocol_lines');
    expect(prompt.system).toContain('不要思考');
    expect(prompt.system).toContain('不要 JSON');
    expect(prompt.system).toContain('第一行必须是 naturalness=');
    for (const dimension of REALISM_DIMENSIONS) expect(prompt.system).toContain(dimension);
    expect(prompt.system).toContain('quote 最多 12');
    expect(prompt.user).toContain('packetId：pkt-af225');
  });

  it('不放宽证据校验：仍要求 quote 原样来自指定轮次', () => {
    const prompt = buildRealismRaterCompactPrompt(packet, 'R2', 'dimension_missing:naturalness');
    expect(prompt.system).toContain('必须原样引用来访者台词');
    expect(prompt.system).toContain('不得编造');
  });
});

describe('AF-225 · packetId 精确筛选', () => {
  it('只返回命中的 packet，并报告缺失 ID', () => {
    const other: RealismBlindPacket = { ...packet, packetId: 'pkt-other' };
    const result = filterPacketsByIds([packet, other], ['pkt-af225', 'pkt-missing']);
    expect(result.selected.map((item) => item.packetId)).toEqual(['pkt-af225']);
    expect(result.missing).toEqual(['pkt-missing']);
  });

  it('不改变 packet 内容（无重新抽样）', () => {
    const result = filterPacketsByIds([packet], ['pkt-af225']);
    expect(result.selected[0]).toBe(packet);
  });
});
