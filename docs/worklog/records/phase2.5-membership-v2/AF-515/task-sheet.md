---
taskId: AF-515
contextId: phase2.5-membership-v2
title: 会员 v2 非支付闭环：活动规则引擎与运营 API、年付按月刷新、旧 SKU 下线
type: implementation
status: backlog
baselineRef: 7fb57be8
dependsOn: []
scope:
  files:
    - src/membership/**
    - src/counselor/providers/billing.service.ts
    - src/counselor/dto/billing.dto.ts
    - src/common/exceptions/biz-code.enum.ts
    - src/common/exceptions/biz.exception.ts
    - src/migration/1714900000050-AddMembershipPromotionAndPlanGrant.ts
    - bin/ormconfig.ts
    - src/migration/index.ts
    - test/membership/**
    - docs/specs/active/membership-system-v2.0.md
    - docs/worklog/completed/phase2.5/af515-membership-nonpayment-closure-implementation-2026-11-25.md
    - docs/worklog/pending/af515-membership-nonpayment-closure-task-2026-11-25.md
    - docs/worklog/records/phase2.5-membership-v2/AF-515/**
    - docs/worklog/pending/phase4-backlog-2026-11-08.md
  modules:
    - membership
    - counselor
  interfaces:
    - /membership/**
    - /admin/membership/**
    - /counselor/billing/skus
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs:
  - conventions.md#1.1
  - conventions.md#1.3
  - conventions.md#三
createdAt: 2026-11-25T23:58:00+08:00
agentRole: executor
---

# AF-515 · 会员 v2 非支付闭环

> 状态：📋 待执行（2026-11-25）
> 执行方：自做（MainAgent）
> 仓库：`D:\work\Project\backend\mofang-nestjs-af070`，基线 `7fb57be8`（stacked 在未合并的 AF-512 上）
> 任务性质：商业化基础设施补齐；真实支付/自动扣款/退款自动算金额继续挂起

---

## 1. 背景

AF-512 已落地会员 v2 四档、分钟加包、配额账本与订单状态机。真实支付按用户拍板等注册公司后再做，本轮只闭环支付以外的遗留：

1. 活动规则仍写死在 `MEMBERSHIP_CAMPAIGNS`，运营无法增删改，预算与兑换统计分散在订单服务。
2. 年付在支付成功时一次性发 12 个月套餐分钟，不符合“按月刷新、不结转”的拍板口径。
3. `counselor/billing/skus` 仍展示 4 个旧单次 SKU，旧入口下单只返回 pending，形成事实上的半下线。
4. `flex-rules-engine` 端口已存在，但未形成可运营的动态规则能力。

---

## 2. 范围

**在范围内：**

- 新增会员活动实体、迁移、活动目录/统计服务、运营管理 API（后端接口，不改 `admin-dashboard` 前端）。
- 活动规则以 `flex-rules-engine` 兼容的规则 DSL 表达，统一包在 `PromotionEnginePort` 后；价格、底价、预算、单用户限次仍由后端校验。
- 年付改为“首月立即发 + 后续按月调度”，新增套餐发放 term 表与 cron；月度发放幂等、可补发、退款可收回该订单未使用 lot。
- 旧 `counselor` SKU 标记 deprecated 并拒绝下单，返回明确业务码；保留列表兼容结构供旧客户端显示下线提示。
- 迁移注册、单测、交付记录、回执、归档、backlog 回写。

**明确不在范围内：**

- 不接微信/支付宝/Apple IAP 真实商户、不做支付回调验签、不自动扣款、不伪造 `paid`。
- 不改 Flutter；不改 `admin-dashboard/**`；不改 `engine-core/**`。
- 不做 `student/public_welfare` 权益口径（用户未拍板）。
- 不做框架契约版本升级（兄弟仓 2.1.0 漂移另单处理）。
- 不引入新的第三方 npm 包；`flex-rules-engine` 官方包依赖 Nest 10 / Mongoose 且根导出强依赖 `@nestjs/mongoose`，与当前 Nest 12 / Express 5 不兼容，本轮用同 DSL 的内置纯函数引擎落地，端口契约不变。

---

## 3. 验收标准

1. `GET /admin/membership/promotions` 可列出活动；`POST/PATCH/DELETE` 可管理；支持启用/暂停；返回预算使用、兑换次数、剩余预算。
2. `GET /membership/quote` 的活动价、赠分钟、活动 id、规则版本来自 DB 活动；活动码、首购、时间窗、单用户限次、预算、底价全部生效。
3. 同一用户同一活动最多兑换 `perUserLimit` 次；预算耗尽回落到续费价，不返回可发折扣。
4. 年付支付成功后只发首月套餐分钟；cron 按月补发，重复执行不叠加；退款收回该订单所有未使用套餐 lot。
5. 旧 `GET /counselor/billing/skus` 返回的每一项带 `deprecated=true` 与下线文案；`POST /counselor/billing/orders` 返回 `MembershipSkuDeprecated`，不再返回伪 pending。
6. `pnpm lint`、`pnpm typecheck`、`pnpm test` 全绿；`git diff --stat HEAD -- src/engine-core` 为空。
7. 迁移已在本地 `mofang_dev` 执行成功；`/health` 200。
8. 交付记录含 `gateResults / scopeCheck / contractChecks / backlogItems / deviationTable / reviewVerdict` 六组机读字段；回执 `reviewVerdict=passed`。

---

## 4. 关键设计

- 活动表 `membership_promotions`：状态、周期、受众、自动命中、时间窗、分档价格/底价/赠分钟、预算、单用户限次、优先级、规则版本。
- 活动规则由 `FlexRulesPromotionEngine` 读取 DB 活动快照，按 `PromotionEnginePort` 同步求值；规则只做结构匹配，金额/预算/限次由服务层兜底。
- 订单服务每次报价查询活动快照 + 该用户兑换计数 + 活动已用预算，避免缓存不一致。
- 年付 term 表 `membership_plan_grant_terms`：一单一年付 term，记录 `termStart/termEnd/nextGrantAt/monthsGranted`；cron 每 10 分钟补发，`quota lot` 用 `reference_key=plan:N` 幂等。
- 旧 SKU 不删除 DTO 字段，只加 `deprecated` / `deprecationMessage`，下单直接拒绝。

---

## 5. 交付物

- 代码与迁移：`src/membership/**`、`src/counselor/**`、`src/common/exceptions/**`、`src/migration/**`、`bin/ormconfig.ts`。
- 测试：`test/membership/**`。
- 文档：spec 更新、交付记录、backlog 回写。
- 回执：`docs/team/agent-orchestration/transport/receipts/AF-515.json`（gitignored），durable 副本进任务记录包。

---

## 6. 命令

```powershell
pnpm lint
pnpm typecheck
pnpm vitest run test/membership
$env:ORCH_FRAMEWORK_DIR='D:/work/Project/backend/mofang-nestjs-af070/contracts/agent-collaboration-framework/2.0.0'; pnpm test
pnpm migration:run
pnpm test:smoke
git diff --stat HEAD -- src/engine-core
```

