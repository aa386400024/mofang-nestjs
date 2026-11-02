# Architecture Decision Records (ADR)

> 记录项目里所有重大架构决策。**新人入职先读这个**。

## 什么是 ADR？

[ADR (Architecture Decision Record)](https://adr.github.io/) 是记录架构决策的轻量文档。每个 ADR：

- 描述一个**重大决策**
- 列出**备选方案**和**理由**
- 记录**后果**（正面 + 负面）
- **不可变**（决策后不改，要改就写新 ADR）

## 索引

| ID | 标题 | 状态 | 日期 |
|---|---|---|---|
| [0001](0001-jwt-vs-cookie-session.md) | 心塑 + 魔方共账号选 JWT，不用 Cookie Session | ✅ Accepted | 2026-08-19 |
| [0002](0002-async-audit-log-via-bullmq.md) | 鉴权审计日志异步化 (BullMQ) | ✅ Accepted | 2026-08-19 |
| [0003](0003-typeorm-migration-replace-synchronize.md) | TypeORM Migration 替代 synchronize | ✅ Accepted | 2026-08-19 |

## 待写

- V3: Redis Sentinel 高可用方案
- V3: 多实例 cron 分布式锁方案
- V3: OAuth Strategy (passport vs id_token)
- V3: i18n 方案

## 如何写新 ADR？

1. 复制 `template.md` → `NNNN-title.md`
2. 按 4 段式写：Context / Decision / Consequences / Alternatives
3. PR review 时讨论
4. merge 后**不可改**（要改写新 ADR 并引用旧的）

## 为什么 ADR 重要？

> "如果不能用一段话解释为什么这么设计，那就是过度设计或者决策没记录。"
>
> — 团队内部共识

新人问"为什么不用 cookie session？"→ 直接甩 ADR-0001
产品问"为什么登录这么慢？"→ 看 ADR-0002 + 监控数据
运维问"为什么不用 synchronize？"→ ADR-0003