/**
 * 共享基础设施层 (心塑 + 魔方共用).
 *
 * 包含:
 *   - redis: Redis 客户端 + Key 模板
 *   - queue: BullMQ 异步队列 (审计日志等)
 *   - email: SMTP 邮件发送
 *   - sms: 短信发送 (mock / aliyun / tencent / twilio)
 *   - metrics: Prometheus 指标 + /metrics 端点
 *   - observability: Sentry 异常上报
 */
export * from './redis';
export * from './queue';
export * from './email';
export * from './sms';
export * from './metrics';
export * from './observability';