/**
 * 漂流瓶状态机 — V2026-09-12 §6.5 心塑 V6.0.
 *
 * 状态转换 (单向不可回退):
 *   - drift: 投出后在海面, 等人捞
 *   - picked: 被某人捞起, 等作者回信
 *   - responded: 作者已写回信, 关系冻结 (回信关系不能再走)
 *
 * 反双胞胎:
 *   - 不复用 good_state_diary/Status (那是日记的状态, 跟漂流瓶完全无关)
 */
export enum DriftBottleStatus {
  DRIFT = 'drift',
  PICKED = 'picked',
  RESPONDED = 'responded',
}
