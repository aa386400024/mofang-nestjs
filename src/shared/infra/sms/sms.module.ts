import { Global, Module } from '@nestjs/common';

import { SmsService } from './sms.service';

/**
 * SMS module — 全局短信能力 (心塑 + 魔方共用).
 */
@Global()
@Module({
  providers: [SmsService],
  exports: [SmsService],
})
export class SmsModule {}