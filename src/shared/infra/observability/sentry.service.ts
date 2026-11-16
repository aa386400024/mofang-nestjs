import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
// eslint-disable-next-line @typescript-eslint/naming-convention
import * as Sentry from '@sentry/node';
import type { NodeOptions } from '@sentry/node';

import {
  SENSITIVE_CONTENT_NAMES,
  SENSITIVE_KEY_NAMES,
  collectMatchingKeys,
  redactEventForSentry,
  redactRecord,
  redactString,
} from './pii-redactor.js';

/**
 * Integration duck type (避免 import 路径问题).
 * Sentry 的 Integration 接口在 @sentry/core 的 types-hoist 里,
 * 直接 import 路径不稳健, 这里只取运行时需要的 name 字段.
 */
export interface SentryIntegration {
  name: string;
}

/** Sentry init 的 dataCollection 类型 (从 NodeOptions 反推, 避免直接依赖 @sentry/core 内部路径). */
export type SentryDataCollection = NonNullable<NodeOptions['dataCollection']>;

/**
 * 严格的数据采集口径 —— **心理数据合规红线**.
 *
 * ⚠️ 为什么不是 sendDefaultPii:
 *   实测 @sentry/node **11.10.0** 已经**删除** `sendDefaultPii` 选项 (v11 换成 dataCollection 模型).
 *   任务单 WP46 原文写的 `sendDefaultPii: false` 在本仓库的 SDK 版本上**根本不存在** ——
 *   照抄会直接 TS 报错, 而且更糟: 以为关掉了 PII 采集, 实际**默认就是开的**.
 *
 * ⚠️ 为什么 httpBodies: [] 是本单最关键的一行:
 *   v11 的 `dataCollection.httpBodies` 默认值是
 *   `['incomingRequest','outgoingRequest','incomingResponse','outgoingResponse']` ——
 *   即**默认采集入站请求体**, 并以**原始字符串**挂到 `event.request.data`.
 *   心塑的请求体里装的是日记正文 / 危机备注 / 对话消息 —— 不关掉就是**按原文送进 Sentry**.
 *   任务单 §一 里"v11 默认 sendDefaultPii: false 不自动 attach"的判断在 11.10.0 上**不成立**,
 *   所以这一项是"堵正在流血的洞", 不是"防御性加固".
 */
export const STRICT_DATA_COLLECTION: SentryDataCollection = {
  // 不自动填 user.* (email / ip) —— 将来接入用户上下文时不会裸奔
  userInfo: false,
  // 不采 cookie
  cookies: false,
  // **不采 HTTP 请求/响应体** —— v11 里这才是"不自动 attach body"的开关
  httpBodies: [],
  // 请求头保留 (Sentry 自带敏感值过滤), 响应头保留
  httpHeaders: { request: true, response: true },
  // query 参数保留 (Sentry 自带敏感 key 过滤)
  urlQueryParams: true,
  // 不采栈帧局部变量 —— v11 默认 true, 而局部变量里常驻心理原文 (如 userInput)
  stackFrameVariables: false,
  // 不采 DB 绑定参数 / 写入载荷 / 返回数据
  databaseQueryData: false,
  // 不采 LLM 输入输出 (prompt / completion)
  genAI: { inputs: false, outputs: false },
  // 不采 GraphQL 文档与变量
  graphQL: { document: false, variables: false },
};

/**
 * Sentry init 的入参 (抽出来是为了**可测**: e2e 用同一份配置跑真实 beforeSend).
 */
export interface SentryInitParams {
  /** Sentry DSN. */
  readonly dsn: string;
  /** 环境名. */
  readonly environment: string;
  /** 版本号. */
  readonly release?: string;
  /** traces 采样率. */
  readonly tracesSampleRate: number;
  /** profiling 采样率 (无 profiler 时传 0). */
  readonly profileSessionSampleRate: number;
  /** profiler integration (取不到时 null). */
  readonly profilingIntegration: SentryIntegration | null;
  /** 数据采集口径 (默认严格口径). */
  readonly dataCollection?: SentryDataCollection;
  /** 是否上报 client report (测试里关掉, 避免 beforeSend 丢弃事件时仍发网络请求). */
  readonly sendClientReports?: boolean;
}

/**
 * 构造 Sentry.init 的配置 (单一事实源).
 *
 * 为什么抽成纯函数:
 *   beforeSend 是本单的核心防线, 但它只在**真跑起来**时才会被调用 ——
 *   抽成纯函数后, e2e 可以拿到**生产同款** beforeSend 去跑真实事件, 而不是自己仿写一遍.
 *
 * @param params init 入参
 * @returns Sentry.init 的配置
 */
export function buildSentryInitOptions(params: SentryInitParams): NodeOptions {
  return {
    dsn: params.dsn,
    environment: params.environment,
    release: params.release,
    tracesSampleRate: params.tracesSampleRate,
    profileSessionSampleRate: params.profileSessionSampleRate,
    // 不暴露服务器主机名 (v11 的 includeServerName 默认 true, 会自动探测 hostname)
    serverName: 'unknown',
    includeServerName: false,
    // 数据采集口径 (见 STRICT_DATA_COLLECTION 的说明)
    dataCollection: params.dataCollection ?? STRICT_DATA_COLLECTION,
    sendClientReports: params.sendClientReports,
    integrations: [
      ...(params.profilingIntegration ? [params.profilingIntegration] : []),
      Sentry.httpIntegration(),
      Sentry.expressIntegration(),
      Sentry.fastifyIntegration(),
    ],
    // PII 脱敏 — beforeSend 是**所有事件必经的最后一道防线**
    // (自动捕获 / 手动上报 / Worker 异常 / Error 自定义属性 全部覆盖)
    //
    // beforeSendTransaction: v11 已标 deprecated, 且默认 traceLifecycle='stream' 时**不生效**
    //   (SDK 会把 transaction 拆成流式 span, 不再产生 transaction event).
    //   这里仍然保留它: 一旦切回 traceLifecycle='static', 它就是最后一道防线 —— 留着比删掉安全.

    beforeSendTransaction(event) {
      return redactEventForSentry(event as unknown as Record<string, unknown>) as unknown as typeof event;
    },
    beforeSend(event) {
      const redacted = redactEventForSentry(event as unknown as Record<string, unknown>) as unknown as typeof event;
      // 屏蔽已知噪音 (DB connection retry 等)
      if (redacted.exception?.values?.some((e) => e.type === 'ECONNRESET')) {
        return null;
      }
      return redacted;
    },
    ignoreErrors: [
      // 已知非异常 — 不上报
      /^Network request failed$/,
      /^Failed to fetch$/,
      'Unauthorized',
      'TokenExpired',
      'TokenRevoked',
      'TokenNotActive',
    ],
  };
}

/**
 * Sentry service — 生产环境异常捕获 + 性能追踪 (大厂可观测性标配).
 *
 * 设计:
 *   - 自动捕获未捕获异常 + 未处理 promise rejection
 *   - HTTP 请求 traces + 性能 profiling
 *   - 集成 NestJS Logger (pino) 自动同步
 *   - 按环境分流 (dev 不上报, prod/staging 100% 异常 + 抽样 perf)
 *
 * 启用条件:
 *   - SENTRY_DSN 必须设置
 *   - NODE_ENV=production 或 staging
 *
 * 大厂做法:
 *   - 异常上报 100% (异常是稀有的, 全量)
 *   - 性能 tracing 抽样 (10%-20%, 避免开销过大)
 *   - profiling 抽样 5% (采样而非全量, 减少 profiler 开销)
 *   - PII 数据脱敏: **两道防线**
 *       ① 采集口径 (dataCollection) —— 源头不采 (body / cookie / user.* / 栈帧局部变量);
 *       ② beforeSend 事件级递归脱敏 —— 万一有人把内容手动塞进 extra, 或误开采集, 仍会被遮.
 *     两道防线的口径共用 src/shared/infra/observability/pii-redactor.ts (单一事实源).
 */
@Injectable()
export class SentryService implements OnModuleInit {
  private readonly logger = new Logger(SentryService.name);
  private initialized = false;

  async onModuleInit(): Promise<void> {
    const dsn = process.env.SENTRY_DSN;
    const env = process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV ?? 'development';
    if (!dsn) {
      this.logger.warn('Sentry DSN not set, error reporting disabled');
      return;
    }
    if (env === 'development') {
      this.logger.warn('Sentry disabled in development');
      return;
    }

    const tracesSampleRate = Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? '0.1'); // 10%
    const profilesSampleRate = Number(process.env.SENTRY_PROFILES_SAMPLE_RATE ?? '0.05'); // 5%

    // Profiler 是 nice-to-have, 不是必需. Node ABI 不匹配时优雅降级.
    let profilingIntegration: SentryIntegration | null = null;
    try {
      // dynamic import 避免 native binary 缺失时阻塞启动
      const { nodeProfilingIntegration } = await import('@sentry/profiling-node');
      profilingIntegration = nodeProfilingIntegration();
    } catch (err) {
      this.logger.warn(
        `Sentry profiling disabled (native binary mismatch or missing): ${(err as Error).message}. ` +
          'This is OK — traces + errors still work. To enable profiling, run npm rebuild @sentry/profiling-node.',
      );
    }

    Sentry.init(
      buildSentryInitOptions({
        dsn,
        environment: env,
        release: process.env['SENTRY_RELEASE'] ?? undefined,
        tracesSampleRate,
        profileSessionSampleRate: profilingIntegration ? profilesSampleRate : 0,
        profilingIntegration,
      }),
    );

    this.initialized = true;
    this.logger.log(`Sentry initialized: env=${env} tracesSampleRate=${tracesSampleRate} profilesSampleRate=${profilesSampleRate}`);
  }

  /**
   * 手动上报业务异常 (异步流程 / Worker 进程).
   * main process 的异常 NestJS 自动捕获上报, 这个给 BullMQ Worker 用.
   *
   * @param err 原始异常
   * @param context 附加上下文 (会先过一遍脱敏)
   */
  captureException(err: unknown, context?: Record<string, unknown>): void {
    if (!this.initialized) {
      return;
    }
    // 业务侧不要把 prompt / userInput / chat history 传进 context —— 那会把心理原文送进 Sentry.
    const extra = context ? redactRecord(context, SENSITIVE_KEY_NAMES) : undefined;
    this.warnIfContentFieldsLeak(context);
    Sentry.captureException(err, { extra });
  }

  /**
   * 手动上报业务事件 (注册 / 支付成功等).
   *
   * @param message 事件描述
   * @param level 级别
   * @param context 附加上下文 (会先过一遍脱敏)
   */
  captureMessage(message: string, level: 'info' | 'warning' | 'error' = 'info', context?: Record<string, unknown>): void {
    if (!this.initialized) {
      return;
    }
    const extra = context ? redactRecord(context, SENSITIVE_KEY_NAMES) : undefined;
    this.warnIfContentFieldsLeak(context);
    Sentry.captureMessage(redactString(message), { level, extra });
  }

  /**
   * dev 模式提示: extra 里出现了心理内容类字段名.
   *
   * 只提示, **不自动遮** —— extra 装的是业务手动传的调试数据 (业务 id 是排查必需的),
   * 自动遮会误伤; 真要遮心理内容, 正确做法是别把它塞进 extra (见 §五.7).
   *
   * @param context 附加上下文
   */
  private warnIfContentFieldsLeak(context?: Record<string, unknown>): void {
    if (!context || process.env.NODE_ENV === 'production') {
      return;
    }
    const hits = collectMatchingKeys(context, SENSITIVE_CONTENT_NAMES);
    if (hits.length === 0) {
      return;
    }
    this.logger.warn(`[sentry] extra 里命中心理内容字段名: ${hits.join(', ')} —— 已保留 (extra 不遮业务内容类), 请确认是否确有必要`);
  }
}
