import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsArray, ValidateNested } from 'class-validator';

/**
 * FAQ DTO — V2.0 §Tab4 帮助与反馈 (5 条).
 */
export class FaqDto {
  @ApiProperty({ description: 'FAQ ID', example: 'faq.mental_health_definition' })
  id!: string;

  @ApiProperty({ description: '问题' })
  question!: string;

  @ApiProperty({ description: '回答' })
  answer!: string;
}

/**
 * 响应 DTO — GET /profile/help/faqs.
 */
export class ListFaqsResponseDto {
  @ApiProperty({ description: '常见问题列表', type: [FaqDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => FaqDto)
  faqs!: FaqDto[];
}

/**
 * 热线电话 DTO — V2.0 §Tab4 危机援助热线 (5 条).
 */
export class HotlineDto {
  @ApiProperty({ description: '热线 ID', example: 'hotline.national_400' })
  id!: string;

  @ApiProperty({ description: '热线名', example: '全国心理援助热线' })
  name!: string;

  @ApiProperty({ description: '电话号码', example: '400-161-9995' })
  number!: string;

  @ApiProperty({ description: '说明', example: '24 小时, 免费, 心理危机干预' })
  description!: string;

  @ApiProperty({ description: 'Material icon name (Flutter Material Icons 对应)' })
  icon!: string;

  @ApiProperty({ description: '是否主推 (UI 标记「推荐」chip)', example: true })
  isPrimary!: boolean;
}

/**
 * 响应 DTO — GET /profile/help/hotlines.
 */
export class ListHotlinesResponseDto {
  @ApiProperty({ description: '热线列表', type: [HotlineDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => HotlineDto)
  hotlines!: HotlineDto[];
}
