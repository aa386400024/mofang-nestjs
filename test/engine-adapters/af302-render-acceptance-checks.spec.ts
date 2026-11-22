import { describe, expect, it } from 'vitest';
import { buildMetricProbe, checkExpectations, extractJsonReport } from '../../bin/lib/render-acceptance-checks.js';
import type { RenderMetricSample } from '../../bin/lib/render-acceptance-checks.js';

function sample(name: string, labels: Record<string, string | number>, value: number): RenderMetricSample {
  return { name, values: [{ labels, value }] };
}

const SAMPLES: readonly RenderMetricSample[] = [
  sample('visitor_render_rounds_total', { outcome: 'exhausted' }, 1),
  sample('visitor_render_degraded_total', { cause: 'exhausted' }, 1),
  sample('visitor_render_failure_total', { candidate: 'doubao', cause: 'server' }, 1),
  sample('visitor_render_failure_total', { candidate: 'minimax', cause: 'server' }, 1),
  sample('visitor_render_fallback_total', { from: 'doubao', to: 'minimax', cause: 'server' }, 1),
  sample('visitor_render_attempts_total', { candidate: 'doubao', outcome: 'retry' }, 1),
  sample('visitor_render_attempts_total', { candidate: 'minimax', outcome: 'retry' }, 1),
  sample('visitor_render_cooldown_served_total', {}, 0),
];

describe('AF-302 渲染故障矩阵自证断言', () => {
  it('按标签求和：双候选 server 失败合计 2，切换恰好 1 次', () => {
    const probe = buildMetricProbe(SAMPLES);
    expect(probe.sum('visitor_render_failure_total', { cause: 'server' })).toBe(2);
    expect(probe.sum('visitor_render_fallback_total', { cause: 'server' })).toBe(1);
    expect(probe.sum('visitor_render_attempts_total', { outcome: 'retry' })).toBe(2);
    expect(probe.sum('visitor_render_failure_total', { cause: 'server', candidate: 'doubao' })).toBe(1);
  });

  it('零值样本算存在，缺失指标求和为 0 且 present 为 false', () => {
    const probe = buildMetricProbe(SAMPLES);
    expect(probe.present('visitor_render_cooldown_served_total')).toBe(true);
    expect(probe.present('visitor_render_stream_timeout_total')).toBe(false);
    expect(probe.sum('visitor_render_stream_timeout_total')).toBe(0);
  });

  it('全部命中时通过；数值不符时报出期望与真实值', () => {
    const probe = buildMetricProbe(SAMPLES);
    expect(
      checkExpectations(probe, [
        { metric: 'visitor_render_rounds_total', labels: { outcome: 'exhausted' }, equals: 1, description: '轮次' },
        { metric: 'visitor_render_failure_total', labels: { cause: 'server' }, equals: 2, description: '失败合计' },
      ]).passed,
    ).toBe(true);

    const result = checkExpectations(probe, [
      { metric: 'visitor_render_failure_total', labels: { cause: 'server' }, equals: 1, description: '失败合计' },
    ]);
    expect(result.passed).toBe(false);
    expect(result.failures[0]).toContain('期望 visitor_render_failure_total{cause=server}=1，实际 2');
  });

  it('不应出现的指标用 equals:0 断言，多出一次即失败', () => {
    const probe = buildMetricProbe([...SAMPLES, sample('visitor_render_stream_timeout_total', { phase: 'idle' }, 1)]);
    const result = checkExpectations(probe, [
      { metric: 'visitor_render_stream_timeout_total', equals: 0, description: '连接失败不记超时' },
    ]);
    expect(result.passed).toBe(false);
    expect(result.failures[0]).toContain('实际 1');
  });

  it('atLeast / atMost 边界', () => {
    const probe = buildMetricProbe(SAMPLES);
    expect(
      checkExpectations(probe, [
        { metric: 'visitor_render_attempts_total', atLeast: 2, description: '至少两次重试' },
        { metric: 'visitor_render_fallback_total', atMost: 1, description: '最多一次切换' },
      ]).passed,
    ).toBe(true);
    const failed = checkExpectations(probe, [{ metric: 'visitor_render_fallback_total', atMost: 0, description: '不允许切换' }]);
    expect(failed.passed).toBe(false);
  });

  it('从 smoke 输出提取末尾 JSON 报告，忽略前置诊断行', () => {
    const stdout = ['[smoke] loading env', 'warning: model', JSON.stringify({ ok: true, renderMetrics: [] }, null, 2)].join('\n');
    expect(extractJsonReport(stdout)).toEqual({ ok: true, renderMetrics: [] });
  });

  it('没有 JSON 报告或报告损坏时抛出可读错误', () => {
    expect(() => extractJsonReport('no report here')).toThrow('没有 JSON 报告起始行');
    expect(() => extractJsonReport('{\nbroken')).toThrow('JSON 报告解析失败');
  });
});
