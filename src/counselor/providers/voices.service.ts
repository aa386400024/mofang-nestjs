// V2026-10-26 治本 (官方音色目录代理 — 业务层, spec §任务 2):
//   原因: `GET /counselor/voices?type=system` 是**低频变动**的数据 (官方系统音色表几乎不变),
//     但每次进准备页都打一次上游 = 无谓的外部调用 + 上游配额消耗 + 首次进页变慢.
//     治本: 本层负责 ① **短 TTL 内存缓存** (默认 10 分钟, env 可调) ② **并发去重**
//     (single-flight: 缓存失效瞬间的并发请求共享同一次上游调用) ③ **上游错误 → 业务错误**归一.
//   职责分层 (与仓库既有范式一致):
//     - voices.client.ts   = 上游协议层 (只认 MiniMax 契约)
//     - voices.service.ts  = 业务层 (缓存 / 去重 / 错误翻译 / DTO 整形) ← **本文件**
//     - voices.controller.ts = HTTP 出入参面 (薄转交)
//   额外职责 (V2026-10-26, spec §任务 1): 本 service 同时实现 voice 侧的
//     `VoiceCatalogResolver` 插槽, 让 WS 网关能判定"握手传入的 voiceId 在不在账号可用
//     音色内" —— 同一份缓存服务两个消费方, **不建第二份缓存** (双缓存必然漂移).
//   反双胞胎:
//     - 不用 Redis: 音色表几乎不变, 单实例内存缓存足够; 引 Redis 只会增加耦合与故障面
//     - 不用"每次都打上游": 准备页是高频入口, 直接打上游会把上游配额打满
//     - 不用"失败也缓存": 上游故障时缓存一份空列表 = 10 分钟内所有用户都看不到音色,
//       故障被放大 —— 所以**只缓存成功结果**
//     - 不在 client 里做缓存: 协议层不该知道"业务多久算新鲜"
//   验证:
//     1. tsc 0 错
//     2. curl -H "Authorization: Bearer ***" "http://localhost:3000/counselor/voices?type=system" → 精简列表
//     3. 连打两次 → 日志只有一次上游调用
//     4. 故意改错 MINIMAX_API_KEY → 502 + 可读 message, 且响应里没有 key
//   时间戳: 2026-10-26

import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { VoiceCatalogUpstreamError, VoicesClient } from './voices.client';
import { BizCode } from '../../common/exceptions/biz-code.enum';
import { BizException } from '../../common/exceptions/biz.exception';
import { VoiceCatalogRegistry, type VoiceCatalogAvailability, type VoiceCatalogResolver } from '../../voice/voice-catalog-slot';
import { resolveVoiceCatalogType, VOICE_CATALOG_TYPE_SYSTEM } from '../config/voices.config';
import type { SystemVoiceDto, VoicesListDto } from '../dto/voices.dto';

/**
 * 缓存条目.
 *
 * `expiresAt` 用**绝对时间戳**而不是"剩余秒数" —— 后者每次读都要做减法, 容易在
 * "0 表示不过期"这类特殊值上翻车; 绝对时间戳的比较只有一句话, 没有特殊值.
 */
interface VoiceCatalogCacheEntry {
  readonly voices: readonly SystemVoiceDto[];
  readonly expiresAt: number;
}

/**
 * 官方音色目录服务.
 */
@Injectable()
export class VoicesService implements OnModuleInit, VoiceCatalogResolver {
  /** 插槽实现标识 (日志用). */
  readonly name = 'counselor-voices';

  private readonly logger = new Logger(VoicesService.name);
  /** 缓存条目; null = 从未成功拉取过. */
  private cache: VoiceCatalogCacheEntry | null = null;
  /** 进行中的上游调用 (single-flight 去重). */
  private inflight: Promise<readonly SystemVoiceDto[]> | null = null;

  /**
   * @param client 上游协议层
   * @param config 全局配置
   * @param registry voice 侧音色目录注册表 (@Global)
   */
  constructor(
    private readonly client: VoicesClient,
    private readonly config: ConfigService,
    private readonly registry: VoiceCatalogRegistry,
  ) {}

  /** 启动时注册进 voice 侧全局注册表 (供 WS 网关判定握手 voiceId). */
  onModuleInit(): void {
    this.registry.register(this);
  }

  /**
   * 取账号可用音色列表.
   *
   * @param type 请求方指定的音色类型 (本期只有 `system` 有效, 其余按 `system` 处理)
   * @returns 音色列表
   * @throws BizException 上游失败 (已归一成可读的业务码)
   */
  async listVoices(type?: string | null): Promise<VoicesListDto> {
    // 归一请求方指定的类型 (本期只接受 `system`, 其余 / 缺省按 `system` 处理).
    // 归一结果**只用于日志**: 本期**只取** system_voice 数组, 克隆 / 文生列表后期才开
    // (spec §任务 2「忽略 voice_cloning / voice_generation」).
    const catalogType = resolveVoiceCatalogType(type);
    this.logger.debug(`[list_voices] type=${catalogType} → 取 system_voice`);
    const voices = await this.getSystemVoices();
    return { voices: [...voices] };
  }

  /**
   * voice 侧插槽实现 — 判定某个 voice_id 在不在账号可用系统音色内.
   *
   * **只读不写**: 判定失败 (上游挂了) 时返回 `unknown` 而不是 `unavailable` ——
   * 上游挂掉时若返回 `unavailable`, 合法音色会被误回退成 env 默认音色,
   * 用户选了 A 却听到 B, 且**没有任何报错**, 比直接失败更糟.
   *
   * @param voiceId 音色 id
   * @returns 三态判定结果
   */
  async check(voiceId: string): Promise<VoiceCatalogAvailability> {
    try {
      // 建议性校验**不能久等**: 它跑在 WS 握手里, 上游卡住 = 整场会谈卡在"连接中".
      // 所以走更短的超时 (默认 3s), 超了就当"判不出来" (unknown), 不拦握手.
      const voices = await this.getSystemVoices(this.checkTimeoutMs());
      return voices.some((voice) => voice.voiceId === voiceId) ? 'available' : 'unavailable';
    } catch (error) {
      this.logger.warn(`[check_failed] voice=${voiceId.slice(0, 64)} err=${error instanceof Error ? error.message : String(error)}`);
      return 'unknown';
    }
  }

  // ── private ────────────────────────────────────────────────────

  /**
   * 建议性校验用的超时 (ms).
   *
   * @returns 超时毫秒数
   */
  private checkTimeoutMs(): number {
    return this.config.get<number>('minimax.voicesCheckTimeoutMs') ?? 3000;
  }

  /**
   * 取系统音色 (走缓存 + 并发去重).
   *
   * @param timeoutMs 上游超时覆盖 (ms); 缺省 = env `MINIMAX_VOICES_TIMEOUT_MS`
   * @returns 系统音色列表
   * @throws BizException 上游失败 (已归一成可读的业务码)
   */
  private async getSystemVoices(timeoutMs?: number): Promise<readonly SystemVoiceDto[]> {
    const cached = this.readCache();
    if (cached) {
      return cached;
    }
    // single-flight: 缓存失效瞬间的并发请求共享同一次上游调用 (不多打上游).
    // 用局部变量而不是直接 `this.inflight ??= ...` 后再 return this.inflight ——
    // 后者依赖 TS 对**属性**赋值的收窄, 窄化点在中间被函数调用打断就可能失效.
    const inflight =
      this.inflight ??
      this.fetchSystemVoices(timeoutMs).finally(() => {
        this.inflight = null;
      });
    this.inflight = inflight;
    return inflight;
  }

  /**
   * 读缓存 (未命中 / 已过期 → null).
   *
   * @returns 缓存的音色列表; 无有效缓存 → null
   */
  private readCache(): readonly SystemVoiceDto[] | null {
    const entry = this.cache;
    if (!entry) {
      return null;
    }
    if (entry.expiresAt <= Date.now()) {
      return null;
    }
    return entry.voices;
  }

  /**
   * 拉上游并写缓存.
   *
   * **只缓存成功结果**: 上游故障时不写缓存 (否则一次抖动会让音色列表在 TTL 内一直是空的).
   *
   * @param timeoutMs 上游超时覆盖 (ms); 缺省 = env `MINIMAX_VOICES_TIMEOUT_MS`
   * @returns 系统音色列表
   * @throws BizException 上游失败 (已归一成可读的业务码)
   */
  private async fetchSystemVoices(timeoutMs?: number): Promise<readonly SystemVoiceDto[]> {
    try {
      const upstream = await this.client.fetchVoices(VOICE_CATALOG_TYPE_SYSTEM, timeoutMs);
      const voices: SystemVoiceDto[] = upstream.map((voice) => ({
        voiceId: voice.voiceId,
        name: voice.name,
        description: [...voice.description],
      }));
      const ttlMs = this.config.get<number>('minimax.voicesCacheTtlMs') ?? 600_000;
      this.cache = { voices, expiresAt: Date.now() + ttlMs };
      this.logger.log(`[cache_filled] count=${voices.length} ttl_ms=${ttlMs}`);
      return voices;
    } catch (error) {
      throw this.toBizError(error);
    }
  }

  /**
   * 上游错误 → 业务错误.
   *
   * 映射口径 (spec §任务 2「上游 1004 鉴权失败 / 1008 余额不足 → 502 + 可读 message」):
   * - `unauthorized` (1004) / `insufficient_balance` (1008) → **502** (服务端配置问题, 不是用户的错)
   * - `rate_limited` → 429 (可重试)
   * - `timeout` → 504
   * - 其余 → 502
   *
   * **不回传上游原始 message**: 上游 message 可能含内部错误码 / 账号信息, 只进日志.
   *
   * @param error 上游错误
   * @returns 业务异常
   */
  private toBizError(error: unknown): BizException {
    if (!(error instanceof VoiceCatalogUpstreamError)) {
      this.logger.error(`[unexpected_error] ${error instanceof Error ? error.message : String(error)}`);
      return new BizException(BizCode.VoiceCatalogUpstreamUnavailable, '音色列表服务暂不可用，请稍后再试');
    }
    switch (error.kind) {
      case 'insufficient_balance': {
        return new BizException(BizCode.VoiceCatalogUpstreamNoBalance, '音色服务额度不足，暂时无法获取音色列表');
      }
      case 'rate_limited': {
        return new BizException(BizCode.VoiceCatalogUpstreamRateLimited, '音色服务繁忙，请稍后再试');
      }
      case 'timeout': {
        return new BizException(BizCode.VoiceCatalogUpstreamTimeout, '音色列表获取超时，请稍后再试');
      }
      default: {
        return new BizException(BizCode.VoiceCatalogUpstreamUnavailable, '音色列表服务暂不可用，请稍后再试');
      }
    }
  }
}
