# WP-H 第二波 + 第三波 + 批次可观测性收口 · 执行任务单

- 日期：2026-11-10
- 执行方：MiniMaxCode
- 委托方：主 Agent（豆包）
- 上游依据：[`wp-h-render-availability-fix-task.md`](wp-h-render-availability-fix-task.md) 第五节的改动 5~9（**原文即规格，本单不重写**）
- 前置事实：[`phase2.5-wp-h-wave1-canary-verification-2026-11-09.md`](phase2.5-wp-h-wave1-canary-verification-2026-11-09.md)（第一波已过门禁；同时记录了"服务跑旧 dist"事故）
- 当前 HEAD：`f59c307`（`origin/integrate` 已同步）

---

## 〇、本单目标（一句话）

**把"这一批数据来自哪份代码、花了多少钱、有多少轮是真的调了模型、这批数据能不能用"这四件事，变成数据库里能直接查到的字段和能自动判定的门禁。**

第一波解决的是"LLM 回不回来"；本单解决的是"回来之后，数据可不可信"。

---

## 一、硬约束（先看这节，违反即返工）

### 1.1 红线（与 WP-G / WP-H 一致）

- ❌ 不动 `src/engine-core/` 下任何文件
- ❌ 心理内容（咨询师/来访者对话原文）禁止进日志、禁止进异常上报、禁止进新增字段（只允许数字与枚举标签）
- ❌ 不为了让测试变绿而修改既有断言；测试失败必须归因，不许 `skip` / `todo` 掩盖
- ❌ 不顺手重构、不扩大改动面、不引入新的大依赖（embedding / ORM / 客户端库一律不加）
- ❌ 不自动 `git commit` / `git push`（本仓约定：提交由主 Agent 统一执行）

### 1.2 文件所有权（**防并发冲突，硬边界**）

主 Agent 正在并行做 **WP-J（停滞判定重设计 + 危机后置练习窗）**。以下文件归主 Agent独占，本单**一行都不许改**：

| 禁改文件 | 原因 |
|---|---|
| `src/auto-practice/practice-runner.service.ts` | WP-J 正在重写停滞判定与危机分支 |
| `test/auto-practice/practice-runner.spec.ts` | 同上（回归用例在重写） |
| `src/engine-adapters/rendering/` 下所有 prompt 文案 | 来访者饰演 prompt 归主 Agent调 |
| `scripts/ops/canary/` | 主 Agent的诊断脚本 |

**改动 5 / 改动 6 里"落在 `practice-runner.service.ts` 的计数写入"这一半，由主 Agent 认领**。本单只交付这两项的**另一半**：实体列、迁移、端点聚合、`_heavy_degraded` 判定所需的字段就绪。分工边界见 §三。

### 1.3 不许跑批量实验

批量跑批由主 Agent统一发起（同一台机器、同一个 Redis 队列，两边同时跑会互相抢 worker，且批次数据会混）。
**本单验收只允许跑单场（`POST /admin/api/auto-practice/sessions`，≤3 场）或纯单测。**

### 1.4 起服务前必须核对三件事

这个坑昨晚刚踩过（详见金丝雀记录 §2）：3000 端口可能被**旧编译产物**占着。

```powershell
Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
  Select-Object ProcessId, CreationDate, @{N='Cmd';E={$_.CommandLine}}   # 入口必须是 dist/app.js
(Get-Item -LiteralPath "dist\app.js").LastWriteTime                     # 必须晚于最后一次改码
Get-Content (Join-Path $env:TEMP "mofang-app.out.log") -Encoding utf8 |
  Select-String "单候选模式|queue started concurrency"                  # 启动特征
```

注意：`pnpm dev` **不是**本仓的脚本（`package.json` 里没有 `dev`），请用 `pnpm start:dev` 或 `pnpm build` + `node dist/app.js`。

### 1.5 已知的 4 条测试失败不是你的锅

当前全量测试基线是 **4 failed / 2575 passed**，全部由主 Agent 的提交引入（`POST characters` 与 `GET characters` 路由重名 3 条 + `MAX_DEBUG_SESSIONS` 用例未同步 1 条）。

**不要修它们，也不要掩盖**。你的验收标准是"失败集合不扩大"，不是"全绿"。交付记录里如实写"4 条既有失败，与本单无关"。

---

## 二、本单范围

### 2.1 照原任务单执行的（引用，不重写）

| 编号 | 内容 | 规格出处 |
|---|---|---|
| 改动 5 | `degraded_turns` 拆双计数器（含迁移） | 原任务单 §五·改动 5 |
| 改动 6 | 渲染降级率独立指标（3 列 + 批次聚合） | 原任务单 §五·改动 6 |
| 改动 7 | `prompt_tokens` 归约链 | 原任务单 §五·改动 7 |
| 改动 8 | `engine_version` 走 `git describe --always --dirty` | 原任务单 §五·改动 8 |
| 改动 9 | 批次有效性门禁 | 原任务单 §五·改动 9 |

### 2.2 本单新增的三项（原文里没有，属批次可观测性）

#### 新增 10：日志降噪开关（跑批期关 TypeORM query 日志）

**现状**：昨晚一次 24 场的批次，10 分钟内日志刷到 93KB，全是 `query: SELECT ...` 逐条 SQL，真正的关键行（渲染降级、队列状态）被淹没，只能靠 grep 捞。批量跑 100 场时这个量级会失控。

**改成**：

1. 新增 env `DB_QUERY_LOGGING`（布尔，缺省 **false**）。
2. 装配处读取：`logging: ['error', 'warn', 'migration'] + (DB_QUERY_LOGGING === 'true' ? ['query'] : [])`。
3. **`error` / `warn` 永远保留**，不许一并关掉；慢查询（`slowQuery` 阈值 1000ms）保留。
4. `.env.example` 补该键并注明"批量跑批时保持 false"。

**验收**：`DB_QUERY_LOGGING` 未配 → 日志里不出现 `query:` 行；配 `true` → 出现；`error` 级日志两种情况都在。

#### 新增 11：WS 空房间短路

**现状**：批量跑时每轮都打 `推送 ap:turn → xxx 时房间为空 (无客户端订阅)`，24 场 × 12 轮产生上百条 WARN，既是噪音也在白跑推送逻辑。

**改成**：

1. `publishToSession` 在 `io.sockets.adapter.rooms.get(sessionId)` 为空时**直接 return**，不做序列化、不 emit。
2. 该情况降为 `debug` 级，且**同一 session 只打一次**（内存 Set 去重，session 结束清理）。
3. 单场实时（有订阅）路径的行为与延迟不变 —— 这条要有回归用例。

**验收**：无订阅时不再出现 WARN；有订阅时消息照常到达（用单测或 socket.io-client 本地 stub 均可，不许连生产）。

#### 新增 12：批次 → 逐字稿索引文件（不改现有路径）

**现状**：多批实验的逐字稿全部落在 `data/debug-sessions/` 扁平目录，文件名只有 `debug_session_id`，只能靠 DB join 才能知道哪份属于哪一批。做 A/B 对比时极易拿混（昨晚就差点拿混）。

**改成**（**只加索引，不动现有写入路径与读取逻辑**，避免 admin 调试页读不到）：

1. 批次结束时（与改动 9 同处）写一份 `data/debug-sessions/_batches/<batchId>.json`：
   ```json
   { "batchId": "...", "engineVersion": "...", "createdAt": "...",
     "sessions": [{ "practiceSessionId": "...", "debugSessionId": "...", "characterSlug": "...",
                    "counselorModeId": "...", "status": "...", "turnCount": 12 }] }
   ```
2. **不含任何对话文本**（只有 id 与枚举）。
3. 该目录加入 `.gitignore`（`data/` 已整体忽略，确认即可，不要重复加）。
4. 文件写入失败只 `warn`，不许让批次收尾失败。

**验收**：跑 1 场单场也能生成索引；索引内容与 DB 记录逐字段一致；删掉索引不影响任何读取路径。

---

## 三、交接契约（**本单必须先交付这一块**）

主 Agent的 WP-J 要在 `practice-runner.service.ts` 里写这些计数器，所以**列名与迁移必须先落地**。请把这一块作为第一个交付物，做完即可先回报一次，不必等全部收口。

### 3.1 实体新增列（`src/auto-practice/entities/practice-session.entity.ts`）

| 列名 | 类型 | 缺省 | 语义 |
|---|---|---|---|
| `counselor_degraded_turns` | INT | 0 | 咨询师侧降级轮数，每轮最多 +1 |
| `visitor_degraded_turns` | INT | 0 | 来访者侧降级轮数，每轮最多 +1 |
| `render_fallback_turns` | INT | 0 | 来访者侧走兜底的总次数 |
| `llm_call_turns` | INT | 0 | 来访者侧真实调用的轮数 |
| `render_fallback_ratio` | DECIMAL(5,4) NULL | NULL | `render_fallback_turns / turn_count`，写时计算 |

**旧列 `degraded_turns` 保留不动**，写入时取 `max(counselor, visitor)`（原任务单口径，不要改）。

### 3.2 迁移要求

- 一笔迁移，文件名沿用仓库现有时间戳规范（当前最新是 `1714900000034` 量级，请取比它大的序号）。
- `up` 加列 + 回填（`degraded_turns` 按 50/50 拆分没有信息量，**回填一律写 0 并在迁移注释里写明"历史场次不可反推"**，不要伪造数据）。
- `down` 必须能干净删列。
- `pnpm migration:show` 能正确列出。

### 3.3 交接回报格式

列与迁移落地后，在交付记录里单独一节写：

```
【交接】实体列与迁移已落地
- 迁移文件名：xxx
- 新列：counselor_degraded_turns / visitor_degraded_turns / render_fallback_turns / llm_call_turns / render_fallback_ratio
- up/down 已验证：是
- practice-runner.service.ts 未改动：是
```

主 Agent 看到这一节后才开始写计数逻辑，避免撞车。

---

## 四、验收门禁（交付记录里必须填真实数字，不许留"待用户执行"）

| 项 | 合格线 |
|---|---|
| `npx tsc -p tsconfig.build.json --noEmit` | exit 0 |
| 本单涉及的单测 | 全绿，且用例数写清楚 |
| 全量 `npx vitest run` | 失败集合 **不扩大**（基线 4 failed / 2575 passed，4 条为既有问题） |
| `npx eslint --no-cache`（本单改动文件） | 0 error、0 warning |
| 迁移 | `up` / `down` 双向可执行 |
| 改动 5 | 全库断言 `counselor_degraded_turns <= turn_count AND visitor_degraded_turns <= turn_count` |
| 改动 6 | 单场跑批后三字段与人工核对一致（写清核对了哪几场） |
| 改动 7 | 上游给 `promptTokens` → 落库非 0；未给 → 落 `null` 且 `cost_basis='output_only'` |
| 改动 8 | dirty → 含 `-dirty`；clean → 不含；无 `.git` → `unknown` |
| 改动 9 | 构造降级率 50% 的批次 → `valid=false` 且端点返回 `warning` |
| 新增 10 | 未配 → 无 `query:` 行；配 `true` → 有；error 级始终在 |
| 新增 11 | 无订阅 → 无 WARN 且同 session 只 1 条 debug；有订阅 → 消息正常 |
| 新增 12 | 索引文件字段与 DB 一致；不影响任何读取路径 |

---

## 五、交付格式

1. 交付记录写到 `docs/worklog/completed/phase2.5/phase2.5-wp-h-wave2-3-implementation-2026-11-10.md`，结构照第一波那份（落点表 / 偏差 / 闸门数字 / 改动文件清单 / 遗留）。
2. 顺手更新 `docs/worklog/pending/phase2.5-README.md` 的 WP-H 行状态与 §3.3 顺序。
3. `wp-h-render-availability-fix-task.md` 顶部状态行追加"第二/三波已交付"。
4. `.env.example` 补：`DB_QUERY_LOGGING`、`ENGINE_VERSION`（改动 8 的覆盖项）、以及改动 5/6 涉及的键（如有）。
5. Commit message 草稿（**不要自己提交**）：
   ```
   fix(phase2.5): 指标可信度与版本追溯 (WP-H 第二/三波)
   - degraded_turns 拆双计数器 + 回填 0 (历史不可反推)
   - 新增 render_fallback_turns / llm_call_turns / render_fallback_ratio
   - prompt_tokens 归约链补齐 (此前全库恒为 0)
   - engine_version 改 git describe --always --dirty 派生
   - 新增批次有效性门禁, 不合格批次标记 INVALID 不进分析
   - 跑批期关 TypeORM query 日志 (DB_QUERY_LOGGING, 缺省 false)
   - WS 空房间短路 + 逐字稿批次索引 (不含对话文本)
   ```

---

## 六、环境现状（别浪费时间在这上面）

| 项 | 现状 |
|---|---|
| Node | v22.23.2（`package.json` 要求 ≥26，只报 WARN，不影响运行） |
| Qdrant | `http://qdrant:6333` 不可达 → RAG 禁用，属既有环境问题，与本单无关 |
| Redis / MySQL | 均可达（远程 `117.72.30.78`），连接参数在 `.env`，**禁止把密码写进任何文档或日志** |
| 渲染候选 | 只有 minimax 一家（`ENGINE_RENDER_FALLBACK_PROVIDERS` 为空），单候选告警是**预期行为**，不要去"修"它 |
| 全量测试基线 | 4 failed / 2575 passed（见 §1.5） |

---

## 七、做完之后等我做什么（供你理解上下文，不必执行）

1. 主 Agent 在 `practice-runner.service.ts` 写入双计数器与降级率计数（依赖 §三 的列）。
2. 主 Agent 并行交付 WP-J：停滞判定重设计（判据从"咨询师复述相似度"改为"来访者信息增量"）+ 危机后置练习窗（危机后不掉线，续 4 轮练应对）。
3. 两者合流后跑 100 场级批次，用改动 9 的门禁自动判定有效性，用 §四 的指标做来访者质量评测。
