import { IsString, Length } from 'class-validator';

/**
 * 回信 DTO — 作者写回信给捞起者.
 *
 * 校验跟 PostDriftBottleDto.content 一致 (1..500 字).
 *
 * 反双胞胎: 独立 DTO, 不复用 (业务不同 — 写给作者 vs 写给陌生人).
 */
export class RespondDriftBottleDto {
  @IsString()
  @Length(1, 500, { message: '回信内容需在 1..500 字之间' })
  responseText!: string;
}
