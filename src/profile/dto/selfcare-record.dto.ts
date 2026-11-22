import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsArray, IsDateString, IsIn, IsOptional, IsString, MaxLength, ValidateNested } from 'class-validator';

/**
 * 请求 DTO — POST /profile/selfcare-records.
 */
export class CreateSelfcareRecordDto {
  @ApiProperty({ description: '类型', enum: ['mood', 'relax', 'rest'] })
  @IsString()
  @IsIn(['mood', 'relax', 'rest'])
  type!: 'mood' | 'relax' | 'rest';

  @ApiProperty({ description: '日期 (YYYY-MM-DD)', example: '2026-08-20' })
  @IsDateString({ strict: true })
  date!: string;

  @ApiProperty({ description: '备注 (可选)', required: false })
  @IsOptional()
  @IsString()
  @MaxLength(512)
  note?: string;
}

/**
 * 响应 DTO — GET /profile/selfcare-records (单条).
 */
export class SelfcareRecordDto {
  @ApiProperty({ description: '记录 ID' })
  id!: string;

  @ApiProperty({ description: '类型', enum: ['mood', 'relax', 'rest'] })
  type!: 'mood' | 'relax' | 'rest';

  @ApiProperty({ description: '日期' })
  date!: string;

  @ApiProperty({ description: '备注', nullable: true })
  note!: string | null;

  @ApiProperty({ description: '创建时间' })
  createdAt!: Date;
}

/**
 * 响应 DTO — GET /profile/selfcare-records 列表.
 */
export class ListSelfcareRecordsResponseDto {
  @ApiProperty({ description: '总打卡次数' })
  totalCount!: number;

  @ApiProperty({ description: '记录列表', type: [SelfcareRecordDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SelfcareRecordDto)
  records!: SelfcareRecordDto[];
}
