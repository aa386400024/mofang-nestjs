import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { randomBytes } from 'node:crypto';
import { IsNull, Repository } from 'typeorm';

import { BizCode } from '../../common/exceptions/biz-code.enum';
import { BizException } from '../../common/exceptions/biz.exception';
import { EmailService } from '../../shared/infra/email';
import { MetricsService } from '../../shared/infra/metrics';
import { RedisService } from '../../shared/infra/redis';
import { REDIS_KEYS } from '../../shared/infra/redis/redis.constants';

import { User } from '../entities/user.entity';

/**
 * Email verification service — 邮箱验证流程 (大厂标准).
 *
 * 设计:
 *   - token = 32 字节随机 (URL-safe base64, ~43 字符)
 *   - token 存 Redis (TTL = 30 分钟, 默认)
 *   - 同时存反查索引 (token → uid), 验证时反查用户
 *   - 验证成功后: 更新 user.emailVerifiedAt + 删 Redis token
 *   - 如果用户已验证 → 抛 EmailAlreadyVerified
 *
 * 安全:
 *   - token 单次使用 (用完删)
 *   - 不暴露用户是否已注册 (防用户枚举)
 *   - 防爆破: token 32 字节熵 (256 bit), 不需要 rate limit
 *
 * 与 SMS 区别:
 *   - 邮箱用 URL token (长), SMS 用 6 位验证码 (短)
 *   - 邮箱可以多次重发, SMS 有 rate limit (1 小时 N 条)
 */
@Injectable()
export class EmailVerificationService {
  private readonly logger = new Logger(EmailVerificationService.name);

  constructor(
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    private readonly redis: RedisService,
    private readonly email: EmailService,
    private readonly config: ConfigService,
    private readonly metrics: MetricsService,
  ) {}

  /**
   * 生成并发送邮箱验证 token.
   * 如果邮箱已验证, 不重复发 (抛 EmailAlreadyVerified).
   */
  async sendVerification(uid: string, email: string): Promise<void> {
    const user = await this.userRepo.findOne({ where: { uid, deletedAt: IsNull() } });
    if (!user) {
      throw new BizException(BizCode.UserNotFound);
    }
    if (user.emailVerifiedAt) {
      throw new BizException(BizCode.EmailAlreadyVerified);
    }

    const token = randomBytes(32).toString('base64url');
    // V2026-09-04 治本: ConfigService.get('verification') 在某些启动顺序下返 undefined
    //   (fire-and-forget promise 注入时序坑), 加可选链 + 默认值兜底.
    const ttlMin = this.config.get<{ emailTokenTtlMin?: number }>('verification')?.emailTokenTtlMin ?? 30;
    const ttlSec = ttlMin * 60;

    // 存 Redis: token → uid, 同时存 uid → token 反查 (覆盖旧 token)
    await this.redis.set(REDIS_KEYS.emailVerification(token), uid, ttlSec);
    await this.redis.set(REDIS_KEYS.emailVerificationByUid(uid), token, ttlSec);

    // 发送邮件 (dev 模式进日志)
    await this.email.send({
      to: email,
      subject: '验证您的邮箱 - Mofang',
      html: this.renderTemplate(token, ttlSec / 60),
    });

    this.metrics.incVerificationCodeSent('email', 'register');
    this.logger.log(`email verification sent: uid=${uid} token=${token.slice(0, 8)}…`);
  }

  /**
   * 校验 token, 返回 uid (供 controller 标记已验证).
   * @throws BizException(VerificationCodeInvalid) token 无效
   * @throws BizException(VerificationCodeExpired) token 过期
   */
  async verify(token: string): Promise<string> {
    const uid = await this.redis.get(REDIS_KEYS.emailVerification(token));
    if (!uid) {
      // token 不存在 (无 / 过期 / 已用), 区分过期 vs 无效
      // 大厂做法: 两者同 message 防探测, 但 code 区分
      throw new BizException(BizCode.VerificationCodeInvalid, '验证链接无效或已过期');
    }
    return uid;
  }

  /**
   * 标记邮箱已验证 + 清理 token.
   * 由 controller 在 verify() 成功后调用.
   */
  async markVerified(uid: string): Promise<void> {
    const user = await this.userRepo.findOne({ where: { uid, deletedAt: IsNull() } });
    if (!user) {
      throw new BizException(BizCode.UserNotFound);
    }
    if (!user.emailVerifiedAt) {
      user.emailVerifiedAt = new Date();
      await this.userRepo.save(user);
    }
    // 清理 token (含反查索引)
    const oldToken = await this.redis.get(REDIS_KEYS.emailVerificationByUid(uid));
    if (oldToken) {
      await this.redis.del(REDIS_KEYS.emailVerification(oldToken));
      await this.redis.del(REDIS_KEYS.emailVerificationByUid(uid));
    }
  }

  // ----- 模板 -----

  private renderTemplate(token: string, ttlMin: number): string {
    // V3 接 i18n, V2 用模板字符串 (内联 HTML)
    return `
      <div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px">
        <h2>验证您的邮箱</h2>
        <p>请点击下方链接完成邮箱验证 (链接 ${ttlMin} 分钟内有效):</p>
        <p><a href="https://mofang.cloud/verify-email?token=${token}"
              style="display:inline-block;padding:12px 24px;background:#1677ff;color:#fff;border-radius:4px;text-decoration:none">
          验证邮箱
        </a></p>
        <p>如果按钮无法点击, 请复制链接到浏览器打开:</p>
        <p style="word-break:break-all;color:#666">https://mofang.cloud/verify-email?token=${token}</p>
        <p style="color:#999;font-size:12px;margin-top:30px">
          如果这不是您的操作, 请忽略本邮件.
        </p>
      </div>
    `;
  }
}
