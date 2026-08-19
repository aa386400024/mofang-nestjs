import { Global, Module } from '@nestjs/common';

import { EmailService } from './email.service';

/**
 * Email module — 全局邮件能力 (心塑 + 魔方共用).
 *
 * 后续 V3:
 *   - 加 email-template service (i18n 模板)
 *   - 加 outbox 队列 (异步发, 重试 3 次)
 */
@Global()
@Module({
  providers: [EmailService],
  exports: [EmailService],
})
export class EmailModule {}
