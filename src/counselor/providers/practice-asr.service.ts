// V2026-10-23 治本 (语音微训练 STT 代理 — 业务编排层, spec §2.2 / §2.4 / §2.5):
//   原因: 上游协议 (practice-asr.client.ts) 只回答"上游说了什么", 但业务要回答
//     "这件事算谁的错、给用户什么文案、要不要让用户重试、这条用量怎么记账".
//     这些判断散落在 controller 里必然漂移 (同一个上游错误, 换个端点就换套文案).
//   修法: 本 service 是**唯一的业务语义出口**, 对外只暴露 `transcribe()`:
//     ① 预检 (格式白名单 / 体积 / 时长 / 语言标签) —— 先本地拦, 不浪费上游调用
//     ② 调上游 (协议细节全在 client 里)
//     ③ 归一化错误 (上游 kind → 本项目 BizCode + HTTP 语义)
//     ④ 记账 (日志 + Prometheus 指标: userId / 时长 / trace_id / 耗时)
//   反双胞胎:
//     - 不落盘: 音频全程只在内存里 (multer memoryStorage), 处理完即释放,
//       不写本地磁盘 / 对象存储 (spec §2.5「练习音频不留存」)
//     - 不在 controller 里判错误: 端点只做"入参转交 + 出参声明", 跟本仓 controller 风格一致
//     - 不伪造文本: 上游没识别到内容就是空串, 绝不用占位文案顶替 (spec §2.2)
//     - 不在这里扣会员配额: 现有 QuotaType 没有"语音转写"这一类 (见
//       practice-attempt.service.ts 的同类说明), 配额留给会员档位体系落地后接
//   验证:
//     1. tsc 0 错
//     2. 上传 3 分钟 wav → 200, text 非空, duration≈180
//     3. 上传 10 分钟 wav → 400 + PracticeAsrAudioInvalid (本地预检, 不打上游)
//     4. 上传 60MB wav → 413 (multer 层拦截)
//     5. 传 language=zh-CN → 等价于 zh; 传 language=xx → 400
//     6. 断网 → 502/504 可重试错误, 不 500, 不伪造成功
//   时间戳: 2026-10-23
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { probePracticeAsrAudio } from './practice-asr-audio.util';
import { PracticeAsrClient, PracticeAsrUpstreamError } from './practice-asr.client';
import { BizCode } from '../../common/exceptions/biz-code.enum';
import { BizException } from '../../common/exceptions/biz.exception';
import { MetricsService } from '../../shared/infra/metrics';
import {
  PRACTICE_ASR_SUPPORTED_FORMATS,
  PRACTICE_ASR_UPSTREAM_MAX_DURATION_SECONDS,
  PRACTICE_ASR_UPSTREAM_MAX_FILE_BYTES,
  normalizePracticeAsrLanguage,
  type PracticeAsrLanguage,
} from '../config/practice-asr.config';
import type { PracticeAsrResultDto } from '../dto/practice-asr.dto';

/** 转写入参 (controller 传进来的原始素材). */
export interface PracticeAsrTranscribeRequest {
  /** 当前用户 id (用量记账 + 限流 key). */
  readonly userId: string;
  /** 上传文件; 未传时为 undefined. */
  readonly file: Express.Multer.File | undefined;
  /** 原始 `language` 请求头 (BCP-47, 可空). */
  readonly language?: string;
}

/** 上传文件在内存中的最小形态 (不依赖 Express.Multer 全量类型). */
interface UploadedAudio {
  readonly buffer: Buffer;
  readonly originalname: string;
  readonly mimetype: string;
  readonly size: number;
}

@Injectable()
export class PracticeAsrService {
  private readonly logger = new Logger(PracticeAsrService.name);

  constructor(
    private readonly client: PracticeAsrClient,
    private readonly metrics: MetricsService,
    private readonly config: ConfigService,
  ) {}

  /**
   * 把一段录音转成文本.
   *
   * @throws BizException 预检不通过 / 上游失败 / 超时 (HTTP 语义见 BizCode 映射)
   */
  async transcribe(request: PracticeAsrTranscribeRequest): Promise<PracticeAsrResultDto> {
    const audio = this.requireFile(request.file);
    const language = this.resolveLanguage(request.language);
    const probe = probePracticeAsrAudio({ buffer: audio.buffer, filename: audio.originalname });

    this.assertSupportedFormat(probe.format);
    this.assertSizeAllowed(audio.size);
    this.assertDurationAllowed(probe.durationSeconds);

    const startedAt = Date.now();
    try {
      const result = await this.client.transcribe({
        file: audio.buffer,
        filename: audio.originalname,
        format: probe.format,
        language,
      });

      const elapsedMs = Date.now() - startedAt;
      this.logger.log(
        `[asr_ok] user=${request.userId} format=${probe.format ?? 'unknown'} ` +
          `bytes=${audio.size} audio_duration=${probe.durationSeconds ?? 'n/a'} ` +
          `upstream_duration=${result.duration ?? 'n/a'} elapsed_ms=${elapsedMs} ` +
          `trace_id=${result.traceId ?? 'n/a'} chars=${result.text.length}`,
      );
      this.metrics.incPracticeAsrTranscribe('success');
      this.metrics.observePracticeAsrDuration(elapsedMs / 1000);

      return {
        text: result.text,
        duration: result.duration,
        trace_id: result.traceId ?? '',
      };
    } catch (error) {
      const elapsedMs = Date.now() - startedAt;
      this.metrics.incPracticeAsrTranscribe('failed');
      throw this.toBizException(error, request.userId, elapsedMs);
    }
  }

  // ── 预检 ──────────────────────────────────────────────────────────

  /** 没有文件 = 请求不合法 (不是"识别不到语音", 两者语义不同). */
  private requireFile(file: Express.Multer.File | undefined): UploadedAudio {
    if (!file || !file.buffer || file.buffer.length === 0) {
      throw new BizException(BizCode.PracticeAsrAudioInvalid, '未收到音频文件，请重新录一段');
    }
    return {
      buffer: file.buffer,
      originalname: file.originalname || 'recording',
      mimetype: file.mimetype || 'application/octet-stream',
      size: file.size,
    };
  }

  /**
   * 语言标签归一化.
   *
   * 不支持的语言**直接 400**: 静默退化成混合识别会让用户拿到一份"识别错了但看起来
   * 挺像那么回事"的文本, 后面 §3.3 评判还会基于这份错文本给批注 —— 比报错更糟.
   */
  private resolveLanguage(raw: string | undefined): PracticeAsrLanguage | null {
    try {
      return normalizePracticeAsrLanguage(raw);
    } catch {
      throw new BizException(BizCode.InvalidParameter, 'language 请求头不被支持，请使用 zh / en 等标准语言标签');
    }
  }

  /** 容器白名单: 认不出格式 = 不支持 (上游也不支持无容器裸 PCM). */
  private assertSupportedFormat(format: string | null): void {
    if (!format) {
      throw new BizException(BizCode.PracticeAsrAudioInvalid, '音频格式不支持，请上传 wav / m4a / mp3 / aac / flac / ogg / opus 格式');
    }
    if (!PRACTICE_ASR_SUPPORTED_FORMATS.includes(format as (typeof PRACTICE_ASR_SUPPORTED_FORMATS)[number])) {
      throw new BizException(BizCode.PracticeAsrAudioInvalid, `音频格式 ${format} 不支持，请重新录一段`);
    }
  }

  /**
   * 体积闸.
   *
   * 上限取"上游硬限制"与"本地运营上限"的**较小者**: 本地更严是可以的 (省上游流量),
   * 本地更松则会被上游 413 拒 —— 那种情况下用户拿到的是"音频过大", 也对, 但多跑一趟.
   */
  private assertSizeAllowed(size: number): void {
    const localMax = this.config.get<number>('minimax.asrMaxFileBytes') ?? PRACTICE_ASR_UPSTREAM_MAX_FILE_BYTES;
    const limit = Math.min(localMax, PRACTICE_ASR_UPSTREAM_MAX_FILE_BYTES);
    if (size > limit) {
      throw new BizException(BizCode.PracticeAsrAudioTooLarge, `音频过大 (${(size / 1024 / 1024).toFixed(1)}MB), 请缩短后重试`);
    }
  }

  /**
   * 时长闸.
   *
   * 只有**探测得出**时长才本地拦 (wav/flac/m4a/ogg); 探测不出 (mp3/aac/opus) 一律
   * 放行, 交给上游权威判定 —— 本地瞎猜比不判更糟.
   */
  private assertDurationAllowed(durationSeconds: number | null): void {
    if (durationSeconds === null) {
      return;
    }
    const localMax = this.config.get<number>('minimax.asrMaxDurationSec') ?? PRACTICE_ASR_UPSTREAM_MAX_DURATION_SECONDS;
    const limit = Math.min(localMax, PRACTICE_ASR_UPSTREAM_MAX_DURATION_SECONDS);
    if (durationSeconds > limit) {
      throw new BizException(
        BizCode.PracticeAsrAudioInvalid,
        `音频时长 ${Math.round(durationSeconds)} 秒, 超过上限 ${limit} 秒, 请录短一点`,
      );
    }
  }

  // ── 错误归一 ──────────────────────────────────────────────────────

  /**
   * 上游错误 → 业务错误.
   *
   * 映射口径见 spec §2.4:
   *   400 → 400 音频格式或时长不支持
   *   401 / 402 / 5xx / 网络 → 502 转写服务暂不可用 (服务端问题, 不让用户背锅)
   *   413 → 413 音频过大
   *   422 → 422 未识别到有效语音 (不回显敏感细节)
   *   429 → 429 太频繁了
   *   超时 → 504
   */
  private toBizException(error: unknown, userId: string, elapsedMs: number): BizException {
    if (!(error instanceof PracticeAsrUpstreamError)) {
      this.logger.error(
        `[asr_unexpected_error] user=${userId} elapsed_ms=${elapsedMs}`,
        error instanceof Error ? error.stack : String(error),
      );
      return new BizException(BizCode.PracticeAsrUpstreamUnavailable, '转写服务暂不可用，稍后再试');
    }

    this.logger.warn(
      `[asr_failed] user=${userId} kind=${error.kind} http=${error.httpStatus ?? 'n/a'} ` +
        `elapsed_ms=${elapsedMs} retryable=${error.retryable} request_id=${error.upstreamRequestId ?? 'n/a'}`,
    );

    switch (error.kind) {
      case 'bad_request': {
        return new BizException(BizCode.PracticeAsrAudioInvalid, '音频格式或时长不支持，请重新录一段');
      }
      case 'payload_too_large': {
        return new BizException(BizCode.PracticeAsrAudioTooLarge, '音频过大，请缩短后重试');
      }
      case 'unprocessable': {
        return new BizException(BizCode.PracticeAsrNoSpeechDetected, '未识别到有效语音，请再试一次');
      }
      case 'rate_limited': {
        return new BizException(BizCode.PracticeAsrUpstreamRateLimited, '太频繁了，稍等几秒再试');
      }
      case 'timeout': {
        return new BizException(BizCode.PracticeAsrTimeout, '转写超时了，稍后再试');
      }
      default: {
        // unauthorized / insufficient_balance / server_error / network / malformed_response
        //   —— 全部是"上游侧的问题", 用户等一下就能重试, 不引导重录.
        return new BizException(BizCode.PracticeAsrUpstreamUnavailable, '转写服务暂不可用，稍后再试');
      }
    }
  }
}
