import { DualPuzzleCategory } from '../enums/dual-puzzle-category.enum';

/**
 * 单题 DTO — 返回给前端 (跟前端 DualPuzzleQuestion 1:1).
 */
export class DualPuzzleQuestionDto {
  id!: string;
  prompt!: string;
  options!: string[];
  category!: DualPuzzleCategory;
  contextHint!: string | null;
}

/**
 * 题目组 DTO — 5 题一组 (跟前端 DualPuzzleSet 1:1).
 */
export class DualPuzzleSetDto {
  id!: string;
  title!: string;
  subtitle!: string | null;
  questions!: DualPuzzleQuestionDto[];
  createdAt!: Date;
}

/**
 * 作答结果 DTO (跟前端 DualPuzzleResult 1:1).
 *
 * 双作者都答完 → 计算 chemistryScore 0..100.
 * 未齐 → 返 null (前端轮询).
 *
 * V2026-09-12 fix (build):
 *   - 改成 plain fields (verdictLabel / verdictEmoji) 而不是 getter 方法.
 *   - getter 在前端不是问题 (Dart class), 但 DTO 类通过 JSON 序列化时 getter 不被序列化,
 *     前端就拿不到. 改成 service 填好字段 + DTO 只存数据.
 *   - 静态方法 verdictLabelFor / verdictEmojiFor 给 service 派生.
 */
export class DualPuzzleResultDto {
  setId!: string;
  userAId!: string;
  userBId!: string;
  chemistryScore!: number; // 0..100
  perQuestionMatch!: Record<string, boolean>;
  generatedAt!: Date;
  verdictLabel!: string;
  verdictEmoji!: string;

  /**
   * 默契指数分级 (跟前端 DualPuzzleResult.verdictLabel 一致).
   * 大厂 standard: 静态方法 + DTO 数据字段, 不依赖 getter 序列化.
   */
  static verdictLabelFor(score: number): string {
    if (score >= 90) return '心有灵犀';
    if (score >= 80) return '高度默契';
    if (score >= 60) return '挺合拍';
    if (score >= 40) return '需要沟通';
    return '差异较大';
  }

  static verdictEmojiFor(score: number): string {
    if (score >= 90) return '✨';
    if (score >= 80) return '💫';
    if (score >= 60) return '🌿';
    if (score >= 40) return '🌧️';
    return '🌫️';
  }
}

/**
 * 一组 5 题作答分布 — 用作化学指数计算输入.
 *
 * V2026-09-12 fix (build): 之前作为 DTO 导出但 service 没用, 删掉防止 unused import.
 */
