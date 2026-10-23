// V2026-10-23 治本 (语音微训练 STT 代理 — MiniMax STT 上游客户端, spec §2.3):
//   原因: STT 代理的核心是"把 multipart 音频原样转给上游, 并把上游的 OpenAI 风格
//     错误翻译成本项目的业务错误". 这两件事都跟业务编排无关, 却极易跟编排混在一起 ——
//     结果是 service 里塞满 HTTP 细节, 一旦上游换协议 (比如以后切 Anthropic 兼容),
//     要动的是 service 而不是 client.
//   修法: 本文件是**协议层**: 只认上游契约 (路径 / 模型 / 响应格式 / 错误体),
//     对外只暴露两个东西:
//     ① `transcribe()` → 成功结果 { text, duration, traceId }
//     ② `PracticeAsrUpstreamError` → 归一化后的失败 (kind 决定业务如何翻译)
//     业务语义 (什么算"音频太大"、什么算"服务不可用") 全部在 practice-asr.service.ts.
//   反双胞胎:
//     - 不在 client 里写业务文案: 文案是业务层的, 上游换协议不该动文案
//     - 不把上游原始 body 透给前端: 上游 message 可能含内部错误码 / 敏感细节,
//       只在日志里留 (spec §2.4 "不回显敏感细节")
//     - 不复用 agent/llm/llm.service.ts: 那是 SSE 流式聊天, 协议面完全不同
//     - 不用 @nestjs/axios: 官方接口是 multipart 文件上传, 原生 fetch + FormData
//       直接支持, 引 Axios 只会多一层配置 (Axios 的 FormData 还要额外处理边界)
//   验证:
//     1. tsc 0 错
//     2. 故意把 MINIMAX_API_KEY 改错 → 归一化成 kind='unauthorized', 不抛裸 fetch 异常
//     3. 故意断网 → kind='network' / 'timeout', 不泄漏 undici 原始堆栈给前端
//   时间戳: 2026-10-23
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import {
  PRACTICE_ASR_FORMAT_TO_CONTENT_TYPE,
  PRACTICE_ASR_MODEL,
  PRACTICE_ASR_RESPONSE_FORMAT,
  PRACTICE_ASR_UPSTREAM_PATH,
  type PracticeAsrAudioFormat,
} from '../config/practice-asr.config';

/** 上游错误的归一化分类 —— 业务层据此翻译成 HTTP 语义. */
export type PracticeAsrUpstreamErrorKind =
  /** 400 参数错 / 格式不支持 / 超时长. */
  | 'bad_request'
  /** 401 上游 key 失效 (服务端配置问题, 不是用户的问题). */
  | 'unauthorized'
  /** 402 上游余额不足. */
  | 'insufficient_balance'
  /** 413 请求体超限. */
  | 'payload_too_large'
  /** 422 内容敏感 / 未识别到有效语音. */
  | 'unprocessable'
  /** 429 上游限流. */
  | 'rate_limited'
  /** 5xx 上游故障. */
  | 'server_error'
  /** 网络不可达 / 连接被重置. */
  | 'network'
  /** 本地超时 (AbortSignal 触发). */
  | 'timeout'
  /** 2xx 但响应体不符合约定. */
  | 'malformed_response';

/**
 * 归一化后的上游错误.
 *
 * 刻意**不继承** HttpException: 这是协议层错误, 还没决定 HTTP 语义;
 * 业务层 (service) 负责把它翻成 BizException.
 */
export class PracticeAsrUpstreamError extends Error {
  constructor(
    readonly kind: PracticeAsrUpstreamErrorKind,
    message: string,
    /** 上游 HTTP 状态码; 网络类错误为 null. */
    readonly httpStatus: number | null,
    /** 上游追踪 id (request_id / trace_id), 便于找上游排查. */
    readonly upstreamRequestId: string | null,
    /** 是否值得让客户端重试. */
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'PracticeAsrUpstreamError';
  }
}

/** 上游成功结果. */
export interface PracticeAsrUpstreamResult {
  /** 完整转写文本; 未识别到内容时为空串. */
  readonly text: string;
  /** 音频时长 (秒); 上游未返回时为 null. */
  readonly duration: number | null;
  /** 上游追踪 id. */
  readonly traceId: string | null;
}

/** 单次转写入参. */
export interface PracticeAsrTranscribeInput {
  /** 音频字节 (已在内存, 不落盘). */
  readonly file: Buffer;
  /** 原始文件名 (透传给上游, 仅作标识). */
  readonly filename: string;
  /** 识别出的容器格式 (决定 part 的 Content-Type). */
  readonly format: PracticeAsrAudioFormat | null;
  /** BCP-47 主语言标签; null = 混合语言识别. */
  readonly language: string | null;
}

/** 上游错误体 (OpenAI 风格). */
interface OaiErrorBody {
  type?: string;
  error?: { type?: string; message?: string; http_code?: string };
  request_id?: string;
}

/** 上游 2xx 响应体. */
interface OaiAsrBody {
  text?: string;
  duration?: number;
  trace_id?: string;
}

/**
 * HTTP 状态 → 归一化分类.
 *
 * 以**状态码**为主判据 (官方错误表 §2.4 就是按状态码列的), `error.type` 仅在状态码
 * 未收录时兜底.
 *
 * 为什么这么分优先级:
 *   - 状态码是协议层最稳定的信号; 官方表里 7 行 (400/401/402/413/422/429/5xx) 的
 *     状态码与 error.type 一一对应, 按状态码判不会跑偏.
 *   - `error.type` 在不同网关版本下可能漂移, 只适合当补充.
 *
 * 三处**不是** 400 的补充分支 (都不在官方表里, 但真实存在, 且都**不是用户的错**):
 *   - 403 无权限: §2.3.2 明确提到"订阅 key 调不通 ASR（返回无权限/余额类错误）".
 *     这是 key 权限问题 → 归 unauthorized → 业务层翻成 502 "转写服务暂不可用".
 *     若归 bad_request, 用户会被引导去反复重录 —— 而重录一万次也没用.
 *   - 404 基址没有该端点: 基址配错站点 (或站点未开通该 API) 就返 404.
 *     同样是服务端配置问题, 不能报成"音频格式不支持".
 *   - 405/501 方法或实现不支持: 同上, 服务端问题.
 *
 * 未收录的其他 4xx → 交由 error.type 判; 仍判不出则归 server_error (502):
 *   宁可报"转写服务暂不可用" (前端保留本地兜底), 也不要误导用户去重录.
 */
const kindByHttpStatus = (status: number): PracticeAsrUpstreamErrorKind | null => {
  switch (status) {
    case 400: {
      return 'bad_request';
    }
    case 401: {
      return 'unauthorized';
    }
    case 402: {
      return 'insufficient_balance';
    }
    case 403: {
      return 'unauthorized';
    }
    case 404:
    case 405:
    case 501: {
      return 'server_error';
    }
    case 413: {
      return 'payload_too_large';
    }
    case 422: {
      return 'unprocessable';
    }
    case 429: {
      return 'rate_limited';
    }
    default: {
      return status >= 500 ? 'server_error' : null;
    }
  }
};

/** `error.type` → 归一化分类 (状态码缺失时的兜底). */
const kindByErrorType = (errorType: string | undefined): PracticeAsrUpstreamErrorKind | null => {
  switch (errorType) {
    case 'bad_request_error': {
      return 'bad_request';
    }
    case 'authorized_error': {
      return 'unauthorized';
    }
    case 'insufficient_balance_error': {
      return 'insufficient_balance';
    }
    case 'invalid_request_error': {
      return 'payload_too_large';
    }
    case 'unprocessable_entity_error': {
      return 'unprocessable';
    }
    case 'rate_limit_error': {
      return 'rate_limited';
    }
    case 'server_error': {
      return 'server_error';
    }
    default: {
      return null;
    }
  }
};

/** 该分类是否值得让客户端重试. */
const isRetryableKind = (kind: PracticeAsrUpstreamErrorKind): boolean =>
  kind === 'rate_limited' || kind === 'server_error' || kind === 'network' || kind === 'timeout';

@Injectable()
export class PracticeAsrClient {
  private readonly logger = new Logger(PracticeAsrClient.name);

  constructor(private readonly config: ConfigService) {}

  /**
   * 调上游 STT.
   *
   * 基址与 key 全部复用**全局** `MINIMAX_BASE_URL` / `MINIMAX_API_KEY`
   * (LLM / TTS / STT 同一个上游, 不另开专用配置位).
   * key 的**类型**不写死: 按量 API Key 与 M Plan 订阅 Key 都能填, 由部署环境决定.
   *
   * @throws PracticeAsrUpstreamError 上游非 2xx / 网络故障 / 超时 / 响应体不合法
   */
  async transcribe(input: PracticeAsrTranscribeInput): Promise<PracticeAsrUpstreamResult> {
    const baseUrl = this.resolveBaseUrl();
    const apiKey = this.resolveApiKey();
    if (!baseUrl) {
      throw new PracticeAsrUpstreamError('unauthorized', 'MINIMAX_BASE_URL 未配置', null, null, false);
    }
    if (!apiKey) {
      // 配置缺失是**服务端**问题, 不能让用户背锅 —— 归到 unauthorized (业务层会翻成 502).
      throw new PracticeAsrUpstreamError('unauthorized', 'MINIMAX_API_KEY 未配置', null, null, false);
    }

    const url = `${baseUrl}${PRACTICE_ASR_UPSTREAM_PATH}`;
    const timeoutMs = this.config.get<number>('minimax.asrTimeoutMs') ?? 30_000;

    // 原生 FormData + File: 让 undici 按 Blob 语义流式拼装 multipart, 不用自己拼边界.
    //
    // 字节传递用 Uint8Array **视图** (共享底层 ArrayBuffer, 零拷贝) 而不是
    // `new Uint8Array(buffer)` (那是拷贝) —— 50MB 的文件拷一次就是 50MB 的额外内存.
    // `as ArrayBuffer` 是必要的窄化: Node 的 Buffer 泛型是 Buffer<ArrayBufferLike>,
    // 而 DOM 的 BlobPart 要求 ArrayBufferView<ArrayBuffer> (排除 SharedArrayBuffer).
    const bytes = new Uint8Array(input.file.buffer as ArrayBuffer, input.file.byteOffset, input.file.byteLength);
    const form = new FormData();
    form.set('model', PRACTICE_ASR_MODEL);
    form.set('response_format', PRACTICE_ASR_RESPONSE_FORMAT);
    form.set(
      'file',
      new File([bytes], input.filename, {
        type: input.format ? PRACTICE_ASR_FORMAT_TO_CONTENT_TYPE[input.format] : 'application/octet-stream',
      }),
    );

    const headers: Record<string, string> = { Authorization: `Bearer ${apiKey}` };
    // `language` 是**请求头**, 不是表单字段 (官方文档明确). 不传 = 混合语言识别.
    if (input.language) {
      headers['language'] = input.language;
    }

    const timeoutSignal = AbortSignal.timeout(timeoutMs);
    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers,
        body: form,
        signal: timeoutSignal,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (timeoutSignal.aborted) {
        throw new PracticeAsrUpstreamError('timeout', `上游转写超时 (${timeoutMs}ms): ${message}`, null, null, true);
      }
      throw new PracticeAsrUpstreamError('network', `上游转写网络异常: ${message}`, null, null, true);
    }

    if (!response.ok) {
      throw await this.toUpstreamError(response);
    }

    let body: OaiAsrBody;
    try {
      body = (await response.json()) as OaiAsrBody;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new PracticeAsrUpstreamError('malformed_response', `上游响应体不是合法 JSON: ${message}`, response.status, null, true);
    }

    return {
      // 上游没给 text 时按空串处理 —— "未识别到内容"是合法结果, 不是错误 (spec §2.2).
      text: typeof body.text === 'string' ? body.text : '',
      duration: typeof body.duration === 'number' && Number.isFinite(body.duration) ? body.duration : null,
      traceId: typeof body.trace_id === 'string' ? body.trace_id : null,
    };
  }

  /**
   * 上游基址 (复用全局 MINIMAX_BASE_URL).
   *
   * 官方站点: 国内 `https://api.minimax.cn` / 国际 `https://api.minimax.io`.
   * 代码不硬编码域名 —— 站点是部署环境的事, 写死就等于逼所有人改代码换站.
   */
  private resolveBaseUrl(): string | undefined {
    const baseUrl = this.config.get<string>('minimax.baseUrl');
    return baseUrl ? PracticeAsrClient.trimTrailingSlash(baseUrl) : undefined;
  }

  /**
   * 去掉基址末尾的斜杠.
   *
   * 不用 `replace(/\/+$/, '')`: 该正则在回溯场景下是超线性的
   * (sonarjs/super-linear-regex), 而这里压根不需要正则 —— 末尾斜杠最多一两个,
   * 逐字符回退即可, 严格线性.
   */
  private static trimTrailingSlash(baseUrl: string): string {
    let end = baseUrl.length;
    while (end > 0 && baseUrl[end - 1] === '/') {
      end -= 1;
    }
    return baseUrl.slice(0, end);
  }

  /**
   * 上游 key (复用全局 MINIMAX_API_KEY).
   *
   * 不判断 key 类型 (按量 / M Plan 订阅): 服务端写死类型判断等于假设某个账户形态,
   * 换个账户就静默失效. 由部署环境填对即可.
   */
  private resolveApiKey(): string | undefined {
    return this.config.get<string>('minimax.apiKey');
  }

  /**
   * 把上游错误响应翻译成 `PracticeAsrUpstreamError`.
   *
   * 错误体可能是 OpenAI 风格 JSON, 也可能是网关返回的纯文本 / HTML —— 后者一律按
   * 状态码归类, message 只进日志不进前端.
   */
  private async toUpstreamError(response: Response): Promise<PracticeAsrUpstreamError> {
    const raw = await response.text().catch(() => '');
    let parsed: OaiErrorBody | null = null;
    try {
      parsed = raw ? (JSON.parse(raw) as OaiErrorBody) : null;
    } catch {
      parsed = null;
    }

    const errorType = parsed?.error?.type;
    const kind = kindByHttpStatus(response.status) ?? kindByErrorType(errorType) ?? 'server_error';
    const requestId = parsed?.request_id ?? parsed?.error?.http_code ?? null;
    const upstreamMessage = parsed?.error?.message ?? raw.slice(0, 300);

    this.logger.error(
      `[upstream_error] status=${response.status} kind=${kind} type=${errorType ?? 'n/a'} ` +
        `request_id=${requestId ?? 'n/a'} msg=${upstreamMessage.slice(0, 200)}`,
    );

    return new PracticeAsrUpstreamError(
      kind,
      `上游 STT 失败: status=${response.status} kind=${kind} message=${upstreamMessage.slice(0, 200)}`,
      response.status,
      requestId,
      isRetryableKind(kind),
    );
  }
}
