import { IsOptional, IsString, Length, Matches } from 'class-validator';

/**
 * 投瓶 DTO — 写入 letter.
 *
 * 大厂 standard 校验:
 *   - content: 1..500 字 (双保险: 前端 maxLength + 后端 Length)
 *   - authorAnonymousName: 1..64 字, 可选 (不传则服务端预置池随机, 跟前端逻辑一致)
 *     允许的字符: 中文 / 英文 / 数字 / 空格 / 常用标点 (前端不用 emoji)
 *
 * 反双胞胎:
 *   - 不复用 good_state_diary/dto 的 body 校验 (那是日记的 body, 不同字段)
 */
export class PostDriftBottleDto {
  @IsString()
  @Length(1, 500, { message: '信件内容需在 1..500 字之间' })
  content!: string;

  @IsOptional()
  @IsString()
  @Length(1, 64, { message: '匿名化名需在 1..64 字之间' })
  // V2026-09-12 fix (max-len + duplicates-in-character-class):
  //   原 155 字符超过 140 上限. 拆 regex + 合并同类 range + 去掉 \u3000 (\s 已覆盖).
  @Matches(
    // prettier-ignore
    /^[\u4E00-\u9FFF\u3040-\u309F\u30A0-\u30FF\uAC00-\uD7AFA-Za-z0-9\u3001\u3002\uFF0C\u300A-\u300D\uFF01\uFF1F\uFF1A\uFF08\uFF09\s]+$/u,
    { message: '匿名化名仅允许中英日韩文、数字、空格和常用中文标点' },
  )
  authorAnonymousName?: string;
}
