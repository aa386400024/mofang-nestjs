/**
 * V2026-09-14 治本 (Stage C 后端契约): tool_completion_source 严格枚举.
 *
 * 9 source 跟前端 lib/features/practice/domain/utils/tool_completion_source_mapper.dart
 *   ToolCompletionSource 9 个 enum value 一一对应, 跟前端 inner_world 的
 *   ToolCompletionHandler.onXxxCompleted 9 个回调严格 1:1.
 *
 * 反双胞胎:
 *   - 不在 enum value 里加 V2.1 计划的"新 source" (e.g. pet_interaction), 仍走 §3 启动期 assert.
 *   - 命名跟前端 mapper enum name 严格一致 (snake_case), 跨语言 DTO 序列化时不需再转.
 *
 * 启动期 assert (见 controllers/growth-*.controller.ts):
 *   const VALUES = Object.values(TOOL_COMPLETION_SOURCES);
 *   if (VALUES.length !== 9) throw new Error('contract violation');
 */

/** 9 source 严格枚举 — 跟前端 mapper 1:1. */
export const TOOL_COMPLETION_SOURCES = [
  'breathing_practice', // 呼吸练习
  'thought_leaf', // 思维落叶 (ACT 流派)
  'breathing_art', // 呼吸绘形 (带视觉产出)
  'emotion_rescue', // 情绪急救
  'cbt_exercise', // CBT 认知行为
  'act_exercise', // ACT 接纳承诺
  'self_esteem', // 自尊增肌
  'interpersonal', // 人际效能 (DBT 边界等)
  'advanced_training', // 进阶训练
] as const;

export type ToolCompletionSource = (typeof TOOL_COMPLETION_SOURCES)[number];

/** V2026-09-14 治本: 启动期一致性 assert. */
export function assertToolCompletionSourceContract(): void {
  if (TOOL_COMPLETION_SOURCES.length !== 9) {
    throw new Error(
      `[contract] ToolCompletionSource expected 9 values, got ${String(TOOL_COMPLETION_SOURCES.length)}. ` +
        '跟前端 lib/features/practice/domain/utils/tool_completion_source_mapper.dart ' +
        'ToolCompletionSource enum 必须保持 1:1 同步.',
    );
  }
}
