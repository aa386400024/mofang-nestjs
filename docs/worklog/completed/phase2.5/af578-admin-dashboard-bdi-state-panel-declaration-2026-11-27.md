# AF-578 · 同步 admin-dashboard BdiStatePanel 组件声明（交付记录）

- 任务：AF-578
- 类型：fix（前端生成声明同步）
- 角色：executor
- 分支：`task/AF-578-admin-bdi-state-panel-declaration`
- 实现提交：`7eef8394341cf8b9f708efc03046faea46a24870`
- 日期：2026-11-27

## 背景

`admin-dashboard/components.d.ts` 由 `unplugin-vue-components` 生成，用于 Vue 组件自动导入的类型声明。工作树中残留一行未提交增量：补上 `BdiStatePanel`。对应源组件 `admin-dashboard/src/components/BdiStatePanel.vue` 已在仓库跟踪，声明文件长期缺失该条目，属于历史生成物漏提交，不是临时垃圾，也不能直接回退。

该文件位于 `admin-dashboard/` 前端管理域。本任务以 `executor` 角色承接，范围只放开生成声明文件，不改任何 Vue/TS 源码，也不混入后端文档或脚本任务。

## 改动内容

仅修改 `admin-dashboard/components.d.ts`：

```diff
+    BdiStatePanel: typeof import('./src/components/BdiStatePanel.vue')['default']
```

`git diff --stat HEAD~1..HEAD`：1 file changed，1 insertion(+)。未修改 `admin-dashboard/src/`、路由、接口、样式或任何后端代码。

## 闸门结果

| 闸门 | 命令 | 结果 |
| --- | --- | --- |
| 前端类型检查 | `pnpm --dir admin-dashboard type-check` | exit 0，`vue-tsc --build` 通过 |
| 前端构建 | `pnpm --dir admin-dashboard build-only` | exit 0，4724 modules transformed，10.92s |
| 生成物稳定性 | 构建后 `git diff -- admin-dashboard/components.d.ts` | 仍只有 `BdiStatePanel` 一行，无额外声明漂移 |
| 后端 lint | `pnpm lint` | exit 0，0 error |
| 后端 typecheck | `pnpm typecheck` | exit 0，0 error |
| engine-core 边界 | `git diff --stat HEAD -- src/engine-core` | 输出为空 |

## 边界与偏差

- 无偏差：任务单要求只同步生成声明，实际改动严格限定在 `admin-dashboard/components.d.ts`。
- 未改任何 `.vue` 源组件，未改后端 `src/`、`test/`、`bin/`、`scripts/`。
- 该文件由构建插件生成，不手工编造声明；`BdiStatePanel.vue` 的存在与声明行一一对应。

## 结论

`admin-dashboard` 工作树最后一处已跟踪生成声明脏点已收口。`BdiStatePanel` 的自动导入类型声明与真实组件同步入库，前端 type-check/build 与后端 lint/typecheck 全部通过，`engine-core` 保持零 diff。
