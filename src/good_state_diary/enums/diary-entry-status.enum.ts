/**
 * V2026-09-11 治本 (好状态日记 · 草稿双态):
 *   原因: 心理产品「写日记是私人行为, 没有完美日记」原则要求 draft ↔ finalized
 *         可双向切换, 用户改主意回编辑继续写是自然行为, 不应被「已保存不可改」
 *         强约束拦住. 同时草稿是崩溃恢复的载体 (auto-save).
 *   修复: 用 TS enum 镜像前端 Dart enum, 严格 2 态: draft / finalized.
 *         跟前端 DiaryEntryStatus.name 1:1 ('draft' / 'finalized'), 反序列化
 *         失败兜底到 draft (更宽容, 不强行 finalized).
 *   如何验证: 创建 draft → finalize → 改回 draft, status 流正确; 非法 status
 *             字符串 fallback 到 draft, 不抛错.
 */

/**
 * 日记状态 — 草稿 / 已完成两态.
 *
 * 跟前端 `lib/features/good_state_diary/domain/entities/diary_entry_status.dart`
 * 的 DiaryEntryStatus 1:1 镜像. 改这里必须同步改前端.
 */
export enum DiaryEntryStatus {
  /** 草稿 — 写一半自动保存, 列表「草稿」分组置顶. */
  Draft = 'draft',

  /** 已保存 — 用户主动完成 (点保存按钮 / 关闭编辑器时升格). */
  Finalized = 'finalized',
}

export const DIARY_ENTRY_STATUS_VALUES: DiaryEntryStatus[] = [DiaryEntryStatus.Draft, DiaryEntryStatus.Finalized];

/** 字符串解析 — 非法值 / null / undefined 兜底到 draft (更宽容). */
export function parseDiaryEntryStatus(value: string | null | undefined): DiaryEntryStatus {
  if (value === DiaryEntryStatus.Finalized) return DiaryEntryStatus.Finalized;
  return DiaryEntryStatus.Draft;
}
