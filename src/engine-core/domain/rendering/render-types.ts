// V2026-10-28 治本 (WP5 · 引擎内核 · 渲染契约类型):
//   职责: 定义渲染层的全部**数据形状** —— 任务分层 / 渲染规格 / 上下文轮 /
//         Token 预算 / 渲染结果. 适配层据此组装规格、调用模型、回填话术.
//   边界: 纯 TS, 零 @nestjs/* / typeorm, 不含 prompt / 模型名 / 温度 / API key.
//
//   为什么内核要立这层契约 (而不是让适配层自己随便拼):
//     渲染是整条链路的**最后一公里**, 也是最容易长成"每个调用方拼一套"的地方 ——
//     A 处拼情绪+阻抗, B 处拼记忆+信念, C 处拼轨迹参考, 三处的规格形状还不一样.
//     规格一旦没有统一形状, 就无法:
//       - 统一做 Token 预算裁剪 (算不出塞不塞得下);
//       - 统一做输出侧伦理校验 (拿不到一致的来访文本与状态);
//       - 统一做主备容灾与可观测 (不知道一次渲染实际要什么).
//     所以本期把"要什么"钉死成 RenderSpec, 把"怎么拿到"留给 RenderPort.
//
//   反双胞胎:
//     - **规格里不含模型名 / 温度 / prompt**: 那些是适配层与配置层的职责.
//       一旦内核出现 modelName, 就等于内核绑死某个厂商, 换模型要动内核.
//     - 任务分层用字符串联合而非 enum: 与 WP2 MemoryRecallScope / WP3 TrajectoryMode /
//       WP4 SafetyLevel 同理 —— 纯控制流判别式, 内核零运行时导出.
//     - RenderResult 只暴露 usage / fallbackUsed / providerHint: 结果要能跨厂商
//       通用, 厂商私有字段留在适配层内部, 否则每接一个厂商内核就要改一次.
//
//   如何验证:
//     1. npx tsc -p tsconfig.build.json --noEmit 0 错
//     2. test/engine-core/wp5-rendering.spec.ts 覆盖规格组装与预算裁剪

import type { BdiResistance } from '../bdi-snapshot';
import type { CoreBelief } from '../beliefs';
import type { AttachmentStyle } from '../character-profile';
import type { EmotionState } from '../emotion';
import type { Intention } from '../intention';
import type { MemoryHit } from '../ports/memory.store';
import type { TransferenceState } from '../transference';

/**
 * 任务分层: 决定适配层选低温稳定 / 高温口语 / 高阶模型, 内核不选模型.
 * 用字符串联合而非 enum: 纯控制流判别式, 保持内核零运行时导出.
 */
export type RenderTaskKind =
  /** 结构化推理 / 状态更新 / 摘要 → 低温稳定模型. */
  | 'stable'
  /** 来访口语生成 → 高温流式. */
  | 'chat'
  /** 复杂检测 / 高阶判定 → 按需高阶模型. */
  | 'advanced';

/**
 * 最近对话的一轮 (角色归一; 内核不区分 ASR 来源).
 */
export interface RenderContextTurn {
  readonly role: 'counselor' | 'visitor';
  readonly text: string;
}

/**
 * Token 预算 (适配层把具体上限换算成 token; 内核只做裁剪与归一).
 */
export interface RenderTokenBudget {
  /** 单轮完成 (completion) token 上限. */
  readonly maxCompletionTokens: number;
  /** 可放入上下文的 token 预算 (用于 fitContextToBudget). */
  readonly contextTokens: number;
}

/**
 * 渲染规格 (纯数据, 可序列化): 适配层从 EngineTurnOutput + 记忆 + 轨迹组装.
 * 不含模型名 / 温度 / prompt / apiKey —— 那些属适配层.
 */
export interface RenderSpec {
  /** 本轮任务分层. */
  readonly taskKind: RenderTaskKind;
  /** 本轮结构化意图 (WP1). */
  readonly intention: Intention;
  /** 当前情绪 (WP1). */
  readonly emotion: EmotionState;
  /** 当前三维阻抗 (WP1). */
  readonly resistance: BdiResistance;
  /** 当前移情三态 (WP1). */
  readonly transference: TransferenceState;
  /** 关系信任 [0,1]. */
  readonly trust: number;
  /** 永久核心信念 (不可变锚点). */
  readonly coreBeliefs: readonly CoreBelief[];
  /** 依恋风格 (角色内核; 缺省表示未装配角色基线). */
  readonly attachmentStyle?: AttachmentStyle;
  /** 禁止行为 (角色 forbiddenBehaviors ∪ 本轮 intention.forbiddenBehaviors, 由适配层合并去重). */
  readonly forbiddenBehaviors: readonly string[];
  /** WP2 记忆命中 (本轮相关召回). */
  readonly recall: readonly MemoryHit[];
  /** WP3 本轮轨迹参考素材 / 承接提示 (从 trajectoryTrace 提取, 可空). */
  readonly trajectoryNote?: string;
  /** 最近对话 (已按预算裁剪前的原始序列, 由 fitContextToBudget 裁剪). */
  readonly recentTurns: readonly RenderContextTurn[];
  /** Token 预算. */
  readonly tokenBudget: RenderTokenBudget;
}

/**
 * 渲染结果 (纯数据, 不含厂商私有字段).
 */
export interface RenderResult {
  /** 渲染出的文本 (适配层填进 reply). */
  readonly text: string;
  /** 本次渲染使用的任务分层. */
  readonly taskKind: RenderTaskKind;
  /** 用量 (仅供观测, 不作计费依据). */
  readonly usage: {
    readonly completionTokens: number;
    readonly totalTokens: number;
  };
  /** 是否走了备用候选 (适配层置位). */
  readonly fallbackUsed: boolean;
  /** 可选: 实际提供服务的候选标识 (适配层填, 供观测). */
  readonly providerHint?: string;
}
