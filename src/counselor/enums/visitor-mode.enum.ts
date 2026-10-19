// V2026-10-19 治本 (V1.1 §4.2.4 §6.5 — visitor_mode 3 档具象训练模式):
//   原因: counselor-mode-v1.1 §4.2.4 拍板 VisitorMode 3 档 (UseMySettings/CloseToReal/
//     FullyReal), 跟 xin_su_app V0.5 client VisitorMode enum 1:1 wire. V0.5 stage 2
//     A1 大炮 2026-10-16 17:10 拍板 3 档具象命名, V0.5 client 字符串用 camelCase
//     ('useMySettings'/'closeToReal'/'fullyReal'), V1.x server 1:1 wire 保留 camelCase.
//
//   V1.x server LLM 路由:
//     - useMySettings: 走 scripted 模板 + 严格按 preset, 不调 LLM (适合专项训练 / 培训师演示)
//     - closeToReal (默认): 调 LLM, system prompt 含 preset 9 字段 + variance 标记
//     - fullyReal: 调 LLM, system prompt 仅含 persona 5 字段, 不传 preset
//
//   反双胞胎:
//     - 不用 snake_case ('use_my_settings' / 'close_to_real' / 'fully_real'): 跟 V0.5
//       client enum 字符串 1:1 wire, 1:1 wire 不破坏 client 解析
//     - 不加 "low_real" 第 4 档: V0.5 stage 2 大炮拍板 3 档 (useMySettings / closeToReal
//       / fullyReal), V1.x 跟 1:1
//     - 不用 int 数值: V0.x 风格 enum 字符串, 防 drift
//
//   验证: 1. tsc 0 错
//   时间戳: 2026-10-19

/**
 * 训练模式 3 档 (V1.1 §4.2.4, 跟 xin_su_app V0.5 client VisitorMode 1:1 wire).
 *
 * V1.x server 端 LLM 路由 key: 3 档决定 system prompt 含/不含 preset 字段, 跟
 * V0.5 stage 2 大炮 2026-10-16 17:10 拍板 A1 1:1 落地.
 */
export enum VisitorMode {
  /** 按我设置 (原 scripted 行为, 100% 严格按 4 维度设置) */
  USE_MY_SETTINGS = 'useMySettings',
  /** 贴近真实 (原 real 行为, 默认, 80% 跟用户 + 20% Gaussian 随机) */
  CLOSE_TO_REAL = 'closeToReal',
  /** 完全真实 (新增, 100% AI 随机, 不可配置) */
  FULLY_REAL = 'fullyReal',
}
