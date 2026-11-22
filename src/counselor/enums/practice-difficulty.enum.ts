// V2026-10-22 治本 (V1.3 §1.2 / §2.1 — practice_scenarios.difficulty 难度梯 3 档 enum):
//   原因: spec §2.1 把 difficulty 定为 int (1/2/3), 表达"难度梯 L1/L2/L3, 每个
//     基本功 6 个变体按 2/2/2 分布". 但项目里 difficulty 已有 2 套既有口径:
//       - TrainingDifficulty (varchar 'L1'/'L2'/'L3') —— MCQ 训练题用
//       - 本表 (int 1/2/3)                        —— 自由练习场景用
//     同一个概念两个存储口径, 一旦跨表 join / 跨接口传递就会踩坑.
//   修法: 定义 PracticeDifficulty 数值 enum (L1=1 / L2=2 / L3=3),
//     **值即 spec §2.1 的 int 1/2/3**, 不改列类型, 只在应用层拿到有名字的枚举:
//       - 数字 enum 天然支持升序排序 (弱项推荐 / 场景列表按难度排)
//       - TypeORM 落库就是 int, 与 spec 逐字节一致
//     跨口径转换集中在 practice-display-meta 一处 —— 具体是那里的两个函数:
//       practiceDifficultyToTrainingDifficulty() / trainingDifficultyToPracticeDifficulty()
//       (§8.5 A1 治本: 之前这里只写了"集中在 practice-display-meta 一处",
//        但那个文件里根本没有转换函数 —— 注释与实现不符, 后来人照注释去找会扑空;
//        现在函数真的在那儿了, 且转换只用于**展示层对齐**, 禁止跨表 join 比较难度)
//
//   反双胞胎:
//     - 不复用 TrainingDifficulty (varchar 'L1'): 改列类型会破坏 spec §2.1 的 int 契约,
//       且已落库的 int 列与 varchar 列无法直接比较
//     - 不加 "L4" / "expert" 档: spec §1.2 明确 3 档, 且 60 条内容库按 2/2/2 分布;
//       扩档要同步补内容, 由内容库迭代驱动, 不是由枚举先行
//     - 不用裸 number: 应用层到处出现 magic number 1/2/3, 可读性差且易错位
//
//   验证:
//     1. tsc 0 错
//     2. 60 条 seed 场景的 difficulty 覆盖 1/2/3, 每个 mode 内 2/2/2 分布
//     3. PracticeDifficulty ↔ TrainingDifficulty 转换函数 3 档全通
//
//   时间戳: 2026-10-22

/**
 * 微技能练习难度梯 3 档 (V1.3 §1.2 拍板, 数值 1/2/3 与 spec §2.1 的 int 列一致).
 */
export enum PracticeDifficulty {
  /** L1 入门 —— 情绪平静、配合、议题清晰 */
  L1 = 1,
  /** L2 进阶 —— 情绪有波动 / 有防御 / 混合矛盾 */
  L2 = 2,
  /** L3 困难 —— 情绪负荷高或阻抗明显 (前端弹可退出轻提示) */
  L3 = 3,
}

/** 难度梯展示文案 (server 单一事实源). */
export const PRACTICE_DIFFICULTY_LABELS: Record<PracticeDifficulty, string> = {
  [PracticeDifficulty.L1]: '入门',
  [PracticeDifficulty.L2]: '进阶',
  [PracticeDifficulty.L3]: '困难',
};

/** 难度梯取值全集 (校验用). */
export const PRACTICE_DIFFICULTY_VALUES: readonly PracticeDifficulty[] = [
  PracticeDifficulty.L1,
  PracticeDifficulty.L2,
  PracticeDifficulty.L3,
];
