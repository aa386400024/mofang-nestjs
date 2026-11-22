import { IsObject, IsUUID } from 'class-validator';

/**
 * 提交默契拼图答案 — V2026-09-12 §6.4 共种默契拼图.
 *
 * 大厂 standard 校验:
 *   - setId: UUID 格式
 *   - choiceByQuestionId: object { questionId → 0..3 整数 } (深校验在 service 做)
 *
 * 反双胞胎: 独立 DTO, 不复用 assessment 的 submit DTO.
 */
export class SubmitDualPuzzleAnswerDto {
  @IsUUID('4', { message: 'setId 必须是 UUID v4' })
  setId!: string;

  /**
   * 1 组 5 题的作答. 大厂 standard: 这里只校验是 object, 内容合法性由 service.
   */
  @IsObject({ message: 'choiceByQuestionId 必须是对象' })
  choiceByQuestionId!: Record<string, number>;
}
