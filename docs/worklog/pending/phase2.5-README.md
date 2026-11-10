# Phase2.5 灰度验证期 · 工作入口

> **路径**：`docs/worklog/pending/phase2.5-README.md`
> **状态**：✅ Phase2.5 五个 WP 全部交付（WP-A + WP-B + WP-C + WP-D + WP-E）
> **创建日期**：2026-11-08
> **总入口**：[§worklog/README.md](../README.md)

---

## 0. 这是什么阶段（先读这段）

**Phase2.5 不是功能开发阶段，是验证阶段。**

| 阶段 | 干什么 | 类比 |
|---|---|---|
| Phase2 | 造出引擎（规则算子 / 同盟三维 / 记忆 / 审议层 PoC） | 造出一辆车 |
| **Phase2.5** | **把车开上路试一圈——小范围验证质量，确认没问题再正式上路** | **试车场** |
| Phase3 | 正式上路商业化（全量切 + 收费） | 正式运营 |

**一句话：Phase2.5 的目标不是"做新功能"，而是"用自动化数据验证引擎质量达标，决定要不要全量切"。**

---

## 1. 出口条件（做完的标志）

| # | 出口条件 | 可判定标准 |
|---|---|---|
| ① **合规过线** | 审议不传心理原文，只传结构化数据；高风险轮次永远走本地规则 | 合规口径过关 |
| ② **考核公平** | 考核场景永远走纯规则模式，LLM 审议只用于非考核场景 | 同一场考核两次跑结果一致 |
| ③ **成本可控** | 触发式闸门——只有状态变化大才跑审议，平静时不跑 | 单场（50 分钟）审议成本 ≤ 1 元 |
| ④ **质量达标** | 审议建议准确率 ≥ 80%（用督导解析当 ground truth 自动评测） | 自动评测报告达标 |
| ⑤ **数据积累** | 1000+ 场自动对练数据（用模拟咨询师 AI 自动跑） | 数据集齐备 |

---

## 2. WP 清单与进度

| WP | 名称 | 优先级 | 状态 | 任务单 / 交付记录 |
|---|---|---|---|---|
| **WP-A** | 审议输入最小化（合规 + 成本双解决） | 🔴 P0 | ✅ 已完成 | [任务单](phase2.5-wp-a-deliberation-input-minimization-2026-11-08.md) / [交付记录](../completed/phase2.5/phase2.5-wp-a-deliberation-input-minimization-implementation-2026-11-08.md) |
| **WP-B** | 可复现控制 + 版本锁定 | 🔴 P0 | ✅ 已完成 | [任务单](../completed/phase2.5/phase2.5-wp-b-reproducibility-version-locking.md) |
| **WP-C** | 触发式审议闸门 | 🟡 P1 | ✅ 已完成 | [任务单](../completed/phase2.5/phase2.5-wp-c-triggered-deliberation-gate.md) / [交付记录](../completed/phase2.5/phase2.5-wp-c-triggered-deliberation-gate-implementation-2026-11-09.md) |
| **WP-D** | 模拟咨询师 AI + 自动对练 | 🟡 P1 | ✅ 已完成 | [任务单](../completed/phase2.5/phase2.5-wp-d-auto-practice-2026-11-08.md) / [交付记录](../completed/phase2.5/phase2.5-wp-d-auto-practice-2026-11-08-implementation.md) |
| **WP-E** | 自动评测 + 参数调优 | 🟡 P1 | ✅ 已完成 | [任务单](../completed/phase2.5/phase2.5-wp-e-auto-evaluation-tuning.md) / [交付记录](../completed/phase2.5/phase2.5-wp-e-auto-evaluation-implementation-2026-11-09.md) |
| **WP-F** | 成本看板多源合并 | 🟢 P2 | ✅ 已完成 | [任务单](../completed/phase2.5/phase2.5-wp-f-cost-board-merge-sources.md) / [交付记录](../completed/phase2.5/phase2.5-wp-f-cost-board-merge-sources-implementation-2026-11-09.md) |
| **WP-G** | 对话质量修复（来访话术 / 咨询师兜底 / 停滞检测 / 危机应对） | 🔴 P0 | ✅ 已交付（**验收推迟，见下**） | [任务单](../completed/phase2.5/wp-g-dialogue-quality-fix-task.md) / [交付记录](../completed/phase2.5/phase2.5-wp-g-dialogue-quality-fix-implementation-2026-11-09.md) |
| **WP-H** | 渲染可用性与指标可信度修复 | 🔴 **P0** | ✅ **三波全交付**（改动 1~9 + 批次可观测性收口）；金丝雀门禁已过，100 场级批次待主 Agent 发起 | [任务单](wp-h-render-availability-fix-task.md) / [第一波交付记录](../completed/phase2.5/phase2.5-wp-h-wave1-render-availability-implementation-2026-11-09.md) / [第二/三波交付记录](../completed/phase2.5/phase2.5-wp-h-wave2-3-implementation-2026-11-10.md) / [金丝雀验证记录](phase2.5-wp-h-wave1-canary-verification-2026-11-09.md) |
| **WP-G** | 对话质量修复 · 金丝雀验收 | 🔴 P0 | ✅ **金丝雀层面已验证**（24 场：来访兜底句 82.9%→0.0%、重复率 81.4%→0.0%） | [金丝雀验证记录](phase2.5-wp-h-wave1-canary-verification-2026-11-09.md) |

**依赖关系：**
```
WP-A 审议输入最小化
  ↓
WP-C 触发式闸门
  ↓
WP-D 模拟咨询师 + 自动对练
  ↓
WP-E 自动评测 + 参数调优

WP-B 可复现控制 + 版本锁定
  （独立，与上面的链不互相依赖）
```

---

## 3. 当前有什么活

WP-H 三波已交付、金丝雀门禁已过。当前在办 / 待办（详见 [§WP 登记表](phase2.5-wp-list-2026-11-08.md) 第四节独立单）：

| 事项 | 状态 |
|---|---|
| **8 角色基线差异化** | ✅ 已交付（2026-11-10）：8 行标定表作单一真相源 + A 类 seed 装配 / B 类只更新基线列 → [交付记录](../completed/phase2.5/wp-j-character-baseline-differentiation-2026-11-10.md) · **主 Agent 独立复验通过**（连库 8 行逐字一致 + 自检反向验证 8/8）→ [复验记录](../completed/phase2.5/wp-j-character-baseline-independent-verification-2026-11-10.md) |
| P1e Phase2 来访者语义离线落库 | ✅ 已交付并 push（commit d14daa5），真库 migration 已跑两次 |
| verbal_voice 8 角色文案 | ✅ 已落库（2026-11-10）：8 条文案进 `CHARACTER_BASELINE_CALIBRATION`（与数值同源），A 类经 `baselineOf()` 装配、B 类随基线校准 UPDATE 一起写；真库 8/8 逐字一致，seed 连跑两次幂等 → [文案定稿](phase2.5-verbal-voice-drafts-2026-11-10.md) |
| P1d 接线修复后的验收 + 重跑 | 📋 方案已写未执行（[验收+重跑方案](phase2.5-p1d-acceptance-and-rerun-plan-2026-11-10.md)） |
| 30 场人工锚点标注 → 阈值标定 | 📋 标注台已交付，人工标注进行中；标定方案已写（[标定方案](phase2.5-anchor-calibration-plan-2026-11-10.md)） |
| 100 场级验证批次 | 门禁已过，待主 Agent 发起（`.env` 还需配第二家 chat provider 的 key） |

### 3.1 必须先知道的转折（2026-11-09 晚）

三批自动对练（合计 1034 场）跑完后，对归档逐字稿做全量复算，发现一个**推翻既有结论**的事实：

- 报告里来访者「TOP4 话术」逐字等于 `render-adapter.config.ts:150` 的 `DEFAULT_RENDER_FALLBACK_UTTERANCES`（4 句兜底池）
- 归档 500 份逐字稿中，来访者消息 17,585 条，兜底池 4 句命中 **16,143 条 = 91.8%**，四句各自 4031/4033/4039/4040（确定性轮转特征）
- 1,031 个有轮次场次中 **926 场（89.8%）整场 `total_tokens = 0`**；`prompt_tokens` 全库最大值 0

**结论：这三批数据不是「质量差的对练」，是「LLM 基本没被调用」。** 根因是渲染候选序列只有 1 个 provider（`ENGINE_RENDER_FALLBACK_PROVIDERS` 未配置）+ `failureThreshold=3` + `cooldownMaxMs=300s` 的单例熔断 —— 批量并发下上游限流即导致长时间全损降级。

**因此：**
- **不能拿这三批数据调参**。95.9% 重复率、停滞率、cold/nonsense 模式对比等结论全部建立在这批无效数据上，作废
- **WP-G 的 3 项渲染层 prompt 改动保留代码，验收推迟** —— LLM 不说话时，角色 prompt 里写多少句都无意义
- 第④②出口条件的「质量达标」判定，必须等 WP-H 过了门禁重跑才算数

完整证据链见：[数据链路体检记录](phase2.5-data-pipeline-audit-2026-11-09.md)

### 3.2 出口条件当前状态

| 出口条件 | 状态 |
|---|---|
| ① 合规过线 | ✅ WP-A 交付（入参零原文 + 三道风险闸门） |
| ② 考核公平 | ✅ WP-B 交付（考核场景永远纯规则 + 版本锁定） |
| ③ 成本可控 | 🚧 WP-C 闸门已上线，**种子值待真实评测校准**；`prompt_tokens` 恒为 0 的根因已修（WP-H 改动 7：上游报了的输入侧用量现在能穿透流式链路），成本口径可从 `output_only` 升到 `full` —— **待 100 场级批次重新取证** |
| ④ 质量达标 | 🚧 **部分解除** —— 2026-11-09 金丝雀已证明 LLM 真的被调用（24/24 场 `total_tokens>0`、兜底句 0.0%）；改动 7/8 已落地（`prompt_tokens` 归约链 + `engine_version` 走 `git describe --dirty`），改动 9 的批次有效性门禁已上线 —— **质量结论仍须等 100 场级批次重跑后再判** |
| ⑤ 数据积累 | 🚧 WP-D 自动对练已交付；**但 534/1034 场（51.6%）逐字稿已被 `MAX_DEBUG_SESSIONS=500` 淘汰**，幸存 500 场已归档到 `data/archives/debug-sessions-baseline-20261109/` |

### 3.3 下一步（严格按顺序）

1. ~~**WP-H 第一波**（让 LLM 真的被调用）~~ ✅ **已交付（2026-11-09）**：半开探测（冷却 60s / 半开 30s）+ 显式退避重试层（关掉 LangChain 隐式 6 次）+ 超时即中止（修"幽灵重试"）+ 并发缺省 3→2 + 单候选启动告警。**运维还差一步：`.env` 里配第二家 chat provider 的 key**（deepseek / doubao / qwen 的 provider 代码已注册，只差 key）
2. ~~**WP-H 第二波**（指标可信度）~~ ✅ **已交付（2026-11-10）**：改动 5（双计数器五列 + 迁移 0039）、改动 6（批次端点聚合）、改动 7（`prompt_tokens` 归约链真根因修复：provider/chunk 契约层丢掉了输入侧拆分）
3. ~~**WP-H 第三波**（版本追溯 + 批次门禁）~~ ✅ **已交付（2026-11-10）**：改动 8（`engine_version` 走 `git describe --always --dirty`，无 git 回落 `unknown`）、改动 9（批次有效性门禁：`ap_practice_batches` 表 + `GET /batches/:id` 返回 `batchHealth` 与 `warning`）；另加批次可观测性三项（`DB_QUERY_LOGGING` 日志降噪 / WS 空房间短路 / 逐字稿批次索引）
4. ~~**跑金丝雀验证门禁**~~ ✅ **已通过（2026-11-09 23:23~23:31）**，24 场（4 角色 × expert/cold × 3 重复，maxTurns 12，并发 2），三项门禁全过：`total_tokens>0` 场次 **24/24 = 100%**（要求 ≥90%）、兜底句占比 **0.0%**（要求 <5%）、`degraded_turns = 0` 且 `degraded ≤ turn_count` **24/24**（要求全满足）。同规格旧产物对照：`total_tokens=0` 18/24、兜底句 82.9%、`degraded_turns` 350。记录见 [金丝雀验证记录](phase2.5-wp-h-wave1-canary-verification-2026-11-09.md)
5. 门禁已过 → 允许开 100 场级验证（改动 6/7/9 已落库，`GET /admin/api/auto-practice/batches/:id` 会直接给出 `batchHealth.valid` 与不合格时的 `warning`；批次跑批由主 Agent 发起）
6. `engine-core` 全程不动

---

## 4. 红线（Phase2.5 特有）

### 4.1 engine-core 边界（按纯不纯分层，不是"一行不动"）
- ❌ 不在 `src/engine-core/` 加任何副作用：NestJS / DB / Redis / 网络 / prompt / 模型名 / process.env
- ✅ 纯决策计算、纯出口字段、纯类型该进内核就进（不要为了"避开内核"把纯计算堆到适配层）
- ✅ IO / LLM / 装配一律在 `src/engine-adapters/`；内核不知道 LLM 是什么
- ✅ `boundary.spec.ts`（AST 护栏）不许自己改

### 4.2 合规红线
- ❌ 审议 prompt 里永远不出现对话原文（咨询师说的话 / 来访者说的话）
- ❌ 高风险轮次永远不跑 LLM 审议，直接走规则
- ✅ 心理数据不出境——这是底线，没有商量余地

### 4.3 零回归红线
- ❌ 不改现有审议的输出格式（deltas + reason + operatorTags + intentionShift）
- ❌ 不改现有审议钩子的调用方式
- ✅ 只是改"传给 LLM 的输入是什么"，不改"LLM 输出什么"

---

## 5. 交付格式

### 5.1 交付记录放哪里

做完一个 WP，写一份交付记录，放：
```
docs/worklog/completed/phase2.5/
  └─ phase2.5-wp-x-implementation-2026-11-08.md
```

### 5.2 交付记录写什么

参照 Phase2 的格式：
1. 本单做了什么（一句话总结）
2. 方案设计（实际实现的方案，跟任务单的方案有什么差异）
3. 偏差说明（如果改了方案，为什么改，理由是什么）
4. 测试闸门（tsc / vitest / eslint / boundary.spec.ts 的数字）
5. 交付物清单（新增了哪些文件，改了哪些文件）
6. 回写清单（README / 总览 / 登记表 哪里更新了）

### 5.3 方案可以改，但要写偏差

如果开发期间发现更合理更专业的方案，可以按后端的来——但要在交付记录里写明：
- 原方案是什么
- 实际方案是什么
- 为什么改（理由要充分）

---

## 6. 文档导航

| 文档 | 内容 |
|---|---|
| 本文件（Phase2.5 README） | 工作入口：定位 / 出口条件 / WP 进度 / 红线 / 交付格式 |
| [§Phase2.5 总览](phase2.5-overview-2026-11-08.md) | 详细的定位 / 目标 / 范围 / 关键设计决策 |
| [§WP 登记表](phase2.5-wp-list-2026-11-08.md) | 逐 WP 一行的登记表（依赖关系 / 出口条件对照） |
| [§数据链路体检记录](phase2.5-data-pipeline-audit-2026-11-09.md) | **必读**：6 项待修发现，含「91.8% 发言是兜底句」的完整证据链与代码行号 |
| [§WP-H 任务单](wp-h-render-availability-fix-task.md) | **当前在办**：渲染可用性 + 指标可信度 + 批次门禁，9 项改动 + 验收门禁 |
| [§worklog/README.md](../README.md) | 整个项目的工作入口（Phase2 封版 / R9 / Phase2.5 状态） |

---

## 7. 术语澄清（2026-11-09 补）

| 术语 | 容易误解成 | 实际含义 |
|---|---|---|
| 「话术重复率」 | Prompt 写得不够多样 | 本次三批数据里，它的真实含义是**渲染降级兜底率** |
| 「渲染降级 / degraded」 | 内容质量不高 | **LLM 没被调用**，返回的是 `render-adapter.config.ts` 里的常量兜底句 |
| 「heavy_degraded」 | 一半以上轮次质量差 | 计数口径错：两侧各 +1，可 2×turn_count；阈值却按轮数算 |
| 「engine_version」 | 代码版本可追溯 | 实际全为 `"dev"`（`.env` 未配 `ENGINE_VERSION`），零区分度 |

这三批数据的**唯一**正确用法：拿来定位管道缺陷。**不能**拿来调 prompt、不能拿来比较模式优劣、不能拿来给出口条件④打分。
