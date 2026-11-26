# 会员体系实现口径 v2.0

状态：active（实现口径补记，2026-11-26）
上位设计：`docs/specs/active/membership-system-v1.0.md`

本文件不替代 v1.0 的产品设计，只把已经落地的工程边界写清楚，避免文档把“规划中的比例退款”误读成“已支持”。

## 一、订单生命周期

- 下单只创建 `pending` 订单，支付通道未接真实网关时落 `reserved`，不得伪造 `paid`。
- `pending` 订单带 `expiresAt`；`MembershipOrderService.closeExpired()` 在行锁内确认仍为 `pending` 且已过期，置 `closed` 并释放活动预算预占。
- 晚到支付回调命中 `closed` 直接拒绝，不允许把已释放的预算重新占用。
- 支付成功只允许从 `pending` 进入 `paid`；重复回调直接返回，不重复发放权益。

## 二、活动预占

- 活动优惠先写 `MembershipPromotionReservation`，状态机为 `held → consumed` 或 `held → released`。
- 订单关闭、取消、超时：`held` 预占释放回活动池。
- 订单支付：预占转 `consumed`，兑换记录写入 `MembershipPromotionRedemption`。
- 全额退款：兑换记录写 `revokedAt`，已消耗 lot 由额度台账收回，预占与 term 一并回收。

## 三、退款边界（当前实现）

| 场景 | 当前行为 |
| --- | --- |
| 订单全额退款 | 允许；订单置 `refunded`，会员回退、term 终止、未使用 lot 收回、兑换撤销、预占释放 |
| 退款金额大于订单金额 | 拒绝 |
| 退款金额小于订单金额（部分退款） | **拒绝**，抛 `MembershipOrderError`，订单与权益不变 |
| 已使用按剩余天数比例退款 | **未实现**，不得对外宣称支持；需要产品与财务先定义按比例回收权益口径 |

部分退款在订单服务层 fail-closed，是为了避免“退部分钱却把订单置终态、收回全部权益”的错误语义。需要部分退款时走人工审批或后续新任务实现比例权益回收，不能复用当前全款路径。

## 四、审计与指标

- 订单支付成功：`incMembershipOrderPaid(planId, billingPeriod, orderType)`。
- 全额退款成功：`incMembershipOrderRefunded(planId, billingPeriod, orderType)`。
- 过期关闭：日志记录关闭行数；预占释放走同一事务。
- 会员日志只记录 uid、orderId、金额、状态与定位信息；心理内容、对话原文、量表答案不得进入会员日志或指标标签。

## 五、接口

- 用户侧：`POST /membership/orders`、`POST /membership/orders/:id/refund`、`POST /membership/quota/reserve`、`POST /membership/quota/release`。
- 管理侧：`admin/membership/promotions` 提供 list/create/get/update/activate/pause/delete/stats。
- 后台页面：`admin-dashboard` 会员活动页只读列表 + 启停 + 统计，不直接改订单状态。

## 六、未决

- 部分退款的按比例权益回收、审批流、真实支付网关退款仍未实现。
- 自动续费、回调验签、退款自动金额依赖外部商户资质，不在本文件承诺范围内。
