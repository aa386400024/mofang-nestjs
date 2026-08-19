import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuditLogProcessor } from './audit-log.processor';
import { AuditLog } from '../../../user/entities/audit-log.entity';

/**
 * Queue module — 异步任务队列 (BullMQ, 大厂标准).
 *
 * 设计:
 *   - @Global() 让业务模块直接 inject AuditLogProcessor
 *   - 共享 Redis 连接 (由 RedisModule 维护)
 *   - Worker concurrency = 5 (单实例基准, 水平扩展加 worker 实例即可)
 *
 * 后续 V3:
 *   - 加 email-outbox 队列 (邮件发送)
 *   - 加 sms-outbox 队列 (短信发送)
 *   - 加 dlq (dead-letter queue) 处理 poison message
 */
@Global()
@Module({
  imports: [TypeOrmModule.forFeature([AuditLog])],
  providers: [AuditLogProcessor],
  exports: [AuditLogProcessor],
})
export class QueueModule {}
