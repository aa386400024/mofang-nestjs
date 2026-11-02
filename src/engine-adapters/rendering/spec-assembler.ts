// V2026-10-28 治本 (WP7 · B 层 · 渲染规格组装器):
//   职责: 把内核一轮决策的产物 (EngineTurnOutput) + 累积历史 + token 预算,
//         组装成符合内核 RenderSpec 形状的**纯数据对象** —— 决策到"要什么"的翻译.
//   边界: 纯函数, 零 IO / 零网络 / 零 @nestjs / 零 prompt. 只做形状翻译,
//         不生成任何文字.
//
//   为什么要有这一层 (而不是让门面直接拼对象):
//     RenderSpec 是内核与适配层之间的**契约**; 谁来填它是个真问题 ——
//       - 填在内核: 内核就得知道"渲染要什么", 于是内核开始长 prompt 的形状, 违反第 0 原则;
//       - 填在门面: 门面就得同时干"翻译字段"和"编排调用"两件事, 编排逻辑被字段映射淹没;
//       - 独立纯函数: 字段映射可被单独单测 (输入一份 output, 断言 spec 的每个字段),
//         且换一种决策来源 (未来模型轨 / WP9 角色资产) 时, 只需换调用方, 不用改编排.
//     所以: **组装是纯函数, 编排是门面**, 两者分开.
//
//   反双胞胎:
//     - 不自己写历史裁剪: 直接调内核 fitContextToBudget —— 内核已有唯一口径,
//       在这里另写一份就等于"两套裁剪规则", 漂移方向恰好是"这里放得下、那里放不下".
//     - 不从 snapshot 取 intention: 快照**不含意图** (意图是每轮派生输出, 见
//       domain/intention.ts). 从快照里找 intention 是照着不存在的字段写代码.
//     - intention 缺失时**构造中性最小意图而不抛**: 意图缺失是"这一轮没决策出策略",
//       不是"输入非法"; 抛错会把一次可降级的渲染升级成整场对练失败.
//     - 不在本层放 prompt / 模型名 / 温度: 那些属渲染执行侧 (WP6).
//
//   如何验证:
//     1. npx tsc -p tsconfig.build.json --noEmit 0 错
//     2. test/engine-adapters/wp7-turn-render.spec.ts 覆盖字段映射与历史裁剪

import { resolveRiskLevel, type AdaptiveRenderSpec } from './render-risk';
import {
  fitContextToBudget,
  type BdiSnapshot,
  type EngineTurnOutput,
  type Intention,
  type RenderContextTurn,
  type RenderTaskKind,
  type RenderTokenBudget,
} from '../../engine-core';
import type { AttachmentStyle } from '../../engine-core';

/**
 * 规格组装入参.
 */
export interface SpecAssemblyInput {
  /** 本轮内核决策产物 (含 snapshot / intention / openingContext). */
  readonly output: EngineTurnOutput;
  /** 累积历史 (旧 → 新), 由门面维护. */
  readonly recentTurns: readonly RenderContextTurn[];
  /** 角色依恋风格 (本期门面拿不到角色基线, 留注入缝). */
  readonly attachmentStyle?: AttachmentStyle;
  /** 角色层禁止行为 (与 intention 层合并去重; 本期留缝). */
  readonly roleForbiddenBehaviors?: readonly string[];
  /** 轨迹承接要点 (本期留缝). */
  readonly trajectoryNote?: string;
  /** token 预算 (完成上限 + 上下文预算). */
  readonly tokenBudget: RenderTokenBudget;
  /** 任务分层 (缺省 'chat' —— 来访口语生成). */
  readonly taskKind?: RenderTaskKind;
  /**
   * 角色代号 (V2026-10-29 治本 · WP9-C; 仅供 dev 调试日志核对 prompt 拼装).
   *
   * 不进 prompt —— 模型不该看见自己的角色名.
   */
  readonly characterLabel?: string;
}

/**
 * 组装渲染规格 (纯函数).
 *
 * 字段映射口径见任务单 §3; 这里只做**形状翻译**, 不生成文字、不裁剪逻辑另写.
 *
 * @param input 组装入参
 * @returns 渲染规格
 */
export function buildRenderSpec(input: SpecAssemblyInput): AdaptiveRenderSpec {
  const intention = input.output.intention ?? neutralIntention(input.output.snapshot);
  const fitted = fitContextToBudget(input.recentTurns, input.tokenBudget.contextTokens);
  // V2026-10-29 治本 (WP9-C): 风险信号来自**内核本轮判定** (WP4 safety) ——
  //   内核只判定不路由, "这个判定要怎么影响渲染"是适配层的事, 所以在这里翻译成
  //   渲染路由档位 (见 render-risk.ts). 无判定 / 纯专业性提示 → none.
  const riskLevel = resolveRiskLevel(input.output.safety?.level, input.output.safety?.categories);

  return {
    taskKind: input.taskKind ?? 'chat',
    intention,
    emotion: input.output.snapshot.emotion,
    resistance: input.output.snapshot.resistance,
    transference: input.output.snapshot.transference,
    trust: input.output.snapshot.trust,
    coreBeliefs: input.output.snapshot.coreBeliefs,
    ...(input.attachmentStyle ? { attachmentStyle: input.attachmentStyle } : {}),
    forbiddenBehaviors: mergeForbidden(intention.forbiddenBehaviors, input.roleForbiddenBehaviors),
    recall: input.output.openingContext ?? [],
    ...(input.trajectoryNote ? { trajectoryNote: input.trajectoryNote } : {}),
    recentTurns: fitted.turns,
    tokenBudget: input.tokenBudget,
    ...(riskLevel === 'none'
      ? {}
      : {
          riskSignal: {
            level: riskLevel,
            categories: input.output.safety?.categories ?? [],
            source: input.output.safety?.source ?? 'rule',
          },
        }),
    ...(input.characterLabel ? { characterLabel: input.characterLabel } : {}),
  };
}

/**
 * 中性最小意图 (内核这轮没给出意图时的兜底).
 *
 * 情绪 / 阻抗 / 移情**取自本轮快照**而不是写死常量: 快照里的中性基线才是
 * 这一场真实的起点, 写死一份等于凭空造一个与当前状态不一致的意图.
 *
 * @param snapshot 本轮快照
 * @returns 中性最小意图
 */
function neutralIntention(snapshot: BdiSnapshot): Intention {
  return {
    strategy: 'simple_response',
    emotion: snapshot.emotion,
    resistance: snapshot.resistance,
    transference: snapshot.transference,
    forbiddenBehaviors: [],
  };
}

/**
 * 合并并去重禁止行为 (意图层 ∪ 角色层).
 *
 * 去重是必需的: 角色基线与意图规划器可能给出同一条禁止行为, 重复的禁止项
 * 会让系统 prompt 里出现两遍同样的约束 (浪费 token, 也读着像 bug).
 *
 * @param intentionForbidden 意图层禁止行为
 * @param roleForbidden 角色层禁止行为
 * @returns 去重后的禁止行为 (保持出现顺序)
 */
function mergeForbidden(intentionForbidden: readonly string[], roleForbidden: readonly string[] | undefined): readonly string[] {
  return [...new Set([...(roleForbidden ?? []), ...intentionForbidden])];
}
