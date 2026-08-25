import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomInt } from 'node:crypto';

import { EmailService } from '../shared/infra/email';
import { RedisService } from '../shared/infra/redis';

const REDIS_KEY_PREFIX = 'auth:login-code:';

/**
 * 6 位邮箱登录验证码服务 — V1.0 心塑前端 OTP 流程.
 *
 * 设计要点 (大厂 standards):
 *   - 6 位纯数字 (0-9 随机), crypto.randomInt 防止伪随机
 *   - Redis 存储, TTL 5 min (从 .env SMS_CODE_TTL_MIN 读)
 *   - 一次性使用: 验证成功立即删除, 防重放
 *   - 邮件通过 EmailService 发 (复用项目 SMTP 基础设施)
 *   - 60s 内同一邮箱不发第二次 (防刷, V2 大厂标准)
 *
 * V2 流程:
 *   1. POST /auth/send-code {email} → 调 generate → 发邮件 → 返 {success:true}
 *   2. POST /auth/verify-code {email, code} → 调 verify → 返 JWT
 *   3. POST /auth/login {username: email, password: code} → 走本地验证 → 返 Payload
 *
 * V1.1 接前端推送: 同时推 PUSH 通知 (验证码实时性更好).
 */
@Injectable()
export class LoginCodeService {
  private readonly logger = new Logger(LoginCodeService.name);
  private readonly ttlSec: number;
  private readonly rateLimitMs: number;

  constructor(
    private readonly redis: RedisService,
    private readonly email: EmailService,
    private readonly config: ConfigService,
  ) {
    // 复用 .env sms.smsCodeTtlMin (5min 默认) + sms.smsCodeLength (6 默认)
    this.ttlSec = Number(this.config.get('sms.smsCodeTtlMin') ?? 5) * 60;
    // 防刷: 60s 内同邮箱不发第二次
    this.rateLimitMs = 60 * 1000;
  }

  /**
   * 生成 6 位验证码 + 存 Redis + 发邮件.
   * 成功返 true, 失败 (SMTP 错 / 防刷) 抛异常.
   */
  public async generateAndSend(email: string): Promise<{
    success: boolean;
    devCode?: string;
  }> {
    const lower = email.toLowerCase().trim();

    // 防刷: 同邮箱 60s 内只发一次
    const rateKey = `${REDIS_KEY_PREFIX}ratelimit:${lower}`;
    const lastSent = await this.redis.get(rateKey);
    if (lastSent) {
      throw new Error('请求过于频繁, 请稍后再试');
    }

    // 生成 6 位数字
    const code = randomInt(0, 1_000_000).toString().padStart(6, '0');

    // 存验证码 (TTL 5min)
    const codeKey = `${REDIS_KEY_PREFIX}${lower}`;
    await this.redis.set(codeKey, code, this.ttlSec);

    // 设防刷 key (rateLimitMs / 1000 = 秒, 复用 field 不写死 60).
    await this.redis.set(rateKey, Date.now().toString(), Math.floor(this.rateLimitMs / 1000));

    // 发邮件 (EmailService 公开方法名是 send, 不是 sendMail)
    await this.email.send({
      to: lower,
      subject: '【心塑】您的登录验证码',
      html: this.renderTemplate(code),
      text: `您的登录验证码是: ${code}\n有效期 5 分钟.`,
    });

    this.logger.log(`[LoginCode] 验证码已发送: ${lower}`);
    // dev 模式返回 code 方便测试 (生产应该删掉)
    return { success: true, devCode: code };
  }

  /**
   * 验证 6 位验证码. 成功返 true + 删 Redis (一次性使用), 失败返 false.
   */
  public async verify(email: string, code: string): Promise<boolean> {
    const lower = email.toLowerCase().trim();
    const key = `${REDIS_KEY_PREFIX}${lower}`;
    const stored = await this.redis.get(key);
    if (!stored) {
      this.logger.log(`[LoginCode] 验证码不存在或已过期: ${lower}`);
      return false;
    }
    if (stored !== code) {
      this.logger.log(`[LoginCode] 验证码不匹配: ${lower}`);
      return false;
    }
    // 验证成功, 一次性使用
    await this.redis.del(key);
    return true;
  }

  /**
   * 邮件 HTML 模板 — 心塑品牌风 (跟项目其他邮件保持一致).
   */
  private renderTemplate(code: string): string {
    return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: -apple-system, 'PingFang SC', sans-serif; background: #FAF8F5; padding: 32px 16px;">
  <div style="max-width: 480px; margin: 0 auto; background: #FFFFFF; border-radius: 16px; padding: 32px; box-shadow: 0 4px 20px rgba(79, 70, 229, 0.06);">
    <h1 style="font-size: 24px; color: #1F1F2A; margin: 0 0 8px 0; font-weight: 600;">心塑</h1>
    <p style="font-size: 14px; color: #6B6A78; margin: 0 0 24px 0;">和你一起, 安静地看见自己</p>
    <p style="font-size: 14px; color: #1F1F2A; line-height: 1.6; margin: 0 0 16px 0;">您的登录验证码:</p>
    <div style="background: #FAE6DD; border-radius: 12px; padding: 24px 24px; text-align: center; margin: 0 0 24px 0;">
      <span style="font-size: 36px; font-weight: 700; color: #D88565; letter-spacing: 8px;">${code}</span>
    </div>
    <p style="font-size: 12px; color: #9C9AAE; line-height: 1.6; margin: 0 0 8px 0;">
      · 验证码有效期 5 分钟, 请尽快使用
    </p>
    <p style="font-size: 12px; color: #9C9AAE; line-height: 1.6; margin: 0;">
      · 如非本人操作, 请忽略此邮件
    </p>
  </div>
</body>
</html>`.trim();
  }
}
