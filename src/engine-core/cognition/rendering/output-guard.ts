// V2026-10-28 治本 (WP5 · 引擎内核 · 渲染输出侧伦理校验):
//   职责: 渲染文本过一遍 WP4 的安全判定 (side='visitor_output'), 返回 verdict 信号.
//         内核**只给信号**: 不重生成、不替换话术、不拦截输出.
//   边界: 纯函数编排, 无状态, 无 IO.
//
//   为什么是"薄封装"而不是另写一套:
//     WP4 已经把"来访侧该命中什么、命中后什么等级、探测挂了怎么降级"定死了.
//     若在渲染侧再写一套来访判定, 就会出现"同一段来访话术, 在咨询师输入侧判 warn,
//     在渲染输出侧判 pass"的分裂 —— 而两处其实是同一段文本.
//     薄封装保证两侧口径永远一致 (同 WP5 M6).
//
//   输出 block 意味着什么 (适配层须知):
//     渲染出的**来访**文本若命中 block 级风险 (自杀计划 / 准备 / 主动意图 /
//     自伤行为 / 攻击他人), 适配层不得把该文本直接出声, 应重生成或降级话术.
//     内核不替适配层做这个决定 —— 但 verdict 必须带足类别信息, 让适配层知道
//     该怎么处理 (类别决定处置, 等级只驱动动作).
//
//   反双胞胎:
//     - 不重复实现规则判定: 直接复用 assessSafety, 探测超时 / 抛错 / 脏形状的
//       降级口径也一起继承, 不另写一份.
//     - 不改写 RenderResult.text: 输出侧校验与内容生成是两件事, 校验层碰内容
//       就等于同时干了"生成"和"审核"两件事, 出问题时无法定位是哪一环.
//
//   如何验证:
//     1. npx tsc -p tsconfig.build.json --noEmit 0 错
//     2. test/engine-core/wp5-rendering.spec.ts 覆盖干净/高危/probe 降级

import type { RiskProbePort } from '../../domain/ports/risk-probe';
import type { SafetyVerdict } from '../../domain/safety/safety-types';
import { assessSafety } from '../safety/assess-safety';

/**
 * 渲染文本输出侧校验: 复用 WP4 assessSafety(side='visitor_output').
 *
 * 内核只返回 verdict 信号, 不重生成 / 不替换 / 不拦截;
 * 越界 (warn/block) 由适配层决定重生成 / 降级话术 / 拦截.
 * 超时 / probe 异常静默回落规则 (同 WP4, 不炸穿).
 *
 * @param text 渲染出的文本
 * @param opts 可选探测端口与超时
 * @returns 本轮输出侧安全判定
 */
export async function guardVisitorOutput(
  text: string,
  opts?: { readonly probe?: RiskProbePort; readonly timeoutMs?: number },
): Promise<SafetyVerdict> {
  return assessSafety({
    text,
    side: 'visitor_output',
    ...(opts?.probe ? { probe: opts.probe } : {}),
    ...(opts?.timeoutMs === undefined ? {} : { timeoutMs: opts.timeoutMs }),
  });
}
