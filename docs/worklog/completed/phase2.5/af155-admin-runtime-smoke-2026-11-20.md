# AF-155 · admin 调试引擎真实后端运行时冒烟与修复交付记录

- **taskId**：AF-155
- **日期**：2026-11-20
- **分支**：`task/AF-152-quality-admin`
- **基线**：`dd179bd942d423eb04d47bd8bc6607790f5d794d`
- **性质**：真实后端 + 真实数据库 + 真实浏览器的人工运行时冒烟，不是单测替代。
- **环境**：Windows 本机，NestJS `dist/app.js`（`127.0.0.1:3000`），Vite `127.0.0.1:5174`，MySQL / Qdrant / PsyGuard 同机启动。

## 1. 交付结论

admin-dashboard 从“页面能打开、数据靠 mock”推进到**真实后端可操作闭环**。本轮在浏览器里真实完成了：

- 管理员登录 → 仪表盘 → 自动对练 → 手动调试 → 批量回归 → 参数标定 → 会话关闭 → 会话删除。
- 手动调试真实创建一场“安然”会话，真实发送 1 轮并拿到来访者回复与 BDI 快照，随后关闭、删除测试数据。
- 发现并修复 **5 类真实缺陷**，其中 3 类会让页面显示错误数据或让本地环境完全不可用。

**边界**：这是工程运行时冒烟，不是临床验收；不改变 AF-152 的 AI 质量结论（safety 硬门 4/6、96 场 κ 0.365854 仍未达标）。

## 2. 发现与修复

| # | 现象 | 根因 | 修复 | 证据 |
| --- | --- | --- | --- | --- |
| 1 | 本地 SPA 登录后接口一半 200、一半 401/403，页面空 | dev 下中间件已匿名放行，但 `AdminRoleGuard` 只认 `adminBasicAuth` / `userId`；且 SPA 登录页会带任意 Basic 头，没配凭据时被当成“凭据错误” | 中间件在“未配凭据 + 非 production”时写 `adminAnonymousDev` 并放行；守卫只在该标记 + 非 production 时放行；production 仍 401/403 双保险 | `wp19r-trace-wiring.spec.ts` 新增 3 例；`wp26-admin-role-guard.spec.ts` 新增 2 例；真实浏览器登录后接口 200 |
| 2 | 仪表盘“自动对练场次”长期显示 20，实际 285 | 前端用当前页 `items.length` 当总数 | 改用后端分页 `total` | 运行态 285；`GET /admin/api/auto-practice/sessions` 返回 `total=285` |
| 3 | 仪表盘“闸门触发率”方向可能算反 | 用 `skipDecisions` 当触发率 | 改为 `runDecisions / totalDecisions`，与 GateDecisions 页同口径 | 运行态 0.6%（7661 次决策） |
| 4 | 负效价（valence=-0.15）进度条异常；batch 进度条出现多余圆点 | valence 是 `-1..1`，被直接当 `0..100`；`NProgress` 默认指示点未关 | valence 归一化 `(v+1)/2` 后再画，显示值仍保留原始刻度；关闭进度条 indicator | 手动调试第 1 轮截图：valence -0.15 有正确短条；`DebugTracePanel.vue` diff |
| 5 | 257 条历史会话标题全是 `<think>We need output ti…` | 标题生成器把推理模型内联的 `<think>` 当正文；且只修生成器无法救历史数据 | 1) `parseDebugSessionTitle` 先 `stripReasoningBlocks`；2) 读路径 `sanitizeDebugSessionTitle` 投影，脏标题落回“未命名会话 - 时间”，不回写库；3) 前端在兜底标题前补角色名 | API 257 条标题 `<think>` 命中 0；列表显示“安然 · … / 亦舟 · …” |

## 3. 运行时走查清单

| 场景 | 操作 | 结果 |
| --- | --- | --- |
| 登录 | 本地账号登录 | 成功，进入仪表盘 |
| 仪表盘 | 打开 `#/dashboard` | 自动对练 285、触发率 0.6%、评估报告 0；无 502 |
| 自动对练 | 选择角色/模式 | 角色与模式列表来自真实接口 |
| 手动调试 | 选“安然” → 开启调试会话 → 发送“你好，我想聊聊最近的压力。” | 真实回复“你好。其实最近工作压力有点大……”；BDI trust 0.65 / safety 0.70 / bond 0.50 / valence -0.15 / arousal 0.45 |
| 关闭会话 | 结束会话 | toast“会话已结束”，列表状态更新 |
| 删除会话 | `DELETE /admin/api/debug/sessions/:id` | `{deleted:true}`，再查列表为 0，测试数据已清理 |
| 批量回归 | 打开页签 | 页面可操作，进度轮询工作 |
| 参数标定 | 打开页签 | 真实生效参数只读快照可读，沙盘区不写回 |

## 4. gateResults

| 命令 | exitCode | 结果 |
| --- | --- | --- |
| `pnpm exec vitest run test/admin-debug test/shared/af106-reasoning-text.spec.ts` | 0 | 14 passed / 1 skipped；251 tests passed / 4 skipped |
| `pnpm exec vitest run test/shared/af106-reasoning-text.spec.ts test/admin-debug/debug-session-persistence.spec.ts` | 0 | 2 files / 35 tests passed |
| `pnpm lint` | 0 | src/test/bin + scripts，0 error / 0 warning |
| `pnpm typecheck` | 0 | `tsc -b tsconfig.check.json`，0 error |
| `pnpm --dir admin-dashboard build` | 0 | 含 `vue-tsc`；vite build 2.37s，exit 0 |
| `pnpm build` | 0 | 后端 `dist/app.js` 重新构建并重启 |

## 5. scopeCheck

- **in-scope**：`admin-dashboard/src/`、`src/admin-debug/`、`src/shared/llm/reasoning-text.ts`、`test/admin-debug/`、`test/shared/af106-reasoning-text.spec.ts`。
- 未改评分口径、未改 `src/engine-core`、未改 AF-152 已归档数据。
- 运行时测试会话已删除，未向 `ap_practice_sessions` / 调试会话目录留测试脏数据。

## 6. 遗留与边界

1. **历史标题不可还原**：记录里的原始标题已被 `<think>` 覆盖，只能投影成“角色 · 时间”，不能伪造语义标题。
2. **仪表盘“总会话 / 平均轮次 / 危机命中 / Token”为 0**：来自 `/admin/api/dashboard` 的训练会话统计，当前库没有对应数据；不是前端写死，后续有真实训练数据会自动出数。
3. **后端进程生命周期**：本轮重启时旧进程曾被 Nest shutdown 钩子带走，导致一次 502；已用独立进程重启并复核。属本地开发进程管理，不是代码缺陷。
4. **AI 质量债未闭环**：AF-152 的 safety 硬门 4/6、κ 0.365854 仍成立；本单不粉饰、不调阈值。
