# AF-159 交付记录 · 顶栏探活在登录态切换后即时刷新

- 日期：2026-11-20
- 任务：AF-159（fix，executor）
- 基线：`19b0c52`
- 结论：**passed**。登录页阶段 `/admin/api/health` 无凭据返回 401，会把顶栏状态写成“离线”；AF-156 的 30 秒轮询要等下一拍才纠正，最长 30 秒显示错误状态。现在监听 `auth.isAuthenticated`：登录成功立即重探，登出清为 `null`（未探测）。

## 改动

| 文件 | 改动 |
| --- | --- |
| `admin-dashboard/src/App.vue` | 引入 `watch`；新增登录态监听：`true` → `probeEngineHealth()`，`false` → `engineOnline = null` |

不改探活接口、轮询周期与顶栏文案。

## 运行态验证

1. 点顶栏登出 → `#/login`；顶栏隐藏。
2. 用 `test/test` 登录（dev 未配置 Basic 凭据时后端返回 200）→ 跳 `#/dashboard`。
3. 登录瞬间顶栏右侧显示绿点 + “引擎在线”，未经过 30 秒轮询等待。
4. 仪表盘同时返回真实数据：自动对练 285 场、闸门触发率 0.6%（7661 次决策）、总会话 0、Token 0。

## 闸门

| 闸门 | 结果 |
| --- | --- |
| `pnpm lint` | exit 0，0 error |
| `pnpm typecheck` | exit 0，0 error |
| `pnpm --dir admin-dashboard build` | exit 0，vite build 2.54s |

## 边界

- 仅前端状态联动，不动后端 `/health`、鉴权守卫与数据库。
- 登录失败仍由 Login 页错误提示处理，探活不参与登录判定。
