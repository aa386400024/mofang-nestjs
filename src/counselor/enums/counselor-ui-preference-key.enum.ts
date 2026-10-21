// V2026-10-20 治本 (专项技能训练中心改版 — Hero 显示偏好 key):
//   原因: 设计规格 v1.0 §14-2 拍板「Hero 压缩到 140dp, 且用户可选择是否显示」. 用户可控
//     偏好属 PRD v1.0 §2.4-7「千人千面, 用户可控」原则, 必须落到持久化, 不能只存本地.
//     V1.1 spec §4.2/§6 未定义 UI 偏好存储, 属规格缺口 — 本 enum 补齐.
//   修复: 定义 CounselorUiPreferenceKey enum, 作为 ui_preferences JSONB 的 key 白名单.
//         服务端只认白名单内的 key, 未知 key 一律拒绝 (防前端 typo 写入脏数据).
//   反双胞胎:
//     - 不用裸 string key (拼写错误无编译期保护, 静默写脏数据)
//     - 不在 enum 里塞业务无关 key (本表仅放"界面呈现偏好", 不混入隐私/安全类设置)
//   验证:
//     1. PATCH /counselor/preferences { specializedSkillsHeroVisible: false }
//        → 200 + 回显 { specializedSkillsHeroVisible: false }
//     2. PATCH 传 { "unknownKey": 1 } → 400 (白名单拦截)
//   时间戳: 2026-10-20
export enum CounselorUiPreferenceKey {
  /** 专项技能训练中心首页 Hero 横幅是否显示 (设计规格 §4.1, 140dp, 默认 true) */
  SPECIALIZED_SKILLS_HERO_VISIBLE = 'specializedSkillsHeroVisible',
  /**
   * V2026-10-21 治本 (V1.2 VS-B1 — M1「上帝视角」开关):
   *   原因: v1.2 spec §2.2 原则 2「信息分层」+ §4.2 视图 A 交互:
   *     「高级开关『完整个案剧本查看』**默认关闭**；开启后返回完整 VisitorFullPersona,
   *     并在 session 元数据打 godViewEnabled=true 标记, 督导报告单独标注」.
   *     该开关必须默认关闭 —— 真实咨询里不存在"一键看来访者全部内心戏"这种便利 (§2.2 原则 1),
   *     默认开启会直接摧毁训练价值.
   *   落点: 本表是 counselor 端唯一的"用户可控界面偏好"单一事实源 (一人一行 JSONB + key 白名单),
   *     开关天然跨设备同步, 不必另建表.
   *   验证: 1. PATCH { godViewEnabled: true } → 200 回显 true
   *          2. 未设置时 GET → false (默认关闭)
   *   时间戳: 2026-10-21
   */
  GOD_VIEW_ENABLED = 'godViewEnabled',
}

/** 偏好键 → 默认值. 服务端在键缺失时回落至此, 保证老用户首次访问行为一致. */
export const COUNSELOR_UI_PREFERENCE_DEFAULTS: Record<CounselorUiPreferenceKey, boolean> = {
  [CounselorUiPreferenceKey.SPECIALIZED_SKILLS_HERO_VISIBLE]: true,
  // V2026-10-21 治本 (V1.2 VS-B1 — 上帝视角默认关闭, 见 enum 内的治本注释)
  [CounselorUiPreferenceKey.GOD_VIEW_ENABLED]: false,
};
