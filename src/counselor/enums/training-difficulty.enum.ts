// V2026-10-19 治本 (V1.1 §4.2.7 §6.5 — training_difficulty 3 档枚举):
//   原因: counselor-mode-v1.1 §4.2.7 拍板 TrainingDifficulty 3 档 (L1/L2/L3), 跟
//     xin_su_app V0.5 client TrainingDifficulty enum 1:1 wire. V0.3 §13 baseline 0
//     难度 enum (V0.x 难度是 supervisionReport.difficulty 字段 'L1'/'L2'/'L3' 字符串,
//     但没单独 enum), 1:1 wire 0 破坏.
//
//   V0.5 client 端应用:
//     - L1 = 入门 = 10 min (workplace / anxiety 5 场景默认)
//     - L2 = 进阶 = 15 min (parenting / relationship 5 场景默认)
//     - L3 = 挑战 = 20 min (grief 5 场景默认)
//
//   反双胞胎:
//     - 不用 "Beginner"/"Intermediate"/"Advanced" 完整词: V0.5 client label 用
//       "入门"/"进阶"/"挑战" 中文, enum 字符串沿用 V0.x 'L1'/'L2'/'L3' 大写
//     - 不用 5 档: V0.5 stage 2 3 档足够 (L1 入门 / L2 进阶 / L3 挑战), V1.x
//       W9-10 备考/B 端续做时按需扩
//     - 不用 int 数值: V0.x 风格 enum 字符串, 防 drift
//
//   验证: 1. tsc 0 错
//   时间戳: 2026-10-19

/**
 * 训练难度 3 档 (V1.1 §4.2.7, 跟 xin_su_app V0.5 client TrainingDifficulty 1:1 wire).
 *
 * V0.5 stage 2 3 档时长: L1=10min / L2=15min / L3=20min (V0.5 client UI 顶部 Timer
 * pill 走 Timer.periodic 1s tick).
 */
export enum TrainingDifficulty {
  /** 入门 — 10 min (workplace / anxiety 5 场景默认) */
  L1 = 'L1',
  /** 进阶 — 15 min (parenting / relationship 5 场景默认) */
  L2 = 'L2',
  /** 挑战 — 20 min (grief 5 场景默认) */
  L3 = 'L3',
}
