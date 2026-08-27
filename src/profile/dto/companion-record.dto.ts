import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsArray, IsDateString, IsOptional, IsString, IsUUID, MaxLength, MinLength, ValidateNested } from 'class-validator';

/**
 * 请求 DTO — POST /profile/companion-records.
 */
export class CreateCompanionRecordDto {
  @ApiProperty({ description: '被陪伴者 UID', example: 'uuid-of-target-user' })
  @IsUUID('4')
  companionToUid!: string;

  @ApiProperty({ description: '日期 (YYYY-MM-DD)', example: '2026-08-20' })
  @IsDateString({ strict: true })
  date!: string;

  @ApiProperty({ description: '记录标题', example: '发送安抚卡片' })
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  title!: string;

  @ApiProperty({ description: '摘要', example: '已发送「安静陪伴」卡片 1 张' })
  @IsString()
  @MinLength(1)
  @MaxLength(512)
  summary!: string;

  @ApiProperty({ description: '状态标签', required: false, example: '已发送' })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  tag?: string;
}

/**
 * 响应 DTO — GET /profile/companion-records (单条).
 */
export class CompanionRecordDto {
  @ApiProperty({ description: '记录 ID', example: 'uuid' })
  id!: string;

  @ApiProperty({ description: '被陪伴者 UID' })
  companionToUid!: string;

  @ApiProperty({ description: '日期 (YYYY-MM-DD)', example: '2026-08-20' })
  date!: string;

  @ApiProperty({ description: '记录标题', example: '发送安抚卡片' })
  title!: string;

  @ApiProperty({ description: '摘要', example: '已发送「安静陪伴」卡片 1 张' })
  summary!: string;

  @ApiProperty({ description: '状态标签', example: '已发送' })
  tag!: string;

  @ApiProperty({ description: '创建时间' })
  createdAt!: Date;
}

/**
 * 响应 DTO — GET /profile/companion-records (列表 + 概览).
 */
export class ListCompanionRecordsResponseDto {
  @ApiProperty({ description: '总陪伴次数', example: 12 })
  totalCount!: number;

  @ApiProperty({ description: '记录列表', type: [CompanionRecordDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CompanionRecordDto)
  records!: CompanionRecordDto[];
}
