// V2026-10-19 治本 (V1.1 §4.2.5 §6.5 — per-dim variance 3 档弱指示):
//   原因: counselor-mode-v1.1 §4.2.5 拍板 DimensionVariance 3 档 (Low/Medium/High),
//     跟 xin_su_app V0.5 client DimensionVariance enum 1:1 wire. V0.5 stage 2
//     B1 大炮 2026-10-16 17:10 拍板 per-dim variance 算法:
//       - low: 0% 随机, 100% 严格按用户设置
//       - medium: 20% 完全随机 (Uniform 0-1) + 80% Gaussian σ=0.15 围绕用户 (类别维度: 20% 切其它类)
//       - high: 50% 完全随机 + 50% Gaussian σ=0.3 (类别维度: 50% 切其它类)
//     3 维度 (styleVariance/emotionVariance/defenseVariance) 共享此 enum.
//
//   反双胞胎:
//     - 不用 5 档 (low/medium-low/medium/medium-high/high): V0.5 stage 2 大炮拍板 3 档,
//       简洁清晰, V1.x 跟 1:1
//     - 不用 float 0.0-1.0 连续值: V0.5 client UI 走 SegmentedControl 3 档 chip (iOS
//       Settings 1:1 wire 风格), V1.x server 端 enum 字符串 1:1
//     - 不用 snake_case 风格化: V0.5 client 字符串用 'low'/'medium'/'high' 小写, V1.x
//       1:1 wire
//
//   验证: 1. tsc 0 错
//   时间戳: 2026-10-19

/**
 * Per-dim variance 3 档弱指示 (V1.1 §4.2.5, 跟 xin_su_app V0.5 client DimensionVariance 1:1 wire).
 *
 * 仅 "贴近真实" (closeToReal) 模式生效, "按我设置" / "完全真实" 模式隐藏.
 * 3 维度共享此 enum: styleVariance / emotionVariance / defenseVariance.
 */
export enum DimensionVariance {
  /** 低: 0% 随机, 100% 严格按用户设置 (类别维度 0% 切其它) */
  LOW = 'low',
  /** 中 (默认): 20% 完全随机 + 80% Gaussian σ=0.15 (类别维度 20% 切其它) */
  MEDIUM = 'medium',
  /** 高: 50% 完全随机 + 50% Gaussian σ=0.3 (类别维度 50% 切其它) */
  HIGH = 'high',
}
