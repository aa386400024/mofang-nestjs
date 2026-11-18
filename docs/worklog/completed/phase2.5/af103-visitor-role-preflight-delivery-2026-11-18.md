# AF-103 交付记录 · 批次入队前来访者角色存在性校验

- 日期：2026-11-18
- 任务单：`docs/worklog/pending/af103-visitor-role-preflight-task-2026-11-18.md`
- 分支：`task/AF-103-visitor-role-preflight`
- 基线：`9acd6d1fba8d0d05fc04178479a213947dcd6d34`
- 结论：通过（入口前置校验落地，定向闸门全绿，engine-core 零 diff）

## 1. 问题与修复

### 问题

批量入队与单场启动都只校验 slug 非空，不校验角色是否真实可解析。角色缺失时任务仍进入 BullMQ，直到 runner 内才以「角色不存在」失败，留下半批任务、半截场次与不可用的质量证据。

### 修复

- `AutoPracticeController` 注入 `CHARACTER_PROFILE_RESOLVER`（与角色池同一真相源，口径为「已审核 + 已上架」）。
- 新增 `validateCharacterSlugs`：去重后逐条解析，缺失角色一次性全部列出并整体拒绝。
- `POST /admin/api/auto-practice/batch` 与 `POST /admin/api/auto-practice/sessions` 同口径前置校验。
- `AutoPracticeModule` 显式 import `CharacterPoolModule`，不复制第二套角色存在性判断。
- 新增 `test/auto-practice/visitor-role-preflight.spec.ts`，覆盖合法、全缺失、部分缺失、单场缺失四条路径；同步修正 `crisis-metrics-persist.spec.ts` 的控制器构造参数。

## 2. 闸门证据

| 闸门 | 命令 | 退出码 | 结果 |
| --- | --- | --- | --- |
| 定向单测 | `corepack pnpm exec vitest run test/auto-practice/visitor-role-preflight.spec.ts test/auto-practice/crisis-metrics-persist.spec.ts` | 0 | 2 files / 10 tests passed，1.92s |
| 类型检查 | `corepack pnpm exec tsc --noEmit -p tsconfig.json` | 0 | 0 error |
| 定向 lint | `corepack pnpm exec eslint src/auto-practice/auto-practice.controller.ts src/auto-practice/auto-practice.module.ts test/auto-practice/visitor-role-preflight.spec.ts test/auto-practice/crisis-metrics-persist.spec.ts` | 0 | 0 error / 0 warning |
| 边界 | `git diff --stat HEAD -- src/engine-core` | 0 | 输出为空，零 diff |

> 机器状态：本机 Windows / Node v22；执行期间未启动 `nest start --watch` 或 `vite dev`。单测墙钟 1.92 s 为定向小样本，不代表全量。

## 3. 范围与隔离

- 改动文件：`src/auto-practice/auto-practice.controller.ts`、`src/auto-practice/auto-practice.module.ts`、`test/auto-practice/visitor-role-preflight.spec.ts`、`test/auto-practice/crisis-metrics-persist.spec.ts`。
- 未改 `src/engine-core`；未改角色内容、标定表、批次数据或 `phase2.5-README.md`。
- 未混入并行进程产物；`docs/worklog/pending/af094-*` 与 `archive/AF-095-*` 保持原状，不纳入本提交。

## 4. 偏差与遗留

- 偏差：无。
- 新增遗留：无。
- 说明：角色覆盖扩充与 `<think>` 泄漏属 AF-104 登记的 OI-01 / OI-02，不在本单顺手清理，另单处理。
