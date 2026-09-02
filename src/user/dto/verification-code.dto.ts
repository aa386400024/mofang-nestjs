import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsString } from 'class-validator';

import { isChinesePhone } from '../../common/validators/is-chinese-phone.validator';
import { SmsPurpose } from '../../shared/infra/redis/redis.constants';

/**
 * 发送短信验证码 DTO.
 */
export class SendVerificationCodeDto {
  @ApiProperty({ description: '手机号 (11 位, 1[3-9]xxxxxxxxx)', example: '13800138000' })
  @IsString()
  @isChinesePhone()
  phone!: string;

  @ApiProperty({
    description: '用途',
    enum: SmsPurpose,
    example: SmsPurpose.Register,
  })
  @IsEnum(SmsPurpose)
  purpose!: SmsPurpose;
}

/**
 * 校验短信验证码 DTO.
 */
export class VerifyCodeDto {
  @ApiProperty({ description: '手机号', example: '13800138000' })
  @IsString()
  @isChinesePhone()
  phone!: string;

  @ApiProperty({ description: '6 位验证码', example: '123456' })
  @IsString()
  code!: string;

  @ApiProperty({ description: '用途', enum: SmsPurpose, example: SmsPurpose.Register })
  @IsEnum(SmsPurpose)
  purpose!: SmsPurpose;
}
