import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import * as nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';

import { ConfigService } from '../../../common';

/**
 * 邮件发送参数.
 */
export interface SendMailOptions {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

/**
 * Email service — SMTP 邮件发送 (大厂基础设施).
 *
 * 设计:
 *   - 用 nodemailer (Node.js 标准, 生产 70%+ 大厂在用)
 *   - 单 transporter 复用连接 (SMTP 长连接)
 *   - enabled=false 时只 log (开发 / 测试环境)
 *
 * Provider 切换:
 *   - 阿里云邮件推送: host=smtpdm.aliyun.com
 *   - SendGrid: host=smtp.sendgrid.net
 *   - Mailgun: host=smtp.mailgun.org
 *   - QQ 邮箱: host=smtp.qq.com (开发用)
 *
 * 安全:
 *   - pass 用 env 注入, 不硬编码
 *   - from 是固定发件人, 不让业务层覆盖 (防 SPF 失败)
 */
@Injectable()
export class EmailService implements OnModuleInit {
  private readonly logger = new Logger(EmailService.name);
  private transporter!: Transporter;

  constructor(private readonly config: ConfigService) {}

  onModuleInit(): void {
    const cfg = this.config.get('email');
    if (!cfg.enabled) {
      this.logger.warn('Email disabled (EMAIL_ENABLED=false), send() will only log');
      // 用一个 dummy transporter 防止 send() 报 NPE, 但不真发
      this.transporter = nodemailer.createTransport({ jsonTransport: true });
      return;
    }
    if (!cfg.user || !cfg.pass) {
      this.logger.warn('Email SMTP credentials missing, send() will be no-op');
      this.transporter = nodemailer.createTransport({ jsonTransport: true });
      return;
    }
    this.transporter = nodemailer.createTransport({
      host: cfg.host,
      port: cfg.port,
      secure: cfg.secure,
      auth: { user: cfg.user, pass: cfg.pass },
    });
    this.logger.log(`Email SMTP ready: ${cfg.host}:${cfg.port} as ${cfg.from}`);
  }

  /**
   * 发送邮件.
   * 失败 throw, 由 caller 决定重试 (outbox 模式或同步重试).
   */
  async send(options: SendMailOptions): Promise<void> {
    const cfg = this.config.get('email');
    const from = `"${cfg.fromName}" <${cfg.from}>`;

    if (!cfg.enabled) {
      // dev 模式: 只 log, 不真发
      this.logger.log(`[EMAIL MOCK] to=${options.to} subject="${options.subject}"`);
      this.logger.debug(`[EMAIL MOCK] body: ${options.text ?? options.html}`);
      return;
    }

    await this.transporter.sendMail({
      from,
      to: options.to,
      subject: options.subject,
      text: options.text,
      html: options.html,
    });
  }
}
