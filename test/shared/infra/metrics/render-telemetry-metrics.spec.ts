import { describe, expect, it, vi } from 'vitest';

import type { ConfigService } from '../../../../src/common/providers/config.service.js';
import { RenderMetricsTelemetry } from '../../../../src/engine-adapters/rendering/render-metrics.telemetry.js';
import { MetricsService } from '../../../../src/shared/infra/metrics/metrics.service.js';

interface MetricSample {
  readonly name: string;
  readonly values: readonly { readonly labels: Record<string, string | number>; readonly value: number }[];
  readonly type: string;
}

function service(enabled: boolean): MetricsService {
  const config = {
    get: (key: string) => (key === 'metrics' ? { enabled, httpDurationBuckets: [0.1, 1] } : undefined),
  } as unknown as ConfigService;
  const metrics = new MetricsService(config);
  metrics.onModuleInit();
  return metrics;
}

describe('AF-278/AF-282 · 渲染指标注册与标签', () => {
  it('十一类指标可按 candidate / model / phase / cause 标签读出', async () => {
    const metrics = service(true);
    const telemetry = new RenderMetricsTelemetry(metrics);

    telemetry.onAttemptOutcome('minimax', 'MiniMax-M3', 'success');
    telemetry.onAttemptOutcome('minimax', 'MiniMax-M3', 'retry');
    telemetry.onAttemptOutcome('doubao', 'doubao-seed-character-260628', 'success');
    telemetry.onFirstDelta('minimax', 'MiniMax-M3', 1200);
    telemetry.onStreamTimeout('minimax', 'first-delta');
    telemetry.onStreamTimeout('minimax', 'idle');
    telemetry.onAuthFailure('minimax');
    telemetry.onFailure('minimax', 'MiniMax-M3', 'rate-limit');
    telemetry.onCancelled('minimax');
    telemetry.onCooldownServed();
    telemetry.onCandidateCooldown('minimax', 'MiniMax-M3', 'rate-limit', 60_000);
    telemetry.onCandidateCooldownState('minimax', 'MiniMax-M3', 1_760_000_000_000);
    telemetry.onFallback('minimax', 'doubao', 'rate-limit');
    telemetry.onDegraded('exhausted');

    const samples = (await metrics.getRegistry().getMetricsAsJSON()) as unknown as MetricSample[];

    const attempts = samples.find((sample) => sample.name === 'visitor_render_attempts_total');
    expect(attempts).toBeDefined();
    expect(attempts?.values).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ labels: { candidate: 'minimax', model: 'MiniMax-M3', outcome: 'success' }, value: 1 }),
        expect.objectContaining({ labels: { candidate: 'minimax', model: 'MiniMax-M3', outcome: 'retry' }, value: 1 }),
        expect.objectContaining({
          labels: { candidate: 'doubao', model: 'doubao-seed-character-260628', outcome: 'success' },
          value: 1,
        }),
      ]),
    );

    const firstDelta = samples.find((sample) => sample.name === 'visitor_render_first_delta_seconds');
    expect(firstDelta?.type).toBe('histogram');
    expect(firstDelta?.values).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ labels: { candidate: 'minimax', model: 'MiniMax-M3', le: 1 }, value: 0 }),
        expect.objectContaining({ labels: { candidate: 'minimax', model: 'MiniMax-M3', le: 1.5 }, value: 1 }),
      ]),
    );

    const timeouts = samples.find((sample) => sample.name === 'visitor_render_stream_timeout_total');
    expect(timeouts?.values).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ labels: { candidate: 'minimax', phase: 'first-delta' }, value: 1 }),
        expect.objectContaining({ labels: { candidate: 'minimax', phase: 'idle' }, value: 1 }),
      ]),
    );

    expect(
      samples
        .find((sample) => sample.name === 'visitor_render_auth_failure_total')
        ?.values.some((item) => item.labels['candidate'] === 'minimax' && item.value === 1),
    ).toBe(true);
    expect(
      samples
        .find((sample) => sample.name === 'visitor_render_failure_total')
        ?.values.some(
          (item) =>
            item.labels['candidate'] === 'minimax' &&
            item.labels['model'] === 'MiniMax-M3' &&
            item.labels['cause'] === 'rate-limit' &&
            item.value === 1,
        ),
    ).toBe(true);
    expect(
      samples
        .find((sample) => sample.name === 'visitor_render_cancelled_total')
        ?.values.some((item) => item.labels['candidate'] === 'minimax' && item.value === 1),
    ).toBe(true);
    expect(samples.find((sample) => sample.name === 'visitor_render_cooldown_served_total')?.values.some((item) => item.value === 1)).toBe(
      true,
    );
    const candidateCooldown = samples.find((sample) => sample.name === 'visitor_render_candidate_cooldown_seconds');
    expect(candidateCooldown?.type).toBe('histogram');
    expect(candidateCooldown?.values).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          labels: { candidate: 'minimax', model: 'MiniMax-M3', cause: 'rate-limit', le: 60 },
          value: 1,
        }),
      ]),
    );
    const candidateCooldownUntil = samples.find((sample) => sample.name === 'visitor_render_candidate_cooldown_until_seconds');
    expect(candidateCooldownUntil?.type).toBe('gauge');
    expect(candidateCooldownUntil?.values).toEqual(
      expect.arrayContaining([expect.objectContaining({ labels: { candidate: 'minimax', model: 'MiniMax-M3' }, value: 1_760_000_000 })]),
    );
    expect(
      samples
        .find((sample) => sample.name === 'visitor_render_fallback_total')
        ?.values.some(
          (item) =>
            item.labels['from'] === 'minimax' &&
            item.labels['to'] === 'doubao' &&
            item.labels['cause'] === 'rate-limit' &&
            item.value === 1,
        ),
    ).toBe(true);
    expect(
      samples
        .find((sample) => sample.name === 'visitor_render_degraded_total')
        ?.values.some((item) => item.labels['cause'] === 'exhausted' && item.value === 1),
    ).toBe(true);
  });

  it('metrics.enabled=false 时记录全部 no-op', () => {
    const metrics = service(false);
    const telemetry = new RenderMetricsTelemetry(metrics);

    expect(() => {
      telemetry.onAttemptOutcome('minimax', 'MiniMax-M3', 'retry');
      telemetry.onFirstDelta('minimax', 'MiniMax-M3', 500);
      telemetry.onStreamTimeout('minimax', 'idle');
      telemetry.onAuthFailure('minimax');
      telemetry.onFailure('minimax', 'MiniMax-M3', 'server');
      telemetry.onCancelled('minimax');
      telemetry.onCooldownServed();
      telemetry.onCandidateCooldown('minimax', 'MiniMax-M3', 'rate-limit', 1000);
      telemetry.onCandidateCooldownState('minimax', 'MiniMax-M3', 0);
      telemetry.onFallback('minimax', 'doubao', 'auth');
      telemetry.onDegraded('exhausted');
    }).not.toThrow();
  });

  it('指标实现抛错被吞掉, 遥测不反向影响渲染', () => {
    const metrics = {
      incVisitorRenderAttempt: vi.fn(() => {
        throw new Error('registry closed');
      }),
    } as unknown as MetricsService;
    const telemetry = new RenderMetricsTelemetry(metrics);

    expect(() => telemetry.onAttemptOutcome('primary', 'm', 'retry')).not.toThrow();
    expect(metrics.incVisitorRenderAttempt).toHaveBeenCalledWith('primary', 'm', 'retry');
  });
});
