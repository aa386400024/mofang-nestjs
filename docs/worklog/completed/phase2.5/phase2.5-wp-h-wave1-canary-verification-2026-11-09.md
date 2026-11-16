# WP-H 第一波（渲染可用性）· 金丝雀验证记录

- 日期：2026-11-09 23:15 ~ 23:34（UTC+8）
- 代码版本：`f59c307`（integrate，已推送 `origin/integrate`）
- 验证人：豆包（MainAgent），非 MiniMax Code
- 验证目的：确认 WP-H 第一波 4 项改动上线后，**渲染链路是否真的在调 LLM**、**兜底句是否降下去**，从而判断能否据此开下一轮批量对练

---

## 0. 结论

**第一波修复成立，低负载金丝雀通过。** 同一套 24 场样本，旧产物 vs 当前 HEAD，结果如下：

| 指标 | 旧产物（对照） | 当前 HEAD（实验） | 判定 |
|---|---|---|---|
| 场次 | 24 | 24 | 同规格 |
| `total_tokens = 0` 的场次 | **18 / 24（75.0%）** | **0 / 24（0%）** | 通过 |
| 批次总 tokens | 40,503 | **240,409（5.9×）** | 通过 |
| `degraded_turns` 合计 | **350** | **0** | 通过 |
| `degraded_turns > turn_count` 的场次 | 14 / 21 | **0 / 24** | 通过 |
| 来访者兜底句占来访消息比 | **82.9%（218/263）** | **0.0%（0/244）** | 通过 |
| 咨询师兜底句（"嗯，我在听"）占比 | **50.2%（132/263）** | **0.0%（0/244）** | 通过 |
| 来访话术重复率 | **81.4%**（49 条唯一 / 263 条） | **0.0%**（244 条唯一 / 244 条） | 通过 |
| 退出原因多样性 | 仅 `max_turns` / `*_heavy_degraded` | `max_turns` / `stagnant` / `crisis` / `natural_close` | 通过 |
| 批次成本（数据库口径） | 0.1823 元 | 1.0818 元 | 见 §6.3 |

三个可以直接说死的事实：

1. **旧产物在第 6 场之后就全线崩了**，不是"要跑 300 场才崩"。它的崩塌点是约 **141 次 LLM 调用**（23:16:19 之后每场 1~3 秒结束、token 恒为 0）。
2. **当前 HEAD 在同一时段跑完 244 轮、约 488 次上游调用，一次都没有降级。** 早过了旧产物的崩塌点。
3. **兜底句从 82.9% 直接归零**，逐字稿里每一条来访者发言都是独立生成的新话术，不再复读池里那 4 句。

### 0.1 对照 WP-H 门禁（`phase2.5-README.md` §3.3 第 4 条）

| 门禁项 | 阈值 | 实测（HEAD） | 是否通过 |
|---|---|---|---|
| `total_tokens>0` 场次占比 | ≥ 90% | 24/24 = **100%** | 通过 |
| 兜底句占来访消息比 | < 5% | **0.0%** | 通过 |
| `degraded_turns ≤ turn_count` | 全部满足 | 24/24 场满足（`degraded_turns` 合计 0） | 通过 |

三项全过，**WP-H 第一波的验收门禁解除**，允许开 100 场级批次。

---

## 1. 验证对象与样本

### 1.1 被验的四项改动（WP-H 第一波，提交 `f59c307`）

| 编号 | 改动 | 金丝雀可观测信号 |
|---|---|---|
| 改动 1 | 渲染候选 <2 时给出显式告警 / 可选强失败 | 启动日志出现 `单候选模式: 候选数=1` |
| 改动 2 | 重试改为可配置（`LLM_MAX_RETRIES`），不再吃 LangChain 默认 6 次隐式重试 | 上游抖动时不再无限加压 |
| 改动 3 | 超时即 `abort()`，消灭"幽灵重试" | 超时后后台不再打上游 |
| 改动 4 | 并发复用 `AUTO_PRACTICE_WORKER_CONCURRENCY`，缺省 3→2 | 启动日志出现 `queue started concurrency=2` |

### 1.2 样本设计

| 维度 | 取值 |
|---|---|
| 角色（4） | `vpt_depression_avoidant_l1`（沉舟·回避）<br>`vpt_general_secure_l1`（安然·安全）<br>`vpt_social_anxious_l1`（语桐·焦虑）<br>`vpt_trauma_disorganized_l1`（惊尘·紊乱） |
| 咨询师模式（2） | `expert`（专家）、`cold`（冷漠） |
| 重复 | 3 |
| `maxTurns` | 12 |
| 合计 | 4 × 2 × 3 = **24 场** |

样本覆盖四种依恋风格 × 两种极端咨询师风格，刻意包含最差工况 `cold`，是为了让"渲染是否可用"这件事在有压力的对话里暴露，而不是只在顺风场景下好看。

### 1.3 两个批次 ID

| 批次 | batchId | 跑的代码 | 用途 |
|---|---|---|---|
| 对照 | `gzu9tnrBuXzztNMizliYh` | 18:34 启动的**旧 `dist/app.js`**（编译产物早于 WP-G/WP-H） | 负对照，证明问题可复现 |
| 实验 | `YiBgpQSxbQh_q663IiVbT` | 23:18 重新构建、23:21:48 启动的 **HEAD** | 验收对象 |

两批**同角色、同模式、同重复、同 `maxTurns`、同日同时段（相隔约 8 分钟）**，唯一的变量是运行的代码版本。

---

## 2. 环境事故与纠正（必须记录）

第一轮金丝雀（23:15:31 起）**跑在了旧编译产物上**，先做判定、再纠正，否则数据不可信。

现象与排查链路：

1. `GET /admin/api/auto-practice/batches/:id` 只报 3 条 running，而新代码并发应为 2 → 并发数与代码不符。
2. 查 `node.exe` 命令行：3000 端口由 **PID 10180** 持有，命令是 `node dist/app.js`，启动时间 **18:34:44**。
3. `dist/app.js` 是编译产物；18:34 的构建早于 WP-G（`4063666`）与 WP-H 第一波（`f59c307`），**进程加载到内存里的仍是旧代码**。
4. 顺带发现 **PID 17572 的 `pnpm dev` 是空壳**：`package.json` 根本没有 `dev` 脚本（只有 `start` / `start:dev` / `start:win` / `start:debug` / `start:repl`），该进程无任何子进程，属历史遗留死进程。

处置：

```
Stop-Process 10180, 17572
pnpm build            → exit 0，dist 刷新到 23:18:17
node dist/app.js      → PID 13240，约 90 秒后可用，0.0.0.0:3000 LISTENING
```

**教训（写进纪律）：** 判断"当前代码是否生效"，不能只凭"服务在跑 / 接口 200"。必须比对三件事——**进程命令行里的入口文件**、**入口文件的 mtime**、**启动日志里的版本特征**。三者任一不符，跑批结果一律作废。

---

## 3. 指标定义

| 指标 | 定义 | 为什么用它 |
|---|---|---|
| `total_tokens = 0` 场次占比 | 整场没有任何 token 记账 | 最直接的"LLM 到底有没有被调用"证据 |
| `degraded_turns` | 渲染轮次降级计数 | 兜底回路是否被触发 |
| 来访者兜底句命中率 | 逐字稿中来访者消息命中 4 句兜底池的比例 | 用户可感知的质量；数据库计数器不可全信，必须回文本 |
| 来访话术重复率 | 1 − 唯一话术数/总话术数 | WP-G 的直接验收项 |
| 退出原因分布 | `exit_reason` 取值集合 | 对话是否还会"自然收尾"而不是硬撑到上限 |

> 之所以要"数据库 + 逐字稿"双口径：`degraded_turns` 已知存在双计数缺陷（改动 5 尚未做），单看计数会误判。文本层不受该缺陷影响。

---

## 4. 结果

### 4.1 数据库层

| | 对照 `gzu9tnrBuXzztNMizliYh` | 实验 `YiBgpQSxbQh_q663IiVbT` |
|---|---|---|
| 场次 | 24 | 24 |
| 状态分布 | completed 21 / stagnant 3 | completed 16 / stagnant 5 / crisis_ended 3 |
| `total_tokens = 0` | 18 | 0 |
| 总 tokens | 40,503 | 240,409 |
| 总轮次 | 263 | 244 |
| `degraded_turns` 合计 | 350 | 0 |
| `degraded_turns > turn_count` 场次 | 14 | 0 |
| 单场 tokens 区间 | 0 ~ 11,788 | 4,391 ~ 12,791 |
| `prompt_tokens` 最大值 | 0 | 0 |
| 成本口径 | `output_only` | `output_only` |

### 4.2 逐字稿文本层

| | 对照 | 实验 |
|---|---|---|
| 读到逐字稿 | 24 份 | 24 份 |
| 来访者消息 | 263 条 | 244 条 |
| 来访兜底句 | 218 条（**82.9%**） | 0 条（**0.0%**） |
| 咨询师兜底句 | 132 条（**50.2%**） | 0 条（**0.0%**） |
| 来访唯一话术 | 49 条（重复率 **81.4%**） | 244 条（重复率 **0.0%**） |

对照组 TOP5 高频来访话术（全部是兜底池复读）：

```
55× 我不太想现在讲清楚，能先聊点别的吗？
55× 最近确实有点难说出口……我们慢慢聊吧。
54× ……我先缓一下，我们接着说。
54× 嗯……让我想想，该怎么说。
 1× 嗯……不知道。随便聊聊吧。
```

实验组 TOP5 全部只出现 1 次，且是贴合上下文的独立发言：

```
1× 有点空，没什么特别的感觉。
1× 第二种吧。事情还是那些事，但我没什么感觉。
1× 记不太清了。可能有一阵子了吧，最近也没什么变化。
1× 也不算受不了，就是懒得折腾。
1× 就刷刷手机，或者出去走一会儿。能让脑子停一下就行。
```

### 4.3 逐场时间轴（对照组崩塌过程）

对照批次的 24 场，全在 23:15:31 ~ 23:17:21 之间跑完，**全部在重启（23:21:48）之前**，因此全部是旧产物数据：

```
开始     结束    角色                          模式   轮  token   deg  退出原因
23:15:31 23:16:07 沉舟  expert  12  11281   0   max_turns
23:15:31 23:16:17 沉舟  expert  12  10858   0   max_turns
23:15:31 23:16:19 沉舟  expert  12  11788   0   max_turns
23:16:07 23:16:26 沉舟  cold    12   3687  13   max_turns_heavy_degraded
23:16:18 23:16:28 沉舟  cold    12   1449  19   max_turns_heavy_degraded
23:16:19 23:16:26 沉舟  cold    12   1440  20   max_turns_heavy_degraded
23:16:26 23:16:28 安然  expert  12      0  24   max_turns_heavy_degraded     ← 崩
23:16:27 23:16:29 安然  expert  12      0  24   max_turns_heavy_degraded
...（此后 18 场全部 token=0，单场 1~3 秒结束）
```

解读：前 6 场（约 141 次上游调用）正常，第 7 场起熔断打开，**此后每一场都在 1~3 秒内"跑完"12 轮、token 恒为 0**——因为整场没有一次真实调用。这正是 `89.8%` 全损率的生成机制，在 24 场的小规模上被完整复现。

实验批次的时间轴没有出现任何 token=0 的场次，且退出原因开始分化：

```
23:23:54 ~ 23:31:22，24 场，244 轮
退出原因：max_turns 14 / stagnant 5 / crisis 3 / natural_close 2
```

`crisis` 出现在 `vpt_depression_avoidant_l1`（沉舟）的 3 场，是 WP-G 危机应对话术按预期触发；`natural_close` 说明对话能在该收的时候收，而不是一律撑满 12 轮。

---

## 5. 修复生效证据

启动日志（PID 13240）两行直接对应改动 1 与改动 4：

```
23:21:44 WARN [RenderConfigFactory] [render] 单候选模式: 候选数=1, 熔断将导致全部请求降级,
         批量跑批前请配置 ENGINE_RENDER_FALLBACK_PROVIDERS
23:21:48 INFO [auto_practice] queue started concurrency=2
```

运行期日志确认渲染与咨询师链路在真实工作（每轮均有）：

```
[TurnRenderOrchestrator] render prompt 角色片段: codename=语桐 attachment=- risk=none ...
[counselor_agent] close=false raw_len=74 finish=stop
[debug_chat] 调试轮次完成 session=debug_s9-b0peqX5mzc5iYDmjUn turn=11 elapsedMs=1247
```

单轮耗时 1.2~1.5 秒，属正常档位，说明超时/重试改造没有把正常路径拖慢。

---

## 6. 归因边界（这一批能证明什么、不能证明什么）

### 6.1 能证实的

- **渲染可用性回路已修好**：在旧产物必崩的同一负载区间（>141 次调用、244 轮）内，HEAD 零降级。
- **兜底句不再是常态**：文本层命中率 82.9% → 0%。
- **对话可以自然收尾**：出现 `crisis` / `natural_close` / `stagnant` 三类正常退出。
- **并发 3→2 的改动生效**，且没有把单场吞吐拖垮（24 场 8 分钟跑完）。

### 6.2 不能单独归因给 WP-H 的部分

对照组的旧产物**同时缺 WP-G 和 WP-H**，所以"重复率 81.4% → 0%"这一项是 **WP-G（prompt 层）与 WP-H（可用性层）叠加**的结果，不能全记在 WP-H 头上。可单独归因给 WP-H 的是 token 与降级两项（WP-G 不改变调用是否发生）。

### 6.3 尚未覆盖的（属第二 / 三波，符合预期）

| 项 | 现状 | 归属 |
|---|---|---|
| `prompt_tokens` 恒为 0 | 两批都是 0，成本口径只能是 `output_only` | 改动 7（第三波） |
| 成本被系统性低估 | 只见 completion tokens，prompt 一分钱没入账 | 改动 7 |
| `engine_version` = `dev` | 两批无法从数据里区分版本 | 改动 8（第三波） |
| `degraded_turns` 计数器语义 | 本次为 0，无法证伪其双计数缺陷 | 改动 5（第二波） |
| 降级率独立指标（`render_fallback_ratio`） | 列不存在，无法出降级率 | 改动 6（第二波） |
| 高并发 / 长时压测 | 只跑到 24 场、并发 2、单小时窗口 | 建议下一轮 |

### 6.4 一个必须说清的怀疑点

实验组的"来访话术重复率 0.0%"字面看过于理想。它的可信来源是：`maxTurns` 只有 12、24 场共 244 条短发言，LLM 在这种情况下本就能做到条条不同。**这不代表长对话（30~50 轮、300+ 场）不会出现结构性复读**——`engine_version` 还标不出差异、`prompt_tokens` 还看不到，所以下一轮 100 场级验证时，这一项必须重新测，不能拿 0.0% 当作长期结论。

---

## 7. 下一步建议

1. **开一轮 100 场级验证**（8 角色 × 全部 7 种模式，`maxTurns` 12~20），目标是把负载推到旧产物崩塌点的 5~10 倍，确认 HEAD 在长时窗口内仍不降级。开跑前必须先确认进程入口 mtime 与启动日志特征（§2 教训）。
2. **WP-H 第二波优先做改动 6**（`render_fallback_ratio` 独立指标 + 迁移），否则降级率永远只能靠扒文本，验收成本高。
3. **改动 7（`prompt_tokens` 归约）应提到第二波**：现在成本只有 output 口径，100 场批次的实际花费会被低估数倍，直接影响"这个实验能不能多跑几轮"的判断。
4. 批次有效性门禁（改动 9）在 100 场验证前落地更好——否则又要靠人工记录 batchId 与代码版本的对应关系。

---

## 8. 附录：复现方式

四个运维脚本已落在 `scripts/ops/canary/`（PM2 之外的只读诊断，均需在仓库根执行）：

```powershell
# 1) 批次指标汇总（状态 / token / 降级 / 退出原因）
node scripts/ops/canary/batch-metrics.mjs <batchId>

# 2) 逐场时间轴（一眼看出哪一场开始崩）
node scripts/ops/canary/session-timeline.mjs <batchId>

# 3) 逐字稿文本审计（兜底句命中率 / 重复率 / TOP 高频话术）
node scripts/ops/canary/transcript-audit.mjs <batchId1> <batchId2>

# 4) 队列只读巡检（默认只看不删；--drain 才清空排队任务）
node scripts/ops/canary/queue-inspect.mjs
```

环境核对（每次跑批前必做）：

```powershell
Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
  Select-Object ProcessId, CreationDate, @{N='Cmd';E={$_.CommandLine}}
(Get-Item -LiteralPath "dist\app.js").LastWriteTime
Get-Content (Join-Path $env:TEMP "mofang-app.out.log") -Encoding utf8 |
  Select-String "单候选模式|queue started concurrency"
```

三者必须同时满足：入口为 `dist/app.js`、mtime 晚于最后一次改动、启动日志含 `单候选模式` 与 `concurrency=2`。

---

## 9. 落库状态

- 代码：`f59c307`，已推送 `origin/integrate`（`94d9982..f59c307`）。
- 本记录：新增文件，**尚未提交**（等确认后单独 `docs(phase2.5): WP-H 第一波金丝雀验证记录`）。
- 两次跑批产生的逐字稿在 `data/debug-sessions/`（不入库）；对照组 24 份属旧产物数据，实验组 24 份属 HEAD 数据，两者已在 `.gitignore` 排除范围内。
