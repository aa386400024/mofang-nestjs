# WP25 · Phase1 封版审查：全量代码+文档扫描 + 已知尾巴清理

> 日期：2026-11-03 ｜ 仓库：`E:\Work\Project\backend\mofang-nestjs`
> 性质：Phase1 M3 内测前封版——不是写新功能，是系统性扫描所有 Phase1 代码与文档，找出已知/未知问题，产出一份按严重度排序的清单，然后逐个修
> 状态：✅ **已交付并复跑绿** → 交付记录: `engine-wp25-phase1-audit-backend-implementation-2026-11-03.md`（同目录）｜扫描报告: [`docs/progress/wp25-phase1-audit-report-2026-11-03.md`](../../../wp25-phase1-audit-report-2026-11-03.md)
> 🔴 本单允许读 `src/**` 全部代码；修 bug 时按问题归属改对应文件，不限制改动面
> 🔗 前置：WP0–WP24 全部交付

> **交付结果摘要（2026-11-03）**：8 个 P1 本单全修（含 WS `sessionId` 归属校验、生产 basic auth fail-close、生产 CSP 指令值、session 密钥、头像文案脱敏、引擎 observer 抛错、`.env.example` 补全、本单 §1.4 方向修正）；39 条 P2 只列不改待用户拍板；10 条 P3 已进 backlog Phase2 队列；5 条已知尾巴全部核实并归档（详见交付记录与扫描报告）。

---

## 0. 为什么有这条

Phase1 22 个 WP 陆续交付，中间经过多次架构修正、边界 A/B 记录、临时值放宽、文档与代码不一致。现在要封版进 M3 内测，需要一次**系统性全量扫描**，而不是继续打补丁。

对标大厂发版前的 release hardening：
- 代码审查（code audit）
- 文档与代码一致性核对
- 安全/配置/错误处理扫描
- 已知尾巴清理

---

## 1. 已知尾巴清单（起步 checklist，扫描中发现新问题随时追加）

### 1.1 流式 done chunk 缺 finishReason
- **位置**：`src/engine-adapters/wiring/` 或 voice gateway 的流式下发路径
- **问题**：流式 `done` chunk 不带 `finish_reason`（stop / length / content_filter），内测时遇到"回复突然断了"无法快速定位是 token 上限还是自然结束
- **修法**：从 LLM 流式响应的 finish chunk 里透传 `finishReason` 字段到 done 帧
- **优先级**：P2（内测调试有用，不影响用户）

### 1.2 WP12 半衰期配置单向生效
- **位置**：`src/engine-core/memory/` 相关
- **问题**：记忆半衰期配长于 30 天时对召回准入无效（单向生效）
- **修法**：确认是设计如此还是 bug；如果是 bug 就修，如果是设计限制就在代码注释和文档里写清楚
- **优先级**：P3（记忆调参是 Phase2，现在只需确认不是 bug）

### 1.3 admin SPA mock 页面盘点
- **位置**：`admin-dashboard/src/`
- **问题**：已切 4 个真 API 页面，剩余页面全是 mock。盘点一下哪些页面内测时会真用到
- **修法**：列出哪些页面还是 mock，标注"内测需要 / Phase2 再说"，内测需要的切真 API
- **优先级**：P2

### 1.4 WP11 临时值回改清单（开发期间不动，内测前执行）
- **位置**：`PSYGUARD_TIMEOUT_MS` 相关 env / 常量
- **问题**：测试期超时 **500ms**、token **256** 是**放宽值**（从正式口径 150ms / 28 token 放宽而来），内测前要回改正式口径 **150ms / 28 token**
- **修法**：列出所有需要回改的点（交付记录说输出侧走独立 env 读取，不是只改内核常量），写一份 checklist 但**现在不改**，内测前照单执行
- **优先级**：P1（内测前必做，现在只盘点）

> 🔴 **WP25 审核修正（2026-11-03）**：本条原文把方向写反了 —— 原文写「测试期超时 150ms、token 28 是放宽值，内测前要回改生产值（500ms / 256 token）」。
> **事实相反**：正式口径是 **150ms / 28 token**（真机 BERT-large int8 延迟预算反推出来的值），测试期为了「只有一个人用、准确率优先于延迟」把它**放宽**成了 **500ms / 256 token**。
> 照原文执行会把生产值改错方向（把 150 改成 500 = 把临时值固化成正式值）。下面这版 checklist 是核实后的**正确方向**。

#### 回改 checklist（跨 2 个仓库，11 处；M3 内测前一次性做完）

**A. 本仓 `mofang-nestjs`（8 处）**

| # | 位置 | 现值（测试期放宽） | 改回 | 说明 |
|---|---|---|---|---|
| A1 | `src/engine-core/cognition/safety/assess-safety.ts:75` `DEFAULT_PROBE_TIMEOUT_MS` | `500` | `150` | **内核硬上限**，整条链路的地基 |
| A2 | `src/engine-adapters/wiring/engine.module.ts:131` | env `500` | env `150` | 输出侧探测超时 |
| A3 | `src/engine-adapters/wiring/engine.module.ts:188` | env `500` | env `150` | counselor_input 侧 |
| A4 | `src/engine-adapters/wiring/engine.module.ts:226` | env `500` | env `150` | visitor_output 侧 |
| A5 | `.env.example` 的 `PSYGUARD_TIMEOUT_MS` | `500` | `150` | A2–A4 读的就是它 |
| A6 | `test/engine-core/wp4-safety.spec.ts` 对本常量的断言 | `500` | `150` | 改了 A1 必须同步改断言 |
| A7 | `src/engine-adapters/wiring/risk/http-psyguard.probe.ts:41` `:45` `:50` `:148` | 注释写「150」 | 见下 | ⚠️ **当前状态下这批注释是错的**（内核实际是 500）。回改后自洽；但**在回改之前**它就在骗人 → 另列 P2 立即修 |
| A8 | `src/engine-adapters/wiring/risk/psyguard-health.checker.ts:67` | 注释写「比探测超时 (150ms) 宽松」 | 见下 | 同 A7 |

> ⚠️ **A2–A4 是本单新发现的关键点**（旧交付记录写「全仓只有一个回改点」，不成立）：
> 装配层**显式**传了 `timeoutMs: resolvePsyGuardTimeoutMs(config.get<string>('PSYGUARD_TIMEOUT_MS'))` ——
> 输出侧走**独立 env 读取**，**不会**跟着内核常量 A1 走。漏改 env = 内核按 150 掐断、HTTP 按 500 等，两侧口径自相矛盾。
> （出处：WP11 审核结论 D34，`docs/progress/code-vs-blueprint-audit-2026-10-30.md:239`）

**B. 兄弟仓 `mofang-psyguard`（3 处，不在本仓，跨仓改动需单独提权）**

| # | 位置 | 现值 | 改回 |
|---|---|---|---|
| B1 | `docker-compose.yml` 的 `PSYG_MAX_LENGTH` | `256` | `28` |
| B2 | `classifier.py` 的 `DEFAULT_MAX_LENGTH` | `256` | `28` |
| B3 | `tests/test_classifier.py` 对默认窗口的断言 | `256` | `28` |

**C. 回改后的验收口径**

- 两侧必须一致：内核 150ms ↔ env 150ms ↔ 服务侧 token 窗口 28。
  不一致会出现「内核等 150ms、HTTP 早就掐了」或「内核 500ms 回落、服务侧按 28 截断」两种自相矛盾。
- 真机口径依据（WP11 交付记录 `:201`）：BERT-large int8 ≈ 9.9ms + 3.34ms/token → 28 token 稳在 ~104ms；
  256 token 要 ~650ms（2.0 核）—— 也就是说**现在的 500ms 只够覆盖到 ~145 token**，
  「不牺牲准确率」得靠更快的硬件或更小的模型，不能靠调大超时。
- M3 内测是**多人**场景，延迟预算与并发公平性都按 150ms 设计过。
- ⚠️ 生产机（117.72.30.78）上跑着的 psyguard 容器**实际** `PSYG_MAX_LENGTH` 取值本单**未核实**（不在本仓）——
  内测前必须实地确认，别只改仓库里的默认值。

### 1.5 abort → cancelled 帧
- **结论**：这不是 bug，barge-in 是正常交互不是错误。从 backlog 已知尾巴里划掉，不用修
- **优先级**：—（确认即可）

---

## 2. 全量扫描清单（核心工作）

### 2.1 文档与代码一致性扫描

逐个核对以下文档与实际代码是否一致：
- `docs/progress/phase1-integration-backlog-2026-10-28.md` — 每个 WP 的状态行、交付记录链接、偏差记录是否与代码现状吻合
- `docs/progress/README.md` — 速查表是否准确
- 各 WP 交付记录里声称的"改动文件 / 测试数 / 闸门结果"是否与 git 历史一致
- 已知边界（WP23 边界 A/B、WP11 临时值、WP19 prod 关 trace 等）是否在代码里有对应注释

**产出**：一份不一致清单，每条标注"文档写错了"还是"代码跟文档说的不一样"。

### 2.2 代码健康扫描

全仓 grep 找：
- `TODO` / `FIXME` / `HACK` / `XXX` 注释 — 列出来，判断哪些已经过时可以删、哪些是待办要记录
- `console.log` / `debugger` 残留 — 生产代码里不该有
- `any` 类型滥用（`: any` / `as any`）— 列出来，判断哪些是合理的（跨边界序列化）哪些是债
- 硬编码密钥 / 内网 IP / 端口 — 确认都在 env 里
- `throw new Error` 没分类的 — 确认是否都有 retryable 标记

### 2.3 安全扫描

- `/admin/api/*` 端点鉴权是否全（WP19-R 补过 basic auth，确认没有漏网）
- WS 握手是否校验 sessionId 归属当前用户（不能拿别人 sessionId 进来）
- 错误信息是否泄漏内部细节（堆栈、SQL、文件路径）给前端
- CORS / helmet 配置是否生产级

### 2.4 配置扫描

- `.env.example` 是否列出了所有 env（对照代码里 `process.env.*` 全部出现点）
- 默认值是否安全（生产默认不开 debug、不放宽超时）
- 有没有"测试期放宽"的值混在生产配置里

### 2.5 引擎层专项

- engine-core 有没有新增对 `@nestjs` / `typeorm` / `process.env` 以外的外部依赖
- `index.ts` barrel 导出是否干净
- 端口（Port）接口有没有被实现类绕过
- 错误分类是否完整（retryable / non-retryable）

---

## 3. 产出物

### 3.1 扫描报告
一份 Markdown，放 `docs/progress/wp25-phase1-audit-report-2026-11-03.md`：

按严重度分三档：
- **P1（内测前必修）**：安全漏洞、数据不一致、会导致会话崩溃的问题
- **P2（内测前建议修）**：调试困难、文档不一致、体验问题
- **P3（Phase2 再说）**：已知设计限制、非用户感知的债

每条写清：位置（文件:行号）、问题、建议修法、预估工作量。

### 3.2 修复执行
P1 问题本单内直接修。
P2 问题列出，用户拍板哪些修哪些挂着。
P3 写进 backlog Phase2+ 队列。

---

## 4. 不做

- ❌ 写新功能
- ❌ 重构（只修 bug，不顺手重构）
- ❌ 改 DELTA_TABLE 种子值（WP15 刚加完 cap，种子值调参等内测日志）
- ❌ DB 化 BDI 仓储（Phase2）

---

## 5. 验收

1. ✅ **扫描报告产出，P1/P2/P3 分级清晰** —— `docs/progress/wp25-phase1-audit-report-2026-11-03.md`（P1 × 8 / P2 × 39 / P3 × 10，另含「已确认无问题项」与「未核实项」两节）
2. ✅ **P1 问题全部修复，tsc 0 / eslint 0 / 全量测试绿** —— `tsc` 0 错；`eslint` 0 错 0 warning；`vitest run --exclude '**/e2e/**/*.ts'` **77 文件 / 1165 例全绿**（基线 74 / 1133 → 净增 3 文件 / 32 例）
3. ✅ **`.env.example` 与代码 `process.env.*` 出现点一一对应** —— 补 130 个键、47 个死键降级为注释区；新增**双向**机器断言 `test/config/wp25-env-example-coverage.spec.ts`（4 例，AST 级抽取代码读取点）
4. ✅ **backlog 母版里的已知尾巴全部归档（划掉或写入 P3）** —— 母版新增「已知尾巴归档」表（5 条逐条结论 + 去向）；5 条里 2 条划掉（半衰期=设计、abort→cancelled=不是 bug）、1 条真缺口列 P2、1 条降级列 P2、1 条本单修任务单方向；P3 10 条已写进母版 §Phase2+ 队列
5. ✅ **交付记录回写** —— `engine-wp25-phase1-audit-backend-implementation-2026-11-03.md`（同目录）+ 母版（状态行 / §0.3 / §0.4 / 尾巴归档 / WP15 小节 / Phase2 队列）+ `docs/progress/README.md` §4

> 📌 **P2 只列不改，等用户拍板** —— 任务书 §3.2 明确要求。39 条清单在扫描报告 §2，按「安全 / 引擎 / 文档一致性 / 配置与已知尾巴」四组分列，含位置、问题、建议修法、预估工作量。
