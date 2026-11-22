# Phase2 封版收口 任务单

> **路径**：`docs/worklog/completed/phase2/phase2-freeze-closeout-2026-11-08.md`
> **状态**：✅ 已交付
> **交付记录**：[`phase2-freeze-closeout-implementation-2026-11-08.md`](phase2-freeze-closeout-implementation-2026-11-08.md)
> **交付日期**：2026-11-08
> **创建日期**：2026-11-08
> **前置文档**：先读 `docs/worklog/README.md`（尤其 §1「当前有什么活」与 §2「红线与交付格式」）、`docs/README.md`、`docs/team/conventions.md`
> **上游依据**：
> - 审计报告 `docs/worklog/audits/phase2-code-vs-blueprint-audit-2026-11-08.md`
> - WP 母版 `docs/worklog/pending/phase2-wp-list-2026-11-03.md`
> - 总览母版 `docs/worklog/pending/phase2-overview-2026-11-03.md`
> - 文档收尾交付记录 `docs/worklog/completed/phase2/phase2-docs-tidy-up-implementation-2026-11-08.md`
> **性质**：**文档 + 测试夹具** 单。零 `src/` 业务实现改动，**engine-core 零改动**（唯一可能的 `src/` 例外写在 §7.2，且需在交付记录里逐行列出）。

---

## 一、背景与目标

### 1.1 现状（实测，非引用）

| 维度 | 实测值 | 取证方式 |
|---|---|---|
| WP 账 | **43 条**（WP27–WP69，无缺号 / 无重复），**38 ✅ / 5 未完成** | 母版登记表逐行 43 行；脚本解析 |
| 未完成 5 条 | WP27 / WP29 / WP33 / WP39 / WP40，**全属商业化 / 合规，非引擎** | 母版第 14 / 16 / 27 / 40 / 41 行 |
| 交付记录 | `completed/phase2/` **99 份文件**，其中 implementation **49 份**，独立单 **9 条** | 目录清点 |
| `pending/` | **只剩两份母版**（`phase2-overview` / `phase2-wp-list`）—— 已无待开工任务单 | `ls pending/` |
| 类型闸门 | `tsc -p tsconfig.build.json --noEmit` → **0 error**（47s） | 实跑 |
| 测试闸门 | 142 文件 / **2338 例** → 2315 绿、**4 红**、19 skip（681s） | 实跑，见 §2 |
| git | HEAD `bde6d8f`（`integrate` 分支）；工作区 5 改 + 4 新增**全是文档，零 src 未提交**；**仓库零 tag** | `git status --short` / `git tag --list` |

### 1.2 本单解决的是哪 4 个封版阻塞

引擎能力层面已经做完（38/43，剩余 5 条与引擎无关）。**封不了版的原因是"账、闸门、承接、记录"四件事不齐**，不是功能不够：

| # | 阻塞 | 为什么卡封版 |
|---|---|---|
| A | 全量测试 **4 红**（3 条确定性 + 1 条并行 flake） | 在红色闸门上盖章不叫封版 |
| B | **WP47 标 ✅ 但 `docs/worklog` 全树零记录** | 一个 WP 只有勾没有证据，母版的可信度就破了 |
| C | 5 条移 Phase4 **无承接文档**（只在 roadmap 一句话里） | 移交即丢失，Phase4 开工时没人知道这 5 条欠着 |
| D | **封版这件事本身没有记录** | 三个月后没人能回答"Phase2 封了什么、没封什么" |

**目标**：把 A/B/C/D 四件做掉，让 Phase2 可以按 `38/43` 的口径正式封版，并把 Phase2.5 的入口条件写清楚。

---

## 二、A ｜ 测试闸门：把 4 红修到 0

### 2.1 A1 · 日期夹具（3 条确定性失败）

**失败清单**（`test/admin-debug/deliberation-stats.spec.ts`）：

| # | 用例 | 断言行 | 失败输出 |
|---|---|---|---|
| 1 | ② 写入侧 · 日 key > 全局 key 与当日日 key **同时**累加 | 482 | `expected undefined to be '1'` |
| 2 | ② 写入侧 · 日 key > 日 key 的 TTL = 90 天 | 495 | `expected undefined to be 7776000` |
| 3 | ⑤ 端点接线 · 窗口 > days=7 → 聚合最近 7 天的日 key | 795 | `expected 5 to be 6` |

**根因（已定位到行，不是猜测）**：

- 夹具 `buildRecord()` 的默认 `timestamp` **写死**成 `'2026-11-07T00:00:00.000Z'`（**第 221 行**）。
- 该时刻在上海口径（`Asia/Shanghai`，固定 UTC+8）是 **2026-11-07 08:00** → 写入侧按 `resolveDeliberationStatsDay(record.timestamp)` 把它归到 **11-07** 的日 key（`deliberation-stats.ts:292`）。
- 但三条用例的期望值用 `todayKey()`（`spec:297-298`，= `shanghaiDateKey(new Date())`）→ 实际是 **11-08**。**"夹具的历史日期" vs "断言的今天"** 两边对不上。
- 第 3 条还有一层叠加：`spec:790-791` 把"昨天"的日 key 手动写成 `total_turns='5'`，而"昨天"=11-07 **正好就是夹具那一天** → 把夹具自己写进去的 `1` 覆盖成 `5` → 期望 6 实得 5。

**为什么它昨天绿、今天红**：交付那天（2026-11-07）`todayKey()` 恰好等于夹具日期，所以是绿的；跨过零点后**永久红**。这不是环境问题，是**夹具吃绝对日期**。

**要做的事**：

1. 把 `spec:221` 的默认值改成 `timestamp: new Date().toISOString()`（不再写死任何日期）。
2. 三条失败用例的期望值**不再从墙上时钟取**，改为从 `record.timestamp` 推导：
   - 期望日 key = `${buildDeliberationStatsKey()}:${resolveDeliberationStatsDay(record.timestamp)}`（或 `buildDeliberationStatsDailyKey(resolveDeliberationStatsDay(record.timestamp))`）；
   - 第 3 条：`yesterday` 改成"相对 `record.timestamp` 的前一天"，或让夹具与 `yesterday` **明确用两个不同的日子**，避免覆盖。
   - 补充（**推荐做法，用来关掉最后一处时钟依赖**）：用例 3 里 `yesterday`（`spec:790`）与 `window.to`（`spec:799`）都取自墙上时钟，与夹具各算一次 `new Date()`，理论上仍有跨零点的极小窗口。做法是在用例开头 `const now = new Date()`，`vi.setSystemTime(now)` 钉住（`vi` 已在 `spec:32` 导入），结尾 `vi.useRealTimers()`；钉住之后 `buildDeliberationStatsDateKeys(2, now)[0]` 与 `shanghaiDateKey(now)` 都从同一个 `now` 出，跨零点也不会分家。
   - 需要的符号**都已经在 import 里**（`resolveDeliberationStatsDay` / `buildDeliberationStatsDateKeys` / `buildDeliberationStatsKey` 在 `spec:38-54`，`shanghaiDateKey` 在 `spec:63`），无需新增 import。
3. **保留不动**（这些是故意用固定日期的口径用例，不是 bug）：
   - `spec:511` `buildRecord({ timestamp: '2026-11-07T16:10:00.000Z' })`（显式断"UTC 16:10 = 上海次日 00:10"的跨天口径）；
   - `spec:501-505` 两条固定日期断言（`resolveDeliberationStatsDay` 的日界判定）。

**验收（三条都要做，缺一条不算交付）**：

1. `npx vitest run test/admin-debug/deliberation-stats.spec.ts --reporter=dot` → **1 文件全绿**。
2. **时钟无关证明**：临时把 `spec:221` 的默认改成 `'2026-01-01T00:00:00.000Z'`（一个远离今天的日期），再跑同一单文件 —— **仍须全绿**；证明完改回 `new Date().toISOString()`。这一步用来钉死"断言不跟时钟走"。
3. 交付记录里贴出该文件里所有硬编码日期的 grep 结果（应只剩 `spec:511` 与 `spec:501-505` 的刻意用例），并逐条说明为什么保留。

**不做什么**：

- ❌ 不许把期望值改成硬编码 `2026-11-08`（下个月照样挂）。
- ❌ 不许 `it.skip` / 删除用例 / 放宽断言到 `toBeGreaterThan(0)`。
- ❌ 不许改 `src/engine-adapters/deliberation/deliberation-stats.ts` 的日期口径来迁就测试 —— **产品侧写入/读取两侧都走 `shanghaiDateKey`，口径是对的**，错的是夹具。

### 2.2 A2 · WP38 并行 flake（1 条）

**失败清单**：`test/admin-debug/wp38-debug-session-resume.spec.ts` > `③ 重启后恢复` > **「重启后调 resume → 会话活过来, 能接着发消息 (轮次接着往下数)」**（`it` 在第 278 行，失败点是**第 309-312 行**的 `waitFor`，10s 内条件未成立）。

**关键事实**（决定怎么修，先看清再动手）：

- `waitFor` 默认 `timeoutMs = 10_000`（**第 182 行**），轮询间隔 10ms，条件读会话 JSON 文件检查 `raw.title === '兜底标题'`。
- 标题是**异步副作用**：`debug-session.service.ts:569` `void this.generateTitle(...)`，方法体 `:898-916`，**catch 里只 warn**（`:912-914`），失败时保留兜底标题 —— 也就是说"写失败"和"还没写完"在测试侧**长得一模一样**。
- 标题落地写：`debug-session-store.ts:253` `updateTitle` → `enqueue(id, …)`（按会话串行）→ 临时文件 + `rename`（原子）。
- 生成器在测试里是注入的：`spec:166` `{ generate: async () => '兜底标题' }` —— 所以**慢的不是 LLM**，是文件写/队列在 142 个并行 worker 下的排队与磁盘延迟。
- **单独跑该文件是绿的**（已实测）→ 判定为并行压力下的 flake，不是逻辑错。

**要做的事（按顺序，不许跳步）**：

1. **先加诊断**：`waitFor` 超时抛错时把现场带出来 —— 读到的 `title` / `titleSource` / 文件是否存在；**禁止**打印对话正文或 prompt（心理内容红线）。
2. **上调这个异步副作用的等待上限**：`spec:309-312` 这个调用点的 `timeoutMs` 提到 `30_000`（等待异步副作用、不是掩盖逻辑；`waitFor` 的默认值留给其它调用点）。
3. **连续验证**：该单文件连跑 **10 次**全绿；再跑 **2 次全量** `npx vitest run --reporter=dot` 全绿。
4. **若 30s 仍红**：不要继续加时间，按**真实缺陷**处理 —— 在交付记录里给出观测结论（是 `enqueue` 排队饿死、还是 `rename` 在并发读下失败 + catch 吞掉），并给出最小修法（例如 `generateTitle` 失败重试一次 / 把 `void` 改成可等待的 `pendingTitles` 集合，供测试 `await`）。**这类改动若碰 `src/`，必须在交付记录 §2 逐行列出并说明必要性**。

**不做什么**：

- ❌ 不许用 `await sleep(…)` 代替条件轮询。
- ❌ 不许 `skip` 这条用例（它守的是"重启后能从最后一轮继续、轮次接着往下数"这个真能力）。
- ❌ 不许删掉"等标题落定"这段（删了会在 Windows 上撞 `ENOTEMPTY`，清理临时目录失败）。

### 2.3 A 的完成定义

- `npx tsc -p tsconfig.build.json --noEmit` → 0 error；
- `npx vitest run --reporter=dot` → **failed 0**（skip 数量不得比现在 19 更多）；
- `npx eslint` 对本单改动的文件 0 warning / 0 error；
- **全量连续 2 次绿**（并行 flake 必须用重复来证明，单次绿不算）。

---

## 三、B ｜ WP47 账实对齐

### 3.1 事实

- `phase2-wp-list-2026-11-03.md` **第 55 行**：`| **WP47** ✅ | supervisor 督导报告切真 DB | …` 备注「**2026-10-26 完成，清单回写补登**」，并写了落地摘要（仓储 `SupervisionReportRepositoryMemory` → `SupervisionReportRepositoryTypeorm`、手写 migration 建表 16 列 3 索引、`UNIQUE (tenant_id, session_id)` 守"一场一份报告"、BullMQ 重试不堆多份）。
- **但 `docs/worklog` 全树没有任何 WP47 记录**：`Get-ChildItem -Recurse` 按文件名匹配 `47` / `supervision` / `wp47` 零命中；`completed/phase1/` 各目录也没有。也就是说这是**唯一一个"标 ✅ 但零证据"的 WP**。
- 代码侧确实存在（说明活是真做了）：`src/agent/supervisor/data/supervision-report.repository.typeorm.ts`、`…repository.memory.ts`、`src/agent/supervisor/domain/entities/supervision-report.entity.ts`、`src/migration/1714900000020-AddSupervisionReports.ts`。

### 3.2 要做的事（二选一，选哪个由考古结果决定）

**先考古**（两条命令，实测过第一条能命中提交）：

```powershell
git log --all --oneline -S 'SupervisionReportRepositoryTypeorm' -- src
git log --all --oneline --diff-filter=A -- src/migration/1714900000020-AddSupervisionReports.ts
```

- **路径一（能定位到提交）**：在 `docs/worklog/completed/phase2/` 新建**补登交付记录** `engine-wp47-supervision-report-typeorm-backfill-2026-11-08.md`，必须包含：
  1. 标题与状态行明确写「**补登**（工于 2026-10-26，本记录 2026-11-08 回填，非当期交付）」；
  2. **commit hash + 日期 + 提交标题**（考古结果）；
  3. 改动文件清单（逐个路径，含 migration 与 entity）；
  4. 表结构要点：16 列 / 3 索引 / `UNIQUE (tenant_id, session_id)`；
  5. 不变量与边界：一场会话一份报告、重试不堆多份、内存实现保留给单测；
  6. `engine-core` 改动情况（应为**零改动**，需实测 `git show <hash> --stat -- src/engine-core` 为空才敢写）；
  7. 当时闸门数字（找不到就写「记录缺失，未留存」，**不许编**）；
  8. 删掉/改写母版第 55 行备注里的「回写补登」表述 → 改成「补登记录见 <链接>」。

- **路径二（考古失败）**：不改历史，改**口径**——把母版第 55 行的 ✅ 保留但加限定，并在同一行写明「**无独立交付记录**（工于 2026-10-26，早于 Phase2 工作流，代码证据在 `src/agent/supervisor/` + migration `1714900000020`）」，同时在 `README.md` 的进度注记里补一句，避免后人再翻不到。

**验收**：母版里**不存在任何"✅ 但既无记录、也无替代口径说明"的行**；`completed/phase2` 里若新增文件，命名与既有 `engine-wpXX-…-implementation-YYYY-MM-DD.md` 一致。

---

## 四、C ｜ Phase4 承接清单（5 条移交单）

### 4.1 事实

5 条未完成 WP 目前**只存在于 roadmap §9 的一句话**（「未完成 5 条均属商业化/合规，已移 Phase4」）。`pending/` 里没有承接文件，`git tag` 为零 —— 也就是说这 5 条今天起**没有任何文档承载**。

### 4.2 要做的事

新建 `docs/worklog/pending/phase4-backlog-2026-11-08.md`，表头固定为：`编号 / 名称 / 优先级 / 原始内容 / 依赖 / 解除条件 / 范围与产出 / 为什么不在 Phase2 做`。内容按母版原文（**不许改写范围**），依赖链按母版已写死的（WP33←WP27，WP39←WP33，WP40←WP33）：

| 编号 | 名称 | 优先级 | 依赖 | 解除条件（真正的阻塞点） |
|---|---|---|---|---|
| WP27 | billing 接真支付 | 🔴 P0 | — | 微信支付 V2 + 支付宝当面付**商户号到手**；订单落库、回调验签、替换现有内存 mock |
| WP29 | 数据分级留存与销毁 | 🔴 P0 | — | **留存年限拍板**（法务 / 等保口径）；用户删除权（对话+记忆+账号）、导出权、分级策略 |
| WP33 | 会员分层 TTS | 🔴 P0 | WP27 | 会员档位定稿 + `tier→model` 可扩展配置表（env 或 DB），会话启动查一次并缓存 |
| WP39 | TTS emotion 映射 | 🔴 P0 | WP33 | BDI valence/arousal → `voice_setting.emotion` 映射表 + 真机听感校准 |
| WP40 | TTS 内联语气词标签 | 🔴 P0 | WP33 | prompt 注入 `(sighs)`/`(pant)`/`(breath)` 等标签并让 TTS 真发声 |

另外在文件开头写清一句定性：**这 5 条同时是"能收费运营"的硬前置**（WP27/WP33/WP39/WP40 四条串成计费与分层，WP29 是合规底线），Phase4 不是"以后有空再说"，是有明确前置条件的外部阻塞。

并在 `phase2-wp-list-2026-11-03.md` 的「未完成 5 条」处加一行交叉链接指向该文件。

**验收**：文件存在、5 条齐全、依赖链与母版一致、每条都有可判定的"解除条件"（不是"待定"）。

---

## 五、D ｜ 封版记录

### 5.1 要做的事

新建 `docs/worklog/completed/phase2/phase2-freeze-2026-11-08.md`，作为 **Phase2 的封版凭证**。必须能让人只看这一份就回答"封了什么 / 没封什么 / 下一步"。固定八节：

1. **封版口径**：`38 / 43`，43 条的边界（WP27–WP69），5 条未完成与它们的去向（Phase4，链接 C 清单），9 条独立单不计入分母的口径。
2. **闸门实测**（数字 + 命令 + 耗时）：tsc 0 error；全量 142 文件 / 2338 例 / 0 failed / 19 skip；eslint 0；`boundary.spec.ts` 断言全绿（**写实际条数，不要抄 `docs/worklog/README.md:115` 的「11 条」—— 那是陈旧值，母版与审计都按 13 条记**）；engine-core `git diff --stat HEAD -- src/engine-core` 为空。
3. **交付覆盖核查**：99 份文件 / 49 份 implementation / 9 条独立单；**并写明 WP47 的处理结论**（补登 or 口径限定，指向对应文件）。建议附一张"38 个 ✅ 的 WP 各自交付记录文件名"的清单（可由脚本生成，别手打）。
4. **未提交清单**（截至本单开工时工作区里的 9 个文件，逐个列出）：
   - `M docs/README.md`、`M docs/architecture/ai-engine-roadmap-v1.1.md`、`M docs/worklog/README.md`、`M docs/worklog/pending/phase2-overview-2026-11-03.md`、`M docs/worklog/pending/phase2-wp-list-2026-11-03.md`
   - `?? docs/worklog/audits/phase2-code-vs-blueprint-audit-2026-11-08.md`、`?? docs/worklog/completed/phase2/phase2-code-vs-blueprint-audit-2026-11-08.md`、`?? docs/worklog/completed/phase2/phase2-docs-tidy-up-2026-11-08.md`、`?? docs/worklog/completed/phase2/phase2-docs-tidy-up-implementation-2026-11-08.md`
   - 再叠加本单新增/改动（A/B/C/D）的文件。
   - ⚠️ **本单不 commit / 不打 tag / 不 push**（见 §7.3）；这一节的作用是给项目主理人一份可直接照单执行的提交清单 + 建议 commit message。
5. **封版后基线**（给 Phase2.5 用）：测试总数、`boundary` 断言条数、engine-core 允许改动的范围（阶段性红线）、三个开关的缺省状态（`ENGINE_DELIBERATION_ENABLED` / `ENGINE_CLINICAL_SANITY_ENABLED` / `TURN_DELTA_AUDIT_ENABLED` 均缺省关）。
6. **Phase2.5 的真实入口**（这一节是本单最重要的文字，务必如实写）：
   - 蓝图 `docs/architecture/hybrid-bdi-agent-blueprint-v1.0.md` §6（**第 397-403 行**）定义 Phase2.5 = **影子模式验证期（现在 → 3 个月）**，列 **5 条**（WP63 / WP64 / WP65 / WP66 / WP67）**＋「积累 100+ 场真实对话数据，验证 LLM 审议质量」**（第 403 行）；
   - **这 5 条在 Phase2 期内已全部交付**（另：WP68 意图锁定被蓝图排在 Phase3A，其基础版也已提前交付）→ Phase2.5 **没有新的开发任务**，唯一未达成的出口条件是"100+ 场数据"；
   - 因此"开始 Phase2.5" = 打开影子开关、跑真实场次、用统计面板看质量；**不是新开一批 WP**。
7. **Phase2.5 开工前置（如实登记，不掩盖）**：
   - `src/engine-adapters/rendering/turn-render-orchestrator.ts:718-719` 把 `input.userText`（咨询师原话）与 `visitorText`（来访者渲染原文）原样传给 `deliberation.runShadowMode`；
   - `src/engine-adapters/deliberation/deliberation-prompt.ts:209-210` 把这两段原样拼进 prompt 发往第三方模型；
   - 整条调用链**无安全分级前置**（`src/engine-adapters/deliberation/` 目录内 grep `risk|crisis|safetyLevel|高风险` 零命中）；
   - 与蓝图 §7 红线 5「高风险对话不发 LLM，走本地规则」不符 → **Phase2.5 开跑前需先补"审议输入最小化 + 高风险轮次本地分流"**（另行立单，不在本单范围）；
   - 数据侧是干净的：`DeliberationTraceRecord`（`llm-deliberation.service.ts:695` 起）只存逐维 delta / 标签 / 理由 / 耗时 / token，**不存原话**；日 key TTL 90 天。
8. **没封的东西（明确声明不在 Phase2 内，避免被误读为已完成）**：审计报告的 6 项 Phase3 阻塞（R4 可复现控制零实现 / R6 心理原文出境 / R7 模型与 prompt 版本未锁未记录 / R8 每轮全量无成本闸门 / R9 灰度开关零实现 / R12 抽检流未建），以及审计报告里登记为**非阻塞**的其余缺口（数据未积累、降级态衰减等，口径以报告原文为准，别自行加码）。

**验收**：这份记录**不含"预计 / 大概 / 差不多"**；每个数字都能对应一条命令或一个文件；看完能回答"Phase2 封了什么、什么没封、Phase2.5 开工前还差什么"。

---

## 六、验收总表（行为化）

| # | 项 | 通过标准 |
|---|---|---|
| A1 | 3 条日期夹具 | 单文件全绿 + **改默认日期到 `2026-01-01` 仍全绿** + 硬编码日期 grep 只剩刻意用例 |
| A2 | 1 条并行 flake | 单文件连跑 10 次绿 + 全量连跑 2 次绿；若改 `src/` 需逐行说明 |
| A 整体 | 闸门 | `tsc` 0 error、全量 `failed 0`、`skip` ≤ 19、eslint 0、`boundary.spec.ts` 全绿 |
| B | WP47 | 母版无"✅ 但零证据"的行；补登记录含 commit hash 或替代口径 |
| C | Phase4 清单 | 5 条齐全 + 依赖链正确 + 每条有可判定的解除条件 + 母版交叉链接 |
| D | 封版记录 | 八节齐全 + 无模糊表述 + 未提交清单可直接照单提交 |

---

## 七、红线与本单边界

### 7.1 engine-core

- `git diff --stat HEAD -- src/engine-core` 必须为空（本单是文档 + 测试夹具单）。
- `test/engine-core/boundary.spec.ts` 全部断言必须过（它是边界的机器守卫，不是可选项）。

### 7.2 只改这些地方

- 允许：`test/admin-debug/deliberation-stats.spec.ts`、`test/admin-debug/wp38-debug-session-resume.spec.ts`、`docs/**`。
- **默认不允许**改 `src/`。唯一例外是 A2 第 4 步（30s 仍红时按真实缺陷处理）；若动，必须在交付记录 §2 列出文件、行、改动理由与"为什么不能只在测试侧解决"。

### 7.3 不做的事

- ❌ **不 commit / 不打 tag / 不 push** —— 本单只把工作区改到"可提交"状态，提交由项目主理人统一执行；交付记录 §5 给建议 commit message。
- ❌ 不碰前端（`admin-dashboard/`、Flutter 一律不动），不跑 `flutter` / `dart` / `pub` / `build_runner`。
- ❌ 不发起"Phase2.5 开工"的实现工作（审议输入脱敏、高风险分流、灰度开关都在本单之外，另行立单）。
- ❌ 不改 `38/43` 这个口径 —— 它已由 `phase2-docs-tidy-up-implementation-2026-11-08.md` 核实并纠正过两轮（38/42 → 38/43；漏的是 WP65）。
- ❌ 不在日志 / 诊断输出里打对话正文、prompt 全文、心理内容（仅允许会话 id、轮次、字段名、状态值）。

### 7.4 零回归

- 若为 A2 加了任何可选参数/字段，默认行为必须与改造前**逐字一致**（可选字段零回归）。
- 测试侧只许修夹具与等待上限，**不许弱化断言**（`toBe` 不许降成 `toBeTruthy` / `toBeGreaterThan`）。

---

## 八、闸门命令与当前基线

```powershell
# 类型
npx tsc -p tsconfig.build.json --noEmit          # 基线：0 error，约 47s

# 全量测试（注意：耗时约 11 分钟，超过 15s 前台上限会被转后台）
npx vitest run --reporter=dot
# 基线（2026-11-08 00:09 起跑）：Test Files 142（135 passed / 2 failed / 5 skipped）
#                              Tests 2338（2315 passed / 4 failed / 19 skipped）
# 目标：failed 0，skipped 不多于 19

# 定点
npx vitest run test/admin-debug/deliberation-stats.spec.ts --reporter=dot
npx vitest run test/admin-debug/wp38-debug-session-resume.spec.ts --reporter=dot
npx vitest run test/engine-core/boundary.spec.ts --reporter=dot
```

> ⚠️ 全量测试 97% 的时间花在 import/worker 启动（142 个 worker，每个约 1.25s），**每改一处不要立刻全量**；定点绿了再全量。

---

## 九、交付物清单

1. 本任务单从 `pending/` 移到 `completed/phase2/`，状态行改 ✅ 并指向交付记录。
2. `docs/worklog/completed/phase2/phase2-freeze-closeout-implementation-2026-11-08.md`（交付记录，含 §A1 的时钟无关证明、§A2 的 10 次 + 2 次全量结果、§B 的考古命令与结论、§C/§D 的文件路径）。
3. `docs/worklog/completed/phase2/engine-wp47-supervision-report-typeorm-backfill-2026-11-08.md`（路径一）**或**母版口径限定（路径二）。
4. `docs/worklog/pending/phase4-backlog-2026-11-08.md`。
5. `docs/worklog/completed/phase2/phase2-freeze-2026-11-08.md`。
6. 母版回写：`phase2-wp-list-2026-11-03.md`（WP47 行 + 5 条移交交叉链接）、`docs/worklog/README.md`（封版状态行）。

---


---

## 十、交付结果（2026-11-08 回写）

| # | 收尾项 | 结果 |
|---|---|---|
| **A1** | 日期夹具 3 条确定性红 | ✅ 已修 —— 夹具默认 timestamp 改 `new Date().toISOString()`；3 条期望值改从 `record.timestamp` 推导；**时钟无关证明**：临时改成 `2026-01-01T00:00:00.000Z` 仍 **42/42 绿** |
| **A2** | WP38 并行 flake 1 条 | ✅ 已修 —— 加诊断（超时带出 title / titleSource / 文件是否存在 / 告警错误名，**不打印对话正文与 prompt**）+ 该调用点等待上限提到 30s；**单文件连跑 10 次全绿** |
| **A 整体** | 闸门 | ✅ tsc **0 error**（20.3s）；全量 **142 文件 / 2338 例 / 0 failed / 19 skip**，**连续 2 次全绿**（84.4s + 71.0s）；eslint **0**；boundary **12 用例全绿**；engine-core diff **空** |
| **B** | WP47 账实对齐 | ✅ **路径一** —— 考古命中 `a9ca450`（2026-10-26），已写[补登记录](engine-wp47-supervision-report-typeorm-backfill-2026-11-08.md)；母版第 55 行已改口径 + 挂链接 |
| **C** | Phase4 承接清单 | ✅ 已建 [`pending/phase4-backlog-2026-11-08.md`](../../pending/phase4-backlog-2026-11-08.md)：5 条齐全 + 依赖链 + 每条可判定解除条件；母版已加交叉链接 |
| **D** | 封版记录 | ✅ 已建 [`phase2-freeze-2026-11-08.md`](phase2-freeze-2026-11-08.md)（八节） |
| **母版** | 回写 | ✅ wp-list（WP47 行 + 5 条移交交叉链接）+ worklog/README.md（封版状态行 + pending/ 口径 + boundary 条数口径） |

> ⚠️ **本单不 commit / 不打 tag / 不 push** —— 工作区改到"可提交"状态，提交由项目主理人统一执行；未提交清单与建议 commit message 见交付记录 §5。

_本单是 Phase2 的封版收口，不是新功能开发；代码能力已就绪，欠的是账、闸门、承接与记录。_

_创建：2026-11-08_
_本单是 Phase2 的封版收口，不是新功能开发；代码能力已就绪，欠的是账、闸门、承接与记录。_
