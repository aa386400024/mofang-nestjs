import { Injectable } from '@nestjs/common';

import type { RenderAttemptOutcome, RenderFailureCause, RenderStreamTimeoutPhase, RenderTelemetryPort } from './render-telemetry.port.js';
import type { MetricsService } from '../../shared/infra/metrics/metrics.service.js';

/**
 * 把渲染遥测回调映射到 Prometheus (AF-278).
 *
 * 设计取舍:
 *   - 只依赖 `MetricsService` 的窄面方法, 不直接碰 prom-client Registry —— 注册点仍在
 *     `MetricsService.onModuleInit`, 所以 `metrics.enabled=false` 时全部是 no-op.
 *   - 所有方法 try/catch 吞掉异常: 遥测是旁路, 不能因为指标登记失败把一轮对练打挂.
 */
@Injectable()
export class RenderMetricsTelemetry implements RenderTelemetryPort {
  constructor(private readonly metrics: MetricsService) {}

  onAttemptOutcome(candidateId: string, model: string, outcome: RenderAttemptOutcome): void {
    this.safe(() => this.metrics.incVisitorRenderAttempt(candidateId, model, outcome));
  }

  onFirstDelta(candidateId: string, model: string, ttftMs: number): void {
    if (ttftMs < 0 || !Number.isFinite(ttftMs)) return;
    this.safe(() => this.metrics.observeVisitorRenderFirstDelta(candidateId, model, ttftMs / 1000));
  }

  onStreamTimeout(candidateId: string, phase: RenderStreamTimeoutPhase): void {
    this.safe(() => this.metrics.incVisitorRenderStreamTimeout(candidateId, phase));
  }

  onAuthFailure(candidateId: string): void {
    this.safe(() => this.metrics.incVisitorRenderAuthFailure(candidateId));
  }

  onFailure(candidateId: string, model: string, cause: RenderFailureCause): void {
    this.safe(() => this.metrics.incVisitorRenderFailure(candidateId, model, cause));
  }

  onCancelled(candidateId: string): void {
    this.safe(() => this.metrics.incVisitorRenderCancelled(candidateId));
  }

  onFallback(from: string, to: string, cause: RenderFailureCause): void {
    this.safe(() => this.metrics.incVisitorRenderFallback(from, to, cause));
  }

  onDegraded(cause: RenderFailureCause): void {
    this.safe(() => this.metrics.incVisitorRenderDegraded(cause));
  }

  private safe(fn: () => void): void {
    try {
      fn();
    } catch {
      // 遥测故障不得反向影响渲染主流程.
    }
  }
}
