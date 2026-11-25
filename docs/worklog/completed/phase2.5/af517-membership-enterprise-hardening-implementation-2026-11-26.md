# AF-517 · 会员非支付链企业级加固 — 交付记录

- 日期：2026-11-26
- 任务：AF-517（context `phase2.5-membership-v2`，executor）
- 基线：`f6b47f5c13af0424692001d32e8aa2a370edc5f5`（AF-516 归档 HEAD）
- 分支：`task/AF-517-membership-enterprise-hardening`（stacked 在 AF-516，未合 `integrate`）
- 范围：`src/membership/`、异常码、审计枚举、Prometheus 指标、迁移与 `bin/ormconfig.ts`、`test/membership/`、交付文档
- 明确不做：真实微信/支付宝/Apple IAP、回调验签、自动续费扣款、优惠券表、`admin-dashboard`、Flutter、`src/engine-core`

## 1. 这轮补了什么

AF-516 已把动态活动、年付按月、旧 SKU 410 落地。本轮按“能被利用、会算错账、线上查不到”三类缺口做加固，并额外补了过期 pending 订单关闭。

### 1.1 关闭客户端优惠券压价

- `MembershipController.getQuote` / `createOrder` 增加 `assertNoClientCoupon`：`couponDiscountCents` 非零直接抛 `MembershipCouponUnsupported(50_011)`，不再透传给报价/订单服务。
- `createOrder` 内部 `couponDiscountCents` 固定为 0；`QuoteQueryDto` / `CreateMembershipOrderDto` 字段保留并标记 deprecated，旧客户端不会解析失败。
- `MembershipPricingService` 与 `MembershipOrderService.quote` 的服务端券能力保留，未来券系统由服务端校验券码后调用，客户端无法自带折扣。

### 1.2 支付、退款、账号、配额、兑换、预占同事务

- `MembershipAccountService.applyPaidOrder(payload, manager?)`：有 `EntityManager` 时复用调用方事务；会员行 `pessimistic_write` 锁，避免同用户不同订单并发续费丢更新。
- `MembershipOrderService.markPaid`：`dataSource.transaction` 内锁订单 → 已 paid 幂等返回 → 开通账号/发配额 → 订单 paid → 写活动兑换 → 确认预算预占；任一失败整体回滚。
- `MembershipAccountService.markOrderRefunded(..., manager?)` 与 `MembershipPlanGrantService.cancelTermForOrder` 支持事务内执行。
- `MembershipOrderService.refund`：单事务内锁订单 → refunded → 撤销兑换 → 收回未使用 lot → 释放预占 → 终止该订单 term → 回退会员；年付退款后 cron 不再继续发分钟。

### 1.3 活动预算/限次下单预占

- 新表 `membership_promotion_reservations`：`id / uid / promotion_id / order_id(unique) / discount_cents / gift_minutes / status(held|consumed|released) / expires_at / created_at / updated_at`，索引 `(promotion_id,status,expires_at)`、`(status,expires_at)`。
- `MembershipPromotionReservationService`：
  - `reserve` 锁活动行，按“已支付兑换 + 未过期 held + 本次折扣”校验预算，按“已支付兑换 + 未过期 held”校验单用户限次；同一订单重入返回已有预占。
  - `consume` held→consumed；`release` held/consumed→released；`reservedByPromotion` / `heldCountsByUid` / `statsForPromotion` / `cleanupExpired`。
- `MembershipOrderService.createOrder` 改为事务：幂等检查 → 报价 → 建订单 → 有活动则预占 → 落订单；唯一键冲突回查原订单，不把 500 抛给客户端。
- 报价与运营统计把 held 计入：`redemptionCountsByPromotion` 加 held 次数，`budgetRemainingByPromotion` / `stats` 扣 held 金额，并返回 `reservedCount` / `reservedCents`。
- `MembershipPromotionReservationCleanupCron` 每 10 分钟兜底释放过期 held；保留 1 小时宽限，确保订单过期关闭先跑，避免“额度已回池、订单仍 pending 可支付”的超卖窗口。

### 1.4 过期 pending 订单关闭（本轮额外补）

- 新增 `MembershipOrderService.closeExpired(now, limit=500)`：扫描 `pending && expiresAt <= now`，逐单行锁复核后置 `closed` 并释放预占。
- 新增 `MembershipOrderExpiryCron` 每 10 分钟执行；`markPaid` 对 `closed` 订单直接报“不可支付”，不再允许晚到回调在预占释放后继续占用预算。
- 该能力不在原任务单逐条描述内，属于同一链路的必要闭环，偏差见 §5。

### 1.5 未来周期续费不提前发

- `MembershipPlanGrantService.createAnnualTerm`：`firstMonthGranted=true` → `monthsGranted=1`、`nextGrantAt=termStart+1m`；`false` → `monthsGranted=0`、`nextGrantAt=termStart`，由 cron 在周期起点发 `plan:1`。
- 新增 `createMonthlyTerm`（`monthsTotal=1`）与 `cancelTermForOrder`；月付未来周期续费也走 term，不再立即发下一周期分钟。
- `MembershipAccountService` 仅 `periodStart <= paidAt` 时即时发；未来周期只登记 term。年付首购仍首月立即发，后续按月补。
- `refreshTerms` 加 Prometheus 打点：`success / skipped / failed`。

### 1.6 运营审计与可观测性

- `AuditEvent` 新增 `MembershipPromotionCreated/Updated/Activated/Paused/Deleted`。
- `MembershipPromotionService` 注入可选 `AuditLogService`，create/update/activate/pause/remove 记录 `action / promotionId / code / status / billingPeriod / ruleVersion / actor`。
- 审计是旁路：写审计失败只 `logger.warn`，不回滚运营操作；避免审计库抖动导致活动无法上下架。
- `MetricsService` 新增：
  - `membership_order_paid_total{tier,period,order_type}`
  - `membership_order_refunded_total{tier,period,order_type}`
  - `membership_plan_grant_total{result}`
  - `membership_promotion_reservation_total{result=held|consumed|released|expired|rejected}`
- `MembershipOrderService` 支付/退款成功后打点；`MembershipPlanGrantService` 补发结果打点；预占服务 held/consumed/released/expired/rejected 打点。

## 2. 关键设计决策

1. **锁顺序统一为“订单 → 会员 → 活动/term”**：`markPaid` / `refund` 都先锁订单，账号服务再锁会员；同用户不同订单并发续费串行化。活动预占在 `createOrder` 锁活动行，支付阶段不再抢活动锁，避免与下单互锁。
2. **预占不是“支付后记账”**：`held` 在下单事务内占预算/限次，支付 `consumed`，退款/关闭/超时 `released`；报价与统计把 held 当作已占用资源。
3. **过期订单必须可终结**：只释放预占不关闭订单会留下可支付窗口；因此增加订单过期关闭 cron，并让 `markPaid` 对非 pending 状态硬拒绝。
4. **未来周期只登记、不发分钟**：年付/月付续费在 `periodStart` 未来时只建 term，`QuotaLot` 的 `plan:N` 引用键由 term 在周期起点生成，避免用户提前拿到下一周期额度。
5. **审计不阻断主业务**：运营写操作先落主数据，再 best-effort 写审计；失败有可检索 warn，不作为回滚条件。
6. **优惠券字段保留、入口关闭**：不删 DTO 字段，避免旧客户端解析失败；服务端非零即拒绝，未来券系统只从服务端进入。

## 3. 改动文件

### 新增

- `src/membership/entities/membership-promotion-reservation.entity.ts`
- `src/membership/providers/membership-promotion-reservation.service.ts`
- `src/membership/providers/membership-promotion-reservation-cleanup.cron.ts`
- `src/membership/providers/membership-order-expiry.cron.ts`
- `src/migration/1714900000051-AddMembershipPromotionReservation.ts`
- `test/membership/membership-controller-coupon.spec.ts`
- `test/membership/membership-promotion-reservation.spec.ts`

### 修改

- `src/membership/controllers/membership.controller.ts`
- `src/membership/controllers/membership-admin.controller.ts`
- `src/membership/providers/membership-order.service.ts`
- `src/membership/providers/membership-account.service.ts`
- `src/membership/providers/membership-plan-grant.service.ts`
- `src/membership/providers/membership-promotion.service.ts`
- `src/membership/membership.module.ts`
- `src/membership/domain/membership.enums.ts`
- `src/membership/dto/membership.dto.ts`
- `src/membership/dto/membership-promotion.dto.ts`
- `src/common/exceptions/biz-code.enum.ts`
- `src/common/exceptions/biz.exception.ts`
- `src/user/enums/audit-event.enum.ts`
- `src/shared/infra/metrics/metrics.service.ts`
- `src/migration/index.ts`
- `bin/ormconfig.ts`
- `test/membership/membership-account.service.spec.ts`
- `test/membership/membership-order.service.spec.ts`
- `test/membership/membership-plan-grant.service.spec.ts`
- `test/membership/membership-promotion.service.spec.ts`
- `docs/worklog/pending/phase4-backlog-2026-11-08.md`
- 本交付记录

## 4. 闸门与证据（2026-11-26）

| 闸门 | 结果 | 证据 |
|---|---|---|
| `pnpm typecheck` | exit 0 | `tsc -b tsconfig.check.json` 0 error |
| `pnpm lint` | exit 0 | 带缓存全量 eslint，0 error / 0 warning |
| `pnpm build` | exit 0 | `tsc -p tsconfig.build.json` 成功 |
| `pnpm test:smoke` | exit 0 | 重建后启动 `dist/app.js`，`/health` 200，database up 38ms，redis up |
| `pnpm migration:run` | exit 0 | 真实 `mofang_dev` 建表 `membership_promotion_reservations` + 3 索引，迁移 `1714900000051` 已登记 |
| `pnpm vitest run test/membership` | 13 files / 69 tests 全过 | 3.04s；新增优惠券 3 例、预占 5 例、订单过期 1 例 |
| 全量测试（`--maxWorkers=4`） | 295 passed + 1 skipped files；4460 passed + 4 skipped tests | 69.37s；无失败 |
| 默认全量 `pnpm test` | 4 次中 1 次全绿、3 次 `test/admin-debug/debug-session-persistence.spec.ts` 单例超时 | 该文件单独复跑 28 例全过；失败为 296 worker 并行抖动，与本任务无文件/调用链关系 |
| `git diff --stat HEAD -- src/engine-core` | 空 | engine-core 纯层零改动 |

## 5. 与任务单的偏差

| 任务单 | 实际 | 原因 |
|---|---|---|
| 未列“过期 pending 订单关闭” | 增加 `closeExpired` + `MembershipOrderExpiryCron` | 只释放预占不关闭订单，会留下“额度已回池、订单仍可支付”的超卖窗口；支付回调对 closed 直接拒绝才闭环 |
| 指标只写 `{tier,period}` | 增加 `order_type` 标签 | 加包订单 `planId` 是加包 id，不是会员 tier；不区分会把加包支付混进档位指标 |
| 审计写入直接 await | 审计失败只 warn，不回滚主操作 | 审计是旁路，运营上下架不应被审计库抖动阻断；仍保留可检索告警 |
| 预占清理按 `expiresAt <= now` 直接释放 | 保留 1 小时宽限 | 与订单过期关闭 cron 配合，避免清理先于订单关闭造成超卖窗口 |
| spec 同步 | 未改 `docs/specs/active/membership-system-v2.0.md` | 不在 executor scope；已在 backlog 保留 `membership-spec-sync` |

## 6. 已知遗留 / 下一步

1. **真实支付 WP27**：微信/支付宝/Apple IAP、回调验签、自动续费扣款、退款金额自动计算仍未接；当前 `paymentReserved=true`，不伪造 paid。
2. **部分退款语义**：`refund(uid, orderId, refundAmountCents)` 仍按“订单退款即终止该订单权益”处理，比例退款只改退款金额、不按比例保留权益；接真实支付前需产品/财务定口径，必要时加退款流水表。
3. **admin-dashboard 活动页**：运营 API 已就绪，前端管理页未接。
4. **spec 同步**：活动预占、过期订单关闭、审计/指标口径尚未写进 active spec。
5. **pre-existing flaky**：`test/admin-debug/debug-session-persistence.spec.ts` 在高并发 worker 下偶发 10s waitFor 超时；本任务未改其代码，建议单开测试稳定性任务（降 worker 或放宽等待/隔离临时目录）。
6. **迁移台账漂移**：`migration:run` 输出“94 migrations loaded / 90 in source”，DB 存在源码未列的 `AddVisitorFullPersonaSpeech1714900000053`；本次未处理，建议另开迁移台账核对任务。

## 7. 结论

本轮把会员非支付链从“功能可用”推进到“输入不可伪造、资金/权益同事务、活动预算不被 pending 绕过、未来周期不提前发、运营写操作可追溯、线上有指标可查”。真实支付仍按既定边界留到注册公司后接入；本轮不伪造支付成功。
