---
taskId: AF-517
contextId: phase2.5-membership-v2
title: 会员非支付链企业级加固：优惠券入口、支付/退款事务、活动预算预占、审计与指标
type: implementation
status: backlog
baselineRef: f6b47f5c13af0424692001d32e8aa2a370edc5f5
dependsOn: [AF-516]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs: [conventions.md#1.1, conventions.md#1.3, conventions.md#2.5, autonomous-team-design.md#6.1]
createdAt: 2026-11-26T10:00:00+08:00
deadline: null
agentRole: executor
scope:
  files:
    - src/membership/
    - src/common/exceptions/
    - src/user/enums/audit-event.enum.ts
    - src/shared/infra/metrics/metrics.service.ts
    - src/migration/
    - bin/ormconfig.ts
    - test/membership/
    - docs/worklog/pending/
    - docs/worklog/completed/
    - docs/worklog/records/
  modules: [membership]
  interfaces: [MembershipController, MembershipAdminController, MembershipOrderService, MembershipAccountService]
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af517-membership-enterprise-hardening-implementation-2026-11-26.md
    kind: report
---

# AF-517 · 会员非支付链企业级加固

> 状态：📋 待执行（2026-11-26）
> 执行方：自做
> 仓库：D:\work\Project\backend\mofang-nestjs-af070，分支 task/AF-517-membership-enterprise-hardening（stacked 在 AF-516）
> 唯一事实源：AF-516 交付记录、`docs/specs/active/membership-system-v2.0.md`（只读）、本次代码事实
> 任务性质：安全/一致性/可观测性加固，不接真实支付
> 改动范围：仅后端 src/test/bin + 文档

## 1. 背景

AF-516 已把动态活动、年付按月、旧 SKU 下线落地，但企业级审计暴露出 6 个必须补的洞：

1. `QuoteQueryDto` / `CreateMembershipOrderDto` 暴露 `couponDiscountCents`，服务端直接把它从活动价里减掉。客户端可以传 `amount - floor`，把任何档位压到底价，属于可直接利用的定价漏洞。
2. `markPaid` 先在事务外读订单状态，再调用账号服务；两个并发回调都可能看到 pending，第二个会把会员周期再延长一个月。账号开通、订单 paid、活动兑换也不在同一事务。
3. `refund` 只收回 lot、撤销兑换，没有终止 `membership_plan_grant_terms`；年付退款后 cron 仍会按月发分钟。会员状态回退也在事务外。
4. 活动预算只在报价时按已支付兑换计算，pending 订单不占预算；并发支付可以超卖活动预算。单用户限次同样只在支付后记录，多个 pending 订单可以绕过。
5. 年付/月付在会员仍有效时续费，`periodStart` 是未来日期，但当前代码立即发下一周期分钟，用户提前拿到未来周期的量。
6. 活动运营写操作没有审计记录；会员支付/退款、年付补发、预算拒绝没有 Prometheus 指标，线上无法定位。

## 2. 范围

**在范围内：**

- 关闭客户端优惠券金额入口：DTO 保留字段兼容，但 controller 对非零值返回 `MembershipCouponUnsupported`（400）；内部 PricingService 仍保留服务端优惠券能力，供未来券系统调用。
- `MembershipOrderService.markPaid` 改为订单行锁事务；`MembershipAccountService.applyPaidOrder` 支持传入 EntityManager，订单 paid、账号权益、配额、活动兑换、预算确认同事务提交。
- `MembershipOrderService.refund` 改为单事务：订单 refunded、会员状态回退、term 终止、lot 收回、兑换撤销、预算释放全部原子完成。
- 新增 `membership_promotion_reservations` 表与服务：下单预占预算/限次，支付确认，退款/超时释放；报价和活动统计把 held 计入。
- 年付/月付未来周期续费改为登记 term、周期起点补发，不提前发分钟；cron 兼容月付 term。
- 活动运营写入接 `AuditLogService`，新增会员活动审计事件。
- `MetricsService` 新增会员支付/退款、年付补发、预算预占指标，并在对应服务中打点。
- 新迁移、测试、交付记录、backlog 回写。

**明确不在范围内：**

- 不接真实微信/支付宝/Apple IAP 支付、回调验签、自动续费扣款、退款金额自动计算。
- 不改 `admin-dashboard/**`、Flutter、`src/engine-core/**`。
- 不新增优惠券表/券系统；本轮只关闭客户端伪造入口，保留服务端能力。
- 不改 `docs/specs/active/membership-system-v2.0.md`（不在 executor scope）；spec 同步另开文档任务。
- 不改旧 `counselor` SKU 的 deprecated/410 行为。

## 3. 目标架构 / 交付物

### 3.1 优惠券入口关闭

- `MembershipController.getQuote` / `createOrder`：检测 `couponDiscountCents > 0` 时抛 `BizException(MembershipCouponUnsupported)`。
- `BizCode.MembershipCouponUnsupported = 50_011`，默认 400。
- DTO 字段保留但标记 deprecated，避免旧客户端解析失败。
- 内部 `MembershipOrderService.quote` 的 `couponDiscountCents` 参数保留，由服务端未来券系统传入，controller 不再透传客户端值。

### 3.2 支付回调与退款原子化

- `MembershipAccountService.applyPaidOrder(payload, manager?)`：有 manager 时在调用方事务内执行，无 manager 时保留原自开事务行为。
- `MembershipOrderService.markPaid`：`dataSource.transaction` 内 `pessimistic_write` 锁订单；已 paid 直接返回；否则调账号开通、写订单 paid、写活动兑换、确认预算预占，全部同事务。
- `MembershipAccountService.markOrderRefunded(uid, orderId, now, manager?)`：同事务内回退会员状态。
- `MembershipPlanGrantService.cancelTermForOrder(uid, orderId, manager)`：退款时终止该订单 term。
- `MembershipOrderService.refund`：单事务内完成订单状态、会员回退、term 终止、lot 收回、兑换撤销、预算释放。

### 3.3 活动预算/限次预占

- 新实体 `MembershipPromotionReservation`（表 `membership_promotion_reservations`）：
  - `id / uid / promotion_id / order_id(unique) / discount_cents / gift_minutes / status(held|consumed|released) / expires_at / created_at / updated_at`
  - 索引 `(promotion_id, status, expires_at)`、`(status, expires_at)`
- 新 `MembershipPromotionReservationService`：
  - `reserve(manager, input)`：锁活动行；按已支付兑换 + held 预占 + 本次折扣校验预算；按已支付兑换 + held 预占校验单用户限次；插入 held 预占。
  - `consume(orderId, manager)`：held → consumed。
  - `release(orderId, manager)`：held/consumed → released（退款/超时）。
  - `reservedByPromotion(campaigns, now)`：按活动汇总未过期 held 金额。
  - `heldCountsByUid(uid, now)`：按活动汇总未过期 held 次数。
  - `cleanupExpired(now)`：held 且过期 → released，返回条数。
- `MembershipPromotionService` 的 `redemptionCountsByPromotion`、`budgetRemainingByPromotion`、`stats` 把 held 预占计入。
- `MembershipOrderService.createOrder` 改为事务：报价后锁活动并插入预占，再写订单；幂等键唯一冲突时回查原订单返回。
- `markPaid` 确认预占；`refund` 释放预占；新增 `MembershipPromotionReservationCleanupCron` 每 10 分钟清理过期 held。

### 3.4 未来周期续费不提前发

- `MembershipPlanGrantService` 支持 `firstMonthGranted=false`：`monthsGranted=0`、`nextGrantAt=termStart`，由 cron 在周期起点发 `plan:1`。
- 月付续费也登记 `monthsTotal=1` 的 term，由同一 cron 在周期起点补发；首购月付仍即时发。
- `MembershipAccountService.applyPaidOrder` 仅在 `periodStart <= paidAt` 时即时发首期；未来周期只登记 term。

### 3.5 审计与指标

- `AuditEvent` 新增 `MembershipPromotionCreated/Updated/Activated/Paused/Deleted`。
- `MembershipPromotionService` 可选注入 `AuditLogService`，写操作记录 actor、promotionId、code、action、status、billingPeriod。
- `MetricsService` 新增：
  - `membership_order_paid_total{tier, period}`
  - `membership_order_refunded_total{tier, period}`
  - `membership_plan_grant_total{result}`
  - `membership_promotion_reservation_total{result}`
- 对应服务打点；指标失败不影响业务。

### 3.6 测试

- 优惠券非零拒绝、零值放行。
- 支付回调重复调用只延长一次周期；事务内订单 paid 与账号开通一致。
- 退款后 term 取消、后续 cron 不再发该订单分钟；会员状态回退。
- 预算预占：并发/超预算拒绝、退款释放、超时清理、统计 held。
- 限次预占：pending 订单占限次，报价不再展示活动。
- 未来周期续费：首期不提前发，term 在起点补发。
- 活动审计调用、指标打点（mock 断言）。
- 迁移注册与本地执行。

## 4. 红线

- 金额只在服务端计算；客户端不得传入任何可减少应付金额的字段。
- 订单 paid、账号权益、配额、兑换、预算确认必须同事务；任何一步失败整体回滚。
- 退款必须同时终止该订单 term，不能只收 lot。
- 活动预算和限次以 DB 事实 + held 预占为准，不以客户端或内存计数为准。
- 不接真实支付，不返回伪 paid。
- 心理内容不进日志/指标标签；指标只带档位、周期、结果等封闭枚举。
- 不越 scope 改 specs/admin-dashboard/engine-core。

## 5. 闸门

| 闸门 | 命令 | 要求 |
|---|---|---|
| Lint | `pnpm lint` | 0 error |
| 类型 | `pnpm typecheck` | 0 error |
| 会员定向 | `pnpm vitest run test/membership` | 全绿 |
| 构建 | `pnpm build` | exit 0 |
| 启动 | `pnpm test:smoke` | /health 200，DB/Redis up |
| 迁移 | `pnpm migration:run` | 新迁移执行成功 |
| 全量 | `$env:ORCH_FRAMEWORK_DIR=...; pnpm test` | 0 failed |
| 内核 | `git diff --stat HEAD -- src/engine-core` | 空 |

## 6. 交付记录

`docs/worklog/completed/phase2.5/af517-membership-enterprise-hardening-implementation-2026-11-26.md`

必须含六组机读字段：`gateResults` / `scopeCheck` / `contractChecks` / `backlogItems` / `deviationTable` / `reviewVerdict`。

## 7. 回写清单

- [ ] 交付记录
- [ ] 回执 `transport/receipts/AF-517.json` + durable 副本
- [ ] `run-once` 摄入并 archive
- [ ] backlog 回写
- [ ] 任务分支提交/推送
- [ ] 不混入并行产物
