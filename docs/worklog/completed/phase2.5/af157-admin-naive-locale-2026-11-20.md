# AF-157 · admin 全局 Naive UI 本地化交付记录

- **taskId**：AF-157
- **日期**：2026-11-20
- **分支**：`task/AF-152-quality-admin`
- **基线**：`603ffce`

## 1. 问题

GateDecisions 中文界面中，角色/原因筛选显示 `Please Select`，日期范围显示 `Start Date` / `End Date`。根因不是页面文案，而是根 `n-config-provider` 未绑定 Naive UI 的 `locale` / `date-locale`，所有组件内部文案回退英文默认。

## 2. 修复

`admin-dashboard/src/App.vue`：

- 引入 `zhCN / dateZhCN / enUS / dateEnUS`。
- 新增响应式 `naiveLocale` / `naiveDateLocale`，按 `locale.value.startsWith('zh')` 选择。
- 根 `n-config-provider` 绑定 `:locale` 与 `:date-locale`。

切换语言即时生效，无需刷新；覆盖下拉占位、日期面板、分页、空状态等所有 Naive UI 内部文案。

## 3. 运行态验证

| 场景 | 结果 |
| --- | --- |
| 中文 `#/gate-decisions` | 角色/原因筛选显示“请选择”，日期范围显示“开始日期 → 结束日期” |
| 切英文 | Naive UI 默认文案切为 `Please Select` / `Start Date` / `End Date` |
| 切回中文 | 立即恢复中文，无需刷新 |

**边界**：本次只修 Naive UI 组件内置文案；各业务页面标题与字段标签的硬编码中文属既有 i18n 覆盖缺口，不在本单扩张。

## 4. 闸门

| 命令 | exitCode | 结果 |
| --- | --- | --- |
| `pnpm lint` | 0 | 0 error / 0 warning |
| `pnpm typecheck` | 0 | 0 error |
| `pnpm --dir admin-dashboard build` | 0 | 含 `vue-tsc`；vite build 2.37s |

## 5. 边界

- 只改 admin 根配置，不改接口、业务数据、评分口径。
- 业务页面自身的中文硬编码仍是技术债，若要做完整双语需单独立项逐页抽 i18n。
