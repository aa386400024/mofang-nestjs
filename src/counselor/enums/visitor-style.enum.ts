// V2026-10-19 治本 (V1.1 §4.2.5 §6.5 — visitor_style 5 档枚举):
//   原因: counselor-mode-v1.1 §4.2.5 拍板 visitorStyle 5 档 (Defensive/Cooperative/
//     Resistant/Avoidant/Mixed), 跟 xin_su_app V0.5 client VisitorStyle enum 1:1 wire.
//     V0.3 §13 baseline 0 来访者风格 enum, 1:1 wire 0 破坏.
//
//   反双胞胎:
//     - 不用 i18n: 跟 user.state 同 pattern
//     - 不用 snake_case 风格化命名 (e.g. "highly_defensive"): V0.5 client 端用 emoji 锚点
//       (🛡️/🤝/✋/🙈/🎲), 风格化命名 1:1 wire 匹配 client 5 emoji
//     - 不加 expanded enum (e.g. "traumatized" / "dissociated"): 心理治疗学派 5 档覆盖
//       80% 场景, V1.x W9-10 备考/B 端续做时按需扩
//
//   验证: 1. tsc 0 错
//   时间戳: 2026-10-19

/**
 * 来访者风格 5 档 (V1.1 §4.2.5, 跟 xin_su_app V0.5 client VisitorStyle 1:1 wire).
 *
 * V0.5 client 端 VisitorStyle extension 提供 emoji 锚点 (🛡️/🤝/✋/🙈/🎲) 跟 label
 * 文本 (防御型/配合型/阻抗型/回避型/混合型), V1.x server 端持久化 enum 字符串.
 */
export enum VisitorStyle {
  /** 防御型 (L3 grief 1:1, 高防御 + 长沉默) */
  DEFENSIVE = 'defensive',
  /** 配合型 (L1 workplace / anxiety 1:1, 低防御 + 主动表达) */
  COOPERATIVE = 'cooperative',
  /** 阻抗型 (L2 parenting 1:1, 中等防御 + 质疑咨询师) */
  RESISTANT = 'resistant',
  /** 回避型 (L2 relationship 1:1, 中等防御 + 频繁沉默 + 转换话题) */
  AVOIDANT = 'avoidant',
  /** 混合型 (V0.5 stage 2 默认, V1.x server 持久化, per-dim variance 随机呈现 4 风格之一) */
  MIXED = 'mixed',
}
