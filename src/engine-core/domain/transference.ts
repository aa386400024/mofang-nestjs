// V2026-10-28 WP1 (引擎内核 · 移情状态):
//   职责: 移情 = 正 / 负 / 依赖三态, 各自独立强度 [0,1], 可叠加, 不互斥.
//   边界: 纯 TS. 不用"三选一"单值 —— 临床存在"又依赖又挑剔"的矛盾移情,
//         单值无法表达叠加, 故采用三态强度向量.

/** 移情三态强度, 各 [0,1], 可同时非零. */
export interface TransferenceState {
  /** 正移情: 理想化 / 好感 / 正向投射. */
  readonly positive: number;
  /** 负移情: 挑剔 / 投射敌意 / 不满. */
  readonly negative: number;
  /** 依赖移情: 强烈依附, 把咨询师当救命稻草. */
  readonly dependency: number;
}

/** 无角色 profile 时的中性移情基线 (全零). */
export const DEFAULT_TRANSFERENCE: TransferenceState = {
  positive: 0,
  negative: 0,
  dependency: 0,
};
