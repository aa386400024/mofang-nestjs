import { Injectable, Logger, OnModuleInit } from '@nestjs/common';

import { ConfigService } from '../../../common';

import { BizException } from '../../../common/exceptions/biz.exception';
import { BizCode } from '../../../common/exceptions/biz-code.enum';

/**
 * 短信发送参数.
 */
export interface SendSmsOptions {
  phone: string;
  templateCode?: string;
  templateParams: Record<string, string | number>;
  /** 短信签名 (默认走 env 配的 signName) */
  signName?: string;
}

/**
 * SMS service — 短信发送 (大厂基础设施).
 *
 * Provider 适配:
 *   - 'mock' (默认): 只 log, 不真发 (开发 / 测试)
 *   - 'aliyun': 阿里云短信服务 (整合 SDK 在 V3 加)
 *   - 'tencent': 腾讯云短信 (V3 加)
 *   - 'twilio': Twilio (海外, V3 加)
 *
 * V2 实现:
 *   - mock provider 完整可用
 *   - 其他 provider 留 TODO (实际接入换 SDK, 接口一致)
 *
 * 限流:
 *   - 由业务层 (verification.service) 控制, 不在这里.
 *   - 这里只负责发送, 不负责计数.
 *
 * 安全:
 *   - phone 必须是中国大陆手机号 (11 位, 1[3-9]xxxxxxxxx)
 *   - 短信内容模板化 (template_code + template_params), 防止内容注入
 */
@Injectable()
export class SmsService implements OnModuleInit {
  private readonly logger = new Logger(SmsService.name);

  constructor(private readonly config: ConfigService) {}

  onModuleInit(): void {
    const cfg = this.config.get('sms');
    if (cfg.enabled && cfg.provider !== 'mock') {
      this.logger.warn(`SMS provider=${cfg.provider}, real integration pending (V3)`);
    } else if (!cfg.enabled) {
      this.logger.warn('SMS disabled (SMS_ENABLED=false), send() will only log');
    }
  }

  /**
   * 发送短信.
   * @throws BizException(OAuthProviderError) 当 provider 不可用
   */
  async send(options: SendSmsOptions): Promise<void> {
    const cfg = this.config.get('sms');

    // 校验 phone 格式 (防御性)
    if (!/^1[3-9]\d{9}$/.test(options.phone)) {
      throw new BizException(BizCode.InvalidPhone);
    }

    if (!cfg.enabled || cfg.provider === 'mock') {
      // dev / mock: 只 log
      this.logger.log(
        `[SMS MOCK] phone=${options.phone} template=${options.templateCode ?? 'default'} params=${JSON.stringify(
          options.templateParams,
        )}`,
      );
      return;
    }

    // 其他 provider: 留 TODO (V3 接入 SDK)
    switch (cfg.provider) {
      case 'aliyun':
        await this.sendAliyun(options);
        break;
      case 'tencent':
        await this.sendTencent(options);
        break;
      case 'twilio':
        await this.sendTwilio(options);
        break;
      default:
        throw new BizException(BizCode.ServiceUnavailable, `SMS provider ${cfg.provider} not supported`);
    }
  }

  // ========================================================================
  // Provider 实现 (V3 TODO)
  // ========================================================================

  private async sendAliyun(options: SendSmsOptions): Promise<void> {
    // TODO: 接入 @alicloud/dysmsapi20170525
    this.logger.warn(`[SMS ALIYUN TODO] phone=${options.phone}`);
  }

  private async sendTencent(options: SendSmsOptions): Promise<void> {
    // TODO: 接入 tencentcloud-sdk-nodejs
    this.logger.warn(`[SMS TENCENT TODO] phone=${options.phone}`);
  }

  private async sendTwilio(options: SendSmsOptions): Promise<void> {
    // TODO: 接入 twilio
    this.logger.warn(`[SMS TWILIO TODO] phone=${options.phone}`);
  }
}