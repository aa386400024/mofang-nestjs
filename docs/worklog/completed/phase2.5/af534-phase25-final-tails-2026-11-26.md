# AF-534 Phase2.5 收尾：调试落盘等待、会员退款边界、会员 spec 与后台活动页

## 结论

四项遗留一次性收口，全部闸门通过：调试关闭等待持久化落盘；会员部分退款 fail-closed；新增会员实现口径 spec；管理后台新增会员活动页（列表/新建/编辑/启停/删除/效果统计）。`src/engine-core` 零改动。

任务单原为 AF-533，因 `docs/specs/` 不在 executor 资源域触发 `scope-domain-conflict`，经 `task reissue` 重签发为 AF-534，原任务 `canceled` 归档，`priorTasks: [AF-533]`。AF-531 的调试改动经 cherry-pick 并入本任务，其遗留交付记录已删除，避免张冠李戴。

## 改动清单

### 1. 调试会话关闭等待落盘

- `src/admin-debug/debug-session.service.ts`：`closeSession` 由同步 `void` 改为 `async Promise<void>`，返回前 `await this.store.markCompleted(...)`；落盘失败仅 `logger.warn`，不阻断关闭。
- `src/admin-debug/debug-session.controller.ts`：`DELETE session/:id` 改 `async` 并 `await service.closeSession`，HTTP 响应不再先于持久化完成。
- `src/auto-practice/adapters/debug-turn-engine.adapter.ts`：`TurnEnginePort.close` 契约仍为同步 `void`，改为 `void this.debugSession.closeSession(...).catch(...)` 吃掉异常，不改端口契约。
- 测试：`test/admin-debug/debug-session-persistence.spec.ts`、`wp58-debug-session.spec.ts`、`wp69-debug-panel-improvements.spec.ts` 全部调用点补 `await`；不存在会话断言改 `rejects.toThrow`。

### 2. 会员部分退款 fail-closed

- `src/membership/providers/membership-order.service.ts` `refund()`：注释明确“仅支持全额退款”；在超额检查后新增 `refundAmountCents < locked.amountCents` 直接抛 `MembershipOrderError('部分退款暂不支持：请按订单全额退款或走人工审批')`，发生在任何写操作之前。
- `test/membership/membership-order.service.spec.ts`：新增“部分退款直接拒绝：订单与权益不变化”，断言订单仍 `Paid`，且 `orderRepo.save` / `markOrderRefunded` / `cancelTermForOrder` / `reservationService.release` 均未调用。
- 全款退款路径与既有语义不变。

### 3. 会员系统 spec 同步

- 实际 active 产品 spec 为 `docs/specs/active/membership-system-v1.0.md`；为不改写 v1.0 产品设计，新增 `docs/specs/active/membership-system-v2.0.md` 作为实现口径补记：订单生命周期（pending/expiresAt/closeExpired/closed 回调拒绝）、活动预占 `held → consumed/released`、退款边界表（全额允许、超额拒绝、部分退款拒绝、按比例退款未实现）、审计指标 `incMembershipOrderPaid` / `incMembershipOrderRefunded`、接口清单与未决项。
- v1.0 未改动。

### 4. 管理后台会员活动页

- 新增 `admin-dashboard/src/api/membership-promotion.ts`：活动类型、写入体、`list/get/create/update/activate/pause/remove/stats`，复用 `client.ts` 导出的 `http`（同一 Basic Auth + 401 重试 + 错误语义）。
- `admin-dashboard/src/api/client.ts`：导出 `http` 供按域 API 模块复用，不改既有端点。
- 新增 `admin-dashboard/src/views/MembershipPromotions.vue`：状态/周期筛选、分页、卡片列表、新建/编辑弹窗（价格以“元”录入并按分提交、底价、赠送分钟、预算、单用户限次、优先级、autoApply）、启用/暂停/删除、效果统计弹窗。
- `admin-dashboard/src/router/index.ts` 注册 `/membership/promotions`；`App.vue` 菜单与全局搜索入口；`i18n/locales/zh-CN.ts`、`en.ts` 补 `nav.membershipPromotions`。
- 后端 promotions 接口、数据库结构未改。

### 5. 编排资源域

- `docs/team/agent-orchestration/agent-cards/executor.json` resources 增加 `docs/specs/`，仅用于本任务及后续明确授权的 spec 同步。

## 关键设计决策

- **不扩 `TurnEnginePort`**：调试落盘等待只在 `DebugSessionService` 与 controller 层闭环；端口仍是同步 `void`，避免为一个适配器把异步语义扩散到内核契约。
- **部分退款直接拒绝而非按比例折算**：当前权益撤销、预占释放、审计都以整单为单位，按比例会产生“退了钱但权益按整单撤销”的错账；先 fail-closed，把按比例退款留给审批流与后续任务。
- **spec 用新增 v2.0 而非改 v1.0**：v1.0 是产品设计真相源，v2.0 只记录已实现口径与未实现边界，避免把“计划”写成“已交付”。
- **后台价格单位在 UI 层换算**：服务端契约是“分”，表单按“元”输入并 `Math.round(yuan * 100)`，减少运营输错量级。

## 闸门数字

| 闸门 | 结果 |
| --- | --- |
| `pnpm lint` | exit 0，0 error |
| `pnpm typecheck` | exit 0，0 error |
| `pnpm test` | 352 passed / 1 skipped（353 文件）；5046 passed / 4 skipped（5050 例） |
| `pnpm exec vitest run test/membership/membership-order.service.spec.ts` | 8 例通过（含部分退款用例） |
| 调试三文件目标测试 | 70 例通过 |
| `pnpm --dir admin-dashboard type-check` | exit 0，vue-tsc 0 error |
| `pnpm --dir admin-dashboard build-only` | exit 0，vite build 成功（7.47s） |
| `git diff --stat HEAD -- src/engine-core` | 输出为空 |

## 遗留与边界

- 按比例退款、退款审批流、真实支付网关退款未实现；当前只支持整单全额退款或人工处理。
- 活动页只接已有 promotions 接口；预算耗尽的自动停用、活动效果导出、按渠道归因不在本任务。
- 调试落盘失败只告警不重试；若 MySQL 持续不可用，关闭请求仍成功但会话可能停留在未完成状态，需要后续补对账任务。
