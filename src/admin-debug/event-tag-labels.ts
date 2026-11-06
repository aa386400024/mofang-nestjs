// V2026-11-06 治本 (WP38 · 咨询师事件标签中文映射):
//   职责: 给内核事件分类 (CounselorEventKind) 配一份**权威中文标签**, 调试面板直接用.
//   边界: 纯常量 + 一个查表函数; 零 IO / 零依赖.
//
//   为什么映射要由后端出 (而不是前端各抄一份):
//     内核的 CounselorEventKind 有 **11** 类 (见 engine-core/domain/events/session-event.ts),
//     而调试面板 (admin-dashboard/src/views/DebugChat.vue) 里那份手写映射只有 6~8 个键:
//       · 缺的 7 个: acceptance / affirmation / judgment / preaching / minimizing /
//                    boundary_cross / sensitive_touch —— 面板上会直接显示英文原值;
//       · 多出的 3 个: micro_expression / emotion_reflection / open_discussion ——
//                    **内核根本不产** (是模型轨的旧占位名), 属于"永远点不亮的灯".
//     两份映射各抄一半 = 面板上的标签既不全也不准. 事件分类的**真值在内核**,
//     它的展示名就该跟着内核走 —— 一份映射, 后端出, 前端用.
//
//   反双胞胎:
//     - 不在**适配层**预判事件类型 (那会与内核漂移): 本文件只做"已知 kind → 中文名",
//       判定仍在内核 (见 EngineTurnOutput.events).
//     - 不用 Record<string, string> 兜底: 未知 kind 走 labelCounselorEvent 的
//       显式回退 (原样返回), 不静默吞掉 —— 面板上出现一个没见过的英文值,
//       那说明内核加了新 kind 而这里没跟上, **要看得见**.
//
//   如何验证:
//     1. npx tsc -p tsconfig.build.json --noEmit 0 错
//     2. test/admin-debug/wp38-debug-event-tags.spec.ts: 11 类全覆盖 + 未知 kind 回退
//
//   时间戳: 2026-11-06

import type { CounselorEventKind } from '../engine-core/index.js';

/**
 * 事件分类 → 中文标签 (权威映射).
 *
 * 键集合与内核 CounselorEventKind **严格一致** (11 类); 少一个就是面板上少一盏灯.
 */
export const COUNSELOR_EVENT_LABELS: Readonly<Record<CounselorEventKind, string>> = {
  empathy: '共情回应',
  acceptance: '接纳',
  normalization: '正常化',
  open_probe: '开放提问',
  affirmation: '肯定',
  judgment: '评判',
  preaching: '说教',
  minimizing: '淡化问题',
  boundary_cross: '越界',
  sensitive_touch: '触及敏感议题',
  neutral: '中性表达',
};

/**
 * 取事件分类的中文标签.
 *
 * 未知 kind (内核新增了类别而本映射没跟上) → 原样返回, **不静默兜底成"未知"**:
 * 面板上直接看到一个英文 kind, 比看到一个假的"未知"更容易被人发现.
 *
 * @param kind 事件分类 (内核 kind 或任意字符串)
 * @returns 中文标签
 */
export function labelCounselorEvent(kind: string): string {
  return COUNSELOR_EVENT_LABELS[kind as CounselorEventKind] ?? kind;
}
