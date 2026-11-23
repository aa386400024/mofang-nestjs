import type { ConfigService } from '@nestjs/config';
import type { Repository } from 'typeorm';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { DebugSessionService } from '../../src/admin-debug/debug-session.service.js';
import { AdminDebugTtsRenderEntity } from '../../src/admin-debug/tts/admin-debug-tts-render.entity.js';
import { synthesizeDoubao, synthesizeMiniMax } from '../../src/admin-debug/tts/debug-tts.providers.js';
import { DebugTtsService } from '../../src/admin-debug/tts/debug-tts.service.js';
import { PracticeSession } from '../../src/auto-practice/entities/practice-session.entity.js';
import { PracticeTurn } from '../../src/auto-practice/entities/practice-turn.entity.js';

afterEach(() => vi.unstubAllGlobals());

function configStub(overrides: Record<string, unknown> = {}): ConfigService {
  const values: Record<string, unknown> = {
    MINIMAX_API_KEY: 'mini-key',
    MINIMAX_TTS_VOICE_ID: 'Chinese (Mandarin)_Warm_Girl',
    'minimax.baseUrl': 'https://api.minimax.cn',
    'minimax.ttsSpeed': 1,
    'minimax.ttsVolume': 1,
    'minimax.ttsPitch': 0,
    ...overrides,
  };
  return { get: <T>(key: string): T | undefined => values[key] as T | undefined } as unknown as ConfigService;
}

function baseInput(text: string) {
  return {
    text,
    voiceId: 'Chinese (Mandarin)_Warm_Girl',
    emotion: 'sad',
    model: 'speech-2.8-hd',
    speed: 1,
    volume: 1,
    pitch: 0,
    sampleRate: 24_000,
    apiKey: 'mini-key',
    baseUrl: 'https://api.minimax.cn',
  };
}

describe('AF-395 调试 TTS provider 协议', () => {
  it('MiniMax 请求体带模型/音色/情绪，hex 音频被解码', async () => {
    let captured: unknown;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: { body?: string }) => {
        captured = JSON.parse(init.body ?? '{}');
        return Response.json(
          {
            data: { audio: 'ff00' },
            extra_info: { audio_length: 120 },
            base_resp: { status_code: 0 },
          },
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }),
    );
    const out = await synthesizeMiniMax(baseInput('你好'), 'minimax-hd');
    expect(captured).toMatchObject({
      model: 'speech-2.8-hd',
      text: '你好',
      voice_setting: { voice_id: 'Chinese (Mandarin)_Warm_Girl', emotion: 'sad' },
      audio_setting: { format: 'mp3', sample_rate: 24_000 },
    });
    expect(out.audio.equals(Buffer.from([255, 0]))).toBe(true);
    expect(out.durationMs).toBe(120);
  });

  it('豆包走 Agent Plan 头，context_texts 只取第一条语义情绪，分片 base64 拼接', async () => {
    let capturedUrl = '';
    let capturedHeaders: Record<string, string> = {};
    let capturedBody: unknown;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: { headers?: Record<string, string>; body?: string }) => {
        capturedUrl = url;
        capturedHeaders = init.headers ?? {};
        capturedBody = JSON.parse(init.body ?? '{}');
        return new Response(
          [
            JSON.stringify({ code: 0, data: Buffer.from([1, 2]).toString('base64') }),
            JSON.stringify({ code: 20_000_000, data: Buffer.from([3]).toString('base64'), usage: { text_words: 2 } }),
            '',
          ].join('\n'),
          { status: 200, headers: { 'content-type': 'text/plain' } },
        );
      }),
    );
    const input = {
      ...baseInput('你好'),
      text: '你好',
      voiceId: 'zh_female_vv_uranus_bigtts',
      model: 'doubao-seed-tts-2.0',
      apiKey: 'ark-key',
      baseUrl: 'https://openspeech.bytedance.com/api/v3/plan/tts/unidirectional',
    };
    const out = await synthesizeDoubao(input, 'doubao-seed-tts-2.0');
    expect(capturedUrl).toContain('/api/v3/plan/tts/unidirectional');
    expect(capturedHeaders['X-Api-Resource-Id']).toBe('seed-tts-2.0');
    expect(capturedBody).toMatchObject({
      req_params: {
        speaker: 'zh_female_vv_uranus_bigtts',
        text: '你好',
        context_texts: ['请用低落、克制的语气说这句话。'],
      },
    });
    expect(out.audio.equals(Buffer.from([1, 2, 3]))).toBe(true);
    expect(out.usage).toEqual({ text_words: 2 });
  });
});

describe('AF-395 缓存闭环', () => {
  it('同一会话同一轮同一模型二次调用不再打上游', async () => {
    const rows: AdminDebugTtsRenderEntity[] = [];
    const renderRepo = {
      create: (x: AdminDebugTtsRenderEntity) => x,
      insert: async (x: AdminDebugTtsRenderEntity) => {
        rows.push(x);
      },
      findOne: async ({ where }: { where: Partial<AdminDebugTtsRenderEntity> }) =>
        rows.find((row) => Object.entries(where).every(([k, v]) => (row as unknown as Record<string, unknown>)[k] === v)) ?? null,
    } as unknown as Repository<AdminDebugTtsRenderEntity>;
    const turnRepo = {
      findOne: async () =>
        ({
          practiceSessionId: 'p1',
          turnIndex: 1,
          visitorDisplayText: '我最近睡不好',
          visitorTtsText: '我最近睡不好',
          visitorSemanticJson: JSON.stringify({ emotion: 'sad' }),
        }) as PracticeTurn,
    } as unknown as Repository<PracticeTurn>;
    const practiceRepo = {
      findOne: async () => ({ id: 'p1', characterSlug: 'vpt_grief_avoidance_l1' }) as PracticeSession,
    } as unknown as Repository<PracticeSession>;
    const dataSource = {
      getRepository: (entity: unknown) => (entity === PracticeTurn ? turnRepo : practiceRepo),
    } as unknown as import('typeorm').DataSource;
    const debugSessions = {} as DebugSessionService;
    let calls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        calls += 1;
        return Response.json(
          {
            data: { audio: 'ff' },
            base_resp: { status_code: 0 },
          },
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }),
    );
    const service = new DebugTtsService(renderRepo, dataSource, debugSessions, configStub());
    const first = await service.render('auto_practice', 'p1', 1, 'minimax-hd');
    const second = await service.render('auto_practice', 'p1', 1, 'minimax-hd');
    expect(first.cached).toBe(false);
    expect(second.cached).toBe(true);
    expect(calls).toBe(1);
  });

  it('旧版 MiniMax 音色回退到 2.8 可用音色，calm 映射为 neutral', async () => {
    let captured: { voice_setting?: { voice_id?: string; emotion?: string } } = {};
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: { body?: string }) => {
        captured = JSON.parse(init.body ?? '{}');
        return Response.json(
          { data: { audio: 'ff' }, base_resp: { status_code: 0 } },
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          },
        );
      }),
    );
    const renderRepo = {
      create: (x: AdminDebugTtsRenderEntity) => x,
      insert: async () => {},
      findOne: async () => null,
    } as unknown as Repository<AdminDebugTtsRenderEntity>;
    const turnRepo = {
      findOne: async () =>
        ({
          practiceSessionId: 'p1',
          turnIndex: 1,
          visitorDisplayText: '我有点累',
          visitorTtsText: '我有点累',
          visitorSemanticJson: JSON.stringify({ emotion: 'calm' }),
        }) as PracticeTurn,
    } as unknown as Repository<PracticeTurn>;
    const practiceRepo = {
      findOne: async () => ({ id: 'p1', characterSlug: 'vpt_grief_avoidance_l1' }) as PracticeSession,
    } as unknown as Repository<PracticeSession>;
    const dataSource = {
      getRepository: (entity: unknown) => (entity === PracticeTurn ? turnRepo : practiceRepo),
    } as unknown as import('typeorm').DataSource;
    const service = new DebugTtsService(
      renderRepo,
      dataSource,
      {} as DebugSessionService,
      configStub({ MINIMAX_TTS_VOICE_ID: 'mandarin_female_001' }),
    );
    await service.render('auto_practice', 'p1', 1, 'minimax-turbo');
    expect(captured.voice_setting).toMatchObject({
      voice_id: 'Chinese (Mandarin)_Warm_Girl',
      emotion: 'neutral',
    });
  });
});
