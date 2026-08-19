import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { randomBytes } from 'node:crypto';
import * as bcrypt from 'bcryptjs';

import { RedisService } from '../../shared/infra/redis';
import { EmailService } from '../../shared/infra/email';
import { REDIS_KEYS } from '../../shared/infra/redis/redis.constants';
import { MetricsService } from '../../shared/infra/metrics';
import { BizException } from '../../common/exceptions/biz.exception';
import { BizCode } from '../../common/exceptions/biz-code.enum';

import { User } from '../entities/user.entity';
import { PasswordHistoryService } from './password-history.service';
import { SessionService } from './session.service';
import { JwtBlacklistService } from './jwt-blacklist.service';
import { SessionRevokeReason } from '../user.constant';

/**
 * Password reset service — 忘记密码 / 重置密码 (大厂标准).
 *
 * 流程:
 *   1. 用户请求重置: POST /user/forgot-password {email}
 *      → 生成 token, 发邮件 (1 小时内有效)
 *   2. 用户点击邮件链接: POST /user/reset-password {token, newPassword}
 *      → 验证 token + 校验密码 + 检查密码历史 + 重置 + 撤销所有 session
 *
 * 安全:
 *   - token 32 字节熵 (256 bit), 单次使用
 *   - 不暴露邮箱是否已注册 (防用户枚举 — 邮箱不存在时也"假装"发邮件)
 *   - 重置成功后撤销所有 session (强制下线其他设备)
 *   - 重置成功后加入密码历史 (防立即复用)
 *   - 重置成功后强制下次登录必须改密 (mustChangePassword=false, 因已是新密码)
 *
 * 与改密 (change-password) 区别:
 *   - change-password: 已登录状态, 知道旧密码
 *   - reset-password: 未登录/忘记密码, 通过邮件 token 重置
 */
@Injectable()
export class PasswordResetService {
  private readonly logger = new Logger(PasswordResetService.name);

  constructor(
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    private readonly redis: RedisService,
    private readonly email: EmailService,
    private readonly config: ConfigService,
    private readonly metrics: MetricsService,
    private readonly passwordHistory: PasswordHistoryService,
    private readonly sessions: SessionService,
    private readonly blacklist: JwtBlacklistService,
  ) {}

  /**
   * 请求密码重置 (发邮件).
   * 邮箱不存在时也"假装"成功 (防用户枚举).
   */
  async requestReset(email: string): Promise<void> {
    const user = await this.userRepo.findOne({ where: { email, deletedAt: IsNull() } });
    if (!user) {
      // 防枚举: 假装发, 但不真发
      this.logger.log(`password reset requested for non-existent email: ${this.mask(email)}`);
      return;
    }

    const token = randomBytes(32).toString('base64url');
    const ttlSec = this.config.get('verification').passwordResetTokenTtlMin * 60;
    await this.redis.set(REDIS_KEYS.passwordReset(token), user.uid, ttlSec);
    await this.redis.set(REDIS_KEYS.passwordResetByUid(user.uid), token, ttlSec);

    await this.email.send({
      to: email,
      subject: '重置您的密码 - Mofang',
      html: this.renderTemplate(token, ttlSec / 60),
    });

    this.metrics.incAuthPasswordReset('requested');
    this.logger.log(`password reset requested: uid=${user.uid} email=${this.mask(email)}`);
  }

  /**
   * 校验 token, 返回 uid (供 controller 重置密码).
   * @throws BizException(VerificationCodeInvalid) token 无效
   */
  async verifyToken(token: string): Promise<string> {
    const uid = await this.redis.get(REDIS_KEYS.passwordReset(token));
    if (!uid) {
      throw new BizException(BizCode.VerificationCodeInvalid, '重置链接无效或已过期');
    }
    return uid;
  }

  /**
   * 重置密码 (token + newPassword).
   * 由 controller 在 verifyToken() 成功后调用.
   *
   * 步骤:
   *   1. 校验密码强度 (走 DTO validator)
   *   2. 校验密码历史 (防复用)
   *   3. 把旧密码 hash 加入历史
   *   4. 重置 passwordHash + passwordChangedAt + 撤销所有 session
   *   5. 清理 reset token
   */
  async resetPassword(uid: string, newPassword: string): Promise<void> {
    const user = await this.userRepo.findOne({ where: { uid, deletedAt: IsNull() } });
    if (!user) {
      throw new BizException(BizCode.UserNotFound);
    }

    // 1. 检查密码复用
    await this.passwordHistory.assertNotReused(uid, newPassword);

    // 2. 把旧密码写历史
    await this.passwordHistory.recordOldPassword(uid, user.passwordHash);

    // 3. 更新密码 + 时间戳 + 撤销 mustChangePassword (重置即视为已改密)
    user.passwordHash = await bcrypt.hash(newPassword, PasswordResetService.BCRYPT_ROUNDS);
    user.passwordChangedAt = new Date();
    user.mustChangePassword = false;
    await this.userRepo.save(user);

    // 4. 撤销所有 session + 加入 blacklist (强制下线其他设备)
    const revoked = await this.sessions.revokeAllByUserId(uid, SessionRevokeReason.PasswordChanged);
    await this.blacklist.revokeMany(
      revoked.map((r) => ({ jti: r.jti, expiresAtMs: r.expiresAtMs })),
    );

    // 5. 清理 reset token
    const oldToken = await this.redis.get(REDIS_KEYS.passwordResetByUid(uid));
    if (oldToken) {
      await this.redis.del(REDIS_KEYS.passwordReset(oldToken));
      await this.redis.del(REDIS_KEYS.passwordResetByUid(uid));
    }

    this.metrics.incAuthPasswordReset('completed');
    this.logger.log(`password reset completed: uid=${uid}`);
  }

  // ----- 模板 -----

  private renderTemplate(token: string, ttlMin: number): string {
    return `
      <div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px">
        <h2>重置您的密码</h2>
        <p>我们收到了您的密码重置请求. 请点击下方链接设置新密码 (链接 ${ttlMin} 分钟内有效):</p>
        <p><a href="https://mofang.cloud/reset-password?token=${token}"
              style="display:inline-block;padding:12px 24px;background:#ff4d4f;color:#fff;border-radius:4px;text-decoration:none">
          重置密码
        </a></p>
        <p style="color:#999;font-size:12px;margin-top:30px">
          如果这不是您的操作, 请立即登录修改密码, 您的账号可能被盗.
        </p>
      </div>
    `;
  }

  private mask(email: string): string {
    const [local, domain] = email.split('@');
    if (!domain) {
      return '***';
    }
    return `${local.slice(0, 2)}***@${domain}`;
  }

  private static readonly BCRYPT_ROUNDS = 10;
}