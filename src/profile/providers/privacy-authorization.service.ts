import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { PrivacyAuthorizationDto, PrivacyAuthorizationsResponseDto } from '../dto/privacy-authorization.dto';
import { PrivacyAuthorization } from '../entities/privacy-authorization.entity';

/**
 * 隐私授权服务 — V2.0 §Tab4 「授权管理」.
 *
 * V2.0 范围: 仅 list + revoke (撤销).
 *   - grant 流程由各 OAuth 模块 / 设备权限模块单独触发, 本服务只查询 + 撤销
 *
 * V2.0 占位: DB 当前为空, 返回 3 条 sample (跟前端授权管理设计一致).
 * V3 接真实 OAuth / 设备授权时, 各 grant 路径自动 INSERT, 这里 list 自然有数据.
 */
@Injectable()
export class PrivacyAuthorizationService {
  private readonly logger = new Logger(PrivacyAuthorizationService.name);

  constructor(
    @InjectRepository(PrivacyAuthorization)
    private readonly repo: Repository<PrivacyAuthorization>,
  ) {}

  async listAuthorizations(_uid: string): Promise<PrivacyAuthorizationsResponseDto> {
    // V2.0 占位: DB 空时返回 sample
    const now = new Date();
    const dayAgo = new Date(now.getTime() - 86_400_000 * 13);
    const items: PrivacyAuthorizationDto[] = [
      {
        id: 'sample-auth-1',
        type: 'oauth_google',
        status: 'active',
        displayName: 'Google · 大炮的账号',
        grantedAt: dayAgo.toISOString(),
        expiresAt: new Date(now.getTime() + 86_400_000 * 60).toISOString(),
      },
      {
        id: 'sample-auth-2',
        type: 'device_health_sensor',
        status: 'active',
        displayName: 'HUAWEI Band 9 · 健康传感器',
        grantedAt: dayAgo.toISOString(),
        expiresAt: null,
      },
      {
        id: 'sample-auth-3',
        type: 'notification_push',
        status: 'active',
        displayName: 'iOS 推送通知',
        grantedAt: dayAgo.toISOString(),
        expiresAt: null,
      },
    ];
    return { items };
  }

  /**
   * 撤销授权 — 软删 (status → 'revoked'), 保留 audit.
   *
   * 业务约束:
   *   - 仅本人 uid 可撤销
   *   - 已撤销的不允许重复撤销 (idempotent 返回)
   *   - 撤销 OAuth 授权: 应同步调 OAuth provider 撤销 token (V3)
   *   - 撤销设备权限: 应通知前端清除本地缓存 (V3 走 WebSocket / EventBus)
   */
  async revokeAuthorization(uid: string, id: string): Promise<{ revoked: true; id: string }> {
    const row = await this.repo.findOne({ where: { id, uid } });
    if (!row) {
      // V2 占位: sample 模式下未真插 DB, 直接返回成功 (演示场景)
      // V3: throw new BizException(BizCode.PrivacyAuthorizationNotFound);
      this.logger.log(`uid=${uid} revoke (sample mode) auth ${id}`);
      return { revoked: true, id };
    }
    if (row.status === 'revoked') {
      return { revoked: true, id };
    }
    row.status = 'revoked';
    await this.repo.save(row);
    this.logger.log(`uid=${uid} revoked authorization ${id} (type=${row.type})`);
    return { revoked: true, id };
  }
}
