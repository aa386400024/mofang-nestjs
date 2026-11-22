// V2026-11-05 治本 (WP45 · P3-6 · Prometheus 告警规则 ↔ 后端真实指标):
//   背景: `docker/prometheus/alerts.yml` 原来混着三类缺陷 ——
//     ① 3 条规则引用 node_exporter / redis_exporter 的指标, 而 `prometheus.yml` 里
//        这两个 scrape job **是注释掉的** → 指标根本不存在 → **规则永不触发**;
//     ② 4 处模板语法写错 (`{{ ${ $value } }}`) → 告警发得出去, 但描述里的值是空的;
//     ③ 3 处拿 `rate()` 比"次数"阈值 → 与描述口径对不上.
//
//   本守卫把这三类里**能机械化**的那部分钉死:
//     - 断言① 每条规则引用的指标**必须**在后端 `MetricsService` 里注册过
//       (histogram 的 `_bucket` / `_count` / `_sum` 后缀归一到基名);
//     - 断言② 注解里的模板**不允许**出现 `${` (那是写错的形式);
//     - 断言③ 注解里讲"次数"的规则**必须**用 `increase()` 而不是 `rate()`
//       (rate 是每秒速率, 与"次数"口径对不上).
//
//   为什么值得写: "告警规则引用了不存在的指标"这类债**在代码里看不出来** ——
//     YAML 语法合法、PromQL 表达式合法, 只有真去查 Prometheus 才发现它永远为空向量.
//     仓库没有起 Prometheus 的测试环境, 所以用**静态对照**代替.
//
//   ⚠️ 为什么**不引 YAML 解析库**: `js-yaml` / `yaml` 在本仓都只是**传递依赖**
//     (@nestjs/config 带进来的), 拿传递依赖写测试 = 哪天依赖树一变就红.
//     本测试只需要"规则名 / 表达式 / 注解"三样文本, 按行扫一遍就够 —— 不引依赖更稳.
//
//   验证: npx vitest run test/config/wp45-prometheus-alert-metrics.spec.ts
//   时间戳: 2026-11-05 GMT+8
import { existsSync, readFileSync } from 'node:fs';
import * as path from 'node:path';

import { describe, expect, it } from 'vitest';

/** 仓库根目录. */
const REPO_ROOT = path.join(__dirname, '../..');

/** 告警规则文件. */
const ALERTS_FILE = path.join(REPO_ROOT, 'docker/prometheus/alerts.yml');

/** 后端指标注册处 (指标名的唯一真相). */
const METRICS_SERVICE_FILE = path.join(REPO_ROOT, 'src/shared/infra/metrics/metrics.service.ts');

/**
 * PromQL 里出现但**不是**指标名的标识符 (函数 / 关键字 / 修饰符).
 *
 * ⚠️ 为什么要这份名单: 断言要从表达式里"扒"出指标名, 而 PromQL 的表达式里
 *   函数名 (`sum` / `rate` / `increase` / `histogram_quantile`) 和修饰符
 *   (`by` / `on` / `group_left` / `offset`) 跟指标长得一样 —— 不排掉就会误报.
 */
const NON_METRIC_TOKENS = new Set([
  'abs',
  'absent',
  'and',
  'atan2',
  'avg',
  'bool',
  'by',
  'ceil',
  'clamp',
  'clamp_max',
  'clamp_min',
  'count',
  'count_values',
  'delta',
  'deriv',
  'drop_common_labels',
  'floor',
  'group',
  'group_left',
  'group_right',
  'histogram_quantile',
  'idelta',
  'ignoring',
  'increase',
  'info',
  'label_join',
  'label_replace',
  'last_over_time',
  'le',
  'left',
  'ln',
  'log10',
  'log2',
  'max',
  'max_over_time',
  'min',
  'min_over_time',
  'offset',
  'on',
  'or',
  'predict_linear',
  'present_over_time',
  'quantile',
  'quantile_over_time',
  'rate',
  'resets',
  'right',
  'round',
  'scalar',
  'sgn',
  'sort',
  'sort_desc',
  'sqrt',
  'stddev_over_time',
  'stdvar_over_time',
  'sum',
  'sum_over_time',
  'time',
  'timestamp',
  'vector',
]);

/**
 * histogram 的派生后缀 (归一到基名).
 */
const HISTOGRAM_SUFFIXES = ['_bucket', '_count', '_sum'];

/**
 * 一条告警规则 (只取本守卫需要的三个字段).
 */
interface AlertRule {
  /** 规则名. */
  readonly alert: string;
  /** 表达式 (压成一行). */
  readonly expr: string;
  /** 注解 (summary + description 拼一起). */
  readonly annotations: string;
}

/**
 * 逐行扫 `alerts.yml`, 抽出每条规则的 name / expr / annotations.
 *
 * ⚠️ 这是个**极简**的 YAML 扫描器, 只认 Prometheus 告警文件的那几种形状
 *   (`- alert:` / `expr: |` / `annotations:` / `summary:` / `description:`) ——
 *   不引解析库 (见文件头), 也不打算当通用 YAML 解析器用.
 *
 * @param text 文件全文
 * @returns 规则列表
 */
function parseAlertRules(text: string): AlertRule[] {
  const rules: AlertRule[] = [];
  const lines = text.split(/\r?\n/);
  let alert = '';
  let expr: string[] = [];
  let annotations: string[] = [];
  /** 当前块类型. */
  let block: 'none' | 'expr' | 'annotations' = 'none';
  /** 当前块的内容缩进 (比它深才算块内). */
  let blockIndent = 0;

  const flush = (): void => {
    if (alert) rules.push({ alert, expr: expr.join(' '), annotations: annotations.join(' ') });
    alert = '';
    expr = [];
    annotations = [];
    block = 'none';
    blockIndent = 0;
  };

  for (const line of lines) {
    const indent = line.length - line.trimStart().length;
    const alertMatch = /^\s*-\s+alert:\s*(\S+)\s*$/.exec(line);
    if (alertMatch?.[1]) {
      flush();
      alert = alertMatch[1];
      continue;
    }
    if (!alert) continue;
    if (/^\s*expr:\s*\|/.test(line)) {
      block = 'expr';
      blockIndent = indent;
      continue;
    }
    if (/^\s*annotations:\s*$/.test(line)) {
      block = 'annotations';
      blockIndent = indent;
      continue;
    }
    if (/^\s*(labels|for):/.test(line)) {
      block = 'none';
      continue;
    }
    if (block === 'expr' && line.trim() !== '' && indent > blockIndent) {
      expr.push(line.trim());
      continue;
    }
    if (block === 'annotations' && indent > blockIndent && line.includes(':')) {
      annotations.push(line.trim());
    }
  }
  flush();
  return rules;
}

/**
 * 后端 `MetricsService` 里注册的指标名 (全集).
 *
 * @returns 指标名集合
 */
function readBackendMetricNames(): Set<string> {
  const source = readFileSync(METRICS_SERVICE_FILE, 'utf8');
  const names = new Set<string>();
  // 指标注册的写法是 `name: 'xxx'` (prom-client 的构造参数).
  for (const match of source.matchAll(/name:\s*'([a-zA-Z_:][a-zA-Z0-9_:]*)'/g)) {
    const found = match[1];
    if (found) names.add(found);
  }
  return names;
}

/**
 * 从 PromQL 表达式里扒出所有指标名.
 *
 * @param expr 表达式
 * @returns 指标名集合 (去重)
 */
function extractMetricNames(expr: string): Set<string> {
  const found = new Set<string>();
  for (const match of expr.matchAll(/\b([a-zA-Z_][a-zA-Z0-9_]*)\b/g)) {
    const token = match[1];
    if (!token) continue;
    if (NON_METRIC_TOKENS.has(token)) continue;
    // 指标名约定: 含下划线 —— 用来排掉 `le` / `on` 之类的漏网.
    if (!token.includes('_')) continue;
    found.add(token);
  }
  return found;
}

/**
 * 把 histogram 的派生后缀归一到基名.
 *
 * @param name 指标名
 * @returns 基名
 */
function toBaseName(name: string): string {
  for (const suffix of HISTOGRAM_SUFFIXES) {
    if (name.endsWith(suffix)) return name.slice(0, -suffix.length);
  }
  return name;
}

describe('WP45 · P3-6 · Prometheus 告警规则 ↔ 后端真实指标', () => {
  it('① 告警规则文件存在, 且能扫出规则', () => {
    expect(existsSync(ALERTS_FILE)).toBe(true);
    const rules = parseAlertRules(readFileSync(ALERTS_FILE, 'utf8'));
    expect(rules.length).toBeGreaterThan(0);
    // 每条规则都得有名字和表达式 (扫歪了这条会红).
    for (const rule of rules) {
      expect(rule.alert).not.toBe('');
      expect(rule.expr).not.toBe('');
    }
  });

  it('② 每条规则引用的指标都必须在后端 MetricsService 里注册过', () => {
    const backendMetrics = readBackendMetricNames();
    expect(backendMetrics.size).toBeGreaterThan(0);

    const rules = parseAlertRules(readFileSync(ALERTS_FILE, 'utf8'));
    const unknown: string[] = [];
    for (const rule of rules) {
      for (const name of extractMetricNames(rule.expr)) {
        const base = toBaseName(name);
        if (!backendMetrics.has(base)) unknown.push(`${rule.alert} → ${name} (基名 ${base})`);
      }
    }
    expect(unknown, `以下告警规则引用了后端**没暴露**的指标 → 该规则永远不会触发 (要么补指标, 要么删规则):\n${unknown.join('\n')}`).toEqual(
      [],
    );
  });

  it('③ 注解里的模板不许出现 `${` (那是写错的形式, 渲染不出值)', () => {
    const rules = parseAlertRules(readFileSync(ALERTS_FILE, 'utf8'));
    const broken = rules.filter((rule) => rule.annotations.includes('${')).map((rule) => `${rule.alert}: ${rule.annotations}`);
    expect(broken, `以下注解用了非法的 Prometheus 模板语法 (应为 {{ $value }} / {{ $labels.x }}):\n${broken.join('\n')}`).toEqual([]);
  });

  it('④ 描述里说"次数"的规则必须用 increase() 而不是 rate()', () => {
    const rules = parseAlertRules(readFileSync(ALERTS_FILE, 'utf8'));
    const mismatched = rules
      .filter((rule) => rule.annotations.includes('次') && rule.expr.includes('rate(') && !rule.expr.includes('increase('))
      .map((rule) => `${rule.alert}: ${rule.annotations}`);
    expect(mismatched, `以下规则的描述在讲"次数", 表达式却用了 rate() (每秒速率, 口径对不上):\n${mismatched.join('\n')}`).toEqual([]);
  });
});
