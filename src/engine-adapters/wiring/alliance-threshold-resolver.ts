// V2026-11-11 治本 (Phase2.5 I-12 · 会话级同盟门槛覆盖端口):
//   职责: 定义"按会话 / 按角色覆盖同盟门槛"的**解析端口** —— 装配层唯一的接入点.
//   边界: 只声明"叫什么 + 怎么问"; **不写任何门槛数值**, 不读 env, 不碰 DB.
//
//   为什么要有这一层 (与内核 `AllianceConfig` 端口的关系):
//     · 内核 `AllianceConfig` 是**实例级**端口 —— 一份配置给整个进程的所有会话共用;
//     · 本端口是**会话级**的 —— 它回答"这一场用哪份门槛", 返回一份**覆盖**;
//       缺项与非法值的回落仍由内核 `resolveAllianceThresholds` 一处裁决 (不另抄一套校验).
//
//   为什么缺省实现是"永远无覆盖":
//     灰度期纪律 —— 门槛数值一律冻结. 本单只打通**缝**; 真实来源
//     (按角色档案自动算门槛) 属后续标定批次. 在那之前: 缺省 = 无覆盖 =
//     逐字回落到模块 env 单例, 行为与改造前**完全一致**.
//
//   为什么走端口而不是让会话创建处直接传参:
//     会话创建有**四处**入口 (语音对练 / 自动对练 / 调试面板 / engine 调试端点).
//     走端口 → 后续标定批次接来源时**一处装配**, 四个入口零改动.
//
//   如何验证:
//     1. pnpm exec tsc -p tsconfig.build.json --noEmit 0 错
//     2. test/engine-adapters/i12-session-threshold-plumbing.spec.ts 覆盖"覆盖优先 / 缺项回落单例 / 非法值回落种子"三条

import type { AllianceThresholds, AttachmentStyle } from '../../engine-core/index.js';

/**
 * 会话级同盟门槛覆盖的解析上下文.
 *
 * ⚠️ 这里只放**当前入口拿得到**的事实 —— 未来接真实来源时若需要更多维度
 *   (如角色 slug), 扩展本接口即可, 不用改内核.
 */
export interface SessionAllianceThresholdContext {
  /** 业务会话 id. */
  readonly sessionId: string;
  /** 租户隔离键. */
  readonly tenantId: string;
  /** 来访者角色 id. */
  readonly visitorId: string;
  /** 角色展示名 (缺省 = 装配层没登记). */
  readonly characterLabel?: string;
  /** 依恋风格 —— 角色档案里**已可用**的一维 (后续标定来源的天然分组键). */
  readonly attachmentStyle?: AttachmentStyle;
}

/**
 * 会话级同盟门槛覆盖解析端口 (I-12).
 *
 * ⚠️ 返回值语义 = **覆盖**, 不是完整配置:
 *   - 返回 `undefined` = 本场无覆盖 → 逐字回落到模块 env 单例;
 *   - 返回对象 = 只写要覆盖的项, 缺项由内核回落 (见内核 `resolveSessionAllianceConfig`).
 *
 * ⚠️ 实现**不得抛** —— 覆盖来源坏掉不该炸会话开场 (与仓库"失败不炸主流程"纪律同款).
 */
export interface SessionAllianceThresholdResolver {
  /**
   * 解析本场的门槛覆盖.
   *
   * @param context 会话上下文
   * @returns 覆盖项; `undefined` = 无覆盖
   */
  resolve(context: SessionAllianceThresholdContext): Partial<AllianceThresholds> | undefined;
}

/**
 * 缺省解析器: **永远无覆盖**.
 *
 * ⚠️ 真实来源 (按角色档案自动算门槛) 属后续标定批次 —— 在那之前,
 *   本端口返回 `undefined`, 门槛逐字回落到模块 env 单例, **零行为变化**.
 */
export const NO_SESSION_ALLIANCE_THRESHOLD_OVERRIDE: SessionAllianceThresholdResolver = {
  /**
   * 永远返回"无覆盖".
   *
   * ⚠️ 用方法体 + 显式 `return undefined;` 而不是 `() => undefined` —— 后者被
   *   `unicorn/no-useless-undefined` 判为"无用的 undefined" (仓库既有写法同款).
   */
  resolve(): Partial<AllianceThresholds> | undefined {
    return undefined;
  },
};
