# AF-293 · 引擎渲染路径 V5 来访者约束对齐与生产路径盲评

## 一、结论

V5 约束已进入生产引擎渲染路径，生产路径 A/B 盲评判定 **pass**，13 项硬/软门槛全过。

- 生产入口 `TurnRenderOrchestrator` + `RenderConfigFactory` 支持 `shared | seed-v5`，默认 `shared` 的 system prompt、`buildMessages` 函数引用与输出文本逐字不变。
- 旧 `VisitorService` 与引擎渲染路径共用同一份 V5 正文，禁止两套复制。
- `seed-v5` 额外开启舞台说明投影：括号、星号、方括号动作从最终返回/落历史文本里确定性剥离；`shared` 路径不开启，输出行为零变化。
- 隔离 worktree `.env` 已设 `VISITOR_PROMPT_VARIANT=seed-v5`，20 轮真实上游 smoke 全走 `doubao-seed-character-260628`，零回退、零降级、`finishReason=stop`，报告带 `promptVariant: "seed-v5"`。
- 本任务由 AF-281/AF-292 重建：AF-281 的实现与 288 次生产渲染调用、48 次评分调用沿用为证据；代码已 3-way 合并到最新 `integrate`（含 AF-278/AF-282 遥测），并重跑全部闸门与 20 轮 smoke。

## 二、实现

### 2.1 共享真相源

新增 `src/shared/realism/visitor-prompt-variants.ts`：

- `VisitorPromptVariant = 'shared' | 'seed-v5'`
- `VISITOR_PROMPT_VARIANTS`、`DEFAULT_VISITOR_PROMPT_VARIANT`
- `SEED_V5_VISITOR_CONSTRAINTS`
- `parseVisitorPromptVariant(raw)`：空值回默认，非法值抛错并带 key 与允许值

`src/agent/visitor/visitor.prompts.ts` 删除本地 V5 副本，改为引用共享常量；`visitor.runtime.ts` 改用共享解析函数，删除本地 `VARIANTS` 与类型定义。

### 2.2 引擎渲染路径

`src/engine-adapters/rendering/turn-render-orchestrator.ts`：

- `buildVisitorMessages(spec, promptVariant = 'shared')`
- `buildVisitorSystemPrompt(spec, promptVariant)` 在硬规则之后调用 `appendVisitorPromptVariant()`
- `shared` 不追加任何 V5 文本

`src/engine-adapters/wiring/render-config.factory.ts`：

- `RenderConfigFactory.visitorPromptVariant()` 从 `VISITOR_PROMPT_VARIANT` 读取并严格解析
- `buildEngineRenderDeps()` / `buildEngineRenderPort()` 增加第 4 个可选参数
- `shared` 时 `buildMessages` 直接保留 `buildVisitorMessages` 原函数引用；`seed-v5` 时才包一层变体闭包
- `stripStageDirections` 仅在 `seed-v5` 为 true

`src/engine-adapters/wiring/engine.module.ts` 的 `ENGINE_RENDER_PORT` useFactory 注入 `configFactory.visitorPromptVariant()`。

### 2.3 舞台说明投影

新增 `src/shared/realism/visitor-stage-direction.ts`：

- `stripVisitorStageDirections(text)` 确定性剥离 `（…）`、`(…)`、`【…】`、`*…*`
- 删除后为空返回 `……`
- 连续空白折叠、句首残留标点清理
- 纯函数，不读 env、不调模型、不依赖 NestJS

接入 `src/engine-adapters/rendering/llm-render.adapter.ts` 的聚合成功返回与原生流式最终返回；由 `stripStageDirections` 开关控制，默认关闭。流式已发出的 delta 无法撤回，投影保证最终返回/落历史文本干净，TTS 若逐 delta 播放仍需上游不写括号。

### 2.4 harness 与证据字段

- 新增 `bin/visitor-engine-render-v5-blind.ts`：生产编排链 4 persona × 3 难度 × 2 臂，每场 12 轮固定咨询师脚本；支持 `--from-sessions` 复用会话、`--dump-raw` 调试。
- `bin/visitor-render-smoke.ts` 报告新增顶层 `promptVariant`，直接暴露生产端口实际加载的变体。

## 三、生产路径 A/B 盲评

- 路径：`production TurnRenderOrchestrator + RenderConfigFactory + LlmRouterService`
- 规模：每臂 12 场 × 12 轮
- 模型：同一 `doubao-seed-character-260628`
- 评分：两个 Doubao `thinking=enabled`、`temperature=0` 独立通道，同一 R1 协议；评分输入不含模型/臂身份

| 门槛 | 结果 | 判定 |
| --- | --- | --- |
| AI 暴露 | 0 | PASS |
| 建议 | 0 | PASS |
| 总结 | 0 | PASS |
| 剧情推进 | 0 | PASS |
| 交付文本原始括号 | 0 | PASS |
| 标记错误率 | 0 | PASS |
| L3 短答率 vs shared | 0.625 vs 0.6875 | PASS |
| 首 token P95 | 940ms | PASS |
| 盲评均值 vs shared | 4.125 vs 4 | PASS |
| 过度配合指数 vs shared | 0.194444 vs 0.222222 | PASS |
| 跨评分员 κ | 0.625 | PASS |
| 平均绝对差 | 0.083333 | PASS |
| 可见字数 std | 4.763026 | PASS |

客观指标：

| arm | AI暴露 | 建议 | 总结 | 剧情 | 交付文本括号 | 标记错误率 | L3短答率 | 首token P95 | 过度配合 | 字数std |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| shared | 0 | 0 | 0 | 0 | 0 | 0 | 0.6875 | 996ms | 0.222222 | 5.105346 |
| seed-v5 | 0 | 0 | 0 | 0 | 0 | 0 | 0.625 | 940ms | 0.194444 | 4.763026 |

盲评：

| arm | 均值 | κ | 绝对差 | 分布 |
| --- | --- | --- | --- | --- |
| shared | 4 | 1 | 0 | {"4":24} |
| seed-v5 | 4.125 | 0.625 | 0.083333 | {"4":21,"5":3} |

判定 `verdict=pass`，`hardFailures=[]`、`softFailures=[]`。

## 四、20 轮真实 smoke

worktree `.env`：

- `VISITOR_LLM_PROVIDER=doubao`
- `VISITOR_DOUBAO_MODEL=doubao-seed-character-260628`
- `VISITOR_PROMPT_VARIANT=seed-v5`

命令：

```powershell
pnpm exec tsx bin/visitor-render-smoke.ts --orchestrated --turns 20 --max-tokens 120 --timeout-ms 60000
```

结果：

- 报告顶层 `promptVariant: "seed-v5"`
- 20/20 `providerHint=doubao`、`model=doubao-seed-character-260628`
- 20/20 `finishReason=stop`、输出非空、`fallbackUsed=false`、`degraded=false`
- 墙钟 14 796ms（最新基线 `2b8a1cf` 重跑）
- 日志 `data/phase25-exit/af293-smoke20.log`，含台词原文，不提交

## 五、测试与闸门

- `pnpm typecheck`：exit 0
- `pnpm lint`：0 error / 0 warning
- `pnpm test`：278 files passed / 1 skipped；4346 tests passed / 8 skipped（23.90s）
- `git diff --stat HEAD -- src/engine-core`：空
- 定向 6 文件 63 例全绿，覆盖默认零回归、V5 追加位置、非法值拒绝、两条链路共享常量、`shared` 函数引用保持、`seed-v5` 投影开关、投影纯函数、AF-278 遥测回归
- 最终基线：`2b8a1cf6eb0fc2ca40ee528e9b159cf1a1b139f6`

## 六、机器可读标记

### gateResults

- `pnpm typecheck`：exit 0
- `pnpm lint`：exit 0，0 error / 0 warning
- `pnpm test`：exit 0，278 passed + 1 skipped files；4346 passed + 8 skipped tests
- `git diff --stat HEAD -- src/engine-core`：输出为空
- 定向 vitest：6 files / 63 tests passed
- 最终基线 `2b8a1cf` 上重跑全部闸门与 20 轮 smoke

### scopeCheck

in-scope：`src/shared/realism/`、`src/agent/visitor/`、`src/engine-adapters/rendering/`、`src/engine-adapters/wiring/`、`test/agent/visitor/`、`test/engine-adapters/`、`test/shared/realism/`、`bin/`、`docs/worklog/`。未改 `src/engine-core`、`admin-dashboard/`、Flutter、编排脚本。

### contractChecks

- taskId：AF-293（AF-280 因 AF-252 rejected 依赖失败后 reissue 为 AF-281；AF-281 状态被并行进程切分支丢失，AF-292 又因 PR 基线冲突重建，故以 AF-293 承接；`priorTasks` 保留 AF-280 / AF-281 / AF-292 / AF-252）
- state-write：AF-293 register / promote / run-once / branch create 均经 CLI
- index-schema：交付记录六组机读字段齐全
- event-chain：归档后 `events verify`

### backlogItems

- `visitor-stage-direction-stream-delta`：流式已发出的 delta 无法撤回，逐 delta TTS 仍可能念出括号
- `shared-arm-rater-no-discrimination`：shared 臂 24 个评分全 4，rater 在该臂无区分度；κ=1 是恒等一致，不是强判别证据
- `ai-rater-not-clinical`：AI 代理双通道，不是真人督导双标，不声称临床达标
- `af278-pr-p0-blocked`：AF-278 PR #123 需先修 P0 才能用于告警

### deviationTable

- 任务号由 AF-281 改为 AF-293：AF-281 状态被并行进程切分支丢失；AF-292 登记后 `integrate` 又推进到 AF-291，PR 冲突导致状态链分叉，故以 AF-293 在最新 integrate 上重建并保留 `priorTasks` 追溯。实现与评测证据沿用 AF-281，代码 3-way 合并后重跑全部闸门。
- 任务单要求「重启本地服务」：本机 3000 端口服务来自另一份 `mofang-nestjs` 克隆（AF-069 分支），不属于本任务代码；未杀该无关进程。V5 生效证据由隔离 worktree 的生产端口 20 轮 smoke 直接给出。
- 盲评阶段 `shared` 臂也受投影层影响：最终代码已改为仅 `seed-v5` 开启，`shared` 生产输出恢复逐字不变；该偏差让 shared 对比基线更强，V5 过门结论偏保守。
- 任务单 artifact 路径写 `af280-engine-render-v5/`：实际评测目录同名保留，避免反复改路径。

### reviewVerdict

passed

