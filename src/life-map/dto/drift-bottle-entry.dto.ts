import { DriftBottleStatus } from '../enums/drift-bottle-status.enum';

/**
 * 漂流瓶 entry DTO (前端 DriftBottleEntry 1:1).
 *
 * 字段语义见 entity.ts, 这里只做 shape 对齐.
 *
 * 反双胞胎:
 *   - 不复用 ai-engine/entities/... 的 DTO (无关)
 */
export class DriftBottleEntryDto {
  id!: string;

  authorId!: string;

  authorAnonymousName!: string;

  content!: string;

  createdAt!: Date;

  status!: DriftBottleStatus;

  pickedByUserId!: string | null;

  pickedByAnonymousName!: string | null;

  pickedAt!: Date | null;

  respondedText!: string | null;

  respondedAt!: Date | null;
}
