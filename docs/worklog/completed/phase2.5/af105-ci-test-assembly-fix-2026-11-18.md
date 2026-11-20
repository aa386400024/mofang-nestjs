# AF-105 交付记录：修复 AF-103 引入的批次入口测试装配回归

- 任务单：`docs/worklog/pending/af105-ci-test-assembly-fix-task-2026-11-18.md`
- 基线：`529ab0f3cad5eff8f8ba0894250a2e100eb5a942`
- 类型：fix（测试装配）
- 提交：`c0f75aa`（`fix(test): AF-105 补齐批次入口测试的角色解析器依赖`）
- 快照：2026-11-18 22:35 CST

## 1. 问题

AF-103 给 `AutoPracticeController` 注入 `CHARACTER_PROFILE_RESOLVER` 后，
`test/auto-practice/batch-scenario-type.spec.ts` 仍按旧的 6 个 provider 装配 Nest 测试模块。
`beforeEach` 解析依赖失败，`app` 未创建；`afterEach` 执行 `app.close()` 抛出
`TypeError: Cannot read properties of undefined (reading 'close')`。
远端 Unit shard 1/2/3 同时命中该文件，Coverage shard 3 因单测未完成退出失败。

## 2. 修复

只改测试装配，不改生产代码：

- 引入 `CHARACTER_PROFILE_RESOLVER` token；
- 在该测试模块增加恒可解析的替身 provider（`resolve` 返回固定 `displayName`）；
- 角色缺失拒绝路径不在本文件重复，仍由 `visitor-role-preflight.spec.ts` 覆盖。

## 3. 闸门

| 闸门 | 命令 | 结果 |
| --- | --- | --- |
| 定向单测 | `corepack pnpm exec vitest run test/auto-practice/batch-scenario-type.spec.ts` | exit 0，10/10 通过，2.02s |
| 类型检查 | `corepack pnpm exec tsc --noEmit -p tsconfig.json` | exit 0，0 error |
| 定向 lint | `corepack pnpm exec eslint test/auto-practice/batch-scenario-type.spec.ts` | exit 0，0 error / 0 warning |
| 边界 | `git diff --stat HEAD -- src/engine-core` | 空输出，engine-core 零 diff |

机器状态：无 `nest start --watch` / `vite dev` 常驻；上述墙钟为本机实跑。

## 4. Scope

- 修改：`test/auto-practice/batch-scenario-type.spec.ts`
- 未改：`src/**`、`engine-core`、迁移、种子、运行态数据
- 并行产物：`af094-*` 任务单与 `AF-095` 回执仍为未跟踪文件，未纳入本提交

## 5. 结论

测试装配回归已消除，`batch-scenario-type.spec.ts` 10/10 通过；本修复不改变生产行为。
