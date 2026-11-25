# AF-519 · 会员栈迁移号冲突消解与受保护 PR 收口 交付记录

> 交付日期：2026-11-26
> 基线：`integrate` `7fb875ce`
> 分支：`task/AF-519-membership-migration-pr-closure`
> 任务性质：整合重放 + 迁移号消歧 + TypeScript 6 测试修复
> 结论：代码、迁移、测试、本地库台账均已就绪；待推送与 PR 收口

## 一、为什么重签发为 AF-519

AF-518 任务单把 `docs/specs/active/` 与 `docs/team/agent-orchestration/` 写进 executor scope。调度器按 `executor` Agent Card 资源域校验时判定越域（`scope-domain-conflict`），任务停在 `ready`。按 `task rescope` 受审计流程重签发为 AF-519，原 AF-518 闭合为 `canceled` 并保留审计链；本任务目标、基线、实现内容不变。

## 二、改了什么

### 2.1 基线策略

放弃把旧 `task/AF-517` 整分支 merge 进最新 `integrate`。原因：旧分支基于 `f6b47f5c`，直接合并会把 `test/engine-adapters/af302-render-acceptance-checks.spec.ts` 等文件回滚到旧版本，在 TypeScript 6 下引入无关类型失败，并制造大面积状态面冲突。

改为：

1. 任务分支直接重置到最新 `origin/integrate`（`7fb875ce`）。
2. 只从 AF-517 HEAD `636cb70a` 取会员相关最终态文件。
3. 重新登记 AF-519，按任务 scope 提交迁移重排、测试修复、交付记录与回执。

### 2.2 迁移号重排

`integrate` 已占用 `1714900000049/50/51/52/53`（AF-313/314/462）。会员栈原用 49/50/51，撞号导致 PR #249 `mergeable=false`。本任务重排为：

| 原文件 | 新文件 | 类名 / name |
| --- | --- | --- |
| `1714900000049-AddMembershipV2Tables.ts` | `1714900000054-AddMembershipV2Tables.ts` | `AddMembershipV2Tables1714900000054` |
| `1714900000050-AddMembershipPromotionAndPlanGrant.ts` | `1714900000055-AddMembershipPromotionAndPlanGrant.ts` | `AddMembershipPromotionAndPlanGrant1714900000055` |
| `1714900000051-AddMembershipPromotionReservation.ts` | `1714900000056-AddMembershipPromotionReservation.ts` | `AddMembershipPromotionReservation1714900000056` |

同步修改：

- `bin/ormconfig.ts`：新增三条 import 与 migrations 数组项。
- `src/migration/index.ts`：新增三条导出。
- 迁移文件内类名与 `name` 字段。

### 2.3 会员栈文件范围

从 `636cb70a` 取入：

- `src/membership/**`：会员控制器、DTO、实体、guard、module、定价 / 订单 / 账号 / 活动 / 发放 / 预占 / 配额全量。
- `src/billing/**`、`src/counselor/{dto,providers}/billing.*`：旧 SKU 下线兼容接线。
- `src/profile/**` 会员 DTO / entity / service / module。
- `src/common/exceptions/biz-code.enum.ts`、`biz.exception.ts`：`50_011/50_012/50_013`。
- `src/user/enums/audit-event.enum.ts`、`src/shared/infra/metrics/metrics.service.ts`：活动审计与四类指标。
- `test/membership/**` 13 个 spec。
- AF-512/516/517 交付记录与记录包，保留原始证据。

未取入：

- `docs/specs/active/membership-system-v2.0.md`：executor 资源域不含 `docs/specs/active/`，按任务单“不改 spec”处理，spec 同步仍挂 backlog。
- 旧分支对 `src/counselor/config/visitor-*`、`src/counselor/domain/visitor-persona/*` 的非会员改动，避免回滚 integrate 新版本。

### 2.4 TypeScript 6 / Vitest 类型修复

只改测试类型写法，不改断言语义：

- `vi.fn().mockResolvedValue()` 改为 `mockResolvedValue({})`，满足 TS6 参数要求，同时避开 `unicorn/no-useless-undefined`。
- `Record<string, unknown>` 上的 `createQueryBuilder`、`source`、`orderId`、`referenceKey` 改为下标访问。
- 删除 `legacy-sku-deprecated.spec.ts` 未使用的 `vi`、`quota-ledger.service.spec.ts` 未使用的 `MembershipQuotaReservation`。

### 2.5 本地数据库台账

`mofang_dev` 的 `migrations` 表原记录 49/50/51 旧名。已同步更新为 54/55/56 新名与时间戳，避免再次 `migration:run` 重复建表。

## 三、闸门数字（2026-11-26 实测）

| 闸门 | 结果 |
| --- | --- |
| `pnpm typecheck` | exit 0，0 error |
| `pnpm lint` | exit 0，0 error |
| `pnpm build` | exit 0 |
| `pnpm test:smoke` | exit 0，`/health` 200，database / redis up |
| `pnpm vitest run test/membership` | 13 文件 / 69 例全过 |
| `pnpm migration:run` | exit 0，`No migrations are pending` |
| `git diff --stat HEAD -- src/engine-core` | 空 |

未跑全量 `pnpm test`。理由：本任务只重放会员栈并修测试类型，会员定向 69 例已覆盖改动面；全量测试留到 PR 前一次性跑，避免重复消耗。

## 四、与任务单的偏差

| 项 | 任务单 | 实际 | 理由 |
| --- | --- | --- | --- |
| 任务 ID | AF-518 | AF-519 | AF-518 scope 越 executor 资源域，按 `task rescope` 重签发 |
| spec 同步 | 复制 spec | 未取入 | executor 资源域不含 `docs/specs/active/`；spec 同步另开文档任务 |
| 全量测试 | 未强制 | 未跑 | 会员定向已覆盖；全量留到 PR 前一次 |

## 五、遗留

1. 新 PR 尚未创建；#249/#250 仍 open，待新 PR 建立后关闭并标注 supersede。
2. `docs/specs/active/membership-system-v2.0.md` 未进本分支，spec 与实现存在文档漂移。
3. 真实支付、回调验签、自动续费、退款自动金额仍未接，等公司注册后处理。
4. 部分退款比例语义、admin-dashboard 活动管理页、迁移台账 94 vs 90 漂移仍在 backlog。

## 六、commit message

`feat(af519): 会员栈重放到最新 integrate，迁移号重排 54/55/56 并修复 TS6 测试类型`
