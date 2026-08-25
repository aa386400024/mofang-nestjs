import { Global, Module } from '@nestjs/common';

// ⚠️ 必须直接 import 文件, 不能用 barrel '../../../common' (循环依赖陷阱, 详见 redis.module.ts).
import { SmsService } from './sms.service';
import { CommonModule } from '../../../common/common.module';

/**
 * SMS module — 全局短信能力 (心塑 + 魔方共用).
 *
 * imports 显式声明 CommonModule: SmsService 注入自定义 ConfigService, @Global() 不保证
 * 实例化顺序, 必须在依赖图里显式声明, 否则启动报 UndefinedDependencyException.
 */
@Global()
@Module({
  imports: [CommonModule],
  providers: [SmsService],
  exports: [SmsService],
})
export class SmsModule {}
