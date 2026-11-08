// V2026-11-08 治本 (R9 · B 层 · 生效路径的执行器):
//   职责: 把"产出拍"的上下文翻译成审议服务的入参, 跑一次审议, 再把结果翻译成
//         内核口径的**稀疏补丁**.
//   边界: B 层 (src/engine-adapters/), 纯编排 —— 不自己发请求 / 不自己拼 prompt /
//         不自己解析 JSON / 不自己算 cap. 那些都在 `LlmDeliberationService` 里.
//
//   为什么单独一个文件 (而不是把这段塞进钩子):
//     钩子的职责是**缓存与时序** (什么时候产出、什么时候取用、过期怎么判);
//     执行器的职责是**翻译** (上下文 → 审议入参 → 稀疏补丁).
//     混在一起 = 一个文件同时管"何时"与"怎么跑", 改任一边都会碰到另一边.
//     拆开后两者都能各自单测, 且执行器可以被换成别的实现 (例如离线回放).
//
//   反双胞胎:
//     - **不自己写 LLM 请求** —— 复用 `LlmDeliberationService.runEffectiveDeliberation`
//       (它已有超时 / 重试 / 校验 / cap / 临床规则 / trace / 统计);
//     - **不自己算 cap** —— 砍幅在服务里做, 与规则算子同一份配置;
//     - **不自己判过期** —— 过期判定在钩子里 (它知道建议什么时候算的);
//     - **不把审议原文打进日志** —— 心理内容禁止进普通日志 (隐私红线 AGENTS.md §5.4).
//
//   如何验证:
//     1. npx tsc -p tsconfig.build.json --noEmit 0 错
//     2. test/engine-adapters/r9-deliberation-hook.spec.ts 覆盖执行器的翻译与失败兜底

import type { DeliberationMode } from './deliberation-types.js';
import { toDeliberationDeltaPatch, type DeliberationProduceInput, type DeliberationRunner } from './llm-deliberation-hook.js';
import type { DeliberationEffectiveInput, DeliberationEffectiveOutcome } from './llm-deliberation.service.js';
import type { DeliberationDeltaPatch } from '../../engine-core/index.js';

/**
 * 生效路径的审议模式.
 *
 * ⚠️ **只能是自由模式** —— 考核场景**恒为 `rule_only`** (蓝图 §7 红线 4: 考核必须能
 *   锁版本 / 锁温度 / 逐字复现; LLM 输出不可复现, 所以考核永远不切 LLM).
 *   这条写死在类型与常量里, 不靠配置自觉 —— 生效路径压根不接考核场景.
 */
export const DELIBERATION_EFFECTIVE_MODE: DeliberationMode = 'freeform';

/**
 * 审议服务在生效路径上的**窄面**.
 *
 * ⚠️ 为什么定窄面 (而不是直接依赖 `LlmDeliberationService` 这个类):
 *   执行器只用到"跑一次生效审议"这一个方法. 窄面 = 依赖倒置, 单测里塞个假实现
 *   即可, 不用把 Nest service 拖进测试.
 */
export interface DeliberationEffectiveRunnerPort {
  runEffectiveDeliberation(input: DeliberationEffectiveInput): Promise<DeliberationEffectiveOutcome>;
}

/**
 * 生效路径的执行器.
 */
export class LlmDeliberationEffectiveRunner implements DeliberationRunner {
  constructor(private readonly service: DeliberationEffectiveRunnerPort) {}

  /**
   * 跑一拍审议, 返回内核口径的稀疏补丁.
   *
   * ⚠️ **失败一律返回 `null`** (不抛): 审议挂了 / 超时 / 格式非法 / 临床标记全命中
   *   → 没有可用建议 → 上层回退规则 delta. 主流程**绝不**因为审议而失败.
   *
   * @param input 本轮产出拍上下文
   * @returns 稀疏补丁; `null` = 本轮没有可用建议
   */
  async run(input: DeliberationProduceInput): Promise<DeliberationDeltaPatch | null> {
    const { context, extras } = input;
    const outcome = await this.service.runEffectiveDeliberation({
      sessionId: context.sessionId,
      tenantId: context.tenantId,
      userId: extras.userId,
      turnIndex: context.turnIndex,
      // ⚠️ 锚 R1 (本轮落库后的版本) —— 与影子路径的 `checkStale` **同一把锚**:
      //   过期判定问的是"我回来时当前版本还是不是这个", 锚 R0 会让判定永远为"过期".
      baseRevision: context.currentRevision,
      mode: DELIBERATION_EFFECTIVE_MODE,
      // WP-A: 结构化输入 (零对话原文) —— 状态对比 / 事件分类 / 角色基线 / 风险等级.
      //   ⚠️ 门面组装的 `stateComparison` 表达的是"本轮前 → 本轮后",
      //     与影子路径**逐字相同** —— 两条路径的对比数据因此可比.
      structured: extras.structured,
      ruleDelta: context.ruleDelta,
    });
    if (outcome.kind !== 'ok') return null;
    // 空列表 = 模型没提任何维度 → 没有实质建议 → 折成 null (上层不必再判一次空).
    if (outcome.deltas.length === 0) return null;
    return toDeliberationDeltaPatch(outcome.deltas);
  }
}
