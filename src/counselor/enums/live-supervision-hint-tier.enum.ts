// V2026-10-21 治本 (V1.2 VS-C — 实时督导提示档位 enum):
//   原因: v1.2 spec §6.1 实时督导轻提示「默认关闭, 用户主动开启, 两档」:
//     - light (推荐新手): 侧边浮窗静默提示, 不打断对话
//     - off   (推荐进阶): 完全无提示, 结束后统一出报告
//     档位必须落库 (用户可控 + 跨设备同步), 且要能被「同一类提示 5 分钟内不重复」等业务逻辑判断.
//   修法: LiveSupervisionHintTier enum, 2 值, 落 counselor_ui_preferences 的 prefs json.
//   反双胞胎:
//     - 不用 boolean: 「是否开启」表达不了档位语义, 且 spec 明确两档行为不同
//     - 不加第三档 'auto': spec 只定义 2 档; 未来要加必须先想清楚"谁决定降级" (用户还是系统)
//     - 不放 session 表: 这是**用户级**偏好 (跨会话一致), 不是单场会谈的属性
//   验证:
//     1. 大炮 PATCH /counselor/preferences { liveSupervisionHintTier: 'off' } → 200 回显 off
//     2. 未设置时 GET → off (默认关闭, 符合 spec §2.2 原则 3 "所有辅助功能默认关闭")
//   时间戳: 2026-10-21

/**
 * 实时督导提示档位 (v1.2 spec §6.1).
 *
 * 默认 off —— spec §2.2 原则 3「所有辅助功能默认关闭, 用户主动开启, 不干扰基础训练」.
 */
export enum LiveSupervisionHintTier {
  /** light: 侧边浮窗静默提示, 不打断对话 (推荐新手) */
  LIGHT = 'light',
  /** off: 完全无提示, 结束后统一出报告 (推荐进阶) */
  OFF = 'off',
}

/** 档位取值数组 (给 class-validator 的 @IsIn 用). */
export const LIVE_SUPERVISION_HINT_TIER_VALUES = [LiveSupervisionHintTier.LIGHT, LiveSupervisionHintTier.OFF] as const;
