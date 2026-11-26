import { describe, expect, it } from 'vitest';

import {
  buildDoubaoFrame,
  DOUBAO_EVENT,
  DOUBAO_MSG_TYPE_AUDIO_ONLY,
  DOUBAO_MSG_TYPE_ERROR,
  DOUBAO_MSG_TYPE_FULL_CLIENT,
  DOUBAO_SERIALIZATION_JSON,
  DOUBAO_SERIALIZATION_RAW,
  parseDoubaoFrame,
} from '../../src/voice/tts/doubao-tts-protocol.js';

describe('豆包 V3 bidi 协议帧', () => {
  it('构造 StartConnection：无 id，JSON payload，event=1', () => {
    const frame = buildDoubaoFrame({
      messageType: DOUBAO_MSG_TYPE_FULL_CLIENT,
      event: DOUBAO_EVENT.StartConnection,
      serialization: DOUBAO_SERIALIZATION_JSON,
      payload: '{}',
    });
    expect(frame.readUInt8(0)).toBe(0x11);
    expect(frame.readUInt8(1) >> 4).toBe(DOUBAO_MSG_TYPE_FULL_CLIENT);
    expect(frame.readUInt8(1) & 15).toBe(0x4);
    expect(frame.readUInt32BE(4)).toBe(DOUBAO_EVENT.StartConnection);
    expect(frame.subarray(8, 12).readUInt32BE(0)).toBe(2);
  });

  it('会话帧带 session_id，解析后保留 sessionId 与 JSON', () => {
    const frame = buildDoubaoFrame({
      messageType: DOUBAO_MSG_TYPE_FULL_CLIENT,
      event: DOUBAO_EVENT.StartSession,
      sessionId: 'sess-1',
      serialization: DOUBAO_SERIALIZATION_JSON,
      payload: JSON.stringify({ event: DOUBAO_EVENT.StartSession, req_params: {} }),
    });
    const parsed = parseDoubaoFrame(frame);
    expect(parsed.kind).toBe('session');
    expect(parsed.sessionId).toBe('sess-1');
    expect(parsed.event).toBe(DOUBAO_EVENT.StartSession);
    expect(parsed.json).toMatchObject({ event: DOUBAO_EVENT.StartSession });
  });

  it('音频帧按 raw 解析，不尝试 JSON', () => {
    const audio = Buffer.from([1, 2, 3, 4, 5]);
    const frame = buildDoubaoFrame({
      messageType: DOUBAO_MSG_TYPE_AUDIO_ONLY,
      event: DOUBAO_EVENT.TTSResponse,
      sessionId: 'sess-1',
      serialization: DOUBAO_SERIALIZATION_RAW,
      payload: audio,
    });
    const parsed = parseDoubaoFrame(frame);
    expect(parsed.kind).toBe('audio');
    expect(parsed.sessionId).toBe('sess-1');
    expect(parsed.payload.equals(audio)).toBe(true);
    expect(parsed.json).toBeUndefined();
  });

  it('句级事件被正确分类', () => {
    const start = parseDoubaoFrame(
      buildDoubaoFrame({
        messageType: DOUBAO_MSG_TYPE_FULL_CLIENT,
        event: DOUBAO_EVENT.TTSSentenceStart,
        sessionId: 'sess-1',
        serialization: DOUBAO_SERIALIZATION_JSON,
        payload: JSON.stringify({ text: '你好' }),
      }),
    );
    expect(start.kind).toBe('sentence-start');
    expect(start.json).toMatchObject({ text: '你好' });
  });

  it('错误帧解析 errorCode 与 payload', () => {
    const payload = Buffer.from(JSON.stringify({ message: 'bad voice' }), 'utf8');
    const frame = Buffer.alloc(12 + payload.length);
    frame.writeUInt8(0x11, 0);
    frame.writeUInt8(DOUBAO_MSG_TYPE_ERROR << 4, 1);
    frame.writeUInt8(DOUBAO_SERIALIZATION_JSON << 4, 2);
    frame.writeUInt8(0, 3);
    frame.writeUInt32BE(45_000_002, 4);
    frame.writeUInt32BE(payload.length, 8);
    payload.copy(frame, 12);

    const parsed = parseDoubaoFrame(frame);
    expect(parsed.kind).toBe('error');
    expect(parsed.errorCode).toBe(45_000_002);
    expect(parsed.json).toMatchObject({ message: 'bad voice' });
  });

  it('截断帧抛错，不静默吞掉', () => {
    expect(() => parseDoubaoFrame(Buffer.from([0x11, 0x14]))).toThrow('帧过短');
  });
});
