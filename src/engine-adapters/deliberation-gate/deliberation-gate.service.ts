// V2026-11-09 治本 (Phase2.5 WP-C · 触发式审议闸门 · 决策入口):
//   职责: 串起闸门的完整链路 —— 读运行时状态 (Redis) → 纯判定 → 记账 → 留痕.
//   边界: 只做编排; **判定逻辑一行都不在这里** (全在 evaluator.ts 的纯函数里).
//
//   为什么入口不自己判:
//     仓库纪律: **判定只有一份**. 入口一旦开始写"if (count >= max) skip"这种分支,
//     纯判定函数就退化成了"半个判定", 两处迟早对不上 ——
//     而对不上的后果是"看板说跳过了, 实际却跑了" (白花钱) 或者反过来 (该跑没跑).
//
//   失败语义 (与审议服务同款纪律):
//     · **不抛** —— 闸门挂了不该炸会话;
//     · 出错 → **放行** (decision=run, reason=gate_error) —— 退化成改造前"每轮都跑"的行为.
//       为什么不是"拦截": 闸门是**省钱**手段, 不是正确性手段 ——
//       闸门坏了就静默停掉审议 = 看上去一切正常, 实际功能没了 (仓库最恨的静默失效).
//       放行的代价只是多花点钱, 而且 trace 里 reason=gate_error 一眼能看出来.
//     · ⚠️ **危机红线不受影响**: 第 ① 步是纯判定 (不碰 IO), 永远先于任何 Redis 读执行 ——
//       Redis 全挂也不会让危机轮次跑 LLM 审议.
//
//   如何验证:
//     1. npx tsc -p tsconfig.build.json --noEmit 0 错
//     2. test/engine-adapters/deliberation-gate/quotas.spec.ts 覆盖入口链路

import { Logger } from '@nestjs/common';

import { evaluateGate } from './deliberation-gate.evaluator.js';
import type { DeliberationGateQuotas } from './deliberation-gate.quotas.js';
import type { DeliberationGateTrace } from './deliberation-gate.trace.js';
import type { GateConfig, GateExecutionOutcome, GateInput, GateMode, GateOutput, GatePolicy } from './deliberation-gate.types.js';

/**
 * 闸门服务的装配入参.
 */
export interface DeliberationGateServiceDeps {
  /** 闸门配置 (两套策略 + 熔断参数). */
  readonly config: GateConfig;
  /** 配额 / 冷却 / 熔断存取器. */
  readonly quotas: DeliberationGateQuotas;
  /** 决策 trace 写入器. */
  readonly trace: DeliberationGateTrace;
}

/**
 * 触发式审议闸门 (决策入口).
 *
 * ⚠️ **故意不加 @Injectable**: 构造参数是一个聚合对象 (不是可注入的类),
 *   若被当成类 provider 装配, Nest 会按 design:paramtypes 去找名为 "Object" 的依赖 ——
 *   那正是 engine.module.ts 注释里记的"启动炸弹". 走 useFactory 显式 new, 零歧义.
 */
export class DeliberationGateService {
  private readonly logger = new Logger('DeliberationGate');

  /**
   * @param deps 装配入参
   */
  constructor(private readonly deps: DeliberationGateServiceDeps) {}

  /**
   * 判定这一轮要不要跑 LLM 审议.
   *
   * ⚠️ **不抛** (见文件头的失败语义): 任何异常都被兜成"放行 + gate_error".
   *
   * @param input 本轮输入 (零对话原文)
   * @returns 决策 + 依据
   */
  async evaluate(input: GateInput): Promise<GateOutput> {
    const startedAt = Date.now();
    const policy = this.policyOf(input.mode);
    try {
      const runtime = await this.deps.quotas.loadRuntimeState(input.sessionId, input.mode, startedAt);
      const result = evaluateGate({ input, runtime, policy });
      if (result.decision === 'run') {
        // 记账 (冷却轮次 / 会话次数 / 全局配额) —— 写失败也不影响本次决策.
        await this.deps.quotas.recordRun(input.sessionId, input.mode, input.turnIndex, startedAt);
      }
      await this.deps.trace.record({
        sessionId: input.sessionId,
        // V2026-11-09 (闸门 trace 查询接口): 落 MySQL 真相源要的两个口径 ——
        //   dbSessionId (落库会话 id) + userId (学员归属, 用于学员隔离).
        //   两者缺省 = 空 → 落库写 NULL (不是空串, 也不是 0).
        dbSessionId: input.dbSessionId ?? null,
        userId: input.userId ?? null,
        turnIndex: input.turnIndex,
        mode: input.mode,
        decision: result.decision,
        reason: result.reason,
        deltaSummary: result.deltaSummary,
        thresholdUsed: policy.thresholds,
        elapsedMs: Date.now() - startedAt,
        recordedAt: startedAt,
      });
      return {
        decision: result.decision,
        reason: result.reason,
        deltaSummary: result.deltaSummary,
        thresholdUsed: policy.thresholds,
      };
    } catch (error) {
      this.logger.warn(`[deliberation_gate_error] sessionId=${input.sessionId} turn=${input.turnIndex}: ${messageOf(error)}`);
      // 放行: 退化成"每轮都跑" —— 闸门是省钱手段, 不该让审议整体停摆.
      return {
        decision: 'run',
        reason: 'gate_error',
        deltaSummary: {},
        thresholdUsed: policy.thresholds,
      };
    }
  }

  /**
   * 回报一次审议执行的结局 (喂熔断器).
   *
   * ⚠️ **只有生效路径喂熔断器** (任务单 §2.1: 熔断是生效模式才有的保护):
   *   影子模式不熔断 —— 影子跑挂了只是没数据, 不该把生效路径的 LLM 预算也掐掉.
   *
   * @param mode 走的哪条路径
   * @param outcome 成功 / 失败
   */
  reportOutcome(mode: GateMode, outcome: GateExecutionOutcome): void {
    if (mode !== 'effect') return;
    if (outcome === 'failure') {
      void this.deps.quotas.recordCircuitFailure(this.deps.config.circuitFailCount, this.deps.config.circuitCooldownMs, Date.now());
      return;
    }
    void this.deps.quotas.resetCircuit();
  }

  /**
   * 取某个模式的策略.
   *
   * @param mode 模式
   * @returns 该模式的策略
   */
  private policyOf(mode: GateMode): GatePolicy {
    return mode === 'effect' ? this.deps.config.effect : this.deps.config.shadow;
  }
}

/**
 * 把异常压成一行短消息 (日志里不堆栈).
 *
 * @param error 异常
 * @returns 短消息
 */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
