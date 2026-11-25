# AF-516 · 会员 v2 非支付闭环交付记录

> 任务单：`docs/worklog/records/phase2.5-membership-v2/AF-516/task-sheet.md`
> 分支：`task/AF-516-membership-nonpayment-closure`
> 基线：`7fb57be8`（stacked 在尚未合并的 AF-512 上）
> 完成日期：2026-11-25
> 真实支付：按用户拍板“等注册公司再弄”继续挂起，本轮不接商户、不验签、不自动扣款。

---

## 一、交付结论

支付以外的会员遗留已闭环，金额、订单、配额仍由后端计算：

- 活动从写死常量升级为可运营活动主数据：新增 `membership_promotions` 表与运营 API，支持活动码、周期、受众、自动命中、时间窗、分档价格/底价/赠分钟、预算、单用户限次、优先级、启停。
- 报价走动态活动快照：`GET /membership/quote` 的价格、赠分钟、活动 id、规则版本来自 DB；活动码、首购、时间窗、单用户限次、活动预算、底价全部生效；预算耗尽或超限自动回落续费价。
- 年付改为“首月立即发 + 后续按月补发”：新增 `membership_plan_grant_terms` 与 cron，quota lot 用 `reference_key=plan:N` 保证同一订单多次发放幂等；升档/换档会停旧 term。
- 旧 `counselor` 单次 SKU 明确下线：列表保留结构并带 `deprecated=true` / 下线文案，下单直接返回 `MembershipSkuDeprecated`（HTTP 410），不再伪造 pending。
- 迁移在本地 `mofang_dev` 执行成功；应用启动 smoke 通过，实体映射与真实表结构一致。

---

## 二、文件清单

### 新增

- `src/membership/entities/membership-promotion.entity.ts`
- `src/membership/entities/membership-plan-grant-term.entity.ts`
- `src/membership/providers/promotion/flex-rule.evaluator.ts`
- `src/membership/providers/promotion/flex-rules-promotion.engine.ts`
- `src/membership/providers/membership-promotion.service.ts`
- `src/membership/providers/membership-plan-grant.service.ts`
- `src/membership/providers/membership-quota-refresh.cron.ts`
- `src/membership/dto/membership-promotion.dto.ts`
- `src/membership/guards/membership-admin.guard.ts`
- `src/membership/controllers/membership-admin.controller.ts`
- `src/migration/1714900000050-AddMembershipPromotionAndPlanGrant.ts`
- `test/membership/dynamic-promotion.engine.spec.ts`
- `test/membership/membership-promotion.service.spec.ts`
- `test/membership/membership-plan-grant.service.spec.ts`
- `test/membership/legacy-sku-deprecated.spec.ts`
- `docs/worklog/completed/phase2.5/af516-membership-nonpayment-closure-implementation-2026-11-25.md`（本文件）

### 修改

- `src/membership/domain/membership.enums.ts`：新增活动状态/受众/term 状态枚举
- `src/membership/domain/membership.types.ts`：报价输入增加活动快照、按活动兑换计数、按活动预算
- `src/membership/domain/membership.utils.ts`：`addMonths` 改为月末 clamp，修复 1 月 31 日 +1 月跳到 3 月
- `src/membership/membership.constants.ts`：活动定义扩展，静态活动保留为测试/无 DB 兜底
- `src/membership/entities/membership-quota-lot.entity.ts`：新增 `reference_key` 与订单+子键索引
- `src/membership/providers/quota-ledger.service.ts`：`grantPlan` 支持 `referenceKey`，幂等查询按订单+子键
- `src/membership/providers/membership-account.service.ts`：年付首月只发一个月并登记 term；总览/账号读取前即时补发；换档停旧 term
- `src/membership/providers/membership-order.service.ts`：报价注入活动快照、按活动兑换计数、按活动预算
- `src/membership/providers/membership-pricing.service.ts`：透传新活动字段
- `src/membership/membership.module.ts`：注册新实体/服务/控制器/守卫/中间件/cron，生产 `PROMOTION_ENGINE` 切到动态引擎，挂 `AdminBasicAuthMiddleware`
- `src/common/exceptions/biz-code.enum.ts`：新增 `MembershipSkuDeprecated=50009`、`MembershipPromotionNotFound=50010`
- `src/common/exceptions/biz.exception.ts`：活动不存在归 404，旧 SKU 归 410，补默认文案
- `src/counselor/providers/billing.service.ts`：旧 SKU 标记 deprecated，下单直接 410
- `src/counselor/dto/billing.dto.ts`：`SkuListItemDto` 增加 `deprecated` / `deprecationMessage`
- `bin/ormconfig.ts`：注册 `AddMembershipPromotionAndPlanGrant1714900000050`
- `src/migration/index.ts`：导出新迁移
- `test/membership/membership-account.service.spec.ts`：补年付首月、换档停 term
- `test/membership/quota-ledger.service.spec.ts`：mock 支持 `referenceKey` 幂等查询
- `docs/worklog/pending/phase4-backlog-2026-11-08.md`：回写 AF-516 已闭环非支付遗留

---

## 三、关键设计决策与与任务单偏差

| 项 | 决策 | 与任务单关系 |
|---|---|---|
| 动态规则实现 | 未引入 `flex-rules-engine` npm 包；用同 DSL 的内置纯函数求值器 + `FlexRulesPromotionEngine`，仍包在 `PromotionEnginePort` 后 | 任务单已预判官方包与 Nest 12 / Mongoose 不兼容；无新增依赖 |
| 金额真相源 | 规则只做结构匹配；价格、底价、预算、单用户限次由服务层在落单前二次校验 | 与任务单“金额仍由后端计算”一致 |
| 活动预算为 `null` | 表示不限额；运营 API 允许该值 | 任务单未禁止；若后续要求所有活动必须设预算，另开运营口径任务 |
| 年付首月 | 支付成功只发 `plan.monthlyMinutes`，expiry 为 `addMonths(periodStart,1)`，并登记 term | 替代 AF-512 的一次性 12 个月发放 |
| 年付降级兜底 | 若 `MembershipPlanGrantService` 未装配（仅旧单测/降级场景），退回一次性 12 个月，避免静默少发 | 生产 Module 已装配，不走兜底 |
| 旧 SKU 列表 | 保留 4 条结构 + `deprecated` 文案，不直接清空 | 任务单要求“保留列表兼容结构供旧客户端显示下线提示” |
| 运营 API 鉴权 | 复用 `/admin/api` 的 `AdminBasicAuthMiddleware`；守卫查 DB `admin_role`，DB 异常 fail-close | 任务单要求运营 API 不被普通学员调用 |
| `spec` 更新 | 未改 `docs/specs/active/membership-system-v2.0.md` | 该文件不在 AF-516 scope；本轮以交付记录承载变更，后续 spec 同步需另开任务 |
| `admin-dashboard` | 未改前端 | 任务单明确不改 `admin-dashboard/**`；运营 API 已可供前端接入 |

---

## 四、闸门与证据

执行环境：`DESKTOP-E3EVQ9P` / Windows / PowerShell 7.6.4 / node `v22.23.2` / pnpm `9.15.0`。

| 闸门 | 命令 | 结果 |
|---|---|---|
| Lint | `pnpm lint` | exit 0；`{src,test,bin}` 与 `scripts` 两段均通过 |
| 类型 | `pnpm typecheck` | exit 0 |
| 会员定向测试 | `pnpm vitest run test/membership` | 11 个文件 / 58 用例全过 |
| 全量测试（CI 口径） | `$env:ORCH_FRAMEWORK_DIR=<repo>/contracts/agent-collaboration-framework/2.0.0; pnpm test` | 293 passed / 1 skipped 文件；4449 passed / 4 skipped / 0 failed；墙钟 29.98s |
| 构建 | `pnpm build` | exit 0 |
| 启动 smoke | `pnpm test:smoke` | `/health` 200；database up（40ms）、redis up |
| Migration | `pnpm migration:run` | `AddMembershipPromotionAndPlanGrant1714900000050` 执行成功 |
| 内核边界 | `git diff --stat HEAD -- src/engine-core` | 空 |

**全量测试的环境说明**：兄弟仓 `D:\work\Project\agent-collaboration-framework` 为 `2.1.0`，本仓固化契约包为 `2.0.0`；默认 `pnpm test` 会因既有契约版本对账用例失败。按 CI 口径把 `ORCH_FRAMEWORK_DIR` 指向仓内 `2.0.0` 后全量 0 failed。该漂移不属于 AF-516，需单独框架升级任务。

---

## 五、真实数据库迁移证据

`pnpm migration:run` 输出关键 DDL：

- `ALTER TABLE membership_quota_lots ADD reference_key VARCHAR(64) NULL + INDEX idx_mql_order_ref(order_id, reference_key)`
- `CREATE TABLE membership_promotions`（唯一 `code`、`(status,billing_period,starts_at,ends_at)` 索引、JSON 价格/底价/赠分钟、预算、单用户限次、优先级）
- `CREATE TABLE membership_plan_grant_terms`（唯一 `order_id`、`(status,next_grant_at)` 索引）
- 播种 `FIRST_MONTHLY` / `FIRST_ANNUAL` 两条 active 活动，价格、底价、预算、时间窗与静态常量一致

迁移执行后 `pnpm test:smoke` 启动正常，说明实体映射与真实表结构一致。

---

## 六、已知风险与后续

1. **真实支付仍未接**：微信/支付宝/Apple IAP 商户、回调验签、自动续费重试、退款自动算金额继续挂起；本轮不产生真实扣款。
2. **运营前端未接**：`admin-dashboard` 未改，活动 API 已就绪但暂无管理页面。
3. **年付边界未做真实支付端到端**：同档续费顺延、升档立即重开、退款收回已按代码与单测覆盖；真实回调并发下的订单行锁仍应在接支付时补。
4. **cron 批量上限**：`refreshDue` 每轮最多取 500 条到期 term，当前规模足够；若年付用户量级上来需加分页/游标。
5. **规则 DSL 范围**：当前内置求值器只覆盖活动结构匹配所需算子；若运营要复杂组合规则，再评估独立规则服务或兼容包。
6. **活动预算不限额**：`budgetCents=null` 允许不限额；若财务要求所有活动必须设预算，需要运营口径确认后在 DTO/服务层收紧。
7. **spec 未同步**：`membership-system-v2.0.md` 不在本任务 scope，年付按月与活动运营口径目前落在本交付记录与代码；后续需单独任务同步 spec。

---

## 七、机读回执字段对齐

| 字段 | 对应内容 |
|---|---|
| `gateResults` | 本文件 §四 的 8 行命令、退出码与数字 |
| `scopeCheck` | `in-scope`；实现、测试、迁移、交付记录与 backlog 均在 AF-516 scope 内；编排状态面由 CLI 生成 |
| `contractChecks` | taskId / state-write / receipt-groups / engine-boundary / migration-registered / legacy-contract 六项均 pass |
| `backlogItems` | 本文件 §六 的 7 项与回执 `backlogItems` 对应 |
| `deviationTable` | 本文件 §三 表 |
| `reviewVerdict` | `passed`；理由见回执 `verdictRationale` |

---

## 八、提交信息

`feat(af516): 会员活动运营与年付按月发放闭环`
