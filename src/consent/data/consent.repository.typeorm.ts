// V2026-11-14 治本 (TD-17 · C2 第一批仓储端口化 · consent 域 · P-DEBT-11 / L-1):
//   $ConsentRepository$ 端口的 TypeORM 实现 —— consent 域**唯一**允许出现
//   typeorm 值符号的业务文件 (module 装配层除外).
//
//   治本:
//     - 查询口径全部收在本实现内: 幂等四元组查重 / acceptedAt 倒序取最新一条 /
//       批量回填「仅 user_id IS NULL 的设备行」—— 与改前 service 里写的条件
//       **逐字一致**
//     - 实现不写新口径、不加新条件 —— 本单是结构重构, 不是查询优化
//     - 不暴露 EntityManager / FindOptions 给上层
//     - **不吞异常** —— 写失败要冒到 service (service 现有语义逐字保留)
//
//   反双胞胎:
//     - 不把 entity 行直接漏给 service —— 端口出参是 Row 领域类型
//     - 行不由本实现构造 —— 行的字段集合由 service 决定 (纯对象),
//       本实现只负责落库 + 回填
//
//   如何验证:
//     1. tsc 0 错; module provider 接线后 consent 的 3 个端点口径不变
//     2. 单元测试用端口替身驱动 service (不起真 TypeORM / 不连 DB)
//   时间戳: 2026-11-14 GMT+8

import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import type { ConsentIdempotentKey, ConsentRepository, ConsentRow, SaveConsentInput } from '../domain/repositories/consent.repository.js';
import { UserConsent } from '../entities/user-consent.entity.js';

/**
 * 同意记录仓储 (TypeORM 真库实现).
 */
@Injectable()
export class ConsentRepositoryTypeorm implements ConsentRepository {
  /**
   * @param repo 同意记录实体仓储
   */
  constructor(
    @InjectRepository(UserConsent)
    private readonly repo: Repository<UserConsent>,
  ) {}

  /**
   * 按幂等四元组查重 (与唯一索引 uq_user_consents_device_version_type 同口径).
   *
   * @param key deviceId + consentVersion + consentType + appId
   * @returns 行 (无命中返 null)
   */
  async findByIdempotentKey(key: ConsentIdempotentKey): Promise<ConsentRow | null> {
    const row = await this.repo.findOne({
      where: {
        deviceId: key.deviceId,
        consentVersion: key.consentVersion,
        consentType: key.consentType,
        appId: key.appId,
      },
    });
    return row ? toRow(row) : null;
  }

  /**
   * 取该设备该协议类型的最新一条同意记录 (任意版本).
   *
   * @param deviceId 设备指纹
   * @param consentType 协议类型
   * @param appId 应用 id
   * @returns 行 (无命中返 null)
   */
  async findLatestByDevice(deviceId: string, consentType: string, appId: string): Promise<ConsentRow | null> {
    const row = await this.repo.findOne({
      where: { deviceId, consentType, appId },
      order: { acceptedAt: 'DESC' },
    });
    return row ? toRow(row) : null;
  }

  /**
   * 写入一行 —— 带 id = 更新既有行 (幂等命中), 缺省 = 新增行 (首次写入).
   *
   * @param input 行纯对象 (service 内构造)
   * @returns 落库后的行
   */
  async save(input: SaveConsentInput): Promise<ConsentRow> {
    const saved = await this.repo.save(this.repo.create(input));
    return toRow(saved);
  }

  /**
   * 游客 → 用户批量回填 —— 只回填 user_id IS NULL 的设备行.
   *
   * @param deviceId 设备指纹
   * @param userId 目标用户 id
   * @returns 受影响行数 (无命中返 0)
   */
  async bindDeviceToUser(deviceId: string, userId: string): Promise<number> {
    const result = await this.repo
      .createQueryBuilder()
      .update(UserConsent)
      .set({ userId })
      .where('device_id = :deviceId AND user_id IS NULL', { deviceId })
      .execute();
    return result.affected ?? 0;
  }
}

/** entity → Row 映射 (窄字段). */
function toRow(entity: UserConsent): ConsentRow {
  return {
    id: entity.id,
    userId: entity.userId,
    deviceId: entity.deviceId,
    consentVersion: entity.consentVersion,
    consentType: entity.consentType,
    platform: entity.platform,
    appId: entity.appId,
    acceptedAt: entity.acceptedAt,
    updatedAt: entity.updatedAt,
    ipAddress: entity.ipAddress,
    userAgent: entity.userAgent,
    metadata: entity.metadata,
  };
}
