// V2026-11-09 治本 (Phase2.5 WP-E · 执行器与链路单测):
//   目的: 把执行层与入口层的行为钉死 ——
//     · 离线评测: 预测来自数据集里记录的输出, 一轮一条不多不少;
//     · 全量重跑: 用**当前闸门策略**重算决策 (走 WP-C 的 evaluateGate, 不重写判定);
//     · 链路: 加载 → 清洗 → 跑 → 算指标 → 出报告, 且脏数据真的被挡住.
//
//   为什么全量重跑要单独测:
//     "重跑"是这个流水线最容易做成"假重跑"的地方 —— 嘴上说重算, 实际还在读旧记录.
//     断言 source='resimulated' 且决策真的随策略变化, 就是在防这件事.
//
//   边界: 纯函数 + 临时目录; 不起 Nest 容器, 不连数据库, 不发网络 (审议重跑走假端口).
//
//   验证: npx vitest run test/engine-adapters/eval/eval.runner.spec.ts

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { parseEvalCliArgs } from '../../../scripts/eval-runner.js';
import { DEFAULT_EVAL_GATE_POLICY, EvalRunner, type EvalDeliberationExecutorPort } from '../../../src/engine-adapters/eval/eval.runner.js';
import { runEvaluationPipeline } from '../../../src/engine-adapters/eval/eval.service.js';
import type { EvalCompactState, EvalDataset, EvalSessionRecord, EvalTurnRecord } from '../../../src/engine-adapters/eval/eval.types.js';

// TD-10 · T-2: 真实 ioredis 不进 import 阶段 (适配层仍是真实现; 替身口径见 test/helpers/sdk-stubs.ts).
vi.mock('ioredis', async () => {
  const { createIoredisStub } = await import('../../helpers/sdk-stubs.js');
  return createIoredisStub();
});

/** 中性状态. */
function neutralState(overrides: Partial<EvalCompactState> = {}): EvalCompactState {
  return {
    trust: 0.5,
    safety: 0.5,
    bond: 0.5,
    valence: 0,
    arousal: 0.3,
    verbal: 0.3,
    depth: 0.3,
    style: 0.3,
    positive: 0.05,
    negative: 0.05,
    dependency: 0.05,
    ...overrides,
  };
}

/** 造一轮记录. */
function makeTurn(turnIndex: number, overrides: Partial<EvalTurnRecord> = {}): EvalTurnRecord {
  return {
    turnIndex,
    // ⚠️ 状态逐轮微动 (整场不变会被清洗层判成引擎卡死).
    before: neutralState({ trust: 0.5 + turnIndex * 0.001 }),
    after: neutralState({ trust: 0.5 + (turnIndex + 1) * 0.001 }),
    events: ['empathy'],
    riskLevel: 'low',
    ruleDelta: { trust: 0.01 },
    llmDelta: { trust: 0.02 },
    gateDecision: 'run',
    gateReason: 'alliance_delta_high',
    degraded: false,
    hasError: false,
    totalTokens: 100,
    ...overrides,
  };
}

/** 造一场会话. */
function makeSession(sessionId: string, turnCount: number, overrides: Partial<EvalTurnRecord> = {}, supervisor = true): EvalSessionRecord {
  const turns: EvalTurnRecord[] = [];
  for (let index = 1; index <= turnCount; index += 1) {
    const turn = makeTurn(index, overrides);
    if (supervisor) {
      // ⚠️ 这两个字段是 readonly —— 用 Object.assign 写入 (与直接赋值逐字等价).
      Object.assign(turn, { expectedShouldRun: index % 2 === 1, expectedDeltas: { trust: 0.02 } });
    }
    turns.push(turn);
  }
  return { sessionId, split: 'validation', turns };
}

/** 造一个数据集. */
function makeDataset(sessions: EvalSessionRecord[], split: 'train' | 'validation' = 'validation', version = 'test-v1'): EvalDataset {
  return { version, split, synthetic: true, sessions };
}

describe('EvalRunner · 离线评测', () => {
  it('按数据集记录收集预测, 不重算判定', async () => {
    const runner = new EvalRunner({ mode: 'offline' });
    const result = await runner.run(makeDataset([makeSession('s1', 6)]));
    expect(result.samples).toHaveLength(6);
    expect(result.samples.every((sample) => sample.source === 'recorded')).toBe(true);
    expect(result.samples.every((sample) => sample.predictedShouldRun === true)).toBe(true);
    expect(result.samples.every((sample) => sample.truthShouldRun !== null)).toBe(true);
    expect(result.totalTokens).toBe(600);
  });

  it('没有督导标注时走规则差异真值 (A 方案)', async () => {
    const runner = new EvalRunner({ mode: 'offline' });
    const result = await runner.run(
      makeDataset([makeSession('s1', 6, { ruleDelta: { trust: 0.03 }, llmDelta: { trust: 0.02 } }, false)], 'train'),
    );
    const sample = result.samples[0];
    // 规则 delta (trust 0.03) 与参考审议 delta (trust 0.02) 方向相同、幅度差 0.01 < 0.05 → 不该跑.
    expect(sample.truthShouldRun).toBe(false);
    expect(sample.truthDelta).toBeNull();
  });

  it('规则与审议方向不一致时判为"该跑"', async () => {
    const runner = new EvalRunner({ mode: 'offline' });
    const session = makeSession('s1', 6, { ruleDelta: { trust: 0.03 }, llmDelta: { trust: -0.04 } }, false);
    const result = await runner.run(makeDataset([session], 'train'));
    expect(result.samples[0].truthShouldRun).toBe(true);
  });
});

describe('EvalRunner · 全量重跑', () => {
  it('用当前策略重算闸门决策 (走 WP-C 的 evaluateGate)', async () => {
    const runner = new EvalRunner({ mode: 'full' });
    const result = await runner.run(makeDataset([makeSession('s1', 6)]));
    expect(result.samples.every((sample) => sample.source === 'resimulated')).toBe(true);
    // 首轮强制建立基线 (跑), 之后因冷却 + 全平静 (skip) —— 与记录的"全跑"不同, 证明确实重算了.
    const decisions = result.samples.map((sample) => sample.predictedShouldRun);
    expect(decisions[0]).toBe(true);
    expect(decisions.slice(1).every((decision) => decision === false)).toBe(true);
  });

  it('装了审议执行器时, 审议输出取自执行器', async () => {
    const calls: number[] = [];
    const executor: EvalDeliberationExecutorPort = {
      rerun: async (input) => {
        calls.push(input.turnIndex);
        return { delta: { trust: 0.07 }, totalTokens: 321, degraded: false };
      },
    };
    const turns = [makeTurn(1, { events: ['boundary_cross'] }), makeTurn(2, { events: ['empathy'] })];
    const runner = new EvalRunner({ mode: 'full', deliberationExecutor: executor });
    const result = await runner.run(makeDataset([{ sessionId: 's1', split: 'validation', turns }]));
    expect(calls).toEqual([1]);
    expect(result.samples[0].predictedDelta).toEqual({ trust: 0.07 });
    expect(result.totalTokens).toBe(321);
  });

  it('没装审议执行器时留痕说明"未重跑"', async () => {
    const runner = new EvalRunner({ mode: 'full' });
    const result = await runner.run(makeDataset([makeSession('s1', 3)]));
    expect(result.notes.some((note) => note.includes('未装配审议执行器'))).toBe(true);
  });

  it('缺省闸门策略取自 WP-C 配置层 (阈值只有一份)', () => {
    expect(DEFAULT_EVAL_GATE_POLICY.thresholds.alliance).toBeGreaterThan(0);
    expect(DEFAULT_EVAL_GATE_POLICY.cooldownTurns).toBeGreaterThan(0);
  });
});

describe('runEvaluationPipeline', () => {
  it('串起加载 → 清洗 → 跑 → 算指标 → 出报告', async () => {
    const root = mkdtempSync(join(tmpdir(), 'eval-pipeline-'));
    try {
      const dir = join(root, 'demo-v1');
      mkdirSync(dir);
      const dataset = makeDataset([makeSession('s1', 6), makeSession('dirty', 3)], 'validation', 'demo-v1');
      writeFileSync(join(dir, 'dataset.json'), JSON.stringify(dataset), 'utf8');

      const result = await runEvaluationPipeline({
        mode: 'offline',
        datasetVersion: 'demo-v1',
        datasetRoot: root,
        model: 'test-model',
        promptVersion: 'v1.0',
      });

      const report = result.report;
      expect(report.reportId).toContain('eval-');
      expect(report.config.datasetVersion).toBe('demo-v1');
      expect(report.config.model).toBe('test-model');
      expect(report.config.groundTruthKind).toBe('supervisor');
      expect(report.dataQuality.totalSessions).toBe(2);
      expect(report.dataQuality.validSessions).toBe(1);
      expect(report.dataQuality.dropReasons.too_short).toBe(1);
      expect(report.triggerQuality.support).toBe(6);
      expect(report.suggestionQuality.available).toBe(true);
      expect(report.baselineComparison.available).toBe(true);
      expect(report.runs.count).toBe(1);
      expect(report.cost.totalTokens).toBeGreaterThan(0);
      expect(report.sampleIds).toHaveLength(6);
      expect(result.dropped).toHaveLength(1);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('多跑几次会给出均值与标准差', async () => {
    const root = mkdtempSync(join(tmpdir(), 'eval-pipeline-'));
    try {
      const dir = join(root, 'demo-v1');
      mkdirSync(dir);
      writeFileSync(join(dir, 'dataset.json'), JSON.stringify(makeDataset([makeSession('s1', 6)], 'validation', 'demo-v1')), 'utf8');
      const result = await runEvaluationPipeline({ mode: 'offline', datasetVersion: 'demo-v1', datasetRoot: root, runs: 3 });
      expect(result.report.runs.count).toBe(3);
      // 离线评测是确定性的 → 标准差为 0.
      expect(result.report.runs.stdDev.triggerF1).toBe(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('parseEvalCliArgs', () => {
  it('解析长参数', () => {
    const options = parseEvalCliArgs(['--mode', 'full', '--dataset', 'demo-v1', '--runs', '5', '--print-json']);
    expect(options.mode).toBe('full');
    expect(options.dataset).toBe('demo-v1');
    expect(options.runs).toBe(5);
    expect(options.printJson).toBe(true);
  });

  it('支持 --key=value 写法', () => {
    const options = parseEvalCliArgs(['--mode=offline', '--dataset-root=data/eval-datasets']);
    expect(options.mode).toBe('offline');
    expect(options.datasetRoot).toBe('data/eval-datasets');
  });

  it('缺省走离线模式与合成种子集', () => {
    const options = parseEvalCliArgs([]);
    expect(options.mode).toBe('offline');
    expect(options.dataset).toBe('synthetic-supervisor-v1');
    expect(options.runs).toBeUndefined();
  });
});
