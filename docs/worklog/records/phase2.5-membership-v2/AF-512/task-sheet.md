---
taskId: AF-512
contextId: phase2.5-membership-v2
title: 会员体系 v2 企业级落地：四档 + 加包 + 配额账本 + 活动规则端口
type: implementation
status: backlog
baselineRef: c295c2b5
dependsOn: []
scope:
  files:
    - bin/ormconfig.ts
    - src/**
    - test/**
    - docs/specs/active/membership-system-v2.0.md
    - docs/worklog/completed/phase2.5/af512-membership-v2-enterprise-implementation-2026-11-25.md
    - docs/worklog/pending/phase4-backlog-2026-11-08.md
  modules:
    - membership
  interfaces:
    - /membership/**
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs:
  - conventions.md#1.1
  - conventions.md#1.3
  - conventions.md#三
createdAt: 2026-11-25T10:00:00+08:00
agentRole: orchestrator
---

# AF-512 · 会员体系 v2 企业级落地（四档 + 加包 + 配额账本 + 活动规则端口）

> 状态：📋 待执行（2026-11-25）
> 执行方：自做（MainAgent）
> 仓库：D:\work\Project\backend\mofang-nestjs-af070，基线 c295c2b5
> 唯一事实源：本任务单 §3 + `docs/specs/active/membership-system-v1.0.md`（仅历史参考，数值以本单为准）
> 任务性质：新功能 / 商业化基础设施
> 改动范围：仅后端 `src/**`、`test/**`、`bin/ormconfig.ts`、`docs/**`；不碰 Flutter，不改 `admin-dashboard/**`，不改 `engine-core/**`

---

## 0. 必读入口

1. `AGENTS.md` — 强制编排门、engine-core 红线、16 条硬约束、零压红线。
2. `docs/team/conventions.md` — 分层、命令、交付格式。
3. `docs/team/agent-orchestration/README.md` — 没有 `submitted/working` 任务不得开工。
4. 本任务单。
5. 现有会员实现：`src/profile/**`、`src/billing/**`、`src/counselor/providers/billing.service.ts`、`src/counselor/config/membership-tier-presets.ts`、`src/counselor/entities/quota-usage.entity.ts`、两份 migration、`bin/ormconfig.ts`、`src/app.module.ts`。

---

## 1. 背景

会员现在有三套口径并存：`profile` 三档（free/plus/pro，5 个硬编码权益）、`billing` 五档 mock（none/monthly/quarterly/yearly/lifetime，4 个旧 SKU）、`counselor` 五档+两身份档（tier 写死 NONE，addQuota 空实现）。用户已拍板统一为 `Free / Plus / Pro / Max` 四档 + 分钟加包，付费档 68 起，保留原价/活动价/续费价/年付，活动规则走 `flex-rules-engine` 但必须包在 `PromotionEnginePort` 后面，金额、订单、配额仍由后端自己算。

本任务把“能卖、能扣、能续、能退、能审计”的最小企业级闭环落到后端：统一会员账号与权益口径、独立配额账本（套餐/活动/加包三类 lot）、订单与订阅状态机、活动规则端口与底价保护、旧口径兼容映射、迁移与测试。真实支付通道仍按 `paymentReserved` 处理，不伪造支付成功。

---

## 2. 范围

**在范围内：**

- 新增 `src/membership/**`：领域类型/常量、会员账号服务、配额账本、订单与订阅、活动规则端口、控制器、模块。
- 扩展 `src/profile/entities/membership.entity.ts` 的列映射（tierV2 / period / autoRenew / source / legacyTier），保留旧字段兼容。
- `src/profile/providers/membership.service.ts` 与 DTO 兼容：旧 `/profile/membership` 继续可用，内部映射到 v2 账号。
- `src/billing/**` 兼容：旧 `/billing/membership`、`/billing/products`、`/billing/orders` 保留，返回 v2 数据或明确的 deprecated 标记；不删除旧端点。
- `src/counselor/providers/billing.service.ts` 的 quota 读写委托到新账本；旧 `quota_usage` 表保留读兼容，不双写。
- 新增 migration：会员账号列扩展、配额 lot、配额 reservation、订单、活动兑换记录；同步 `bin/ormconfig.ts` 与 `src/migration/index.ts`（如存在）。
- `src/app.module.ts` 注册 `MembershipModule`。
- 单元测试 + 集成测试（可用 sqlite/in-memory 或 mock repository；不依赖真实 MySQL）。
- 正式 spec 更新：新建 `docs/specs/active/membership-system-v2.0.md`，旧 v1.0 保留历史。

**明确不在范围内：**

- 不改 `src/engine-core/**`；`git diff --stat HEAD -- src/engine-core` 必须为空。
- 不接真实微信/支付宝/Apple IAP 商户、不写真实支付回调验签、不伪造 `paid`。
- 不改 Flutter 客户端；不改 `admin-dashboard/**`。
- 不做管理后台页面、不做毛利看板前端。
- 不做自动续费的定时扣款；只落状态机、重试计划和可调度的 service 方法。
- 不删除旧端点、不删除旧表、不做破坏性迁移。
- 不新增第三方依赖，除非用户另行批准；`flex-rules-engine` 先以端口 + 适配器边界落地，默认用内置规则实现，依赖开关留到 L4 审批。

---

## 3. 目标架构 / 交付物

### 3.1 档位与价格（唯一真相源：`src/membership/membership.constants.ts`）

| 档位 | 原价/月 | 活动价/首期 | 续费价/月 | 年付 | 含时长 | TTS |
|---|---:|---:|---:|---:|---:|---|
| Free | 0 | 0 | 0 | 0 | 30 分钟/月 + 新用户 50 分钟一次性 | turbo |
| Plus | 188 | 68 | 88 | 880 | 240 分钟/月 | turbo |
| Pro | 368 | 168 | 188 | 1880 | 500 分钟/月 | hd |
| Max | 688 | 328 | 368 | 3680 | 1000 分钟/月 | hd |

加包：100 分钟/30 元、300 分钟/88 元、500 分钟/138 元，12 个月有效。

活动底价：Plus 68、Pro 168、Max 328；最多叠一层折扣 + 一个赠品；原价必须真实可售；活动价必须标期限。首年限时年付 680/1680/3280 只能走活动预算，不能与首购折扣叠加。

权益矩阵：Free 基础快评；Plus 成长档案 + CBT/人本 + 基础角色池；Pro 全部 4 流派 + 全部角色池 + 高级报告 + 优先客服；Max 再加数据导出 + 专属客服 + 最高文字额度。TTS 仅 Free/Plus 用 turbo，Pro/Max 用 hd。真人督导不打包，Pro 9 折、Max 8 折。并发首版统一 1，Max 预留 2 但默认关闭。

### 3.2 数据模型

- `user_memberships` 扩展：`tier_v2`、`period_start`、`period_end`、`auto_renew`、`source`、`legacy_tier`、`last_order_id`。旧 `tier` 继续写兼容值。
- `membership_quota_lots`：`id`、`uid`、`source(plan/addon/promotion/migration)`、`minutes_total`、`minutes_remaining`、`expires_at`、`order_id`、`campaign_id`、时间戳；索引 `(uid, expires_at)`。
- `membership_quota_reservations`：`id`、`uid`、`lot_allocations json`、`reserved_minutes`、`settled_minutes`、`status(held/settled/released)`、`session_id`、`expires_at`、时间戳；唯一 `session_id`。
- `membership_orders`：`id`、`uid`、`plan_id`、`order_type(subscription/addon)`、`billing_period(monthly/annual)`、`list_amount_cents`、`discount_cents`、`amount_cents`、`currency`、`status(pending/paid/failed/refunded/closed)`、`payment_channel`、`idempotency_key`、`promotion_id`、`created_at`、`paid_at`、`expires_at`；唯一 `(uid, idempotency_key)`。
- `membership_promotion_redemptions`：`id`、`uid`、`promotion_id`、`order_id`、`discount_cents`、`granted_minutes`、`created_at`；唯一 `(uid, promotion_id, order_id)`。

### 3.3 服务与端口

- `MembershipAccountService`：读取/初始化账号；`applyPaidOrder` 幂等开通；`expireDue`；`getOverview`；旧档位映射。
- `QuotaLedgerService`：`grantPlan`、`grantAddon`、`grantPromotion`、`getBalance`、`reserve`、`settle`、`release`；扣减顺序“当期套餐 → 活动赠送 → 加包”；不足拒绝，不允许负余额；单场预扣 10 分钟、上限 50 分钟、每日 180 分钟。
- `MembershipOrderService`：创建订单（幂等）、列出订单、标记支付/退款（仅 mock `paid` 走显式测试入口，生产通道保留）。
- `PromotionEnginePort` + `DefaultPromotionEngine`：输入用户、档位、周期、是否首购、活动码、当前价；输出命中活动、折扣金额、赠品、规则版本；强制底价、最多叠一层、预算/单用户上限；不直接写订单/配额。
- `MembershipQuotaGuard` 或 `QuotaReservationService`：给语音链路提供 reserve/settle 的窄接口。
- `MembershipController`：`GET /membership/me`、`GET /membership/plans`、`POST /membership/orders`、`GET /membership/orders`、`POST /membership/quota/reserve`、`POST /membership/quota/settle`、`POST /membership/quota/release`。全部 JWT + PrivacyGuard L2。

### 3.4 兼容

- `GET /profile/membership` 返回旧字段 + 新 `tierV2`/`quota`/`benefits`，旧客户端不崩。
- `GET /billing/membership` 返回 v2 会员 + 新 SKU（四档 + 三个加包），保留旧 `membership.status` 映射；`paymentReserved=true`。
- `GET /billing/products` 新 SKU 列表；旧 SKU id 不再返回，但文档标注 deprecated。
- `counselor` 的 quota 读写委托新账本；`getMembershipStatus` 返回真实 v2 档位，不再写死 NONE。

### 3.5 测试

- 纯单元：价格解析、活动底价、首购/续费/年付、权益矩阵、旧档位映射、扣减顺序、并发预留幂等。
- 集成：创建订单 → mock paid → 开通 → 配额入账 → reserve/settle → 余额正确；退款 → 赠品/加包收回；重复 `applyPaidOrder` 幂等。
- 负向：低于底价拒绝、余额不足拒绝、超单场/日上限拒绝、重复 idempotencyKey 返回同一订单、过期 lot 不参与扣减。

---

## 4. 红线

- 不改 `src/engine-core/**`；不改 `boundary.spec.ts`。
- 心理内容不进日志；订单/配额日志只出码、金额、分钟数。
- 金额一律整数分；禁止浮点。
- 配额不允许负余额；扣减必须事务内完成；预扣/结算必须幂等。
- 活动价不得击穿底价；原价必须真实可售；不得虚构原价。
- 不伪造支付成功；真实通道未接时 `paymentReserved=true`。
- 旧端点/旧字段保留兼容；不做破坏性 migration。
- 提交只含本任务文件，不混入并行产物。

---

## 5. 闸门

- 日常：`pnpm lint:fast`、`pnpm typecheck`、定向 `pnpm exec vitest run <spec>`。
- 收尾：`pnpm lint` 0 error、`pnpm typecheck` 0 error、`pnpm test` 全绿（记录用例数与墙钟）。
- 迁移：`pnpm migration:run` 在可连库环境验证；若库不可连，记录原因并保留 `migration:show` 证据。
- 边界：`git diff --stat HEAD -- src/engine-core` 为空。
- 兼容：旧 `/profile/membership`、`/billing/membership` 至少各 1 个契约测试。

---

## 6. 交付回写

1. 交付记录 `docs/worklog/completed/phase2.5/af512-membership-v2-enterprise-implementation-2026-11-25.md`，写文件清单、设计偏差、闸门真实数字。
2. 正式 spec `docs/specs/active/membership-system-v2.0.md`。
3. 机读回执 `docs/team/agent-orchestration/transport/receipts/AF-512.json`。
4. commit message：`feat(af512): 会员体系 v2 四档与配额账本落地`。
5. 回写 backlog 母版。

