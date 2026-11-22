// AF-283 · 渲染告警与灰度判读静态守卫:
//   告警规则、Grafana 面板、Runbook 三者必须指向同一组真实指标与同一套回滚判据.
//
//   为什么用静态守卫: 仓库测试环境不起 Prometheus/Grafana; YAML/JSON 语法合法
//   不代表指标名存在、面板表达式不空、Runbook 写了回滚线. 这里只钉"可机械化"的部分.

import { existsSync, readFileSync } from 'node:fs';
import * as path from 'node:path';

import { describe, expect, it } from 'vitest';

const REPO_ROOT = path.join(__dirname, '../..');
const ALERTS = path.join(REPO_ROOT, 'docker/prometheus/alerts.yml');
const DASHBOARD = path.join(REPO_ROOT, 'docker/grafana/dashboards/mofang-overview.json');
const RUNBOOK = path.join(REPO_ROOT, 'docs/runbooks/render-telemetry-alerting.md');
const METRICS = path.join(REPO_ROOT, 'src/shared/infra/metrics/metrics.service.ts');

/** 渲染链路必须被告警覆盖的指标基名. */
const REQUIRED_METRICS = [
  'visitor_render_attempts_total',
  'visitor_render_rounds_total',
  'visitor_render_first_delta_seconds',
  'visitor_render_stream_timeout_total',
  'visitor_render_auth_failure_total',
  'visitor_render_failure_total',
  'visitor_render_cancelled_total',
  'visitor_render_cooldown_served_total',
  'visitor_render_candidate_cooldown_seconds',
  'visitor_render_candidate_cooldown_until_seconds',
  'visitor_render_fallback_total',
  'visitor_render_degraded_total',
] as const;

/** 必须存在的告警名. */
const REQUIRED_ALERTS = [
  'VisitorRenderDegradedRateHigh',
  'VisitorRenderRoundInvariantMismatch',
  'VisitorRenderAuthFailure',
  'VisitorRenderFirstDeltaSlow',
  'VisitorRenderStreamTimeoutSpike',
  'VisitorRenderFallbackRateHigh',
  'VisitorRenderFailureCauseSpike',
  'VisitorRenderCooldownServedSpike',
  'VisitorRenderCandidateCooldownSpike',
] as const;

/** 看板必须包含的渲染面板标题关键词. */
const REQUIRED_PANELS = ['降级率', '首包 P95', '失败原因', '回退率', '熔断', '冷却剩余', '轮次结局'] as const;

describe('AF-283 · 渲染告警规则 / 看板 / Runbook', () => {
  it('告警文件新增 visitor-render 组, 且关键告警齐全', () => {
    const text = readFileSync(ALERTS, 'utf8');
    expect(text).toContain('- name: visitor-render');
    for (const alert of REQUIRED_ALERTS) {
      expect(text, `缺少告警 ${alert}`).toContain(`- alert: ${alert}`);
    }
  });

  it('告警/看板引用的 visitor_render_* 指标都已在 MetricsService 注册', () => {
    const metricSource = readFileSync(METRICS, 'utf8');
    const registered = new Set([...metricSource.matchAll(/name:\s*'([a-zA-Z_:][a-zA-Z0-9_:]*)'/g)].map((match) => match[1]));
    const dashboard = readFileSync(DASHBOARD, 'utf8');
    const haystack = `${readFileSync(ALERTS, 'utf8')}\n${dashboard}`;
    const referenced = new Set([...haystack.matchAll(/visitor_render_[a-z_]+/g)].map((match) => match[0]));
    const unknown: string[] = [];
    for (const name of referenced) {
      const base = name.replace(/_(bucket|count|sum)$/, '');
      if (!registered.has(base)) unknown.push(name);
    }
    expect(unknown, `引用了未注册指标（规则/面板会恒空）:\n${unknown.join('\n')}`).toEqual([]);
    for (const metric of REQUIRED_METRICS) {
      expect(registered.has(metric), `MetricsService 缺指标 ${metric}`).toBe(true);
    }
  });

  it('provider 降级率/回退率分母排除 cancelled 与 guard, 且降级分子排除 guard', () => {
    const text = readFileSync(ALERTS, 'utf8');
    const degradedBlock = text.slice(text.indexOf('VisitorRenderDegradedRateHigh'), text.indexOf('VisitorRenderRoundInvariantMismatch'));
    expect(degradedBlock).toContain('visitor_render_rounds_total{outcome=~"success|degrade|exhausted"}');
    expect(degradedBlock).toContain('cause!="guard"');
    expect(degradedBlock).not.toContain('visitor_render_attempts_total');
    expect(degradedBlock).not.toContain('visitor_render_cancelled_total');
    const fallbackBlock = text.slice(text.indexOf('VisitorRenderFallbackRateHigh'), text.indexOf('VisitorRenderFailureCauseSpike'));
    expect(fallbackBlock).toContain('visitor_render_rounds_total{outcome=~"success|degrade|exhausted"}');
    expect(fallbackBlock).not.toContain('visitor_render_attempts_total');
    expect(fallbackBlock).not.toContain('visitor_render_cancelled_total');
  });

  it('轮次恒等式告警用 unless 守卫 degraded 与 rounds 的对应关系', () => {
    const text = readFileSync(ALERTS, 'utf8');
    const block = text.slice(text.indexOf('VisitorRenderRoundInvariantMismatch'), text.indexOf('VisitorRenderAuthFailure'));
    expect(block).toContain('sum(increase(visitor_render_degraded_total[10m]))');
    expect(block).toContain('visitor_render_rounds_total{outcome=~"degrade|guard|exhausted"}');
    expect(block).toContain('unless');
  });

  it('鉴权告警按 candidate 聚合, $labels.candidate 不再为空', () => {
    const text = readFileSync(ALERTS, 'utf8');
    const authBlock = text.slice(text.indexOf('VisitorRenderAuthFailure'), text.indexOf('VisitorRenderFirstDeltaSlow'));
    expect(authBlock).toContain('sum(increase(visitor_render_auth_failure_total[5m])) by (candidate)');
    expect(authBlock).toContain('$labels.candidate');
  });

  it('突发 Spike 告警都带 1m 持续条件, 鉴权告警不误加', () => {
    const text = readFileSync(ALERTS, 'utf8');
    const spikes = [
      ['VisitorRenderStreamTimeoutSpike', 'VisitorRenderFailureCauseSpike', 'visitor_render_stream_timeout_total', 'by (phase)'],
      ['VisitorRenderFailureCauseSpike', 'VisitorRenderCooldownServedSpike', 'visitor_render_failure_total', 'by (cause)'],
      ['VisitorRenderCooldownServedSpike', 'VisitorRenderCandidateCooldownSpike', 'visitor_render_cooldown_served_total', null],
      [
        'VisitorRenderCandidateCooldownSpike',
        'AuditLogProcessingFailure',
        'visitor_render_candidate_cooldown_seconds_count',
        'by (candidate, cause)',
      ],
    ] as const;

    for (const [name, next, metric, grouping] of spikes) {
      const block = text.slice(text.indexOf(name), text.indexOf(next));
      expect(block).toContain(`sum(increase(${metric}[10m]))`);
      expect(block).toContain('and');
      expect(block).toContain(`sum(increase(${metric}[1m]))`);
      if (grouping) expect(block).toContain(grouping);
    }

    const authBlock = text.slice(text.indexOf('VisitorRenderAuthFailure'), text.indexOf('VisitorRenderFirstDeltaSlow'));
    expect(authBlock).not.toContain('[1m]');
    expect(authBlock).toContain('sum(increase(visitor_render_auth_failure_total[5m])) by (candidate)');
  });

  it('告警 annotation 里的每个 $labels.X 都出现在 expr 的 by(...) 中', () => {
    const text = readFileSync(ALERTS, 'utf8');
    const blocks: { name: string; lines: string[] }[] = [];
    let current: { name: string; lines: string[] } | null = null;
    for (const line of text.split('\n')) {
      const start = /^\s*-\s+alert:\s+([A-Za-z0-9_]+)/.exec(line);
      if (start) {
        if (current) blocks.push(current);
        current = { name: start[1], lines: [] };
      } else if (current) {
        current.lines.push(line);
      }
    }
    if (current) blocks.push(current);

    const violations: string[] = [];
    for (const block of blocks) {
      const exprStart = block.lines.findIndex((line) => line.trim().startsWith('expr:'));
      if (exprStart === -1) continue;
      const labelsStart = block.lines.findIndex((line, index) => index > exprStart && line.trim().startsWith('labels:'));
      const exprEnd = labelsStart === -1 ? block.lines.length : labelsStart;
      const expr = block.lines.slice(exprStart, exprEnd).join('\n');
      const annotation = block.lines.slice(labelsStart === -1 ? exprStart : labelsStart).join('\n');
      const labels = new Set([...annotation.matchAll(/\$labels\.([a-zA-Z_][a-zA-Z0-9_]*)/g)].map((match) => match[1]));
      const labelGroups = [...expr.matchAll(/by\s*\(([^)]*)\)/g)].map((match) => match[1]);
      const byLabels = new Set(labelGroups.flatMap((group) => group.split(',').map((item) => item.trim())));
      for (const label of labels) {
        if (!byLabels.has(label)) violations.push(`${block.name}: $labels.${label} 不在 expr 的 by(...) 里`);
      }
    }
    expect(violations.join('\n')).toBe('');
  });

  it('Grafana 三条比率曲线逐面板使用正确分母, 且降级分子排除 guard', () => {
    const dashboard = JSON.parse(readFileSync(DASHBOARD, 'utf8')) as {
      panels: { id?: number; title?: string; targets?: { expr?: string }[] }[];
    };
    const ratioKeywords = ['降级率', '回退率', '体验失败率', '取消占比'];
    const violations: string[] = [];
    for (const panel of dashboard.panels) {
      const title = panel.title ?? '';
      if (!ratioKeywords.some((keyword) => title.includes(keyword))) continue;
      const targets = panel.targets ?? [];
      if (targets.length === 0) {
        violations.push(`${title}: 没有任何 target`);
        continue;
      }
      for (const target of targets) {
        const expr = target.expr ?? '';
        if (!expr.includes('visitor_render_rounds_total')) violations.push(`${title}: 分母缺 rounds_total -> ${expr}`);
        if (expr.includes('visitor_render_attempts_total')) violations.push(`${title}: 仍用 attempts 作分母 -> ${expr}`);
      }
    }
    expect(violations.join('\n')).toBe('');

    const degradedPanel = dashboard.panels.find((panel) => (panel.title ?? '').includes('provider 降级率'));
    expect(degradedPanel, '看板缺少 provider 降级率曲线').toBeDefined();
    const exprs = (degradedPanel?.targets ?? []).map((target) => target.expr ?? '');
    expect(exprs).toHaveLength(3);
    expect(exprs[0]).toContain('visitor_render_degraded_total{cause!="guard"}');
    expect(exprs[0]).toContain('outcome=~"success|degrade|exhausted"');
    expect(exprs[1]).toContain('sum(increase(visitor_render_degraded_total[10m]))');
    expect(exprs[1]).toContain('outcome!="cancelled"');
    expect(exprs[2]).toContain('visitor_render_cancelled_total');
    expect(exprs[2]).toContain('visitor_render_rounds_total');
  });

  it('Grafana 看板可解析, 且包含渲染面板与真实表达式', () => {
    expect(existsSync(DASHBOARD)).toBe(true);
    const dashboard = JSON.parse(readFileSync(DASHBOARD, 'utf8')) as {
      panels: { title?: string; targets?: { expr?: string }[] }[];
    };
    const renderPanels = dashboard.panels.filter((panel) => (panel.title ?? '').startsWith('来访者渲染:'));
    expect(renderPanels.length).toBeGreaterThanOrEqual(4);
    const titles = renderPanels.map((panel) => panel.title ?? '').join(' ');
    for (const keyword of REQUIRED_PANELS) {
      expect(titles, `看板缺少面板关键词 ${keyword}`).toContain(keyword);
    }
    const exprs = renderPanels.flatMap((panel) => (panel.targets ?? []).map((target) => target.expr ?? '')).join('\n');
    expect(exprs).toContain('visitor_render_degraded_total');
    expect(exprs).toContain('visitor_render_rounds_total');
    expect(exprs).toContain('visitor_render_cancelled_total');
    expect(exprs).toContain('visitor_render_failure_total');
    expect(exprs).toContain('visitor_render_fallback_total');
    expect(exprs).toContain('visitor_render_first_delta_seconds_bucket');
    expect(exprs).toContain('visitor_render_candidate_cooldown_seconds_count');
    expect(exprs).toContain('visitor_render_candidate_cooldown_seconds_bucket');
    expect(exprs).toContain('visitor_render_candidate_cooldown_until_seconds');
  });

  it('Runbook 写清 barge-in 口径、回滚线与回滚命令', () => {
    expect(existsSync(RUNBOOK)).toBe(true);
    const text = readFileSync(RUNBOOK, 'utf8');
    expect(text).toContain('barge-in');
    expect(text).toContain('不是回滚线');
    expect(text).toContain('VISITOR_LLM_PROVIDER=minimax');
    expect(text).toContain('visitor-switch-check.ts');
    expect(text).toContain('>5%');
    expect(text).toContain('VisitorRenderAuthFailure');
    expect(text).toContain('candidate_cooldown_until_seconds');
    expect(text).toContain('此刻是否仍在冷却');
    expect(text).toContain('Alertmanager');
    expect(text).toContain('结构性滞后');
    expect(text).toContain('不进降级/回退分子');
  });
});
