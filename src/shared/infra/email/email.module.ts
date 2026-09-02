import { Global, Module } from '@nestjs/common';

// ⚠️ 必须直接 import 文件, 不能用 barrel '../../../common' (循环依赖陷阱, 详见 redis.module.ts).
import { EmailService } from './email.service';
import { CommonModule } from '../../../common/common.module';

/**
 * Email module — 全局邮件能力 (心塑 + 魔方共用).
 *
 * 后续 V3:
 *   - 加 email-template service (i18n 模板)
 *   - 加 outbox 队列 (异步发, 重试 3 次)
 *
 * imports 显式声明 CommonModule: EmailService 注入自定义 ConfigService, @Global() 不保证
 * 实例化顺序, 必须在依赖图里显式声明, 否则启动报 UndefinedDependencyException.
 */
@Global()
@Module({
  imports: [CommonModule],
  providers: [EmailService],
  exports: [EmailService],
})
export class EmailModule {}
