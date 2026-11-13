// V2026-11-12 Phase2.5 I-21/I-22 + TD-4 (intake-v2 分档判据 · 单测):
//   覆盖任务单 §2 的六项:
//     ① expert (及未单列模式) 回落 v1 基线档;
//     ② cold 专属档 (候选阈值);
//     ③ 未知模式回落基线档;
//     ④ zero_motion 两类语义 (合理封闭豁免 / 纯 neutral 空转计入);
//     ⑤ catalog 端点的分档结构与版本号;
//     ⑥ 指纹 .js 口径两侧一致 (TD-4).
//   全 mock / 纯函数, 不起 Nest, 不连 DB.
//
//   切片实测值取自 96 场批次 g3ONzlqSGMVJqkFMF9Lwh 的快照 (expert / cold 各 48 场).

import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { AutoPracticeController } from '../../src/auto-practice/auto-practice.controller.js';
import { computeConfigFingerprint } from '../../src/auto-practice/config-fingerprint.js';
import {
  evaluateIntakeAcceptance,
  INTAKE_ACCEPTANCE_VERSION,
  INTAKE_ACCEPTANCE_VERSION_HISTORY,
  INTAKE_EXPECTATIONS,
  INTAKE_EXPECTATIONS_COLD,
  INTAKE_TIERS,
  resolveIntakeTier,
  type AcceptanceResult,
  type ZeroMotionBreakdown,
} from '../../src/auto-practice/metrics/acceptance-thresholds.js';
import { METRIC_BY_ID } from '../../src/auto-practice/metrics/metric-dictionary.js';
import { computePromptVersion, resolveFingerprintSource } from '../../src/auto-practice/prompt-fingerprint.js';

/** expert 切片实测指标 (96 场批次 · 48 场 / 561 轮). */
const EXPERT_METRICS = {
  'dim.trust.delta_avg': 0.138583,
  'dim.safety.delta_avg': 0.02125,
  'dim.bond.delta_avg': 0.0135,
  'dim.depth.delta_avg': -0.019241,
  'dim.style.delta_avg': -0.002225,
  'dim.verbal.delta_avg': -0.038049,
  'dim.arousal.delta_avg': -0.01875,
  'session.zero_motion': 7,
};

/** cold 切片实测指标 (96 场批次 · 48 场 / 551 轮). */
const COLD_METRICS = {
  'dim.trust.delta_avg': 0.029667,
  'dim.safety.delta_avg': 0.003479,
  'dim.bond.delta_avg': 0.002917,
  'dim.depth.delta_avg': -0.000857,
  'dim.style.delta_avg': 0.002384,
  'dim.verbal.delta_avg': -0.00488,
  'dim.arousal.delta_avg': 0.004167,
  'session.zero_motion': 31,
};

/** cold 切片零变化细分 (38 场零变化全部是纯 neutral 空转, 豁免 0 场). */
const COLD_ZERO_MOTION: ZeroMotionBreakdown = { total: 31, closure: 0, idle: 31 };

/** 取某条判据的结果 (找不到直接让用例炸, 避免静默漏判). */
function resultOf(metricId: string, results: readonly AcceptanceResult[]): AcceptanceResult {
  const found = results.find((result) => result.metricId === metricId);
  if (!found) throw new Error(`判据 ${metricId} 不在结果里`);
  return found;
}

describe('Phase2.5 · intake-v2 判据按咨询师模式分档', () => {
  describe('① 档位解析 (expert / cold / 未知模式)', () => {
    it('expert 回落基线档 (v1 阈值原样)', () => {
      const tier = resolveIntakeTier('expert');
      expect(tier.id).toBe('baseline');
      expect(tier.expectations).toBe(INTAKE_EXPECTATIONS);
      expect(tier.provisional).toBe(false);
    });

    it('cold 走专属档 (候选阈值, 待主控复核)', () => {
      const tier = resolveIntakeTier('cold');
      expect(tier.id).toBe('cold');
      expect(tier.expectations).toBe(INTAKE_EXPECTATIONS_COLD);
      expect(tier.counselorModeIds).toEqual(['cold']);
      expect(tier.provisional).toBe(true);
    });

    it('未知模式 / 空模式 id 一律回落基线档', () => {
      for (const mode of ['unknown-mode', 'novice', 'chatty', 'preachy', 'nonsense', '', ' '.repeat(3), undefined, null]) {
        expect(resolveIntakeTier(mode).id).toBe('baseline');
      }
    });

    it('基线档与 cold 档不是同一份阈值 (不复制第二份之外的两张表)', () => {
      expect(INTAKE_EXPECTATIONS).not.toBe(INTAKE_EXPECTATIONS_COLD);
      expect(INTAKE_EXPECTATIONS_COLD.every((item) => item.rationale.includes('待主控复核'))).toBe(true);
    });

    it('所有档的判据都只引用 v1 已覆盖的指标 id (不引入新指标)', () => {
      const v1Ids = new Set(INTAKE_EXPECTATIONS.map((item) => item.metricId));
      for (const tier of INTAKE_TIERS) {
        for (const item of tier.expectations) {
          expect(v1Ids.has(item.metricId)).toBe(true);
          expect(METRIC_BY_ID.has(item.metricId)).toBe(true);
        }
      }
    });
  });

  describe('② 按模式切片判分 (expert 回落 / cold 专属)', () => {
    it('expert 切片按基线档判: 只差 zero_motion 一条', () => {
      const result = evaluateIntakeAcceptance(EXPERT_METRICS, { counselorModeId: 'expert', sessions: 48 });
      expect(result.tierId).toBe('baseline');
      expect(result.acceptanceVersion).toBe('intake-v2');
      expect(result.counselorModeId).toBe('expert');
      expect(result.results).toHaveLength(INTAKE_EXPECTATIONS.length);
      expect(result.passed).toBe(false);
      const failed = result.results.filter((item) => !item.passed);
      expect(failed.map((item) => item.metricId)).toEqual(['session.zero_motion']);
    });

    it('cold 切片按 cold 档判: 实测切片全过', () => {
      const result = evaluateIntakeAcceptance(COLD_METRICS, {
        counselorModeId: 'cold',
        sessions: 48,
        zeroMotion: COLD_ZERO_MOTION,
      });
      expect(result.tierId).toBe('cold');
      expect(result.passed).toBe(true);
      expect(result.results.filter((item) => !item.passed)).toHaveLength(0);
    });

    it('cold 切片若用基线档判 → trust / safety / zero_motion 三条不过 (I-21 的原始现象)', () => {
      const result = evaluateIntakeAcceptance(COLD_METRICS, { counselorModeId: 'novice', sessions: 48 });
      expect(result.tierId).toBe('baseline');
      expect(result.passed).toBe(false);
      const failed = result.results.filter((item) => !item.passed).map((item) => item.metricId);
      expect(failed).toEqual(['dim.trust.delta_avg', 'dim.safety.delta_avg', 'session.zero_motion']);
    });

    it('全局判定不带模式 id → 走基线档 (全局结论保留, 不被分档替换)', () => {
      const result = evaluateIntakeAcceptance(COLD_METRICS, { sessions: 48 });
      expect(result.tierId).toBe('baseline');
      expect(result.counselorModeId).toBeNull();
    });
  });

  describe('③ zero_motion 两类语义 (合理封闭豁免 / 纯 neutral 空转计入)', () => {
    const baseMetrics = { ...COLD_METRICS, 'session.zero_motion': 8 };

    it('事件层存在非 neutral 事件 → 合理封闭, 豁免不计入 (分子归零)', () => {
      const result = evaluateIntakeAcceptance(baseMetrics, {
        counselorModeId: 'cold',
        sessions: 10,
        zeroMotion: { total: 8, closure: 8, idle: 0 },
      });
      const zeroMotion = resultOf('session.zero_motion', result.results);
      expect(zeroMotion.passed).toBe(true);
      expect(zeroMotion.actual).toBe(0);
      expect(zeroMotion.numerator).toBe(0);
      expect(zeroMotion.denominator).toBe(10);
    });

    it('纯 neutral 空转 → 计入失效 (同一总数, 分子不同, 判定相反)', () => {
      const result = evaluateIntakeAcceptance(baseMetrics, {
        counselorModeId: 'cold',
        sessions: 10,
        zeroMotion: { total: 8, closure: 0, idle: 8 },
      });
      const zeroMotion = resultOf('session.zero_motion', result.results);
      expect(zeroMotion.passed).toBe(false);
      expect(zeroMotion.actual).toBe(0.8);
      expect(zeroMotion.numerator).toBe(8);
      expect(zeroMotion.denominator).toBe(10);
    });

    it('基线档不受豁免语义影响 (v1 原语义: 原始计数必须为 0)', () => {
      const result = evaluateIntakeAcceptance(baseMetrics, {
        counselorModeId: 'expert',
        sessions: 10,
        zeroMotion: { total: 0, closure: 0, idle: 0 },
      });
      const zeroMotion = resultOf('session.zero_motion', result.results);
      expect(zeroMotion.passed).toBe(false);
      expect(zeroMotion.actual).toBe(8);
    });

    it('细分缺失 → fail-closed (不通过, 不当缺数据即通过)', () => {
      const result = evaluateIntakeAcceptance(COLD_METRICS, { counselorModeId: 'cold', sessions: 48 });
      const zeroMotion = resultOf('session.zero_motion', result.results);
      expect(zeroMotion.passed).toBe(false);
      expect(zeroMotion.actual).toBeNull();
      expect(result.passed).toBe(false);
    });

    it('切片场次数缺失 → 同样 fail-closed', () => {
      const result = evaluateIntakeAcceptance(COLD_METRICS, {
        counselorModeId: 'cold',
        zeroMotion: COLD_ZERO_MOTION,
      });
      const zeroMotion = resultOf('session.zero_motion', result.results);
      expect(zeroMotion.passed).toBe(false);
      expect(zeroMotion.actual).toBeNull();
    });
  });

  describe('④ catalog 端点 (分档结构 + 版本号)', () => {
    const catalog = AutoPracticeController.buildMetricCatalog();

    it('版本号升到 intake-v2, 且保留 v1 历史', () => {
      expect(INTAKE_ACCEPTANCE_VERSION).toBe('intake-v2');
      expect(catalog.acceptanceVersion).toBe(INTAKE_ACCEPTANCE_VERSION);
      expect(catalog.acceptanceVersionHistory).toEqual(INTAKE_ACCEPTANCE_VERSION_HISTORY);
      expect(catalog.acceptanceVersionHistory).toContain('intake-v1');
      expect(catalog.acceptanceVersionHistory).toContain('intake-v2');
    });

    it('expectations 仍是基线档 (与常量同源, 前端旧镜像不炸)', () => {
      expect(catalog.expectations).toHaveLength(INTAKE_EXPECTATIONS.length);
      expect(catalog.expectations[0]).toBe(INTAKE_EXPECTATIONS[0]);
    });

    it('tiers 下发分档结构 (id / 适用模式 / 是否候选档 / 阈值)', () => {
      expect(catalog.tiers).toHaveLength(INTAKE_TIERS.length);
      const baseline = catalog.tiers.find((tier) => tier.id === 'baseline');
      const cold = catalog.tiers.find((tier) => tier.id === 'cold');
      expect(baseline).toBeDefined();
      expect(baseline?.expectations).toBe(INTAKE_EXPECTATIONS);
      expect(baseline?.counselorModeIds).toEqual([]);
      expect(baseline?.provisional).toBe(false);
      expect(cold?.expectations).toBe(INTAKE_EXPECTATIONS_COLD);
      expect(cold?.counselorModeIds).toEqual(['cold']);
      expect(cold?.provisional).toBe(true);
      expect(cold?.note.length).toBeGreaterThan(0);
    });

    it('catalog 只读: 不下发任何判定结果', () => {
      expect(JSON.stringify(catalog)).not.toContain('passed');
      expect(JSON.stringify(catalog)).not.toContain('actual');
    });
  });

  describe('⑤ 指纹 .js 口径两侧一致 (TD-4)', () => {
    const target = resolveFingerprintSource();

    it('口径解析: 有构建产物时必须是 dist + .js', () => {
      if (target.mode === 'dist') {
        expect(target.extension).toBe('.js');
        expect(target.baseDir.endsWith(join('dist', 'auto-practice'))).toBe(true);
      } else {
        // 无构建产物 (未 build) → 回退当前进程源码口径.
        expect(target.extension).toBe('.ts');
      }
    });

    it('显式按解析出的口径算 === 自动解析算 (两侧同源)', () => {
      const auto = computeConfigFingerprint({ promptVersion: computePromptVersion() });
      const explicit = computeConfigFingerprint({
        promptVersion: computePromptVersion(),
        baseDir: target.baseDir,
        extension: target.extension,
      });
      expect(explicit).toEqual(auto);
      expect(auto.combined).not.toBe('unknown');
    });

    it('prompt 段同样两侧一致', () => {
      const auto = computePromptVersion();
      const explicit = computePromptVersion({ baseDir: target.baseDir, extension: target.extension });
      expect(explicit).toBe(auto);
      expect(auto).not.toBe('unknown');
    });

    it.skipIf(target.mode !== 'dist')('CLI 侧 (源码上下文) 也解析到构建产物, 不再按 .ts 读', () => {
      const srcModulePath = join(target.baseDir, '..', '..', 'src', 'auto-practice', 'prompt-fingerprint.ts');
      const srcTarget = resolveFingerprintSource(srcModulePath);
      expect(srcTarget.mode).toBe('dist');
      expect(srcTarget.extension).toBe('.js');
      expect(srcTarget.baseDir).toBe(target.baseDir);
    });

    it.skipIf(target.mode !== 'dist')('.ts 与 .js 两种口径值确实不同 (统一到 dist 是实质性修复)', () => {
      const srcBase = join(target.baseDir, '..', '..', 'src', 'auto-practice');
      const fromSrc = computePromptVersion({ baseDir: srcBase, extension: '.ts' });
      const fromDist = computePromptVersion({ baseDir: target.baseDir, extension: '.js' });
      expect(fromSrc).not.toBe(fromDist);
    });

    it.skipIf(target.mode !== 'dist')('build 产物在位时, 两侧 config 指纹逐段相同', () => {
      const cliSide = computeConfigFingerprint({ promptVersion: computePromptVersion() });
      const serverSide = computeConfigFingerprint({
        promptVersion: computePromptVersion(),
        baseDir: target.baseDir,
        extension: '.js',
      });
      for (const segment of ['stateTransition', 'alliance', 'deltaTableConfig', 'lexicon', 'baselines', 'prompts', 'acceptance'] as const) {
        expect(cliSide[segment]).toBe(serverSide[segment]);
      }
      expect(cliSide.combined).toBe(serverSide.combined);
    });

    it('fail-closed: 读不到文件 → unknown (不返回半截指纹)', () => {
      const fp = computeConfigFingerprint({
        promptVersion: 'x',
        baseDir: join(target.baseDir, '__no_such_dir__'),
        extension: '.js',
      });
      expect(fp.acceptance).toBe('unknown');
      expect(fp.combined).toBe('unknown');
    });
  });
});
