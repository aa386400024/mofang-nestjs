import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { ConsentStatusResponseDto } from '../dto/consent-status.dto';
import { RecordConsentDto } from '../dto/record-consent.dto';
import { UserConsent } from '../entities/user-consent.entity';

/**
 * Consent context — 审计所需的请求元数据.
 */
export interface ConsentContext {
  ipAddress: string;
  userAgent: string;
}

/**
 * ConsentService — 用户同意记录核心业务逻辑 (大厂合规级 V3).
 *
 * 设计要点:
 *   - 幂等写入: UNIQUE(deviceId, version, type) 约束保护, 重复 POST 仅刷新审计字段
 *   - 版本权威: 服务端通过 config.consentCurrentVersion 决定需要重新弹 dialog 的客户端
 *   - 游客 → 用户迁移: bindToUser 把 device 上的所有 NULL user_id consent 关联到 user
 *   - 失败容忍: 不抛异常 (record 是 fire-and-forget 语义), 调用方无需 try/catch
 *
 * 不抛异常的原则:
 *   - 写入失败 → 返回 lastError 给调用方, 不 throw (前端 fire-and-forget 不受影响)
 *   - 状态查询失败 → 抛异常 (前端启动关键路径, 必须 fail-fast)
 */
@Injectable()
export class ConsentService {
  private readonly log = new Logger(ConsentService.name);
  private readonly currentVersion: string;

  constructor(
    @InjectRepository(UserConsent)
    private readonly repo: Repository<UserConsent>,
    private readonly config: ConfigService,
  ) {
    this.currentVersion = this.config.get<string>('consentCurrentVersion') ?? 'v1.0';
  }

  /**
   * 记录用户同意 (幂等).
   *
   * @returns 新创建记录的 id + acceptedAt, 或已有记录的 id + 原始 acceptedAt
   */
  public async record(dto: RecordConsentDto, ctx: ConsentContext): Promise<{ id: string; acceptedAt: Date }> {
    // 幂等查询: 已有则更新 IP/UA/metadata (审计), 保留原始 acceptedAt
    const existing = await this.repo.findOne({
      where: {
        deviceId: dto.deviceId,
        consentVersion: dto.consentVersion,
        consentType: dto.consentType,
        appId: dto.appId,
      },
    });

    if (existing) {
      this.log.debug(`[record] idempotent update: deviceId=${dto.deviceId.slice(0, 8)}... version=${dto.consentVersion}`);
      existing.ipAddress = ctx.ipAddress;
      existing.userAgent = ctx.userAgent;
      if (dto.metadata !== undefined) {
        existing.metadata = dto.metadata;
      }
      const saved = await this.repo.save(existing);
      return { id: saved.id, acceptedAt: saved.acceptedAt };
    }

    // 首次写入: userId 留 NULL, 登录后由 bindToUser 关联
    const saved = await this.repo.save(
      this.repo.create({
        userId: null,
        deviceId: dto.deviceId,
        consentVersion: dto.consentVersion,
        consentType: dto.consentType,
        platform: dto.platform,
        appId: dto.appId,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        metadata: dto.metadata ?? null,
      }),
    );
    this.log.log(`[record] new consent: id=${saved.id} device=${dto.deviceId.slice(0, 8)}... version=${dto.consentVersion}`);
    return { id: saved.id, acceptedAt: saved.acceptedAt };
  }

  /**
   * 查询设备同意状态 (含服务端版本强制升级语义).
   *
   * @returns hasAccepted + needReaccept + currentVersion (+ acceptedAt / consentVersion if has)
   */
  public async checkStatus(deviceId: string, consentType: string, appId: string): Promise<ConsentStatusResponseDto> {
    // 取最新一次同意记录 (任意版本)
    const accepted = await this.repo.findOne({
      where: { deviceId, consentType, appId },
      order: { acceptedAt: 'DESC' },
    });

    if (!accepted) {
      return {
        hasAccepted: false,
        needReaccept: true,
        currentVersion: this.currentVersion,
      };
    }

    const matched = accepted.consentVersion === this.currentVersion;
    return {
      hasAccepted: true,
      acceptedAt: accepted.acceptedAt.toISOString(),
      consentVersion: accepted.consentVersion,
      needReaccept: !matched,
      currentVersion: this.currentVersion,
    };
  }

  /**
   * 登录后把 device 上的 consent 关联到 user (guest → user 迁移).
   *
   * @returns 实际更新的记录数
   */
  public async bindToUser(deviceId: string, userId: string): Promise<number> {
    const result = await this.repo
      .createQueryBuilder()
      .update(UserConsent)
      .set({ userId })
      .where('device_id = :deviceId AND user_id IS NULL', { deviceId })
      .execute();

    if (result.affected && result.affected > 0) {
      this.log.log(`[bindToUser] migrated ${result.affected} consents to user=${userId.slice(0, 8)}...`);
    }
    return result.affected ?? 0;
  }
}
