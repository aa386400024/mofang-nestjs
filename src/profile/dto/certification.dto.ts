import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

/**
 * 请求 DTO — POST /profile/certification.
 *
 * V2.0 §Tab4 实名认证:
 *   - realName (1-20 字)
 *   - idCard (18 位身份证, V2.0 简化为明文校验, V3 接 RSA 加密)
 *
 * 大厂做法 (V3 升级):
 *   - idCard 用 RSA-OAEP 加密 (前端用 RsaKeyService 加密后传)
 *   - 后端解密后只存 last4
 *   - 提交时服务端验身份证格式 + 校验码 + 调公安接口实名核验 (V3 接)
 *   - V2.0 占位: 仅校验格式, 状态直接置 verified (不接真实审核)
 */
export class SubmitCertificationDto {
  @ApiProperty({ description: '真实姓名', example: '张三' })
  @IsString()
  @MinLength(2)
  @MaxLength(20)
  realName!: string;

  @ApiProperty({ description: '身份证号 (18 位)', example: '110101199001011234' })
  @IsString()
  @MinLength(15)
  @MaxLength(18)
  idCard!: string;
}

/**
 * 响应 DTO — GET /profile/certification.
 */
export class CertificationDto {
  @ApiProperty({ description: '状态', enum: ['unverified', 'pending', 'verified', 'rejected'] })
  status!: 'unverified' | 'pending' | 'verified' | 'rejected';

  @ApiProperty({ description: '真实姓名', nullable: true })
  realName!: string | null;

  @ApiProperty({ description: '身份证后 4 位', nullable: true, example: '1234' })
  idCardLast4!: string | null;

  @ApiProperty({ description: '人脸核验通过时间', nullable: true })
  faceVerifiedAt!: Date | null;

  @ApiProperty({ description: '提交时间', nullable: true })
  submittedAt!: Date | null;

  @ApiProperty({ description: '审核时间', nullable: true })
  reviewedAt!: Date | null;

  @ApiProperty({ description: '拒绝原因', nullable: true })
  rejectReason!: string | null;
}
