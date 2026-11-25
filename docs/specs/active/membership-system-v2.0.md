# 会员体系 v2.0（四档 + 加包 + 分钟配额）

> 状态：已批准并落地后端（2026-11-25）
> 任务：AF-512
> 唯一实现真相源：`src/membership/membership.constants.ts`
> 旧版 `membership-system-v1.0.md` 保留历史，不再作为价格依据

---

## 1. 产品结论

会员统一为 `Free / Plus / Pro / Max` 四档，按**分钟**计量语音训练，不再按“场次/字符”混算。付费档从 68 元首期活动价起步，同时保留原价、活动价、续费价、年付价，避免“活动价即长期价”导致负毛利。

| 档位 | 原价/月 | 活动价/首期 | 续费价/月 | 年付 | 含时长 | TTS |
|---|---:|---:|---:|---:|---:|---|
| Free | 0 | 0 | 0 | 0 | 30 分钟/月 + 新用户 50 分钟一次性 | turbo |
| Plus | 188 | 68 | 88 | 880 | 240 分钟/月 | turbo |
| Pro | 368 | 168 | 188 | 1880 | 500 分钟/月 | hd |
| Max | 688 | 328 | 368 | 3680 | 1000 分钟/月 | hd |

加包：`addon_100` 100 分钟/30 元、`addon_300` 300 分钟/88 元、`addon_500` 500 分钟/138 元，自购买起 12 个月有效。

活动底价：Plus 68、Pro 168、Max 328。年付活动价 680/1680/3280 只能走活动预算，不能与首购折扣叠加。原价必须真实可售，活动价必须标期限。

权益矩阵：

- Free：基础快评。
- Plus：成长档案、CBT + 人本、基础角色池。
- Pro：全部 4 流派、全部角色池、高级报告、优先客服。
- Max：在 Pro 基础上增加数据导出、专属客服、最高文字额度。
- 真人督导不打包；Pro 9 折、Max 8 折，按次付费。
- 并发首版统一 1；Max 预留 2，压测后再开。

---

## 2. 价格与毛利口径

成本按 50 分钟全流程语音：turbo 约 3.5 元、hd 约 5 元；净收入按扣 Apple 30% + 6% 税后的 66% 计算。

| 档位 | 活动价/分钟数 | 成本 | 净收入 | 毛利 |
|---|---:|---:|---:|---:|
| Plus | 68 / 240 | 16.8 | 44.9 | 62.6% |
| Pro | 168 / 500 | 50 | 110.9 | 54.9% |
| Max | 328 / 1000 | 100 | 216.5 | 53.8% |
| 加包 | 30 / 100 | 10 | 19.8 | 49.5% |

Free 30 分钟约 2.1 元/人/月。续费价毛利更高：Plus 约 71%、Pro 约 60%、Max 约 59%。旧 v1.0 的 `99 元/800 分钟` 与 `199 元/2000 分钟` 已确认负毛利，不再售卖。

金额全部使用整数分；数据库、DTO、计算链路不出现浮点金额。

---

## 3. 配额规则

- 套餐分钟按会员周期发放，**不结转**。
- 加包 12 个月有效；活动赠送按活动配置过期。
- 扣减顺序：**当期套餐 → 活动赠送 → 加包 → 迁移存量**；同来源按到期时间先到先扣。
- 每场开始预扣 10 分钟，结束按实际分钟结算；单场实际上限 50 分钟。
- 每日单用户上限 180 分钟。
- 余额不足直接拒绝，不允许负余额；结算超出预扣时继续扣余额，仍不足则记录 `shortfallMinutes`，不把余额扣成负数。
- 年付按 12 个月套餐分钟一次性入账（例如 Plus 年付 2880 分钟），到期时间与年付周期一致；后续如启用按月刷新，只需替换发放调度，不改变账本表结构。

实现位置：`QuotaLedgerService` + `allocateQuota` 纯函数。所有扣减/退回在同一个数据库事务内完成，预扣用 `sessionId` 唯一约束保证幂等。

---

## 4. 活动系统

活动规则允许使用 `flex-rules-engine`，但**只能藏在 `PromotionEnginePort` 后面**。端口只输出：

- 命中的活动 ID、名称、规则版本；
- 折扣金额、活动价；
- 赠品分钟；
- 拒绝原因（非首购、超单用户上限、预算耗尽、低于底价、活动窗口外等）。

端口不写订单、不改配额、不直接算最终应收。价格层级固定为：

```
原价 → 活动价 → 优惠券 → 底价保护
```

最多叠一层折扣 + 一个赠品；底价不可击穿；预算三层（活动总预算、单用户累计优惠上限、每日成本上限）；高价值奖励互斥；退款追回赠品/优惠。

当前版本内置 `DefaultPromotionEngine`，未安装 `flex-rules-engine`。新增依赖属 L4 冻结动作；端口与适配器边界已固定，后续替换实现不影响订单/账本。

---

## 5. 数据模型

`user_memberships` 扩展：

- `tier_v2`（free/plus/pro/max，唯一有效档位）
- `period_start` / `period_end`
- `auto_renew`
- `source`（system/order/promotion/migration）
- `legacy_tier`（旧 3 档镜像审计）
- `last_order_id`
- 旧 `tier`、`status`、`expires_at` 保留兼容写。

新增表：

- `membership_quota_lots`：来源、总额、剩余、到期、订单/活动关联；索引 `(uid, expires_at)`、`source`。
- `membership_quota_reservations`：`session_id` 唯一，保存分配路径 `allocations`、预扣/结算/短缺分钟、状态 `held/settled/released`。
- `membership_orders`：订单类型、周期、原价/折扣/实付/赠送、状态机、支付通道、幂等键、活动/券；唯一 `(uid, idempotency_key)`。
- `membership_promotion_redemptions`：活动兑换审计、折扣、赠送分钟、退款撤销时间；唯一 `(uid, promotion_id, order_id)`。

迁移：`src/migration/1714900000049-AddMembershipV2Tables.ts`，已在 `bin/ormconfig.ts` 与 `src/migration/index.ts` 注册，并在 `mofang_dev` 真实执行通过。

---

## 6. 订单、支付与退款

订单状态：`pending / paid / failed / refunded / closed`。

支付通道：`wechat / alipay / apple_iap / reserved`。真实微信/支付宝/Apple IAP 未接，本期统一 `paymentReserved=true`，订单保持 `pending`，**不伪造支付成功**。`markPaid` 只作为内部验单成功后的入口，控制器不暴露。

订阅状态：`active / grace / paused / expired / refunded`。扣款失败重试 1/3/7 天为后续支付通道接入后的策略；本期只落状态机与 `expireDue`。

退款规则：

- 7 天内未使用全额退；已使用按剩余天数比例、按实付金额退。
- 活动赠品、加包未使用部分收回；已使用部分由退款金额比例覆盖。
- 退款订单若仍是当前生效订单，会员状态回退为 `refunded` 并停止自动续费；历史订单退款不影响当前续费订单。

升级按实付与剩余天数补差，降级下周期生效；年付收入按月确认；价格含税。这些是后续支付/财务任务的范围，本期已把订单金额、周期、活动快照与账本收回路径落好。

---

## 7. API

新统一入口（JWT + PrivacyGuard + L2）：

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/membership/me` | 账号、配额、权益、可售档位/加包、最近订单 |
| GET | `/membership/plans` | 四档 + 三个加包 |
| GET | `/membership/quote` | 原价/活动价/券后价/底价/周期分钟/TTS/规则版本 |
| POST | `/membership/orders` | 创建订单，幂等键命中返回原订单 |
| GET | `/membership/orders` | 最近订单 |
| POST | `/membership/quota/reserve` | 预扣，默认 10 分钟，单场上限 50 |
| POST | `/membership/quota/settle` | 结算，支持退款/补扣/shortfall |
| POST | `/membership/quota/release` | 释放预扣 |

兼容入口保留：

- `GET /profile/membership`：旧 4 态、旧 3 档、5 个权益 + 新 `tierV2 / minutesRemaining / periodEnd`。Max 在旧 3 档字段降级映射为 `pro`。
- `GET /billing/membership`：旧 `membership` DTO + 新 `plans/addons/tier/minutesRemaining/periodStart/periodEnd`，`paymentReserved=true`。
- `GET /billing/products`：3 个付费档 + 3 个加包；旧 4 个单次 SKU 不再返回。
- `POST /billing/orders` / `GET /billing/orders`：走新订单服务，旧单次 SKU 会返回 `MembershipPlanInvalid`。
- `counselor` 配额读写委托新账本；`getMembershipStatus` 返回真实档位，不再写死 `NONE`。

---

## 8. 兼容与迁移

旧数据映射：

- 旧 profile `free/plus/pro` → 新 Free/Plus/Pro；Max 在旧字段降级为 `pro`。
- 旧 billing `none/monthly/quarterly/yearly/lifetime` 保留为兼容状态字段，新逻辑不以它为准。
- 旧 counselor `student/public_welfare` 保留旧数据，后续作为身份折扣标记，不新开独立档位。
- 旧 `quota_usage` 表保留读兼容，不双写；新账本以分钟 lot 为准。

不做破坏性迁移，不删除旧端点、旧表。migration 已验证可在真实 MySQL 执行。

---

## 9. 非目标与后续

本期不包含：

- 真实微信/支付宝/Apple IAP 商户接入与回调验签；
- 自动续费定时扣款；
- 管理后台活动配置页、毛利看板前端；
- Flutter 客户端契约改造；
- 真人督导打包售卖；
- 并发 2 的 Max 正式开放（需压测）。

后续接入支付通道时，只需在验单成功后调用 `MembershipOrderService.markPaid`，并补齐退款金额计算、重试调度、年付收入确认与财务对账；活动后台只通过 `PromotionEnginePort` 输出决策，不直接写订单或配额。
