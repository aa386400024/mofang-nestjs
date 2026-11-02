// V2026-11-02 治本 (WP14 · 探测来源通道 — 审计口径的"这条判定是谁给的"):
//   职责: 让**审计表**能记下"这次危机判定是 PsyGUARD 给的还是本地词典给的",
//         而不改内核 `SafetyVerdict` 的形状 (内核整树是红线).
//   边界: 纯通道, 零 IO / 零网络 / 零 @nestjs; 只在适配层内部流转.
//
//   为什么需要它 (WP14 §1.2 的 `source` 列):
//     内核 `SafetyVerdict.source` 只有三档 (`rule` / `probe` / `rule+probe`) ——
//     `probe` 把"远端模型"与"本地词典"**混成一档**. 但审计表要求区分:
//       · `psyguard`   = 独立仓库的 PsyGUARD Python 服务判的;
//       · `local_dict` = 本地词典判的 (服务挂掉时的兜底);
//       · `rule`       = 内核规则层判的.
//     这三者在**运维意义上完全不同**: 服务挂掉时 `local_dict` 的占比飙升 =
//     远端风险识别能力已经降级, 这是必须能被报表看见的事.
//
//   为什么用 AsyncLocalStorage (而不是给 probe 加返回值字段):
//     ① 内核 `SafetyVerdict` / `RiskProbeResult` 的形状**不能改** (红线) ——
//        探测结果里塞不进"来源"而不动内核;
//     ② 判定发生在**内核会话端口内部** (`session.turn()` 里调 `assessSafety`),
//        调用方拿不到探测那一刻的上下文 —— 探测器也不知道自己是为哪场会话跑的;
//     ③ 用"最后一个探测结果"的全局变量会在**多学员并发**时串场 ——
//        AsyncLocalStorage 是**调用上下文**作用域, 天然隔离并发.
//
//   作用域边界 (很关键):
//     作用域只包住 `session.turn()` (内核判定发生的那一段). 渲染阶段的
//     **来访输出侧**探测发生在作用域之外 → 它不会把来源覆盖成 'psyguard'.
//     另外记录时还会校验 side —— 只有 `counselor_input` 侧会写通道
//     (学员输入侧的判定才是本单要审计的那一面).
//
//   如何验证:
//     1. npx tsc -p tsconfig.build.json --noEmit 0 错
//     2. test/engine-adapters/wp14-student-risk-disposal.spec.ts 覆盖来源分流与并发隔离

import { AsyncLocalStorage } from 'node:async_hooks';

import type { SafetySide } from '../../engine-core/index.js';

/**
 * 探测来源 (审计口径; 与 `student_risk_events.source` 枚举对齐).
 */
export type ProbeSource = 'psyguard' | 'local_dict';

/**
 * 一次判定的作用域 (记录这次判定是谁给的).
 */
interface ProbeSourceScope {
  source?: ProbeSource;
}

/**
 * 通道本体 (进程内单例).
 *
 * 为什么是模块级而不是实例级: 探测器实现 (`LocalCrisisProbe` / `HttpPsyGuardProbe`)
 * 是**纯类**, 由工厂 new 出来, 彼此之间没有共同实例可挂状态 ——
 * 通道必须是**模块级**的, 否则探测器写不进去.
 */
const storage = new AsyncLocalStorage<ProbeSourceScope>();

/**
 * 在一个**作用域**里跑一段逻辑, 并带回这次作用域里记录到的探测来源.
 *
 * 用法 (编排门面):
 * ```ts
 * const { value: output, source } = await runWithProbeSource(() => this.deps.session.turn(handleId, input));
 * ```
 *
 * @param fn 作用域内要跑的逻辑 (通常是内核会话的那一轮判定)
 * @returns 逻辑返回值 + 该作用域内记录到的探测来源 (没有探测 = undefined)
 */
export async function runWithProbeSource<T>(fn: () => Promise<T>): Promise<{ value: T; source: ProbeSource | undefined }> {
  const scope: ProbeSourceScope = {};
  const value = await storage.run(scope, fn);
  return { value, source: scope.source };
}

/**
 * 记一次探测来源 (只在 `counselor_input` 侧生效).
 *
 * 为什么按 side 过滤: 渲染阶段的来访输出侧探测也在同一条链路上,
 * 它判的是"AI 扮演的来访者说了什么" —— 那**不是**本单要审计的学员风险,
 * 记进去会把审计口径搅乱.
 *
 * @param source 探测来源
 * @param side 检测面
 */
export function recordProbeSource(source: ProbeSource, side: SafetySide): void {
  if (side !== 'counselor_input') return;
  const scope = storage.getStore();
  if (!scope) return;
  scope.source = source;
}
