import { describe, expect, it } from 'vitest';

import { resolveDebugRealismScene } from '../../bin/realism-scene-loader.js';

describe('AF-226 debug realism scene loader', () => {
  it('prefers explicit encounter over prompt fallback', () => {
    const prompt = '<场景> 保持同步语音感：像在电话里说话';
    expect(
      resolveDebugRealismScene({ encounter: { mode: 'online', channel: 'text' }, traces: [{ renderSpec: { promptFull: prompt } }] }),
    ).toBe('online_text');
  });

  it('maps online voice and video to online_voice', () => {
    expect(resolveDebugRealismScene({ encounter: { mode: 'online', channel: 'voice' } })).toBe('online_voice');
    expect(resolveDebugRealismScene({ encounter: { mode: 'online', channel: 'video' } })).toBe('online_voice');
  });

  it('keeps legacy scene fields as top priority', () => {
    expect(resolveDebugRealismScene({ scene: 'in_person', encounter: { mode: 'online', channel: 'text' } })).toBe('in_person');
    expect(resolveDebugRealismScene({ realismScene: 'online_text', encounter: { mode: 'online', channel: 'voice' } })).toBe('online_text');
  });

  it('falls back to prompt scene layer when encounter is absent', () => {
    expect(resolveDebugRealismScene({ traces: [{ renderSpec: { promptFull: '保持文字咨询感' } }] })).toBe('online_text');
    expect(resolveDebugRealismScene({ traces: [{ renderSpec: { promptFull: '保持同步语音感' } }] })).toBe('online_voice');
  });

  it('defaults to in_person for legacy sessions without any scene signal', () => {
    expect(resolveDebugRealismScene({})).toBe('in_person');
    expect(resolveDebugRealismScene({ encounter: { mode: 'in_person' } })).toBe('in_person');
  });

  it('ignores malformed encounter instead of guessing online', () => {
    expect(resolveDebugRealismScene({ encounter: {} })).toBe('in_person');
    expect(resolveDebugRealismScene({ encounter: 'online' })).toBe('in_person');
  });
});
