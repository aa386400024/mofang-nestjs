// V2026-11-21 建立 (AF-214 · R5 盲评包):
//   只验证去身份、分层抽样、硬违约剔除与可复算，不绑定真实批次数字。

import { describe, expect, it } from 'vitest';

import { buildRealismBlindPackets } from '../../src/auto-practice/metrics/visitor-realism-blind-pack.js';

function session(id: string, scene: 'in_person' | 'online_voice' | 'online_text', visitorTurns: string[]) {
  const messages = [];
  for (const [index, text] of visitorTurns.entries()) {
    messages.push({ role: 'counselor' as const, text: `咨询师第 ${index + 1} 句。` }, { role: 'visitor' as const, text });
  }
  return { sessionId: id, scene, prompt: null, messages };
}

describe('AF-214 · 盲评包构造', () => {
  const clean = [
    session('secret-A', 'in_person', ['嗯……我最近睡不好。', '躺下就开始想工作。', '胸口有点闷。']),
    session('secret-B', 'online_voice', ['我听见你说话了。', '有点不知道该从哪说。', '先说工作吧。']),
    session('secret-C', 'online_text', ['我在打字。', '刚才删了一次。', '还是想问，你会怎么看我。']),
  ];

  it('按场景分层轮转抽包，不饿死小场景', () => {
    const result = buildRealismBlindPackets(clean, { maxPackets: 3, seed: 7 });
    expect(result.packets).toHaveLength(3);
    expect(result.packets.map((packet) => packet.scene).sort()).toEqual(['in_person', 'online_text', 'online_voice']);
    expect(result.excluded).toEqual({ too_short: 0, hard_violation: 0, no_counselor: 0, empty: 0 });
  });

  it('同输入同 seed 复算完全一致', () => {
    const first = buildRealismBlindPackets(clean, { maxPackets: 3, seed: 7 });
    const second = buildRealismBlindPackets(clean, { maxPackets: 3, seed: 7 });
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });

  it('含 prompt 回显的会话整场剔除，不把脏台词送进评分', () => {
    const result = buildRealismBlindPackets(
      [...clean, session('secret-dirty', 'in_person', ['关键事件：今天被领导批评了。', '我不想说这个。', '换个话题吧。'])],
      { maxPackets: 8, seed: 7 },
    );
    expect(result.packets.map((packet) => packet.packetId)).not.toContain('secret-dirty');
    expect(result.excluded.hard_violation).toBe(1);
  });

  it('来访者轮次不足、没有咨询师、空会话分别计数', () => {
    const result = buildRealismBlindPackets(
      [
        session('short', 'in_person', ['只说一句。']),
        {
          sessionId: 'no-counselor',
          scene: 'in_person',
          prompt: null,
          messages: [
            { role: 'visitor', text: '一个人说。' },
            { role: 'visitor', text: '继续说。' },
            { role: 'visitor', text: '还在说。' },
          ],
        },
        { sessionId: 'empty', scene: 'in_person', prompt: null, messages: [] },
      ] as never,
      { maxPackets: 2, minVisitorTurns: 3 },
    );
    expect(result.excluded).toMatchObject({ too_short: 1, no_counselor: 1, empty: 1 });
    expect(result.packets).toHaveLength(0);
  });

  it('packet 序列化后不含 session id / 角色 slug / 档位', () => {
    const result = buildRealismBlindPackets(clean, { maxPackets: 3, seed: 7 });
    const serialized = JSON.stringify(result.packets);
    expect(serialized).not.toContain('secret-');
    expect(serialized).not.toContain('characterSlug');
    expect(serialized).not.toContain('characterLabel');
    expect(serialized).not.toContain('counselorLevel');
    expect(serialized).toContain('packetId');
    expect(serialized).toContain('scene');
  });

  it('没有场景层时回落面对面', () => {
    const result = buildRealismBlindPackets([{ sessionId: 'legacy', prompt: null, messages: clean[0].messages }], { maxPackets: 1 });
    expect(result.packets[0]?.scene).toBe('in_person');
  });
});
