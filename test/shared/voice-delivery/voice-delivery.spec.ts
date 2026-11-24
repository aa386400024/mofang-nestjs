// AF-460: 交付档案与三家渲染器（纯函数）.
import {
  buildVoiceDeliveryProfile,
  renderDoubaoDelivery,
  renderMiniMaxDelivery,
  toDoubaoAudioParams,
  toMiniMaxVoiceSetting,
} from '../../../src/shared/voice-delivery/index.js';

describe('AF-460 · voice delivery profile', () => {
  it('同一轮重放参数不漂移', () => {
    const input = { sessionId: 's1', turnIndex: 3, emotion: 'sad', style: 'avoidant', difficulty: 'L3' };
    expect(buildVoiceDeliveryProfile(input)).toEqual(buildVoiceDeliveryProfile(input));
  });

  it('回避 + L3 比配合 + L1 更慢、更轻、更低', () => {
    const avoidant = buildVoiceDeliveryProfile({ sessionId: 's1', turnIndex: 1, emotion: 'calm', style: 'avoidant', difficulty: 'L3' });
    const cooperative = buildVoiceDeliveryProfile({
      sessionId: 's1',
      turnIndex: 1,
      emotion: 'calm',
      style: 'cooperative',
      difficulty: 'L1',
    });
    expect(avoidant.speed).toBeLessThan(cooperative.speed);
    expect(avoidant.volume).toBeLessThan(cooperative.volume);
    expect(avoidant.pitch).toBeLessThan(cooperative.pitch);
  });

  it('参数始终落在 MiniMax 可用区间内', () => {
    const profiles = [
      buildVoiceDeliveryProfile({
        sessionId: 's1',
        turnIndex: 1,
        emotion: 'angry',
        style: 'resistant',
        difficulty: 'L3',
        valence: -1,
        arousal: 1,
      }),
      buildVoiceDeliveryProfile({
        sessionId: 's1',
        turnIndex: 1,
        emotion: 'happy',
        style: 'cooperative',
        difficulty: 'L1',
        valence: 1,
        arousal: 0.9,
      }),
    ];
    for (const profile of profiles) {
      expect(profile.speed).toBeGreaterThanOrEqual(0.86);
      expect(profile.speed).toBeLessThanOrEqual(1.08);
      expect(profile.volume).toBeGreaterThanOrEqual(0.88);
      expect(profile.volume).toBeLessThanOrEqual(1.06);
      expect(profile.pitch).toBeGreaterThanOrEqual(-3);
      expect(profile.pitch).toBeLessThanOrEqual(2);
    }
  });

  it('豆包风格指令明确压播音腔，且只有一条', () => {
    const profile = buildVoiceDeliveryProfile({ sessionId: 's1', turnIndex: 1, emotion: 'sad', style: 'avoidant', difficulty: 'L2' });
    expect(profile.contextText).toContain('不要新闻播报或播音腔');
    expect(profile.contextText).toContain('真实来访者的口吻');
  });
});

describe('AF-460 · provider 渲染器', () => {
  it('MiniMax 参数映射 + emotion 下发', () => {
    const profile = buildVoiceDeliveryProfile({ sessionId: 's1', turnIndex: 1, emotion: 'sad' });
    expect(toMiniMaxVoiceSetting(profile)).toMatchObject({
      speed: profile.speed,
      vol: profile.volume,
      pitch: profile.pitch,
      emotion: 'sad',
    });
  });

  it('豆包 2.0 参数映射成官方相对值，且夹在范围内', () => {
    const profile = buildVoiceDeliveryProfile({ sessionId: 's1', turnIndex: 1, emotion: 'happy', style: 'cooperative' });
    const params = toDoubaoAudioParams(profile);
    expect(params.speech_rate).toBeGreaterThanOrEqual(-50);
    expect(params.speech_rate).toBeLessThanOrEqual(100);
    expect(params.pitch_rate).toBeGreaterThanOrEqual(-12);
    expect(params.pitch_rate).toBeLessThanOrEqual(12);
  });

  it('MiniMax 保留长沉默标记，豆包明确标注不落地', () => {
    const profile = buildVoiceDeliveryProfile({ sessionId: 's1', turnIndex: 1, emotion: 'calm' });
    const minimax = renderMiniMaxDelivery('我不知道。[silence:5.2]可能吧。', profile);
    expect(minimax.ttsText).toContain('<#5.2#>');
    expect(minimax.appliedSilenceMs).toBe(5200);
    const doubao = renderDoubaoDelivery('我不知道。[silence:5.2]可能吧。');
    expect(doubao.ttsText).toBe('我不知道。可能吧。');
    expect(doubao.appliedSilenceMs).toBe(0);
    expect(doubao.notes.join('')).toContain('不支持句内长沉默');
  });

  it('MiniMax 句末长沉默不伪造标签（由流式下发节奏承接）', () => {
    const profile = buildVoiceDeliveryProfile({ sessionId: 's1', turnIndex: 1, emotion: 'calm' });
    const trailing = renderMiniMaxDelivery('我不知道。[silence:5.2]', profile);
    expect(trailing.ttsText).toBe('我不知道。');
    expect(trailing.appliedSilenceMs).toBe(0);
    expect(trailing.notes.join('')).toContain('流式链路');
  });
});
