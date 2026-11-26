/**
 * 豆包 V3 双向流式 TTS 二进制协议 — 纯编解码, 不做网络与状态机.
 *
 * 帧结构 (大端):
 *   0: version(高4) | headerSize/4(低4)   = 0x11
 *   1: messageType(高4) | flags(低4)      = 0x14 (full client + event)
 *   2: serialization(高4) | compression(低4) = 0x10 (JSON + 无压缩)
 *   3: reserved
 *   4..7: event (int32)
 *   [8..]: optional id length + id (connection/session), payload size + payload
 *
 * 协议事实来自火山官方《WebSocket 双向流式-V3》: 连接类事件带 connection_id,
 * 会话类事件带 session_id, 音频帧是 raw payload. 本文件只认官方事件码,
 * 未识别事件返回 `unknown`, 由客户端决定 warn/忽略, 不猜测语义.
 */

export const DOUBAO_PROTOCOL_VERSION = 0x1;
export const DOUBAO_HEADER_SIZE_UNITS = 0x1;
export const DOUBAO_MSG_TYPE_FULL_CLIENT = 0x1;
export const DOUBAO_MSG_TYPE_FULL_SERVER = 9;
export const DOUBAO_MSG_TYPE_AUDIO_ONLY = 11;
export const DOUBAO_MSG_TYPE_ERROR = 15;
export const DOUBAO_FLAG_EVENT = 0x4;
export const DOUBAO_SERIALIZATION_JSON = 0x1;
export const DOUBAO_SERIALIZATION_RAW = 0x0;
export const DOUBAO_COMPRESSION_NONE = 0x0;

/** 官方事件码. */
export const DOUBAO_EVENT = {
  StartConnection: 1,
  FinishConnection: 2,
  ConnectionStarted: 50,
  ConnectionFailed: 51,
  ConnectionFinished: 52,
  StartSession: 100,
  CancelSession: 101,
  FinishSession: 102,
  SessionStarted: 150,
  SessionCanceled: 151,
  SessionFinished: 152,
  SessionFailed: 153,
  TaskRequest: 200,
  TTSSentenceStart: 350,
  TTSSentenceEnd: 351,
  TTSResponse: 352,
} as const;

export type DoubaoEventCode = (typeof DOUBAO_EVENT)[keyof typeof DOUBAO_EVENT];

/** 解析后的帧. */
export interface DoubaoParsedFrame {
  readonly messageType: number;
  readonly flags: number;
  readonly serialization: number;
  readonly compression: number;
  readonly event: number;
  readonly connectionId?: string;
  readonly sessionId?: string;
  readonly errorCode?: number;
  readonly payload: Buffer;
  /** JSON payload 解析结果; 非 JSON / 解析失败为 undefined. */
  readonly json?: unknown;
  readonly kind: 'connection' | 'session' | 'sentence-start' | 'sentence-end' | 'audio' | 'error' | 'unknown';
}

/** 构造帧参数. */
export interface DoubaoFrameInput {
  readonly messageType: number;
  readonly event: number;
  readonly serialization?: number;
  readonly sessionId?: string;
  readonly connectionId?: string;
  readonly payload?: Buffer | string;
}

/** 判断事件是否连接类 (带 connection_id). */
export function isDoubaoConnectionEvent(event: number): boolean {
  return (
    event === DOUBAO_EVENT.StartConnection ||
    event === DOUBAO_EVENT.FinishConnection ||
    event === DOUBAO_EVENT.ConnectionStarted ||
    event === DOUBAO_EVENT.ConnectionFailed ||
    event === DOUBAO_EVENT.ConnectionFinished
  );
}

/** 判断事件是否会话类 (带 session_id). */
export function isDoubaoSessionEvent(event: number): boolean {
  return (
    event === DOUBAO_EVENT.StartSession ||
    event === DOUBAO_EVENT.CancelSession ||
    event === DOUBAO_EVENT.FinishSession ||
    event === DOUBAO_EVENT.SessionStarted ||
    event === DOUBAO_EVENT.SessionCanceled ||
    event === DOUBAO_EVENT.SessionFinished ||
    event === DOUBAO_EVENT.SessionFailed ||
    event === DOUBAO_EVENT.TaskRequest ||
    event === DOUBAO_EVENT.TTSSentenceStart ||
    event === DOUBAO_EVENT.TTSSentenceEnd ||
    event === DOUBAO_EVENT.TTSResponse
  );
}

/** 事件 -> 语义类别. */
export function classifyDoubaoEvent(event: number): DoubaoParsedFrame['kind'] {
  if (isDoubaoConnectionEvent(event)) return 'connection';
  if (event === DOUBAO_EVENT.TTSSentenceStart) return 'sentence-start';
  if (event === DOUBAO_EVENT.TTSSentenceEnd) return 'sentence-end';
  if (event === DOUBAO_EVENT.TTSResponse) return 'audio';
  if (isDoubaoSessionEvent(event)) return 'session';
  return 'unknown';
}

/**
 * 构造上行帧.
 *
 * @param input 帧参数
 * @returns 二进制帧
 */
export function buildDoubaoFrame(input: DoubaoFrameInput): Buffer {
  const payload = typeof input.payload === 'string' ? Buffer.from(input.payload, 'utf8') : (input.payload ?? Buffer.alloc(0));
  const serialization = input.serialization ?? (typeof input.payload === 'string' ? DOUBAO_SERIALIZATION_JSON : DOUBAO_SERIALIZATION_RAW);

  const idValue = input.connectionId ?? input.sessionId;
  const idBytes = idValue === undefined ? null : Buffer.from(idValue, 'utf8');

  const headerBytes = 4 + 4 + (idBytes ? 4 + idBytes.length : 0) + 4 + payload.length;
  const frame = Buffer.alloc(headerBytes);
  frame.writeUInt8((DOUBAO_PROTOCOL_VERSION << 4) | DOUBAO_HEADER_SIZE_UNITS, 0);
  frame.writeUInt8((input.messageType << 4) | DOUBAO_FLAG_EVENT, 1);
  frame.writeUInt8((serialization << 4) | DOUBAO_COMPRESSION_NONE, 2);
  frame.writeUInt8(0, 3);
  frame.writeUInt32BE(input.event, 4);
  let offset = 8;
  if (idBytes) {
    frame.writeUInt32BE(idBytes.length, offset);
    offset += 4;
    idBytes.copy(frame, offset);
    offset += idBytes.length;
  }
  frame.writeUInt32BE(payload.length, offset);
  offset += 4;
  payload.copy(frame, offset);
  return frame;
}

/**
 * 解析下行帧.
 *
 * @param data WebSocket binary message
 * @returns 解析结果
 * @throws 非法 header / 截断帧
 */
export function parseDoubaoFrame(data: Buffer): DoubaoParsedFrame {
  if (data.length < 8) throw new Error('豆包 TTS 帧过短');
  const version = data.readUInt8(0) >> 4;
  const headerUnits = data.readUInt8(0) & 15;
  if (version !== DOUBAO_PROTOCOL_VERSION) throw new Error(`不支持的豆包 TTS 协议版本: ${version}`);
  if (headerUnits !== DOUBAO_HEADER_SIZE_UNITS) throw new Error(`不支持的豆包 TTS header size: ${headerUnits}`);

  const messageType = data.readUInt8(1) >> 4;
  const flags = data.readUInt8(1) & 15;
  const serialization = data.readUInt8(2) >> 4;
  const compression = data.readUInt8(2) & 15;

  if (messageType === DOUBAO_MSG_TYPE_ERROR) {
    const errorCode = data.readUInt32BE(4);
    const payloadSize = data.readUInt32BE(8);
    const payload = data.subarray(12, 12 + payloadSize);
    return {
      messageType,
      flags,
      serialization,
      compression,
      event: 0,
      errorCode,
      payload,
      json: tryParseJson(payload, serialization),
      kind: 'error',
    };
  }

  let offset = 4;
  const event = data.readUInt32BE(offset);
  offset += 4;

  let connectionId: string | undefined;
  let sessionId: string | undefined;
  if (isDoubaoConnectionEvent(event)) {
    const idLength = data.readUInt32BE(offset);
    offset += 4;
    connectionId = data.subarray(offset, offset + idLength).toString('utf8');
    offset += idLength;
  } else if (isDoubaoSessionEvent(event)) {
    const idLength = data.readUInt32BE(offset);
    offset += 4;
    sessionId = data.subarray(offset, offset + idLength).toString('utf8');
    offset += idLength;
  }

  if (offset + 4 > data.length) throw new Error('豆包 TTS 帧缺少 payload size');
  const payloadSize = data.readUInt32BE(offset);
  offset += 4;
  if (offset + payloadSize > data.length) throw new Error('豆包 TTS 帧 payload 被截断');
  const payload = data.subarray(offset, offset + payloadSize);
  return {
    messageType,
    flags,
    serialization,
    compression,
    event,
    ...(connectionId === undefined ? {} : { connectionId }),
    ...(sessionId === undefined ? {} : { sessionId }),
    payload,
    json: tryParseJson(payload, serialization),
    kind: classifyDoubaoEvent(event),
  };
}

/**
 * JSON payload 解析; 非 JSON / 失败返回 undefined (不吞掉二进制音频).
 */
function tryParseJson(payload: Buffer, serialization: number): unknown {
  if (serialization !== DOUBAO_SERIALIZATION_JSON || payload.length === 0) return undefined;
  try {
    return JSON.parse(payload.toString('utf8')) as unknown;
  } catch {
    return undefined;
  }
}
