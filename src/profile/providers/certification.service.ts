import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { CertificationDto, SubmitCertificationDto } from '../dto/certification.dto';
import { Certification } from '../entities/certification.entity';

/**
 * Certification service — 心塑「我的」Tab 实名认证核心服务 (陪伴者专属).
 *
 * V2.0 占位:
 *   - 提交即 verified (不接实际审核流程)
 *   - real_name 暂存明文 (V3 接 RsaKeyService 加密)
 *   - id_card 只存 last4 (PII 最小化)
 *
 * V3 升级:
 *   - 调公安接口做实名核验 (V3 接)
 *   - 人工审核工作流 (V3 接运营后台)
 *   - status 真实流转: pending → verified / rejected
 *   - rejectReason 由审核员填
 */
@Injectable()
export class CertificationService {
  constructor(
    @InjectRepository(Certification)
    private readonly repo: Repository<Certification>,
  ) {}

  async getCertification(uid: string): Promise<CertificationDto> {
    const cert = await this.ensureCertification(uid);
    return this.toDto(cert);
  }

  /**
   * 提交实名认证.
   *
   * V2.0 行为:
   *   - 校验格式 (V2 简化为非空)
   *   - 存明文 realName (V3 加密)
   *   - 存 last4 (PII 最小化)
   *   - status 直接置 verified (V3 走实际审核)
   *
   * V3 行为:
   *   - 调 RsaKeyService 解密 idCard
   *   - 调公安接口实名核验
   *   - 成功 → status=verified
   *   - 失败 → 抛 IdentityVerificationFailed
   *   - 调不通 → status=pending, 入人工审核队列
   */
  async submitCertification(uid: string, dto: SubmitCertificationDto): Promise<CertificationDto> {
    const cert = await this.ensureCertification(uid);

    const now = new Date();

    // V2.0 简化校验: 真实姓名 1+ 字, 身份证长度合理 (V3 接更严校验)
    if (dto.realName.trim().length === 0) {
      throw new Error('真实姓名不能为空');
    }
    if (dto.idCard.length < 15) {
      throw new Error('身份证号格式不正确');
    }

    cert.realName = dto.realName;
    cert.idCardLast4 = dto.idCard.slice(-4);
    cert.submittedAt = now;
    cert.faceVerifiedAt = now; // V2.0 占位 = 提交时间 (V3 接人脸核验)
    cert.reviewedAt = now; // V2.0 占位 = 立即通过
    cert.status = 'verified';
    cert.rejectReason = null;

    const saved = await this.repo.save(cert);
    return this.toDto(saved);
  }

  private async ensureCertification(uid: string): Promise<Certification> {
    const existing = await this.repo.findOne({ where: { uid } });
    if (existing) return existing;
    try {
      return await this.repo.save(
        this.repo.create({
          uid,
          status: 'unverified',
          realName: null,
          idCardLast4: null,
          faceVerifiedAt: null,
          submittedAt: null,
          reviewedAt: null,
          rejectReason: null,
        }),
      );
    } catch {
      const retry = await this.repo.findOne({ where: { uid } });
      if (retry) return retry;
      throw new Error('ensureCertification race retry failed');
    }
  }

  private toDto(cert: Certification): CertificationDto {
    return {
      status: cert.status,
      realName: cert.realName,
      idCardLast4: cert.idCardLast4,
      faceVerifiedAt: cert.faceVerifiedAt,
      submittedAt: cert.submittedAt,
      reviewedAt: cert.reviewedAt,
      rejectReason: cert.rejectReason,
    };
  }
}
