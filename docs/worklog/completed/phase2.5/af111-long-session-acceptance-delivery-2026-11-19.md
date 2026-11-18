# AF-111 交付记录 · long 50 轮候选验收口径与双人盲标工具

- 任务：AF-111（rescope 自 AF-110；`agentRole: executor`；依赖 AF-109）
- 分支：`task/AF-111-long-session-acceptance`（基线 `integrate` @ `90c864e974ef234afe7061fddf914bd789d3f8ea`）
- 日期：2026-11-19
- 结论：**候选口径与工具交付完成；出口④仍不可判定，不宣称临床质量达标。**

## 一、交付物

| 类型 | 路径 | 说明 |
| --- | --- | --- |
| 纯函数 | `src/auto-practice/metrics/long-session-acceptance.ts` | 三段边界、9 条锚点、阶段汇总、盲标 packet、线性加权 kappa、一致率、仲裁清单 |
| CLI | `bin/long-session-acceptance.ts` | `pack` / `ingest` / `summarize` 三个子命令，零外部依赖 |
| 单测 | `test/auto-practice/af111-long-session-acceptance.spec.ts` | 8 例，覆盖边界、汇总、候选态、匿名化、kappa、仲裁 |
| 协议 | `docs/worklog/completed/phase2.5/af111-long-session-acceptance-protocol-2026-11-19.md` | 临床锚点、盲标流程、一致性判读、升级条件、限制 |
| README 回写 | `docs/worklog/pending/phase2.5-README.md` §3.2 + §3.2.8 | ④ 行补 AF-111 候选态说明；新增本节摘要 |

## 二、关键设计

- **三段边界**：engagement 1–12 / working 13–40 / closing 41+；`resolveLongSessionPhase` 显式实现，越界抛错。
- **9 条锚点**：联盟、框架与安全、深度推进、自主探索、阻抗修复、情绪调节、收束整合、风险收束、整体风格；每条含正例/反例，均为文字观察，无数值阈值。
- **候选态硬约束**：`LONG_SESSION_ACCEPTANCE_STATUS='candidate'`、`gateEligible: false`、免责声明固定写在评估结果与 packet。不接 `batch-report` / CI / intake 阈值。
- **盲标 packet**：只保留 `turnIndex / role / text`，显式去除 `debugSessionId / title / characterSlug / characterLabel / counselorModeId`；文本本身仍可能带角色线索，协议里写明这一限制。
- **均衡取样**：只取 `completed` 会话；`expert` / `cold` 各自洗牌后交替取样，避免样本偏一档。
- **一致性**：线性加权 kappa（分歧权重 `|i-j|/(k-1)`）+ exact / ±1 一致率；空/单对返回 `null`，不伪造 0 或 1。
- **仲裁**：任一维分差 >1，或评分人 `adjudicate=yes`，进入 `adjudication.csv`。

## 三、闸门证据（实跑）

| 闸门 | 命令 | 退出码 | 结果 |
| --- | --- | --- | --- |
| 类型检查 | `pnpm exec tsc --noEmit -p tsconfig.json` | 0 | 0 error（全仓根 tsconfig） |
| lint | `pnpm exec eslint --cache --cache-strategy content src/auto-practice/metrics/long-session-acceptance.ts bin/long-session-acceptance.ts test/auto-practice/af111-long-session-acceptance.spec.ts` | 0 | 0 error / 0 warning |
| 定向单测 | `pnpm vitest run test/auto-practice/af111-long-session-acceptance.spec.ts` | 0 | 8/8 passed |
| 边界 | `pnpm vitest run test/engine-core/boundary.spec.ts` | 0 | 12/12 passed |
| engine-core diff | `git diff --stat HEAD -- src/engine-core` | 0 | 空（本单未改内核） |

说明：lint 首轮 22 error，其中 20 个由 `eslint --fix` 自动修复（prettier / unicorn 风格），剩 4 个手工处理（CLI shebang、数字字面量、`new Array`、process.exit 识别）；最终 exit 0。类型检查首轮 4 error（索引签名访问、anchor 维度缺 `arousal`），修正后 exit 0。

## 四、CLI 冒烟证据

| 子命令 | 命令 | 结果 |
| --- | --- | --- |
| pack | `pnpm exec tsx bin/long-session-acceptance.ts pack --batch q_35XnpvLWLr-Yocr8kJh --limit 2 --out <temp>` | exit 0；2 packet（22,179 B / 28,741 B）+ 两份评分表 + `blind-map.json` + README |
| ingest | 手工填 2 packet / 12 评分对 → `ingest --rater1 ... --rater2 ...` | exit 0；逐维 kappa 输出（trust 1 / safety -1 / bond 1 / depth 0 / verbal 1 / style 1）；仲裁 1 条 |
| summarize | `summarize --transcript data/debug-sessions/debug_uy_5TkoULCqmf_3_AG7yW.json` | exit 0；三段汇总正常输出，`gateEligible=false` |

冒烟只用临时目录与既有批次，不新跑 LLM、不写仓库数据。

## 五、范围与契约核对

- **scopeCheck**：`in-scope`。所有改动落在任务单 `scope.files` 列出的 6 个路径；未改 `src/engine-core`、未改 intake 阈值、未改 CI。
- **contractChecks**：
  - `taskId`：AF-111，索引与任务单一致；
  - `state-write`：任务状态只经 CLI（rescope / promote / run-once / branch create），未手改索引；
  - `index-schema`：`task-state-index.json` 经 CLI 写入；
  - `event-chain`：`events verify` 本单未跑（收尾统一验证；见遗留）。
- **未混入并行产物**：工作树中状态面/看板改动由本次 CLI 操作产生；`data/phase25-exit` 未新增文件；临时 packet 在 `%TEMP%`，不入库。

## 六、偏差表

| 偏差 | 原因 | 影响 |
| --- | --- | --- |
| AF-110 → AF-111 rescope | AF-110 登记为 `orchestrator`，资源域不含 `src/bin/test`，`run-once` 报 `scope-domain-conflict` | 新单 `agentRole: executor`，`priorTasks: [AF-110]` 保留审计链；AF-110 canceled/archived |
| 协议文档落 `docs/worklog/completed/phase2.5/` | `docs/clinical/` 不在 executor Agent Card resources，写入会被 scope-domain 拦截 | 内容不变；迁回临床目录需另立任务并调整角色资源域 |
| `event-chain` 未在本单跑 | 本单收尾闸门按任务单只要求 tsc/lint/定向 vitest/boundary；`events verify` 属编排状态面收尾 | 归档前统一跑 `events verify` + `status` |
| 冒烟 ingest 的 kappa 值仅 2 packet | 只验证 CLI 形状，不是一致性结论 | 协议明确“2 packet 只能冒烟，不能作结论” |

## 七、遗留 / backlog

1. **真实督导师缺口**：人员与排期未定；没有真实评分，出口④不能判达标。
2. **MAE 未实现**：本工具只算 κ / ±1；AF-091 的 MAE 门槛需后续任务补，不在本单冒充。
3. **文本盲标不彻底**：只去除结构化身份字段，不能去除台词内角色线索；后续可评估“台词改写/去角色词”但不得改变临床语义。
4. **`docs/clinical` 资源域**：若要把协议放回临床目录，需另立任务调整 Agent Card resources，不在本单改政策。
5. **真实试点样本**：建议至少 8 packet（约 400 轮）起，先做 2–3 packet 校准会，再全量盲标。

## 八、结论

- **工具与口径**：可执行、可复算、闸门绿；
- **临床质量**：**仍不可判定 / 未通过**；没有真实双人盲标 + 仲裁，不得写“质量达标”。
- **下一步**：PI 用 `pack` 生成 8 packet → R1/R2 独立评分 → `ingest` 看逐维 κ → 对分歧 packet 仲裁 → 达 100–200 轮后再讨论是否升硬门。
