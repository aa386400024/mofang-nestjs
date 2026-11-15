# 编排看板 · 快照自动刷新与前端轮询重载 — 交付记录

- **状态**：✅ CLI 变更命令尾部自动刷新快照 + 前端轮询重载落地（2026-11-16，本机闸门全绿；定向测试 51 passed）
- **基线 HEAD**：`ff27fdf`（与 `origin/integrate` 一致）
- **范围**：`scripts/orchestration/` adapter + `web/orchestration/` 静态视图；`src/engine-core`、`src/migration`、业务 `src/**/*.ts`、`test/` 零 diff
- **方案归属**：L2 自治看板延续增强（承接 `orchestration-dashboard-upgrade-p1-p3-implementation-2026-11-15.md`）

---

## 一、本单做了什么（一句话）

补齐看板数据闭环：`pack` 与改进台账变更命令在落盘后自动重建快照并双写 `snapshot.json` + `data.js`；前端把渲染入口改为可重复调用，按快照下发的 `web.refresh` 配置定时重载 `data.js`，`generatedAt` 变化即重渲染，无需手动 F5。

## 二、改动文件清单

| 文件                                                        | 改动                                                                                                                                                                                                                                   |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `scripts/orchestration/state-store.mjs`                     | `validateConfig` 增 `web.refresh` 校验与归一化：`enabled`（缺省 true，显式 false 关闭）、`intervalMs`（正整数且 ≥1000，缺省 3000）；非法值抛错，不静默兜底                                                                             |
| `scripts/orchestration/config.json`                         | 增 `web.refresh.{enabled, intervalMs}` 段与两条 `notes` 说明                                                                                                                                                                           |
| `scripts/orchestration/scheduler.mjs`                       | `buildSnapshot` 增只读投影 `webRefresh: { enabled, intervalMs }`，供前端读取轮询参数                                                                                                                                                   |
| `scripts/orchestration/cli.mjs`                             | 新增 `refreshSnapshotArtifacts()`：重建快照并双写 JSON + data.js，读取异常告警并跳过、不阻断已落盘产物；接线到 `snapshot`、`pack`、`improvements --extract/--add/--transition` 尾部                                                    |
| `scripts/orchestration/open-web.mjs`                        | 打开看板提示文案更新为自动刷新口径                                                                                                                                                                                                     |
| `web/orchestration/app.js`                                  | IIFE 内抽出 `renderAll(snap)` 可重复渲染；新增 `startAutoRefresh`：动态加载带时间戳的 `data.js`（防缓存），比对 `generatedAt`，变化则重渲染；加载/解析异常 `console.warn` 保留当前视图；`web.refresh.enabled === false` 时不启动定时器 |
| `scripts/orchestration/__tests__/orchestration.spec.mjs`    | 新增断言：配置缺省/显式关闭归一化、`intervalMs` 非法抛错、快照 `webRefresh` 投影                                                                                                                                                       |
| `docs/team/agent-orchestration/orchestration-snapshot.json` | CLI 刷新：携带 `webRefresh` 段                                                                                                                                                                                                         |
| `web/orchestration/data.js`                                 | CLI 刷新：与快照同源，携带 `webRefresh` 段                                                                                                                                                                                             |

## 三、关键决策与偏差

1. **配置单一真相源在 CLI / config.json**：轮询开关与间隔由 `validateConfig` 校验归一化，经 `buildSnapshot` 投影进快照，前端只读 `snapshot.webRefresh`；前端不另设配置文件。
2. **变更命令才刷新，只读命令不刷新**：`improvements --summary` 与默认列表为只读路径，不落盘也不重建快照；`--extract` / `--add` / `--transition` 为变更路径，落盘后刷新。
3. **刷新失败不阻断主产物**：`refreshSnapshotArtifacts` 捕获索引 / 读取异常，告警后返回 `null`；交付包与台账已落盘，不因快照重建失败而回滚。
4. **前端防缓存**：轮询加载 `data.js?t=<timestamp>`；单次脚本加载后移除标签，避免标签堆积。
5. **未引入推送通道**：当前静态页 + `file://` 规模不需要 SSE / WebSocket；轮询为轻量兜底，后续若改本地服务化再升级为推送。

## 四、闸门证据

| 命令                                                                          | 退出码 | 结果                                                                    |
| ----------------------------------------------------------------------------- | ------ | ----------------------------------------------------------------------- |
| `pnpm exec vitest run scripts/orchestration/__tests__/orchestration.spec.mjs` | 0      | 51 passed（基线 48 + 本单 3 组断言）                                    |
| `pnpm typecheck`（`tsc -b tsconfig.check.json`）                              | 0      | 0 error                                                                 |
| `pnpm lint:fast`（`oxlint src test bin`）                                     | 0      | 0 warning / 0 error，1350 文件                                          |
| `pnpm orchestration:snapshot`                                                 | 0      | 快照与 `data.js` 均含 `webRefresh` 与 `generatedAt`                     |
| `config.json` 解析                                                            | —      | `ConvertFrom-Json` 通过，`web.refresh.enabled=true` / `intervalMs=3000` |
| 编码探测                                                                      | —      | 改动 `.mjs` / `.js` / `.json` 均 `bom=False`、`cr=0`（纯 LF）           |

- **未重跑全量**：改动不进入 `src/test` 运行时，沿用基线全量口径；前端静态脚本不在后端 eslint / tsconfig 覆盖范围（与既有看板视图一致）。

## 五、遗留与未决

- 轮询仅随快照下发，未做前端可视化设置面板；调整间隔改 `config.json` 的 `web.refresh.intervalMs` 后刷新快照即可。
- `watch` 命令 fs.watch 监听 `pending/`、`completed/`；台账与交付包目录的变更已由命令尾部刷新覆盖，未纳入文件监听（命令触发路径已闭环）。
- 前端轮询基于 `file://` 动态脚本加载；若后续看板改为本地 HTTP 服务，轮询机制可直接复用，届时再评估缓存头与推送升级。
