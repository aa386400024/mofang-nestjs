// V2026-10-22 治本 (V1.3 §2.1 — practice_scenarios.persona.defenseStyle 6 档 enum):
//   原因: 微技能自由练习引擎 (counselor-practice-engine-v1.3-freeform.md) §1.2 定义
//     「场景变体 = 主诉槽位 × 防御风格槽位」. 防御风格是构成**独立来访者**的
//     核心槽位 —— 同一个主诉, 配不同防御风格, 就是完全不同的临床情境
//     (同一个"失眠", 理智化者需要处理"我查过资料", 哭泣者需要先接住情绪).
//     若把防御风格存成自由字符串, 内容库就会出现 "cooperative" / "配合" / "Cooperative"
//     三种写法, 后续按风格筛选 / 分难度梯聚合时静默失配 —— 这是典型的内容库漂移.
//   修法: 定义 PracticeDefenseStyle 6 档 enum, 应用层强校验 (跟项目既有的
//     TrainingExerciseMode / TrainingExerciseType 风格一致: varchar 列 + 应用层 enum,
//     不用 MySQL ENUM 类型, 避免 schema 跟字符串 drift).
//
//   反双胞胎:
//     - 不用 MySQL ENUM 列类型: 跟 V1.1 §5.2 training_exercises 一致 (项目既定 pattern),
//       ENUM 列一旦要加值就得 ALTER TABLE, 且历史脏值无法自动收敛
//     - 不用 string 拼接派生值: 每档都是独立临床含义, 不存在"从 A 推 B"的关系
//     - 不加 "other" 兜底档: 6 档已覆盖 spec §2.1 列出的全部防御风格; 真遇到新风格
//       时应显式加档并补内容, 而不是让内容库自由落库
//
//   验证:
//     1. tsc 0 错
//     2. 60 条 seed 场景的 persona.defenseStyle 全部落在本 enum 的 6 档内
//     3. 难度梯分布不受防御风格影响 (L1 平静配合 / L2 有防御波动 / L3 阻抗明显)
//
//   时间戳: 2026-10-22

/**
 * 来访者防御风格 6 档 (V1.3 §2.1 拍板).
 *
 * spec §1.2 「主诉槽位 × 防御风格槽位」中的防御风格槽位.
 * 语义:
 *   - cooperative      配合型: 愿意谈, 表达清晰, 适合 L1
 *   - intellectualizing 理智化: 用分析/道理回避情绪, 适合 L2/L3
 *   - stoic            强装没事: 轻描淡写压住情绪, 适合 L2/L3
 *   - silent           沉默回避: 短句/缄默/话题转移, 适合 L2/L3
 *   - angry            愤怒指责: 质问咨询师, 适合 L3
 *   - crying           哭泣: 情绪外溢, 适合 L2/L3
 */
export enum PracticeDefenseStyle {
  /** 配合型 —— 愿意谈, 表达清晰 */
  COOPERATIVE = 'cooperative',
  /** 理智化 —— 用分析/道理回避情绪 */
  INTELLECTUALIZING = 'intellectualizing',
  /** 强装没事 —— 轻描淡写压住情绪 */
  STOIC = 'stoic',
  /** 沉默回避 —— 短句/缄默/话题转移 */
  SILENT = 'silent',
  /** 愤怒指责 —— 质问咨询师 */
  ANGRY = 'angry',
  /** 哭泣 —— 情绪外溢 */
  CRYING = 'crying',
}

/** 防御风格的展示文案 (server 单一事实源, 客户端不二次定义). */
export const PRACTICE_DEFENSE_STYLE_LABELS: Record<PracticeDefenseStyle, string> = {
  [PracticeDefenseStyle.COOPERATIVE]: '配合',
  [PracticeDefenseStyle.INTELLECTUALIZING]: '理智化',
  [PracticeDefenseStyle.STOIC]: '强装没事',
  [PracticeDefenseStyle.SILENT]: '沉默回避',
  [PracticeDefenseStyle.ANGRY]: '愤怒指责',
  [PracticeDefenseStyle.CRYING]: '情绪外溢',
};
