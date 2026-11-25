# AF-512 · 会员体系 v2 企业级实现交付记录

> 任务单：`docs/worklog/records/phase2.5-membership-v2/AF-512/task-sheet.md`
> 分支：`task/AF-512-membership-v2`
> 基线：`c295c2b5`
> 完成日期：2026-11-25
> 产品口径：`docs/specs/active/membership-system-v2.0.md`

---

## 一、交付结论

会员从三套并存口径（profile 三档 / billing 五档 mock / counselor 五档写死 NONE）收口为一套 v2 后端实现：

- `Free / Plus / Pro / Max` 四档 + 三个分钟加包，价格、权益、TTS 档位集中在 `src/membership/membership.constants.ts`。
- 独立分钟配额账本：套餐 / 活动 / 加包 / 迁移四类 lot，预扣 10、单场上限 50、每日 180，扣减顺序与到期顺序可测；余额不允许为负。
- 订单与订阅状态机：下单幂等、支付成功开通、退款收回未使用 lot、当前订单退款回退会员状态；真实支付仍 `paymentReserved`，不伪造 paid。
- 活动规则走 `PromotionEnginePort`，内置 `DefaultPromotionEngine` 负责首购/窗口/预算/单用户上限/底价保护；`flex-rules-engine` 未安装，端口边界已固定。
- 旧 `/profile/membership`、`/billing/*`、`counselor` 配额链路保留兼容，读新账号/新账本，旧字段不破坏。
- 迁移已在真实 `mofang_dev` MySQL 执行成功。

---

## 二、文件清单

### 新增：会员模块

- `src/membership/domain/membership.enums.ts`
- `src/membership/domain/membership.types.ts`
- `src/membership/domain/membership.utils.ts`
- `src/membership/membership.constants.ts`
- `src/membership/entities/membership-quota-lot.entity.ts`
- `src/membership/entities/membership-quota-reservation.entity.ts`
- `src/membership/entities/membership-order.entity.ts`
- `src/membership/entities/membership-promotion-redemption.entity.ts`
- `src/membership/providers/promotion-engine.port.ts`
- `src/membership/providers/default-promotion.engine.ts`
- `src/membership/providers/membership-pricing.service.ts`
- `src/membership/providers/quota-allocator.ts`
- `src/membership/providers/quota-ledger.service.ts`
- `src/membership/providers/membership-account.service.ts`
- `src/membership/providers/membership-order.service.ts`
- `src/membership/dto/membership.dto.ts`
- `src/membership/controllers/membership.controller.ts`
- `src/membership/membership.module.ts`
- `src/migration/1714900000049-AddMembershipV2Tables.ts`
- `test/membership/membership-pricing.spec.ts`
- `test/membership/promotion-engine.spec.ts`
- `test/membership/quota-allocator.spec.ts`
- `test/membership/quota-ledger.service.spec.ts`
- `test/membership/membership-account.service.spec.ts`
- `test/membership/membership-order.service.spec.ts`
- `test/membership/legacy-compat.spec.ts`
- `docs/specs/active/membership-system-v2.0.md`
- `docs/worklog/completed/phase2.5/af512-membership-v2-enterprise-implementation-2026-11-25.md`（本文件）

### 修改：注册、实体与旧链路兼容

- `bin/ormconfig.ts`：注册 `AddMembershipV2Tables1714900000049`
- `src/migration/index.ts`：导出新迁移
- `src/app.module.ts`：注册 `MembershipModule`
- `src/profile/entities/membership.entity.ts`：新增 `tierV2 / periodStart / periodEnd / autoRenew / source / legacyTier / lastOrderId` 映射
- `src/profile/providers/membership.service.ts`：改为注入 `MembershipAccountService` 的兼容层
- `src/profile/dto/membership.dto.ts`：增加 `tierV2 / minutesRemaining / periodEnd`
- `src/profile/profile.module.ts`：import `MembershipModule`
- `src/billing/providers/billing.service.ts`：旧 `/billing/*` 映射 v2 总览、3 档 + 3 加包、订单走新服务
- `src/billing/dto/billing.dto.ts`：增加 v2 可选字段
- `src/billing/billing.module.ts`：import `MembershipModule`
- `src/counselor/providers/billing.service.ts`：会员状态/配额/语音准入委托新账号与新账本；旧下单改 pending
- `src/counselor/dto/billing.dto.ts`：`QuotaStatusDto` 增加分钟字段
- `src/counselor/counselor.module.ts`：import `MembershipModule`
- `src/common/exceptions/biz-code.enum.ts`：新增 50xxx 会员错误码
- `src/common/exceptions/biz.exception.ts`：会员错误码 HTTP 映射与文案
- `docs/worklog/pending/phase4-backlog-2026-11-08.md`：回写档位已拍板与 AF-512 交付边界

---

## 三、关键设计决策与与任务单偏差

| 项 | 决策 | 与任务单关系 |
|---|---|---|
| 年付分钟 | 年付按 12 个月套餐分钟一次性入账（Plus 2880 / Pro 6000 / Max 12000），到期与年付周期一致 | 任务单只写“240 分钟/月”；一次性入账是为避免无月度调度时年付用户只拿 1 个月分钟，已在 spec §3 明示 |
| `gift_minutes` | 订单表新增 `gift_minutes`，支付回调传给账号服务，活动兑换记录使用真实赠送分钟 | 任务单数据模型未列该列；为让“赠品”从端口到账本闭环而补 |
| 配额 Guard | 未单独建 `MembershipQuotaGuard` 类；由 `MembershipController` 的 reserve/settle/release 端点 + `QuotaLedgerService` 提供窄接口 | 任务单写“Guard 或 QuotaReservationService”，取后者语义 |
| `flex-rules-engine` | 未安装；`PromotionEnginePort` + `DefaultPromotionEngine` 先落地 | 任务单明确“不新增依赖，端口 + 适配器边界先落地” |
| 年付/月付刷新 | 当前无月度定时发放；年付一次性、月付一个周期 | 任务单要求“按周期刷新不结转”；周期=年时按年发放，按月刷新调度留后续支付/续费任务 |
| 真实支付 | 全部 `paymentReserved`，订单 pending，不暴露 markPaid 控制器入口 | 任务单明确不接真实支付、不伪造 paid |
| 旧 SKU | 旧 4 个单次 SKU 不再返回；旧 id 下单返回 `MembershipPlanInvalid` | 任务单要求旧 SKU deprecated，未要求继续可买 |

---

## 四、闸门与证据

执行环境：`DESKTOP-E3EVQ9P` / Windows / PowerShell 7.6.4 / node `v22.23.2` / pnpm `9.15.0`。

| 闸门 | 命令 | 结果 |
|---|---|---|
| Lint | `pnpm lint` | exit 0；`{src,test,bin}` 与 `scripts` 两段均通过 |
| 类型 | `pnpm typecheck` | exit 0 |
| 会员定向测试 | `pnpm vitest run test/membership` | 7 个文件 / 41 用例全过；覆盖价格、活动边界、分配顺序、账本预扣/结算/释放/日限/幂等、订单幂等/支付/退款、旧端点映射 |
| 全量测试（CI 口径） | `$env:ORCH_FRAMEWORK_DIR=<repo>/contracts/agent-collaboration-framework/2.0.0; pnpm test` | 289 passed / 1 skipped 文件；4432 passed / 4 skipped / 0 failed；墙钟 28.89s |
| 构建 | `pnpm build` | exit 0 |
| 启动 smoke | `pnpm test:smoke` | `/health` 200，database up（41ms）、redis up |
| Migration | `pnpm migration:run` | 新迁移 `AddMembershipV2Tables1714900000049` 执行成功；4 张表 + `user_memberships` 6 列已建 |
| 内核边界 | `git diff --stat HEAD -- src/engine-core` | 空 |

**全量测试的环境说明**：本机存在兄弟仓 `D:\work\Project\agent-collaboration-framework`，当前为 `2.1.0`，而本仓固化的契约包是 `2.0.0`。默认 `pnpm test` 会优先读兄弟仓，导致 1 个**既有**契约版本对账用例失败（`task-state-index` 声明 1.1.0 vs 框架 2.1.0 期望 1.2.0），与 AF-512 代码无关；按 CI 口径把 `ORCH_FRAMEWORK_DIR` 指向仓内 `2.0.0` 后全量 0 failed。该漂移需要单独的框架升级任务处理，不在 AF-512 内改契约。

---

## 五、真实数据库迁移证据

`pnpm migration:run` 输出关键 DDL：

- `ALTER TABLE user_memberships ADD period_start / period_end / auto_renew / source / legacy_tier / last_order_id`
- `CREATE TABLE membership_quota_lots`（索引 `(uid, expires_at)`、`source`）
- `CREATE TABLE membership_quota_reservations`（`session_id` 唯一、`(uid,status)` 索引）
- `CREATE TABLE membership_orders`（`(uid,idempotency_key)` 唯一、`(uid,created_at)`、`status` 索引）
- `CREATE TABLE membership_promotion_redemptions`（`(uid,promotion_id,order_id)` 唯一）

迁移执行后 `pnpm test:smoke` 启动正常，说明实体映射与真实表结构一致。

---

## 六、已知风险与后续

1. **真实支付未接**：微信/支付宝/Apple IAP 商户、回调验签、自动续费重试、年付收入确认仍在 WP27。`markPaid` 只在内部验单成功后调用。
2. **年付按月刷新**：当前年付一次性入账；若产品坚持“每月刷新”，需补月度发放调度，并处理未用分钟不结转。
3. **并发支付回调**：`markPaid` 未做订单级事务锁；同一订单并发回调依赖订单状态与账号侧 orderId 幂等，极端并发仍可能重复进入开通逻辑。后续接支付回调时应加订单行锁或幂等消费队列。
4. **退款金额计算**：服务端已做金额边界与状态/配额收回，但“7 天未使用全额、已使用按剩余天数比例”的具体金额仍由业务/财务侧传入，未做自动计算。
5. **活动预算**：已有活动总预算与单用户上限；每日成本上限、预算后台、活动配置页未做。
6. **前端契约**：Flutter 仍有两套 billing/profile 解析；本期未授权改前端，旧端点已保留兼容字段，但新 `tierV2/plans/addons/minute` 字段需要前端任务跟进。
7. **旧 counselor SKU 展示**：`skuCatalog` 仍保留旧 SKU 展示，但下单已委托新订单服务；旧客户端若继续旧 SKU 会得到 `MembershipPlanInvalid`。
8. **契约版本漂移**：本仓固化 2.0.0 与兄弟仓 2.1.0 的差异需单独升级任务，不在本期修改。

---

## 七、提交信息

`feat(af512): 会员体系 v2 四档与配额账本落地`
