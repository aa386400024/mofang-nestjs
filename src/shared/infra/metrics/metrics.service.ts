import { Injectable, OnModuleInit } from '@nestjs/common';
import { collectDefaultMetrics, Counter, Histogram, Registry, type HistogramConfiguration } from 'prom-client';

// ⚠️ 必须直接 import 文件, 详见 redis.service.ts 治本注释.
import { ConfigService } from '../../../common/providers/config.service';

/**
 * Metrics service — Prometheus 指标收集 (大厂可观测性标配).
 *
 * 设计:
 *   - 默认 metrics: process / GC / Node.js (collectDefaultMetrics)
 *   - 业务 metrics: http / auth / oauth / audit
 *   - 全局单 Registry (prom-client 推荐做法)
 *
 * 业务指标 (按 namespace 分类):
 *   - http_requests_total{method, route, code}
 *   - http_request_duration_seconds{method, route, code}
 *   - auth_login_attempts_total{result} (success / failed / locked)
 *   - auth_token_refresh_total
 *   - auth_password_reset_total
 *   - oauth_login_total{provider, result}
 *   - audit_log_enqueued_total / audit_log_failed_total
 *   - verification_code_sent_total{type, channel}
 *
 * 端点:
 *   - /metrics (MetricsController 提供)
 *   - 与 /health 区分: /health 给 LB, /metrics 给 Prometheus scrape
 */
@Injectable()
export class MetricsService implements OnModuleInit {
  private readonly registry = new Registry();

  // HTTP
  private httpRequestsCounter!: Counter<string>;
  private httpRequestDuration!: Histogram<string>;

  // Auth
  private authLoginAttemptsCounter!: Counter<string>;
  private authTokenRefreshCounter!: Counter<string>;
  private authPasswordResetCounter!: Counter<string>;

  // OAuth
  private oauthLoginCounter!: Counter<string>;

  // Verification
  private verificationCodeSentCounter!: Counter<string>;

  // Audit
  private auditLogEnqueuedCounter!: Counter<string>;
  private auditLogFailedCounter!: Counter<string>;

  constructor(private readonly config: ConfigService) {}

  onModuleInit(): void {
    if (!this.config.get('metrics').enabled) {
      return;
    }

    collectDefaultMetrics({ register: this.registry });

    // ----- HTTP -----
    this.httpRequestsCounter = new Counter({
      name: 'http_requests_total',
      help: 'HTTP 请求总数 (按 method/route/code 标签)',
      labelNames: ['method', 'route', 'code'],
      registers: [this.registry],
    });
    const histogramCfg: HistogramConfiguration<string> = {
      name: 'http_request_duration_seconds',
      help: 'HTTP 请求耗时 (秒, 按 method/route/code 标签)',
      labelNames: ['method', 'route', 'code'],
      buckets: this.config.get('metrics').httpDurationBuckets,
      registers: [this.registry],
    };
    this.httpRequestDuration = new Histogram(histogramCfg);

    // ----- Auth -----
    this.authLoginAttemptsCounter = new Counter({
      name: 'auth_login_attempts_total',
      help: '登录尝试次数 (按 result 标签: success / failed / locked / expired_password)',
      labelNames: ['result'],
      registers: [this.registry],
    });
    this.authTokenRefreshCounter = new Counter({
      name: 'auth_token_refresh_total',
      help: 'refresh token 调用次数 (按 result 标签)',
      labelNames: ['result'],
      registers: [this.registry],
    });
    this.authPasswordResetCounter = new Counter({
      name: 'auth_password_reset_total',
      help: '密码重置次数 (按 result 标签)',
      labelNames: ['result'],
      registers: [this.registry],
    });

    // ----- OAuth -----
    this.oauthLoginCounter = new Counter({
      name: 'oauth_login_total',
      help: 'OAuth 登录次数 (按 provider/result 标签)',
      labelNames: ['provider', 'result'],
      registers: [this.registry],
    });

    // ----- Verification -----
    this.verificationCodeSentCounter = new Counter({
      name: 'verification_code_sent_total',
      help: '验证码发送次数 (按 type/channel 标签)',
      labelNames: ['type', 'channel'],
      registers: [this.registry],
    });

    // ----- Audit -----
    this.auditLogEnqueuedCounter = new Counter({
      name: 'audit_log_enqueued_total',
      help: '审计日志成功入队次数 (按 event 标签)',
      labelNames: ['event'],
      registers: [this.registry],
    });
    this.auditLogFailedCounter = new Counter({
      name: 'audit_log_failed_total',
      help: '审计日志失败次数 (按 event/phase 标签, phase: enqueue / process)',
      labelNames: ['event', 'phase'],
      registers: [this.registry],
    });
  }

  // ========================================================================
  // 指标记录 API (供业务层 / Interceptor 调用)
  // ========================================================================

  recordHttpRequest(method: string, route: string, code: number, durationSec: number): void {
    if (!this.config.get('metrics').enabled) {
      return;
    }
    const labels = { method, route, code: String(code) };
    this.httpRequestsCounter.inc(labels);
    this.httpRequestDuration.observe(labels, durationSec);
  }

  incAuthLoginAttempt(result: 'success' | 'failed' | 'locked' | 'expired_password'): void {
    if (!this.config.get('metrics').enabled) {
      return;
    }
    this.authLoginAttemptsCounter.inc({ result });
  }

  incAuthTokenRefresh(result: 'success' | 'failed' | 'revoked'): void {
    if (!this.config.get('metrics').enabled) {
      return;
    }
    this.authTokenRefreshCounter.inc({ result });
  }

  incAuthPasswordReset(result: 'requested' | 'completed' | 'expired' | 'invalid'): void {
    if (!this.config.get('metrics').enabled) {
      return;
    }
    this.authPasswordResetCounter.inc({ result });
  }

  // eslint-disable-next-line @typescript-eslint/naming-convention
  incOAuthLogin(provider: string, result: 'success' | 'failed' | 'linked'): void {
    if (!this.config.get('metrics').enabled) {
      return;
    }
    this.oauthLoginCounter.inc({ provider, result });
  }

  incVerificationCodeSent(
    type: 'email' | 'sms',
    channel: 'register' | 'login' | 'reset_password' | 'change_password' | 'bind_phone',
  ): void {
    if (!this.config.get('metrics').enabled) {
      return;
    }
    this.verificationCodeSentCounter.inc({ type, channel });
  }

  incAuditLogEnqueued(event: string): void {
    if (!this.config.get('metrics').enabled) {
      return;
    }
    this.auditLogEnqueuedCounter.inc({ event });
  }

  incAuditLogFailed(event: string, phase: 'enqueue' | 'process'): void {
    if (!this.config.get('metrics').enabled) {
      return;
    }
    this.auditLogFailedCounter.inc({ event, phase });
  }

  // ========================================================================
  // Export
  // ========================================================================

  getRegistry(): Registry {
    return this.registry;
  }
}
