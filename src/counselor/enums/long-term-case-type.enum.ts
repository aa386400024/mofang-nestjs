// V2026-10-15 治本 (V1.2 — long_term_cases.caseType 5 预设枚举):
//   原因: counselor-mode-v1.0 §4.3 规定 5 预设长程个案类型 (workplace/relationship/parenting/
//     grief/anxiety), V0.3 §13 baseline 0 长程, 1:1 wire 0 破坏. 跟 xin_su_app LongTermCaseType
//     enum 字段 1:1 对齐 (跟 counselor-mode §4.3 表 1:1).
//
//   修法:
//     - 5 caseType 跟 counselor-mode-v1.0 §4.3 严格 1:1 (snake_case, 跟 user.state / KB type 同 pattern)
//     - 静态 enum (无 DB 行, 跟 user.state / user.admin_role 同 pattern), 1:1 wire 跨 server-client
//     - 5 类型跟 long-term-case-presets.ts 中 LON_TERM_CASE_PRESETS map 1:1 配对
//
//   反双胞胎:
//     - 不用 varchar(40) free-form: 强 enum 约束 (V0.x baseline pattern), 防 drift
//     - 不用 i18n key: V0.x 阶段中文, V1.x 多语言时再加 i18n layer
//     - 不在 enum 加 caseType 之外字段: 跟 V0.x "enum 只列值" 风格一致
//
//   验证 (大炮跑 pnpm migration:run 后):
//     1. SELECT enum: 5 值全在
//     2. 跟 counselor-mode-v1.0 §4.3 表 cross-ref: 5 名称 1:1
//     3. 跟 long-term-case-presets.ts 配对: 5 preset 1:1
//
//   时间戳: 2026-10-15

/**
 * 长程个案类型 (V1.x counselor-mode §4.3 5 预设).
 *
 * 跟 xin_su_app LongTermCaseType enum 1:1 同步.
 * 跟 src/counselor/config/long-term-case-presets.ts 5 preset 1:1 配对.
 */
export enum LongTermCaseType {
  /** 职场适应障碍 — 6 次 — 工作压力 / 职业倦怠 / 自我怀疑 */
  WORKPLACE = 'workplace',
  /** 亲密关系冲突 — 8 次 — 沟通模式 / 依恋创伤 / 信任问题 */
  RELATIONSHIP = 'relationship',
  /** 亲子沟通困难 — 8 次 — 青春期对抗 / 教养方式 / 边界 */
  PARENTING = 'parenting',
  /** 丧亲哀伤 — 6 次 — 哀伤过程 / 情绪接纳 / 意义重建 */
  GRIEF = 'grief',
  /** 焦虑发作 — 10 次 — 认知重构 / 暴露练习 / 复发预防 */
  ANXIETY = 'anxiety',
}
