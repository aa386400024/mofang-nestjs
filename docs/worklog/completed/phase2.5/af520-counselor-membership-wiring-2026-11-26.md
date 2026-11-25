# AF-520 · CounselorModule 接入 MembershipModule 交付记录

> 日期：2026-11-26
> 基线：`81cb57f2`（AF-519 PR 分支 HEAD）
> 任务单：`docs/worklog/records/phase2.5-membership-v2/AF-520/task-sheet.md`

## 1. 问题

PR #251 的 E2E 在 `test/e2e/v2-user-flow.spec.ts` 启动 Nest 测试模块时失败：

```
Nest can't resolve dependencies of the BillingService (?, QuotaLedgerService).
Please make sure that the argument MembershipAccountService at index [0] is available in the CounselorModule module.
```

`BillingService` 由 `CounselorModule` 提供，会员栈重放后其构造依赖已变为 `MembershipAccountService + QuotaLedgerService`，但 `CounselorModule` 没有导入 `MembershipModule`。`BillingModule` 已导入 `MembershipModule`，所以直接走 `BillingModule` 的路径不受影响；E2E 从 `AppModule → CounselorModule` 装配时暴露。

## 2. 改动

只改 `src/counselor/counselor.module.ts`：

- 新增 `import { MembershipModule } from '../membership/membership.module.js';`
- `imports` 数组在 `UserModule`、`AuthModule` 后加入 `MembershipModule`

未改 `BillingService` 业务逻辑，未改会员定价、配额、订单规则，未带入旧分支的 visitor 改动。

## 3. 验证

| 闸门 | 结果 |
| --- | --- |
| `pnpm typecheck` | exit 0，0 error |
| `pnpm lint` | exit 0，0 error |
| `pnpm build` | exit 0 |
| `pnpm test:smoke` | exit 0；`/health` 200，database / redis up |

`test:smoke` 会加载完整 `AppModule`，`CounselorModule` 与 `BillingService` 在启动阶段完成依赖装配；本次修复后启动通过。`test/e2e/v2-user-flow.spec.ts` 由 CI E2E 复查。

## 4. 偏差与遗留

- 无任务单偏差。
- 该修复不覆盖真实支付、回调验签、自动续费与退款金额语义，仍按原计划等公司注册后接。
- E2E 本地未单独跑，避免在 `mofang_dev` 写入测试用户；由 PR #251 的 E2E 作业验证。
