// V2026-10-28 治本 (WP2 · 引擎内核 · 工作记忆窗口):
//   职责: 维护"最近 N 轮"的运行时窗口裁剪. 工作记忆 = 当前会话的即时上下文,
//         超出窗口的更早轮次不再参与本轮决策 (prompt 会无限膨胀, 且旧轮次
//         的边际价值迅速衰减).
//   边界: 纯函数, 无状态, 无 IO, 无随机. 不碰记忆仓储.
//
//   为什么是**运行时窗口**而不是"存进仓储再裁":
//     工作记忆的内容是咨询师原话 —— 属于会话内瞬时数据, 落进长时存储既没必要
//     又有隐私面 (原话进 Qdrant = 跨会话可检索). 窗口留在运行时, 随会话结束消失.
//
//   反双胞胎:
//     - 不"就地截断"入参数组 —— 纯函数返回新数组, 调用方的原数组不受影响.
//       就地 splice 是这类工具函数最常见的事故源 (调用方以为自己的数组还在).
//     - 不把窗口写死成 8 —— 默认值 8, 但允许调用方传 n; 窗口长度是**策略**,
//       不是算法的一部分. 集中为常量是为了让"最近 8 轮"这个口径可被观测/调整.
//     - 不做去重 / 不做摘要 / 不做分词 —— 窗口只管"留最近几轮", 别的归别的函数.
//
//   如何验证:
//     1. pnpm build 0 错
//     2. test/engine-core/wp2-memory.spec.ts 覆盖: 超窗丢最旧 / 不足窗原样 / 不改入参

import { EngineCoreError, EngineErrorCode } from '../domain/engine-errors';

/**
 * 工作记忆窗口长度 (最近 N 轮).
 *
 * 对齐 roadmap WP2「工作记忆: 最近 8 轮, 直接参与本轮决策」.
 * 集中为常量, 便于观测与后续按场景调整.
 */
export const WORKING_MEMORY_WINDOW_TURNS = 8;

/**
 * 保留最近 n 轮, 超出丢弃最旧; 纯函数, 返回新数组, 不改入参.
 *
 * @param lines 窗口内的轮次内容 (按时间正序, 最早的在前)
 * @param n 保留轮数; 默认 8. n=0 表示"清空窗口"
 * @returns 裁剪后的新数组 (入参不被修改)
 * @throws EngineCoreError code=INVALID_INPUT n 不是非负有限数
 */
export function trimWorkingWindow(lines: readonly string[], n: number = WORKING_MEMORY_WINDOW_TURNS): readonly string[] {
  if (!Number.isFinite(n) || n < 0) {
    throw new EngineCoreError(EngineErrorCode.INVALID_INPUT, `trimWorkingWindow: n 必须是非负有限数, 收到 ${n}`);
  }
  if (lines.length <= n) {
    return [...lines];
  }
  return lines.slice(lines.length - n);
}
