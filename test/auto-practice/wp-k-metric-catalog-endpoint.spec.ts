// V2026-11-11 WP-K (指标字典端点投影一致性):
//   守住"后端常量是唯一真相源": catalog 端点下发的字典 / 判据 / 版本号与常量逐条一致,
//   判据引用的指标 id 都在字典内. 纯静态校验, 不起 Nest, 不连 DB.

import { describe, expect, it } from 'vitest';

import { AutoPracticeController } from '../../src/auto-practice/auto-practice.controller.js';
import { INTAKE_EXPECTATIONS, INTAKE_ACCEPTANCE_VERSION } from '../../src/auto-practice/metrics/acceptance-thresholds.js';
import { METRIC_DICTIONARY, METRIC_BY_ID, METRIC_DICTIONARY_VERSION } from '../../src/auto-practice/metrics/metric-dictionary.js';

describe('WP-K · metrics/catalog 投影一致性', () => {
  const catalog = AutoPracticeController.buildMetricCatalog();

  it('字典数组与常量同源 (长度 + 逐条引用一致)', () => {
    expect(catalog.metrics).toHaveLength(METRIC_DICTIONARY.length);
    for (let i = 0; i < METRIC_DICTIONARY.length; i += 1) {
      expect(catalog.metrics[i]).toBe(METRIC_DICTIONARY[i]);
    }
  });

  it('判据数组与常量同源 (长度 + 逐条引用一致)', () => {
    expect(catalog.expectations).toHaveLength(INTAKE_EXPECTATIONS.length);
    for (let i = 0; i < INTAKE_EXPECTATIONS.length; i += 1) {
      expect(catalog.expectations[i]).toBe(INTAKE_EXPECTATIONS[i]);
    }
  });

  it('版本号透传字典版本与判据版本', () => {
    expect(catalog.dictionaryVersion).toBe(METRIC_DICTIONARY_VERSION);
    expect(catalog.acceptanceVersion).toBe(INTAKE_ACCEPTANCE_VERSION);
  });

  it('每条判据引用的指标 id 都在字典内', () => {
    for (const expectation of catalog.expectations) {
      expect(METRIC_BY_ID.has(expectation.metricId)).toBe(true);
    }
  });
});
