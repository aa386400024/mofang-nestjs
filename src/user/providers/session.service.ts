import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, Repository } from 'typeorm';

import { Session } from '../entities/session.entity';
import { SessionRevokeReason } from '../user.constant';

/**
 * Session service — 用户登录会话管理 (大厂多端登录).
 *
 * V1 职责:
 *   - 创建 session (登录/refresh 时)
 *   - 撤销 session (登出时)
 *   - 列出某用户的所有活跃 session (V2 UI 用)
 *   - 检查 session 是否有效 (未撤销 + 未过期)
 *
 * V2 新增:
 *   - revokedReason: 撤销原因 (审计)
 *   - lastActiveAt: 最后活跃时间 (多端 UI 展示)
 *   - touchLastActive(): 每次鉴权时更新 last_active_at (heartbeat 思路)
 *   - cleanupExpired(): 清理过期 session (cron 用)
 */
@Injectable()
export class SessionService {
  constructor(
    @InjectRepository(Session)
    private readonly repo: Repository<Session>,
  ) {}

  /**
   * 创建新 session (登录或 refresh 时).
   */
  async create(input: {
    userId: string;
    jti: string;
    deviceInfo: string | null;
    userAgentRaw: string | null;
    deviceType: string;
    ipAddress: string | null;
    expiresAt: Date;
  }): Promise<Session> {
    const now = new Date();
    const session = this.repo.create({
      userId: input.userId,
      jti: input.jti,
      deviceInfo: input.deviceInfo,
      userAgentRaw: input.userAgentRaw,
      deviceType: input.deviceType,
      ipAddress: input.ipAddress,
      expiresAt: input.expiresAt,
      lastActiveAt: now,
      isRevoked: false,
    });
    return this.repo.save(session);
  }

  /**
   * 按 jti 查 session.
   */
  async findByJti(jti: string): Promise<Session | null> {
    return this.repo.findOne({ where: { jti } });
  }

  /**
   * 按 sid 查 session (多端管理 UI 用).
   */
  async findBySid(sid: string): Promise<Session | null> {
    return this.repo.findOne({ where: { sid } });
  }

  /**
   * 撤销单个 session (按 jti).
   */
  async revoke(jti: string, reason: SessionRevokeReason = SessionRevokeReason.Logout): Promise<void> {
    await this.repo.update({ jti }, { isRevoked: true, revokedReason: reason });
  }

  /**
   * 按 sid 撤销 (多端 UI "下线此设备").
   */
  async revokeBySid(sid: string, reason: SessionRevokeReason = SessionRevokeReason.ManualRevoke): Promise<boolean> {
    const result = await this.repo.update({ sid }, { isRevoked: true, revokedReason: reason });
    return (result.affected ?? 0) > 0;
  }

  /**
   * 撤销某用户的所有 session (改密码场景).
   * 返回被撤销的 jtis (供 blacklist 同步).
   */
  async revokeAllByUserId(
    userId: string,
    reason: SessionRevokeReason = SessionRevokeReason.PasswordChanged,
    excludeSid?: string,
  ): Promise<{ jti: string; expiresAtMs: number; sid: string }[]> {
    const sessions = await this.repo.find({ where: { userId, isRevoked: false } });
    if (sessions.length === 0) {
      return [];
    }
    const toRevoke = excludeSid ? sessions.filter((s) => s.sid !== excludeSid) : sessions;
    const sids = toRevoke.map((s) => s.sid);
    if (sids.length > 0) {
      await this.repo.update(sids, { isRevoked: true, revokedReason: reason });
    }
    return toRevoke.map((s) => ({
      jti: s.jti,
      expiresAtMs: s.expiresAt.getTime(),
      sid: s.sid,
    }));
  }

  /**
   * 列出某用户的活跃 session (多端 UI 用).
   */
  async listActiveByUserId(userId: string): Promise<Session[]> {
    return this.repo.find({
      where: { userId, isRevoked: false },
      order: { lastActiveAt: 'DESC', createdAt: 'DESC' },
    });
  }

  /**
   * 更新最后活跃时间 (每次 JWT 鉴权时调用, 控制台心跳思路).
   * 失败不阻塞主流程 (fire-and-forget).
   */
  async touchLastActive(jti: string): Promise<void> {
    try {
      await this.repo.update({ jti }, { lastActiveAt: new Date() });
    } catch {
      // ignore
    }
  }

  /**
   * 清理过期 session (cron 调用).
   * 不删, 只标记 revoked, 保留审计价值.
   */
  async cleanupExpired(): Promise<number> {
    const result = await this.repo.update(
      { isRevoked: false, expiresAt: LessThan(new Date()) },
      { isRevoked: true, revokedReason: SessionRevokeReason.Expired },
    );
    return result.affected ?? 0;
  }
}
