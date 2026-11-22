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

  it('降级率与回退率的分母是终局轮次, 且降级分子排除 guard', () => {
    const text = readFileSync(ALERTS, 'utf8');
    const degradedBlock = text.slice(text.indexOf('VisitorRenderDegradedRateHigh'), text.indexOf('VisitorRenderAuthFailure'));
    expect(degradedBlock).toContain('visitor_render_rounds_total');
    expect(degradedBlock).toContain('cause!="guard"');
    expect(degradedBlock).not.toContain('visitor_render_attempts_total');
    expect(degradedBlock).not.toContain('visitor_render_cancelled_total');
    const fallbackBlock = text.slice(text.indexOf('VisitorRenderFallbackRateHigh'), text.indexOf('VisitorRenderFailureCauseSpike'));
    expect(fallbackBlock).toContain('visitor_render_rounds_total');
    expect(fallbackBlock).not.toContain('visitor_render_attempts_total');
    expect(fallbackBlock).not.toContain('visitor_render_cancelled_total');
  });

  it('鉴权告警按 candidate 聚合, $labels.candidate 不再为空', () => {
    const text = readFileSync(ALERTS, 'utf8');
    const authBlock = text.slice(text.indexOf('VisitorRenderAuthFailure'), text.indexOf('VisitorRenderFirstDeltaSlow'));
    expect(authBlock).toContain('sum(increase(visitor_render_auth_failure_total[5m])) by (candidate)');
    expect(authBlock).toContain('$labels.candidate');
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
  });
});
