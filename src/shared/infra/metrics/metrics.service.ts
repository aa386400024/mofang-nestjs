import { Injectable, OnModuleInit } from '@nestjs/common';
import { collectDefaultMetrics, Counter, Gauge, Histogram, Registry, type HistogramConfiguration } from 'prom-client';

// ⚠️ 必须直接 import 文件, 详见 redis.service.ts 治本注释.
import { ConfigService } from '../../../common/providers/config.service.js';

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

  // V2026-10-23 治本 (语音微训练 STT 代理 — 上游转写用量):
  //   - 转写次数: 成功 / 失败, 用于成本核算 (上游按音频时长计费)
  //   - 转写耗时: 用于观察上游 P95 延迟, 异常时能第一时间发现
  //   不记录音频内容 (spec §2.5: 只记 userId / duration / trace_id / 耗时)
  private practiceAsrTranscribeCounter!: Counter<string>;
  private practiceAsrDuration!: Histogram<string>;

  // V2026-11-22 (AF-278 · 渲染链路可观测性):
  //   线上"来访者不开口"最常见的原因不是模型质量, 而是首包/块间超时、鉴权失效、
  //   限流或候选耗尽. 这些此前只有日志, 看板无法聚合. 指标只带候选/模型/封闭原因,
  //   不带任何 prompt / 台词 / 会话内容.
  private visitorRenderAttempts!: Counter<string>;
  private visitorRenderFirstDelta!: Histogram<string>;
  private visitorRenderStreamTimeout!: Counter<string>;
  private visitorRenderAuthFailure!: Counter<string>;
  private visitorRenderFailure!: Counter<string>;
  private visitorRenderCancelled!: Counter<string>;
  private visitorRenderCooldownServed!: Counter<string>;
  private visitorRenderCandidateCooldown!: Histogram<string>;
  private visitorRenderCandidateCooldownUntil!: Gauge<string>;
  private visitorRenderFallback!: Counter<string>;
  private visitorRenderDegraded!: Counter<string>;

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

    // ----- 语音微训练 STT -----
    this.practiceAsrTranscribeCounter = new Counter({
      name: 'practice_asr_transcribe_total',
      help: '语音转写调用次数 (按 result 标签: success / failed)',
      labelNames: ['result'],
      registers: [this.registry],
    });
    this.practiceAsrDuration = new Histogram({
      name: 'practice_asr_transcribe_duration_seconds',
      help: '语音转写端到端耗时 (秒, 含上游调用)',
      // 转写是"等一段音频跑完"的量级, 桶比默认 HTTP 桶更贴合.
      buckets: [0.2, 0.5, 1, 2, 3, 5, 8, 10, 15, 20, 30, 45, 60],
      registers: [this.registry],
    });

    // ----- 来访者渲染链路 (AF-278) -----
    this.visitorRenderAttempts = new Counter({
      name: 'visitor_render_attempts_total',
      help: '候选尝试次数 (按 candidate/model/outcome 标签, outcome: success / retry / degrade)',
      labelNames: ['candidate', 'model', 'outcome'],
      registers: [this.registry],
    });
    this.visitorRenderFirstDelta = new Histogram({
      name: 'visitor_render_first_delta_seconds',
      help: '首个可见增量耗时 / TTFT (秒, 按 candidate/model 标签)',
      labelNames: ['candidate', 'model'],
      buckets: [0.1, 0.25, 0.5, 0.8, 1, 1.5, 2, 3, 5, 8, 12, 20, 30],
      registers: [this.registry],
    });
    this.visitorRenderStreamTimeout = new Counter({
      name: 'visitor_render_stream_timeout_total',
      help: '流式等待超时次数 (按 candidate/phase 标签, phase: first-delta / idle)',
      labelNames: ['candidate', 'phase'],
      registers: [this.registry],
    });
    this.visitorRenderAuthFailure = new Counter({
      name: 'visitor_render_auth_failure_total',
      help: '渲染候选鉴权失败次数 (按 candidate 标签)',
      labelNames: ['candidate'],
      registers: [this.registry],
    });
    this.visitorRenderFailure = new Counter({
      name: 'visitor_render_failure_total',
      help: '候选级渲染失败次数 (按 candidate/model/cause 标签, 含末次候选)',
      labelNames: ['candidate', 'model', 'cause'],
      registers: [this.registry],
    });
    this.visitorRenderCancelled = new Counter({
      name: 'visitor_render_cancelled_total',
      help: '渲染外部取消次数 (barge-in/暂停, 按 candidate 标签; 不是降级)',
      labelNames: ['candidate'],
      registers: [this.registry],
    });
    this.visitorRenderCooldownServed = new Counter({
      name: 'visitor_render_cooldown_served_total',
      help: '整轮无候选可用 (全员冷却且未到半开时点) 的全损次数',
      registers: [this.registry],
    });
    this.visitorRenderCandidateCooldown = new Histogram({
      name: 'visitor_render_candidate_cooldown_seconds',
      help: '候选进入冷却或冷却延长时的生效时长 (秒, 按 candidate/model/cause 标签); _count 即进入冷却次数',
      labelNames: ['candidate', 'model', 'cause'],
      // 冷却从 cooldownBaseMs 起步, 按指数退避封顶 cooldownMaxMs; 桶覆盖秒级到 30 分钟.
      buckets: [1, 2, 5, 10, 20, 30, 60, 120, 300, 600, 1200, 1800],
      registers: [this.registry],
    });
    this.visitorRenderCandidateCooldownUntil = new Gauge({
      name: 'visitor_render_candidate_cooldown_until_seconds',
      help: '候选当前冷却到期 Unix 秒 (按 candidate/model 标签); 0 表示已恢复/不在冷却, `值 - time() > 0` 表示此刻仍在冷却',
      labelNames: ['candidate', 'model'],
      registers: [this.registry],
    });
    this.visitorRenderFallback = new Counter({
      name: 'visitor_render_fallback_total',
      help: '候选回退次数 (按 from/to/cause 标签)',
      labelNames: ['from', 'to', 'cause'],
      registers: [this.registry],
    });
    this.visitorRenderDegraded = new Counter({
      name: 'visitor_render_degraded_total',
      help: '最终降级兜底次数 (按 cause 标签)',
      labelNames: ['cause'],
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

  /** 语音转写次数 (成功 / 失败). */
  incPracticeAsrTranscribe(result: 'success' | 'failed'): void {
    if (!this.config.get('metrics').enabled) {
      return;
    }
    this.practiceAsrTranscribeCounter.inc({ result });
  }

  /** 语音转写端到端耗时 (秒). */
  observePracticeAsrDuration(durationSec: number): void {
    if (!this.config.get('metrics').enabled) {
      return;
    }
    this.practiceAsrDuration.observe(durationSec);
  }

  // ----- 来访者渲染链路 (AF-278) -----
  // 标签值由适配层用封闭枚举传入; 这里不再做自由文本清洗 —— 任何自由文本都不该到达这里.

  incVisitorRenderAttempt(candidate: string, model: string, outcome: string): void {
    if (!this.config.get('metrics').enabled) {
      return;
    }
    this.visitorRenderAttempts.inc({ candidate, model, outcome });
  }

  observeVisitorRenderFirstDelta(candidate: string, model: string, seconds: number): void {
    if (!this.config.get('metrics').enabled) {
      return;
    }
    this.visitorRenderFirstDelta.observe({ candidate, model }, seconds);
  }

  incVisitorRenderStreamTimeout(candidate: string, phase: string): void {
    if (!this.config.get('metrics').enabled) {
      return;
    }
    this.visitorRenderStreamTimeout.inc({ candidate, phase });
  }

  incVisitorRenderAuthFailure(candidate: string): void {
    if (!this.config.get('metrics').enabled) {
      return;
    }
    this.visitorRenderAuthFailure.inc({ candidate });
  }

  incVisitorRenderFailure(candidate: string, model: string, cause: string): void {
    if (!this.config.get('metrics').enabled) {
      return;
    }
    this.visitorRenderFailure.inc({ candidate, model, cause });
  }

  incVisitorRenderCancelled(candidate: string): void {
    if (!this.config.get('metrics').enabled) {
      return;
    }
    this.visitorRenderCancelled.inc({ candidate });
  }

  incVisitorRenderCooldownServed(): void {
    if (!this.config.get('metrics').enabled) {
      return;
    }
    this.visitorRenderCooldownServed.inc();
  }

  observeVisitorRenderCandidateCooldown(candidate: string, model: string, cause: string, seconds: number): void {
    if (!this.config.get('metrics').enabled) {
      return;
    }
    this.visitorRenderCandidateCooldown.observe({ candidate, model, cause }, seconds);
  }

  setVisitorRenderCandidateCooldownUntil(candidate: string, model: string, untilSeconds: number): void {
    if (!this.config.get('metrics').enabled) {
      return;
    }
    this.visitorRenderCandidateCooldownUntil.set({ candidate, model }, untilSeconds);
  }

  incVisitorRenderFallback(from: string, to: string, cause: string): void {
    if (!this.config.get('metrics').enabled) {
      return;
    }
    this.visitorRenderFallback.inc({ from, to, cause });
  }

  incVisitorRenderDegraded(cause: string): void {
    if (!this.config.get('metrics').enabled) {
      return;
    }
    this.visitorRenderDegraded.inc({ cause });
  }

  // ========================================================================
  // Export
  // ========================================================================

  getRegistry(): Registry {
    return this.registry;
  }
}
