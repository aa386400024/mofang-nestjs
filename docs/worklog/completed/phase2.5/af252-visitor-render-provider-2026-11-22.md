# AF-252 交付记录 · visitor 渲染路由双路径切换

- 任务单：`docs/worklog/records/phase2.5-orchestration-closed-loop/AF-252/task-sheet.md`
- 分支：`task/AF-252-visitor-render-provider`
- 基线：`84c5f8d3bff82ca0cfe5ee52c33e9c9537873f31`
- 日期：2026-11-22

## 1. 问题

AF-248 的 `VISITOR_LLM_PROVIDER=doubao` 只覆盖旧 `VisitorService` 链路。生产对练/来访者模拟器实际走 `RenderConfigFactory` → `TurnRenderOrchestrator` 的引擎渲染路径，候选由 `ENGINE_RENDER_PRIMARY_PROVIDER` 决定。当前 `.env` 仍是 `ENGINE_RENDER_PRIMARY_PROVIDER=minimax`，所以“切豆包”这个开关覆盖不到模拟器主候选，形成两条链路各说各话。

## 2. 改动

### 2.1 `src/engine-adapters/wiring/render-config.factory.ts`

- `buildCandidates()` 新增 `VISITOR_LLM_PROVIDER` 读取：
  - 未配置 / `minimax` → 候选序列与旧行为逐字一致；
  - `doubao` → 主候选强制 `doubao`，即使 `ENGINE_RENDER_PRIMARY_PROVIDER=minimax` 也让位；
  - `doubao` 且 `ENGINE_RENDER_FALLBACK_PROVIDERS` 为空 → 自动补 `minimax`，避免单候选熔断全损；
  - 非法值启动期抛 `Error`，不静默回落。
- `modelFor()` 在 visitor 豆包模式下增加模型回退：
  - `ENGINE_RENDER_<KIND>_MODEL_DOUBAO` 仍最高；
  - 未配置 provider 维度键时用 `VISITOR_DOUBAO_MODEL`；
  - 再回退 `DEFAULT_VISITOR_DOUBAO_MODEL = doubao-seed-character-260628`；
  - 全局 `ENGINE_RENDER_<KIND>_MODEL` 优先级不变。
- 导入 `DEFAULT_VISITOR_DOUBAO_MODEL`，复用 AF-248 的单一模型默认值，不新写硬编码。

### 2.2 `.env.example`

在 visitor 开关说明补充：`doubao` 同时切换旧 VisitorService 与引擎渲染主候选，并自动补 minimax 回退；`minimax`/未配置时两条链路都保持旧行为。

### 2.3 `test/engine-adapters/af252-visitor-render-provider.spec.ts`

新增 6 例：旧序列不变、doubao 强制主候选 + 自动回退、默认 seed-character、`VISITOR_DOUBAO_MODEL` 覆盖、provider 维度键优先级、fallback 去重、非法值抛错。

## 3. 关键设计决策

- **总开关语义**：`VISITOR_LLM_PROVIDER` 定义为“来访者生成路由总开关”，不是旧语音链路专用；两条链路读同一个值，避免灰度和回滚只改一半。
- **doubao 优先于 `ENGINE_RENDER_PRIMARY_PROVIDER`**：生产现有 env 是 `minimax`，若不让位，切豆包需要同时改两个键，容易出现“以为切了实际没切”。
- **自动补 minimax 回退**：引擎渲染历史上单候选导致 91.8% 兜底句；切豆包时不能把唯一备份也切没。
- **模型仍允许显式覆盖**：provider 维度键 > visitor 模型 > seed-character 默认，保留运维调参空间。
- **默认仍是 minimax**：不配 `VISITOR_LLM_PROVIDER` 时旧行为逐字不变；生产切换只改一个 env。

## 4. 闸门证据

| 闸门 | 结果 |
| --- | --- |
| 定向测试 `af252 + af210` | 2 files / **11 passed**（AF-252 6、AF-210 5），exit 0 |
| 定向 eslint | exit 0 |
| `pnpm lint` | exit 0（0 error） |
| `pnpm exec tsc --noEmit -p tsconfig.json` | exit 0（CI 同口径） |
| `pnpm test` | **259 passed + 1 skipped files / 4254 passed + 4 skipped tests**，exit 0 |
| `git diff HEAD -- src/engine-core` | 空 |

日志：`data/af252-lint.log`、`data/af252-tsc.log`、`data/af252-fulltest.log`。

## 5. 生产切换方式

只改一个键：

```env
VISITOR_LLM_PROVIDER=doubao
```

可选覆盖：

```env
VISITOR_DOUBAO_MODEL=doubao-seed-character-260628
ENGINE_RENDER_CHAT_MODEL_DOUBAO=<显式豆包模型>
```

回滚：改回 `VISITOR_LLM_PROVIDER=minimax` 或删除该键，引擎候选回落到 `ENGINE_RENDER_PRIMARY_PROVIDER`。

## 6. 遗留

- 豆包 per-provider 成本分账仍未实现。
- 多轮/长对话、并发、429/5xx/超时行为仍未验证。
- V5 生产灰度量级、观察指标与停止条件仍未定义。
- 本次只验证装配期候选/模型解析，未做真实引擎渲染路径端到端 smoke；下一步可扩 AF-249 smoke 覆盖 router 路径。

## 7. commit message

`feat(af252): 让 visitor 总开关同时切换引擎渲染主候选`
