# Phase2 封版记录（封版凭证）

> **路径**：`docs/worklog/completed/phase2/phase2-freeze-2026-11-08.md`
> **状态**：✅ Phase2 已封版（2026-11-08）
> **口径**：**38 / 43**（WP27–WP69）
> **HEAD**：`bde6d8f`（分支 `integrate`）—— ⚠️ **本单不 commit / 不打 tag / 不 push**，工作区改到"可提交"状态，提交由项目主理人统一执行
> **收口任务单**：[§Phase2 封版收口](phase2-freeze-closeout-2026-11-08.md)｜[§交付记录](phase2-freeze-closeout-implementation-2026-11-08.md)
> **母版**：[§工作包清单](../../pending/phase2-wp-list-2026-11-03.md)｜[§总览](../../pending/phase2-overview-2026-11-03.md)

---

## 1. 封版口径

| 项 | 值 |
|---|---|
| **封版完成数** | **38 / 43** |
| 43 条的边界 | **WP27 – WP69**（首尾相接 = 43 个编号；登记表逐行 43 行，**无缺号 / 无重复 / 无幽灵条目**） |
| 未完成 5 条 | **WP27 / WP29 / WP33 / WP39 / WP40** —— 全属**商业化 / 合规**，**整体移交 Phase4** |
| 5 条的承接文件 | [§Phase4 承接清单](../../pending/phase4-backlog-2026-11-08.md)（依赖链 + 每条**可判定**的解除条件 + 外部输入清单） |
| 9 条独立单 | **不计入 43 条分母** —— 独立单**无 WP 编号**，各自一份任务单 + 一份交付记录，是"切灰度前置安全网"与"内核一致性收口"等**非编号工作**，单列索引见[母版 §2.3](../../pending/phase2-overview-2026-11-03.md) |
| 口径来源 | 该 38/43 口径已由[§文档收尾单](phase2-docs-tidy-up-implementation-2026-11-08.md)核实并纠正两轮（38/42 → 38/43；漏的是 **WP65**，🔴 P0）。**本单不改这个口径** |

> ℹ️ **43 不是 42**：WP27–WP69 = 43 个编号，登记表逐行也是 43 行（两个独立口径互证）；统计表三档枚举原先**漏了 WP65**，已补。

---

## 2. 闸门实测（2026-11-08）

| 闸门 | 命令 | 实测结果 | 耗时 |
|---|---|---|---|
| 类型 | `npx tsc -p tsconfig.build.json --noEmit` | ✅ **exit 0 · 0 error** | 20.3s |
| 全量测试（第 1 次） | `npx vitest run --reporter=dot` | ✅ **Test Files 137 passed / 5 skipped (142)**<br>✅ **Tests 2319 passed / 19 skipped (2338)** · **0 failed** | 84.35s |
| 全量测试（第 2 次，紧接） | 同上 | ✅ **同上（数字逐字一致）** · **0 failed** | 70.99s |
| 边界断言 | `npx vitest run test/engine-core/boundary.spec.ts --reporter=dot` | ✅ **12 个用例全绿**（11 条不变量 ①–⑪ + 1 条"扫描自检"；共 **18** 个 expect） | 1.53s |
| eslint（本单改动的文件） | `npx eslint test/admin-debug/deliberation-stats.spec.ts test/admin-debug/wp38-debug-session-resume.spec.ts` | ✅ **0 error / 0 warning** | 32.6s |
| engine-core 红线 | `git diff --stat HEAD -- src/engine-core` | ✅ **空** | — |
| 定点回归 | 两个改过的 spec 一起跑 | ✅ **2 files / 52 tests 全绿** | 1.78s |

**skip 数**：**19**（= 任务单基线 19，**未增未减**）。
**对比基线**（任务单 §1.1 记录的 2026-11-08 00:09 那一跑）：2315 passed / 4 failed / 19 skipped → 现在 **2319 passed / 0 failed / 19 skipped**（**2315 + 4 = 2319**，4 条红全部转绿，**没有一条用例被 skip 或弱化**）。

> ⚠️ **boundary 条数按实测写，不抄陈旧值**：本仓 README 原写「11 条」（= 不变量数，漏了扫描自检），审计报告写「13 条」（实测没有 13 个用例）—— **两个都不准**，一律以实测 **12 个用例 / 18 个 expect** 为准（README 已同步改）。

---

## 3. 交付覆盖核查

| 项 | 开工时 | 封版后 | 说明 |
|---|---|---|---|
| completed/phase2/ 下的 .md 文件 | 99 | **103** | +4 = WP47 补登记录 + 封版记录（本文件）+ 封版收口任务单 + 封版收口交付记录 |
| implementation 交付记录 | 49 | **50** | +1 = 本单交付记录（WP47 那份按"**补登**"命名，**不计入** implementation） |
| 编号 WP 交付记录 | 39 | **40** | +1 = **WP47 补登记录**（母版里唯一一个"标 ✅ 但零证据"的 WP） |
| 独立单 | 9 | **9** | 不变（非编号工作，不计入 43 条分母） |

**WP47 的处理结论**：**路径一（补登）** —— 考古命中 `a9ca450`（2026-10-26 17:35 +0800，feat(counselor): 落地 vpt 会话桥接与督导报告落库查询…），前置 commit `7a77586`（2026-10-09，Supervisor Agent 接入）。两个 commit 的 `git show --stat -- src/engine-core` **均为空**；当时的闸门数字**记录缺失，未留存**（**不编**）。→ [§WP47 补登记录](engine-wp47-supervision-report-typeorm-backfill-2026-11-08.md)

### 38 个 ✅ 与它们的交付记录（**脚本生成，非手打**）

| WP | 名称 | 交付记录 |
|---|---|---|
| WP28 | WP11 回改正式值 | engine-wp28-psyguard-production-values-implementation-2026-11-03.md |
| WP30 | Admin Dashboard 切真 API | engine-wp30-admin-dashboard-real-api-implementation-2026-11-05.md |
| WP31 | 成本看板与告警 | engine-wp31-cost-board-alert-implementation-2026-11-05.md |
| WP32 | BDI 状态持久化 | engine-wp32-bdi-state-persistence-implementation-2026-11-05.md |
| WP34 | P1 人格调节算子 | engine-wp34-personality-modulator-operators-implementation-2026-11-03.md |
| WP35 | 渲染四手法 | engine-wp35-rendering-four-techniques-implementation-2026-11-04.md |
| WP36 | 跨会话间隔自然衰减 | engine-wp36-cross-session-decay-implementation-2026-11-03.md |
| WP37 | 记忆会话级摘要压缩 | engine-wp37-rolling-session-summary-implementation-2026-11-03.md |
| WP38 | 角色版本 semver | engine-wp38-character-semver-and-debug-event-tags-implementation-2026-11-06.md |
| WP41 | 表达风格渲染接入 | engine-wp41-expression-style-rendering-implementation-2026-11-04.md |
| WP42 | 咨询同盟三维 | engine-wp42-counseling-alliance-three-dimensions-implementation-2026-11-03.md |
| WP43 | 评估引擎基础版 | engine-wp43-evaluation-engine-basic-implementation-2026-11-06.md |
| WP44 | 成长档案体系 | engine-wp44-growth-archive-basic-implementation-2026-11-06.md |
| WP45 | P3 技术债 8 条 | engine-wp45-p3-tech-debt-8-items-implementation-2026-11-05.md |
| WP46 | Sentry 通道脱敏 | engine-wp46-sentry-redaction-implementation-2026-11-06.md |
| WP47 | supervisor 督导报告切真 DB | engine-wp47-supervision-report-typeorm-backfill-2026-11-08.md ← **补登** |
| WP48 | env 守卫盲区 | engine-wp48-env-guard-blind-spot-implementation-2026-11-06.md |
| WP49 | 角色大五人格字段落地 | engine-wp49-character-five-factor-personality-implementation-2026-11-04.md |
| WP50 | 渲染层接入同盟三维 | engine-wp50-render-spec-alliance-three-dimensions-implementation-2026-11-04.md |
| WP51 | 角色种子同盟三维基线 | engine-wp51-character-seed-alliance-baseline-implementation-2026-11-04.md |
| WP52 | 剧本偏移接入同盟三维 | engine-wp52-trajectory-snapshot-delta-alliance-implementation-2026-11-04.md |
| WP53 | 人格调节算子扩展到 safety/bond | engine-wp53-personality-modulator-alliance-extension-implementation-2026-11-04.md |
| WP54 | 破裂态阻抗反升（跨会话衰减补完） | engine-wp54-rupture-resistance-floor-implementation-2026-11-04.md |
| WP55 | 会话摘要补齐来访者侧 | engine-wp55-rolling-summary-both-sides-implementation-2026-11-04.md |
| WP56 | 长期记忆召回进渲染上下文 | engine-wp56-recall-into-render-context-implementation-2026-11-04.md |
| WP57 | BDI 信念层深度扩展 | engine-wp57-belief-layer-deep-expansion-implementation-2026-11-04.md |
| WP58 | 引擎调试面板 / BDI 状态 trace | engine-wp58-engine-debug-panel-implementation-2026-11-05.md **+** engine-wp58-turn-delta-audit-implementation-2026-11-06.md（后半段） |
| WP59 | 记忆召回策略配置端口统一 | engine-wp59-recall-policy-config-port-implementation-2026-11-04.md |
| WP60 | delta 规则表配置化 | engine-wp60-delta-table-config-implementation-2026-11-08.md |
| WP61 | 会话摘要层次化 | engine-wp61-session-summary-hierarchical-implementation-2026-11-04.md |
| WP62 | 内核端口类型 barrel 收口 | engine-wp62-kernel-barrel-types-implementation-2026-11-08.md |
| WP63 | 审议输出 Schema 与可解释性设计 | engine-wp63-deliberation-schema-design-implementation-2026-11-05.md |
| WP64 | LLM 审议层 PoC（影子模式） | engine-wp64-llm-deliberation-poc-shadow-implementation-2026-11-05.md |
| WP65 | 会话级串行队列与状态一致性 | engine-wp65-deliberation-mutex-revision-implementation-2026-11-06.md（后半段）+ engine-wp65-deliberation-shadow-queue-implementation-2026-11-05.md（队列化） |
| WP66 | 审议输出格式校验与重试 | engine-wp66-deliberation-format-retry-implementation-2026-11-05.md |
| WP67 | 三级降级策略 | engine-wp67-deliberation-circuit-breaker-implementation-2026-11-05.md **+** engine-session-degraded-flag-implementation-2026-11-07.md（degraded 打标，独立单） |
| WP68 | 意图锁定机制（基础版） | engine-wp68-deliberation-intention-lock-implementation-2026-11-05.md |
| WP69 | env 盲区扩面 + consent 路径修复 | engine-wp69-env-blindspot-expansion-and-debug-panel-fixes-implementation-2026-11-06.md |

> ✅ **38/38 条 ✅ 全部有据可查**（WP47 经本单补登后也不再是"✅ 但零证据"）。

---

## 4. 未提交清单（本单不提交，照单提交即可）

**共 16 个文件**（7 改 + 9 新增），全部是文档与测试夹具，**零 src/ 改动**：

| # | 状态 | 文件 | 来自 |
|---|---|---|---|
| 1 | M | docs/README.md | 上一单（文档收尾） |
| 2 | M | docs/architecture/ai-engine-roadmap-v1.1.md | 上一单 |
| 3 | M | docs/worklog/README.md | 上一单（**本单又改 3 处**） |
| 4 | M | docs/worklog/pending/phase2-overview-2026-11-03.md | 上一单 |
| 5 | M | docs/worklog/pending/phase2-wp-list-2026-11-03.md | 上一单（**本单又改 2 处**） |
| 6 | M | test/admin-debug/deliberation-stats.spec.ts | **本单 A1** |
| 7 | M | test/admin-debug/wp38-debug-session-resume.spec.ts | **本单 A2** |
| 8 | ?? | docs/worklog/audits/phase2-code-vs-blueprint-audit-2026-11-08.md | 上一单（审计报告） |
| 9 | ?? | docs/worklog/completed/phase2/phase2-code-vs-blueprint-audit-2026-11-08.md | 上一单（审计任务单） |
| 10 | ?? | docs/worklog/completed/phase2/phase2-docs-tidy-up-2026-11-08.md | 上一单（任务单） |
| 11 | ?? | docs/worklog/completed/phase2/phase2-docs-tidy-up-implementation-2026-11-08.md | 上一单（交付记录） |
| 12 | ?? | docs/worklog/completed/phase2/engine-wp47-supervision-report-typeorm-backfill-2026-11-08.md | **本单 B** |
| 13 | ?? | docs/worklog/pending/phase4-backlog-2026-11-08.md | **本单 C** |
| 14 | ?? | docs/worklog/completed/phase2/phase2-freeze-2026-11-08.md | **本单 D**（本文件） |
| 15 | ?? | docs/worklog/completed/phase2/phase2-freeze-closeout-2026-11-08.md | **本单**（任务单） |
| 16 | ?? | docs/worklog/completed/phase2/phase2-freeze-closeout-implementation-2026-11-08.md | **本单**（交付记录） |

**建议 commit message**（两笔，边界更清楚）：

```text
docs(phase2): 文档收尾 —— 母版补 WP60/WP62 的 ✅ 与 WP65 枚举、进度统一 38/43、roadmap §9 过期数字修正、新增独立单清单（9 条）

test+docs(phase2): 封版收口 —— 修统计面板日期夹具 3 红与 WP38 并行 flake、WP47 补登、Phase4 承接清单、Phase2 封版记录（38/43，闸门全绿）
```

> ⚠️ **不打 tag**：任务单 §7.3 明确本单不 commit / 不打 tag / 不 push。若主理人要给 Phase2 打封版 tag，**建议等这 16 个文件提交后再打**，并把 tag 指向提交后的 HEAD（当前 HEAD bde6d8f **不含**本轮任何改动）。

---

## 5. 封版后基线（Phase2.5 直接用这个起手）

| 基线项 | 值 | 取证 |
|---|---|---|
| 测试文件数 | **142**（137 passed / 5 skipped） | §2 全量实测 |
| 测试用例数 | **2338**（**2319 passed / 19 skipped / 0 failed**） | §2 全量实测 |
| 边界守卫 | test/engine-core/boundary.spec.ts = **12 个用例 / 18 个 expect** | §2 实测（README 的 11 与审计的 13 都是陈旧值） |
| engine-core 红线（阶段性） | **PoC 影子期默认零改动**：git diff --stat HEAD -- src/engine-core 必须为空；永久红线 = 零 NestJS / 零网络 / 零 prompt / 零 process.env / 零 globalThis | §2 实测 + 边界断言 ④⑤⑩ |
| 允许改内核的场景 | 需**任务单逐行授权**并同步边界断言 ⑥ 的白名单（如 WP60 / WP62 / WP65 mutex 都是这么走的） | 各 WP 交付记录 |

**三个开关的缺省状态（全部 = 关）**：

| 开关 | 缺省 | 取证 |
|---|---|---|
| ENGINE_DELIBERATION_ENABLED（影子审议总开关） | **关** | src/engine-adapters/deliberation/llm-deliberation.service.ts:350-357 —— resolveDeliberationEnabled → parseBooleanEnv：空串 / 未配 = false |
| ENGINE_CLINICAL_SANITY_ENABLED（临床合理性观测） | **关** | 同文件 parseBooleanEnv（同一套字面量口径） |
| TURN_DELTA_AUDIT_ENABLED（事件 + delta 审计观测） | **关** | src/engine-adapters/wiring/turn-delta-audit/turn-delta-audit.config.ts:41-45 —— parseEnabled：空串 / 未配 = false |

> 📌 **三个开关缺省全关** = 影子审议、临床标记、delta 审计**默认零成本、零流量**。要开必须**显式配 env**。

---

## 6. Phase2.5 的真实入口

**蓝图口径**（docs/architecture/hybrid-bdi-agent-blueprint-v1.0.md §6，**第 397-403 行**）：

```
Phase 2.5（现在 → 3 个月）：影子模式验证期
  ├─ WP63 审议 Schema 设计
  ├─ WP64 LLM 审议 PoC（影子模式，不影响生产）
  ├─ WP65 会话串行队列
  ├─ WP66 输出格式校验
  ├─ WP67 三级降级策略
  └─ 积累 100+ 场真实对话数据，验证 LLM 审议质量
```

**这 5 条的现状**：**在 Phase2 期内已全部交付**（WP63 / WP64 / WP65 / WP66 / WP67 在母版登记表里全带 ✅，各有一份交付记录）。
（另：**WP68 意图锁定**被蓝图排在 **Phase3A**，其**基础版**也已提前交付 —— 但蓝图未把它算进 Phase2.5 的 5 条。）

**结论**：

> ### ✅ Phase2.5 **没有新的开发任务**。
> **唯一未达成的出口条件 = 「积累 100+ 场真实对话数据，验证 LLM 审议质量」。**
>
> **"开始 Phase2.5" = 三件事**：
> 1. **打开影子开关**（显式配 ENGINE_DELIBERATION_ENABLED）—— 缺省是关的；
> 2. **跑真实场次**（累计 100+ 场）；
> 3. **用统计面板看质量**（GET /admin/api/deliberation/stats，支持 ?days=N / ?from=&to= 窗口）。
>
> **不是"再开一批 WP"。** 蓝图给的 PoC 验收标准（成功率 > 95% / P95 < 3s / delta 差异均值 < 0.01 / Top10 场景临床合理 / 高安全零误触发）就是**这 100+ 场的读数标准**。
>
> ⚠️ **但开跑之前先看第 7 节** —— 现在直接开跑，等于把心理原文发给第三方模型。

---

## 7. Phase2.5 开工前置（如实登记，不掩盖）

**🔴 这三条是"开跑前必须先补"的，不是"以后再说"的**（本单**只登记、不修**，另行立单）：

| # | 事实 | 取证（2026-11-08 实测） |
|---|---|---|
| 1 | **心理原文进了审议入参** | src/engine-adapters/rendering/turn-render-orchestrator.ts:718-719 —— counselorText: input.userText / visitorText **原样**传给 runShadowMode |
| 2 | **原样拼进 prompt 发第三方模型** | src/engine-adapters/deliberation/deliberation-prompt.ts:209-210 —— 【本轮咨询师发言】与【本轮来访者反应】两段**原样**拼进 prompt |
| 3 | **无「高风险走本地规则」分流** | git grep -i -E 'risk|crisis|safetyLevel|高风险' -- src/engine-adapters/deliberation/ → **零命中**。与蓝图 §7 红线 5「高风险对话不发 LLM，走本地规则」**不符** |

> ⚠️ 与蓝图 §3 边界 3 的应对②「审议 prompt **不传完整用户原文**，只传结构化事件分类」也不符（蓝图侧是 2026-11-05 的设计意图，代码是同期的 PoC 实现）。
> **⇒ Phase2.5 开跑前需先补「审议输入最小化 + 高风险轮次本地分流」**（另立单；**不在本单范围**）。这与审计报告的 **R6（心理数据合规）** 是同一件事。

**✅ 数据侧是干净的**（可以放心跑的那一半）：

| 项 | 事实 |
|---|---|
| 审议 trace 存什么 | DeliberationTraceRecord（llm-deliberation.service.ts:695 起）只存**逐维 delta / operatorTags / reason / 耗时 / token / capEntries / clinicalFlags** —— **不存对话原文** |
| 保留期 | 逐轮 trace 表 TTL 30 天；统计日 key TTL **90 天**（DELIBERATION_STATS_DAILY_TTL_SECONDS = 90×24×3600） |
| 落库侧 | 统计写失败**只打 warn**（观察面挂了不影响审议）；统计读失败**直接抛错**（看板宁可报错也不装作正常） |

---

## 8. 没封的东西（**明确声明不在 Phase2 内**，别被误读为已完成）

**🔴 6 项 Phase3 阻塞**（出自[§代码级对账审计](../../audits/phase2-code-vs-blueprint-audit-2026-11-08.md) §2.3，**原文口径，本单不自行加码**）：

| # | 阻塞项 | 一句话 |
|---|---|---|
| **R4** | 可复现控制 | 全仓零实现；且上游 M3.1-Flash **忽略 temperature** → 「锁温度」在当前模型上走不通，得靠版本锁定 |
| **R6** | 心理数据合规 | 心理原文随审议 prompt 出境第三方；用户协议无对应条款；高风险无本地分流（**= 第 7 节**） |
| **R7** | 考核公平性 | 模型 / prompt 版本均未锁、**未记录**（审议 trace 里无版本字段） |
| **R8** | 上下文与成本 | 审议 prompt 六区块全量；**每轮都跑**；无频率闸门 |
| **R9** | 灰度切换开关 | 零实现 —— **Phase3 的核心动作本身还没有开关** |
| **R12** | 随机抽检 / 人工审核流 | 未建（督导侧有风险事件读取，但不是"每天抽 1% 会话人工审核"的抽检流） |

**🔵 Phase3 出口条件（2 项）**：

| # | 项 | 状态 |
|---|---|---|
| **R10** | 100+ 场真实对话数据 | **未积累** —— 数据管道齐备，**数据还没跑出来**（= 第 6 节的唯一未达成条件） |
| **R11** | 降级时自然衰减幅度 50% | 未实现 —— session-decay 无降级态分支，半衰期不随降级状态调整 |

**其余非阻塞缺口**（口径**以审计报告原文为准**，本单不展开、不加码）：WP31 超阈值告警 / WP58「事件触发链 + delta cap 砍幅」/ WP68 触发事件白名单 / 临床合理性**拦截版**（观测版已交付）/ WP69 §2.5 trace eventTags / WP45「边际递减」/ Phase2.5 数据积累 等 —— 详见审计报告 §5 与母版各 WP 行的 ⚠️ 注记。

> 📌 **一句话**：**Phase2 封的是引擎能力（38/43）+ 账 + 闸门 + 承接；没封的是 Phase3 的灰度开关与合规前置。** 这份记录就是三个月后回答"封了什么、没封什么、Phase2.5 开工前还差什么"的唯一出处。

---

_封版于 2026-11-08 · HEAD bde6d8f · 工作区 16 个未提交文件（见 §4）· **未 commit / 未打 tag / 未 push**_
