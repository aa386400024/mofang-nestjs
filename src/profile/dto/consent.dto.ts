import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsArray, IsBoolean, IsString, ValidateNested } from 'class-validator';

/**
 * 知情同意书章节 DTO — V2.0 §Tab4 知情同意书 6 章节.
 */
export class ConsentSectionDto {
  @ApiProperty({ description: '章节标题', example: '一、服务边界' })
  title!: string;

  @ApiProperty({ description: '章节正文 (V2.0 硬编码, V3 接 i18n)' })
  body!: string;
}

/**
 * 响应 DTO — GET /profile/consent-document.
 */
export class ConsentDocumentDto {
  @ApiProperty({ description: '文档版本', example: 'v1.0' })
  version!: string;

  @ApiProperty({ description: '文档标题', example: '陪伴者知情同意书' })
  title!: string;

  @ApiProperty({ description: '章节列表', type: [ConsentSectionDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ConsentSectionDto)
  sections!: ConsentSectionDto[];
}

/**
 * 请求 DTO — POST /profile/consent-sign.
 */
export class SignConsentDto {
  @ApiProperty({ description: '文档版本 (前端从 GET 返回 拿)', example: 'v1.0' })
  @IsString()
  documentVersion!: string;

  @ApiProperty({ description: '是否真滚到底 (前端校验后传 boolean)', example: true })
  @IsBoolean()
  scrolledToBottom!: boolean;
}

/**
 * 响应 DTO — POST /profile/consent-sign.
 */
export class ConsentSignatureDto {
  @ApiProperty({ description: '签字 ID' })
  id!: string;

  @ApiProperty({ description: '文档版本' })
  documentVersion!: string;

  @ApiProperty({ description: '签字时间' })
  signedAt!: Date;
}
