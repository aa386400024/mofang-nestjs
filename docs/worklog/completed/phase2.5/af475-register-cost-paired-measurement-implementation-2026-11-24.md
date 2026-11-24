# AF-475 · 语域成本评测改为单进程逐轮配对测量

## 1. 结论

成本门失败的第一处置不是压缩语域块，而是先消除测量混杂。AF-466 把 base/active 分别放在 3010/3011 两个进程、每角色整场串行 30 轮；AF-471 归因显示 active 的 p95 增量集中在 post-TTFT 与后段轮次，同时单次 p95 自身方差很大。直接改产品 prompt 会把进程漂移、时段差异和真实语域成本混在一起。

本任务落地单进程逐轮配对口径：同一后端进程内，每个角色同时开 base(off) 与 active(active) 两场会话，逐轮紧邻执行并奇偶翻转先后，降低双进程与整场串行的混杂。产品 prompt、语域块、context budget 均未改。

**边界：本任务没有跑真实 600 轮配对评测，也未证明 p95 成本门通过。** 本机 3010/3011 后端未启动，MySQL 3306、Redis 6379 未监听，且无 docker；只完成代码、纯函数单测、lint 与 typecheck。

## 2. 改动

### 2.1 调试会话按会话切换语域

- `src/admin-debug/debug-session.controller.ts`：`CreateDebugSessionBody` 增加 `registerMode?: 'off' | 'active'`，透传到 service。
- `src/admin-debug/debug-session.service.ts`：`createSession` 增加第 4 参数 `registerMode`；非法值抛 `BizException(BizCode.InvalidParameter, 'registerMode 只能是 off 或 active')`；`off` 时不向引擎传 `speechRegister` / `speechRegisterAudit`，`active` 或缺省保持既有行为。
- 该开关只在调试接口暴露，不影响正式对练入口。

### 2.2 评测脚本配对跑法

- `scripts/eval/visitor-register-stability/run-sessions.mjs`：新增 `--paired` 与 `--port`；paired 路径只 health 一个端口；每角色同端口开 base/active 两场，逐轮按奇偶顺序执行，逐轮落 partial JSON，最终写 `registerMode`、metrics 与 `paired=true` 的 manifest。
- `scripts/eval/visitor-register-stability/paired-order.mjs`：新增纯函数 `pairedTurnOrder`，偶数轮 base 先发、奇数轮 active 先发，30 轮两边各先发 15 次。
- `scripts/eval/visitor-register-stability/__tests__/paired-order.spec.mjs`：3 条单测覆盖顺序、15/15 配平与非法轮次。
- 旧双端口路径保留，AF-465/AF-466 产物仍可按旧口径复算。
- `scripts/eval/visitor-register-stability/README.md`：补充 paired 命令、端口与口径。

### 2.3 测试

- `test/admin-debug/wp58-debug-session.spec.ts`：Stub resolver 返回真实语域；新增“off 不登记 / active 登记”和“非法 mode 400”两条用例。

## 3. 验证

| 命令                                                                                                                                       | 结果                                      |
| ------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------- |
| `pnpm exec vitest run test/admin-debug/wp58-debug-session.spec.ts scripts/eval/visitor-register-stability/__tests__/paired-order.spec.mjs` | 2 files / 36 tests passed                 |
| `pnpm lint`                                                                                                                                | 0 error（1 条 import/order warning 已修） |
| `pnpm typecheck`                                                                                                                           | 0 error                                   |
| `git diff --stat HEAD -- src/engine-core`                                                                                                  | 空                                        |

## 4. 未验证项

- 未跑真实 paired 600 轮；未产出配对后的 p95 比值与成本门结论。
- 未采集 provider `cachedTokens`；AF-471 报告中缓存前缀因素仍无法从 usage 侧直接核对。
- 未改 `noHarm` 的 `abstractTermRate` 门槛，也未改语域块长度或 context budget。

## 5. 下一步

环境具备后，用同一 runId 跑 10 角色 × base/active × 30 轮 paired 评测，再用 AF-471 的 `analyze-latency.mjs` 复算 p95 比值与置信区间。只有在配对数据仍显著超门时，才进入产品侧压缩语域块或拆分缓存前缀的取舍。
