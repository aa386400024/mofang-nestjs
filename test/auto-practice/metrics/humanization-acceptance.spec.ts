// V2026-11-23 建立 (AF-328 · humanization-v1 判据单测):
//   覆盖版本 / 四条判据 / 模式门 / 低样本 / 缺数据 fail-closed / 指标构建 /
//   CLI 参数解析 / 场次与总体聚合. 纯函数测试: 不读真实逐字稿, 不连 DB.

import { describe, expect, it } from 'vitest';

import { auditSession, buildReport, parseArgs } from '../../../bin/visitor-text-humanization-audit.js';
import type { DisfluencyMetrics } from '../../../src/auto-practice/metrics/disfluency-lexicon.js';
import {
  HUMANIZATION_ACCEPTANCE_VERSION,
  HUMANIZATION_ACCEPTANCE_VERSION_HISTORY,
  HUMANIZATION_EXPECTATIONS,
  buildHumanizationMetrics,
  describeExpectation,
  evaluateHumanization,
} from '../../../src/auto-practice/metrics/humanization-acceptance.js';

const BASE_METRICS: Readonly<Record<string, number | null>> = {
  'text.disfluency.event_turn_rate': 0.4,
  'text.disfluency.events_per_turn': 0.5,
  'text.disfluency.density_per100': 1.3,
  'text.disfluency.repair_per_turn': 0.03,
};

function turn(events: number, chars: number, filler: number): DisfluencyMetrics {
  return {
    counts: { filler, pause: 0, repetition: 0, repair: 0, trailoff: 0, elongation: 0 },
    events,
    hasEvent: events > 0,
    normalizedLength: chars,
  };
}

describe('AF-328 · humanization-v1 版本与判据表', () => {
  it('版本常量与历史链固定', () => {
    expect(HUMANIZATION_ACCEPTANCE_VERSION).toBe('humanization-v1');
    expect(HUMANIZATION_ACCEPTANCE_VERSION_HISTORY[0]).toBe(HUMANIZATION_ACCEPTANCE_VERSION);
  });

  it('判据表覆盖四条核心指标且不含重复 metricId', () => {
    expect(HUMANIZATION_EXPECTATIONS).toHaveLength(4);
    expect(new Set(HUMANIZATION_EXPECTATIONS.map((item) => item.metricId)).size).toBe(4);
    expect(HUMANIZATION_EXPECTATIONS.map((item) => item.metricId)).toContain('text.disfluency.event_turn_rate');
  });

  it('期望描述可读', () => {
    expect(describeExpectation(HUMANIZATION_EXPECTATIONS[0])).toContain('[0.15, 0.6]');
    expect(describeExpectation(HUMANIZATION_EXPECTATIONS[1]).startsWith('<=')).toBe(true);
  });
});

describe('AF-328 · 模式门与样本门', () => {
  it('off 模式不判定', () => {
    const result = evaluateHumanization(BASE_METRICS, { realismMode: 'off', turns: 20 });
    expect(result.status).toBe('not_applicable');
    expect(result.applicable).toBe(false);
    expect(result.results.every((item) => item.status === 'not_applicable')).toBe(true);
  });

  it('audit 模式只测量不判定', () => {
    const result = evaluateHumanization(BASE_METRICS, { realismMode: 'audit', turns: 20 });
    expect(result.status).toBe('not_applicable');
    expect(result.reason).toContain('audit');
    expect(result.results[0].actual).toBe(0.4);
  });

  it('active 但轮次低于最低样本不判定', () => {
    const result = evaluateHumanization(BASE_METRICS, { realismMode: 'active', turns: 2 });
    expect(result.status).toBe('not_applicable');
    expect(result.reason).toContain('样本不足');
  });

  it('active 且轮次未知不判定', () => {
    const result = evaluateHumanization(BASE_METRICS, { realismMode: 'active', turns: null });
    expect(result.status).toBe('not_applicable');
  });
});

describe('AF-328 · active 判据边界', () => {
  it('基线数值全部通过', () => {
    const result = evaluateHumanization(BASE_METRICS, { realismMode: 'active', turns: 20 });
    expect(result.status).toBe('passed');
    expect(result.results.every((item) => item.status === 'pass')).toBe(true);
  });

  it('轮次事件率低于下界失败', () => {
    const result = evaluateHumanization({ ...BASE_METRICS, 'text.disfluency.event_turn_rate': 0.1 }, { realismMode: 'active', turns: 20 });
    expect(result.status).toBe('failed');
    expect(result.results[0].status).toBe('fail');
  });

  it('轮次事件率高于上界失败', () => {
    const result = evaluateHumanization({ ...BASE_METRICS, 'text.disfluency.event_turn_rate': 0.7 }, { realismMode: 'active', turns: 20 });
    expect(result.status).toBe('failed');
  });

  it('每轮事件数超上限失败', () => {
    const result = evaluateHumanization({ ...BASE_METRICS, 'text.disfluency.events_per_turn': 1.2 }, { realismMode: 'active', turns: 20 });
    expect(result.status).toBe('failed');
    expect(result.results[1].status).toBe('fail');
  });

  it('密度超上限失败', () => {
    const result = evaluateHumanization({ ...BASE_METRICS, 'text.disfluency.density_per100': 3.5 }, { realismMode: 'active', turns: 20 });
    expect(result.status).toBe('failed');
    expect(result.results[2].status).toBe('fail');
  });

  it('自我修正超上限失败', () => {
    const result = evaluateHumanization({ ...BASE_METRICS, 'text.disfluency.repair_per_turn': 0.2 }, { realismMode: 'active', turns: 20 });
    expect(result.status).toBe('failed');
    expect(result.results[3].status).toBe('fail');
  });

  it('缺指标时 fail-closed', () => {
    const result = evaluateHumanization({ 'text.disfluency.event_turn_rate': 0.4 }, { realismMode: 'active', turns: 20 });
    expect(result.status).toBe('failed');
    expect(result.results.filter((item) => item.status === 'fail')).toHaveLength(3);
    expect(result.results[1].actual).toBeNull();
  });
});

describe('AF-328 · 指标构建与 CLI', () => {
  it('指标构建与 batch-metrics 同名口径一致', () => {
    const metrics = buildHumanizationMetrics(10, 6, 4, 400, { filler: 3, pause: 2, repetition: 1, repair: 0, trailoff: 0, elongation: 0 });
    expect(metrics['text.disfluency.events_per_turn']).toBe(0.6);
    expect(metrics['text.disfluency.event_turn_rate']).toBe(0.4);
    expect(metrics['text.disfluency.density_per100']).toBe(1.5);
    expect(metrics['text.disfluency.filler_per_turn']).toBe(0.3);
  });

  it('CLI 默认 audit 且支持 ids/json', () => {
    const options = parseArgs(['--mode', 'active', '--ids', 'a,b', '--json', '--min-turns', '8']);
    expect(options.mode).toBe('active');
    expect(options.ids).toEqual(['a', 'b']);
    expect(options.json).toBe(true);
    expect(options.minTurns).toBe(8);
  });

  it('CLI 拒绝非法模式', () => {
    expect(() => parseArgs(['--mode', 'shadow'])).toThrow(/--mode/);
  });

  it('场次审计聚合六类与判据', () => {
    const turns = Array.from({ length: 10 }, (_, index) => turn(index % 2 === 0 ? 1 : 0, 40, index % 2 === 0 ? 1 : 0));
    const audit = auditSession('debug_a', turns, 'active', 5);
    expect(audit.turns).toBe(10);
    expect(audit.events).toBe(5);
    expect(audit.typeCounts.filler).toBe(5);
    expect(audit.evaluation.status).toBe('passed');
  });

  it('总体报告跨场聚合且保留缺失 id', () => {
    const turnsA = Array.from({ length: 10 }, (_, index) => turn(index % 2 === 0 ? 1 : 0, 40, 0));
    const turnsB = Array.from({ length: 10 }, (_, index) => turn(index % 3 === 0 ? 1 : 0, 40, 0));
    const report = buildReport([auditSession('debug_a', turnsA, 'audit'), auditSession('debug_b', turnsB, 'audit')], 'audit', 5, [
      'debug_missing',
    ]);
    expect(report.sessionCount).toBe(2);
    expect(report.totalTurns).toBe(20);
    expect(report.missingIds).toEqual(['debug_missing']);
    expect(report.evaluation.status).toBe('not_applicable');
    expect(report.sessions[0].sessionId).toBe('debug_a');
  });
});
