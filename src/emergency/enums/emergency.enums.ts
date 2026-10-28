// V2026-09-04 治本 (V6.0 §4.2 + audit P0-3):
//   急救会话枚举 — 5 工具类型 + 6 状态机.
//   原因: 前端 lib/features/emergency/domain/entities/emergency_tool.dart 已定义
//         SessionPhase + ToolKind, 后端对齐用于上报 / 趋势分析.
//   修复: enum code 字符串字面量与前端 ToolKind.values[].name 保持一致
//         (ToolKind.values 在前端用 enum 自动派生 code).
//   如何验证: POST /emergency/sessions body tool_kind 字符串能被前端
//             EmergencyRepositoryImpl.fromJson 反向解析.

/**
 * 5 急救工具 — V6.0 §4.2 / §7.1.
 *
 * - GROUNDING_54321: 5-4-3-2-1 接地法
 * - BREATH_448: 4-4-8 呼吸法 (DBT 痛苦耐受)
 * - SAFE_PLACE: 安全岛引导 (创伤稳定化)
 * - TIPP: TIPP 痛苦耐受 (Temperature/Intense/Paced/Paired)
 * - THOUGHT_BUBBLE: 思维泡泡 (认知解离)
 *
 * 反双胞胎: 不引入 emergency_blind_box (那是 V2 增值功能, 不在本期 §4.2 闭环).
 */
export enum EmergencyToolKind {
  GROUNDING_54321 = 'grounding_54321',
  BREATH_448 = 'breath_448',
  SAFE_PLACE = 'safe_place',
  TIPP = 'tipp',
  THOUGHT_BUBBLE = 'thought_bubble',
}

/**
 * 单次急救会话状态机 — V6.0 §4.2.

 * - IDLE: 初始 (UI 准备进入)
 * - PRERATING: 前测 (用户自评不安)
 * - RUNNING: 工具执行中
 * - POSTRATING: 终测 (用户自评)
 * - COMPLETED: 完成 (成功闭环)
 * - ABANDONED: 用户主动退出 (§2.6 可退出原则, 保留 partial 记录, 无评判)
 */
export enum SessionPhase {
  IDLE = 'idle',
  PRERATING = 'prerating',
  RUNNING = 'running',
  POSTRATING = 'postrating',
  COMPLETED = 'completed',
  ABANDONED = 'abandoned',
}

/** 是否终止状态 — COMPLETED / ABANDONED 后不再变更. */
export function isTerminalPhase(phase: SessionPhase): boolean {
  return phase === SessionPhase.COMPLETED || phase === SessionPhase.ABANDONED;
}
