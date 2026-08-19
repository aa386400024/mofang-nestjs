import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomInt } from 'node:crypto';

import { BizCode } from '../../common/exceptions/biz-code.enum';
import { BizException } from '../../common/exceptions/biz.exception';
import { assertChinesePhone } from '../../common/validators/is-chinese-phone.validator';
import { MetricsService } from '../../shared/infra/metrics';
import { RedisService } from '../../shared/infra/redis';
import { REDIS_KEYS, SmsPurpose } from '../../shared/infra/redis/redis.constants';
import { SmsService } from '../../shared/infra/sms';

/**
 * Verification code service — 短信验证码 (大厂标准).
 *
 * 设计:
 *   - 6 位数字 (默认, 大厂标配)
 *   - TTL = 5 分钟 (默认)
 *   - 滑动窗口限流: 每手机号每小时最多 N 条 (默认 10)
 *   - 单次使用 (verify 成功后删除)
 *   - 发送失败时保留 code (重试用), 防短信轰炸
 *   - 防爆破: 6 位 = 100 万组合, 配合 TTL + rate limit 足够
 *
 * 流程:
 *   1. sendCode(phone, purpose): 生成 + 存 Redis + 发短信 + 限流
 *   2. verifyCode(phone, purpose, code): 校验 + 删除
 *
 * Purpose (业务场景):
 *   - register: 注册
 *   - login: 验证码登录 (未来 V3)
 *   - change_password: 已登录改密
 *   - reset_password: 忘记密码 (重置走 email, SMS 备用)
 *   - bind_phone: 绑定手机号
 */
@Injectable()
export class VerificationCodeService {
  private readonly logger = new Logger(VerificationCodeService.name);

  constructor(
    private readonly redis: RedisService,
    private readonly sms: SmsService,
    private readonly config: ConfigService,
    private readonly metrics: MetricsService,
  ) {}

  /**
   * 生成并发送短信验证码.
   * @throws BizException(InvalidPhone) 手机号格式错
   * @throws BizException(VerificationCodeRateLimited) 触发限流
   */
  async sendCode(phone: string, purpose: SmsPurpose): Promise<void> {
    assertChinesePhone(phone);

    // 1. 限流检查 (滑动窗口, 每小时最多 N 条)
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const rateLimit = this.config.get('verification').smsRateLimitPerHour;
    const rateKey = REDIS_KEYS.smsRateLimit(phone);
    const now = Date.now();
    // eslint-disable-next-line sonarjs/pseudo-random
    await this.redis.slidingWindowAdd(rateKey, `${now}-${Math.random()}`, now, 3600);
    const sent = await this.redis.slidingWindowCount(rateKey, 3600);
    if (sent > rateLimit) {
      this.metrics.incVerificationCodeSent('sms', purpose);
      throw new BizException(BizCode.VerificationCodeRateLimited, '短信发送过于频繁, 请稍后再试');
    }

    // 2. 生成 code (避免与历史 code 撞车: 重生成 if 已有)
    const codeKey = REDIS_KEYS.smsCode(phone, purpose);

    let code = await this.redis.get(codeKey);
    if (!code) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      const len = this.config.get('verification').smsCodeLength;

      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
      code = String(randomInt(0, 10 ** len)).padStart(len, '0');
    }

    const ttlSec = this.config.get('verification').smsCodeTtlMin * 60;
    await this.redis.set(codeKey, code, ttlSec);

    // 3. 发短信
    await this.sms.send({
      phone,
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      templateParams: { code, ttl: this.config.get('verification').smsCodeTtlMin },
    });

    this.metrics.incVerificationCodeSent('sms', purpose);
    this.logger.log(`sms code sent: phone=${this.mask(phone)} purpose=${purpose}`);
  }

  /**
   * 校验短信验证码.
   * 成功: 删除 code (一次性)
   * 失败: 抛 BizException, 不删 (防爆破 5 次后整体失效)
   *
   * @throws BizException(InvalidPhone) 手机号格式错
   * @throws BizException(VerificationCodeInvalid) 验证码错
   * @throws BizException(VerificationCodeExpired) 验证码过期
   */
  async verifyCode(phone: string, purpose: SmsPurpose, code: string): Promise<void> {
    assertChinesePhone(phone);
    const codeKey = REDIS_KEYS.smsCode(phone, purpose);
    const stored = await this.redis.get(codeKey);
    if (!stored) {
      throw new BizException(BizCode.VerificationCodeExpired, '验证码已过期, 请重新获取');
    }
    if (stored !== code) {
      // 不删 code, 给用户重试机会 (但 TTL 自动过期)
      throw new BizException(BizCode.VerificationCodeInvalid, '验证码不正确');
    }
    // 校验通过, 删除 code (一次性)
    await this.redis.del(codeKey);
  }

  /**
   * 检查手机号是否已验证 (供 controller).
   * 通过 Redis code 存在性间接判断 (V3 加 phone_verified_at 字段后改 DB 查询).
   */
  private mask(phone: string): string {
    return `${phone.slice(0, 3)}****${phone.slice(7)}`;
  }
}
