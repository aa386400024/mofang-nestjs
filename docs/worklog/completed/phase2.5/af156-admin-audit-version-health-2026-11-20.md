# AF-156 · admin 审计口径修正交付记录

- **taskId**：AF-156
- **日期**：2026-11-20
- **分支**：`task/AF-152-quality-admin`
- **基线**：`c72f4d2`
- **性质**：AF-155 运行时冒烟发现的“展示看似正常、实际不可审计”两处缺陷收口。

## 1. 发现的问题

| # | 现象 | 根因 | 风险 |
| --- | --- | --- | --- |
| 1 | 参数标定页 `engineVersion=unknown`，但批次指纹有版本 | 端点只读 `ENGINE_VERSION` env，未复用推理指纹的 `git describe` 回退 | 审计时无法回答“这份参数是哪版代码的”，和批次证据对不上 |
| 2 | 顶栏“引擎在线”是静态绿点 | `App.vue` 写死 `bg-ok` + 固定文案，从不探活 | 后端 502 / 停机时仍显示在线，排障被误导 |

## 2. 修复

### 2.1 生效引擎版本回退

`GET /admin/api/debug/effective-config` 改为：

```ts
resolveEngineVersion(this.config.get<string>('ENGINE_VERSION'), gitDescribeDirty)
```

与 `InferenceFingerprintService.build()` 同一函数、同一回退链：env 显式配置优先，否则 `git describe --dirty`。不另造第二套版本口径。

### 2.2 顶栏真实探活

- 进入页面探一次，之后每 30s 静默 `fetch('/admin/api/health')`。
- 不走 `api.health()`：那条链路 401 会弹 Basic 凭据框，轮询会反复打断使用者。
- 状态三态：`true=引擎在线` / `false=引擎离线` / `null=探测中…`，颜色分别 `bg-ok` / `bg-error` / `bg-warn`。
- 页面卸载清理定时器。

## 3. 运行态证据

| 场景 | 操作 | 结果 |
| --- | --- | --- |
| 版本回退 | 重启后端后请求 `GET /admin/api/debug/effective-config` | `engineVersion=v2026.11.16-6cfb46e-139-gc72f4d2-dirty`，不再是 `unknown` |
| 参数页展示 | 刷新 `#/calibrator` | 标题行显示上述完整版本与抓取时间 `2026/11/20 02:58:30` |
| 离线 | 强停 3000 端口进程，等 35s | 顶栏变“引擎离线” |
| 恢复 | 重启 `node dist/app.js`，等 35s | 顶栏自动恢复“引擎在线”，无需刷新 |

## 4. 闸门

| 命令 | exitCode | 结果 |
| --- | --- | --- |
| `pnpm exec vitest run test/admin-debug` | 0 | 13 files passed / 1 skipped；244 tests passed / 4 skipped |
| `pnpm typecheck` | 0 | 0 error |
| `pnpm lint` | 0 | 0 error / 0 warning |
| `pnpm --dir admin-dashboard build` | 0 | 含 `vue-tsc`；vite build 2.42s |
| `pnpm build` | 0 | 后端重建并重启 |

## 5. 边界

- 只改审计展示与探活，不改评分口径、engine-core、prompt、阈值。
- 健康端点仍只代表“后端可达”，不代表 MySQL / Qdrant / PsyGuard 全绿；依赖级健康仍以各监控页为准。
- 30s 轮询为固定常量，未做配置化；如后续需要多环境不同频率，再单独立项。
