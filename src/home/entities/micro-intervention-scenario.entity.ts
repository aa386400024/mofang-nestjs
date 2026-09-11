import { Column, Entity, PrimaryColumn } from 'typeorm';

import type { HomeMicroInterventionTrigger } from '../home.constants';

/**
 * 微干预场景化元数据表 — V2026-09-11 治本 (消除「前端 5 个硬编 vs 后端 7 个 trigger」双胞胎).
 *
 * V2026-09-11 治本 (来源: 用户反馈「后端不要mock了, 完整实现, 遗留问题也解决掉」):
 *   - 旧实现: 前端 `MicroInterventionScenarios.defaults` 在 Dart 层硬编 5 个场景
 *     (meeting/sleep/social/argument/feed), 后端 `HOME_MICRO_INTERVENTION_TRIGGERS`
 *     在 TS 层硬编 7 个 trigger (before_meeting/before_social/before_sleep/
 *     after_argument/scrolling_anxiety/late_night/waking_up_anxious).
 *   - 两套语义不一致 + 数量不一致, 必然双胞胎.
 *   - 治本: 把 7 个 trigger 元数据持久化到本表, 后端作为唯一 source of truth,
 *     `GET /home/overview` 一次性下发 `microInterventionScenarios` 数组,
 *     前端 3 处 UI (scenarios list / home section / settings) 全部从这里读.
 *
 * 设计要点 (大厂 standard):
 *   - trigger 走 string PK (跟 `HOME_MICRO_INTERVENTION_TRIGGERS` 1:1),
 *     不走 auto-increment, 因为场景 id 跟 trigger 强绑定 (V3 接日程权限时
 *     端侧也用 trigger 字符串上报, 一致避免 id/trigger 翻译表).
 *   - 全字段走 snake_case name, 类型显式 (varchar/text/int/json).
 *   - display_order 显式字段 (前端「更多」页 + 设置页都按这个排),
 *     不用 ORDER BY 隐式推断 (避免将来插入新场景时排序乱).
 *   - kind / category 走 enum cast (Dart 一致, 跨层 mapper 集中一处).
 *   - accent_key 取值走 const 列表 (UI 端 palette 查色用), 不放 enum 防止
 *     后端随便下发 UI 不认识的 key (白名单校验).
 */
@Entity('micro_intervention_scenarios')
export class MicroInterventionScenario {
  /** trigger id (PK, 跟 HOME_MICRO_INTERVENTION_TRIGGERS 一一对应). */
  @PrimaryColumn({ type: 'varchar', length: 64, name: 'trigger' })
  trigger!: HomeMicroInterventionTrigger;

  /** 显示场景名 (e.g.「会议前」「睡前刷手机」). */
  @Column({ type: 'varchar', length: 32, name: 'scenario' })
  scenario!: string;

  /** emoji 图标 (e.g.「📅」「🌙」). */
  @Column({ type: 'varchar', length: 8, name: 'icon' })
  icon!: string;

  /** 微干预类型 (决定执行页路由 + UI icon 容器色). */
  @Column({ type: 'varchar', length: 32, name: 'kind' })
  kind!: 'breathing' | 'grounding' | 'cognitive_defusion' | 'self_talk';

  /** 时长 (秒) — 设计手册 30s ~ 2min. */
  @Column({ type: 'int', name: 'duration_seconds' })
  durationSeconds!: number;

  /** 分类 (UI 分组用, 跟 ScenarioCategory 一致). */
  @Column({ type: 'varchar', length: 16, name: 'category' })
  category!: 'work' | 'social' | 'rest' | 'emotion';

  /** 触发说明文案 (用户看的副文案, e.g.「日程检测到会议前 5 分钟」). */
  @Column({ type: 'varchar', length: 128, name: 'trigger_description' })
  triggerDescription!: string;

  /** 强调色 key — UI 端 palette 查色. 取值见 [ACCENT_KEYS]. */
  @Column({ type: 'varchar', length: 16, name: 'accent_key' })
  accentKey!: string;

  /** 展示顺序 (越小越靠前). */
  @Column({ type: 'int', name: 'display_order', default: 0 })
  displayOrder!: number;

  /** 是否启用 — false 时前端不显示 (运营下架用). */
  @Column({ type: 'boolean', name: 'is_enabled', default: true })
  isEnabled!: boolean;
}

/** accent_key 白名单 — 跟前端 palette 一致. */
export const SCENARIO_ACCENT_KEYS = ['primary', 'crisis', 'success', 'mistyPink', 'mintCyan', 'softBlue'] as const;
export type ScenarioAccentKey = (typeof SCENARIO_ACCENT_KEYS)[number];

/** category 白名单 — 跟前端 ScenarioCategory 一致. */
export const SCENARIO_CATEGORIES = ['work', 'social', 'rest', 'emotion'] as const;
export type ScenarioCategoryValue = (typeof SCENARIO_CATEGORIES)[number];

/** kind 白名单 — 跟 MicroInterventionKind 一致. */
export const SCENARIO_KINDS = ['breathing', 'grounding', 'cognitive_defusion', 'self_talk'] as const;
export type ScenarioKindValue = (typeof SCENARIO_KINDS)[number];
