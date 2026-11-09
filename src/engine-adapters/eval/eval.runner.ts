// V2026-11-09 治本 (Phase2.5 WP-E · 自动评测 · 执行层):
//   职责: **跑**一批会话, 收集每一轮的预测 (闸门跑没跑 / 审议给了什么 delta).
//   边界: 不算指标 —— 指标一律委托 eval.metrics.ts 的纯函数; 不做清洗 —— 清洗在数据层.
//
//   两种模式的差别 (任务单 §6.1):
//     · 离线评测: 预测来自**数据集里记录的历史输出** —— 评的是"上一版跑得怎么样".
//       零成本、秒级, 改了指标口径 / 清洗规则 / 报告格式时用它.
//     · 全量重跑: 用**当前的闸门策略**重新判定每一轮 (纯函数重算, 确定性),
//       审议部分通过窄端口重跑 —— 改了阈值 / prompt / 引擎逻辑时用它.
//       ⚠️ 重算闸门走的是 WP-C 的 evaluateGate (唯一判定口径), 本文件**不重写**一遍:
//       评测里再写一份判定 = 两份阈值逻辑迟早漂移, 而"评测说闸门变了"可能只是评测自己变了.
//
//   ⚠️ 为什么"全量重跑"里审议重跑是**可选端口**:
//     审议重跑要真调模型 (花钱、几十秒), 而评测的**主要用途**是"改阈值后快快看一眼".
//     把重跑能力做成窄端口: 装配了就重跑 (真·全量), 没装配就只重算闸门决策,
//     并在报告的 notes 里写明"未装配审议执行器" —— 不静默假装重跑过了.
//
//   如何验证:
//     1. npx tsc -p tsconfig.build.json --noEmit 0 错
//     2. test/engine-adapters/eval/eval.runner.spec.ts 覆盖离线 / 全量两条路径

import { resolveSessionSplit, toBdiSnapshot } from './eval.dataset.js';
import { createGroundTruthProvider, type EvalGroundTruthProvider } from './eval.ground-truth.js';
import type { EvalDelta, EvalMode, EvalRiskLevel, EvalSessionRecord, EvalSplit, EvalTurnRecord } from './eval.types.js';
import type { BdiSnapshot } from '../../engine-core/index.js';
import {
  DEFAULT_GATE_ALLIANCE_THRESHOLD_EFFECT,
  DEFAULT_GATE_CALM_THRESHOLD_EFFECT,
  DEFAULT_GATE_COOLDOWN_TURNS_EFFECT,
  DEFAULT_GATE_GLOBAL_RPM,
  DEFAULT_GATE_MAX_PER_SESSION_EFFECT,
  DEFAULT_GATE_RESISTANCE_THRESHOLD_EFFECT,
} from '../deliberation-gate/deliberation-gate.config.js';
import { evaluateGate } from '../deliberation-gate/deliberation-gate.evaluator.js';
import type { GateEventTag, GateInput, GateMode, GatePolicy, GateRuntimeState } from '../deliberation-gate/deliberation-gate.types.js';

/**
 * 缺省的闸门策略 (生效模式).
 *
 * ⚠️ 阈值**不写死在本文件** —— 全部取自 WP-C 的配置层缺省常量 (唯一真相).
 *   这里只做"选生效模式那一套 + 补齐策略结构".
 */
export const DEFAULT_EVAL_GATE_POLICY: GatePolicy = {
  thresholds: {
    alliance: DEFAULT_GATE_ALLIANCE_THRESHOLD_EFFECT,
    resistance: DEFAULT_GATE_RESISTANCE_THRESHOLD_EFFECT,
    calm: DEFAULT_GATE_CALM_THRESHOLD_EFFECT,
  },
  cooldownTurns: DEFAULT_GATE_COOLDOWN_TURNS_EFFECT,
  maxPerSession: DEFAULT_GATE_MAX_PER_SESSION_EFFECT,
  globalRpm: DEFAULT_GATE_GLOBAL_RPM,
  circuitEnabled: true,
};

/** 审议重跑的入参 (零对话原文 —— 与审议层自身的合规口径一致). */
export interface EvalDeliberationRerunInput {
  /** 会话 id. */
  readonly sessionId: string;
  /** 轮次. */
  readonly turnIndex: number;
  /** 本轮开始时的快照. */
  readonly stateBefore: BdiSnapshot;
  /** 本轮结束后的快照. */
  readonly stateAfter: BdiSnapshot;
  /** 本轮事件标签. */
  readonly events: readonly string[];
  /** 本轮风险等级. */
  readonly riskLevel: EvalRiskLevel;
}

/** 审议重跑的结果. */
export interface EvalDeliberationRerunOutcome {
  /** 审议给出的 delta (null = 没产出). */
  readonly delta: EvalDelta | null;
  /** token 消耗. */
  readonly totalTokens: number;
  /** 是否降级. */
  readonly degraded: boolean;
  /** 错误信息 (失败时). */
  readonly error?: string;
}

/**
 * 审议重跑端口 (窄端口).
 *
 * ⚠️ 为什么是接口: 评测不该知道审议怎么实现的 (模型 / prompt / 熔断 / Redis 配额).
 *   装配了就重跑, 没装配就不重跑 —— 跟 WP-C 的 DeliberationGatePort 同一思路:
 *   "缺省缺席 = 纯增强", 缺席时评测照常能跑 (只是少一段).
 */
export interface EvalDeliberationExecutorPort {
  /** 重跑这一轮的审议. */
  rerun(input: EvalDeliberationRerunInput): Promise<EvalDeliberationRerunOutcome>;
}

/** 执行器参数. */
export interface EvalRunnerOptions {
  /** 评测模式. */
  readonly mode: EvalMode;
  /** 闸门策略 (全量重跑时用; 缺省 = 生效模式缺省策略). */
  readonly gatePolicy?: GatePolicy;
  /** 闸门模式 (影子 / 生效). */
  readonly gateMode?: GateMode;
  /** 审议重跑端口 (可选). */
  readonly deliberationExecutor?: EvalDeliberationExecutorPort;
}

/** 一轮预测 (执行层收集到的东西). */
export interface EvalPredictionSample {
  /** 会话 id. */
  readonly sessionId: string;
  /** 轮次. */
  readonly turnIndex: number;
  /** 切分. */
  readonly split: EvalSplit;
  /** 真值: 该不该跑 (null = 未知). */
  readonly truthShouldRun: boolean | null;
  /** 预测: 闸门跑了没 (null = 没有 trace). */
  readonly predictedShouldRun: boolean | null;
  /** 预测: 审议输出. */
  readonly predictedDelta: EvalDelta | null;
  /** 基线: 规则输出. */
  readonly baselineDelta: EvalDelta | null;
  /** 真值: 期望 delta. */
  readonly truthDelta: EvalDelta | null;
  /** 预测来源. */
  readonly source: 'recorded' | 'resimulated';
  /** 本轮 token 消耗. */
  readonly totalTokens: number;
}

/** 一次运行的收集结果. */
export interface EvalRunResult {
  /** 逐轮预测. */
  readonly samples: readonly EvalPredictionSample[];
  /** 总 token 消耗. */
  readonly totalTokens: number;
  /** 耗时 (秒). */
  readonly durationSec: number;
  /** 备注 (偏离预期的情形, 比如"未装配审议执行器"). */
  readonly notes: readonly string[];
}

/**
 * 评测执行器.
 *
 * ⚠️ 纯收集, 不算指标 —— 指标在 eval.metrics.ts, 报告在 eval.report.ts.
 */
export class EvalRunner {
  constructor(private readonly options: EvalRunnerOptions) {}

  /**
   * 跑一遍数据集.
   *
   * @param dataset 已清洗的数据集
   * @returns 收集到的逐轮预测
   */
  async run(dataset: EvalDatasetLike): Promise<EvalRunResult> {
    const startedAt = Date.now();
    const samples: EvalPredictionSample[] = [];
    const notes: string[] = [];
    let totalTokens = 0;

    for (const session of dataset.sessions) {
      const split = resolveSessionSplit(session, dataset.split);
      const provider = createGroundTruthProvider(session, split);
      const gateState = this.createGateState();

      for (const turn of session.turns) {
        const outcome = await this.runTurn(session, turn, split, provider, gateState);
        samples.push(outcome.sample);
        notes.push(...outcome.notes);
        totalTokens += outcome.sample.totalTokens;
      }
    }

    return {
      samples,
      totalTokens,
      durationSec: (Date.now() - startedAt) / 1000,
      notes,
    };
  }

  /**
   * 跑一轮, 收集这一轮的预测.
   *
   * @param session 会话
   * @param turn 轮次
   * @param split 切分
   * @param provider 真值提供者
   * @param gateState 跨轮次的闸门运行时状态
   * @returns 预测样本 + 备注
   */
  private async runTurn(
    session: EvalSessionRecord,
    turn: EvalTurnRecord,
    split: EvalSplit,
    provider: EvalGroundTruthProvider,
    gateState: { lastTurn: number | null; sessionRunCount: number },
  ): Promise<{ sample: EvalPredictionSample; notes: string[] }> {
    const notes: string[] = [];
    const truthShouldRun = provider.shouldRun(turn);
    const truthDelta = provider.expectedDeltas(turn);

    let predictedShouldRun: boolean | null = turn.gateDecision === null ? null : turn.gateDecision === 'run';
    let predictedDelta: EvalDelta | null = turn.llmDelta;
    let source: 'recorded' | 'resimulated' = 'recorded';
    // ⚠️ 离线模式计**历史**消耗; 全量重跑只计**本次真花掉的** (审议执行器回报的),
    //   否则"重跑一次"的成本会被历史记录重复计一遍.
    let tokens = this.options.mode === 'full' ? 0 : (turn.totalTokens ?? 0);

    if (this.options.mode === 'full') {
      const decision = this.resimulateGate(session, turn, gateState);
      predictedShouldRun = decision.decision === 'run';
      source = 'resimulated';
      if (decision.decision === 'run') {
        gateState.lastTurn = turn.turnIndex;
        gateState.sessionRunCount += 1;
        const outcome = await this.rerunDeliberation(session, turn);
        if (outcome) {
          predictedDelta = outcome.delta;
          tokens = outcome.totalTokens;
          if (outcome.error) {
            notes.push(`会话 ${session.sessionId} 第 ${turn.turnIndex} 轮审议重跑失败: ${outcome.error}`);
          }
        } else {
          notes.push(`会话 ${session.sessionId} 第 ${turn.turnIndex} 轮: 未装配审议执行器, 沿用数据集中记录的审议输出`);
        }
      }
    }

    return {
      notes,
      sample: {
        sessionId: session.sessionId,
        turnIndex: turn.turnIndex,
        split,
        truthShouldRun,
        predictedShouldRun,
        predictedDelta,
        baselineDelta: turn.ruleDelta,
        truthDelta,
        source,
        totalTokens: tokens,
      },
    };
  }

  /**
   * 重跑这一轮的审议 (没装配执行器时返回 null).
   *
   * @param session 会话
   * @param turn 轮次
   * @returns 审议结果 (未装配则为 null)
   */
  private async rerunDeliberation(session: EvalSessionRecord, turn: EvalTurnRecord): Promise<EvalDeliberationRerunOutcome | null> {
    const executor = this.options.deliberationExecutor;
    if (!executor) return null;
    return executor.rerun({
      sessionId: session.sessionId,
      turnIndex: turn.turnIndex,
      stateBefore: toBdiSnapshot(turn.before),
      stateAfter: toBdiSnapshot(turn.after),
      events: turn.events,
      riskLevel: turn.riskLevel,
    });
  }

  /**
   * 用当前策略重算这一轮的闸门决策.
   *
   * @param session 会话
   * @param turn 轮次
   * @param state 跨轮次的运行时状态 (冷却 / 计数)
   * @returns 闸门判定
   */
  private resimulateGate(
    session: EvalSessionRecord,
    turn: EvalTurnRecord,
    state: { lastTurn: number | null; sessionRunCount: number },
  ): { decision: 'run' | 'skip'; reason: string } {
    const input: GateInput = {
      sessionId: session.sessionId,
      turnIndex: turn.turnIndex,
      stateBefore: toBdiSnapshot(turn.before),
      stateAfter: toBdiSnapshot(turn.after),
      events: turn.events as readonly GateEventTag[],
      safety: { riskLevel: turn.riskLevel },
      mode: this.options.gateMode ?? 'effect',
    };
    const runtime: GateRuntimeState = {
      lastTurn: state.lastTurn,
      sessionRunCount: state.sessionRunCount,
      globalRunCount: 0,
      circuitOpen: false,
    };
    const policy = this.options.gatePolicy ?? DEFAULT_EVAL_GATE_POLICY;
    const result = evaluateGate({ input, runtime, policy });
    return { decision: result.decision, reason: result.reason };
  }

  /**
   * 造一份跨轮次的运行时状态.
   *
   * @returns 初始状态
   */
  private createGateState(): { lastTurn: number | null; sessionRunCount: number } {
    return { lastTurn: null, sessionRunCount: 0 };
  }
}

/**
 * 执行器只需要数据集的这两个字段 —— 这里声明最小形状, 避免把整个类型拖进签名.
 */
export interface EvalDatasetLike {
  /** 数据集切分. */
  readonly split: EvalSplit;
  /** 会话列表. */
  readonly sessions: readonly EvalSessionRecord[];
}
