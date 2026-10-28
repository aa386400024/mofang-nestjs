// V2026-10-21 治本 (V1.2 VS-C — 逐字稿打点类型 enum):
//   原因: v1.2 spec §6.2 会谈录音与逐字稿打点标记 —— 咨询师在逐字稿上打 3 类点:
//     - good: 做得好的一处 (正强化, 教学用)
//     - improve: 可以改进的一处 (负向教学用)
//     - key_node: 关键节点 (转折点 / 阻抗爆发点 / 风险线索), 督导报告可锚定到这里
//   修法: TranscriptBookmarkMarkType enum, 3 值.
//   反双胞胎:
//     - 不用 boolean (isGood): 3 类语义压不进 2 值, 且 key_node 是**第三种教学意图**
//       (既不是好也不是坏, 是"结构节点"), 跟 good/improve 不在同一维度
//     - 不加更多档 (e.g. 'risk'): 风险线索已有独立的 live hint 通道 (§6.1 suicide_cue),
//       打点位是**教学标注**, 混入风险标记会让两个语义域搅在一起
//   验证: 1. tsc 0 错  2. POST bookmark 传 'key_node' → 200 落库
//   时间戳: 2026-10-21

/**
 * 逐字稿打点类型 (v1.2 spec §6.2).
 */
export enum TranscriptBookmarkMarkType {
  /** 做得好的一处 (正强化教学) */
  GOOD = 'good',
  /** 可以改进的一处 (负向教学) */
  IMPROVE = 'improve',
  /** 关键节点 (转折点 / 阻抗爆发点), 督导报告可锚定到这里 */
  KEY_NODE = 'key_node',
}

/** 取值数组 (给 class-validator 的 @IsIn 用). */
export const TRANSCRIPT_BOOKMARK_MARK_TYPE_VALUES = [
  TranscriptBookmarkMarkType.GOOD,
  TranscriptBookmarkMarkType.IMPROVE,
  TranscriptBookmarkMarkType.KEY_NODE,
] as const;
