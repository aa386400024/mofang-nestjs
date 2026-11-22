# AF-276 · 流式超时语义拆分与首包预算按输出上限放宽

> 任务单：`docs/worklog/records/phase2.5-orchestration-closed-loop/AF-276/task-sheet.md`
> 基线：`e2250741cbd081d93888e692c1fc4ca4a404d4be`（AF-275 合并提交）
> 分支：`task/AF-276-stream-timeout-semantics`
> 交付日期：2026-11-22

## 一、为什么做

AF-270 / AF-274 把「聚合调用总超时」「流式首包等待」「块间空闲等待」三种语义都挂在同一个 `ENGINE_RENDER_TIMEOUT_MS` 上。后果是双向的：

- 为了让长回复不被误杀而调大聚合超时，会同时把「上游停摆多久算异常」拖慢，停摆兜底重新变回分钟级；
- 为了让停摆更快兜底而调小聚合超时，会误杀「首包前先吐大段思考 token」的合法慢首包。

首包固定 30s 对高 `maxCompletionTokens` 的慢生成也不安全：输出上限越大，首包前思考 token 越多，首包合法延迟越可能超过固定阈值。

## 二、改了什么

### 1. 配置层

`src/engine-adapters/rendering/render-adapter.config.ts`

- `RenderAdapterConfig` 新增两个独立字段：
  - `streamIdleTimeoutMs`：首 delta 之后「等待下一块」的空闲上限，默认 `30_000`，env `ENGINE_RENDER_STREAM_IDLE_TIMEOUT_MS`。
  - `streamFirstDeltaTimeoutMs`：首包等待**下限**，默认 `8_000`，env `ENGINE_RENDER_STREAM_FIRST_DELTA_TIMEOUT_MS`。
- 新增常量 `DEFAULT_RENDER_STREAM_IDLE_TIMEOUT_MS`、`DEFAULT_RENDER_STREAM_FIRST_DELTA_TIMEOUT_MS`、`RENDER_STREAM_FIRST_DELTA_MS_PER_TOKEN=8`。
- 新增纯函数 `resolveStreamFirstDeltaTimeoutMs(baseMs, maxCompletionTokens?)`，返回 `max(下限, maxCompletionTokens × 8)`；缺省或非法 `maxTokens` 只取下限，非法下限回落种子值。
- `createRenderAdapterConfig()` 写入两个默认值。

### 2. 适配器层

`src/engine-adapters/rendering/llm-render.adapter.ts`

- 首包 guard 改为按 `request.maxCompletionTokens ?? request.maxTokens` 计算预算，不再读 `config.timeoutMs`。
- 首包超时日志与 reason 带 `phase=first-delta budget=<ms>`。
- 块间 `nextStreamChunk()` 改用 `config.streamIdleTimeoutMs`；日志带 `phase=idle idle=<ms>`。
- `timeoutMs` 只保留聚合调用总超时语义，不再参与流式首包与块间空闲。

### 3. 装配层

`src/engine-adapters/wiring/render-config.factory.ts`

- `build()` 装配两个新键。
- 走 `config.get<string>('KEY')` 直读 + `positiveNumberFromRaw`，而不是 `positiveNumber('KEY', ...)` 的变量入参：wp25 的 AST 守卫只能识别 `process.env.X` / `config.get('KEY')` 字面量，变量入参会被判成“模板里有生效行、代码里查无读取点”。

### 4. 模板

`.env.example`

- 在渲染候选段新增两条生效行与说明：默认值、只约束块间停摆、首包预算联动公式。

### 5. 测试

- 新增 `test/engine-adapters/af276-stream-timeout-semantics.spec.ts` 7 例：
  - 纯函数：低上限取下限、高上限放大、缺省/非法上限取下限、非法下限回落种子值；
  - 聚合超时不再约束块间空闲：`timeoutMs=10ms`、`streamIdleTimeoutMs=500ms`、20ms 一块 → 整轮成功；
  - 块间停摆只按 idle 键降级：`timeoutMs=5000ms`、`streamIdleTimeoutMs=100ms` → 约 115ms 收尾；
  - 首包预算按输出上限放大：下限 100ms、上限 160 → 200ms 首包仍成功。
- `af270-stream-timeout.spec.ts`：显式把首包/idle 压到测试值；首包挂起用例按新预算 `160×8=1280ms` 断言，改名“首包预算内 abort 并切备”。
- `af274-stream-idle-timeout.spec.ts`：配置 helper 同时压 `streamFirstDeltaTimeoutMs` / `streamIdleTimeoutMs`，保持原语义。
- `wp8-wiring.spec.ts`、`wp11-psyguard-probe.spec.ts`：直接构造 `RenderAdapterConfig` 字面量的 stub 补两个必填字段。

## 三、闸门与真实 smoke

| 项 | 结果 |
| --- | --- |
| 定向 4 文件 | **26/26 passed**；`data/af276-targeted2.log` |
| `pnpm exec tsc --noEmit -p tsconfig.json` | exit 0；`data/af276-tsc3.log` |
| `pnpm lint` | 0 error / 0 warning；`data/af276-lint2.log` |
| `pnpm test` | **268 files passed + 1 skipped；4304 tests passed + 4 skipped；22.83s**；`data/af276-full-test.log` |
| `git diff --stat HEAD -- src/engine-core` | 空 |
| 真实块间停摆 smoke | `ENGINE_RENDER_STREAM_IDLE_TIMEOUT_MS=1000` + `--timeout-ms 1000 --expect-degraded-within-ms 5000`：exit 0；wall **1070ms**；TTFT 52ms；deltas 1；degraded true；日志 `phase=idle idle=1000ms`；`data/af276-gate-midstream.log` |
| 正常 3 轮 smoke | 3/3 doubao；model `doubao-seed-character-260628`；finishReason stop；fallback false；degraded false；wall **2148ms**；TTFT 530/795/651ms；`data/af276-normal-smoke.log` |
| 切流自检 | 候选 `doubao,minimax`；两家 `candidateApiKeys` present=true；`data/af276-switch-check.log` |

## 四、偏差与理由

1. **任务单 smoke 闸门只写了 `--timeout-ms 1000`，没有写 idle env。**
   这是任务单与实现目标的固有冲突：本任务的目标 3 就是让 `ENGINE_RENDER_TIMEOUT_MS` 不再影响块间空闲。`visitor-render-smoke` 的 `--timeout-ms` 只写 `ENGINE_RENDER_TIMEOUT_MS`，所以如果严格按原命令执行，块间空闲会走独立键的 30s 默认，`--expect-degraded-within-ms 5000` 必然失败。
   实际执行时在命令前加了 `ENGINE_RENDER_STREAM_IDLE_TIMEOUT_MS=1000`，用独立键把停摆窗口压到 1s；这样验证的正是“停摆只按 idle 键降级”，而不是旧键顺带生效。`--timeout-ms 1000` 仍保留，用于证明聚合超时不再影响停摆兜底。

2. **首包挂起用例耗时从约 300ms 变为约 1.3s。**
   `af270` 原断言是 `TIMEOUT_MS×4=400ms`，但 AF-276 后首包预算按 `max(100ms, 160×8=1280ms)` 生效，这是设计要放宽的合法慢首包窗口。断言改为 `<1600ms`，不再要求固定下限。

3. **未改 `bin/visitor-render-smoke.ts`。**
   任务单 scope 不含 `bin/`，因此没有给 smoke CLI 增加 `--idle-timeout-ms` / `--first-delta-timeout-ms` 参数；真实 smoke 通过进程 env 注入独立键。后续若要把该场景固化成一条不带 env 前缀的闸门命令，需要新任务把 `bin/` 纳入 scope。

## 五、遗留

- Prometheus 指标（`stream_idle_timeout_total` / auth fallback / phase / candidate）→ AF-277。
- MiniMax HttpClient 传输层超时是否仍先于适配器触发 → 单独任务核对。
- 回滚态并发 + 超时组合、40 轮长上下文 → 仍待验证。
- 成本分账落库 / 管理后台看板 / MiniMax 官方价 → 仍待闭环。
- WS 层 error/end 与抑制客户端自动重试 → 仍待处理。

## 六、提交

`feat(af276): 拆分流式首包与块间空闲超时，首包预算按输出上限放宽`

实现与交付记录首次提交 `6d63f0d2`；归档状态面随后由 CLI 更新并合入同一提交。

## 七、机读标记

### gateResults（闸门结果）

- 定向：26/26 passed；tsc exit 0；lint 0 error / 0 warning；全量 4304 passed + 4 skipped。
- 真实 smoke：停摆 wall 1070ms、degraded true；正常 3 轮 3/3 doubao、零降级。
- engine-core：`git diff --stat HEAD -- src/engine-core` 为空。

### scopeCheck（范围核对）

改动全部落在任务单 scope：3 个 `src/engine-adapters` 文件、`.env.example`、`test/engine-adapters/`、交付记录与任务记录包。未改 `bin/`、`src/engine-core/`、`admin-dashboard/`、Flutter。

### contractChecks（契约核对）

- taskId：分支名与提交标题只含 AF-276。
- state-write：register / promote / run-once / branch 均经 CLI，状态索引与事件链未手改。
- index-schema：回执六组字段齐全，durable 副本已由摄入生成。
- engine-boundary：engine-core 零改动。

### backlogItems（遗留项）

- `visitor-stream-idle-observability`：流式 phase 日志已可区分，但无 Prometheus 指标。
- `visitor-smoke-stream-timeout-flags`：smoke CLI 尚无独立 idle / 首包参数，停摆场景靠进程 env。
- `visitor-rollback-concurrency-long-context`：回滚态并发 + 超时、40 轮长上下文未验证。
- `minimax-httpclient-transport-timing`：MiniMax 传输层超时未单独核对。
- `visitor-stream-client-auto-retry`：WS 层 error/end 与抑制自动重试未处理。
- `visitor-cost-breakdown-persistence`：成本分账未落库、未进看板。
- `minimax-official-pricing`：MiniMax M3 官方单价未核对。

### deviationTable（偏差说明）

1. 任务单停摆 smoke 只给 `--timeout-ms 1000`，但该键已不再影响块间空闲；执行时注入 `ENGINE_RENDER_STREAM_IDLE_TIMEOUT_MS=1000`，验证独立 idle 键。
2. `af270` 首包挂起用例耗时按新预算 `160×8=1280ms` 放宽，断言上限改为 1600ms。
3. `wp8` / `wp11` 的 `RenderAdapterConfig` 字面量 stub 补两个新必填字段。
4. 工厂改用 `config.get('KEY')` 直读，让 wp25 AST 守卫识别模板生效行。

### reviewVerdict（验收结论）

passed。三种超时语义已解耦，首包预算按输出上限放大；真实停摆与正常路径均验证；全量 4304 例、tsc、lint 全绿；engine-core 零改动。偏差项均已在交付记录说明。
