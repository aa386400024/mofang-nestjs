// V2026-10-21 治本 (V1.2 VS-C — 移情/阻抗标记方向 + 类型 enum):
//   原因: v1.2 spec §6.4 双向移情/阻抗标记系统 —— 同一张表上并存两个方向的标记:
//     - visitor_auto:     AI 自动标记 (来访侧: 阻抗 / 回避 / 正移情 / 负移情 / 解离)
//     - counselor_manual: 咨询师手动标记 (反移情侧: 会谈中点「反移情觉察」+ 简短备注)
//     两个方向**必须可区分**, 否则无法回答"这是来访者投射, 还是咨询师自己的反应?"
//   修法: 2 个 enum (方向 + 类型), 共 1 张表.
//   反双胞胎:
//     - 不用 markedBy 自由字符串: 会漏拼写, 且没法按方向做索引/统计 (长程要按 sessionNumber
//       聚合移情/阻抗变化趋势图, 需要可枚举的方向维度)
//     - 不拆成 2 张表: 两侧标记的字段结构完全一样 (session/turn/type/note), 拆表会让
//       "按时间线看全部标记"的查询变成 UNION
//     - counter_transference (反移情) 与其他 5 类同表: 它们本来就是同一个现象轴上的取值
//   验证: 1. tsc 0 错  2. POST mark 传 'counselor_manual' + 'counter_transference' → 200
//   时间戳: 2026-10-21

/**
 * 移情/阻抗标记方向 (v1.2 spec §6.4).
 */
export enum TransferenceMarkDirection {
  /** AI 自动标记 (来访侧) */
  VISITOR_AUTO = 'visitor_auto',
  /** 咨询师手动标记 (反移情侧) */
  COUNSELOR_MANUAL = 'counselor_manual',
}

/**
 * 移情/阻抗标记类型 (v1.2 spec §6.4).
 */
export enum TransferenceMarkType {
  /** 阻抗 */
  RESISTANCE = 'resistance',
  /** 回避 */
  AVOIDANCE = 'avoidance',
  /** 正移情 */
  POSITIVE_TRANSFERENCE = 'positive_transference',
  /** 负移情 */
  NEGATIVE_TRANSFERENCE = 'negative_transference',
  /** 解离 */
  DISSOCIATION = 'dissociation',
  /** 反移情 (咨询师侧) */
  COUNTER_TRANSFERENCE = 'counter_transference',
}

/** 方向取值数组 (给 class-validator 的 @IsIn 用). */
export const TRANSFERENCE_MARK_DIRECTION_VALUES = [
  TransferenceMarkDirection.VISITOR_AUTO,
  TransferenceMarkDirection.COUNSELOR_MANUAL,
] as const;

/** 类型取值数组 (给 class-validator 的 @IsIn 用). */
export const TRANSFERENCE_MARK_TYPE_VALUES = [
  TransferenceMarkType.RESISTANCE,
  TransferenceMarkType.AVOIDANCE,
  TransferenceMarkType.POSITIVE_TRANSFERENCE,
  TransferenceMarkType.NEGATIVE_TRANSFERENCE,
  TransferenceMarkType.DISSOCIATION,
  TransferenceMarkType.COUNTER_TRANSFERENCE,
] as const;
