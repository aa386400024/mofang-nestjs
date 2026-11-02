// V2026-10-26 治本 (官方音色目录代理 — MiniMax 上游协议层, spec §任务 2):
//   原因: 音色列表端点 (`GET /counselor/voices`) 的核心是"把一次 MiniMax `get_voice`
//     调用**原样**转成上游音色列表, 并把上游的 OpenAI 风格错误翻译成本项目的业务错误".
//     这两件事都跟业务编排 (缓存 / DTO 整形 / 错误码映射) 无关, 却极易跟编排混在一起 ——
//     结果是 service 里塞满 HTTP 细节, 一旦上游换协议要动的是 service 而不是 client.
//   修法: 本文件是**协议层**: 只认上游契约 (路径 / 请求体 / 响应体 / 状态码),
//     对外只暴露两个东西:
//     ① `fetchSystemVoices()` → 成功结果 (精简后的音色列表)
//     ② `VoiceCatalogUpstreamError` → 归一化后的失败 (kind 决定业务如何翻译)
//     业务语义 (缓存多久 / 502 还是 429 / 对外文案) 全部在 voices.service.ts.
//   反双胞胎:
//     - 不在 client 里写业务文案: 文案是业务层的, 上游换协议不该动文案
//     - 不把上游原始 body 透给前端: 上游 message 可能含内部错误码 / 敏感细节,
//       只在日志里留 (spec §任务 2「不向前端回传上游原始 key」)
//     - 不用 @nestjs/axios: 官方接口是普通 JSON POST, 原生 fetch 直接支持,
//       引 Axios 只是多一层配置
//   验证:
//     1. tsc 0 错
//     2. 故意把 MINIMAX_API_KEY 改错 → 归一化成 kind='unauthorized', 不抛裸 fetch 异常
//     3. 故意断网 → kind='network' / 'timeout', 不泄漏 undici 原始堆栈给前端
//   时间戳: 2026-10-26

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { VOICE_CATALOG_TYPE_SYSTEM, VOICE_CATALOG_UPSTREAM_PATH, type VoiceCatalogType } from '../config/voices.config';

/**
 * 上游错误的归一化分类 —— 业务层据此翻译成 HTTP 语义.
 */
export type VoiceCatalogUpstreamErrorKind =
  /** 上游 key 失效 / 鉴权失败 (服务端配置问题, 不是用户的问题). */
  | 'unauthorized'
  /** 上游余额不足. */
  | 'insufficient_balance'
  /** 上游限流. */
  | 'rate_limited'
  /** 请求参数被上游判非法 (例: voice_type 不在枚举). */
  | 'bad_request'
  /** 上游 5xx / 未知业务错误. */
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
export class VoiceCatalogUpstreamError extends Error {
  /**
   * @param kind 归一化分类
   * @param message 内部诊断信息 (只进日志, 不下发前端)
   * @param httpStatus 上游 HTTP 状态码; 网络类错误为 null
   * @param upstreamStatusCode 上游 base_resp.status_code; 无则 null
   * @param retryable 是否值得让客户端重试
   */
  constructor(
    readonly kind: VoiceCatalogUpstreamErrorKind,
    message: string,
    readonly httpStatus: number | null,
    readonly upstreamStatusCode: number | null,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'VoiceCatalogUpstreamError';
  }
}

/**
 * 上游系统音色 (原始字段已换成本仓命名).
 */
export interface UpstreamSystemVoice {
  /** 音色 id (上游 `voice_id`). */
  readonly voiceId: string;
  /** 音色名称 (上游 `voice_name`); 上游未给时为空串. */
  readonly name: string;
  /** 音色描述 (上游 `description`, 字符串数组). */
  readonly description: readonly string[];
}

/** 上游响应体 (只声明本端用到的字段). */
interface GetVoiceResponseBody {
  system_voice?: {
    voice_id?: string;
    voice_name?: string;
    description?: string[];
    created_time?: string;
  }[];
  base_resp?: {
    status_code?: number;
    status_msg?: string;
  };
}

/**
 * 上游 `base_resp.status_code` → 归一化分类.
 *
 * 官方《查询可用音色ID》只列了 0 (成功) 与 2013 (参数非法), 但**同族接口**的
 * 错误码表是共享的 (1002 限流 / 1004 鉴权 / 1008 余额 / 1000 未知 / 1001 超时),
 * 官方《上传复刻音频》文档里就有完整列表. 所以这里按**全局错误码表**映射,
 * 而不是只认 get_voice 文档里那两行 —— 只认两行的话, 上游返回 1004 时会掉进
 * "未知错误"分支, 前端拿到的是"服务暂不可用"而不是更准确的"上游鉴权失败",
 * 排查时还要再翻一遍上游文档.
 */
function kindByUpstreamStatus(statusCode: number): VoiceCatalogUpstreamErrorKind {
  switch (statusCode) {
    case 1002: {
      return 'rate_limited';
    }
    case 1004:
    case 2049: {
      return 'unauthorized';
    }
    case 1008: {
      return 'insufficient_balance';
    }
    case 2013: {
      return 'bad_request';
    }
    case 1001: {
      return 'timeout';
    }
    case 1000:
    case 1013: {
      return 'server_error';
    }
    default: {
      return 'server_error';
    }
  }
}

/** 该分类是否值得让客户端重试. */
function isRetryableKind(kind: VoiceCatalogUpstreamErrorKind): boolean {
  return kind === 'rate_limited' || kind === 'server_error' || kind === 'network' || kind === 'timeout';
}

/**
 * HTTP 状态码 → 归一化分类.
 *
 * 写成独立函数而不是嵌套三元: 嵌套三元会被 `sonarjs/no-nested-conditional` 判错,
 * 而且三层缩进的判定链读起来要来回对照状态码 —— if 链一眼就能扫完.
 *
 * @param status 上游 HTTP 状态码
 * @returns 归一化分类
 */
function kindByHttpStatus(status: number): VoiceCatalogUpstreamErrorKind {
  if (status === 401 || status === 403) {
    return 'unauthorized';
  }
  if (status === 402) {
    return 'insufficient_balance';
  }
  if (status === 429) {
    return 'rate_limited';
  }
  if (status >= 500) {
    return 'server_error';
  }
  return 'bad_request';
}

/**
 * 官方音色目录上游客户端.
 */
@Injectable()
export class VoicesClient {
  private readonly logger = new Logger(VoicesClient.name);

  constructor(private readonly config: ConfigService) {}

  /**
   * 查账号可用音色.
   *
   * 基址与 key 全部复用**全局** `MINIMAX_BASE_URL` / `MINIMAX_API_KEY`
   * (LLM / TTS / STT / 音色目录同一个上游, 不另开专用配置位).
   *
   * @param voiceType 音色类型 (本期只传 `system`)
   * @param timeoutMs 超时覆盖 (ms); 缺省 = env `MINIMAX_VOICES_TIMEOUT_MS`.
   *   调用方若**不能久等** (例: WS 握手里的建议性校验) 必须传一个更短的值 ——
   *   建议性校验卡住整个握手, 比校验失败严重得多.
   * @returns 精简后的音色列表 (上游没给 voice_id 的条目已丢弃)
   * @throws VoiceCatalogUpstreamError 上游非 2xx / 业务失败 / 网络故障 / 超时 / 响应体不合法
   */
  async fetchVoices(voiceType: VoiceCatalogType = VOICE_CATALOG_TYPE_SYSTEM, timeoutMs?: number): Promise<UpstreamSystemVoice[]> {
    const baseUrl = this.resolveBaseUrl();
    const apiKey = this.resolveApiKey();
    if (!baseUrl) {
      throw new VoiceCatalogUpstreamError('unauthorized', 'MINIMAX_BASE_URL 未配置', null, null, false);
    }
    if (!apiKey) {
      // 配置缺失是**服务端**问题, 不能让用户背锅 —— 归到 unauthorized (业务层翻成 502).
      throw new VoiceCatalogUpstreamError('unauthorized', 'MINIMAX_API_KEY 未配置', null, null, false);
    }

    const url = `${baseUrl}${VOICE_CATALOG_UPSTREAM_PATH}`;
    const effectiveTimeoutMs = timeoutMs ?? this.config.get<number>('minimax.voicesTimeoutMs') ?? 15_000;
    const response = await this.requestVoices(url, apiKey, voiceType, effectiveTimeoutMs);
    const body = await this.readResponseBody(response);
    return this.toVoiceList(body);
  }

  // ── private ────────────────────────────────────────────────────

  /**
   * 发一次上游请求 (网络层错误归一).
   *
   * 单独拆出来是为了让 `fetchVoices` 的复杂度回到阈值内 (ESLint complexity 上限 20) ——
   * 拆分的边界按**职责**切 (发请求 / 读响应 / 转列表), 不是按"凑行数"切.
   *
   * @param url 上游完整地址
   * @param apiKey 上游 key
   * @param voiceType 音色类型
   * @param timeoutMs 超时 (ms)
   * @returns 上游响应
   * @throws VoiceCatalogUpstreamError 网络故障 / 超时
   */
  private async requestVoices(url: string, apiKey: string, voiceType: VoiceCatalogType, timeoutMs: number): Promise<Response> {
    const timeoutSignal = AbortSignal.timeout(timeoutMs);
    try {
      return await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({ voice_type: voiceType }),
        signal: timeoutSignal,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (timeoutSignal.aborted) {
        throw new VoiceCatalogUpstreamError('timeout', `上游音色目录超时 (${timeoutMs}ms): ${message}`, null, null, true);
      }
      throw new VoiceCatalogUpstreamError('network', `上游音色目录网络异常: ${message}`, null, null, true);
    }
  }

  /**
   * 读上游响应体 (HTTP 层错误 + 业务状态码 → 归一化错误).
   *
   * @param response 上游响应
   * @returns 解析后的响应体
   * @throws VoiceCatalogUpstreamError HTTP 失败 / 业务失败 / 响应体不合法
   */
  private async readResponseBody(response: Response): Promise<GetVoiceResponseBody> {
    const raw = await response.text().catch(() => '');
    let body: GetVoiceResponseBody = {};
    let parseFailed = false;
    try {
      body = raw ? (JSON.parse(raw) as GetVoiceResponseBody) : {};
    } catch (error) {
      parseFailed = true;
      if (response.ok) {
        // 2xx 但响应体不是 JSON = 上游契约变了 (而不是错误页) —— 必须当协议错误报出来.
        const message = error instanceof Error ? error.message : String(error);
        throw new VoiceCatalogUpstreamError(
          'malformed_response',
          `上游音色目录响应体不是合法 JSON: ${message}`,
          response.status,
          null,
          true,
        );
      }
      // 非 2xx 且响应体不是 JSON (常见: 网关返回 HTML 错误页) → 归到 HTTP 层错误,
      // 不能报成 "malformed_response" —— 那是"上游契约变了", 会把排查方向带偏.
    }

    // HTTP 层失败优先判定: 网关层错误 (5xx / 401) 经常根本没有业务体.
    if (!response.ok) {
      throw this.toHttpError(response.status, parseFailed ? undefined : body.base_resp?.status_msg);
    }

    const statusCode = body.base_resp?.status_code;
    if (statusCode !== undefined && statusCode !== 0) {
      const kind = kindByUpstreamStatus(statusCode);
      this.logger.warn(`[upstream_error] status_code=${statusCode} kind=${kind} msg=${(body.base_resp?.status_msg ?? '').slice(0, 200)}`);
      throw new VoiceCatalogUpstreamError(
        kind,
        `上游音色目录失败: status_code=${statusCode} kind=${kind} message=${(body.base_resp?.status_msg ?? '').slice(0, 200)}`,
        response.status,
        statusCode,
        isRetryableKind(kind),
      );
    }
    return body;
  }

  /**
   * 上游响应体 → 精简音色列表.
   *
   * 剥掉 `created_time` 等前端用不到的字段 (spec §任务 2「响应精简」) ——
   * 上游 `created_time` 对系统音色恒为 `1970-01-01`, 下发它是**噪音**, 而前端一旦
   * 依赖了它, 将来上游改了口径就会静默错位.
   *
   * @param body 上游响应体
   * @returns 音色列表
   */
  private toVoiceList(body: GetVoiceResponseBody): UpstreamSystemVoice[] {
    const raw = body.system_voice ?? [];
    const voices: UpstreamSystemVoice[] = [];
    for (const item of raw) {
      const voiceId = item.voice_id?.trim();
      if (!voiceId) {
        // 没有 voice_id 的条目无法被调用方使用 (选音色最终要拿 id 去建连), 直接丢弃.
        continue;
      }
      voices.push({
        voiceId,
        name: item.voice_name?.trim() ?? '',
        description: Array.isArray(item.description) ? item.description.filter((line) => line.trim().length > 0) : [],
      });
    }
    return voices;
  }

  /**
   * HTTP 层错误 → 归一化错误.
   *
   * @param status 上游 HTTP 状态码
   * @param upstreamMessage 上游 base_resp.status_msg (可能有)
   * @returns 归一化错误
   */
  private toHttpError(status: number, upstreamMessage: string | undefined): VoiceCatalogUpstreamError {
    const kind = kindByHttpStatus(status);
    this.logger.error(`[upstream_http_error] status=${status} kind=${kind} msg=${(upstreamMessage ?? '').slice(0, 200)}`);
    return new VoiceCatalogUpstreamError(
      kind,
      `上游音色目录 HTTP 失败: status=${status} kind=${kind} message=${(upstreamMessage ?? '').slice(0, 200)}`,
      status,
      null,
      isRetryableKind(kind),
    );
  }

  /**
   * 上游基址 (复用全局 MINIMAX_BASE_URL).
   *
   * 官方站点: 国内 `https://api.minimax.cn` / 国际 `https://api.minimax.io`.
   * 代码不硬编码域名 —— 站点是部署环境的事, 写死就等于逼所有人改代码换站.
   *
   * @returns 基址 (未配置 → undefined)
   */
  private resolveBaseUrl(): string | undefined {
    const baseUrl = this.config.get<string>('minimax.baseUrl');
    return baseUrl ? VoicesClient.trimTrailingSlash(baseUrl) : undefined;
  }

  /**
   * 去掉基址末尾的斜杠.
   *
   * 不用 `replace(/\/+$/, '')`: 该正则在回溯场景下是超线性的
   * (sonarjs/super-linear-regex), 而这里压根不需要正则 —— 末尾斜杠最多一两个,
   * 逐字符回退即可, 严格线性.
   *
   * @param baseUrl 基址
   * @returns 去掉末尾斜杠后的基址
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
   *
   * @returns key (未配置 → undefined)
   */
  private resolveApiKey(): string | undefined {
    return this.config.get<string>('minimax.apiKey');
  }
}
