// V2026-10-23 治本 (语音微训练 STT 代理 — 音频预检, spec §2.3):
//   原因: 上游对音频有两条硬限制 (≤ 500 秒 / ≤ 50 MB), 超限直接返 4xx. 但"等上游
//     报错再回给用户"体验很差 —— 用户看到的是"转写失败", 不知道自己录了 9 分钟.
//     大厂做法: 服务端在**转发前**自己判一次, 给出可行动的文案 ("音频过长, 请缩短到
//     8 分 20 秒以内").
//   修法: 本文件做两件事, 都是纯函数, 不依赖任何 IO:
//     ① 容器识别: 走**魔数** (magic number) 而不是文件扩展名 —— 扩展名是用户可控的,
//        魔数不是; 只有魔数认不出时才退到扩展名兜底.
//     ② 时长探测: WAV / FLAC / MP4(M4A) / OGG 四种容器能从**文件头**精确算出时长,
//        算不出的 (MP3 等) 返回 null, 交给上游兜底判 (上游返 400 时照样映射成友好文案).
//   反双胞胎:
//     - 不引第三方音频解析库 (music-metadata / ffprobe): 那是运行时依赖 + 外部进程,
//       而本项目只需要"时长上限"这一个数, 四种容器的头部解析足够, 且零依赖
//     - 不用 ffprobe 抽时长: 需要本机装 ffmpeg, 生产镜像不该为一次预检背一个 C 依赖
//     - 不把"探测失败"当成"合法": 探测不出 = 不知道, 交给上游权威判定, 本地不误杀
//   验证:
//     1. 用 wav / m4a 样本跑本文件 → 时长与播放器一致 (误差 < 0.05s)
//     2. 传一个 txt → format = unknown, duration = null, 不抛异常
//     3. 传一个截断的 m4a → duration = null (不猜), 上游兜底
//   时间戳: 2026-10-23
import { PRACTICE_ASR_EXTENSION_TO_FORMAT, type PracticeAsrAudioFormat } from '../config/practice-asr.config';

/**
 * 字节掩码 / 魔数常量.
 *
 * 为什么用**十进制**而不是十六进制字面量:
 *   本仓 eslint 同时开了 `unicorn/number-literal-case` (要求十六进制大写) 与
 *   `prettier/prettier` (要求十六进制小写) —— 两者对 `0xFF_FF` 的要求**相反**,
 *   `eslint --fix` 只会在两种写法之间来回改 (ESLintCircularFixesWarning),
 *   永远 lint 不干净.
 *   治本: 带字母的十六进制字面量一律不用, 改成**具名十进制常量** —— 既躲开规则冲突,
 *   又顺手把裸魔数变成有注释的语义名 (比散落的 0xF0 好读).
 *
 * 括号里保留十六进制原值, 方便跟官方容器格式文档对照.
 */
/** 0xFF — 单字节全 1. */
const MASK_FULL_BYTE = 255;
/** 0xE0 — MPEG / ADTS 帧同步字的高 3 位. */
const MASK_MPEG_SYNC = 224;
/** 0xF0 — ADTS 同步字的高 4 位. */
const MASK_ADTS_SYNC = 240;
/** 0xF6 — ADTS 层位 (layer) 掩码. */
const MASK_ADTS_LAYER = 246;
/** 0x18 — MPEG 层位 (layer) 掩码. */
const MASK_MPEG_LAYER = 24;
/** 0x7F — FLAC metadata block header 的 type 位 (高 1 位是 "最后一块" 标志). */
const MASK_METADATA_BLOCK_TYPE = 127;
/** 0xFFFFFFFF — RIFF chunk size 的流式占位值 (长度未知, 写满 32 位). */
const RIFF_CHUNK_SIZE_STREAMING = 4_294_967_295;
/** 0xF_FF_FF — FLAC STREAMINFO 里 sampleRate 占的 20 位 (BigInt: 与 64 位大端值做位运算). */
const MASK_FLAC_SAMPLE_RATE = 1_048_575n;
/** 0xF_FF_FF_FF_FF — FLAC STREAMINFO 里 totalSamples 占的 36 位 (BigInt: 同上). */
const MASK_FLAC_TOTAL_SAMPLES = 1_099_511_627_775n;

/** 音频容器识别 + 时长探测的结果. */
export interface PracticeAsrAudioProbe {
  /** 识别出的容器格式; 认不出时为 null (走扩展名兜底 / 上游权威判定). */
  readonly format: PracticeAsrAudioFormat | null;
  /** 音频时长 (秒); 探测不出时为 null. */
  readonly durationSeconds: number | null;
  /** 字节数. */
  readonly byteLength: number;
}

/** 探测入参 (只要字节 + 文件名, 不碰磁盘). */
export interface PracticeAsrAudioInput {
  readonly buffer: Buffer;
  readonly filename: string;
}

/** 识别不出容器时的兜底: 用扩展名反查. */
const formatFromExtension = (filename: string): PracticeAsrAudioFormat | null => {
  const dot = filename.lastIndexOf('.');
  if (dot === -1 || dot === filename.length - 1) {
    return null;
  }
  const extension = filename.slice(dot + 1).toLowerCase();
  return PRACTICE_ASR_EXTENSION_TO_FORMAT[extension] ?? null;
};

/** 读 4 字节 ASCII 标签; 越界返回 null. */
const readTag = (buffer: Buffer, offset: number): string | null => {
  if (offset < 0 || offset + 4 > buffer.length) {
    return null;
  }
  return buffer.toString('ascii', offset, offset + 4);
};

/**
 * 容器识别 (魔数优先).
 *
 * - RIFF....WAVE → wav
 * - FORM....AIFF → aiff
 * - fLaC → flac
 * - ....ftyp → m4a (ISO-BMFF 容器: m4a / alac / aac-in-mp4)
 * - OggS → ogg (Opus/Vorbis 都在 Ogg 容器里)
 * - ID3 / MPEG 帧同步 → mp3
 * - ADTS 同步字 (0xFFF1/0xFFF9) → aac
 */
const detectFormat = (buffer: Buffer): PracticeAsrAudioFormat | null => {
  if (buffer.length < 4) {
    return null;
  }

  const riff = readTag(buffer, 0);
  if (riff === 'RIFF' && readTag(buffer, 8) === 'WAVE') {
    return 'wav';
  }
  if (riff === 'FORM' && readTag(buffer, 8) === 'AIFF') {
    return 'aiff';
  }
  if (riff === 'fLaC') {
    return 'flac';
  }
  if (readTag(buffer, 4) === 'ftyp') {
    return 'm4a';
  }
  if (riff === 'OggS') {
    return 'ogg';
  }
  if (readTag(buffer, 0) === 'ID3') {
    return 'mp3';
  }

  // MPEG 帧同步: 11 个 1 位 (0xFFEx/0xFFFx).
  if (buffer.length >= 2 && buffer[0] === MASK_FULL_BYTE && (buffer[1] & MASK_MPEG_SYNC) === MASK_MPEG_SYNC) {
    const layer = (buffer[1] & MASK_MPEG_LAYER) >> 1;
    // layer 0 = 保留值, 不是合法 MPEG 音频.
    if (layer !== 0) {
      return 'mp3';
    }
  }

  // ADTS: 同步字 0xFFF1 / 0xFFF9 (裸 AAC 流).
  if (buffer.length >= 2 && buffer[0] === MASK_FULL_BYTE && (buffer[1] & MASK_ADTS_LAYER) === MASK_ADTS_SYNC) {
    return 'aac';
  }

  return null;
};

/**
 * WAV 时长.
 *
 * 走 RIFF chunk 链: fmt 给 byteRate, data 给字节数 → 时长 = dataSize / byteRate.
 * 流式写入的 WAV 常把 data size 写成 0 或 0xFFFFFFFF, 这时退到"缓冲区剩余字节数".
 */
const readWavDurationSeconds = (buffer: Buffer): number | null => {
  let offset = 12; // 跳过 'RIFF' + size + 'WAVE'
  let byteRate: number | null = null;
  let dataSize: number | null = null;
  let dataOffset: number | null = null;

  while (offset + 8 <= buffer.length) {
    const chunkId = readTag(buffer, offset);
    const chunkSize = buffer.readUInt32LE(offset + 4);
    const body = offset + 8;

    if (chunkId === 'fmt ' && body + 16 <= buffer.length) {
      const declaredByteRate = buffer.readUInt32LE(body + 8);
      if (declaredByteRate > 0) {
        byteRate = declaredByteRate;
      } else {
        // byteRate 不可信时按 标准 PCM 参数重算: sampleRate * channels * bitsPerSample / 8.
        const channels = buffer.readUInt16LE(body + 2);
        const sampleRate = buffer.readUInt32LE(body + 4);
        const bitsPerSample = buffer.readUInt16LE(body + 14);
        const computed = Math.floor((sampleRate * channels * bitsPerSample) / 8);
        if (computed > 0) {
          byteRate = computed;
        }
      }
    } else if (chunkId === 'data') {
      dataOffset = body;
      // 0xFFFFFFFF = 流式占位; 超出缓冲区 = 文件被截断.
      dataSize = chunkSize === RIFF_CHUNK_SIZE_STREAMING ? 0 : chunkSize;
    }

    if (byteRate !== null && dataOffset !== null) {
      break;
    }

    // chunk 按偶数字节对齐.
    offset = body + chunkSize + (chunkSize % 2);
    if (chunkSize === RIFF_CHUNK_SIZE_STREAMING) {
      break;
    }
  }

  if (byteRate === null || byteRate <= 0 || dataOffset === null) {
    return null;
  }

  const available = buffer.length - dataOffset;
  const usable = dataSize !== null && dataSize > 0 && dataSize <= available ? dataSize : available;
  if (usable <= 0) {
    return null;
  }
  return usable / byteRate;
};

/**
 * FLAC 时长.
 *
 * STREAMINFO (第一个 metadata block) 里带 sampleRate 与 totalSamples → 精确时长.
 */
const readFlacDurationSeconds = (buffer: Buffer): number | null => {
  if (buffer.length < 8 + 4 + 34) {
    return null;
  }
  // metadata block header: 1 bit last + 7 bit type + 24 bit length (大端).
  const blockType = buffer[8] & MASK_METADATA_BLOCK_TYPE;
  if (blockType !== 0) {
    return null;
  }
  const streamInfo = buffer.subarray(8 + 4, 8 + 4 + 34);

  // bytes 10..17 (相对 STREAMINFO 起点) = sampleRate(20) | channels(3) | bps(5) | totalSamples(36)
  const packed = streamInfo.readBigUInt64BE(10);
  const sampleRate = Number((packed >> 44n) & MASK_FLAC_SAMPLE_RATE);
  const totalSamples = Number(packed & MASK_FLAC_TOTAL_SAMPLES);
  if (sampleRate <= 0 || totalSamples <= 0) {
    return null;
  }
  return totalSamples / sampleRate;
};

/**
 * MP4 / M4A 时长.
 *
 * 走 ISO-BMFF box 树找 moov → mvhd, 时长 = duration / timescale.
 */
const readMp4DurationSeconds = (buffer: Buffer): number | null => {
  const findBox = (start: number, end: number, wanted: string): { bodyStart: number; bodyEnd: number } | null => {
    let offset = start;
    while (offset + 8 <= end) {
      let size = buffer.readUInt32BE(offset);
      const type = readTag(buffer, offset + 4);
      let bodyStart = offset + 8;

      if (size === 1) {
        // 64 位 largesize.
        if (offset + 16 > end) {
          return null;
        }
        const large = buffer.readBigUInt64BE(offset + 8);
        if (large > BigInt(Number.MAX_SAFE_INTEGER)) {
          return null;
        }
        size = Number(large);
        bodyStart = offset + 16;
      } else if (size === 0) {
        size = end - offset;
      }

      if (size < 8) {
        return null;
      }
      const bodyEnd = Math.min(offset + size, end);
      if (type === wanted) {
        return { bodyStart, bodyEnd };
      }
      offset += size;
    }
    return null;
  };

  const moov = findBox(0, buffer.length, 'moov');
  if (!moov) {
    return null;
  }
  const mvhd = findBox(moov.bodyStart, moov.bodyEnd, 'mvhd');
  if (!mvhd) {
    return null;
  }

  const version = buffer[mvhd.bodyStart];
  try {
    if (version === 1) {
      // v1: creation(8) modification(8) timescale(4) duration(8)
      if (mvhd.bodyStart + 4 + 8 + 8 + 4 + 8 > mvhd.bodyEnd) {
        return null;
      }
      const timescale = buffer.readUInt32BE(mvhd.bodyStart + 4 + 8 + 8);
      const duration = Number(buffer.readBigUInt64BE(mvhd.bodyStart + 4 + 8 + 8 + 4));
      if (timescale <= 0 || duration <= 0) {
        return null;
      }
      return duration / timescale;
    }
    // v0: creation(4) modification(4) timescale(4) duration(4)
    if (mvhd.bodyStart + 4 + 4 + 4 + 4 + 4 > mvhd.bodyEnd) {
      return null;
    }
    const timescale = buffer.readUInt32BE(mvhd.bodyStart + 4 + 4 + 4);
    const duration = buffer.readUInt32BE(mvhd.bodyStart + 4 + 4 + 4 + 4);
    if (timescale <= 0) {
      return null;
    }
    return duration / timescale;
  } catch {
    return null;
  }
};

/**
 * Ogg 时长.
 *
 * Ogg 页头第 6 字节起是 granule position (8 字节小端) = 采样点序号. 取**最后一页**
 * 的 granule position, 除以 codec 采样率即时长.
 *   - Opus: 采样率恒 48000 (见 OpusHead)
 *   - Vorbis: 采样率在 identification header 偏移 12 (4 字节小端)
 */
const readOggDurationSeconds = (buffer: Buffer): number | null => {
  // 找最后一个 OggS 页.
  let lastGranule: number | null = null;
  let searchFrom = 0;
  for (;;) {
    const index = buffer.indexOf('OggS', searchFrom, 'ascii');
    if (index === -1 || index + 14 > buffer.length) {
      break;
    }
    lastGranule = Number(buffer.readBigUInt64LE(index + 6));
    searchFrom = index + 4;
  }
  if (lastGranule === null || lastGranule <= 0) {
    return null;
  }

  // 判 codec: 在头部找 OpusHead / vorbis (必须在 Buffer 上找, 字符串没有 readUInt32LE).
  const head = buffer.subarray(0, Math.min(buffer.length, 8192));
  let sampleRate: number | null = null;
  const opusIndex = head.indexOf('OpusHead', 0, 'ascii');
  if (opusIndex === -1) {
    const vorbisIndex = head.indexOf('vorbis', 0, 'ascii');
    if (vorbisIndex !== -1) {
      // identification header: type(1) + 'vorbis'(6) + version(4) + channels(1) + sampleRate(4)
      const rateOffset = vorbisIndex + 6 + 4 + 1;
      if (rateOffset + 4 <= head.length) {
        sampleRate = head.readUInt32LE(rateOffset);
      }
    }
  } else {
    sampleRate = 48_000;
  }
  if (!sampleRate || sampleRate <= 0) {
    return null;
  }
  return lastGranule / sampleRate;
};

/**
 * 探测音频容器与时长.
 *
 * 纯函数, 不抛异常 —— 认不出就返回 null, 由上游做权威判定.
 */
export const probePracticeAsrAudio = (input: PracticeAsrAudioInput): PracticeAsrAudioProbe => {
  const { buffer, filename } = input;
  const format = detectFormat(buffer) ?? formatFromExtension(filename);
  let durationSeconds: number | null = null;

  switch (format) {
    case 'wav': {
      durationSeconds = readWavDurationSeconds(buffer);
      break;
    }
    case 'flac': {
      durationSeconds = readFlacDurationSeconds(buffer);
      break;
    }
    case 'm4a': {
      durationSeconds = readMp4DurationSeconds(buffer);
      break;
    }
    case 'ogg': {
      durationSeconds = readOggDurationSeconds(buffer);
      break;
    }
    default: {
      // aiff / mp3 / aac / opus: 头部信息不足以稳定算时长, 交给上游兜底.
      // 保持 durationSeconds = null (不赋值, 避免"重复赋值"的多余分支).
      break;
    }
  }

  return { format, durationSeconds, byteLength: buffer.length };
};
