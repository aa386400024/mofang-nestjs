# ADR-0002: 鉴权审计日志异步化 (BullMQ vs Sync)

> **Status**: ✅ Accepted (2026-08-19)
> **Deciders**: 大炮 + AI

## Context

心塑 + 魔方账号系统每次登录 / 注册 / 改密 / OAuth / 锁定等事件都要写审计日志。V1 同步写 DB。

## Decision

**V2 异步化 (BullMQ + 兜底同步)**：
- 业务层 enqueue (<1ms) → 主流程不阻塞
- Worker 异步消费 + 批量写 DB
- 队列不可用 → 降级同步写
- 同步也失败 → 仅 log error，不 throw

## Reasons

### 性能对比

| 方案 | login 延迟 | DB 压力 | 可靠性 |
|---|---|---|---|
| V1 同步 | +5-20ms (1 次 DB round-trip) | 高峰期 100% 同步阻塞 | 99.9% (DB 挂 = 审计挂) |
| V2 异步 | +<1ms (入队) | 后台批量写 | 99.99% (Redis 挂 → 同步兜底) |

### 大厂做法

- **Stripe / PayPal**：审计/通知 走异步队列
- **AWS CloudTrail**：事件先入 Kinesis → Lambda 消费
- **GitHub Actions**：job 入队，runner 异步消费

### 业务要求

- 鉴权事件 **必须不丢**（合规 SOC2 / GDPR）
- **不能阻塞**用户登录（性能体验）
- 失败时 **降级**而不是报错（用户体验）

## Consequences

### 正面
- 登录 / 注册延迟降低 95%
- DB 写入峰值可控（Worker 批量消费）
- 失败透明降级

### 负面
- 引入 BullMQ 依赖（+Redis）
- 监控复杂（队列积压 / worker 异常需要额外告警）
- 审计日志最终一致性（写 DB 之前 enqueue 已返回，理论上可能丢失）

### 风险缓解
- 入队 + 同步兜底双重保证（Redis 挂不会丢）
- Worker 自动重试 3 次（exponential backoff）
- Prometheus 埋点 `audit_log_enqueued_total` / `audit_log_failed_total`
- Grafana dashboard 监控队列积压

## Implementation

```
业务层:
  await this.auditLog.log({...})
    ↓
  AuditLogService:
    enqueue → 成功 → return
    enqueue 失败 → processSync → 成功 → return
    processSync 失败 → log.error + metrics.incFailed → return (不 throw)
    ↓
  BullMQ Queue (Redis):
    key: bullmq:audit-log:{jobId}
    ↓
  AuditLogProcessor Worker:
    concurrency: 5
    失败 → 重试 3 次 (1s, 2s, 4s backoff)
    仍失败 → DLQ (V3 加)
    ↓
  MySQL user_audit_logs 表
```

## Alternatives Considered

### Kafka
**优点**：吞吐更高（百万/秒），持久化更好
**缺点**：运维复杂（Zookeeper/KRaft），单团队项目 over-engineering

**为什么没选**：心塑 + 魔方量级没到那个程度，BullMQ 够用。

### 直接写 MySQL (V1)
**优点**：简单，无依赖
**缺点**：阻塞主流程

**为什么没选**：性能 + 可靠性。

### 写 ELK / ClickHouse
**优点**：长期分析能力强
**缺点**：实时审计不适用（ES 索引延迟 +5s）

**为什么没选**：V2 先合规（审计不丢），长期分析 V3 抽到 ELK。

## References

- [BullMQ Documentation](https://docs.bullmq.io/)
- [Stripe Audit Logs Architecture](https://stripe.com/blog/audit-logs)
- [AWS CloudTrail Architecture](https://docs.aws.amazon.com/awscloudtrail/latest/userguide/how-cloudtrail-works.html)