# AF-102 · 长会话咨询师可见输出治本 — 交付记录

> **taskId**：AF-102 · **contextId**：phase2.5-exit4-quality-remediation · **agentRole**：executor
> **分支**：`task/AF-102-long-visible-output` · **基线**：`d0a7c5f424f99687d0cc5b909bf19d848a9f0633`
> **日期**：2026-11-18 · **状态**：实现 + 自测完成；**未 commit / 未 push / 未跑批次 / 未改编排状态面**

---

## 1. 根因（只读复核，实测）

AF-095 的现象：3 场 long 会话 146 轮，咨询师可见输出为空 53 轮（36.3%），`completionTokens` 里 reasoning 占 93%–96%。

本单只读复核了那 3 份逐字稿（`data/debug-sessions/debug_*.json`，**只统计结构，不落任何台词**）：

| 指标（3 场合计） | 值 |
|---|---|
| 逐字稿里的咨询师消息条数 | 150 |
| 其中带 `<think>` 推理块的 | **116** |
| 其中**剥掉推理块后可见台词为空**的 | **57**（审计口径 53 轮，差异来自按 turnIndex 合并 + 两边皆空的轮被丢弃） |
| 咨询师消息平均原始长度 | ≈ 1400–1600 字符（装的是推理，不是台词） |

**真正的根因不是"content 为空"**：

- 推理模型把 thinking 写进 `content`（`<think>...</think>`），于是 `content.length > 0`；
- 老判据 `raw.length === 0` **一次都没命中** → 不兜底、不降级计数；
- 更糟：那段**内部推理被当成"咨询师说的话"喂给了来访者引擎**（runner 把 `counselorReply.text` 原样传给 `engine.turn`）。

所以任务单写的"content 为空或 finishReason=length 时重试"，只覆盖了真实现场的一半 —— 真实现场是
**"content 非空，但里面只有推理"**。本单的判据因此扩成"**可见输出为空**"（剥掉推理块后为空），
否则修不到那 57 轮。

---

## 2. 改动清单

### 2.1 新增

| 文件 | 作用 |
|---|---|
| `src/auto-practice/counselor/policy/visible-output.ts` | 纯函数：`stripReasoningBlocks`（删闭合 + **未闭合**推理块）/ `judgeVisibleOutput`（可见文本 / empty / truncated 三维判定） |
| `test/auto-practice/visible-output.spec.ts` | 上述纯函数的单测（7 例） |

### 2.2 修改

| 文件 | 改动 |
|---|---|
| `src/auto-practice/counselor/policy/generation-policy.ts` | 新增 `STANDARD_GENERATION_POLICY`(1024) / `LONG_GENERATION_POLICY`(2048) / `RETRY_GENERATION_POLICY`(4096) + `resolveGenerationPolicy(profileName)`；**`DEFAULT_GENERATION_POLICY`(500/low/0.5) 逐字不变** |
| `src/auto-practice/counselor-agent.service.ts` | 生成流程改写：按档案取预算 → 可见输出为空/被截断则**提高预算重试一次** → 仍失败才兜底并降级；截断但非空 → 保留文本但标 degraded；**推理块不再进台词**（新增 `callModel` / `toReply` / `fallbackReply` 三个私有方法） |
| `test/auto-practice/counselor-agent.spec.ts` | 新增 `AF-102 可见输出治本` describe（11 例）：预算分档 / 空 content / 只有推理块 / length 截断 / 重试成功 / 重试仍失败 / 截断不认收尾 / 正常不重试 / 异常不重试 |

### 2.3 **未**改动

| 文件 | 为什么没改 |
|---|---|
| `src/auto-practice/practice-runner.service.ts` | 计数链路**本来就通**：runner 已经是 `if (counselorReply.degraded) { degradedTurns++; counselorDegradedTurns++ }`。本单把"截断但非空"也标成 degraded，空输出/截断从此**自动**进降级计数 —— 不需要改 runner（见 D-07） |
| `src/auto-practice/session-profile.ts` | 不在本单 scope（`scope.files` 只列了 `counselor/`、两个 service、test、docs） |
| `src/auto-practice/metrics/counselor-quality-audit.cli.ts` | 不在本单 scope（见 OI-02 / OI-03） |
| `src/auto-practice/practice-batch-health.service.ts` | 不在本单 scope（见 OI-01） |

---

## 3. 关键设计决策

### 3.1 预算分档（`reasoningEffort` 一律保持 `low`）

| 档位 | maxCompletionTokens | reasoningEffort | 理由 |
|---|---|---|---|
| legacy | **500（不变）** | low | 老行为逐字不动 |
| standard | 1024 | low | 30 轮会话思考量比 15 轮多，500 不够（任务单只要求 long，本单顺带给 standard 一个中间档，见 D-03） |
| long | **2048** | low | 治本是**抬高可见输出预算**，不是让模型想更多 —— 想更多 = 更贵 + 更慢 + 更可能把额度吃光 |
| 重试 | **4096** | low | 一次失败的思考可能已花掉 500~2048，重试必须给足"再想一遍 + 说出口"的空间 |

### 3.2 判定与重试的顺序

```
首次调用（按档案预算）
  ├─ 上游异常            → 直接兜底 + degraded（不重试：provider 层已有退避重试链）
  ├─ 可见输出非空且未截断 → 正常返回（degraded=false）
  └─ 可见输出为空 / 被截断 → 提高预算（≥4096）重试**一次**
        ├─ 上游异常 / 仍为空 → 兜底 + degraded
        ├─ 非空且未截断      → 正常返回（degraded=false）
        └─ 非空但仍被截断    → 保留文本 + degraded=true（不静默当正常回复）+ closeRequested=false
```

### 3.3 `degraded` 的语义（本次被明确化）

`degraded = true` 现在表示"**这一轮不是正常的咨询师输出**"，包括两种：兜底句、**被截断的残句**。
这是"空输出要能被正确计数"的前提 —— 原来截断的非空回复 `degraded=false`，会被当成正常轮次混进数据。

### 3.4 推理块不进台词（双重收益）

- **质量**：咨询师的内部推理不再被当成"咨询师说的话"喂给来访者引擎；
- **隐私**：推理块可能含临床内容，不该以"咨询师台词"的形式留在逐字稿里；
- 代价：逐字稿结构变了（历史批次与新批次不可直接同构比对，见 OI-06）。

### 3.5 重试对所有档案生效

任务单只点名 long，但空输出/截断是**生成侧**问题，与档案无关；legacy 的 **prompt 与默认参数逐字不变**，
只是失败时多一次更高预算的调用（成功率更高，代价是多一次调用）。

---

## 4. 真实闸门数字（命令 / exit code / 用例数）

> 仓库：`D:\work\Project\backend\mofang-nestjs-af070`，分支 `task/AF-102-long-visible-output`，基线 `d0a7c5f`，日期 2026-11-18。
> ⚠️ 任务单给的命令前缀是 `corepack pnpm`，**本机没有 corepack**（`corepack : CommandNotFoundException`，
> 见 D-01）→ 用同一 pnpm（9.15.0）执行等价命令，corepack 只是 pnpm 的 shim。

| # | 命令 | exit code | 结果 |
|---|---|---|---|
| 1 | `pnpm exec vitest run test/auto-practice/counselor-agent.spec.ts test/auto-practice/practice-runner.spec.ts`（任务单闸门 1） | **0** | **2 文件 / 40 例全绿**，Duration 1.23s |
| 2 | `pnpm exec tsc --noEmit -p tsconfig.json`（任务单闸门 2，等价于 `corepack pnpm exec tsc ...`） | **0** | **0 error** |
| 3 | `pnpm exec vitest run test/auto-practice/visible-output.spec.ts`（本单新增文件） | **0** | **1 文件 / 7 例全绿** |
| 4 | `pnpm exec vitest run test/auto-practice`（模块全目录回归） | **0** | **25 文件 / 402 例全绿**，Duration 7.28s |
| 5 | `pnpm lint`（仓库约定闸门，非任务单要求） | **0** | **0 error / 0 warning** |
| 6 | `git diff --stat HEAD -- src/engine-core` | **0** | **输出为空**（engine-core 零 diff） |

**lint 首轮失败轨迹（如实记录）**：首轮 **11 errors / 0 warnings** → prettier 格式 8 处、`max-len` 1 处
（148 > 140）、`unicorn/prefer-string-repeat` 1 处、`unicorn/no-useless-undefined` 1 处 →
修正 + `prettier --write` 后复跑 **0 error / 0 warning**。

**闸门 2 首轮也抓到一处真问题**：`judgeVisibleOutput` 的第二参写成必填，而调用方按"上游没报 finishReason"
的可选语义使用 → TS2554（`Expected 2 arguments, but got 1`）。已把该参改为可选并复跑通过。

---

## 5. 遗留项（如实登记，未预支）

| # | 遗留 | 影响 | 状态 |
|---|---|---|---|
| AF102-OI-01 | **批次有效性门禁不看咨询师侧降级**：`llm_call_ratio` 与 `fallback_ratio` 都是**访客侧**口径，`counterConsistent` 只查 `degraded_turns ≤ turn_count` → 咨询师 36% 空输出的批次**仍判 valid** | 本单把空输出**计数**修对了（`counselor_degraded_turns`），但门禁**不读这一列**；修门禁要改 `practice-batch-health.service.ts`，**不在本单 scope** | candidate（需另立单） |
| AF102-OI-02 | 审计 CLI 的 `empty_output_high` 旗标**将不再触发**（逐字稿里现在是兜底句而不是推理块，可见文本非空） | 空输出的新可观测量变成 DB 的 `counselor_degraded_turns`；审计 CLI（`src/auto-practice/metrics/`）不读它 → 审计视角会"看起来问题消失了" | candidate（scope 外） |
| AF102-OI-03 | 审计 CLI 里有一份本地 `visibleUtterance`（自己剥 think 块），与本单新纯函数**重复** | 两份口径将来会漂 | candidate（建议后续统一，scope 外） |
| AF102-OI-04 | **本单未跑批次**（用户硬约束） | 空输出率是否真的下降、long 档 2048 是否够用，**未实证** | candidate |
| AF102-OI-05 | 重试会让失败轮次的 LLM 调用**翻倍** | 空输出率若仍高，long 场次的成本与时长都上升 | candidate |
| AF102-OI-06 | 逐字稿**不再保留**咨询师推理块 | 新旧批次逐字稿结构不同，跨批次比对要标注口径 | candidate（有意变更） |
| AF102-OI-07 | standard 档 1024 / 重试 4096 是**本单判断**，未标定 | 预算取值需要真实批次数据回校 | candidate |

---

## 6. 偏差表

| # | 项 | 任务单说 | 实际 | 处理 | 为什么 |
|---|---|---|---|---|---|
| D-01 | 闸门命令前缀 | `corepack pnpm exec ...` | 本机 **corepack 不存在**（`CommandNotFoundException`） | 用 `pnpm exec`（同一 pnpm 9.15.0）跑等价命令，记录真实 exit code | corepack 只是 pnpm 的 shim；不静默跳过闸门 |
| D-02 | 触发重试的判据 | "content 为空或 finishReason=length" | 现场是 **content 非空但只有推理块**（57/150 轮） | 判据扩成"**可见输出为空**"（剥推理块后为空，含未闭合推理块） | 按原判据修不到真实现场；只修"content 为空"会漏掉 57 轮 |
| D-03 | 预算分档范围 | 只要求 long ≥ 2048 | standard 也给了 1024 | 有意扩大 | 30 轮会话的思考量同样会吃光 500；standard 档是 AF-091 今天才引入、尚无批次在用 |
| D-04 | 重试适用范围 | 未限定档案 | **所有档案**都重试 | 有意为之 | 空输出是生成侧问题；legacy 的 prompt 与默认参数逐字不变 |
| D-05 | 上游异常 | 未提 | 异常**不重试**，直接兜底 | 有意为之 | provider 层已有自己的退避重试链（`runWithLlmRetry`）；再叠一层会放大上游压力 |
| D-06 | `degraded` 语义 | 未提 | 从"走了兜底"扩到"不是正常输出"（含截断残句） | 有意为之 | 这是"空输出要能被正确计数"的前提（截断的非空回复原来 `degraded=false`） |
| D-07 | practice-runner 计数改动 | "如确实需要…只改该文件" | **未改**（经核实不需要） | 结论写清 | runner 已有 `degraded → degradedTurns / counselorDegradedTurns` 通路；本单把截断也标 degraded 后自动生效 |
| D-08 | 逐字稿内容 | 未提 | 咨询师推理块**不再进逐字稿** | 有意变更 | 推理不是"咨询师说的话"；不进逐字稿同时是隐私收益；代价见 OI-06 |

---

## 7. 硬约束核对

| 约束 | 结果 |
|---|---|
| 不改 `src/engine-core` | ✅ `git diff --stat HEAD -- src/engine-core` 输出为空 |
| 不跑 LLM 批次 | ✅ 全程 mock，单测零网络调用 |
| 不连 DB / Redis | ✅ 只读本地逐字稿 JSON（只统计结构），无 DB/Redis 访问 |
| 不执行 orchestration CLI | ✅ 未跑 `pnpm orchestration:*` 任何命令 |
| 不 commit / 不 push | ✅ 未执行任何 git 写操作 |
| 只用工作区改动 | ✅ 改动全部在工作区，未动状态面 |
| 闸门自己跑并记录真实数字 | ✅ 见 §4（含 lint 首轮失败轨迹） |
| 交付记录不写台词原文 | ✅ 全文只有计数、结构描述与枚举，无任何真实台词片段 |

---

## 8. 建议 commit message

```
fix(auto-practice): AF-102 长会话咨询师可见输出治本 (按档位分预算 + 截断重试 + 推理块剔除)
```

---

## 9. 溯源

| 事实 | 位置 |
|---|---|
| 任务契约 | `docs/team/agent-orchestration/transport/tasks/AF-102.json` |
| 任务单 | `docs/worklog/pending/af102-long-session-visible-output-task-2026-11-18.md` |
| AF-095 长会话审计证据 | `docs/worklog/completed/phase2.5/af095-long-batch-quality-audit-2026-11-18.json` |
| 咨询师质量审计模块（`emptyCounselorTurns` 口径） | `src/auto-practice/metrics/counselor-quality.ts` |
| 上游字段映射（`max_completion_tokens` / `reasoning_effort`） | `src/llm/providers/minimax.provider.ts` |
| 降级计数通路 | `src/auto-practice/practice-runner.service.ts`（`counselorReply.degraded` → `degradedTurns` / `counselorDegradedTurns`） |
| 回复原文 | `docs/worklog/pending/relay-response-AF102-20261118-2010.md` |
